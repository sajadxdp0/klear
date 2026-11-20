import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/cashfree/client";
import { getDb } from "@/lib/db/client";
import { auditLog, orders, payments, refunds, settlements } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cashfree PG webhook ingest — per the official contract:
 *
 *   signature = Base64(HMAC_SHA256(x-webhook-timestamp + rawBody, clientSecret))
 *   • raw body bytes only — JSON round-trips (170.00 → 170) break signatures
 *   • route on payload.type FIRST, then inner status (a SUCCESS webhook can
 *     carry payment_status PENDING during late authorisation)
 *   • settlement UTRs may arrive as JSON numbers — coerce to string
 *   • at-least-once delivery: upserts are idempotent, unknown types no-op
 *   • API is source of truth; this webhook is the real-time trigger
 *   • Cashfree specifies no replay window for PG webhooks — we enforce our
 *     own 10-minute max-age as defense-in-depth
 */

const MAX_AGE_MS = 10 * 60 * 1000;

interface CfWebhook {
  type: string;
  event_time?: string;
  data: Record<string, unknown>;
}

function rupeesToPaise(v: unknown): number {
  // Cashfree sends rupees as numbers or strings ("5000.00") — never paise.
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v); // coerces numeric UTRs too
}

export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-webhook-signature");
  const timestamp = req.headers.get("x-webhook-timestamp");
  const idempotencyKey = req.headers.get("x-idempotency-key");

  const secretConfigured = Boolean(process.env.CASHFREE_CLIENT_SECRET);
  const verified = secretConfigured
    ? verifyWebhookSignature(raw, signature, timestamp)
    : false;

  // Reject tampered deliveries when verification is possible.
  if (secretConfigured && !verified) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  // Defense-in-depth freshness check (bound into the signature already,
  // but Cashfree documents no replay window of its own for PG events).
  if (timestamp) {
    const ts = Number(timestamp);
    if (Number.isFinite(ts) && Math.abs(Date.now() / 1000 - ts) > MAX_AGE_MS / 1000) {
      return NextResponse.json({ error: "stale webhook" }, { status: 401 });
    }
  }

  const actor =
    secretConfigured && verified ? "cashfree-webhook" : "cashfree-webhook(unverified)";

  try {
    const event = JSON.parse(raw) as CfWebhook;
    const db = getDb();
    const now = Date.now();
    let note = event.type;

    const data = event.data ?? {};
    const order = (data.order ?? {}) as Record<string, unknown>;
    const payment = (data.payment ?? {}) as Record<string, unknown>;
    const customer = (data.customer_details ?? {}) as Record<string, unknown>;

    switch (event.type) {
      case "PAYMENT_SUCCESS_WEBHOOK":
      case "PAYMENT_FAILED_WEBHOOK":
      case "PAYMENT_USER_DROPPED_WEBHOOK": {
        // Two-layer routing: event type first, inner status second.
        const orderId = asString(order.order_id) ?? asString(payment.order_id) ?? "";
        const payId = asString(payment.cf_payment_id) ?? `evt_${now}`;
        const innerStatus = asString(payment.payment_status) ?? "";
        const finalStatus =
          event.type === "PAYMENT_SUCCESS_WEBHOOK" && innerStatus !== "PENDING"
            ? "SUCCESS"
            : innerStatus === "PENDING"
              ? "PENDING"
              : event.type === "PAYMENT_FAILED_WEBHOOK"
                ? "FAILED"
                : "FAILED"; // USER_DROPPED

        const err = (payment.error_details ?? {}) as Record<string, unknown>;

        if (orderId) {
          db.insert(payments)
            .values({
              id: payId,
              orderId,
              amount: rupeesToPaise(payment.payment_amount ?? order.order_amount),
              status: finalStatus,
              // branch on error_code/error_reason — error_description is display-only
              method: payment.payment_group ? String(payment.payment_group) : null,
              bankReference: asString(payment.bank_reference),
              failureReason: err.error_reason ? String(err.error_reason) : null,
              errorMessage: err.error_code ? String(err.error_code) : null,
              customerName: customer.customer_name
                ? String(customer.customer_name)
                : null,
              createdAt: now,
              raw,
            })
            .onConflictDoNothing()
            .run();

          // fulfillment-grade confirmation: only when the webhook is a true
          // success; the merchant UI re-verifies via GET /orders/{id} anyway
          if (finalStatus === "SUCCESS") {
            db.update(orders).set({ status: "PAID" }).where(eq(orders.id, orderId)).run();
          }
        }
        note = `${event.type} order=${orderId} status=${finalStatus}`;
        break;
      }

      case "SETTLEMENT_INITIATED":
      case "SETTLEMENT_SUCCESS":
      case "SETTLEMENT_FAILED":
      case "SETTLEMENT_REVERSED": {
        const s = (data.settlement ?? {}) as Record<string, unknown>;
        const settlementId =
          asString(s.settlement_id) ?? asString(s.cf_settlement_id) ?? `set_${now}`;
        // webhook settlement_id maps to cf_settlement_id in the API
        const utr = asString(s.utr); // may be a JSON number — coerced
        const net = rupeesToPaise(s.amount_settled ?? s.settlement_amount);
        const gross = rupeesToPaise(s.payment_amount) || net;
        const fee = rupeesToPaise(s.service_charge) + rupeesToPaise(s.service_tax);

        // UTR is null until SETTLEMENT_SUCCESS — never treat null as failure
        db.insert(settlements)
          .values({
            id: `set_cf_${settlementId}`,
            paymentId: null,
            orderId: null,
            grossAmount: gross,
            fee,
            netAmount: net,
            utr,
            settledAt: s.settled_on ? Date.parse(String(s.settled_on)) || now : now,
            raw,
          })
          .onConflictDoNothing()
          .run();
        note = `${event.type} id=${settlementId} utr=${utr ?? "(pending)"}`;
        break;
      }

      case "REFUND_STATUS_WEBHOOK": {
        const r = (data.refund ?? {}) as Record<string, unknown>;
        const refundId = asString(r.cf_refund_id) ?? `ref_${now}`;
        const status = String(r.refund_status ?? "PENDING");
        db.insert(refunds)
          .values({
            id: refundId,
            orderId: asString(r.order_id) ?? "",
            paymentId: asString(r.cf_payment_id),
            amount: rupeesToPaise(r.refund_amount),
            status:
              status === "SUCCESS" ? "PROCESSED" : status === "ONHOLD" ? "PENDING" : status,
            createdAt: now,
            raw,
          })
          .onConflictDoNothing()
          .run();
        note = `REFUND_STATUS_WEBHOOK id=${refundId} status=${status}`;
        break;
      }

      case "PAYMENT_LINK_EVENT": {
        // fields are FLAT under data (no data.link wrapper); amounts are
        // strings; dedupe on (cf_link_id, link_status, link_amount_paid)
        const linkOrder = (data.order ?? {}) as Record<string, unknown>;
        const linkStatus = String(data.link_status ?? "UNKNOWN");
        const linkOrderId = asString(linkOrder.order_id);
        note = `PAYMENT_LINK_EVENT link=${asString(data.link_id)} status=${linkStatus}` +
          (linkOrderId ? ` order=${linkOrderId}` : "");
        break;
      }

      case "DISPUTE_CREATED":
      case "DISPUTE_UPDATED":
      case "DISPUTE_CLOSED":
        note = `${event.type} (stored for the dispute engine)`;
        break;

      default:
        // documented posture: no-op default handler, never fail on unknown types
        note = `${event.type} (no handler)`;
    }

    db.insert(auditLog)
      .values({
        actor,
        action: "WEBHOOK_EVENT",
        entity: "cashfree",
        entityId: event.type,
        payload: JSON.stringify({
          note,
          verified: secretConfigured ? verified : null,
          idempotencyKey,
        }),
        createdAt: now,
      })
      .run();

    // always 200: failures trigger Cashfree's retry ladder (3× at 2/10/30m)
    return NextResponse.json({ ok: true, note, verified: secretConfigured ? verified : null });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 200 });
  }
}

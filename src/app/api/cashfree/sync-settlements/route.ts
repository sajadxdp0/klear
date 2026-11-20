import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLog, orders, payments, settlements } from "@/lib/db/schema";
import { runRecon } from "@/lib/recon/run";
import { cashfreeConfigured } from "@/lib/cashfree/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Live settlement sync — Cashfree's documented reconciler pattern:
 * "use the API as source-of-truth and the webhook as a real-time trigger."
 *
 * POST /pg/settlement/recon with a 7-day window, cursor-paginated
 * (limit 1000/call, walk cursor until null), then upsert:
 *   • payments   from payment_details (dedupe on cf_payment_id)
 *   • settlements one row per event: gross = event_amount,
 *                fee = service_charge + service_tax (18% GST),
 *                net = event_settlement_amount
 *   • orders     minimal rows so the chain links (dedupe on order_id)
 *
 * Settlement endpoints are rate-limited (30/min prod, ~20/min sandbox)
 * so this sync is deliberately single-window, no polling loops.
 */
interface ReconRow {
  event_details?: {
    event_id?: string;
    event_type?: string;
    sale_type?: string;
    event_amount?: number;
    event_settlement_amount?: number;
    event_status?: string;
    event_time?: string;
    event_service_charge?: number;
    event_service_tax?: number;
  };
  order_details?: { order_id?: string; order_amount?: number };
  customer_details?: { customer_name?: string; customer_phone?: string; customer_email?: string };
  payment_details?: {
    cf_payment_id?: number | string;
    payment_amount?: number;
    payment_mode?: string;
    bank_reference?: string;
    status?: string;
  };
  settlement_details?: {
    cf_settlement_id?: number | string;
    utr?: string | number;
    settlement_date?: string;
    settlement_type?: string;
  };
}

const P = (rupees: unknown): number => {
  const n = Number(rupees);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

async function cfPost(path: string, body: unknown) {
  const base = process.env.CASHFREE_ENV === "PRODUCTION"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "x-client-id": process.env.CASHFREE_CLIENT_ID!,
      "x-client-secret": process.env.CASHFREE_CLIENT_SECRET!,
      "x-api-version": "2026-01-01",
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Cashfree ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as { cursor: string | null; data: ReconRow[] };
}

export async function POST() {
  try {
    if (!cashfreeConfigured()) {
      return NextResponse.json(
        {
          error:
            "Live settlement sync needs CASHFREE_CLIENT_ID/SECRET in .env. The demo dataset covers the simulation path.",
        },
        { status: 400 }
      );
    }

    const db = getDb();
    const now = Date.now();
    const startDate = new Date(now - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace("Z", "+05:30");

    let cursor: string | null = null;
    let rows = 0;
    let paymentsUpserted = 0;
    let settlementsUpserted = 0;

    do {
      const page = await cfPost("/settlement/recon", {
        pagination: { limit: 1000, cursor },
        filters: { start_date: startDate, end_date: new Date().toISOString().replace("Z", "+05:30") },
      });
      cursor = page.cursor;

      for (const row of page.data ?? []) {
        rows++;
        const ev = row.event_details ?? {};
        const od = row.order_details ?? {};
        const cd = row.customer_details ?? {};
        const pd = row.payment_details ?? {};
        const sd = row.settlement_details ?? {};

        if (ev.event_type !== "PAYMENT" || ev.sale_type !== "CREDIT" || ev.event_status !== "SUCCESS") {
          continue;
        }

        const orderId = od.order_id;
        const payId = pd.cf_payment_id ? String(pd.cf_payment_id) : null;
        const settledAt = sd.settlement_date ? Date.parse(sd.settlement_date) || now : now;

        if (orderId) {
          const existingOrder = db.select().from(orders)
            .where(eq(orders.id, orderId)).all().length;
          if (existingOrder === 0) {
            db.insert(orders)
              .values({
                id: orderId,
                amount: P(od.order_amount ?? ev.event_amount),
                status: "PAID",
                customerName: cd.customer_name ?? null,
                customerPhone: cd.customer_phone ?? null,
                customerEmail: cd.customer_email ?? null,
                createdAt: ev.event_time ? Date.parse(ev.event_time) || now : now,
                raw: null,
              })
              .onConflictDoNothing()
              .run();
          }
        }

        if (payId && orderId) {
          const existingPayment = db.select().from(payments)
            .where(eq(payments.id, payId)).all().length;
          if (existingPayment === 0) {
            db.insert(payments)
              .values({
                id: payId,
                orderId,
                amount: P(pd.payment_amount ?? ev.event_amount),
                status: "SUCCESS",
                method: pd.payment_mode ? String(pd.payment_mode).toLowerCase() : null,
                bankReference: pd.bank_reference ? String(pd.bank_reference) : null,
                customerName: cd.customer_name ?? null,
                createdAt: ev.event_time ? Date.parse(ev.event_time) || now : now,
                raw: null,
              })
              .onConflictDoNothing()
              .run();
            paymentsUpserted++;
          }
        }

        const sid = sd.cf_settlement_id;
        const eid = ev.event_id;
        if (sid && eid) {
          db.insert(settlements)
            .values({
              id: `set_cf_${sid}_${eid}`,
              paymentId: payId,
              orderId: orderId ?? null,
              grossAmount: P(ev.event_amount),
              fee: P(ev.event_service_charge) + P(ev.event_service_tax),
              netAmount: P(ev.event_settlement_amount),
              utr: sd.utr != null ? String(sd.utr) : null,
              settledAt,
              raw: null,
            })
            .onConflictDoNothing()
            .run();
          settlementsUpserted++;
        }
      }
    } while (cursor);

    const recon = await runRecon();

    db.insert(auditLog)
      .values({
        actor: "cashfree-api",
        action: "SETTLEMENT_SYNC",
        entity: "settlements",
        entityId: null,
        payload: JSON.stringify({ rows, paymentsUpserted, settlementsUpserted }),
        createdAt: now,
      })
      .run();

    return NextResponse.json({
      rows,
      paymentsUpserted,
      settlementsUpserted,
      klearScore: recon.klearScore,
      exceptions: recon.exceptions,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}


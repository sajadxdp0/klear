/**
 * Cashfree PG client — thin REST wrapper over the official API shapes
 * (per Cashfree's agent-skills docs):
 *
 *   Sandbox    https://sandbox.cashfree.com/pg
 *   Production https://api.cashfree.com/pg
 *   Headers    x-client-id, x-client-secret, x-api-version: 2026-01-01
 *
 *   Payment links  POST /pg/links          (link_amount in RUPEES)
 *   Orders         GET  /pg/orders/{id}
 *   Payments       GET  /pg/orders/{id}/payments
 *
 *   Webhook verification:
 *     signedPayload      = x-webhook-timestamp + rawBody
 *     expectedSignature  = Base64(HMAC_SHA256(signedPayload, webhookSecret))
 *
 * SIMULATION MODE: when CASHFREE_CLIENT_ID is absent, link creation returns a
 * clearly-labeled in-app simulation link. Money never moves; the dashboard
 * shows a SIMULATION badge on those actions. Nothing is disguised as live.
 */
import crypto from "node:crypto";

const API_VERSION = "2026-01-01";

export function cashfreeConfigured(): boolean {
  return Boolean(process.env.CASHFREE_CLIENT_ID && process.env.CASHFREE_CLIENT_SECRET);
}

function baseUrl(): string {
  return process.env.CASHFREE_ENV === "PRODUCTION"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

async function cfFetch<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown }
): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: init.method,
    headers: {
      "x-client-id": process.env.CASHFREE_CLIENT_ID!,
      "x-client-secret": process.env.CASHFREE_CLIENT_SECRET!,
      "x-api-version": API_VERSION,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Cashfree ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

/* ── Webhook verification ─────────────────────────────────────────────── */

export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null
): boolean {
  const secret =
    process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_CLIENT_SECRET;
  if (!secret || !signature || !timestamp) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(timestamp + rawBody)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ── Payment links (recovery rail) ────────────────────────────────────── */

export interface CreateLinkInput {
  linkId: string; // merchant-provided unique id
  amountPaise: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  purpose: string;
  autoReminders?: boolean;
}

export interface CreateLinkResult {
  linkId: string;
  linkUrl: string;
  simulated: boolean;
  raw?: unknown;
}

export async function createPaymentLink(
  input: CreateLinkInput
): Promise<CreateLinkResult> {
  // simulation mode — no keys configured
  if (!cashfreeConfigured()) {
    const linkId = input.linkId;
    return {
      linkId,
      linkUrl: `${process.env.APP_BASE_URL || "http://localhost:3000"}/simulate/pay/${linkId}`,
      simulated: true,
      raw: { simulated: true, note: "Cashfree keys not configured — in-app simulation" },
    };
  }

  const payload = {
    link_id: input.linkId,
    link_amount: input.amountPaise / 100, // API takes rupees (decimal)
    link_currency: "INR",
    link_purpose: input.purpose.slice(0, 500),
    customer_details: {
      customer_name: input.customerName,
      customer_phone: input.customerPhone.replace(/^\+91/, ""),
      customer_email: input.customerEmail ?? undefined,
    },
    link_auto_reminders: input.autoReminders ?? false,
    link_notify: { send_sms: true, send_email: Boolean(input.customerEmail) },
    link_meta: {
      upi_intent: "true",
      payment_methods: "cc,dc,upi,nb",
    },
    link_notes: { source: "klear-recovery" },
  };

  const res = await cfFetch<{ link_id: string; link_url: string }>(
    "/links",
    { method: "POST", body: payload }
  );
  return {
    linkId: res.link_id,
    linkUrl: res.link_url,
    simulated: false,
    raw: res,
  };
}

/* ── Orders & payments (authoritative fetch for ingest) ──────────────── */

export interface CfOrder {
  order_id: string;
  order_status: string;
  order_amount: number; // rupees
  customer_details?: { customer_name?: string; customer_phone?: string; customer_email?: string };
  order_meta?: Record<string, unknown>;
}

export async function fetchOrder(orderId: string): Promise<CfOrder | null> {
  try {
    return await cfFetch<CfOrder>(`/orders/${orderId}`, { method: "GET" });
  } catch {
    return null;
  }
}

export interface CfPayment {
  cf_payment_id: number | string;
  order_id: string;
  payment_status: string;
  payment_amount: number; // rupees
  payment_method?: { upi?: { vpa?: string }; card?: {} } | null;
  bank_reference?: string;
  payment_group?: string;
  error_details?: { error_description?: string; error_reason?: string } | null;
}

export async function fetchPaymentsForOrder(orderId: string): Promise<CfPayment[]> {
  try {
    const res = await cfFetch<{ payments?: CfPayment[] }>(
      `/orders/${orderId}/payments`,
      { method: "GET" }
    );
    return res.payments ?? [];
  } catch {
    return [];
  }
}

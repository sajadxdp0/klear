/**
 * Failure triage: map each failed payment to a recovery action proposal
 * with a human-readable rationale. Proposals only — execution requires an
 * explicit approval (see execute.ts).
 *
 * Band-aware: payments flagged BLOCK by the fraud engine are held for
 * fraud review instead of being recovered.
 */
import { getDb } from "@/lib/db/client";
import { fraudFlags, payments, recoveryActions, auditLog } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export type RecoveryActionType =
  | "RETRY"
  | "PAYMENT_LINK"
  | "UPI_COLLECT"
  | "DUNNING"
  | "HOLD_FOR_FRAUD"
  | "GIVE_UP";

interface TriageRule {
  reason: string;
  action: RecoveryActionType;
  rationale: (ctx: { method: string | null; amountPaise: number }) => string;
}

const TRIAGE: Record<string, TriageRule> = {
  bank_timeout: {
    reason: "bank_timeout",
    action: "RETRY",
    rationale: () =>
      "Bank timeout is transient — a same-method retry within minutes has a high recovery rate; no customer nudge needed yet.",
  },
  insufficient_funds: {
    reason: "insufficient_funds",
    action: "DUNNING",
    rationale: () =>
      "Customer account was short on balance. Schedule a polite dunning reminder in 24h when salaries typically land, with a fresh payment link.",
  },
  invalid_vpa: {
    reason: "invalid_vpa",
    action: "PAYMENT_LINK",
    rationale: ({ method }) =>
      `The ${method ?? "UPI"} handle was invalid or unreachable. Send a payment link instead — lets the customer pick any rail (UPI, card, netbanking).`,
  },
  card_auth_declined: {
    reason: "card_auth_declined",
    action: "PAYMENT_LINK",
    rationale: ({ amountPaise }) =>
      `Card was declined by the issuer (₹${(amountPaise / 100).toLocaleString("en-IN")}). A payment link that leads with UPI avoids another issuer decline.`,
  },
  risk_hold: {
    reason: "risk_hold",
    action: "HOLD_FOR_FRAUD",
    rationale: () =>
      "Gateway risk engine held this payment. No recovery attempt until the fraud review clears — recovering a held payment could bypass the risk decision.",
  },
  customer_abandoned: {
    reason: "customer_abandoned",
    action: "PAYMENT_LINK",
    rationale: () =>
      "Customer dropped off before OTP. Send a one-tap payment link — no re-entry of details, UPI intent directly opens their app.",
  },
};

const DEFAULT_TRIAGE: TriageRule = {
  reason: "unknown",
  action: "PAYMENT_LINK",
  rationale: () =>
    "Unclassified failure. Safest universal recovery: a fresh payment link with all rails enabled.",
};

export interface TriageProposal {
  paymentId: string;
  orderId: string;
  failureReason: string | null;
  actionType: RecoveryActionType;
  rationale: string;
  status: "PROPOSED";
}

/** Pure: builds proposals for a list of failed payments given their risk bands. */
export function triageFailures(
  failed: {
    id: string;
    orderId: string;
    amount: number;
    method: string | null;
    failureReason: string | null;
    createdAt: number;
  }[],
  riskBandByPayment: Map<string, string>
): TriageProposal[] {
  // one proposal per ORDER (latest attempt carries the plan)
  const latestPerOrder = new Map<string, (typeof failed)[number]>();
  for (const f of failed) {
    const cur = latestPerOrder.get(f.orderId);
    if (!cur || f.createdAt > cur.createdAt) latestPerOrder.set(f.orderId, f);
  }

  const out: TriageProposal[] = [];
  for (const f of latestPerOrder.values()) {
    const band = riskBandByPayment.get(f.id) ?? "OK";
    if (band === "BLOCK") {
      out.push({
        paymentId: f.id,
        orderId: f.orderId,
        failureReason: f.failureReason,
        actionType: "HOLD_FOR_FRAUD",
        rationale:
          "Fraud engine scored this BLOCK — recovery paused until a human resolves the flag.",
        status: "PROPOSED",
      });
      continue;
    }
    const rule = TRIAGE[f.failureReason ?? ""] ?? DEFAULT_TRIAGE;
    out.push({
      paymentId: f.id,
      orderId: f.orderId,
      failureReason: f.failureReason,
      actionType: rule.action,
      rationale: rule.rationale({ method: f.method, amountPaise: f.amount }),
      status: "PROPOSED",
    });
  }
  return out;
}

export interface TriageSummary {
  proposals: TriageProposal[];
  created: number;
}

/** Sweep failed payments → insert PROPOSED actions (skips already-proposed orders). */
export async function runTriage(): Promise<TriageSummary> {
  const db = getDb();
  const paymentRows = await db.select().from(payments);
  const flagRows = await db.select().from(fraudFlags);
  const existing = await db.select().from(recoveryActions);

  const bandByPayment = new Map(flagRows.map((f) => [f.paymentId ?? "", f.riskBand]));
  const proposedOrderIds = new Set(
    existing.filter((a) => a.status !== "REJECTED").map((a) => a.orderId)
  );

  const failed = paymentRows
    .filter((p) => p.status === "FAILED")
    .map((p) => ({
      id: p.id,
      orderId: p.orderId,
      amount: p.amount,
      method: p.method,
      failureReason: p.failureReason,
      createdAt: p.createdAt,
    }));

  const all = triageFailures(failed, bandByPayment);
  const fresh = all.filter((p) => !proposedOrderIds.has(p.orderId));
  const now = Date.now();

  if (fresh.length > 0) {
    db.insert(recoveryActions)
      .values(
        fresh.map((p) => ({
          paymentId: p.paymentId,
          orderId: p.orderId,
          failureReason: p.failureReason,
          actionType: p.actionType,
          rationale: p.rationale,
          status: "PROPOSED",
          proposedBy: "klear-agent",
          createdAt: now,
        }))
      )
      .run();
  }

  db.insert(auditLog)
    .values({
      actor: "klear-agent",
      action: "TRIAGE_RUN",
      entity: "recovery",
      entityId: null,
      payload: JSON.stringify({ proposals: fresh.length }),
      createdAt: now,
    })
    .run();

  return { proposals: fresh, created: fresh.length };
}

/** Approve a proposal: flips PROPOSED → APPROVED with the approver recorded. */
export async function approveProposal(
  actionId: number,
  approver: string
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select()
    .from(recoveryActions)
    .where(eq(recoveryActions.id, actionId))
    .limit(1);
  if (rows.length === 0 || rows[0].status !== "PROPOSED") return false;

  db.update(recoveryActions)
    .set({ status: "APPROVED", approvedBy: approver, approvedAt: Date.now() })
    .where(eq(recoveryActions.id, actionId))
    .run();

  db.insert(auditLog)
    .values({
      actor: `human:${approver}`,
      action: "APPROVE_RECOVERY",
      entity: "recovery_action",
      entityId: String(actionId),
      payload: JSON.stringify(rows[0]),
      createdAt: Date.now(),
    })
    .run();
  return true;
}

/** Reject a proposal — recorded so the agent learns not to re-propose. */
export async function rejectProposal(
  actionId: number,
  approver: string
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select()
    .from(recoveryActions)
    .where(eq(recoveryActions.id, actionId))
    .limit(1);
  if (rows.length === 0) return false;

  db.update(recoveryActions)
    .set({ status: "REJECTED", approvedBy: approver, approvedAt: Date.now() })
    .where(eq(recoveryActions.id, actionId))
    .run();

  db.insert(auditLog)
    .values({
      actor: `human:${approver}`,
      action: "REJECT_RECOVERY",
      entity: "recovery_action",
      entityId: String(actionId),
      payload: JSON.stringify(rows[0]),
      createdAt: Date.now(),
    })
    .run();
  return true;
}

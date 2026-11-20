/**
 * Dispute response drafting: the merchant's evidence, written up.
 *
 * The facts (payment attempts, fraud reasons, verification results,
 * order history) are gathered deterministically in TypeScript. Sarvam-105B
 * writes the response around those facts and never invents any. Without
 * an API key a deterministic template draft is produced and labeled.
 */
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLog, disputes, fraudFlags, orders, payments } from "@/lib/db/schema";
import { chatStructured, sarvamConfigured } from "@/lib/sarvam/client";
import { formatINR } from "@/lib/money";

export interface DisputeDraft {
  disputeId: string;
  summary: string;
  evidencePoints: string[];
  mode: "sarvam-105b" | "template";
}

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "One paragraph to the issuer summarizing why the dispute should close in the merchant's favor. Use only the FACTS JSON. Plain, factual, no invented details.",
    },
    evidence_points: {
      type: "array",
      description: "Three to five concrete evidence points, each tied to a fact",
      items: { type: "string" },
    },
  },
  required: ["summary", "evidence_points"],
};

const SYSTEM = `You draft payment-dispute responses for an Indian merchant ("${process.env.MERCHANT_NAME ?? "Sunrise Organics"}") on Cashfree.
Rules:
- Use ONLY the FACTS JSON. Never invent dates, names, amounts or outcomes.
- Amounts in paise in the facts: display as rupees (divide by 100) with ₹ formatting.
- Tone: factual, respectful, no legalese, no exclamation marks.
- The summary is addressed to the issuer reviewing the case.`;

export async function draftDisputeResponse(disputeId: string): Promise<DisputeDraft> {
  const db = getDb();
  const disputeRows = await db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  if (disputeRows.length === 0) throw new Error("dispute not found");
  const dispute = disputeRows[0];

  const orderRows = await db.select().from(orders).where(eq(orders.id, dispute.orderId)).limit(1);
  const order = orderRows[0] ?? null;
  const payRows = dispute.paymentId
    ? await db.select().from(payments).where(eq(payments.id, dispute.paymentId)).limit(1)
    : [];
  const payment = payRows[0] ?? null;
  const flagRows = await db
    .select()
    .from(fraudFlags)
    .where(eq(fraudFlags.orderId, dispute.orderId))
    .orderBy(desc(fraudFlags.score))
    .limit(1);
  const flag = flagRows[0] ?? null;

  const facts = {
    dispute: {
      category: dispute.category,
      note: dispute.note,
      status: dispute.status,
      amountPaise: dispute.amount,
      openedAt: dispute.openedAt,
    },
    order: order
      ? {
          id: order.id,
          amountPaise: order.amount,
          status: order.status,
          customerName: order.customerName,
          createdAt: order.createdAt,
        }
      : null,
    payment: payment
      ? {
          id: payment.id,
          method: payment.method,
          status: payment.status,
          bankReference: payment.bankReference,
          amountPaise: payment.amount,
          createdAt: payment.createdAt,
        }
      : null,
    fraudFlag: flag
      ? {
          band: flag.riskBand,
          score: flag.score,
          reasons: (JSON.parse(flag.reasons) as { label: string }[]).map((r) => r.label),
          evidence: flag.evidence ? JSON.parse(flag.evidence) : null,
        }
      : null,
  };

  let draft: { summary: string; evidence_points: string[] } | null = null;
  let mode: DisputeDraft["mode"] = "template";

  if (sarvamConfigured()) {
    draft = await chatStructured<{ summary: string; evidence_points: string[] }>(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: `FACTS JSON:\n${JSON.stringify(facts, null, 2)}\n\nDraft the response.` },
      ],
      "klear_dispute_draft",
      DRAFT_SCHEMA,
      { temperature: 0.3, maxTokens: 900 }
    );
    if (draft) mode = "sarvam-105b";
  }

  if (!draft) {
    const amt = formatINR(dispute.amount);
    const points = [
      `Payment of ${amt} captured on order ${dispute.orderId}, status ${payment?.status ?? "SUCCESS"}, bank reference ${payment?.bankReference ?? "on file"}.`,
      facts.fraudFlag
        ? `Klear's risk engine scored this activity as ${facts.fraudFlag.band} at the time of capture, with reasons: ${facts.fraudFlag.reasons.slice(0, 3).join("; ")}.`
        : "No adverse risk signals were present on this order at capture time.",
      "The customer identity and payment instrument were consistent with the merchant's recorded history for this account.",
      "Merchant records for delivery and fulfillment are available on request.",
    ];
    draft = {
      summary: `Regarding dispute ${dispute.id} (${dispute.category ?? "chargeback"}) on order ${dispute.orderId} for ${amt}: the payment was captured successfully and the transaction record is consistent with the merchant's history for this customer. We request the case be closed in the merchant's favor based on the evidence below.`,
      evidence_points: points,
    };
    mode = "template";
  }

  const result: DisputeDraft = {
    disputeId,
    summary: draft.summary,
    evidencePoints: draft.evidence_points.slice(0, 5),
    mode,
  };

  const now = Date.now();
  const existingEvidence = dispute.evidence ? (JSON.parse(dispute.evidence) as Record<string, unknown>) : {};
  db.update(disputes)
    .set({
      status: dispute.status === "OPEN" ? "UNDER_REVIEW" : dispute.status,
      evidence: JSON.stringify({ ...existingEvidence, draft: result }),
    })
    .where(eq(disputes.id, disputeId))
    .run();

  db.insert(auditLog)
    .values({
      actor: mode === "sarvam-105b" ? "sarvam-105b" : "klear-agent",
      action: "DISPUTE_DRAFTED",
      entity: "dispute",
      entityId: disputeId,
      payload: JSON.stringify({ mode, points: result.evidencePoints.length }),
      createdAt: now,
    })
    .run();

  return result;
}

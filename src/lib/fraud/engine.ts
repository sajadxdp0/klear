/**
 * Fraud sweep: score every payment, store flags, produce reasons.
 * The engine never blocks money by itself — it only informs. Recovery
 * consults the latest flag before proposing any action.
 *
 * Scoring pipeline:
 *   1. Individual assessment: features → deterministic rules → model score
 *   2. Burst attribution: when a velocity burst is detected, the WHOLE
 *      cluster is retroactively flagged — the burst is the evidence, not
 *      just the attempt that happened to cross the threshold.
 */
import { getDb } from "@/lib/db/client";
import { auditLog, fraudFlags, klearRuns, payments, refunds } from "@/lib/db/schema";
import {
  buildFeatures,
  type FeatureRow,
  type PaymentContextInput,
  type RefundContextInput,
} from "./features";
import { evaluateRules, rulesBoost, type RuleHit } from "./rules";
import { modelScore, modelArtifactStatus, type ModelResult } from "./model";

export type RiskBand = "OK" | "REVIEW" | "BLOCK";

/**
 * Bands are product knobs, not constants: a real product exposes its risk
 * appetite through configuration, and the audit trail shows what changed.
 */
export const BAND_THRESHOLDS = {
  REVIEW: Number(process.env.FRAUD_REVIEW_THRESHOLD ?? 0.5),
  BLOCK: Number(process.env.FRAUD_BLOCK_THRESHOLD ?? 0.75),
};

export interface FraudAssessment {
  paymentId: string;
  orderId: string;
  band: RiskBand;
  score: number;
  reasons: RuleHit[];
  features: FeatureRow;
  model: ModelResult;
}

function bandFor(score: number): RiskBand {
  if (score >= BAND_THRESHOLDS.BLOCK) return "BLOCK";
  if (score >= BAND_THRESHOLDS.REVIEW) return "REVIEW";
  return "OK";
}

/** Scores one payment given full history. Pure — used by sweep AND eval. */
export async function assessPayment(
  payment: PaymentContextInput,
  customerHistory: PaymentContextInput[],
  customerRefunds: RefundContextInput[]
): Promise<FraudAssessment> {
  const features = buildFeatures(payment, customerHistory, customerRefunds);
  const hits = evaluateRules({ features, amountPaise: payment.amount });
  const model = await modelScore(features);
  const score = Math.min(0.995, model.score + rulesBoost(hits));
  return {
    paymentId: payment.id,
    orderId: payment.orderId,
    band: bandFor(score),
    score,
    reasons: hits,
    features,
    model,
  };
}

const HOUR = 60 * 60 * 1000;

/**
 * Retroactive burst attribution: if ≥5 attempts by one customer fall inside
 * a rolling 1-hour window, every attempt in that window inherits the burst
 * evidence. This is how clusters get caught — not just the final attempt.
 */
export function applyBurstAttribution(
  flags: FraudAssessment[],
  ctx: PaymentContextInput[]
): FraudAssessment[] {
  const byCustomer = new Map<string, PaymentContextInput[]>();
  for (const p of ctx) {
    const list = byCustomer.get(p.customerId) ?? [];
    list.push(p);
    byCustomer.set(p.customerId, list);
  }
  for (const list of byCustomer.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt);
    let i = 0;
    for (let j = 0; j < list.length; j++) {
      while (list[j].createdAt - list[i].createdAt > HOUR) i++;
      const cluster = list.slice(i, j + 1);
      if (cluster.length >= 5) {
        const ids = new Set(cluster.map((p) => p.id));
        for (const f of flags) {
          if (!ids.has(f.paymentId)) continue;
          if (f.reasons.some((h) => h.code === "CLUSTER_BURST")) continue;
          f.reasons.push({
            code: "CLUSTER_BURST",
            label: `Part of a velocity burst: ${cluster.length} attempts by this customer within an hour`,
            contribution: 0.75,
          });
          f.score = Math.min(0.995, f.score + 0.75);
          f.band = bandFor(f.score);
        }
      }
    }
  }
  return flags;
}

/** Full scoring pass used by both the sweep and the eval harness. */
export async function assessAll(
  ctx: PaymentContextInput[],
  refundCtx: RefundContextInput[]
): Promise<FraudAssessment[]> {
  const byCustomer = new Map<string, PaymentContextInput[]>();
  for (const p of ctx) {
    const list = byCustomer.get(p.customerId) ?? [];
    list.push(p);
    byCustomer.set(p.customerId, list);
  }
  for (const list of byCustomer.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt);
  }

  const flags: FraudAssessment[] = [];
  for (const p of ctx) {
    flags.push(
      await assessPayment(
        p,
        byCustomer.get(p.customerId) ?? [p],
        refundCtx.filter((r) => r.customerId === p.customerId)
      )
    );
  }
  return applyBurstAttribution(flags, ctx);
}

export interface FraudSweepSummary {
  scored: number;
  ok: number;
  review: number;
  block: number;
  modelVersion: string;
  artifacts: ReturnType<typeof modelArtifactStatus>;
  flags: FraudAssessment[];
}

/** Scores all payments in the DB and persists flags. */
export async function runFraudSweep(): Promise<FraudSweepSummary> {
  const db = getDb();
  const paymentRows = await db.select().from(payments);
  const refundRows = await db.select().from(refunds);

  const ctx: PaymentContextInput[] = paymentRows.map((p) => ({
    id: p.id,
    customerId: p.customerName ?? p.id,
    orderId: p.orderId,
    amount: p.amount,
    status: p.status,
    method: p.method,
    createdAt: p.createdAt,
  }));

  const refundCtx: RefundContextInput[] = refundRows.map((r) => ({
    paymentId: r.paymentId ?? r.id,
    customerId:
      paymentRows.find((p) => p.id === r.paymentId)?.customerName ?? "unknown",
    createdAt: r.createdAt,
  }));

  const flags = await assessAll(ctx, refundCtx);

  const now = Date.now();
  db.delete(fraudFlags).run();
  if (flags.length > 0) {
    db.insert(fraudFlags)
      .values(
        flags.map((f) => ({
          paymentId: f.paymentId,
          orderId: f.orderId,
          riskBand: f.band,
          score: f.score,
          reasons: JSON.stringify(f.reasons),
          evidence: JSON.stringify({ model: f.model.version, features: f.features }),
          modelVersion: f.model.version,
          createdAt: now,
        }))
      )
      .run();
  }

  const summary: FraudSweepSummary = {
    scored: flags.length,
    ok: flags.filter((f) => f.band === "OK").length,
    review: flags.filter((f) => f.band === "REVIEW").length,
    block: flags.filter((f) => f.band === "BLOCK").length,
    modelVersion: flags[0]?.model.version ?? "none",
    artifacts: modelArtifactStatus(),
    flags,
  };

  db.insert(klearRuns)
    .values({
      kind: "FRAUD",
      summary: JSON.stringify({
        scored: summary.scored,
        ok: summary.ok,
        review: summary.review,
        block: summary.block,
        modelVersion: summary.modelVersion,
      }),
      createdAt: now,
    })
    .run();

  db.insert(auditLog)
    .values({
      actor: "klear-agent",
      action: "FRAUD_SWEEP",
      entity: "fraud",
      entityId: null,
      payload: JSON.stringify({
        scored: summary.scored,
        review: summary.review,
        block: summary.block,
        modelVersion: summary.modelVersion,
      }),
      createdAt: now,
    })
    .run();

  return summary;
}

/**
 * Deterministic fraud rules. Every hit contributes to the score and,
 * more importantly, becomes a plain-English reason the merchant can read.
 * Rules are auditable; the model only adjusts confidence.
 */

import type { FeatureRow } from "./features";
import { FEATURE_NAMES } from "./features";

export interface RuleHit {
  code: string;
  label: string;
  contribution: number;
}

export interface RuleInput {
  features: FeatureRow;
  amountPaise: number;
}

const F = (name: (typeof FEATURE_NAMES)[number], row: FeatureRow) =>
  row[FEATURE_NAMES.indexOf(name)];

export function evaluateRules({ features, amountPaise }: RuleInput): RuleHit[] {
  const hits: RuleHit[] = [];
  const rupees = amountPaise / 100;

  const txns1h = F("txns_last_1h", features);
  if (txns1h >= 4) {
    hits.push({
      code: "VELOCITY_BURST",
      label: `${txns1h + 1} payment attempts from this customer within an hour`,
      contribution: 0.75,
    });
  } else if (txns1h >= 2) {
    hits.push({
      code: "VELOCITY_WARM",
      label: `${txns1h + 1} payment attempts within an hour`,
      contribution: 0.2,
    });
  }

  const isNew = F("is_new_customer", features) === 1;
  const z = F("amount_z", features);
  if (isNew && rupees >= 50000) {
    hits.push({
      code: "NEW_HIGH_TICKET",
      label: `First-ever transaction is a high ticket (₹${Math.round(rupees).toLocaleString("en-IN")})`,
      contribution: 0.4,
    });
  }
  if (z >= 3) {
    hits.push({
      code: "AMOUNT_ANOMALY",
      label: `Amount is ${z.toFixed(1)}σ above this customer's usual spend`,
      contribution: 0.25,
    });
  }

  const refundRatio = F("refund_ratio", features);
  const priorCount = F("prior_count", features);
  if (refundRatio >= 0.5 && priorCount >= 5) {
    hits.push({
      code: "REFUND_ABUSE",
      label: `Refund ratio ${(refundRatio * 100).toFixed(0)}% across ${priorCount} lifetime transactions`,
      contribution: 0.5,
    });
  }

  const hour = F("hour_of_day", features);
  if (hour >= 0 && hour < 5) {
    hits.push({
      code: "ODD_HOUR",
      label: `Attempt at ${hour}:00 UTC — outside normal business hours`,
      contribution: 0.1,
    });
  }

  const methodRisk = F("method_risk", features);
  if (methodRisk >= 1.0 && rupees >= 20000) {
    hits.push({
      code: "RISKY_METHOD_HIGH_AMOUNT",
      label: `Card payment above ₹20,000`,
      contribution: 0.1,
    });
  }

  const attempts = F("attempts_on_order", features);
  if (attempts >= 3) {
    hits.push({
      code: "RETRY_CHURN",
      label: `${attempts} attempts against the same order`,
      contribution: 0.15,
    });
  }

  return hits;
}

/**
 * Rule contributions sum without an arbitrary cap — each contribution is
 * already conservative, and overwhelming evidence (e.g. a velocity burst)
 * must be decisive even without the model. The engine clamps the final
 * score to 0.995.
 */
export function rulesBoost(hits: RuleHit[]): number {
  return hits.reduce((s, h) => s + h.contribution, 0);
}

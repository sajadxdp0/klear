/**
 * Fraud feature builder.
 *
 * The feature contract below is shared by three consumers:
 *   1. runtime inference (this file)
 *   2. the synthetic dataset generator (scripts/gen-dataset.ts)
 *   3. the Python trainer (ml/train.py reads the CSV, never recomputes features)
 *
 * Changing FEATURE_NAMES means regenerating the dataset AND retraining.
 */

export const FEATURE_NAMES = [
  "amount_rupees",
  "hour_of_day",
  "txns_last_1h",
  "txns_last_24h",
  "is_new_customer",
  "amount_z",
  "refund_ratio",
  "method_risk",
  "attempts_on_order",
  "success_ratio",
  "prior_count",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureRow = number[]; // order === FEATURE_NAMES

export interface PaymentContextInput {
  id: string;
  customerId: string;
  orderId: string;
  amount: number; // paise
  status: string;
  method: string | null;
  createdAt: number;
}

export interface RefundContextInput {
  paymentId: string;
  customerId: string;
  createdAt: number;
}

export const METHOD_RISK: Record<string, number> = {
  upi: 0.35,
  wallet: 0.55,
  netbanking: 0.8,
  card: 1.0,
};

export function methodRisk(method: string | null): number {
  if (!method) return 0.5;
  return METHOD_RISK[method.toLowerCase()] ?? 0.5;
}

/**
 * Builds the feature row for one payment, given the full payment history
 * of the same customer (all statuses, sorted ascending by createdAt),
 * including the payment itself.
 */
export function buildFeatures(
  payment: PaymentContextInput,
  customerHistory: PaymentContextInput[], // ascending by createdAt, includes payment
  customerRefunds: RefundContextInput[]
): FeatureRow {
  const prior = customerHistory.filter((p) => p.createdAt < payment.createdAt);
  const t = payment.createdAt;

  const last1h = prior.filter((p) => t - p.createdAt <= 60 * 60 * 1000).length;
  const last24h = prior.filter((p) => t - p.createdAt <= 24 * 60 * 60 * 1000).length;

  const isNewCustomer = prior.length === 0 ? 1 : 0;

  // amount z-score vs the customer's own history (needs ≥3 prior txns)
  let amountZ = 0;
  if (prior.length >= 3) {
    const amounts = prior.map((p) => p.amount / 100);
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance =
      amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length;
    const std = Math.sqrt(variance);
    amountZ = std > 1e-9 ? (payment.amount / 100 - mean) / std : 0;
  }

  const refundsBefore = customerRefunds.filter((r) => r.createdAt <= t).length;
  const refundRatio =
    prior.length > 0 ? refundsBefore / prior.length : 0;

  const attemptsOnOrder = customerHistory.filter(
    (p) => p.orderId === payment.orderId && p.createdAt <= t
  ).length;

  const priorSuccess = prior.filter((p) => p.status === "SUCCESS").length;
  const successRatio = prior.length > 0 ? priorSuccess / prior.length : 0.5;

  return [
    payment.amount / 100,
    new Date(t).getUTCHours(),
    last1h,
    last24h,
    isNewCustomer,
    amountZ,
    refundRatio,
    methodRisk(payment.method),
    attemptsOnOrder,
    successRatio,
    prior.length,
  ];
}

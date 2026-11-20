/**
 * Klear recon engine — pure matching functions.
 *
 * Three legs of the money chain:
 *   ORDER_PAYMENT      order marked PAID ↔ SUCCESS payment exists, same amount
 *   PAYMENT_SETTLEMENT SUCCESS payment ↔ settlement (gross == payment, net == gross - fee)
 *   SETTLEMENT_BANK    settlement ↔ credit in the bank statement (exact UTR, or amount+window)
 *
 * Accuracy policy:
 *   - Amounts are compared in exact paise. No tolerance on money. Ever.
 *   - Fuzziness is allowed ONLY on time windows, and always marked with lower confidence
 *     plus the rule that fired. Every exception carries a human explanation.
 */

export type ReconStatus =
  | "MATCHED"
  | "PARTIAL"
  | "MISMATCH"
  | "MISSING"
  | "DUPLICATE";

export type ReconLeg =
  | "ORDER_PAYMENT"
  | "PAYMENT_SETTLEMENT"
  | "SETTLEMENT_BANK";

export interface MatchResult {
  leg: ReconLeg;
  leftRef: string;
  rightRef: string | null;
  status: ReconStatus;
  confidence: number;
  rule: string;
  amountDelta: number; // paise, signed (right − left)
  detail: string;
}

/* Minimal structural types so this module is pure and testable. */
export interface OrderLike {
  id: string;
  amount: number; // paise
  status: string; // ACTIVE | PAID | EXPIRED
  createdAt: number;
}
export interface PaymentLike {
  id: string;
  orderId: string;
  amount: number; // paise
  status: string; // SUCCESS | FAILED | PENDING
  bankReference?: string | null;
  failureReason?: string | null;
  createdAt: number;
}
export interface SettlementLike {
  id: string;
  paymentId?: string | null;
  orderId?: string | null;
  grossAmount: number; // paise
  fee: number; // paise
  netAmount: number; // paise
  utr?: string | null;
  settledAt: number;
}
export interface BankTxnLike {
  id: string;
  txnDate: number;
  amount: number; // paise, positive
  direction: string; // CREDIT | DEBIT
  utr?: string | null;
  narration?: string | null;
}

const DAY = 24 * 60 * 60 * 1000;

/* ── Leg 1: ORDER ↔ PAYMENT ──────────────────────────────────────────── */

export function matchOrderPayments(
  orders: OrderLike[],
  payments: PaymentLike[]
): MatchResult[] {
  const byOrder = new Map<string, PaymentLike[]>();
  for (const p of payments) {
    const list = byOrder.get(p.orderId) ?? [];
    list.push(p);
    byOrder.set(p.orderId, list);
  }

  const out: MatchResult[] = [];
  for (const o of orders) {
    const pays = byOrder.get(o.id) ?? [];
    const success = pays.filter((p) => p.status === "SUCCESS");
    const pending = pays.filter((p) => p.status === "PENDING");

    if (o.status === "PAID") {
      if (success.length === 0) {
        out.push({
          leg: "ORDER_PAYMENT",
          leftRef: o.id,
          rightRef: null,
          status: pending.length ? "PARTIAL" : "MISSING",
          confidence: pending.length ? 0.55 : 1.0,
          rule: pending.length
            ? "absent:success_payment(pending_exists)"
            : "absent:success_payment",
          amountDelta: -o.amount,
          detail: pending.length
            ? `Order marked PAID but payment still PENDING (${pending.map((p) => p.id).join(", ")}).`
            : `Order marked PAID but no SUCCESS payment found. ${o.amount} paise unaccounted.`,
        });
      } else {
        const [first, ...rest] = success;
        const delta = first.amount - o.amount;
        out.push({
          leg: "ORDER_PAYMENT",
          leftRef: o.id,
          rightRef: first.id,
          status: delta === 0 ? "MATCHED" : "MISMATCH",
          confidence: 1.0,
          rule: "exact:order_id+amount",
          amountDelta: delta,
          detail:
            delta === 0
              ? `SUCCESS payment ${first.id} matches order amount exactly.`
              : `Order amount and SUCCESS payment ${first.id} differ by ${delta} paise.`,
        });
        for (const dup of rest) {
          out.push({
            leg: "ORDER_PAYMENT",
            leftRef: o.id,
            rightRef: dup.id,
            status: "DUPLICATE",
            confidence: 1.0,
            rule: "multiple:success_payments",
            amountDelta: dup.amount,
            detail: `Multiple SUCCESS payments for one order: ${first.id} already matched; ${dup.id} is a duplicate capture.`,
          });
        }
      }
    } else if (o.status === "ACTIVE" && pending.length > 0) {
      out.push({
        leg: "ORDER_PAYMENT",
        leftRef: o.id,
        rightRef: pending[0].id,
        status: "PARTIAL",
        confidence: 0.5,
        rule: "status:in_flight",
        amountDelta: 0,
        detail: "Payment attempt in flight; nothing to reconcile yet.",
      });
    }
    // EXPIRED / ACTIVE-without-pending: recovery territory, not recon exceptions.
  }
  return out;
}

/* ── Leg 2: PAYMENT ↔ SETTLEMENT ────────────────────────────────────── */

export interface SettleOpts {
  now: number;
  horizonMs?: number; // default 26h — beyond this a SUCCESS must have settled
}

export function matchPaymentSettlements(
  payments: PaymentLike[],
  settlements: SettlementLike[],
  opts: SettleOpts
): MatchResult[] {
  const horizon = opts.horizonMs ?? 26 * 60 * 60 * 1000;
  const byPayment = new Map<string, SettlementLike[]>();
  for (const s of settlements) {
    if (!s.paymentId) continue;
    const list = byPayment.get(s.paymentId) ?? [];
    list.push(s);
    byPayment.set(s.paymentId, list);
  }

  const out: MatchResult[] = [];
  for (const p of payments) {
    if (p.status !== "SUCCESS") continue;
    const settles = byPayment.get(p.id) ?? [];

    if (settles.length === 0) {
      const past = opts.now - p.createdAt > horizon;
      out.push({
        leg: "PAYMENT_SETTLEMENT",
        leftRef: p.id,
        rightRef: null,
        status: past ? "MISSING" : "PARTIAL",
        confidence: past ? 1.0 : 0.55,
        rule: past
          ? "absent:settlement>26h"
          : "expected:T+1_in_flight",
        amountDelta: -p.amount,
        detail: past
          ? `SUCCESS payment is past the 26h settlement horizon with no settlement from the gateway.`
          : `Settlement expected within T+1; still in flight.`,
      });
      continue;
    }

    const [first, ...rest] = settles;
    const grossDelta = first.grossAmount - p.amount;
    const feeArithmeticOk = first.netAmount === first.grossAmount - first.fee;

    if (grossDelta !== 0) {
      out.push({
        leg: "PAYMENT_SETTLEMENT",
        leftRef: p.id,
        rightRef: first.id,
        status: "MISMATCH",
        confidence: 1.0,
        rule: "exact:payment_id+gross",
        amountDelta: grossDelta,
        detail: `Settlement gross differs from payment amount by ${grossDelta} paise.`,
      });
    } else if (!feeArithmeticOk) {
      out.push({
        leg: "PAYMENT_SETTLEMENT",
        leftRef: p.id,
        rightRef: first.id,
        status: "MISMATCH",
        confidence: 1.0,
        rule: "arithmetic:net≠gross−fee",
        amountDelta: first.netAmount - (first.grossAmount - first.fee),
        detail: `Settlement arithmetic broken: net (${first.netAmount}) ≠ gross (${first.grossAmount}) − fee (${first.fee}). Flag to gateway support.`,
      });
    } else {
      out.push({
        leg: "PAYMENT_SETTLEMENT",
        leftRef: p.id,
        rightRef: first.id,
        status: "MATCHED",
        confidence: 1.0,
        rule: "exact:payment_id+gross+fee",
        amountDelta: 0,
        detail: `Settlement gross matches the payment; fee arithmetic consistent.`,
      });
    }

    for (const dup of rest) {
      out.push({
        leg: "PAYMENT_SETTLEMENT",
        leftRef: p.id,
        rightRef: dup.id,
        status: "DUPLICATE",
        confidence: 1.0,
        rule: "multiple:settlements",
        amountDelta: dup.netAmount,
        detail: `Payment settled more than once — ${first.id} already matched, ${dup.id} is a duplicate settlement.`,
      });
    }
  }
  return out;
}

/* ── Leg 3: SETTLEMENT ↔ BANK ───────────────────────────────────────── */

export interface BankOpts {
  windowMs?: number; // default 2 days
}

export function matchSettlementBank(
  settlements: SettlementLike[],
  bankTxns: BankTxnLike[],
  opts: BankOpts = {}
): MatchResult[] {
  const window = opts.windowMs ?? 2 * DAY;

  // index bank credits by UTR
  const creditsByUtr = new Map<string, BankTxnLike[]>();
  for (const b of bankTxns) {
    if (b.direction !== "CREDIT" || !b.utr) continue;
    const list = creditsByUtr.get(b.utr) ?? [];
    list.push(b);
    creditsByUtr.set(b.utr, list);
  }

  const consumedBankIds = new Set<string>();
  const out: MatchResult[] = [];

  for (const s of settlements) {
    const byUtr = s.utr ? (creditsByUtr.get(s.utr) ?? []) : [];

    if (byUtr.length > 1) {
      // exact UTR matched more than one credit: first wins, rest are duplicates
      const [first, ...rest] = byUtr;
      consumedBankIds.add(first.id);
      const delta = first.amount - s.netAmount;
      out.push({
        leg: "SETTLEMENT_BANK",
        leftRef: s.id,
        rightRef: first.id,
        status: delta === 0 ? "MATCHED" : "MISMATCH",
        confidence: 1.0,
        rule: "exact:utr",
        amountDelta: delta,
        detail: `UTR ${s.utr} found in bank statement${delta !== 0 ? ` but credited ${delta} paise off` : ""}.`,
      });
      for (const dup of rest) {
        consumedBankIds.add(dup.id);
        out.push({
          leg: "SETTLEMENT_BANK",
          leftRef: s.id,
          rightRef: dup.id,
          status: "DUPLICATE",
          confidence: 1.0,
          rule: "duplicate:utr_in_bank",
          amountDelta: dup.amount,
          detail: `Bank statement contains ${byUtr.length} credits with the same UTR ${s.utr}. Possible double credit or statement regeneration.`,
        });
      }
      continue;
    }

    if (byUtr.length === 1) {
      const b = byUtr[0];
      consumedBankIds.add(b.id);
      const delta = b.amount - s.netAmount;
      out.push({
        leg: "SETTLEMENT_BANK",
        leftRef: s.id,
        rightRef: b.id,
        status: delta === 0 ? "MATCHED" : "MISMATCH",
        confidence: 1.0,
        rule: "exact:utr",
        amountDelta: delta,
        detail:
          delta === 0
            ? `Bank credit with UTR ${s.utr} matches settlement net exactly.`
            : `Bank credit with UTR ${s.utr} is ${delta} paise off from settlement net (${s.netAmount}).`,
      });
      continue;
    }

    // no exact UTR — fall back to amount + date window
    const candidates = bankTxns.filter(
      (b) =>
        b.direction === "CREDIT" &&
        b.amount === s.netAmount &&
        Math.abs(b.txnDate - s.settledAt) <= window
    );
    if (candidates.length === 1) {
      consumedBankIds.add(candidates[0].id);
      out.push({
        leg: "SETTLEMENT_BANK",
        leftRef: s.id,
        rightRef: candidates[0].id,
        status: "MATCHED",
        confidence: 0.85,
        rule: "window:amount±2d",
        amountDelta: 0,
        detail: `No UTR match, but exactly one bank credit of the same amount within 2 days (txn ${candidates[0].id}). Manual confirmation recommended.`,
      });
    } else if (candidates.length > 1) {
      out.push({
        leg: "SETTLEMENT_BANK",
        leftRef: s.id,
        rightRef: null,
        status: "PARTIAL",
        confidence: 0.4,
        rule: "window:amount±2d:multiple",
        amountDelta: 0,
        detail: `${candidates.length} bank credits of the same amount within 2 days; cannot auto-match without UTR. Needs human pick.`,
      });
    } else {
      out.push({
        leg: "SETTLEMENT_BANK",
        leftRef: s.id,
        rightRef: null,
        status: "MISSING",
        confidence: 1.0,
        rule: "absent:bank_credit",
        amountDelta: -s.netAmount,
        detail: `Settlement never landed in the bank: no credit with UTR ${s.utr ?? "(none)"} and no amount match within 2 days.`,
      });
    }
  }

  // orphan credits: money in the bank with no settlement claiming it
  for (const b of bankTxns) {
    if (b.direction !== "CREDIT" || consumedBankIds.has(b.id)) continue;
    // ignore credits consumed by exact-UTR legs already handled above
    out.push({
      leg: "SETTLEMENT_BANK",
      leftRef: `bank:${b.id}`,
      rightRef: null,
      status: "MISSING",
      confidence: 1.0,
      rule: "orphan:bank_credit",
      amountDelta: b.amount,
      detail: `Bank credit of ${b.amount} paise (UTR ${b.utr ?? "none"}) has no matching settlement. Interest, external rail, or unmapped income — needs human review.`,
    });
  }

  return out;
}

/* ── Full chain + Klear Score ─────────────────────────────────────────── */

export interface ReconSummary {
  legs: Record<
    ReconLeg,
    { MATCHED: number; PARTIAL: number; MISMATCH: number; MISSING: number; DUPLICATE: number }
  >;
  orderValuePaise: number; // sum of PAID order amounts
  clearedValuePaise: number; // money with a fully MATCHED chain
  inFlightValuePaise: number; // chain interrupted only by in-flight PARTIALs
  atRiskValuePaise: number; // interrupted by exceptions (MISMATCH/MISSING/DUPLICATE)
  klearScore: number; // cleared / orderValue, 0..1
  counts: { orders: number; payments: number; settlements: number; bankTxns: number };
  exceptions: number; // MISMATCH + MISSING + DUPLICATE rows
  results: MatchResult[];
}

function emptyLeg() {
  return { MATCHED: 0, PARTIAL: 0, MISMATCH: 0, MISSING: 0, DUPLICATE: 0 };
}

/**
 * Chains the three legs per order and computes the Klear Score:
 * money is "cleared" only when order→payment→settlement→bank are all MATCHED.
 */
export function summarizeRecon(
  orders: OrderLike[],
  payments: PaymentLike[],
  results: MatchResult[]
): ReconSummary {
  const legs: ReconSummary["legs"] = {
    ORDER_PAYMENT: emptyLeg(),
    PAYMENT_SETTLEMENT: emptyLeg(),
    SETTLEMENT_BANK: emptyLeg(),
  };
  for (const r of results) {
    legs[r.leg][r.status] += 1;
  }

  // index results by reference for chain-walking
  const byOrder = new Map<string, MatchResult[]>();
  const byPayment = new Map<string, MatchResult[]>();
  const bySettlement = new Map<string, MatchResult[]>();
  for (const r of results) {
    if (r.leg === "ORDER_PAYMENT") {
      const list = byOrder.get(r.leftRef) ?? [];
      list.push(r);
      byOrder.set(r.leftRef, list);
    } else if (r.leg === "PAYMENT_SETTLEMENT") {
      const list = byPayment.get(r.leftRef) ?? [];
      list.push(r);
      byPayment.set(r.leftRef, list);
    } else if (r.leg === "SETTLEMENT_BANK" && !r.leftRef.startsWith("bank:")) {
      const list = bySettlement.get(r.leftRef) ?? [];
      list.push(r);
      bySettlement.set(r.leftRef, list);
    }
  }

  const paid = orders.filter((o) => o.status === "PAID");
  const paymentById = new Map(payments.map((p) => [p.id, p]));

  let cleared = 0;
  let inFlight = 0;
  let atRisk = 0;

  for (const o of paid) {
    const op = byOrder.get(o.id)?.find((r) => r.status === "MATCHED");
    if (!op?.rightRef) {
      atRisk += o.amount;
      continue;
    }
    const payment = paymentById.get(op.rightRef);
    const ps = payment
      ? byPayment.get(payment.id)?.find((r) => r.status === "MATCHED")
      : undefined;
    if (!ps?.rightRef) {
      // payment matched but settlement not (yet)
      const partialPs = payment
        ? byPayment.get(payment.id)?.some((r) => r.status === "PARTIAL")
        : false;
      if (partialPs) inFlight += o.amount;
      else atRisk += o.amount;
      continue;
    }
    const sb = bySettlement
      .get(ps.rightRef)
      ?.find((r) => r.status === "MATCHED");
    if (!sb?.rightRef) {
      atRisk += o.amount;
      continue;
    }
    cleared += o.amount; // full chain MATCHED — money cleared ✅
  }

  const orderValue = paid.reduce((s, o) => s + o.amount, 0);
  return {
    legs,
    orderValuePaise: orderValue,
    clearedValuePaise: cleared,
    inFlightValuePaise: inFlight,
    atRiskValuePaise: atRisk,
    klearScore: orderValue === 0 ? 1 : cleared / orderValue,
    counts: {
      orders: orders.length,
      payments: payments.length,
      settlements: results.filter((r) => r.leg === "SETTLEMENT_BANK" && !r.leftRef.startsWith("bank:")).length,
      bankTxns: results.length, // informational; recomputed by caller if needed
    },
    exceptions: results.filter(
      (r) =>
        r.status === "MISMATCH" || r.status === "MISSING" || r.status === "DUPLICATE"
    ).length,
    results,
  };
}

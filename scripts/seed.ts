/**
 * Klear demo seed — deterministic (seeded RNG), rebuilds a realistic
 * merchant day: "Sunrise Organics", a D2C grocery brand in Bengaluru.
 *
 * Generates clean money chains plus PLANTED exceptions (recon) and PLANTED
 * fraud cases (labeled), and writes artifacts/seed-truth.json — the ground
 * truth that eval/run.ts verifies against.
 *
 * Run: npm run db:seed
 */
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/lib/db/client";
import {
  auditLog,
  bankTxns,
  orders,
  payments,
  reconMatches,
  refunds,
  fraudFlags,
  recoveryActions,
  settlements,
  klearRuns,
} from "../src/lib/db/schema";

/* ── Deterministic RNG ────────────────────────────────────────────────── */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261121);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo));

const now = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

let seq = 1000;
const uid = (prefix: string) => `${prefix}_KLR${(seq++).toString(36)}${Math.floor(rand() * 1296).toString(36).padStart(2, "0")}`;
const utr = () => `UTR${between(100000, 999999)}${between(100000, 999999)}`;

/* ── Cast ────────────────────────────────────────────────────────────── */
const CUSTOMERS = [
  "Priya Sharma", "Arjun Mehta", "Vikram Nair", "Sneha Kulkarni",
  "Rohit Gupta", "Ananya Iyer", "Imran Sheikh", "Divya Reddy",
  "Karthik Subramanian", "Meera Joshi", "Aditya Rao", "Kavya Menon",
  "Nikhil Bansal", "Riya Chatterjee", "Amit Trivedi", "Pooja Desai",
  "Sanjay Pillai", "Neha Khandelwal", "Rajat Bhatt", "Ishita Bose",
  "Manish Agarwal", "Shreya Ghosh", "Deepak Chauhan", "Lakshmi Iyengar",
  "Omkar Patil", "Tanvi Saxena", "Yusuf Ali", "Ritika Malhotra",
];

const METHODS = ["upi", "upi", "upi", "card", "card", "netbanking", "wallet"];
const FEE_RATE: Record<string, number> = {
  upi: 0.004,
  netbanking: 0.009,
  wallet: 0.009,
  card: 0.019,
};
const feeFor = (method: string, amount: number) =>
  method === "card"
    ? Math.round(amount * 0.019) + 300
    : Math.round(amount * (FEE_RATE[method] ?? 0.004));

const FAILURES = [
  { reason: "bank_timeout", error: "Bank did not respond within threshold" },
  { reason: "insufficient_funds", error: "Customer account has insufficient balance" },
  { reason: "invalid_vpa", error: "UPI VPA is invalid or unreachable" },
  { reason: "card_auth_declined", error: "Card authorisation declined by issuer" },
  { reason: "risk_hold", error: "Held by gateway risk engine (manual review)" },
  { reason: "customer_abandoned", error: "Customer dropped off before completing OTP" },
];

/* ── Rows ────────────────────────────────────────────────────────────── */
type OrderRow = typeof orders.$inferInsert;
type PaymentRow = typeof payments.$inferInsert;
type SettlementRow = typeof settlements.$inferInsert;
type BankRow = typeof bankTxns.$inferInsert;
type RefundRow = typeof refunds.$inferInsert;

const orderRows: OrderRow[] = [];
const paymentRows: PaymentRow[] = [];
const settlementRows: SettlementRow[] = [];
const bankRows: BankRow[] = [];
const refundRows: RefundRow[] = [];

interface Chain {
  orderId: string;
  payId: string;
  setId: string;
  utr: string;
  amount: number;
  customer: string;
  createdAt: number;
}

/** A fully clean money chain: order → SUCCESS payment → settlement → bank credit. */
function cleanChain(customer: string, createdAt: number, amount: number, method: string) {
  const orderId = uid("order");
  const payId = uid("pay");
  const setId = uid("set");
  const u = utr();
  const fee = feeFor(method, amount);
  const settledAt = createdAt + between(2, 5) * HOUR;

  orderRows.push({
    id: orderId, amount, status: "PAID", customerName: customer,
    customerPhone: `+9${between(600000000, 999999999)}`,
    customerEmail: `${customer.split(" ")[0].toLowerCase()}@gmail.com`,
    createdAt, raw: null,
  });
  paymentRows.push({
    id: payId, orderId, amount, status: "SUCCESS", method,
    bankReference: u, customerName: customer, createdAt, raw: null,
  });
  settlementRows.push({
    id: setId, paymentId: payId, orderId, grossAmount: amount,
    fee, netAmount: amount - fee, utr: u, settledAt, raw: null,
  });
  bankRows.push({
    id: uid("btx"), txnDate: settledAt + between(0, 30) * MIN,
    amount: amount - fee, direction: "CREDIT", utr: u,
    narration: `UPI/CR/${u.slice(3)}/SUNRISE ORG`, source: "BANK_STATEMENT", raw: null,
  });
  return { orderId, payId, setId, utr: u, amount, customer, createdAt } satisfies Chain;
}

/* 1) ~36 clean chains over the last 30 hours */
for (let i = 0; i < 36; i++) {
  cleanChain(
    pick(CUSTOMERS),
    now - between(1, 30) * HOUR,
    between(45000, 450000), // ₹450 – ₹4,500 grocery carts
    pick(METHODS)
  );
}

/* 2) A loyal whale — must NOT be flagged (false-positive control) */
const whale = cleanChain("Priya Sharma", now - 3 * HOUR, 7500000 /* ₹75,000 */, "upi");
// give Priya a long normal history so z-score and "new customer" don't fire
for (let i = 0; i < 12; i++) {
  cleanChain("Priya Sharma", now - between(24, 200) * HOUR, between(30000, 300000), "upi");
}

/* ── Planted recon exceptions (ground truth E1–E9) ────────────────────── */
const truth: {
  recon: { leg: string; leftRef: string; expected: string; note: string }[];
  fraud: {
    paymentId: string;
    expectedBand: string;
    expectedBandNoModel?: string;
    note: string;
  }[];
} = { recon: [], fraud: [] };
const recon = (leg: string, leftRef: string, expected: string, note: string) =>
  truth.recon.push({ leg, leftRef, expected, note });

/* E1: order marked PAID, but no SUCCESS payment at all (MISSING leg 1) */
{
  const orderId = uid("order");
  orderRows.push({
    id: orderId, amount: 234500, status: "PAID", customerName: "Aditya Rao",
    customerPhone: "+91987654321", customerEmail: "aditya@gmail.com",
    createdAt: now - 6 * HOUR, raw: null,
  });
  paymentRows.push({
    id: uid("pay"), orderId, amount: 234500, status: "FAILED", method: "upi",
    failureReason: "bank_timeout", errorMessage: "Bank did not respond within threshold",
    customerName: "Aditya Rao", createdAt: now - 6 * HOUR, raw: null,
  });
  recon("ORDER_PAYMENT", orderId, "MISSING", "E1: PAID order without SUCCESS payment");
}

/* E2: order/pay amount off by exactly 1 rupee (MISMATCH leg 1) */
{
  const orderId = uid("order");
  const payId = uid("pay");
  orderRows.push({
    id: orderId, amount: 500000, status: "PAID", customerName: "Kavya Menon",
    customerPhone: "+919812345678", customerEmail: "kavya@gmail.com",
    createdAt: now - 8 * HOUR, raw: null,
  });
  paymentRows.push({
    id: payId, orderId, amount: 499900, status: "SUCCESS", method: "upi",
    bankReference: utr(), customerName: "Kavya Menon", createdAt: now - 8 * HOUR, raw: null,
  });
  recon("ORDER_PAYMENT", orderId, "MISMATCH", "E2: payment ₹1 short of order amount");
}

/* E3: SUCCESS payment past 26h horizon, never settled (MISSING leg 2) */
{
  const orderId = uid("order");
  const payId = uid("pay");
  orderRows.push({
    id: orderId, amount: 189000, status: "PAID", customerName: "Nikhil Bansal",
    customerPhone: "+919834561230", customerEmail: "nikhil@gmail.com",
    createdAt: now - 30 * HOUR, raw: null,
  });
  paymentRows.push({
    id: payId, orderId, amount: 189000, status: "SUCCESS", method: "netbanking",
    bankReference: utr(), customerName: "Nikhil Bansal", createdAt: now - 30 * HOUR, raw: null,
  });
  recon("PAYMENT_SETTLEMENT", payId, "MISSING", "E3: SUCCESS >26h with no settlement");
}

/* E4: settlement with broken fee arithmetic (MISMATCH leg 2) */
{
  const orderId = uid("order");
  const payId = uid("pay");
  const setId = uid("set");
  orderRows.push({
    id: orderId, amount: 320000, status: "PAID", customerName: "Riya Chatterjee",
    customerPhone: "+919845678912", customerEmail: "riya@gmail.com",
    createdAt: now - 10 * HOUR, raw: null,
  });
  paymentRows.push({
    id: payId, orderId, amount: 320000, status: "SUCCESS", method: "card",
    bankReference: utr(), customerName: "Riya Chatterjee", createdAt: now - 10 * HOUR, raw: null,
  });
  const fee = feeFor("card", 320000);
  settlementRows.push({
    id: setId, paymentId: payId, orderId, grossAmount: 320000,
    fee, netAmount: 320000 - fee - 2500, // 25 rupees "lost"
    utr: utr(), settledAt: now - 8 * HOUR, raw: null,
  });
  recon("PAYMENT_SETTLEMENT", payId, "MISMATCH", "E4: net ≠ gross − fee");
}

/* E5: bank credit short by ₹5 vs settlement net (MISMATCH leg 3) */
{
  const c = cleanChain("Amit Trivedi", now - 12 * HOUR, 275000, "upi");
  const shortBank = bankRows.find(
    (b) => b.utr === c.utr
  )!;
  shortBank.amount -= 500;
  recon("SETTLEMENT_BANK", c.setId, "MISMATCH", "E5: bank credit ₹5 short");
}

/* E6: settlement never landed in bank (MISSING leg 3) */
{
  const orderId = uid("order");
  const payId = uid("pay");
  const setId = uid("set");
  const u = utr();
  orderRows.push({
    id: orderId, amount: 98000, status: "PAID", customerName: "Pooja Desai",
    customerPhone: "+919856123478", customerEmail: "pooja@gmail.com",
    createdAt: now - 14 * HOUR, raw: null,
  });
  paymentRows.push({
    id: payId, orderId, amount: 98000, status: "SUCCESS", method: "upi",
    bankReference: u, customerName: "Pooja Desai", createdAt: now - 14 * HOUR, raw: null,
  });
  settlementRows.push({
    id: setId, paymentId: payId, orderId, grossAmount: 98000,
    fee: 392, netAmount: 98000 - 392, utr: u, settledAt: now - 11 * HOUR, raw: null,
  });
  recon("SETTLEMENT_BANK", setId, "MISSING", "E6: settlement missing from bank");
}

/* E7: orphan bank credit — money in statement, no settlement claims it */
{
  bankRows.push({
    id: uid("btx"), txnDate: now - 20 * HOUR, amount: 64000,
    direction: "CREDIT", utr: utr(),
    narration: "NEFT/CR/SUPPLIER REFUND ABC TRADERS", source: "BANK_STATEMENT", raw: null,
  });
}

/* E8: duplicate UTR in bank statement (DUPLICATE leg 3) */
{
  const c = cleanChain("Sanjay Pillai", now - 9 * HOUR, 156000, "upi");
  bankRows.push({
    id: uid("btx"), txnDate: now - 9 * HOUR + 40 * MIN,
    amount: c.amount - feeFor("upi", c.amount), direction: "CREDIT",
    utr: c.utr, narration: `UPI/CR/${c.utr.slice(3)}/SUNRISE ORG (REGEN)`,
    source: "BANK_STATEMENT", raw: null,
  });
  recon("SETTLEMENT_BANK", c.setId, "DUPLICATE", "E8: same UTR credited twice in statement");
}

/* E9: payment settled twice (DUPLICATE leg 2) */
{
  const c = cleanChain("Neha Khandelwal", now - 16 * HOUR, 420000, "card");
  settlementRows.push({
    id: uid("set"), paymentId: c.payId, orderId: c.orderId,
    grossAmount: 420000, fee: feeFor("card", 420000),
    netAmount: 420000 - feeFor("card", 420000),
    utr: utr(), settledAt: now - 14 * HOUR, raw: null,
  });
  recon("PAYMENT_SETTLEMENT", c.payId, "DUPLICATE", "E9: duplicate settlement for one payment");
}

/* A couple of supplier debit rows for realism */
for (let i = 0; i < 3; i++) {
  bankRows.push({
    id: uid("btx"), txnDate: now - between(2, 26) * HOUR,
    amount: between(50000, 400000), direction: "DEBIT", utr: utr(),
    narration: "NEFT/DR/FARM SUPPLY COOP", source: "BANK_STATEMENT", raw: null,
  });
}

/* ── Failed payments: recovery candidates ─────────────────────────────── */
const failedNote: { orderId: string; reason: string }[] = [];
for (let i = 0; i < 12; i++) {
  const f = FAILURES[i % FAILURES.length];
  const orderId = uid("order");
  const amount = between(45000, 350000);
  const customer = pick(CUSTOMERS);
  orderRows.push({
    id: orderId, amount, status: "ACTIVE", customerName: customer,
    customerPhone: `+9${between(600000000, 999999999)}`,
    customerEmail: `${customer.split(" ")[0].toLowerCase()}@gmail.com`,
    createdAt: now - between(1, 20) * HOUR, raw: null,
  });
  const attempts = f.reason === "bank_timeout" ? 2 : 1; // retry churn on timeouts
  for (let a = 0; a < attempts; a++) {
    paymentRows.push({
      id: uid("pay"), orderId, amount, status: "FAILED", method: pick(METHODS),
      failureReason: f.reason, errorMessage: f.error,
      customerName: customer, createdAt: now - between(1, 20) * HOUR - a * 15 * MIN, raw: null,
    });
  }
  failedNote.push({ orderId, reason: f.reason });
}

/* ── Planted fraud cases (labeled) ───────────────────────────────────── */

/* F1: velocity burst — 5 rapid attempts → BLOCK */
{
  const customer = "Farhan Khan";
  const burstIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const orderId = uid("order");
    const payId = uid("pay");
    const t = now - 3 * HOUR + i * 3 * MIN;
    orderRows.push({
      id: orderId, amount: 950000, status: "ACTIVE", customerName: customer,
      customerPhone: "+919812340098", customerEmail: "farhan@gmail.com",
      createdAt: t, raw: null,
    });
    const p: PaymentRow = {
      id: payId, orderId, amount: 950000, status: "SUCCESS", method: "card",
      bankReference: i === 4 ? utr() : null, customerName: customer, createdAt: t, raw: null,
    };
    paymentRows.push(p);
    burstIds.push(payId);
  }
  // only the last attempt succeeds and settles
  const last = paymentRows.find((p) => p.id === burstIds[4])!;
  settlementRows.push({
    id: uid("set"), paymentId: last.id, orderId: last.orderId,
    grossAmount: 950000, fee: feeFor("card", 950000),
    netAmount: 950000 - feeFor("card", 950000), utr: utr(),
    settledAt: now - 2 * HOUR, raw: null,
  });
  for (const pid of burstIds) {
    truth.fraud.push({
      paymentId: pid,
      expectedBand: "BLOCK",
      expectedBandNoModel: "BLOCK",
      note: "F1: velocity burst ₹9.5K×5",
    });
  }
}

/* F2: brand-new customer, ₹89,000 card → REVIEW */
{
  const orderId = uid("order");
  const payId = uid("pay");
  orderRows.push({
    id: orderId, amount: 8900000, status: "ACTIVE", customerName: "Zoya Merchant",
    customerPhone: "+919899887766", customerEmail: "zoya@outlook.com",
    createdAt: now - 2 * HOUR, raw: null,
  });
  paymentRows.push({
    id: payId, orderId, amount: 8900000, status: "SUCCESS", method: "card",
    bankReference: utr(), customerName: "Zoya Merchant", createdAt: now - 2 * HOUR, raw: null,
  });
  truth.fraud.push({
    paymentId: payId,
    expectedBand: "BLOCK",
    expectedBandNoModel: "REVIEW",
    note: "F2: new customer high ticket ₹89K card — model escalates, rules floor at REVIEW",
  });
}

/* F3: refund abuser coming back → REVIEW */
{
  const customer = "Rahul Bhatt";
  // 6 old payments, 4 of them refunded, spread over past days
  for (let i = 0; i < 6; i++) {
    const t = now - between(48, 400) * HOUR;
    const c = cleanChain(customer, t, between(20000, 120000), "upi");
    if (i < 4) {
      refundRows.push({
        id: uid("refund"), orderId: c.orderId, paymentId: c.payId,
        amount: c.amount, status: "PROCESSED", createdAt: t + 3 * HOUR, raw: null,
      });
    }
  }
  const orderId = uid("order");
  const payId = uid("pay");
  const f3Amount = between(60000, 90000); // within his usual ₹200–1,200 spend
  orderRows.push({
    id: orderId, amount: f3Amount, status: "ACTIVE", customerName: customer,
    customerPhone: "+919822334455", customerEmail: "rahul@gmail.com",
    createdAt: now - 1 * HOUR, raw: null,
  });
  paymentRows.push({
    id: payId, orderId, amount: f3Amount, status: "SUCCESS", method: "upi",
    bankReference: utr(), customerName: customer, createdAt: now - 1 * HOUR, raw: null,
  });
  truth.fraud.push({
    paymentId: payId,
    expectedBand: "REVIEW",
    expectedBandNoModel: "REVIEW",
    note: "F3: refund abuser, 4 refunds over 6 txns — human-judgment lane, never model-BLOCK",
  });
}

/* F4: the loyal whale — must stay OK (false-positive control) */
truth.fraud.push({
  paymentId: whale.payId,
  expectedBand: "OK",
  expectedBandNoModel: "OK",
  note: "F4: loyal whale ₹75K — must NOT flag in any mode",
});

/* ── A few PENDING payments (in flight) ──────────────────────────────── */
for (let i = 0; i < 3; i++) {
  const orderId = uid("order");
  orderRows.push({
    id: orderId, amount: between(60000, 200000), status: "ACTIVE",
    customerName: pick(CUSTOMERS), customerPhone: `+9${between(600000000, 999999999)}`,
    customerEmail: "walkin@gmail.com", createdAt: now - between(10, 50) * MIN, raw: null,
  });
  paymentRows.push({
    id: uid("pay"), orderId, amount: between(60000, 200000), status: "PENDING",
    method: "upi", customerName: pick(CUSTOMERS), createdAt: now - between(5, 40) * MIN, raw: null,
  });
}

/* ── Persist ─────────────────────────────────────────────────────────── */
const db = getDb();
const wipe = (t: Parameters<typeof db.delete>[0]) => db.delete(t).run();
wipe(orders); wipe(payments); wipe(settlements);
wipe(bankTxns); wipe(refunds); wipe(reconMatches);
wipe(fraudFlags); wipe(recoveryActions); wipe(klearRuns);

db.insert(orders).values(orderRows).run();
db.insert(payments).values(paymentRows).run();
db.insert(settlements).values(settlementRows).run();
// NOTE: bank_txns are NOT inserted — the statement is exported as an artifact
// (CSV + PDF) so the live demo performs the real ingest: upload → parse →
// three-way match. The eval harness ingests the CSV before matching.
db.insert(refunds).values(refundRows).run();

const csvLines = ["date,amount_paise,direction,utr,narration"];
for (const b of bankRows) {
  csvLines.push(
    [
      new Date(b.txnDate!).toISOString(),
      b.amount!,
      b.direction!,
      b.utr ?? "",
      (b.narration ?? "").replace(/,/g, " "),
    ].join(",")
  );
}
fs.writeFileSync(
  path.join(process.cwd(), "artifacts", "demo-bank-statement.csv"),
  csvLines.join("\n") + "\n"
);

db.insert(auditLog).values({
  actor: "seed",
  action: "SEED_RUN",
  entity: "db",
  entityId: null,
  payload: JSON.stringify({
    orders: orderRows.length,
    payments: paymentRows.length,
    settlements: settlementRows.length,
    bankTxns: bankRows.length,
    refunds: refundRows.length,
  }),
  createdAt: now,
}).run();

fs.mkdirSync(path.join(process.cwd(), "artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(process.cwd(), "artifacts", "seed-truth.json"),
  JSON.stringify(truth, null, 2)
);

console.log("✓ Klear seed complete");
console.log(`  orders        ${orderRows.length}`);
console.log(`  payments      ${paymentRows.length}`);
console.log(`  settlements   ${settlementRows.length}`);
console.log(`  refunds       ${refundRows.length}`);
console.log(`  bank txns     ${bankRows.length} (exported as artifacts/demo-bank-statement.csv — NOT ingested)`);
console.log(`  recon truths  ${truth.recon.length}`);
console.log(`  fraud truths  ${truth.fraud.length}`);
console.log("  ground truth  artifacts/seed-truth.json");

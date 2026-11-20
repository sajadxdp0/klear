import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

/**
 * Klear schema.
 * Money is stored in paise (integers) everywhere. Never floats.
 * Timestamps are unix ms (integers).
 */

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(), // cf_order_id
  amount: integer("amount").notNull(), // paise
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull(), // ACTIVE | PAID | EXPIRED
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  createdAt: integer("created_at").notNull(),
  raw: text("raw"), // original Cashfree payload
});

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(), // cf_payment_id
  orderId: text("order_id").notNull(),
  amount: integer("amount").notNull(), // paise
  status: text("status").notNull(), // SUCCESS | FAILED | PENDING | CANCELLED
  method: text("method"), // upi | card | netbanking | wallet
  bankReference: text("bank_reference"), // UTR
  failureReason: text("failure_reason"),
  errorMessage: text("error_message"),
  customerName: text("customer_name"),
  createdAt: integer("created_at").notNull(),
  raw: text("raw"),
});

export const refunds = sqliteTable("refunds", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  paymentId: text("payment_id"),
  amount: integer("amount").notNull(),
  status: text("status").notNull(), // PROCESSED | PENDING | FAILED
  createdAt: integer("created_at").notNull(),
  raw: text("raw"),
});

export const settlements = sqliteTable("settlements", {
  id: text("id").primaryKey(),
  paymentId: text("payment_id"),
  orderId: text("order_id"),
  grossAmount: integer("gross_amount").notNull(), // paise
  fee: integer("fee").notNull().default(0), // paise
  netAmount: integer("net_amount").notNull(), // paise
  utr: text("utr"),
  settledAt: integer("settled_at").notNull(),
  raw: text("raw"),
});

export const bankTxns = sqliteTable("bank_txns", {
  id: text("id").primaryKey(),
  txnDate: integer("txn_date").notNull(), // unix ms
  amount: integer("amount").notNull(), // paise, always positive
  direction: text("direction").notNull(), // CREDIT | DEBIT
  utr: text("utr"),
  narration: text("narration"),
  source: text("source").notNull().default("BANK_STATEMENT"), // BANK_STATEMENT | SARVAM_DOC_AI
  raw: text("raw"),
});

export const reconMatches = sqliteTable("recon_matches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leg: text("leg").notNull(), // ORDER_PAYMENT | PAYMENT_SETTLEMENT | SETTLEMENT_BANK
  leftRef: text("left_ref").notNull(),
  rightRef: text("right_ref"),
  status: text("status").notNull(), // MATCHED | PARTIAL | MISMATCH | MISSING | DUPLICATE
  confidence: real("confidence").notNull(),
  rule: text("rule").notNull(), // e.g. "exact:order_id", "exact:utr", "window:amount±2d"
  amountDelta: integer("amount_delta").notNull().default(0), // paise
  detail: text("detail"), // human-readable explanation
  resolved: integer("resolved").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const fraudFlags = sqliteTable("fraud_flags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  paymentId: text("payment_id"),
  orderId: text("order_id").notNull(),
  riskBand: text("risk_band").notNull(), // OK | REVIEW | BLOCK
  score: real("score").notNull(), // calibrated 0..1
  reasons: text("reasons").notNull(), // json: [{code, label, contribution}]
  evidence: text("evidence"), // json: links to evidence pack
  modelVersion: text("model_version").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const recoveryActions = sqliteTable("recovery_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  paymentId: text("payment_id").notNull(),
  orderId: text("order_id").notNull(),
  failureReason: text("failure_reason"),
  actionType: text("action_type").notNull(), // RETRY | PAYMENT_LINK | UPI_COLLECT | DUNNING | GIVE_UP
  rationale: text("rationale").notNull(),
  status: text("status").notNull(), // PROPOSED | APPROVED | REJECTED | EXECUTED | FAILED
  proposedBy: text("proposed_by").notNull().default("klear-agent"),
  approvedBy: text("approved_by"),
  approvedAt: integer("approved_at"),
  executedAt: integer("executed_at"),
  result: text("result"), // json of execution outcome
  createdAt: integer("created_at").notNull(),
});

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actor: text("actor").notNull(), // "klear-agent" | "human:<name>" | "copilot"
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  payload: text("payload"), // json
  createdAt: integer("created_at").notNull(),
});

export const klearRuns = sqliteTable("klear_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // RECON | FRAUD | EVAL
  summary: text("summary").notNull(), // json
  createdAt: integer("created_at").notNull(),
});

/**
 * Creates tables if they do not exist. Idempotent.
 * Run: npm run db:init
 */
import { getSqlite } from "../src/lib/db/client";

const DDL = [
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL,
    customer_name TEXT,
    customer_phone TEXT,
    customer_email TEXT,
    created_at INTEGER NOT NULL,
    raw TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    method TEXT,
    bank_reference TEXT,
    failure_reason TEXT,
    error_message TEXT,
    customer_name TEXT,
    created_at INTEGER NOT NULL,
    raw TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    payment_id TEXT,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    raw TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    payment_id TEXT,
    order_id TEXT,
    gross_amount INTEGER NOT NULL,
    fee INTEGER NOT NULL DEFAULT 0,
    net_amount INTEGER NOT NULL,
    utr TEXT,
    settled_at INTEGER NOT NULL,
    raw TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS bank_txns (
    id TEXT PRIMARY KEY,
    txn_date INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    direction TEXT NOT NULL,
    utr TEXT,
    narration TEXT,
    source TEXT NOT NULL DEFAULT 'BANK_STATEMENT',
    raw TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS recon_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leg TEXT NOT NULL,
    left_ref TEXT NOT NULL,
    right_ref TEXT,
    status TEXT NOT NULL,
    confidence REAL NOT NULL,
    rule TEXT NOT NULL,
    amount_delta INTEGER NOT NULL DEFAULT 0,
    detail TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fraud_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id TEXT,
    order_id TEXT NOT NULL,
    risk_band TEXT NOT NULL,
    score REAL NOT NULL,
    reasons TEXT NOT NULL,
    evidence TEXT,
    model_version TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS recovery_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    failure_reason TEXT,
    action_type TEXT NOT NULL,
    rationale TEXT NOT NULL,
    status TEXT NOT NULL,
    proposed_by TEXT NOT NULL DEFAULT 'klear-agent',
    approved_by TEXT,
    approved_at INTEGER,
    executed_at INTEGER,
    result TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    payload TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS disputes (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    payment_id TEXT,
    amount INTEGER NOT NULL,
    category TEXT,
    note TEXT,
    status TEXT NOT NULL,
    evidence TEXT,
    opened_at INTEGER NOT NULL,
    resolved_on INTEGER,
    closed_in_favor_of TEXT,
    raw TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS borrowers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    language TEXT NOT NULL,
    phone TEXT NOT NULL,
    loan_no TEXT NOT NULL,
    amount_due INTEGER NOT NULL,
    days_overdue INTEGER NOT NULL,
    promises_made INTEGER NOT NULL DEFAULT 0,
    promises_kept INTEGER NOT NULL DEFAULT 0,
    last_contacted_at INTEGER,
    note TEXT,
    payday_hint INTEGER,
    claims_paid INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'IN_QUEUE',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS collection_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    borrower_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    rationale TEXT NOT NULL,
    status TEXT NOT NULL,
    proposed_by TEXT NOT NULL DEFAULT 'klear-agent',
    approved_by TEXT,
    result TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS klear_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_settlements_payment ON settlements(payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bank_utr ON bank_txns(utr)`,
  `CREATE INDEX IF NOT EXISTS idx_recon_leg ON recon_matches(leg, status)`,
  `CREATE INDEX IF NOT EXISTS idx_flags_order ON fraud_flags(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status)`,
];

const db = getSqlite();
db.exec("BEGIN");
try {
  for (const stmt of DDL) db.exec(stmt);
  db.exec("COMMIT");
  console.log("✓ Klear database initialised");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

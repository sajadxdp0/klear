/**
 * Bank statement ingestion.
 *
 * Two parsers feed the same path:
 *   1. CSV  — deterministic local parser (zero-dependency floor)
 *   2. PDF  — Sarvam Document AI (Sarvam Vision) extract → transactions array
 *
 * Both produce the same BankTxn shape; ingestion is idempotent
 * (deterministic IDs → INSERT OR IGNORE), so re-uploading a statement
 * never double-counts money.
 */
import crypto from "node:crypto";
import { getDb } from "@/lib/db/client";
import { bankTxns } from "@/lib/db/schema";

export interface ParsedBankTxn {
  id: string;
  txnDate: number; // unix ms
  amount: number; // paise
  direction: "CREDIT" | "DEBIT";
  utr: string | null;
  narration: string | null;
  source: string;
}

export function bankTxnId(utr: string | null, narration: string | null, txnDate: number, amount: number): string {
  const key = `${utr ?? ""}|${narration ?? ""}|${txnDate}|${amount}`;
  return "btx_" + crypto.createHash("sha1").update(key).digest("hex").slice(0, 12);
}

/** Deterministic CSV parser. Format: date,amount_paise,direction,utr,narration */
export function parseBankCSV(text: string): ParsedBankTxn[] {
  const lines = text.trim().split(/\r?\n/);
  const out: ParsedBankTxn[] = [];
  // skip header if present
  const start = /^date,/i.test(lines[0]) ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const [date, amountStr, direction, utr, ...narrParts] = line.split(",");
    const txnDate = Date.parse(date);
    const amount = Math.round(Number(amountStr));
    if (!Number.isFinite(txnDate) || !Number.isFinite(amount)) continue;
    const dir = direction?.toUpperCase() === "DEBIT" ? "DEBIT" : "CREDIT";
    const narration = narrParts.join(",").trim() || null;
    const cleanUtr = utr?.trim() || null;
    out.push({
      id: bankTxnId(cleanUtr, narration, txnDate, amount),
      txnDate,
      amount,
      direction: dir,
      utr: cleanUtr,
      narration,
      source: "BANK_STATEMENT",
    });
  }
  return out;
}

export interface IngestResult {
  inserted: number;
  skipped: number;
  total: number;
}

/** Idempotent ingest into bank_txns. */
export async function ingestBankTxns(rows: ParsedBankTxn[]): Promise<IngestResult> {
  const db = getDb();
  const existing = new Set(
    (await db.select({ id: bankTxns.id }).from(bankTxns)).map((r) => r.id)
  );
  const fresh = rows.filter((r) => !existing.has(r.id));
  if (fresh.length > 0) {
    for (const r of fresh) {
      db.insert(bankTxns)
        .values({
          id: r.id,
          txnDate: r.txnDate,
          amount: r.amount,
          direction: r.direction,
          utr: r.utr,
          narration: r.narration,
          source: r.source,
          raw: null,
        })
        .onConflictDoNothing()
        .run();
    }
  }
  return {
    inserted: fresh.length,
    skipped: rows.length - fresh.length,
    total: existing.size + fresh.length,
  };
}

/**
 * Klear accuracy harness — proves the engines against planted ground truth.
 *
 *   Part 1 (recon):  re-runs the pure matchers over the live DB and checks
 *                    every planted exception from artifacts/seed-truth.json
 *                    is recovered with the exact expected status.
 *   Part 2 (fraud):  re-scores the labeled fraud cases (including the
 *                    false-positive control) and checks the risk bands.
 *
 * Exits non-zero if any check fails. Run: npm run eval
 */
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/lib/db/client";
import {
  bankTxns,
  orders,
  payments,
  refunds,
  settlements,
} from "../src/lib/db/schema";
import {
  matchOrderPayments,
  matchPaymentSettlements,
  matchSettlementBank,
  type MatchResult,
} from "../src/lib/recon/matcher";
import { assessAll } from "../src/lib/fraud/engine";
import { modelArtifactStatus } from "../src/lib/fraud/model";
import type { PaymentContextInput, RefundContextInput } from "../src/lib/fraud/features";

const LINE = "─".repeat(64);
const ok = (s: string) => `✅ ${s}`;
const bad = (s: string) => `❌ ${s}`;

function pad(s: string, n: number) {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

async function main() {
  const truthPath = path.join(process.cwd(), "artifacts", "seed-truth.json");
  const artifacts = modelArtifactStatus();
  if (!fs.existsSync(truthPath)) {
    console.error("No seed-truth.json — run `npm run db:seed` first.");
    process.exit(1);
  }
  const truth = JSON.parse(fs.readFileSync(truthPath, "utf8")) as {
    recon: { leg: string; leftRef: string; expected: string; note: string }[];
    fraud: {
      paymentId: string;
      expectedBand: string;
      expectedBandNoModel?: string;
      note: string;
    }[];
  };

  const db = getDb();

  // The bank statement is an artifact — ingest it through the same path the
  // dashboard uses, so eval exercises ingest AND matching end-to-end.
  const csvPath = path.join(process.cwd(), "artifacts", "demo-bank-statement.csv");
  if (fs.existsSync(csvPath)) {
    const { parseBankCSV, ingestBankTxns } = await import("../src/lib/recon/ingest-bank");
    const parsed = parseBankCSV(fs.readFileSync(csvPath, "utf8"));
    const res = await ingestBankTxns(parsed);
    console.log(
      `  bank statement ingested: ${res.inserted} new, ${res.skipped} already present`
    );
  }

  const orderRows = await db.select().from(orders);
  const paymentRows = await db.select().from(payments);
  const settlementRows = await db.select().from(settlements);
  const bankRows = await db.select().from(bankTxns);
  const refundRows = await db.select().from(refunds);

  console.log();
  console.log("KLEAR ACCURACY REPORT");
  console.log(LINE);

  /* ── Part 1: recon ─────────────────────────────────────────────── */
  const results: MatchResult[] = [
    ...matchOrderPayments(orderRows, paymentRows),
    ...matchPaymentSettlements(paymentRows, settlementRows, { now: Date.now() }),
    ...matchSettlementBank(settlementRows, bankRows),
  ];

  console.log("Recon engine — planted exceptions (exact-paise matching)");
  let reconPass = 0;
  for (const t of truth.recon) {
    const rows = results.filter(
      (r) => r.leg === t.leg && r.leftRef === t.leftRef
    );
    const found = rows.some((r) => r.status === t.expected);
    if (found) reconPass++;
    const foundStatus = rows.find((r) => r.status === t.expected)?.status
      ?? rows[0]?.status
      ?? "NOTHING";
    console.log(
      `  ${found ? ok("") : bad("")}${pad(t.note, 46)} expected ${pad(t.expected, 9)} found ${foundStatus}`
    );
  }
  console.log(`  ${reconPass}/${truth.recon.length} recon checks passed`);
  console.log();

  /* ── Part 2: fraud ─────────────────────────────────────────────── */
  console.log(
    `Fraud engine — labeled cases (model: ${modelArtifactStatus().onnx ? "lgbm-onnx" : modelArtifactStatus().weights ? "logistic-json" : "heuristic (no artifacts yet)"})`
  );

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
  const flagById = new Map(flags.map((f) => [f.paymentId, f]));
  const hasModel = artifacts.onnx || artifacts.weights;

  let fraudPass = 0;
  for (const t of truth.fraud) {
    const expected = hasModel
      ? t.expectedBand
      : (t.expectedBandNoModel ?? t.expectedBand);
    const a = flagById.get(t.paymentId);
    if (!a) {
      console.log(bad(`${pad(t.note, 46)} payment missing from DB`));
      continue;
    }
    const pass = a.band === expected;
    if (pass) fraudPass++;
    const mark = pass ? ok("") : bad("");
    console.log(
      `  ${mark}${pad(t.note, 46)} expected ${pad(expected, 7)} scored ${a.band} (${a.score.toFixed(2)})`
    );
    if (!pass && a.reasons.length > 0) {
      for (const r of a.reasons.slice(0, 3)) {
        console.log(`      · ${r.code}: ${r.label}`);
      }
    }
  }
  console.log(`  ${fraudPass}/${truth.fraud.length} fraud checks passed`);
  console.log();

  /* ── Verdict ───────────────────────────────────────────────────── */
  const total = truth.recon.length + truth.fraud.length;
  const passed = reconPass + fraudPass;
  console.log(LINE);
  if (passed === total) {
    console.log(`ALL GREEN — ${passed}/${total} accuracy checks passed`);
  } else {
    console.log(`FAILURES — ${passed}/${total} passed, fix before demo`);
  }
  console.log(LINE);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

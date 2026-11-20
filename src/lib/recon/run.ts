/**
 * DB-backed recon run: load current state → pure matchers → persist matches
 * + run summary. Also records an audit entry.
 */
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLog, bankTxns, orders, payments, reconMatches, settlements, klearRuns } from "@/lib/db/schema";
import {
  matchOrderPayments,
  matchPaymentSettlements,
  matchSettlementBank,
  summarizeRecon,
  type MatchResult,
  type ReconSummary,
} from "./matcher";

export type { ReconSummary, MatchResult } from "./matcher";

export async function runRecon(): Promise<ReconSummary> {
  const db = getDb();
  const now = Date.now();

  const [orderRows, paymentRows, settlementRows, bankRows] = await Promise.all([
    db.select().from(orders),
    db.select().from(payments),
    db.select().from(settlements),
    db.select().from(bankTxns),
  ]);

  const results: MatchResult[] = [
    ...matchOrderPayments(orderRows, paymentRows),
    ...matchPaymentSettlements(paymentRows, settlementRows, { now }),
    ...matchSettlementBank(settlementRows, bankRows),
  ];

  const summary = summarizeRecon(orderRows, paymentRows, results);
  const at = now;

  // fresh-run semantics: replace the recon table each pass
  db.delete(reconMatches).run();
  if (results.length > 0) {
    db.insert(reconMatches)
      .values(
        results.map((r) => ({
          leg: r.leg,
          leftRef: r.leftRef,
          rightRef: r.rightRef,
          status: r.status,
          confidence: r.confidence,
          rule: r.rule,
          amountDelta: r.amountDelta,
          detail: r.detail,
          resolved: 0,
          createdAt: at,
        }))
      )
      .run();
  }

  db.insert(klearRuns)
    .values({
      kind: "RECON",
      summary: JSON.stringify(publicSummary(summary)),
      createdAt: at,
    })
    .run();

  db.insert(auditLog)
    .values({
      actor: "klear-agent",
      action: "RECON_RUN",
      entity: "recon",
      entityId: null,
      payload: JSON.stringify({
        exceptions: summary.exceptions,
        klearScore: Number(summary.klearScore.toFixed(4)),
      }),
      createdAt: at,
    })
    .run();

  return summary;
}

/** Trim results before persisting/returning to the UI. */
export function publicSummary(s: ReconSummary) {
  const { results: _r, ...rest } = s;
  return { ...rest, klearScore: Number(s.klearScore.toFixed(4)) };
}

export async function getLatestRunSummary(): Promise<ReconSummary["legs"] | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(klearRuns)
    .where(eq(klearRuns.kind, "RECON"))
    .orderBy(desc(klearRuns.createdAt))
    .limit(1);
  if (rows.length === 0) return null;
  try {
    return JSON.parse(rows[0].summary).legs;
  } catch {
    return null;
  }
}

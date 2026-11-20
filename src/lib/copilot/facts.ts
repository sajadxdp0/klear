/**
 * Deterministic facts for the briefing and copilot.
 * Numbers are computed in TypeScript — the LLM writes prose AROUND
 * these facts and never computes anything itself. Accuracy-first.
 */
import { getDb } from "@/lib/db/client";
import {
  fraudFlags,
  klearRuns,
  orders,
  payments,
  reconMatches,
  recoveryActions,
} from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export interface OverviewFacts {
  asOf: number;
  totals: {
    orders: number;
    payments: number;
    failedPayments: number;
    pendingPayments: number;
    successPayments: number;
  };
  money: {
    orderValuePaise: number;
    clearedValuePaise: number;
    inFlightValuePaise: number;
    atRiskValuePaise: number;
  };
  klearScore: number;
  legCounts: Record<string, Record<string, number>> | null;
  exceptions: {
    mismatches: number;
    missing: number;
    duplicates: number;
  };
  risk: {
    review: number;
    block: number;
    topFlags: { orderId: string; band: string; score: number; reasons: string[] }[];
  };
  recovery: {
    proposed: number;
    approved: number;
    executed: number;
    recoverablePaise: number;
    queue: { id: number; orderId: string; actionType: string; failureReason: string | null; rationale: string }[];
  };
}

export async function buildOverviewFacts(): Promise<OverviewFacts> {
  const db = getDb();
  const [orderRows, paymentRows, matchRows, flagRows, actionRows, runRows] =
    await Promise.all([
      db.select().from(orders),
      db.select().from(payments),
      db.select().from(reconMatches),
      db.select().from(fraudFlags),
      db.select().from(recoveryActions),
      db
        .select()
        .from(klearRuns)
        .where(eq(klearRuns.kind, "RECON"))
        .orderBy(desc(klearRuns.createdAt))
        .limit(1),
    ]);

  const paidOrders = orderRows.filter((o) => o.status === "PAID");
  const orderValue = paidOrders.reduce((s, o) => s + o.amount, 0);

  let summary: {
    clearedValuePaise?: number;
    inFlightValuePaise?: number;
    atRiskValuePaise?: number;
    klearScore?: number;
    legs?: OverviewFacts["legCounts"];
  } | null = null;
  if (runRows.length > 0) {
    try {
      summary = JSON.parse(runRows[0].summary);
    } catch {
      summary = null;
    }
  }

  const byLeg: Record<string, Record<string, number>> = {};
  for (const m of matchRows) {
    byLeg[m.leg] ??= { MATCHED: 0, PARTIAL: 0, MISMATCH: 0, MISSING: 0, DUPLICATE: 0 };
    byLeg[m.leg][m.status] += 1;
  }

  const topFlags = flagRows
    .filter((f) => f.riskBand !== "OK")
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((f) => ({
      orderId: f.orderId,
      band: f.riskBand,
      score: f.score,
      reasons: (JSON.parse(f.reasons) as { label: string }[]).map((r) => r.label),
    }));

  // money still recoverable: orders behind open proposals / approved /
  // executed-but-not-yet-paid recovery links, that are still unpaid
  const openOrderIds = new Set(
    actionRows
      .filter(
        (a) =>
          (a.status === "PROPOSED" || a.status === "APPROVED" || a.status === "EXECUTED") &&
          !(a.result ?? "").includes('"recovered":true') &&
          !(a.result ?? "").includes('"recovered": true')
      )
      .map((a) => a.orderId)
  );
  const recoverablePaise = orderRows
    .filter((o) => o.status !== "PAID" && openOrderIds.has(o.id))
    .reduce((s, o) => s + o.amount, 0);

  return {
    asOf: Date.now(),
    totals: {
      orders: orderRows.length,
      payments: paymentRows.length,
      failedPayments: paymentRows.filter((p) => p.status === "FAILED").length,
      pendingPayments: paymentRows.filter((p) => p.status === "PENDING").length,
      successPayments: paymentRows.filter((p) => p.status === "SUCCESS").length,
    },
    money: {
      orderValuePaise: orderValue,
      clearedValuePaise: summary?.clearedValuePaise ?? 0,
      inFlightValuePaise: summary?.inFlightValuePaise ?? 0,
      atRiskValuePaise: summary?.atRiskValuePaise ?? 0,
    },
    klearScore: summary?.klearScore ?? 0,
    legCounts: byLeg,
    exceptions: {
      mismatches: matchRows.filter((m) => m.status === "MISMATCH").length,
      missing: matchRows.filter((m) => m.status === "MISSING").length,
      duplicates: matchRows.filter((m) => m.status === "DUPLICATE").length,
    },
    risk: {
      review: flagRows.filter((f) => f.riskBand === "REVIEW").length,
      block: flagRows.filter((f) => f.riskBand === "BLOCK").length,
      topFlags,
    },
    recovery: {
      proposed: actionRows.filter((a) => a.status === "PROPOSED").length,
      approved: actionRows.filter((a) => a.status === "APPROVED").length,
      executed: actionRows.filter((a) => a.status === "EXECUTED").length,
      recoverablePaise,
      queue: actionRows
        .filter((a) => a.status === "PROPOSED")
        .slice(0, 6)
        .map((a) => ({
          id: a.id,
          orderId: a.orderId,
          actionType: a.actionType,
          failureReason: a.failureReason,
          rationale: a.rationale,
        })),
    },
  };
}

/**
 * One-shot dashboard data assembly — everything the UI needs in a single
 * structured payload.
 */
import { desc, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  auditLog,
  disputes,
  fraudFlags,
  orders,
  payments,
  reconMatches,
  recoveryActions,
  settlements,
} from "@/lib/db/schema";
import { buildOverviewFacts, type OverviewFacts } from "@/lib/copilot/facts";
import { cashfreeConfigured } from "@/lib/cashfree/client";
import { sarvamConfigured } from "@/lib/sarvam/client";
import { modelArtifactStatus } from "@/lib/fraud/model";

export interface DashboardData {
  facts: OverviewFacts;
  exceptions: {
    id: number;
    leg: string;
    leftRef: string;
    rightRef: string | null;
    status: string;
    rule: string;
    amountDelta: number;
    detail: string | null;
    resolved: number;
  }[];
  flags: {
    id: number;
    paymentId: string | null;
    orderId: string;
    band: string;
    score: number;
    reasons: { code: string; label: string; contribution: number }[];
    customer: string | null;
    amount: number | null;
  }[];
  actions: {
    id: number;
    paymentId: string;
    orderId: string;
    actionType: string;
    failureReason: string | null;
    rationale: string;
    status: string;
    approvedBy: string | null;
    result: string | null;
    createdAt: number;
  }[];
  disputes: {
    id: string;
    orderId: string;
    amount: number;
    category: string | null;
    note: string | null;
    status: string;
    openedAt: number;
    closedInFavorOf: string | null;
    evidence: string | null;
  }[];
  audit: {
    id: number;
    actor: string;
    action: string;
    entity: string;
    entityId: string | null;
    createdAt: number;
  }[];
  meta: {
    merchantName: string;
    cashfreeConfigured: boolean;
    sarvamConfigured: boolean;
    model: ReturnType<typeof modelArtifactStatus>;
    settlementCount: number;
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const db = getDb();
  const [facts, matchRows, flagRows, actionRows, auditRows, orderRows, paymentRows, settlementRows, disputeRows] =
    await Promise.all([
      buildOverviewFacts(),
      db.select().from(reconMatches),
      db.select().from(fraudFlags),
      db.select().from(recoveryActions),
      db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(14),
      db.select().from(orders),
      db.select().from(payments),
      db.select().from(settlements),
      db.select().from(disputes).orderBy(desc(disputes.openedAt)),
    ]);

  const orderById = new Map(orderRows.map((o) => [o.id, o]));
  const paymentById = new Map(paymentRows.map((p) => [p.id, p]));

  return {
    facts,
    exceptions: matchRows
      .filter(
        (m) => m.status === "MISMATCH" || m.status === "MISSING" || m.status === "DUPLICATE"
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((m) => ({
        id: m.id,
        leg: m.leg,
        leftRef: m.leftRef,
        rightRef: m.rightRef,
        status: m.status,
        rule: m.rule,
        amountDelta: m.amountDelta,
        detail: m.detail,
        resolved: m.resolved,
      })),
    flags: flagRows
      .filter((f) => f.riskBand !== "OK")
      .sort((a, b) => b.score - a.score)
      .map((f) => {
        const order = orderById.get(f.orderId);
        const payment = f.paymentId ? paymentById.get(f.paymentId) : undefined;
        return {
          id: f.id,
          paymentId: f.paymentId,
          orderId: f.orderId,
          band: f.riskBand,
          score: f.score,
          reasons: JSON.parse(f.reasons) as {
            code: string;
            label: string;
            contribution: number;
          }[],
          customer: order?.customerName ?? payment?.customerName ?? null,
          amount: payment?.amount ?? order?.amount ?? null,
        };
      }),
    actions: actionRows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((a) => ({
        id: a.id,
        paymentId: a.paymentId,
        orderId: a.orderId,
        actionType: a.actionType,
        failureReason: a.failureReason,
        rationale: a.rationale,
        status: a.status,
        approvedBy: a.approvedBy,
        result: a.result,
        createdAt: a.createdAt,
      })),
    disputes: disputeRows.map((d) => ({
      id: d.id,
      orderId: d.orderId,
      amount: d.amount,
      category: d.category,
      note: d.note,
      status: d.status,
      openedAt: d.openedAt,
      closedInFavorOf: d.closedInFavorOf,
      evidence: d.evidence,
    })),
    audit: auditRows.map((a) => ({
      id: a.id,
      actor: a.actor,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      createdAt: a.createdAt,
    })),
    meta: {
      merchantName: process.env.MERCHANT_NAME ?? "Sunrise Organics",
      cashfreeConfigured: cashfreeConfigured(),
      sarvamConfigured: sarvamConfigured(),
      model: modelArtifactStatus(),
      settlementCount: settlementRows.length,
    },
  };
}

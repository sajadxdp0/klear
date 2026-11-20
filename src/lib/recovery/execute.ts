/**
 * Recovery execution: runs APPROVED proposals through Cashfree.
 *
 * Hard rule (Relay philosophy): nothing executes without an APPROVED row
 * recorded by a human. Every execution lands in the append-only audit log
 * with who approved it, when, and what happened.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  auditLog,
  orders,
  payments,
  recoveryActions,
} from "@/lib/db/schema";
import { createPaymentLink } from "@/lib/cashfree/client";

export interface ExecuteResult {
  ok: boolean;
  actionId: number;
  status: string;
  result: unknown;
}

/** Executes an APPROVED recovery action. No approval record → refused. */
export async function executeAction(actionId: number): Promise<ExecuteResult> {
  const db = getDb();
  const rows = await db
    .select()
    .from(recoveryActions)
    .where(eq(recoveryActions.id, actionId))
    .limit(1);

  if (rows.length === 0) {
    return { ok: false, actionId, status: "NOT_FOUND", result: null };
  }
  const action = rows[0];
  if (action.status !== "APPROVED") {
    return {
      ok: false,
      actionId,
      status: "REFUSED_NOT_APPROVED",
      result:
        "Klear refuses to move money without a human approval on record. Approve first.",
    };
  }

  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.id, action.orderId))
    .limit(1);
  const order = orderRows[0] ?? null;

  let result: unknown;
  let status = "EXECUTED";

  try {
    switch (action.actionType) {
      case "PAYMENT_LINK":
      case "RETRY":
      case "UPI_COLLECT":
      case "DUNNING": {
        if (!order) throw new Error("order not found in ledger");
        const link = await createPaymentLink({
          linkId: `klear-recover-${action.orderId}-${Date.now()}`,
          amountPaise: order.amount,
          customerName: order.customerName ?? "Customer",
          customerPhone: order.customerPhone ?? "9999999999",
          customerEmail: order.customerEmail,
          purpose: `Klear recovery for order ${action.orderId}`,
          autoReminders: action.actionType === "DUNNING",
        });
        result = {
          linkUrl: link.linkUrl,
          simulated: link.simulated,
          actionType: action.actionType,
        };
        break;
      }
      case "HOLD_FOR_FRAUD": {
        status = "EXECUTED";
        result = { note: "No money action — held for fraud review.", actionType: action.actionType };
        break;
      }
      case "GIVE_UP":
      default: {
        status = "EXECUTED";
        result = { note: "Marked not worth recovering.", actionType: action.actionType };
        break;
      }
    }
  } catch (err) {
    status = "FAILED";
    result = { error: String(err) };
  }

  const now = Date.now();
  db.update(recoveryActions)
    .set({ status, executedAt: now, result: JSON.stringify(result) })
    .where(eq(recoveryActions.id, actionId))
    .run();

  db.insert(auditLog)
    .values({
      actor: "klear-agent",
      action: "EXECUTE_RECOVERY",
      entity: "recovery_action",
      entityId: String(actionId),
      payload: JSON.stringify({
        approvedBy: action.approvedBy,
        actionType: action.actionType,
        orderId: action.orderId,
        result,
      }),
      createdAt: now,
    })
    .run();

  return { ok: status === "EXECUTED", actionId, status, result };
}

/** Convenience: approve then execute in one motion (still two ledger rows). */
export async function approveAndExecute(
  actionId: number,
  approver: string
): Promise<ExecuteResult> {
  const { approveProposal } = await import("./triage");
  const approved = await approveProposal(actionId, approver);
  if (!approved) {
    return { ok: false, actionId, status: "REFUSED_NOT_APPROVED", result: null };
  }
  return executeAction(actionId);
}

/** Called by the simulator/webhook when a recovery link gets paid. */
export async function markRecovered(
  actionId: number,
  paymentReference: string
): Promise<void> {
  const db = getDb();
  const now = Date.now();
  db.update(recoveryActions)
    .set({
      status: "EXECUTED",
      executedAt: now,
      result: JSON.stringify({ recovered: true, paymentReference }),
    })
    .where(eq(recoveryActions.id, actionId))
    .run();
  db.insert(auditLog)
    .values({
      actor: "klear-agent",
      action: "RECOVERY_CONFIRMED",
      entity: "recovery_action",
      entityId: String(actionId),
      payload: JSON.stringify({ paymentReference }),
      createdAt: now,
    })
    .run();
}

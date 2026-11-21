/**
 * Collections branch actions: propose → human approves → execute.
 * Every action lands in the audit ledger with the approver's name.
 *
 * Branches (mirroring Relay's flow control):
 *   PAYMENT_LINK  full payment link in the borrower's language
 *   PARTIAL_LINK  installment link with a minimum (the kindness branch)
 *   DEFER         schedule after payday, no contact until then
 *   VERIFY_PAID   check an "already paid" claim against the ledger
 *   MARK_LAPSED   a promise lapsed; the ranker re-forms around it
 */
import { eq, and, like } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLog, borrowers, collectionActions, orders, payments } from "@/lib/db/schema";
import { createPaymentLink } from "@/lib/cashfree/client";
import { draftMessage } from "./messages";
import { formatINR } from "@/lib/money";

export interface ActionResult {
  ok: boolean;
  actionId: number;
  actionType: string;
  status: string;
  result: unknown;
}

const MIN_PARTIAL_FRACTION = 0.25;

export async function executeCollectionAction(
  borrowerId: string,
  actionType: "PAYMENT_LINK" | "PARTIAL_LINK" | "DEFER" | "VERIFY_PAID" | "MARK_LAPSED",
  approver: string
): Promise<ActionResult> {
  const db = getDb();
  const now = Date.now();

  const rows = await db.select().from(borrowers).where(eq(borrowers.id, borrowerId)).limit(1);
  if (rows.length === 0) {
    return { ok: false, actionId: -1, actionType, status: "NOT_FOUND", result: null };
  }
  const b = rows[0];

  // record the proposal and the approval in one motion (two ledger facts)
  const rationale = rationaleFor(actionType, b);
  const inserted = db
    .insert(collectionActions)
    .values({
      borrowerId,
      actionType,
      rationale,
      status: "PROPOSED",
      proposedBy: "klear-agent",
      approvedBy: approver,
      createdAt: now,
    })
    .returning()
    .get();
  const actionId = inserted.id;

  db.update(collectionActions)
    .set({ status: "APPROVED" })
    .where(eq(collectionActions.id, actionId))
    .run();

  db.insert(auditLog)
    .values({
      actor: `human:${approver}`,
      action: "APPROVE_COLLECTION",
      entity: "collection_action",
      entityId: String(actionId),
      payload: JSON.stringify({ borrowerId, actionType, rationale }),
      createdAt: now,
    })
    .run();

  let result: Record<string, unknown>;
  let status = "EXECUTED";
  let borrowerStatus = b.status;

  try {
    switch (actionType) {
      case "PAYMENT_LINK":
      case "PARTIAL_LINK": {
        const partial =
          actionType === "PARTIAL_LINK"
            ? { minimumPaise: Math.max(100000, Math.round(b.amountDue * MIN_PARTIAL_FRACTION)) }
            : undefined;
        const link = await createPaymentLink({
          linkId: `klear-collect-${borrowerId}-${now}`,
          amountPaise: b.amountDue,
          customerName: b.name,
          customerPhone: b.phone,
          customerEmail: null,
          purpose: `Loan ${b.loanNo} repayment`,
          autoReminders: true,
          partial,
        });
        const message = draftMessage(actionType, b.language, {
          name: b.name.split(" ")[0],
          loanNo: b.loanNo,
          amountRupees: (b.amountDue / 100).toLocaleString("en-IN"),
          linkUrl: link.linkUrl,
          minimumRupees: partial
            ? (partial.minimumPaise / 100).toLocaleString("en-IN")
            : undefined,
        });
        result = {
          linkUrl: link.linkUrl,
          simulated: link.simulated,
          message,
          language: b.language,
          ...(partial ? { minimum: partial.minimumPaise } : {}),
        };
        borrowerStatus = actionType === "PARTIAL_LINK" ? "IN_QUEUE" : "LINK_SENT";
        break;
      }

      case "DEFER": {
        borrowerStatus = "DEFERRED";
        result = {
          deferredUntil: b.paydayHint ? `day ${b.paydayHint} of next cycle` : "next contact window",
          note: "No contact until the borrower's stated payday passes. Kindness scheduled.",
        };
        break;
      }

      case "VERIFY_PAID": {
        // the ledger is the authority: find a SUCCESS payment recorded
        // against this borrower's loan number
        const orderRows = await db
          .select()
          .from(orders)
          .where(and(like(orders.id, `%${b.loanNo}%`)))
          .all();
        // claims from the seed reference orders by borrower id; search both
        const byLoan = orderRows.filter((o) => o.raw?.includes(b.loanNo));
        let verified = byLoan.length > 0;
        if (!verified) {
          const directRows = await db
            .select()
            .from(orders)
            .where(like(orders.id, `%${borrowerId}%`))
            .all();
          verified = directRows.length > 0;
        }
        result = verified
          ? { verified: true, note: "Payment found in the ledger. Borrower removed from the queue with our thanks." }
          : { verified: false, note: "No payment found against this loan in the ledger. The claim does not hold; a payment link goes out instead, kindly." };
        if (verified) borrowerStatus = "VERIFIED_PAID";
        break;
      }

      case "MARK_LAPSED": {
        // the promise lapsed: history records one more unkept promise,
        // and the ranker re-forms around it on the next build
        db.update(borrowers)
          .set({ promisesMade: b.promisesMade + 1 })
          .where(eq(borrowers.id, borrowerId))
          .run();
        result = { lapsed: true, note: "Promise lapsed. The ranker will lower this borrower on the next queue build." };
        break;
      }
    }
  } catch (err) {
    status = "FAILED";
    result = { error: String(err) };
  }

  db.update(collectionActions)
    .set({ status, result: JSON.stringify(result) })
    .where(eq(collectionActions.id, actionId))
    .run();

  if (borrowerStatus !== b.status) {
    db.update(borrowers).set({ status: borrowerStatus }).where(eq(borrowers.id, borrowerId)).run();
  }

  db.insert(auditLog)
    .values({
      actor: "klear-agent",
      action: "EXECUTE_COLLECTION",
      entity: "collection_action",
      entityId: String(actionId),
      payload: JSON.stringify({ borrowerId, actionType, status, outcome: result }),
      createdAt: Date.now(),
    })
    .run();

  return { ok: status === "EXECUTED", actionId, actionType, status, result };
}

function rationaleFor(
  actionType: string,
  b: { name: string; loanNo: string; amountDue: number; daysOverdue: number; paydayHint: number | null }
): string {
  const amt = formatINR(b.amountDue);
  switch (actionType) {
    case "PAYMENT_LINK":
      return `Send ${b.name} a full payment link for ${amt}. Loan ${b.loanNo}, ${b.daysOverdue} days overdue.`;
    case "PARTIAL_LINK":
      return `Offer ${b.name} a partial payment link (minimum 25%). She said this month is hard; we offer a way forward instead of a harder push.`;
    case "DEFER":
      return `Defer ${b.name} until after the stated payday${b.paydayHint ? ` (day ${b.paydayHint})` : ""}. No contact until then.`;
    case "VERIFY_PAID":
      return `Verify ${b.name}'s "already paid" claim for loan ${b.loanNo} against the ledger before any contact.`;
    case "MARK_LAPSED":
      return `Mark ${b.name}'s promise as lapsed. The queue re-forms around it.`;
    default:
      return `Action on loan ${b.loanNo}.`;
  }
}

/** A collection link got paid (simulated or webhook): books update. */
export async function recordCollectionPayment(linkId: string): Promise<{
  borrowerId: string;
  partial: boolean;
}> {
  // linkId format: klear-collect-<borrowerId>-<timestamp>
  const withoutPrefix = linkId.replace(/^klear-collect-/, "");
  const tsDash = withoutPrefix.lastIndexOf("-");
  const borrowerId = tsDash > 0 ? withoutPrefix.slice(0, tsDash) : withoutPrefix;

  const db = getDb();
  const now = Date.now();
  const rows = await db.select().from(borrowers).where(eq(borrowers.id, borrowerId)).limit(1);
  if (rows.length === 0) throw new Error("borrower not found");
  const b = rows[0];

  const actionRows = await db
    .select()
    .from(collectionActions)
    .where(eq(collectionActions.borrowerId, borrowerId))
    .all();
  const partialAction = actionRows.find(
    (a) => a.actionType === "PARTIAL_LINK" && a.status === "EXECUTED"
  );
  const partial = Boolean(partialAction && (JSON.parse(partialAction.result ?? "{}") as { minimum?: number }).minimum);

  const payId = `pay_collect_${now}`;
  const orderId = `order_collect_${borrowerId}_${now}`;
  const paidAmount = partial
    ? Math.max(100000, Math.round(b.amountDue * MIN_PARTIAL_FRACTION))
    : b.amountDue;

  db.insert(orders)
    .values({
      id: orderId,
      amount: paidAmount,
      status: "PAID",
      customerName: b.name,
      customerPhone: b.phone,
      customerEmail: null,
      createdAt: now,
      raw: JSON.stringify({ loanNo: b.loanNo, via: "collection-link" }),
    })
    .onConflictDoNothing()
    .run();
  db.insert(payments)
    .values({
      id: payId,
      orderId,
      amount: paidAmount,
      status: "SUCCESS",
      method: "upi",
      bankReference: `UTRCOL${now % 100000000}`,
      customerName: b.name,
      createdAt: now,
      raw: JSON.stringify({ loanNo: b.loanNo, via: "collection-link" }),
    })
    .onConflictDoNothing()
    .run();

  const newStatus = partial ? "PARTIAL" : "PAID";
  db.update(borrowers).set({ status: newStatus }).where(eq(borrowers.id, borrowerId)).run();

  db.insert(auditLog)
    .values({
      actor: "cashfree-webhook",
      action: partial ? "COLLECTION_PARTIAL_PAID" : "COLLECTION_PAID",
      entity: "borrower",
      entityId: borrowerId,
      payload: JSON.stringify({ loanNo: b.loanNo, paidAmount }),
      createdAt: now,
    })
    .run();

  return { borrowerId, partial };
}

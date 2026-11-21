import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { borrowers, collectionActions } from "@/lib/db/schema";
import { buildQueue } from "@/lib/collections/rank";
import { callingWindowOpen } from "@/lib/collections/rank";
import { draftMessage } from "@/lib/collections/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Relay HTTP node payload: today's branch plan, one entry per
 * borrower the workflow should reach. A Relay agent with a schedule
 * trigger can POST nothing and GET this, or GET on a schedule, and
 * route each entry to its channel (WhatsApp, Bolna call, payment link).
 *
 * The ranker decides. Relay executes. Both inside their own platforms.
 */
export async function GET() {
  try {
    const db = getDb();
    const rows = await db.select().from(borrowers);
    const executed = await db
      .select()
      .from(collectionActions)
      .orderBy(desc(collectionActions.createdAt))
      .limit(50);
    const doneByBorrower = new Map(
      executed
        .filter((a) => a.status === "EXECUTED")
        .map((a) => [a.borrowerId, a.actionType])
    );

    const queue = buildQueue(rows);
    const window = callingWindowOpen(new Date());

    const plan = queue.active.slice(0, 10).map((b) => {
      const done = doneByBorrower.get(b.id);
      const action: string = done
        ? done === "PARTIAL_LINK"
          ? "PARTIAL_LINK"
          : "ALREADY_REACHED"
        : b.paydayHint
          ? "DEFER_TO_PAYDAY"
          : "PAYMENT_LINK";
      const message = draftMessage(
        action === "PARTIAL_LINK" ? "PARTIAL_LINK" : action === "DEFER_TO_PAYDAY" ? "DEFER" : "PAYMENT_LINK",
        b.language,
        {
          name: b.name.split(" ")[0],
          loanNo: b.loanNo,
          amountRupees: (b.amountDue / 100).toLocaleString("en-IN"),
          linkUrl: "{payment_link}",
        }
      );
      return {
        rank: b.rank,
        borrowerId: b.id,
        name: b.name,
        phone: b.phone,
        language: b.language,
        amountDuePaise: b.amountDue,
        reason: b.reason,
        action,
        message,
        recordedDisclosure: action === "PAYMENT_LINK" ? false : true,
      };
    });

    const claims = queue.needsVerification.map((b) => ({
      borrowerId: b.id,
      name: b.name,
      phone: b.phone,
      language: b.language,
      action: "VERIFY_PAID_FIRST",
      reason: b.note ?? "claims already paid",
    }));

    return NextResponse.json({
      generatedAt: queue.now,
      callingWindow: window,
      note: "Reach these borrowers, in this order. Reasons attached. Partial links for hardship. Verify claims before contact.",
      plan,
      claims,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

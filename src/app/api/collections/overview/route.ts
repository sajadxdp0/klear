import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { borrowers, collectionActions } from "@/lib/db/schema";
import { buildQueue } from "@/lib/collections/rank";
import { sarvamConfigured } from "@/lib/sarvam/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const rows = await db.select().from(borrowers);
    const actions = await db
      .select()
      .from(collectionActions)
      .orderBy(desc(collectionActions.createdAt))
      .limit(30);
    const queue = buildQueue(rows);

    return NextResponse.json({
      queue,
      actions: actions.map((a) => ({
        id: a.id,
        borrowerId: a.borrowerId,
        actionType: a.actionType,
        rationale: a.rationale,
        status: a.status,
        approvedBy: a.approvedBy,
        result: a.result ? JSON.parse(a.result) : null,
        createdAt: a.createdAt,
      })),
      meta: {
        sarvamConfigured: sarvamConfigured(),
        outcomeBlind: true, // ground truth held back; see artifacts/collections-outcomes.json
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

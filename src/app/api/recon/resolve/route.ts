import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { auditLog, reconMatches } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Marks a recon exception as resolved by a human. The merchant's loop is
 * detect → investigate → resolve → audit, and this is the third step.
 * A fresh engine run re-detects from scratch, so resolutions are
 * naturally re-earned if the books change.
 */
export async function POST(req: Request) {
  try {
    const { matchId, approver } = z
      .object({ matchId: z.number().int(), approver: z.string().min(2) })
      .parse(await req.json());

    const db = getDb();
    const rows = await db
      .select()
      .from(reconMatches)
      .where(eq(reconMatches.id, matchId))
      .limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: "exception not found" }, { status: 404 });
    }

    const now = Date.now();
    db.update(reconMatches)
      .set({ resolved: 1 })
      .where(eq(reconMatches.id, matchId))
      .run();

    db.insert(auditLog)
      .values({
        actor: `human:${approver}`,
        action: "RECON_RESOLVED",
        entity: "recon_match",
        entityId: String(matchId),
        payload: JSON.stringify({
          leg: rows[0].leg,
          leftRef: rows[0].leftRef,
          status: rows[0].status,
          rule: rows[0].rule,
        }),
        createdAt: now,
      })
      .run();

    return NextResponse.json({ resolved: true, matchId });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

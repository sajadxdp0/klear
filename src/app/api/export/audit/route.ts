import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return lines.join("\n") + "\n";
}

/** The full audit trail: every actor, action, entity and timestamp. */
export async function GET() {
  const db = getDb();
  const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt));
  const csv = toCsv(
    ["timestamp_iso", "actor", "action", "entity", "entity_id"],
    rows.map((a) => [
      new Date(a.createdAt).toISOString(),
      a.actor,
      a.action,
      a.entity,
      a.entityId,
    ])
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="klear-audit-trail.csv"',
    },
  });
}

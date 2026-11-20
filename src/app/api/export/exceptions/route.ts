import { getDb } from "@/lib/db/client";
import { reconMatches } from "@/lib/db/schema";

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

/** Recon exceptions, exportable. "Approvals are documented and exportable." */
export async function GET() {
  const db = getDb();
  const rows = await db.select().from(reconMatches);
  const csv = toCsv(
    ["leg", "left_ref", "right_ref", "status", "rule", "amount_delta_paise", "detail", "resolved"],
    rows
      .filter((m) => ["MISMATCH", "MISSING", "DUPLICATE"].includes(m.status))
      .map((m) => [
        m.leg,
        m.leftRef,
        m.rightRef,
        m.status,
        m.rule,
        m.amountDelta,
        m.detail,
        m.resolved === 1 ? "yes" : "no",
      ])
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="klear-exceptions.csv"',
    },
  });
}

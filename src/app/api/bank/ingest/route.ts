import { NextResponse } from "next/server";
import {
  ingestBankTxns,
  parseBankCSV,
} from "@/lib/recon/ingest-bank";
import { extractBankStatement, sarvamConfigured } from "@/lib/sarvam/client";
import { runRecon } from "@/lib/recon/run";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Bank statement ingestion. Accepts multipart file:
 *   .csv → deterministic local parser
 *   .pdf → Sarvam Document AI (Sarvam Vision) extraction
 * Then re-runs the recon engine so the three-way match updates live.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "no file uploaded" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const isPdf = file.name.toLowerCase().endsWith(".pdf");

    let parsed;
    let mode: "csv-local" | "sarvam-docai";

    if (isPdf) {
      if (!sarvamConfigured()) {
        return NextResponse.json(
          {
            error:
              "PDF statements need SARVAM_API_KEY for Sarvam Vision extraction. Upload the CSV instead, or set the key.",
          },
          { status: 400 }
        );
      }
      mode = "sarvam-docai";
      parsed = await extractBankStatement(file.name, bytes);
    } else {
      mode = "csv-local";
      parsed = parseBankCSV(bytes.toString("utf8"));
    }

    const ingest = await ingestBankTxns(parsed);
    const recon = await runRecon();

    const db = getDb();
    db.insert(auditLog)
      .values({
        actor: isPdf ? "sarvam-vision" : "csv-parser",
        action: "BANK_STATEMENT_INGESTED",
        entity: "bank_txns",
        entityId: file.name,
        payload: JSON.stringify({ mode, ...ingest }),
        createdAt: Date.now(),
      })
      .run();

    return NextResponse.json({
      mode,
      fileName: file.name,
      parsed: parsed.length,
      inserted: ingest.inserted,
      skipped: ingest.skipped,
      recon: {
        klearScore: recon.klearScore,
        exceptions: recon.exceptions,
        clearedValuePaise: recon.clearedValuePaise,
        atRiskValuePaise: recon.atRiskValuePaise,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

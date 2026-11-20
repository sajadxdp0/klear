import { NextResponse } from "next/server";
import { z } from "zod";
import { askKlear } from "@/lib/copilot/agent";
import { sarvamConfigured, transcribeSpeech } from "@/lib/sarvam/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The "hears Hindi" front door: a merchant voice note in, Saaras v4
 * transcribes it (keyterm-biased for payments vocabulary), the copilot
 * answers from the merchant's own ledger. Same guardrails as the chat
 * path: tools are typed, money actions still need an approval.
 */
export async function POST(req: Request) {
  try {
    if (!sarvamConfigured()) {
      return NextResponse.json(
        {
          error:
            "Voice needs SARVAM_API_KEY (Saaras v4). Add it to .env, or type your question instead.",
          available: false,
        },
        { status: 400 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "no audio uploaded" }, { status: 400 });
    }
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "audio too large (max 8 MB)" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const transcript = await transcribeSpeech(file.name, bytes);

    if (!transcript.trim()) {
      return NextResponse.json(
        { error: "nothing intelligible in that recording, try again" },
        { status: 400 }
      );
    }

    const language = z
      .object({ language: z.string().optional() })
      .parse({ language: form.get("language") ?? undefined });

    const result = await askKlear(transcript);
    return NextResponse.json({
      transcript,
      language: language.language ?? undefined,
      ...result,
      available: true,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

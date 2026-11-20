import { NextResponse } from "next/server";
import { generateBriefing } from "@/lib/copilot/briefing";
import { synthesizeSpeech, sarvamConfigured } from "@/lib/sarvam/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Morning briefing as audio (Bulbul TTS). Stretch feature — needs
 * SARVAM_API_KEY. Text is the same briefing the dashboard shows.
 */
export async function GET() {
  try {
    if (!sarvamConfigured()) {
      return NextResponse.json(
        { error: "needs SARVAM_API_KEY", available: false },
        { status: 400 }
      );
    }
    const { text } = await generateBriefing();
    const audioBase64 = await synthesizeSpeech(text, "hi-IN");
    return NextResponse.json({ audioBase64, format: "wav", available: true });
  } catch (err) {
    return NextResponse.json({ error: String(err), available: false }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { askKlear } from "@/lib/copilot/agent";
import { sarvamConfigured } from "@/lib/sarvam/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    if (!sarvamConfigured()) {
      return NextResponse.json(
        {
          error:
            "Ask Klear needs SARVAM_API_KEY (Sarvam-105B). Add it to .env and restart.",
          available: false,
        },
        { status: 400 }
      );
    }
    const { question } = z
      .object({ question: z.string().min(2).max(2000) })
      .parse(await req.json());
    const result = await askKlear(question);
    return NextResponse.json({ ...result, available: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

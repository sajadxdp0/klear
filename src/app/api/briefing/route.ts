import { NextResponse } from "next/server";
import { generateBriefing } from "@/lib/copilot/briefing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const briefing = await generateBriefing();
    return NextResponse.json(briefing);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

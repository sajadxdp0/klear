import { NextResponse } from "next/server";
import { z } from "zod";
import { draftDisputeResponse } from "@/lib/disputes/draft";
import { sarvamConfigured } from "@/lib/sarvam/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(req: Request) {
  try {
    const { disputeId } = z
      .object({ disputeId: z.string().min(3) })
      .parse(await req.json());
    const draft = await draftDisputeResponse(disputeId);
    return NextResponse.json({ ...draft, sarvam: sarvamConfigured() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

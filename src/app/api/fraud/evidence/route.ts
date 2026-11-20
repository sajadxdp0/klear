import { NextResponse } from "next/server";
import { z } from "zod";
import { buildEvidencePack } from "@/lib/fraud/evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { flagId } = z.object({ flagId: z.number().int() }).parse(await req.json());
    const pack = await buildEvidencePack(flagId);
    return NextResponse.json(pack);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

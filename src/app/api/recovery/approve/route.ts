import { NextResponse } from "next/server";
import { z } from "zod";
import { approveProposal } from "@/lib/recovery/triage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { actionId, approver } = z
      .object({ actionId: z.number().int(), approver: z.string().min(2) })
      .parse(await req.json());
    const ok = await approveProposal(actionId, approver);
    if (!ok) {
      return NextResponse.json(
        { error: "not found or not in PROPOSED state" },
        { status: 400 }
      );
    }
    return NextResponse.json({ approved: true, actionId, approver });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { executeAction } from "@/lib/recovery/execute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { actionId } = z
      .object({ actionId: z.number().int() })
      .parse(await req.json());
    const result = await executeAction(actionId);
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { executeCollectionAction } from "@/lib/collections/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SCHEMA = z.object({
  borrowerId: z.string().min(3),
  actionType: z.enum([
    "PAYMENT_LINK",
    "PARTIAL_LINK",
    "DEFER",
    "VERIFY_PAID",
    "MARK_LAPSED",
  ]),
  approver: z.string().min(2),
});

export async function POST(req: Request) {
  try {
    const { borrowerId, actionType, approver } = SCHEMA.parse(await req.json());
    const result = await executeCollectionAction(borrowerId, actionType, approver);
    if (!result.ok) {
      return NextResponse.json(result, { status: result.status === "NOT_FOUND" ? 404 : 400 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

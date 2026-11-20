import { NextResponse } from "next/server";
import { runAllEngines } from "@/lib/engines";
import { getDashboardData } from "@/lib/dashboard/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const engines = await runAllEngines();
    const data = await getDashboardData();
    return NextResponse.json({ engines, data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

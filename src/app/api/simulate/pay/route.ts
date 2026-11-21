import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { borrowers, orders, payments, recoveryActions } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { markRecovered } from "@/lib/recovery/execute";
import { runRecon } from "@/lib/recon/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Simulation rail: the "customer" opens the recovery payment link and pays.
 * Inserts the SUCCESS payment exactly like a webhook would, flips the order
 * to PAID, confirms the recovery action, and re-runs recon — the dashboard
 * shows the money moving to in-flight (T+1) and the recoverable bucket
 * dropping. Clearly labeled as simulation; with live Cashfree keys the same
 * moment arrives via the verified webhook instead.
 */
export async function GET(req: Request) {
  try {
    const linkId = new URL(req.url).searchParams.get("linkId") ?? "";

    // collections links: preview from the borrower record
    if (linkId.startsWith("klear-collect-")) {
      const withoutPrefix = linkId.replace(/^klear-collect-/, "");
      const tsDash = withoutPrefix.lastIndexOf("-");
      const borrowerId = tsDash > 0 ? withoutPrefix.slice(0, tsDash) : withoutPrefix;
      const db = getDb();
      const bRows = await db.select().from(borrowers).where(eq(borrowers.id, borrowerId)).limit(1);
      if (bRows.length === 0) {
        return NextResponse.json({ error: "borrower not found" }, { status: 404 });
      }
      const b = bRows[0];
      return NextResponse.json({
        orderId: `collect_${b.loanNo}`,
        amountPaise: b.amountDue,
        customerName: b.name,
        status: "DUE",
        merchantName: process.env.MERCHANT_NAME ?? "Sunrise Organics",
      });
    }

    const withoutPrefix = linkId.replace(/^klear-recover-/, "");
    const tsDash = withoutPrefix.lastIndexOf("-");
    const orderId = tsDash > 0 ? withoutPrefix.slice(0, tsDash) : withoutPrefix;
    const db = getDb();
    const rows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: "order not found" }, { status: 404 });
    }
    return NextResponse.json({
      orderId: rows[0].id,
      amountPaise: rows[0].amount,
      customerName: rows[0].customerName,
      status: rows[0].status,
      merchantName: process.env.MERCHANT_NAME ?? "Sunrise Organics",
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const { linkId } = z.object({ linkId: z.string().min(3) }).parse(await req.json());

    // dispatch: recovery links (merchant back office) vs collection links
    // (lender collections) share one simulated customer checkout
    if (linkId.startsWith("klear-collect-")) {
      const { recordCollectionPayment } = await import("@/lib/collections/actions");
      const res = await recordCollectionPayment(linkId);
      const db = getDb();
      const bRows = await db.select().from(orders).where(eq(orders.id, `order_collect_${res.borrowerId}`)).all();
      void bRows;
      return NextResponse.json({
        paid: true,
        mode: "collections",
        borrowerId: res.borrowerId,
        partial: res.partial,
        note: res.partial
          ? "Partial payment recorded. The queue re-forms with the remaining amount."
          : "Payment recorded. The queue re-forms without this borrower.",
      });
    }

    // linkId format: klear-recover-<orderId>-<timestamp>
    const withoutPrefix = linkId.replace(/^klear-recover-/, "");
    const tsDash = withoutPrefix.lastIndexOf("-");
    const orderId = tsDash > 0 ? withoutPrefix.slice(0, tsDash) : withoutPrefix;

    const db = getDb();
    const orderRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (orderRows.length === 0) {
      return NextResponse.json({ error: "order not found" }, { status: 404 });
    }
    const order = orderRows[0];

    const actionRows = await db
      .select()
      .from(recoveryActions)
      .where(eq(recoveryActions.orderId, orderId))
      .orderBy(desc(recoveryActions.createdAt))
      .limit(1);

    const now = Date.now();
    const payId = `pay_sim_${now}`;

    db.insert(payments)
      .values({
        id: payId,
        orderId,
        amount: order.amount,
        status: "SUCCESS",
        method: "upi",
        bankReference: `UTRSIM${now % 100000000}`,
        customerName: order.customerName,
        createdAt: now,
        raw: JSON.stringify({ simulated: true, via: "recovery-link" }),
      })
      .onConflictDoNothing()
      .run();

    db.update(orders).set({ status: "PAID" }).where(eq(orders.id, orderId)).run();

    if (actionRows.length > 0) {
      await markRecovered(actionRows[0].id, payId);
    }

    const recon = await runRecon();

    return NextResponse.json({
      paid: true,
      orderId,
      paymentId: payId,
      amountPaise: order.amount,
      recon: {
        klearScore: recon.klearScore,
        inFlightValuePaise: recon.inFlightValuePaise,
        atRiskValuePaise: recon.atRiskValuePaise,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

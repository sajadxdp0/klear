"use client";

import { use, useEffect, useState } from "react";
import { Check, Smartphone } from "lucide-react";
import { formatINR } from "@/lib/money";

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[transform,background-color] duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-klear/40 disabled:pointer-events-none disabled:opacity-50";

function Mark({ size = 36 }: { size?: number }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden>
      <rect x="16" y="16" width="480" height="480" rx="112" fill="#101820" />
      <path
        d="M128 268 L222 362 L384 158"
        fill="none"
        stroke="#0B7A5E"
        strokeWidth="58"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="398" cy="142" r="30" fill="#3ED598" />
    </svg>
  );
}

export default function SimulatePayPage({
  params,
}: {
  params: Promise<{ linkId: string }>;
}) {
  const { linkId } = use(params);
  const [info, setInfo] = useState<{
    orderId: string;
    amountPaise: number;
    customerName: string | null;
    status: string;
  } | null>(null);
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/simulate/pay?linkId=${encodeURIComponent(linkId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("order not found"))))
      .then(setInfo)
      .catch((e) => setError(String(e.message ?? e)));
  }, [linkId]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/simulate/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "payment failed");
      setPaid(true);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6">
      <div className="w-full rounded-2xl border border-hairline bg-white p-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mark size={36} />
            <div>
              <div className="text-sm font-semibold">Klear · Recovery</div>
              <div className="text-xs text-mist">for Sunrise Organics</div>
            </div>
          </div>
          <span className="rounded-full bg-warn/10 px-2.5 py-1 text-[11px] font-medium text-warn">
            Simulation
          </span>
        </div>

        <div className="mt-8 border-t border-hairline pt-6">
          <div className="text-[11px] text-mist">Amount to pay</div>
          <div className="tnum mt-1 text-4xl font-semibold tracking-[-0.02em]">
            {info ? formatINR(info.amountPaise) : "—"}
          </div>
          <div className="mt-2 text-sm text-mist">
            {info?.customerName ? `For ${info.customerName}` : "Loading order"}
            {info ? <span className="tnum"> · order {info.orderId.slice(0, 18)}</span> : null}
          </div>
        </div>

        {paid ? (
          <div className="mt-8 flex items-center gap-3 rounded-xl border border-klear/30 bg-klear/5 p-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-klear/10 text-klear">
              <Check size={18} strokeWidth={2} />
            </span>
            <div>
              <div className="font-semibold text-klear">Payment successful</div>
              <div className="text-xs text-mist">
                Klear has been notified — your books update instantly
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={pay}
            disabled={busy || !info}
            className={`${BTN_BASE} mt-8 w-full bg-ink px-4 py-3.5 text-white hover:bg-klear`}
          >
            <Smartphone size={16} strokeWidth={1.5} />
            {busy ? "Paying" : "Pay via UPI"}
          </button>
        )}

        {error ? <div className="mt-3 text-sm text-block">{error}</div> : null}
        <div className="mt-6 text-center text-[11px] leading-5 text-mist">
          Simulated checkout standing in for the Cashfree-hosted payment link. With live keys,
          this moment arrives via a verified webhook instead
        </div>
      </div>
    </main>
  );
}

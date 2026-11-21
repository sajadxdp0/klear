"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock, FileSearch, Languages, RefreshCw, Send, ShieldCheck, X } from "lucide-react";
import type { QueueView, RankedBorrower } from "@/lib/collections/rank";
import { formatINR, formatINRCompact } from "@/lib/money";

const BTN_BASE =
  "inline-flex items-center gap-1.5 rounded-lg font-medium transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-klear/40 disabled:pointer-events-none disabled:opacity-50";

interface ActionRow {
  id: number;
  borrowerId: string;
  actionType: string;
  rationale: string;
  status: string;
  approvedBy: string | null;
  result: Record<string, unknown> | null;
  createdAt: number;
}

interface OverviewPayload {
  queue: QueueView;
  actions: ActionRow[];
  meta: { sarvamConfigured: boolean; outcomeBlind: boolean };
}

export default function CollectionsPage() {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [approver, setApprover] = useState("Collections Manager");
  const [toast, setToast] = useState<string | null>(null);
  const resultsByBorrower = useRef<Record<string, Record<string, unknown>>>({});

  const refresh = useCallback(async () => {
    const res = await fetch("/api/collections/overview");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function act(borrowerId: string, actionType: string, name: string) {
    setBusy(`${borrowerId}-${actionType}`);
    try {
      const res = await fetch("/api/collections/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ borrowerId, actionType, approver }),
      });
      const body = await res.json();
      if (!res.ok) {
        setToast(body.error ?? "action failed");
        return;
      }
      if (body.result) resultsByBorrower.current[borrowerId] = body.result;
      const linkUrl = body.result?.linkUrl as string | undefined;
      const verified = body.result?.verified as boolean | undefined;
      setToast(
        verified === true
          ? `${name}: claim verified in the ledger, removed from the queue`
          : verified === false
            ? `${name}: no payment found, a kind link goes out instead`
            : linkUrl
              ? `${name}: payment link issued${body.result?.simulated ? " (simulation)" : ""}`
              : `${name}: ${actionType.toLowerCase().replace("_", " ")} recorded`
      );
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return (
      <main className="mx-auto flex min-h-screen max-w-[1440px] items-center justify-center px-8">
        <span className="text-sm text-mist">Klear is reading the book</span>
      </main>
    );
  }

  const q = data.queue;
  const top = q.active.slice(0, 8);
  const rest = q.active.slice(8, 14);
  const hardship = q.active.find((b) => b.id === "bor_hardship");
  const serial = q.active.find((b) => b.id === "bor_serial_promiser");

  return (
    <main className="mx-auto max-w-[1440px] px-8 pb-20 pt-6">
      {/* header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 512 512" className="h-9 w-9" aria-hidden>
            <rect x="16" y="16" width="480" height="480" rx="112" fill="#101820" />
            <path d="M128 268 L222 362 L384 158" fill="none" stroke="#0B7A5E" strokeWidth="58" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="398" cy="142" r="30" fill="#3ED598" />
          </svg>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Klear Collections</h1>
            <div className="text-xs text-mist">who will pay first, and why · Meena&apos;s book</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`rounded-full px-2.5 py-1 font-medium ${q.callingWindow.open ? "bg-klear/10 text-klear" : "bg-warn/10 text-warn"}`}>
            <Clock size={11} strokeWidth={1.5} className="mr-1 inline" />
            {q.callingWindow.open ? "calling window open" : "outside calling window"} · {q.callingWindow.istTime} IST
          </span>
          <span className="rounded-full bg-mist/10 px-2.5 py-1 font-medium text-mist">
            {q.stats.bookSize} accounts · {formatINRCompact(q.stats.rupeesInQueue)} in queue
          </span>
          <label className="flex items-center gap-1.5 rounded-full border border-hairline bg-white px-3 py-1">
            <span className="text-[11px] text-mist">acting as</span>
            <input
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
              className="w-32 bg-transparent text-[11px] font-medium outline-none"
              aria-label="Approver name recorded on approvals"
            />
          </label>
        </div>
      </header>

      {toast ? (
        <div key={toast} className="toast-enter mt-4 rounded-lg border border-klear/30 bg-klear/5 px-4 py-2.5 text-sm text-klear">
          {toast}
        </div>
      ) : null}

      {/* lane 1: today's calling set */}
      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-mist">Call today · the ranker&apos;s first set, reasons attached</h2>
          <span className="text-[11px] text-mist">
            naive list order would find {(q.stats.bookSize)} accounts in loan order; our top 8 is measured better in the eval
          </span>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {top.map((b) => (
            <BorrowerCard key={b.id} b={b} busy={busy} act={act} result={resultsByBorrower.current[b.id]} compact />
          ))}
        </div>
      </section>

      {/* lane 2: verify first */}
      {q.needsVerification.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-mist">Verify first · claims of payment, checked against the ledger</h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {q.needsVerification.map((b) => (
              <BorrowerCard key={b.id} b={b} busy={busy} act={act} result={resultsByBorrower.current[b.id]} verify />
            ))}
          </div>
        </section>
      ) : null}

      {/* lane 3: kindness + the honest refusal */}
      <section className="mt-8 grid gap-3 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-medium text-mist">Offer a way forward · hardship gets a partial, never pressure</h2>
          <div className="mt-3">
            {hardship ? (
              <BorrowerCard b={hardship} busy={busy} act={act} result={resultsByBorrower.current[hardship.id]} partial />
            ) : null}
          </div>
        </div>
        <div>
          <h2 className="text-sm font-medium text-mist">Held back today · the queue refuses to waste calls here</h2>
          <div className="mt-3">
            {serial ? (
              <BorrowerCard b={serial} busy={busy} act={act} result={resultsByBorrower.current[serial.id]} held />
            ) : null}
          </div>
        </div>
      </section>

      {/* lane 4: rest of the book, compact */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-mist">The rest of the book · ranked, not forgotten</h2>
        <div className="mt-3 overflow-hidden rounded-2xl border border-hairline bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-hairline text-[11px] text-mist">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Due</th>
                <th className="px-4 py-2 font-medium">Overdue</th>
                <th className="px-4 py-2 font-medium">Why this rank</th>
              </tr>
            </thead>
            <tbody>
              {rest.map((b) => (
                <tr key={b.id} className="border-b border-hairline transition-colors last:border-0 hover:bg-paper">
                  <td className="tnum px-4 py-2 text-mist">{b.rank}</td>
                  <td className="px-4 py-2 font-medium">{b.name}</td>
                  <td className="tnum px-4 py-2">{formatINR(b.amountDue)}</td>
                  <td className="tnum px-4 py-2 text-mist">{b.daysOverdue}d</td>
                  <td className="px-4 py-2 text-xs text-ink/80">{b.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* resolved lane */}
      {q.resolved.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-mist">Resolved today · paid, verified, or deferred with a reason</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {q.resolved.map((b) => (
              <div key={b.id} className="animate-stamp rounded-xl border border-hairline bg-white p-4">
                <div className="flex items-center gap-2">
                  <Check size={14} strokeWidth={1.5} className="text-klear" />
                  <span className="text-sm font-medium">{b.name}</span>
                  <span className="ml-auto text-[11px] font-medium text-klear">{b.status.replace("_", " ")}</span>
                </div>
                <div className="tnum mt-1 text-xs text-mist">{formatINR(b.amountDue)} · {b.loanNo}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="mt-10 text-center text-[11px] text-mist">
        Klear Collections · the ranker never sees held-back outcomes · no name, language, area or gender signal enters the score · the eval proves it
      </footer>
    </main>
  );
}

/* ── borrower card ─────────────────────────────────────────────────────── */

function BorrowerCard({
  b,
  busy,
  act,
  result,
  compact,
  verify,
  partial,
  held,
}: {
  b: RankedBorrower;
  busy: string | null;
  act: (borrowerId: string, actionType: string, name: string) => Promise<void>;
  result?: Record<string, unknown>;
  compact?: boolean;
  verify?: boolean;
  partial?: boolean;
  held?: boolean;
}) {
  const draft = result?.message as string | undefined;
  const linkUrl = result?.linkUrl as string | undefined;
  const verified = result?.verified as boolean | undefined;

  return (
    <div
      className={`rounded-xl border border-hairline bg-white p-4 ${held ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {b.rank > 0 ? (
          <span className="tnum rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-white">
            #{b.rank}
          </span>
        ) : null}
        <span className="text-sm font-semibold">{b.name}</span>
        <span className="rounded-full bg-mist/10 px-2 py-0.5 text-[10px] font-medium text-mist">
          <Languages size={10} strokeWidth={1.5} className="mr-0.5 inline" />
          {b.language}
        </span>
        <span className="tnum text-sm">{formatINR(b.amountDue)}</span>
        <span className="text-[11px] text-mist">{b.daysOverdue}d overdue</span>
      </div>

      <div className="mt-2 text-sm leading-6 text-ink/90">{b.reason}</div>
      {b.note ? (
        <div className="mt-1 text-xs italic leading-5 text-mist">&ldquo;{b.note}&rdquo;</div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {verify ? (
          <button
            onClick={() => act(b.id, "VERIFY_PAID", b.name)}
            disabled={busy === `${b.id}-VERIFY_PAID`}
            className={`${BTN_BASE} border border-klear/40 bg-klear/5 px-3 py-1.5 text-xs text-klear hover:bg-klear/10`}
          >
            <ShieldCheck size={16} strokeWidth={1.5} />
            {busy === `${b.id}-VERIFY_PAID` ? "Checking" : verified === undefined ? "Verify against ledger" : "Check again"}
          </button>
        ) : null}
        {!held && !verify ? (
          <>
            <button
              onClick={() => act(b.id, "PAYMENT_LINK", b.name)}
              disabled={busy === `${b.id}-PAYMENT_LINK`}
              className={`${BTN_BASE} bg-ink px-3 py-1.5 text-xs text-white hover:bg-klear`}
            >
              <Send size={16} strokeWidth={1.5} />
              {busy === `${b.id}-PAYMENT_LINK` ? "Sending" : "Send payment link"}
            </button>
            {partial ? (
              <button
                onClick={() => act(b.id, "PARTIAL_LINK", b.name)}
                disabled={busy === `${b.id}-PARTIAL_LINK`}
                className={`${BTN_BASE} border border-klear/40 bg-klear/5 px-3 py-1.5 text-xs text-klear hover:bg-klear/10`}
              >
                {busy === `${b.id}-PARTIAL_LINK` ? "Offering" : "Offer partial payment"}
              </button>
            ) : null}
            <button
              onClick={() => act(b.id, "DEFER", b.name)}
              disabled={busy === `${b.id}-DEFER`}
              className={`${BTN_BASE} border border-hairline px-3 py-1.5 text-xs text-mist hover:border-klear hover:text-klear`}
            >
              <Clock size={16} strokeWidth={1.5} />
              Defer to payday
            </button>
          </>
        ) : null}
        {!held && !verify && compact ? (
          <button
            onClick={() => act(b.id, "MARK_LAPSED", b.name)}
            disabled={busy === `${b.id}-MARK_LAPSED`}
            className={`${BTN_BASE} px-2.5 py-1.5 text-xs text-mist hover:text-warn`}
          >
            <X size={14} strokeWidth={1.5} />
            Promise lapsed
          </button>
        ) : null}
      </div>

      {verified !== undefined ? (
        <div className={`mt-2 rounded border border-hairline bg-paper p-3 text-xs leading-5 ${verified ? "text-klear" : "text-warn"}`}>
          <FileSearch size={13} strokeWidth={1.5} className="mr-1 inline" />
          {verified
            ? "Verified in the ledger. Removed from the queue with our thanks, no wasted call."
            : "No payment found against this loan. The claim does not hold. A kind link goes out instead."}
        </div>
      ) : null}

      {draft ? (
        <div className="mt-2 rounded border border-hairline bg-paper p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-mist">message draft · {b.language}</div>
          <div className="mt-1 text-xs leading-5">{draft}</div>
          {linkUrl ? (
            <a
              href={linkUrl}
              target="_blank"
              rel="noreferrer"
              className={`${BTN_BASE} mt-2 border border-klear/40 bg-klear/5 px-3 py-1 text-[11px] font-medium text-klear hover:bg-klear/10`}
            >
              Open payment link ↗
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

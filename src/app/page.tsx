"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  ExternalLink,
  FileSearch,
  Mic,
  RefreshCw,
  Square,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import type { DashboardData } from "@/lib/dashboard/data";
import { formatINR, formatINRCompact } from "@/lib/money";

/* ── small primitives ─────────────────────────────────────────────────── */

function Mark({ size = 34 }: { size?: number }) {
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

const STATUS_STYLE: Record<string, string> = {
  MATCHED: "bg-klear/10 text-klear",
  PARTIAL: "bg-mist/10 text-mist",
  MISMATCH: "bg-block/10 text-block",
  MISSING: "bg-warn/10 text-warn",
  DUPLICATE: "bg-block/10 text-block",
  OK: "bg-klear/10 text-klear",
  REVIEW: "bg-warn/10 text-warn",
  BLOCK: "bg-block/10 text-block",
  PROPOSED: "bg-warn/10 text-warn",
  APPROVED: "bg-klear/10 text-klear",
  EXECUTED: "bg-klear/10 text-klear",
  REJECTED: "bg-mist/10 text-mist",
  FAILED: "bg-block/10 text-block",
};

function Chip({ status, children }: { status: string; children?: React.ReactNode }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        STATUS_STYLE[status] ?? "bg-mist/10 text-mist"
      }`}
    >
      {children ?? status}
    </span>
  );
}

/** Tweens a changed number so the score "moves" to its new value. */
function useCountUp(target: number, duration = 600) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      fromRef.current = target;
    };
  }, [target, duration]);
  return value;
}

/** A money figure that counts to its new value instead of jumping. */
function MoneyTween({ paise, className }: { paise: number; className?: string }) {
  const v = useCountUp(paise, 700);
  return <span className={`tnum ${className ?? ""}`}>{formatINRCompact(v)}</span>;
}

const BTN_BASE =
  "inline-flex items-center gap-2 rounded-lg font-medium transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-klear/40 disabled:pointer-events-none disabled:opacity-50";

function stripMd(s: string) {
  return s.replace(/\*\*/g, "").replace(/^#+\s*/gm, "");
}

/* ── page ─────────────────────────────────────────────────────────────── */

interface ChatEntry {
  role: "user" | "klear";
  text: string;
  heard?: boolean; // true when the text came in as speech
  trace?: { name: string }[];
}

/** Encodes any recorded blob to 16 kHz mono PCM16 WAV, the format Saaras handles best. */
async function blobToWav16k(blob: Blob): Promise<Blob> {
  const AudioCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const decodeCtx = new AudioCtor();
  const decoded = await decodeCtx.decodeAudioData(await blob.arrayBuffer());
  void decodeCtx.close();

  const length = Math.max(1, Math.ceil(decoded.duration * 16000));
  const offline = new OfflineAudioContext(1, length, 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const data = rendered.getChannelData(0);

  const buffer = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + data.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, data.length * 2, true);
  let offset = 44;
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

const LEG_LABEL: Record<string, string> = {
  ORDER_PAYMENT: "Order ↔ Payment",
  PAYMENT_SETTLEMENT: "Payment ↔ Settlement",
  SETTLEMENT_BANK: "Settlement ↔ Bank",
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [approver, setApprover] = useState("Merchant Admin");
  const [briefing, setBriefing] = useState<{ text: string; mode: string } | null>(null);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [evidenceById, setEvidenceById] = useState<
    Record<number, { summary: string; mode: string }>
  >({});
  const fileRef = useRef<HTMLInputElement>(null);
  const stampedRef = useRef<Set<number>>(new Set());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [playingBriefing, setPlayingBriefing] = useState(false);
  // hook order must be stable across renders — call before the loading return
  const score = data?.facts.klearScore ?? 0;
  const animatedScore = useCountUp(score);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/overview");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // keyboard path to the primary action (never animated, per the motion rules)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if ((e.key === "r" || e.key === "R") && !e.metaKey && !e.ctrlKey) {
        runEngines();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runEngines() {
    setBusy("engines");
    try {
      const res = await fetch("/api/engines/run", { method: "POST" });
      if (res.ok) {
        const body = await res.json();
        setData(body.data);
        setToast(
          `Engines run. Score ${(body.engines.recon.klearScore * 100).toFixed(1)}%, ${body.engines.fraud.review + body.engines.fraud.block} flags, ${body.engines.triage.proposals} new proposals`
        );
      }
    } finally {
      setBusy(null);
    }
  }

  async function ingestStatement(file: File) {
    setBusy("ingest");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/bank/ingest", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) {
        setToast(body.error ?? "ingest failed");
        return;
      }
      setToast(
        `Statement parsed (${body.mode === "sarvam-docai" ? "Sarvam Vision" : "CSV parser"}). ${body.inserted} new bank txns, score now ${(body.recon.klearScore * 100).toFixed(1)}%`
      );
      await refresh();
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function act(path: string, payload: Record<string, unknown>, label: string) {
    setBusy(`action-${payload.actionId}`);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setToast(body.error ?? body.note ?? "action failed");
        return null;
      }
      setToast(label);
      await refresh();
      return body;
    } finally {
      setBusy(null);
    }
  }

  async function resolveException(matchId: number) {
    setBusy(`resolve-${matchId}`);
    try {
      const res = await fetch("/api/recon/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, approver }),
      });
      const body = await res.json();
      if (!res.ok) {
        setToast(body.error ?? "could not resolve");
        return;
      }
      setToast("Exception resolved and recorded in the ledger");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function fetchBriefing() {
    setBusy("briefing");
    try {
      const res = await fetch("/api/briefing");
      if (res.ok) {
        const b = await res.json();
        setBriefing({ text: b.text, mode: b.mode });
      }
    } finally {
      setBusy(null);
    }
  }

  async function buildEvidence(flagId: number) {
    setBusy(`evidence-${flagId}`);
    try {
      const res = await fetch("/api/fraud/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setToast(body.error ?? "evidence build failed");
        return;
      }
      setEvidenceById((m) => ({
        ...m,
        [flagId]: { summary: body.summary, mode: body.mode },
      }));
      setToast(
        body.mode === "live"
          ? "Evidence pack built via Cashfree SecureID, recorded in the audit ledger"
          : "Evidence pack built (simulation). Runs live with SecureID keys"
      );
    } finally {
      setBusy(null);
    }
  }

  async function ask() {
    const q = chatInput.trim();
    if (!q) return;
    setChatInput("");
    setChat((c) => [...c, { role: "user", text: q }]);
    await runCopilot(q, false);
  }

  async function runCopilot(question: string, heard: boolean) {
    setBusy("copilot");
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const body = await res.json();
      if (!res.ok) {
        setChat((c) => [...c, { role: "klear", text: body.error ?? "Ask Klear unavailable" }]);
      } else {
        setChat((c) => [
          ...c,
          { role: "klear", text: body.answer, trace: body.trace?.map((t: { name: string }) => ({ name: t.name })) },
        ]);
        await refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const raw = new Blob(chunksRef.current, { type: recorder.mimeType });
        if (raw.size === 0) return;
        setBusy("voice");
        try {
          const wav = await blobToWav16k(raw);
          const form = new FormData();
          form.append("file", wav, "question.wav");
          const res = await fetch("/api/copilot/voice", { method: "POST", body: form });
          const body = await res.json();
          if (!res.ok) {
            setToast(body.error ?? "transcription failed");
            return;
          }
          setChat((c) => [...c, { role: "user", text: body.transcript, heard: true }]);
          await runCopilot(body.transcript, true);
        } finally {
          setBusy(null);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setToast("microphone unavailable in this browser, type your question instead");
    }
  }

  async function playBriefingAudio() {
    setPlayingBriefing(true);
    try {
      const res = await fetch("/api/briefing/audio");
      const body = await res.json();
      if (!res.ok || !body.audioBase64) {
        setToast(body.error ?? "briefing audio needs SARVAM_API_KEY");
        return;
      }
      const audio = new Audio(`data:${body.format ?? "audio/wav"};base64,${body.audioBase64}`);
      audio.onended = () => setPlayingBriefing(false);
      audio.onerror = () => setPlayingBriefing(false);
      await audio.play();
      setToast("Bulbul briefing, Hindi");
    } catch (err) {
      setPlayingBriefing(false);
      setToast(String((err as Error).message ?? "playback failed"));
    }
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-mist">
          <Mark size={28} />
          <span className="text-sm">Klear is reading the ledger</span>
        </div>
      </main>
    );
  }

  const f = data.facts;
  const scorePct = (animatedScore * 100).toFixed(1);

  return (
    <main className="mx-auto max-w-[1440px] px-8 pb-20 pt-6">
      {/* header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Mark />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Klear</h1>
            <div className="text-xs text-mist">every rupee, cleared · Sunrise Organics</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span
            className={`rounded-full px-2.5 py-1 font-medium ${
              data.meta.cashfreeConfigured ? "bg-klear/10 text-klear" : "bg-warn/10 text-warn"
            }`}
          >
            {data.meta.cashfreeConfigured ? "Cashfree live" : "Cashfree simulation"}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 font-medium ${
              data.meta.sarvamConfigured ? "bg-klear/10 text-klear" : "bg-mist/10 text-mist"
            }`}
          >
            {data.meta.sarvamConfigured ? "Sarvam 105B" : "Sarvam off"}
          </span>
          <span className="rounded-full bg-mist/10 px-2.5 py-1 font-medium text-mist">
            model {data.meta.model.onnx ? "lgbm-onnx" : data.meta.model.weights ? "logistic" : "rules"}
          </span>
          <label className="flex items-center gap-1.5 rounded-full border border-hairline bg-white px-3 py-1">
            <span className="text-[11px] text-mist">acting as</span>
            <input
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
              className="w-28 bg-transparent text-base sm:w-24 sm:text-[11px] font-medium outline-none"
              aria-label="Approver name recorded on approvals"
            />
          </label>
        </div>
      </header>

      {/* controls */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={runEngines}
          disabled={busy === "engines"}
          className={`${BTN_BASE} bg-ink px-4 py-2 text-sm text-white hover:bg-klear`}
        >
          <RefreshCw size={16} strokeWidth={1.5} />
          {busy === "engines" ? "Running" : "Run engines"}
          <kbd className="rounded border border-white/20 px-1 font-sans text-[10px] font-medium leading-4 text-white/60">
            R
          </kbd>
        </button>
        <button
          onClick={fetchBriefing}
          disabled={busy === "briefing"}
          className={`${BTN_BASE} border border-hairline bg-white px-4 py-2 text-sm hover:border-klear`}
        >
          <AudioLines size={16} strokeWidth={1.5} />
          {busy === "briefing" ? "Writing" : "Morning briefing"}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy === "ingest"}
          className={`${BTN_BASE} border border-hairline bg-white px-4 py-2 text-sm hover:border-klear`}
        >
          <Upload size={16} strokeWidth={1.5} />
          {busy === "ingest" ? "Parsing" : "Import bank statement"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) ingestStatement(file);
          }}
        />
      </div>

      {toast ? (
        <div
          key={toast}
          className="toast-enter mt-4 rounded-lg border border-klear/30 bg-klear/5 px-4 py-2.5 text-sm text-klear"
        >
          {toast}
        </div>
      ) : null}

      {/* hero: the one bright element, the score */}
      <section className="mt-6 grid gap-4 md:grid-cols-[280px_1fr]">
        <div className="relative overflow-hidden rounded-2xl bg-ink p-6 text-white">
          <svg
            viewBox="0 0 512 512"
            className="pointer-events-none absolute -bottom-12 -right-10 h-44 w-44 opacity-[0.08]"
            aria-hidden
          >
            <path
              d="M128 268 L222 362 L384 158"
              fill="none"
              stroke="#3ED598"
              strokeWidth="58"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="relative">
          <div className="text-xs text-white/60">Klear score</div>
          <div className="tnum mt-2 text-5xl font-semibold tracking-[-0.02em]">
            {scorePct}
            <span className="text-2xl font-normal text-white/60">%</span>
          </div>
          <div className="mt-1 text-xs text-white/60">
            of collected money cleared through the full chain
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full w-full origin-left rounded-full bg-mint"
              style={{
                transform: `scaleX(${Math.max(0.015, animatedScore)})`,
                transition: "transform 600ms var(--ease-out)",
              }}
            />
          </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Collected", value: f.money.orderValuePaise, tone: "text-ink" },
            { label: "Cleared", value: f.money.clearedValuePaise, tone: "text-klear" },
            { label: "In flight (T+1)", value: f.money.inFlightValuePaise, tone: "text-mist" },
            { label: "At risk", value: f.money.atRiskValuePaise, tone: "text-block" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-hairline bg-white p-5">
              <div className="text-[11px] text-mist">{s.label}</div>
              <div className={`mt-2 text-2xl font-semibold ${s.tone}`}>
                <MoneyTween paise={s.value} />
              </div>
            </div>
          ))}
          <div className="col-span-2 rounded-2xl border border-hairline bg-white p-5 sm:col-span-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[11px] text-mist">Recoverable · failed payments in queue</div>
              <div className="text-2xl font-semibold text-warn">
                <MoneyTween paise={f.recovery.recoverablePaise} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* legs: one instrument, three columns */}
      <section className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-white">
        <div className="grid divide-hairline sm:grid-cols-3 sm:divide-x">
          {(["ORDER_PAYMENT", "PAYMENT_SETTLEMENT", "SETTLEMENT_BANK"] as const).map((leg) => {
            const counts = f.legCounts?.[leg] ?? {
              MATCHED: 0, PARTIAL: 0, MISMATCH: 0, MISSING: 0, DUPLICATE: 0,
            };
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            const problems =
              counts.MISMATCH + counts.MISSING + counts.DUPLICATE + counts.PARTIAL;
            return (
              <div key={leg} className="p-5">
                <div className="text-[11px] text-mist">{LEG_LABEL[leg]}</div>
                <div className="tnum mt-2 text-2xl font-semibold">
                  {counts.MATCHED}
                  <span className="text-sm font-normal text-mist"> / {total} matched</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {counts.MISMATCH > 0 ? <Chip status="MISMATCH" /> : null}
                  {counts.MISSING > 0 ? <Chip status="MISSING" /> : null}
                  {counts.DUPLICATE > 0 ? <Chip status="DUPLICATE" /> : null}
                  {counts.PARTIAL > 0 ? <Chip status="PARTIAL" /> : null}
                  {problems === 0 ? <Chip status="MATCHED" /> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* briefing */}
      {briefing ? (
        <section className="mt-6 rounded-2xl border border-klear/25 bg-klear/5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-klear">
              Morning briefing ·{" "}
              {briefing.mode === "sarvam-105b"
                ? "Sarvam-105B around Klear's own numbers"
                : "deterministic template (no API key)"}
            </div>
            <button
              onClick={playBriefingAudio}
              disabled={playingBriefing}
              className={`${BTN_BASE} border border-klear/40 bg-klear/5 px-3 py-1.5 text-xs font-medium text-klear hover:bg-klear/10`}
            >
              <Volume2 size={16} strokeWidth={1.5} />
              {playingBriefing ? "Playing" : "Listen in Hindi"}
            </button>
          </div>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6">
            {stripMd(briefing.text)}
          </pre>
        </section>
      ) : null}

      {/* exceptions + flags */}
      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-medium text-mist">Exceptions that don&apos;t close</h2>
          <div className="mt-3 space-y-2">
            {data.exceptions.length === 0 ? (
              <div className="rounded-xl border border-hairline bg-white p-4 text-sm text-mist">
                No exceptions. Every collected rupee cleared the full chain.
              </div>
            ) : (
              data.exceptions.map((e) => (
                <div
                  key={e.id}
                  className={`rounded-xl border border-hairline bg-white p-4 ${
                    e.resolved ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {e.resolved ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-mist/10 px-2 py-0.5 text-[11px] font-medium text-mist">
                        <Check size={12} strokeWidth={1.5} />
                        Resolved
                      </span>
                    ) : (
                      <Chip status={e.status} />
                    )}
                    <span className="text-[11px] text-mist">{LEG_LABEL[e.leg] ?? e.leg}</span>
                    <span className="tnum ml-auto text-[11px] font-medium text-mist">
                      {e.rule}
                    </span>
                    {!e.resolved ? (
                      <button
                        onClick={() => resolveException(e.id)}
                        disabled={busy === `resolve-${e.id}`}
                        className={`${BTN_BASE} px-2.5 py-1 text-[11px] text-mist hover:text-klear`}
                      >
                        <Check size={14} strokeWidth={1.5} />
                        Mark resolved
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-2 text-sm leading-6">{e.detail}</div>
                  {e.amountDelta !== 0 ? (
                    <div
                      className={`tnum mt-1 text-xs font-semibold ${
                        e.amountDelta < 0 ? "text-block" : "text-warn"
                      }`}
                    >
                      Δ {formatINR(e.amountDelta, { sign: true })}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-medium text-mist">Fraud flags, evidence-backed</h2>
          <div className="mt-3 space-y-2">
            {data.flags.length === 0 ? (
              <div className="rounded-xl border border-hairline bg-white p-4 text-sm text-mist">
                No review or block flags in the current sweep.
              </div>
            ) : (
              data.flags.map((fl) => (
                <div key={fl.id} className="rounded-xl border border-hairline bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip status={fl.band} />
                    <span className="text-sm font-medium">{fl.customer ?? "Unknown customer"}</span>
                    <span className="tnum text-sm">{fl.amount ? formatINR(fl.amount) : ""}</span>
                    <span className="tnum ml-auto text-[11px] font-medium text-mist">
                      score {fl.score.toFixed(2)}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {fl.reasons.slice(0, 3).map((r, i) => (
                      <li key={i} className="text-sm leading-6 text-ink/80">
                        · {r.label}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => buildEvidence(fl.id)}
                      disabled={busy === `evidence-${fl.id}`}
                      className={`${BTN_BASE} border border-klear/40 bg-klear/5 px-3 py-1.5 text-xs text-klear hover:bg-klear/10`}
                    >
                      <FileSearch size={16} strokeWidth={1.5} />
                      {busy === `evidence-${fl.id}` ? "Building" : "Build evidence pack"}
                    </button>
                    {evidenceById[fl.id] ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          evidenceById[fl.id].mode === "live"
                            ? "bg-klear/10 text-klear"
                            : "bg-warn/10 text-warn"
                        }`}
                      >
                        {evidenceById[fl.id].mode === "live" ? "SecureID" : "Simulation"}
                      </span>
                    ) : null}
                  </div>
                  {evidenceById[fl.id] ? (
                    <div className="mt-2 rounded border border-hairline bg-paper p-3 text-xs leading-5 text-ink/80">
                      {evidenceById[fl.id].summary}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* recovery */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-mist">
          Recovery · proposed by the agent, approved by you
        </h2>
        <div className="mt-3 space-y-2">
          {data.actions.length === 0 ? (
            <div className="rounded-xl border border-hairline bg-white p-4 text-sm text-mist">
              No recovery actions yet. Run engines to triage failed payments.
            </div>
          ) : (
            data.actions.slice(0, 14).map((a) => {
              const result = a.result
                ? (JSON.parse(a.result) as {
                    linkUrl?: string;
                    simulated?: boolean;
                    note?: string;
                    recovered?: boolean;
                  })
                : null;
              const recovered = result?.recovered === true;
              const justStamped = recovered && !stampedRef.current.has(a.id);
              if (recovered) stampedRef.current.add(a.id);
              return (
                <div
                  key={a.id}
                  className={`rounded-xl border border-hairline bg-white p-4 ${justStamped ? "animate-stamp" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {recovered ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-klear/10 px-2 py-0.5 text-[11px] font-medium text-klear">
                        <Check size={12} strokeWidth={1.5} />
                        Recovered
                      </span>
                    ) : (
                      <Chip status={a.status} />
                    )}
                    <span className="text-[11px] font-medium text-mist">{a.actionType}</span>
                    <span className="tnum text-xs text-mist">{a.orderId}</span>
                    {a.failureReason ? (
                      <span className="rounded-full bg-mist/10 px-2 py-0.5 text-[11px] text-mist">
                        {a.failureReason}
                      </span>
                    ) : null}
                    <div className="ml-auto flex items-center gap-2">
                      {a.status === "PROPOSED" ? (
                        <>
                          <button
                            onClick={() =>
                              act(
                                "/api/recovery/approve",
                                { actionId: a.id, approver },
                                `Approved by ${approver}, recorded in the ledger`
                              )
                            }
                            disabled={busy === `action-${a.id}`}
                            className={`${BTN_BASE} border border-hairline px-3 py-1.5 text-xs hover:border-klear`}
                          >
                            <Check size={16} strokeWidth={1.5} />
                            Approve
                          </button>
                          <button
                              onClick={async () => {
                              await act(
                                "/api/recovery/approve",
                                { actionId: a.id, approver },
                                "Approved"
                              );
                              await act(
                                "/api/recovery/execute",
                                { actionId: a.id },
                                `Executed. Payment link issued${result?.simulated ? " (simulation)" : ""}`
                              );
                            }}
                            disabled={busy === `action-${a.id}`}
                            className={`${BTN_BASE} bg-ink px-3 py-1.5 text-xs text-white hover:bg-klear`}
                          >
                            Approve and send link
                          </button>
                          <button
                            onClick={() =>
                              act(
                                "/api/recovery/reject",
                                { actionId: a.id, approver },
                                "Rejected and logged, so the agent learns"
                              )
                            }
                            disabled={busy === `action-${a.id}`}
                            className={`${BTN_BASE} border border-hairline px-3 py-1.5 text-xs text-mist hover:border-block hover:text-block`}
                          >
                            <X size={16} strokeWidth={1.5} />
                            Reject
                          </button>
                        </>
                      ) : null}
                      {a.status === "APPROVED" ? (
                        <button
                          onClick={() =>
                            act(
                              "/api/recovery/execute",
                              { actionId: a.id },
                              `Executed. Payment link issued${result?.simulated ? " (simulation)" : ""}`
                            )
                          }
                          disabled={busy === `action-${a.id}`}
                          className={`${BTN_BASE} bg-ink px-3 py-1.5 text-xs text-white hover:bg-klear`}
                        >
                          Execute
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-ink/80">{a.rationale}</div>
                  {a.approvedBy ? (
                    <div className="mt-1 text-[11px] text-mist">approved by {a.approvedBy}</div>
                  ) : null}
                  {result?.linkUrl ? (
                    <div className="mt-2 flex items-center gap-2">
                      <a
                        href={result.linkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`${BTN_BASE} border border-klear/40 bg-klear/5 px-3 py-1.5 text-xs font-medium text-klear hover:bg-klear/10`}
                      >
                        <ExternalLink size={16} strokeWidth={1.5} />
                        Open payment link
                      </a>
                      {result.simulated ? (
                        <span className="rounded-full bg-warn/10 px-2 py-0.5 text-[11px] font-medium text-warn">
                          Simulation
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {result?.note ? (
                    <div className="mt-1 text-[11px] text-mist">{result.note}</div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* copilot */}
      <section className="mt-8 rounded-2xl border border-hairline bg-white p-6">
        <h2 className="text-sm font-medium text-mist">Ask Klear · copilot over your own ledger</h2>
        <div className="mt-4 space-y-3">
          {chat.map((m, i) => {
            const isLastKlear = m.role === "klear" && i === chat.length - 1;
            return (
              <div
                key={i}
                className={`rounded-xl px-4 py-3 text-sm leading-6 ${
                  m.role === "user"
                    ? "ml-16 bg-ink text-white"
                    : `mr-16 border border-hairline bg-paper${isLastKlear ? " reply-enter" : ""}`
                }`}
              >
                {m.heard ? (
                  <div className="mb-1 flex items-center gap-1 text-[11px] text-white/60">
                    <Mic size={11} strokeWidth={1.5} />
                    heard
                  </div>
                ) : null}
                <div className="whitespace-pre-wrap">{stripMd(m.text)}</div>
                {m.trace && m.trace.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.trace.map((t, j) => (
                      <span
                        key={j}
                        className="rounded-full bg-klear/10 px-2 py-0.5 text-[11px] font-medium text-klear"
                      >
                        tool {t.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={toggleRecording}
            disabled={busy === "voice"}
            className={`${BTN_BASE} border px-3 py-2.5 ${
              recording
                ? "border-block/40 bg-block/5 text-block"
                : "border-hairline bg-white hover:border-klear"
            }`}
            title={recording ? "Stop recording" : "Record a voice question"}
          >
            {recording ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-block opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-block" />
                </span>
                <Square size={16} strokeWidth={1.5} />
              </>
            ) : (
              <Mic size={16} strokeWidth={1.5} />
            )}
            {recording ? "Stop" : busy === "voice" ? "Hearing" : ""}
          </button>
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder="कल कितने payments fail हुए और क्यों?"
            className="flex-1 rounded-lg border border-hairline bg-paper px-4 py-2.5 text-base sm:text-sm outline-none transition-colors duration-150 focus:border-klear"
            aria-label="Ask Klear a question about your ledger"
          />
          <button
            onClick={ask}
            disabled={busy === "copilot" || !chatInput.trim()}
            className={`${BTN_BASE} bg-ink px-4 py-2.5 text-sm text-white hover:bg-klear`}
          >
            {busy === "copilot" ? "Thinking" : "Ask"}
          </button>
        </div>
        <div className="mt-2 text-[11px] text-mist">
          {recording
            ? "Recording. Speak in Hindi, Hinglish or English, then tap stop."
            : "Type a question, or tap the mic and just ask."}
          {data.meta.sarvamConfigured ? "" : " · the copilot answers live once SARVAM_API_KEY is in .env"}
        </div>
      </section>

      {/* audit */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-mist">
          Audit trail · every action, who took it, when
        </h2>
        <div className="mt-3 overflow-hidden rounded-2xl border border-hairline bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-hairline text-[11px] text-mist">
              <tr>
                <th className="px-4 py-2.5 font-medium">Actor</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Entity</th>
                <th className="px-4 py-2.5 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {data.audit.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-hairline transition-colors last:border-0 hover:bg-paper"
                >
                  <td className="px-4 py-2.5 font-medium">{a.actor}</td>
                  <td className="px-4 py-2.5">{a.action}</td>
                  <td className="px-4 py-2.5 text-mist">{a.entityId ?? a.entity}</td>
                  <td className="tnum px-4 py-2.5 text-right text-mist">
                    {new Date(a.createdAt).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-10 text-center text-[11px] text-mist">
        Klear · human-gated back office on Cashfree × Sarvam · money paths are deterministic, the
        copilot reasons, approvals are yours
      </footer>
    </main>
  );
}

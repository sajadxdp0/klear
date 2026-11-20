/**
 * Sarvam AI client — official `sarvamai` SDK.
 *
 *   Chat       Sarvam-105B (128K context, Indic reasoning) with
 *              structured outputs (json_schema) + tool calling
 *   Document AI  Sarvam Vision extract → bank statement transactions
 *   TTS        Bulbul v4 Flash → briefing audio (Hindi/English)
 *
 * Every function degrades honestly: without SARVAM_API_KEY the briefing
 * falls back to a deterministic template and Document AI falls back to
 * the CSV parser. The UI labels which mode produced what.
 */
import { SarvamAIClient } from "sarvamai";
import { bankTxnId, type ParsedBankTxn } from "@/lib/recon/ingest-bank";

export function sarvamConfigured(): boolean {
  return Boolean(process.env.SARVAM_API_KEY);
}

let client: SarvamAIClient | null = null;
function getClient(): SarvamAIClient {
  if (!client) {
    client = new SarvamAIClient({
      apiSubscriptionKey: process.env.SARVAM_API_KEY!,
    });
  }
  return client;
}

/* ── Chat ─────────────────────────────────────────────────────────────── */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  reasoning?: null | "low" | "medium" | "high";
}

export interface ChatToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

/**
 * Sarvam error spine (their docs): retry ONLY 429/500/502/503 with backoff;
 * 403 = bad key, 402 = out of credits (never retry), 4xx = request bug.
 * One retry covers the documented `503 model_overloaded` hiccup.
 */
function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number; response?: { status?: number } })
    ?.status ??
    (err as { response?: { status?: number } })?.response?.status;
  return status === 429 || status === 500 || status === 502 || status === 503;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isRetryable(err)) {
      await new Promise((r) => setTimeout(r, 1500));
      return fn();
    }
    throw err;
  }
}

export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
  tools?: unknown[]
): Promise<{ content: string | null; toolCalls: ChatToolCall[] }> {
  // Structural call: the SDK's streaming/non-streaming overloads are
  // finicky under bundlers; we never stream here.
  const completions = (
    getClient() as unknown as {
      chat: { completions: (o: unknown) => Promise<ChatCompletionLike> };
    }
  ).chat.completions;

  const base = {
    model: "sarvam-105b",
    messages,
    temperature: opts.temperature ?? 0.4,
    reasoning_effort: opts.reasoning ?? null, // thinking off: short, factual ops replies
    ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}),
  };

  // Gotcha (Sarvam's own skill docs): reasoning can silently eat the
  // budget → finish_reason "length" with content null. Retry once with
  // a bigger budget before giving up. Network layer retries 429/5xx once.
  for (const maxTokens of [opts.maxTokens ?? 1500, (opts.maxTokens ?? 1500) + 1200]) {
    const res = await withRetry(() => completions({ ...base, max_tokens: maxTokens }));
    const choice = res.choices[0];
    const msg = choice?.message;
    if (msg?.content || (msg?.tool_calls ?? []).length > 0) {
      return { content: msg?.content ?? null, toolCalls: msg?.tool_calls ?? [] };
    }
  }

  return { content: null, toolCalls: [] };
}

interface ChatCompletionLike {
  choices: {
    finish_reason?: string | null;
    message: {
      content: string | null;
      reasoning_content?: string | null;
      tool_calls?: ChatToolCall[];
    };
  }[];
}

/** Structured output via response_format json_schema (strict). */
export async function chatStructured<T>(
  messages: ChatMessage[],
  schemaName: string,
  schema: Record<string, unknown>,
  opts: ChatOptions = {}
): Promise<T | null> {
  const completions = (
    getClient() as unknown as {
      chat: { completions: (o: unknown) => Promise<ChatCompletionLike> };
    }
  ).chat.completions;

  const res = await withRetry(() =>
    completions({
      model: "sarvam-105b",
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 1200,
      reasoning_effort: null,
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema },
      },
    })
  );

  const content = res.choices[0]?.message?.content;
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/* ── Document AI: bank statement → transactions ───────────────────────── */

const BANK_SCHEMA = {
  type: "object",
  properties: {
    transactions: {
      type: "array",
      description: "Every transaction row in the bank statement table",
      items: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Value date column, format 'DD MMM YYYY' as printed, e.g. '20 Nov 2026'",
          },
          time: {
            type: "string",
            description: "Time column as printed, e.g. '14:32'. If missing use '12:00'.",
          },
          narration: {
            type: "string",
            description: "The full narration/description text of the row",
          },
          utr: {
            type: "string",
            description: "Chq/Ref number column (UPI/NEFT reference). Empty string if none.",
          },
          direction: {
            type: "string",
            description: "'CREDIT' for deposits, 'DEBIT' for withdrawals",
          },
          amount_rupees: {
            type: "number",
            description: "Transaction amount in rupees (decimal, e.g. 1234.56). Always positive.",
          },
        },
        required: ["date", "time", "narration", "utr", "direction", "amount_rupees"],
      },
    },
  },
  required: ["transactions"],
};

interface ExtractedBank {
  transactions: {
    date: string;
    time: string;
    narration: string;
    utr: string;
    direction: string;
    amount_rupees: number;
  }[];
}

const TERMINAL = new Set(["completed", "partially_completed", "failed", "rejected"]);

/**
 * Extracts transactions from a bank statement PDF via Sarvam Vision.
 * `fileBytes` is written to a temp file and passed as a read stream —
 * the exact pattern Sarvam's own SDK skill documents for JS.
 * Returns ParsedBankTxn[] (paise, deterministic IDs → idempotent ingest).
 */
export async function extractBankStatement(
  fileName: string,
  fileBytes: Buffer
): Promise<ParsedBankTxn[]> {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const pathMod = await import("node:path");

  const tmpPath = pathMod.join(os.tmpdir(), `klear-stmt-${Date.now()}-${fileName}`);
  fs.writeFileSync(tmpPath, fileBytes);

  const c = getClient() as unknown as {
    docAi: {
      extract(args: {
        file: NodeJS.ReadableStream[];
        schema: string;
        language: string;
        output_format: string;
        mode: string;
      }): Promise<{ job_id: string; status: string }>;
      getStatus(jobId: string): Promise<{ status: string }>;
      getResults(jobId: string): Promise<{ result: ExtractedBank }>;
    };
  };

  try {
    // mode: "advanced" — Sarvam's own guidance for financial statements:
    // it cross-checks that line items add up to the total (₹2.50/page).
    const job = await c.docAi.extract({
      file: [fs.createReadStream(tmpPath)],
      schema: JSON.stringify(BANK_SCHEMA),
      language: "en-IN",
      output_format: "json",
      mode: "advanced",
    });

    // poll to terminal (5s per Sarvam's guidance — tight loops burn quota)
    let status = job.status;
    for (let i = 0; i < 40; i++) {
      if (TERMINAL.has(status.toLowerCase())) break;
      await new Promise((r) => setTimeout(r, 5000));
      status = (await c.docAi.getStatus(job.job_id)).status;
    }
    if (!["completed", "partially_completed"].includes(status.toLowerCase())) {
      throw new Error(`Document AI job ended as ${status}`);
    }

    const results = await c.docAi.getResults(job.job_id);
    const txns = results.result?.transactions ?? [];

    return txns
      .map((t) => {
        const iso = Date.parse(`${t.date} ${t.time} UTC`);
        const txnDate = Number.isFinite(iso) ? iso : Date.now();
        const amount = Math.round(t.amount_rupees * 100);
        const utr = t.utr?.trim() || null;
        const narration = t.narration?.trim() || null;
        const direction = t.direction?.toUpperCase() === "DEBIT" ? "DEBIT" : "CREDIT";
        return {
          id: bankTxnId(utr, narration, txnDate, amount),
          txnDate,
          amount,
          direction: direction as "CREDIT" | "DEBIT",
          utr,
          narration,
          source: "SARVAM_DOC_AI",
        } satisfies ParsedBankTxn;
      })
      .filter((t) => t.amount > 0);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

/* ── STT: Saaras v4 (the "hears Hindi" front door) ─────────────────────── */

/** Domain vocabulary that biases recognition (saaras:v4 keyterm prompting). */
const STT_KEYTERMS = [
  "Klear", "Cashfree", "Sarvam", "UPI", "settlement", "rupee", "payment",
  "payments", "refund", "reconciliation", "failed", "ledger",
];

export async function transcribeSpeech(
  fileName: string,
  fileBytes: Buffer
): Promise<string> {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const pathMod = await import("node:path");

  const tmpPath = pathMod.join(os.tmpdir(), `klear-voice-${Date.now()}-${fileName}`);
  fs.writeFileSync(tmpPath, fileBytes);

  const c = getClient() as unknown as {
    speechToText: {
      transcribe: (args: Record<string, unknown>) => Promise<{
        transcript: string;
        language_code?: string;
      }>;
    };
  };

  try {
    const base = {
      file: fs.createReadStream(tmpPath),
      model: "saaras:v4",
      mode: "transcribe", // original language, Hinglish included
    };
    // keyterms is v4-only; if the installed SDK rejects it, degrade cleanly
    let res;
    try {
      res = await withRetry(() => c.speechToText.transcribe({ ...base, keyterms: STT_KEYTERMS }));
    } catch {
      res = await withRetry(() => c.speechToText.transcribe(base));
    }
    return res.transcript ?? "";
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

/* ── TTS: briefing audio ──────────────────────────────────────────────── */

/**
 * Bulbul v4 Flash. Persona speaker IDs are REQUIRED on v4 (v3 short names
 * like "ananya" only work on bulbul:v3) — "shubh_enhi_ads" is Sarvam's
 * documented default Hindi persona. Audio returns base64 in audios[0].
 */
export async function synthesizeSpeech(
  text: string,
  languageCode: "hi-IN" | "en-IN" = "hi-IN"
): Promise<string> {
  const res = await withRetry(() =>
    getClient().textToSpeech.convert({
      text: text.slice(0, 2400),
      language_code: languageCode,
      model: "bulbul:v4-flash",
      speaker: languageCode === "hi-IN" ? "shubh_enhi_ads" : "simran_en_customer",
    } as never)
  );
  const audios = (res as { audios: string[] }).audios;
  return audios[0];
}

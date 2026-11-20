/**
 * Ask Klear — the copilot agent loop on Sarvam-105B.
 *
 * Guardrails:
 *   - The model gets a fixed, typed toolset; every tool argument is
 *     validated with zod before execution.
 *   - All data comes from tools (the merchant's own ledger). The system
 *     prompt forbids inventing numbers.
 *   - The only write tool is approve_recovery, and it requires the human's
 *     name — recorded in the approval + audit ledger.
 *   - Execution of money actions stays a separate, explicit dashboard
 *     step. The copilot can approve; it cannot move money by itself.
 */
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { fraudFlags, payments, recoveryActions } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { chat, type ChatMessage, type ChatToolCall } from "@/lib/sarvam/client";
import { buildOverviewFacts } from "./facts";
import { approveProposal } from "@/lib/recovery/triage";
import { formatINR } from "@/lib/money";

/* ── Tool definitions (OpenAI function-calling shape) ─────────────────── */

const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "get_recon_status",
      description:
        "Current reconciliation + risk state of the merchant account: Klear score, money cleared/at-risk, exception counts, fraud bands, recovery queue size.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_failed_payments",
      description:
        "Failed payment attempts with their reason codes and amounts. Use for questions like 'why did payments fail yesterday'.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows to return (default 10, max 25)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_fraud_flags",
      description:
        "Payments flagged REVIEW or BLOCK, with the plain-English reasons. Use for 'what looks suspicious today'.",
      parameters: {
        type: "object",
        properties: {
          band: { type: "string", enum: ["REVIEW", "BLOCK"] },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recovery_queue",
      description:
        "Recovery proposals waiting for human approval, with the agent's rationale for each.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_recovery",
      description:
        "Approve ONE recovery proposal on behalf of the human user (they must be clearly asking for it). Records their name in the audit ledger. Does NOT execute the money action — execution stays in the dashboard.",
      parameters: {
        type: "object",
        properties: {
          action_id: { type: "integer", description: "The recovery action id from the queue" },
          approver_name: { type: "string", description: "Name of the human approving" },
        },
        required: ["action_id", "approver_name"],
      },
    },
  },
];

/* ── Executors (zod-validated) ────────────────────────────────────────── */

type Executor = (args: unknown) => Promise<unknown>;

const executors: Record<string, Executor> = {
  get_recon_status: async () => buildOverviewFacts(),

  list_failed_payments: async (args) => {
    const { limit } = z
      .object({ limit: z.number().int().min(1).max(25).optional() })
      .parse(args ?? {});
    const db = getDb();
    const rows = await db.select().from(payments).where(desc(payments.createdAt));
    return rows
      .filter((p) => p.status === "FAILED")
      .slice(0, limit ?? 10)
      .map((p) => ({
        paymentId: p.id,
        orderId: p.orderId,
        amount: formatINR(p.amount),
        method: p.method,
        reason: p.failureReason,
        customer: p.customerName,
      }));
  },

  list_fraud_flags: async (args) => {
    const { band } = z
      .object({ band: z.enum(["REVIEW", "BLOCK"]).optional() })
      .parse(args ?? {});
    const db = getDb();
    const rows = await db.select().from(fraudFlags).where(desc(fraudFlags.score));
    return rows
      .filter((f) => f.riskBand !== "OK" && (!band || f.riskBand === band))
      .slice(0, 10)
      .map((f) => ({
        orderId: f.orderId,
        paymentId: f.paymentId,
        band: f.riskBand,
        score: Number(f.score.toFixed(2)),
        reasons: (JSON.parse(f.reasons) as { label: string }[]).map((r) => r.label),
      }));
  },

  list_recovery_queue: async () => {
    const db = getDb();
    const rows = await db.select().from(recoveryActions);
    return rows
      .filter((a) => a.status === "PROPOSED")
      .map((a) => ({
        actionId: a.id,
        orderId: a.orderId,
        actionType: a.actionType,
        failureReason: a.failureReason,
        rationale: a.rationale,
      }));
  },

  approve_recovery: async (args) => {
    const { action_id, approver_name } = z
      .object({
        action_id: z.number().int(),
        approver_name: z.string().min(2),
      })
      .parse(args);
    const ok = await approveProposal(action_id, approver_name);
    return {
      approved: ok,
      actionId: action_id,
      approver: approver_name,
      note: ok
        ? "Approved and recorded in the audit ledger. Execute it from the dashboard when ready."
        : "Could not approve — check the action id and that it is still PROPOSED.",
    };
  },
};

/* ── Agent loop ───────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are Klear, the payment-operations copilot for "Sunrise Organics", a D2C grocery merchant in Bengaluru using Cashfree Payments.

You see the merchant's own ledger through tools. Rules:
- EVERY number you state must come from a tool result. Never compute, estimate, or invent figures or ids.
- Amounts from tools may be in paise — display rupees (paise/100) using ₹ formatting.
- Answer in the user's language (English or Hinglish both fine).
- If asked to approve a recovery action, confirm which one, then call approve_recovery with the user's name. Never approve silently or on your own initiative.
- You cannot move money, create links, or change thresholds. Execution is a dashboard action after approval.
- Be concise and operational: short paragraphs, exact numbers, name the decision needed.`;

export interface ToolTraceEntry {
  name: string;
  args: unknown;
  result: unknown;
}

export interface AskResult {
  answer: string;
  trace: ToolTraceEntry[];
}

export async function askKlear(question: string): Promise<AskResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: question },
  ];
  const trace: ToolTraceEntry[] = [];

  for (let step = 0; step < 5; step++) {
    const { content, toolCalls } = await chat(messages, { temperature: 0.4 }, TOOL_DEFS);

    if (!toolCalls || toolCalls.length === 0) {
      return { answer: content ?? "I could not answer that from the ledger.", trace };
    }

    messages.push({
      role: "assistant",
      content: content ?? "",
      tool_calls: toolCalls,
    });

    for (const call of toolCalls as ChatToolCall[]) {
      let result: unknown;
      try {
        const args = call.function.arguments
          ? JSON.parse(call.function.arguments)
          : {};
        const exec = executors[call.function.name];
        result = exec
          ? await exec(args)
          : { error: `unknown tool ${call.function.name}` };
      } catch (err) {
        result = { error: String(err) };
      }
      trace.push({ name: call.function.name, args: call.function.arguments, result });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    answer:
      "That question needed more tool hops than I allow in one turn. Try asking for the specific list or number directly.",
    trace,
  };
}

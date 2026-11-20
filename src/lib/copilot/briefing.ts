/**
 * Morning briefing: TS computes the facts, Sarvam-105B writes the prose.
 * The model may not invent numbers — it narrates the facts JSON verbatim.
 * Without an API key, a deterministic template briefing is produced and
 * clearly labeled as such.
 */
import { buildOverviewFacts, type OverviewFacts } from "./facts";
import { chatStructured, sarvamConfigured } from "@/lib/sarvam/client";
import { formatINRCompact } from "@/lib/money";

export interface Briefing {
  text: string;
  mode: "sarvam-105b" | "template";
  facts: OverviewFacts;
}

const BRIEFING_SCHEMA = {
  type: "object",
  properties: {
    briefing: {
      type: "string",
      description: "The morning briefing in markdown, 6–10 lines, using the exact numbers from the facts JSON.",
    },
  },
  required: ["briefing"],
};

const SYSTEM = `You are Klear's briefing writer for an Indian merchant ("${process.env.MERCHANT_NAME ?? "Sunrise Organics"}", a D2C grocery brand in Bengaluru).
Klear is a human-gated AI back office on Cashfree: it three-way reconciles orders↔payments↔settlements↔bank, triages failed payments into recovery actions, and flags fraud with reasons.

Write the morning briefing using ONLY the FACTS JSON. Rules:
- Use every number EXACTLY as given; never compute, estimate, or invent figures.
- Money is in paise in the facts — convert to rupees for display (divide by 100), e.g. 4500000 paise = ₹45,000.
- Structure: one line of greeting, then: cleared/at-risk money + Klear score, then exceptions worth attention, then fraud flags with their reasons, then the recovery queue and what needs a human decision.
- End with exactly one line starting with "Decision needed:" naming the single most important approval waiting.
- Warm, crisp, operator tone. No emojis.`;

function templateBriefing(f: OverviewFacts): string {
  const m = f.money;
  const clear = formatINRCompact(m.clearedValuePaise);
  const risk = formatINRCompact(m.atRiskValuePaise);
  const merchant = process.env.MERCHANT_NAME ?? "Sunrise Organics";
  const lines = [
    `**Klear morning brief — ${merchant}**`,
    ``,
    `Money: ${clear} cleared of today's ${formatINRCompact(m.orderValuePaise)} collected (Klear score ${(f.klearScore * 100).toFixed(1)}%). ${risk} at risk.`,
    `Books: ${f.exceptions.mismatches} mismatches, ${f.exceptions.missing} missing links, ${f.exceptions.duplicates} duplicates.`,
    `Fraud: ${f.risk.review} payments in REVIEW, ${f.risk.block} in BLOCK.`,
    `Recovery: ${f.recovery.proposed} proposals waiting for your approval, ${f.recovery.executed} already executed.`,
    ``,
    `Decision needed: approve or reject the ${f.recovery.proposed} recovery proposals in the approvals inbox.`,
  ];
  return lines.join("\n");
}

export async function generateBriefing(): Promise<Briefing> {
  const facts = await buildOverviewFacts();

  if (!sarvamConfigured()) {
    return { text: templateBriefing(facts), mode: "template", facts };
  }

  const result = await chatStructured<{ briefing: string }>(
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `FACTS JSON:\n${JSON.stringify(facts, null, 2)}\n\nWrite today's briefing.`,
      },
    ],
    "klear_briefing",
    BRIEFING_SCHEMA,
    { temperature: 0.3, maxTokens: 900 }
  );

  if (!result?.briefing) {
    return { text: templateBriefing(facts), mode: "template", facts };
  }
  return { text: result.briefing, mode: "sarvam-105b", facts };
}

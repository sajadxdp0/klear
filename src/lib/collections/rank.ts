/**
 * The collections ranker: who should we ask today, and why.
 *
 * Design contract (Problem 2, "show your reasoning"):
 *   - Every signal is one a manager can defend to a regulator.
 *   - Every rejected signal is refused by construction, not by tuning.
 *     Name, language, area, phone, gender, religion never enter the
 *     scorer. The eval proves the queue is uncorrelated with them.
 *   - A borrower who claims to have paid is never ranked on the claim:
 *     the claim is checked against the ledger first (VERIFY bucket).
 *
 * Deterministic: same book, same queue. The LLM narrates; it never ranks.
 */
import type { borrowers as BorrowerTable } from "@/lib/db/schema";

type BorrowerRow = typeof BorrowerTable.$inferSelect;

export interface Signal {
  label: string;
  points: number;
}

export interface RankedBorrower {
  id: string;
  name: string;
  language: string;
  phone: string;
  loanNo: string;
  amountDue: number;
  daysOverdue: number;
  promisesMade: number;
  promisesKept: number;
  note: string | null;
  paydayHint: number | null;
  claimsPaid: number;
  status: string;
  rank: number; // 1-based within the active queue, 0 = not ranked
  score: number;
  reason: string; // readable aloud
  signals: Signal[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Permitted calling window: 8 AM to 7 PM IST (RBI recovery norms). */
export function callingWindowOpen(now = new Date()): { open: boolean; istTime: string } {
  const ist = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hour12: false,
  }).format(now));
  return { open: hour >= 8 && hour < 19, istTime: ist };
}

/** Days until the noted salary date (0 = today is payday). */
function daysToPayday(payday: number, now: number): number | null {
  if (payday < 1 || payday > 28) return null;
  const d = new Date(now);
  const currentDay = d.getDate();
  const daysUntil = payday >= currentDay ? payday - currentDay : 30 - currentDay + payday;
  return daysUntil;
}

export function scoreBorrower(b: BorrowerRow, now: number): RankedBorrower {
  const signals: Signal[] = [];

  // Overdue band. Mid-range debts carry the most recoverable money:
  // fresh ones are often genuine forgetfulness, ancient ones are harder.
  if (b.daysOverdue <= 15) signals.push({ label: `overdue ${b.daysOverdue} days, likely a slip of memory`, points: 6 });
  else if (b.daysOverdue <= 30) signals.push({ label: `overdue ${b.daysOverdue} days`, points: 12 });
  else if (b.daysOverdue <= 60) signals.push({ label: `overdue ${b.daysOverdue} days, in the serious band`, points: 18 });
  else if (b.daysOverdue <= 90) signals.push({ label: `overdue ${b.daysOverdue} days`, points: 14 });
  else signals.push({ label: `overdue ${b.daysOverdue} days, long-neglected account`, points: 8 });

  // Amount matters: rupees at stake, normalized to a 12-point ceiling.
  const amountPts = Math.round(Math.min(1, b.amountDue / 4000000) * 12);
  signals.push({ label: `₹${(b.amountDue / 100).toLocaleString("en-IN")} at stake`, points: amountPts });

  // Promise history is the strongest behavioral signal we can defend.
  if (b.promisesMade > 0) {
    const rate = b.promisesKept / b.promisesMade;
    if (rate >= 0.75) signals.push({ label: `kept ${b.promisesKept} of ${b.promisesMade} past promises`, points: 20 });
    else if (rate >= 0.5) signals.push({ label: `kept ${b.promisesKept} of ${b.promisesMade} past promises`, points: 14 });
    else if (rate > 0) signals.push({ label: `kept only ${b.promisesKept} of ${b.promisesMade} promises`, points: 4 });
    else signals.push({ label: `promised ${b.promisesMade} times, never paid`, points: -18 });
  } else {
    signals.push({ label: "never promised before, untested", points: 2 });
  }

  // Salary date from the last call note: asking right after money lands
  // is basic collections craft. A borrower who volunteers her payday is
  // engaged and cooperating; schedule the ask for when she can say yes.
  if (b.paydayHint) {
    const d = daysToPayday(b.paydayHint, now);
    if (d !== null && d <= 3) {
      signals.push({
        label: d === 0 ? "salary expected today" : `salary expected in ${d} day${d === 1 ? "" : "s"}`,
        points: 16,
      });
    } else if (d !== null && d <= 7) {
      signals.push({ label: `salary expected within the week (the ${b.paydayHint}th)`, points: 12 });
    } else if (d !== null && d <= 14) {
      signals.push({ label: `salary expected around the ${b.paydayHint}th`, points: 6 });
    } else {
      signals.push({ label: `told us salary lands on the ${b.paydayHint}th`, points: 2 });
    }
  }

  // Recency of contact: untouched accounts get a fresh look.
  if (b.lastContactedAt) {
    const daysSince = Math.floor((now - b.lastContactedAt) / DAY);
    if (daysSince > 14) signals.push({ label: `not contacted in ${daysSince} days`, points: 4 });
    else if (daysSince < 2) signals.push({ label: `already contacted ${daysSince === 0 ? "today" : "yesterday"}`, points: -4 });
  }

  // NOTE what is deliberately absent: name, language, area, phone,
  // gender, religion, caste. Not down-weighted: not inputs at all.

  const score = signals.reduce((s, x) => s + x.points, 0);
  const lead = signals.reduce((best, x) => (x.points > best.points ? x : best), signals[0]);
  const reason =
    `${lead.label}. ` +
    signals
      .filter((x) => x !== lead && x.points >= 5)
      .slice(0, 2)
      .map((x) => x.label)
      .join(". ");

  return {
    id: b.id,
    name: b.name,
    language: b.language,
    phone: b.phone,
    loanNo: b.loanNo,
    amountDue: b.amountDue,
    daysOverdue: b.daysOverdue,
    promisesMade: b.promisesMade,
    promisesKept: b.promisesKept,
    note: b.note,
    paydayHint: b.paydayHint,
    claimsPaid: b.claimsPaid,
    status: b.status,
    rank: 0,
    score,
    reason: reason.charAt(0).toUpperCase() + reason.slice(1),
    signals,
  };
}

export interface QueueView {
  now: number;
  active: RankedBorrower[]; // ranked, IN_QUEUE
  needsVerification: RankedBorrower[]; // claims paid, unverified against the ledger
  resolved: RankedBorrower[]; // PAID | PARTIAL | VERIFIED_PAID | DEFERRED
  callingWindow: { open: boolean; istTime: string };
  stats: {
    bookSize: number;
    activeCount: number;
    rupeesInQueue: number;
    rupeesResolvedToday: number;
  };
}

export function buildQueue(rows: BorrowerRow[], now = Date.now()): QueueView {
  const scored = rows.map((b) => scoreBorrower(b, now));

  const needsVerification = scored.filter((b) => b.claimsPaid === 1 && b.status === "IN_QUEUE");
  const resolved = scored.filter(
    (b) => ["PAID", "PARTIAL", "VERIFIED_PAID", "DEFERRED"].includes(b.status)
  );
  const active = scored
    .filter((b) => b.status === "IN_QUEUE" && !(b.claimsPaid === 1))
    .sort((a, b) => b.score - a.score)
    .map((b, i) => ({ ...b, rank: i + 1 }));

  return {
    now,
    active,
    needsVerification,
    resolved,
    callingWindow: callingWindowOpen(new Date(now)),
    stats: {
      bookSize: rows.length,
      activeCount: active.length,
      rupeesInQueue: active.reduce((s, b) => s + b.amountDue, 0),
      rupeesResolvedToday: resolved
        .filter((b) => b.status === "PAID" || b.status === "VERIFIED_PAID" || b.status === "PARTIAL")
        .reduce((s, b) => s + b.amountDue, 0),
    },
  };
}

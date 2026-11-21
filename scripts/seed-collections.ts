/**
 * Klear Collections seed — the synthetic overdue book for Problem 2.
 *
 * 60 borrowers with code-mixed field notes, promise histories, pay-day
 * hints and planted traps. Ground-truth outcomes (who actually pays if
 * asked) are written to artifacts/collections-outcomes.json and held
 * back from the app: the ranker never sees them, the eval does.
 *
 * Two borrowers genuinely paid at the branch yesterday: their payments
 * are in the ledger, so a paid-claim can be VERIFIED. One claims to
 * have paid but didn't: the claim must fail the ledger check.
 */
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/lib/db/client";
import {
  auditLog,
  borrowers,
  collectionActions,
  orders,
  payments,
} from "../src/lib/db/schema";

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(112126);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo));

const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const NAMES = [
  "Ramesh Kumar", "Sunita Devi", "Arumugam Selvam", "Lakshmi Narayanan",
  "Imran Sheikh", "Girija Shetty", "Venkatesh Rao", "Meena Kumari",
  "Prakash Chandra", "Deepa Iyer", "Mohan Lal", "Kavitha Balan",
  "Sanjay Patil", "Rekha Nair", "Anil Gupta", "Shanta Bai",
  "Thangavel Murugan", "Farida Bi", "Ravi Shankar", "Jayammagowda",
  "Naseem Ahmed", "Poornima Rao", "Dinesh Yadav", "Sarla Devi",
  "Chinnadurai Annamalai", "Bhaskar Menon", "Usha Rani", "Kiran Bedekar",
  "Selvi Radhakrishnan", "Omkar Joshi", "Anita George", "Mahesh Dhoble",
  "Sushila Pawar", "Velan Chinnasamy", "Rita Pinto", "Gopal Swamy",
  "Nirmala Amma", "Tariq Khan", "Padma Venkatesh", "Suresh Kadam",
  "Revathi Doraisamy", "Ashok Bagade", "Leela Krishnan", "Mubarak Ali",
  "Vimala Devi", "Raghunath Shetty", "Chandralekha Roy", "Biju Thomas",
  "Sarojini Naidu", "Pandurang Kulkarni", "Esther Rani", "Vijay Solanki",
  "Bhanumathi Chandrasekaran", "Iqbal Hussain", "Geetha Pillai", "Ramesh Chandra Tiwari",
  "Muthulakshmi Ponnusamy", "Haribhau Jadhav", "Sneha Kulkarni", "Bashir Ansari",
];

const LANGS = ["hi-IN", "hi-IN", "hi-IN", "ta-IN", "ta-IN", "kn-IN", "en-IN"];

interface BorrowerSeed {
  id: string;
  name: string;
  language: string;
  phone: string;
  loanNo: string;
  amountDue: number; // paise
  daysOverdue: number;
  promisesMade: number;
  promisesKept: number;
  lastContactedAt: number | null;
  note: string | null;
  paydayHint: number | null;
  claimsPaid: number;
  status: string;
  createdAt: number;
}

const rows: BorrowerSeed[] = [];
const outcomes: { borrowerId: string; willPayIfAsked: 0 | 1; wouldPartial: 0 | 1 }[] = [];

let seq = 1;
const uid = (p: string) => `${p}_CL${(seq++).toString(36)}${Math.floor(rand() * 1296).toString(36).padStart(2, "0")}`;

/* ordinary book: forgot / pays-when-asked / never-pays, mixed histories */
for (let i = 0; i < NAMES.length - 6; i++) {
  const promisesMade = between(0, 5);
  const kept = promisesMade === 0 ? 0 : between(0, promisesMade);
  rows.push({
    id: uid("bor"),
    name: NAMES[i],
    language: pick(LANGS),
    phone: `+9${between(600000000, 999999999)}`,
    loanNo: `LN-${between(10000, 99999)}`,
    amountDue: between(8000, 4000000), // ₹80 – ₹40,000
    daysOverdue: between(3, 120),
    promisesMade,
    promisesKept: kept,
    lastContactedAt: now - between(1, 30) * DAY,
    note: null,
    paydayHint: null,
    claimsPaid: 0,
    status: "IN_QUEUE",
    createdAt: now,
  });
  // ground truth: reliable promisors and mid-range overdue tend to pay
  const reliable = promisesMade > 0 && kept / promisesMade >= 0.5;
  const sweetSpot = rows[i].daysOverdue <= 60;
  outcomes.push({
    borrowerId: rows[i].id,
    willPayIfAsked: reliable && sweetSpot ? 1 : rand() < 0.25 ? 1 : 0,
    wouldPartial: reliable && !sweetSpot ? 1 : 0,
  });
}

/* planted cases the brief calls out, appended with known ids */

/* A: paid at the branch yesterday — claim TRUE, ledger must confirm (×2) */
{
  const a: BorrowerSeed = {
    id: "bor_paid_branch_true",
    name: "Padma Venkatesh",
    language: "ta-IN",
    phone: "+919812345601",
    loanNo: "LN-70001",
    amountDue: 1500000,
    daysOverdue: 22,
    promisesMade: 3, promisesKept: 2,
    lastContactedAt: now - 1 * DAY,
    note: "branch mein de diya, receipt hai",
    paydayHint: null,
    claimsPaid: 1,
    status: "IN_QUEUE",
    createdAt: now,
  };
  rows.push(a);
  outcomes.push({ borrowerId: a.id, willPayIfAsked: 1, wouldPartial: 0 });
}
{
  const a2: BorrowerSeed = {
    id: "bor_paid_branch_true2",
    name: "Haribhau Jadhav",
    language: "hi-IN",
    phone: "+919812345602",
    loanNo: "LN-70002",
    amountDue: 920000,
    daysOverdue: 40,
    promisesMade: 2, promisesKept: 2,
    lastContactedAt: now - 1 * DAY,
    note: "कल branch पर जमा कर दिया",
    paydayHint: null,
    claimsPaid: 1,
    status: "IN_QUEUE",
    createdAt: now,
  };
  rows.push(a2);
  outcomes.push({ borrowerId: a2.id, willPayIfAsked: 1, wouldPartial: 0 });
}

/* B: claims paid but didn't — claim FALSE, ledger must refute */
{
  const b: BorrowerSeed = {
    id: "bor_paid_claim_false",
    name: "Naseem Ahmed",
    language: "hi-IN",
    phone: "+919812345603",
    loanNo: "LN-70003",
    amountDue: 2300000,
    daysOverdue: 75,
    promisesMade: 4, promisesKept: 0,
    lastContactedAt: now - 2 * DAY,
    note: "branch mein de diya" ,
    paydayHint: null,
    claimsPaid: 1,
    status: "IN_QUEUE",
    createdAt: now,
  };
  rows.push(b);
  outcomes.push({ borrowerId: b.id, willPayIfAsked: 0, wouldPartial: 0 });
}

/* C: salary on the 25th — reachable this week, will pay right after salary */
{
  const c: BorrowerSeed = {
    id: "bor_salary_soon",
    name: "Sunita Devi",
    language: "hi-IN",
    phone: "+919812345604",
    loanNo: "LN-70004",
    amountDue: 680000,
    daysOverdue: 18,
    promisesMade: 2, promisesKept: 2,
    lastContactedAt: now - 4 * DAY,
    note: "salary 25 ko aayega, फिर दे दूंगी",
    paydayHint: 25,
    claimsPaid: 0,
    status: "IN_QUEUE",
    createdAt: now,
  };
  rows.push(c);
  outcomes.push({ borrowerId: c.id, willPayIfAsked: 1, wouldPartial: 0 });
}

/* D: hardship — cannot pay in full, would pay something if allowed */
{
  const d: BorrowerSeed = {
    id: "bor_hardship",
    name: "Shanta Bai",
    language: "hi-IN",
    phone: "+919812345605",
    loanNo: "LN-70005",
    amountDue: 1900000,
    daysOverdue: 55,
    promisesMade: 1, promisesKept: 1,
    lastContactedAt: now - 12 * DAY,
    note: "इस महीने मुश्किल है, थोड़ा-थोड़ा कर दूंगी",
    paydayHint: null,
    claimsPaid: 0,
    status: "IN_QUEUE",
    createdAt: now,
  };
  rows.push(d);
  outcomes.push({ borrowerId: d.id, willPayIfAsked: 0, wouldPartial: 1 });
}

/* E: serial promiser, never pays — must rank LOW despite promising */
{
  const e: BorrowerSeed = {
    id: "bor_serial_promiser",
    name: "Ravi Shankar",
    language: "hi-IN",
    phone: "+919812345606",
    loanNo: "LN-70006",
    amountDue: 3400000,
    daysOverdue: 90,
    promisesMade: 6, promisesKept: 0,
    lastContactedAt: now - 3 * DAY,
    note: "kal pakka, बिल्कुल pakka",
    paydayHint: null,
    claimsPaid: 0,
    status: "IN_QUEUE",
    createdAt: now,
  };
  rows.push(e);
  outcomes.push({ borrowerId: e.id, willPayIfAsked: 0, wouldPartial: 0 });
}

/* branch-paid borrowers get REAL ledger entries so claims can be verified */
const db = getDb();
db.delete(collectionActions).run();
db.delete(borrowers).run();
db.insert(borrowers).values(rows).run();

for (const paid of rows.filter((r) => r.claimsPaid === 1 && r.id !== "bor_paid_claim_false")) {
  const orderId = `order_${paid.id}`;
  const payId = `pay_${paid.id}`;
  db.insert(orders)
    .values({
      id: orderId,
      amount: paid.amountDue,
      status: "PAID",
      customerName: paid.name,
      customerPhone: paid.phone,
      customerEmail: null,
      createdAt: now - 1 * DAY,
      raw: JSON.stringify({ channel: "BRANCH", loanNo: paid.loanNo }),
    })
    .onConflictDoNothing()
    .run();
  db.insert(payments)
    .values({
      id: payId,
      orderId,
      amount: paid.amountDue,
      status: "SUCCESS",
      method: "netbanking",
      bankReference: `UTRBR${between(100000, 999999)}`,
      customerName: paid.name,
      createdAt: now - 1 * DAY,
      raw: JSON.stringify({ channel: "BRANCH", loanNo: paid.loanNo }),
    })
    .onConflictDoNothing()
    .run();
}

db.insert(auditLog)
  .values({
    actor: "seed",
    action: "COLLECTIONS_SEED",
    entity: "borrowers",
    entityId: null,
    payload: JSON.stringify({ borrowers: rows.length, plantedTraps: 6 }),
    createdAt: now,
  })
  .run();

/* outcomes are held back from the app: the eval reads them, the ranker never does */
fs.mkdirSync(path.join(process.cwd(), "artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(process.cwd(), "artifacts", "collections-outcomes.json"),
  JSON.stringify({ generatedAt: now, outcomes }, null, 2)
);

console.log("✓ Klear collections book seeded");
console.log(`  borrowers        ${rows.length}`);
console.log(`  will pay if asked ${outcomes.filter((o) => o.willPayIfAsked === 1).length} (held back from the agent)`);
console.log(`  partial payers   ${outcomes.filter((o) => o.wouldPartial === 1).length} (held back from the agent)`);
console.log(`  planted traps    paid-at-branch ×2, false claim ×1, salary-5th, hardship, serial promiser`);
console.log("  ground truth     artifacts/collections-outcomes.json (eval only)");

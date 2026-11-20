/**
 * Generates the fraud-model training corpus (~48k payment rows).
 *
 * Key design choice: feature rows are built with the SAME buildFeatures()
 * used at inference time — the Python trainer never recomputes features,
 * so the feature contract cannot drift between training and serving.
 *
 * Label semantics (deliberate):
 *   label 1 = model-fraud (overwhelming evidence: velocity bursts,
 *             new-customer high tickets, hijack-style z-jumps)
 *   label 0 = everything else — INCLUDING refund abusers and loyal whales.
 *             Refund abuse is a human-judgment lane: rules keep it at
 *             REVIEW; the model must never escalate it to BLOCK.
 *             Loyal whales and benign gift jumps are the hard negatives
 *             that teach the model context.
 *
 * Run: npx tsx scripts/gen-dataset.ts  →  ml/dataset.csv + ml/golden.csv
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildFeatures,
  FEATURE_NAMES,
  type PaymentContextInput,
  type RefundContextInput,
} from "../src/lib/fraud/features";

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(424242);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo));
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();

let idSeq = 1;
const uid = (p: string) => `${p}_ds${idSeq++}`;

interface Tagged {
  payment: PaymentContextInput;
  label: 0 | 1;
}
interface CustomerSim {
  payments: Tagged[];
  refunds: RefundContextInput[];
}

const CUSTOMER_METHODS = ["upi", "upi", "upi", "card", "netbanking", "wallet"];

/* ── Archetype generators ────────────────────────────────────────────── */

/** Ordinary shopper: 3–18 txns, ₹200–5,000, upi-biased, occasional refunds. */
function simNormal(): CustomerSim {
  const customerId = uid("cust");
  const n = between(3, 18);
  const base = between(20000, 500000); // paise mean
  const payments: Tagged[] = [];
  const refunds: RefundContextInput[] = [];
  for (let i = 0; i < n; i++) {
    const amount = Math.max(5000, Math.round(base * (0.6 + rand() * 0.8)));
    const createdAt = now - between(1, 30) * DAY - between(0, 20) * HOUR;
    const method = pick(CUSTOMER_METHODS);
    const id = uid("pay");
    payments.push({
      payment: {
        id, customerId, orderId: uid("order"), amount,
        status: "SUCCESS", method, createdAt,
      },
      label: 0,
    });
    if (rand() < 0.08) {
      refunds.push({ paymentId: id, customerId, createdAt: createdAt + 3 * HOUR });
    }
  }
  return { payments, refunds };
}

/** Loyal whale: long history, growing spend, occasional huge UPI jumps. Label 0. */
function simLoyalWhale(): CustomerSim {
  const customerId = uid("cust");
  const n = between(12, 25);
  const payments: Tagged[] = [];
  for (let i = 0; i < n; i++) {
    let amount = Math.round(30000 * Math.pow(1.18, i)); // ₹300 growing
    amount = Math.min(amount, 8000000);
    if (i > 6 && i % 5 === 0 && rand() < 0.7) {
      amount = between(4000000, 10000000); // ₹40K–₹1L UPI jump — LEGIT
    }
    const createdAt = now - (n - i) * between(18, 30) * HOUR;
    const id = uid("pay");
    payments.push({
      payment: {
        id, customerId, orderId: uid("order"), amount,
        status: "SUCCESS", method: "upi", createdAt,
      },
      label: 0,
    });
  }
  return { payments, refunds: [] };
}

/** Benign gift jump: 3–5σ bump by an established customer. Label 0. */
function simGiftJump(): CustomerSim {
  const customerId = uid("cust");
  const n = between(6, 15);
  const base = between(20000, 150000);
  const payments: Tagged[] = [];
  for (let i = 0; i < n; i++) {
    const isGift = i === n - 1;
    const amount = isGift ? between(800000, 1500000) : Math.max(5000, Math.round(base * (0.7 + rand() * 0.6)));
    const createdAt = now - (n - i) * between(20, 40) * HOUR;
    const id = uid("pay");
    payments.push({
      payment: {
        id, customerId, orderId: uid("order"), amount,
        status: "SUCCESS", method: isGift ? "upi" : pick(CUSTOMER_METHODS),
        createdAt,
      },
      label: 0,
    });
  }
  return { payments, refunds: [] };
}

/** Refund abuser: ≥50% lifetime refunds, keeps shopping. Label 0 (human lane). */
function simRefundAbuser(): CustomerSim {
  const customerId = uid("cust");
  const n = between(6, 10);
  const base = between(40000, 120000);
  const payments: Tagged[] = [];
  const refunds: RefundContextInput[] = [];
  for (let i = 0; i < n; i++) {
    const amount = Math.max(5000, Math.round(base * (0.8 + rand() * 0.4)));
    const createdAt = now - (n - i) * between(30, 96) * HOUR;
    const id = uid("pay");
    payments.push({
      payment: {
        id, customerId, orderId: uid("order"), amount,
        status: "SUCCESS", method: pick(CUSTOMER_METHODS), createdAt,
      },
      label: 0,
    });
    if (i < n / 2) {
      refunds.push({ paymentId: id, customerId, createdAt: createdAt + 4 * HOUR });
    }
  }
  return { payments, refunds };
}

/** Legit retry churn: bank timeout then success on the same order. Label 0. */
function simRetryChurn(): CustomerSim {
  const customerId = uid("cust");
  const amount = between(30000, 400000);
  const orderId = uid("order");
  const payments: Tagged[] = [];
  const t0 = now - between(2, 200) * HOUR;
  const attempts = between(2, 3);
  for (let i = 0; i < attempts; i++) {
    payments.push({
      payment: {
        id: uid("pay"), customerId, orderId, amount,
        status: i === attempts - 1 ? "SUCCESS" : "FAILED",
        method: pick(CUSTOMER_METHODS), createdAt: t0 + i * 10 * 60 * 1000,
      },
      label: 0,
    });
  }
  return { payments, refunds: [] };
}

/** Velocity burst: 5–9 attempts inside an hour. Label 1 on every attempt. */
function simVelocityBurst(): CustomerSim {
  const customerId = uid("cust");
  const payments: Tagged[] = [];
  // 30% have a small legit history first
  if (rand() < 0.3) {
    for (let i = 0; i < between(2, 4); i++) {
      payments.push({
        payment: {
          id: uid("pay"), customerId, orderId: uid("order"),
          amount: between(20000, 200000), status: "SUCCESS",
          method: "upi", createdAt: now - between(5, 25) * DAY,
        },
        label: 0,
      });
    }
  }
  const burst = between(5, 9);
  const amount = between(200000, 1500000);
  const oddHour = rand() < 0.4;
  const t0 = now - between(1, 60) * HOUR;
  for (let i = 0; i < burst; i++) {
    const createdAt = t0 + i * between(2, 9) * 60 * 1000;
    payments.push({
      payment: {
        id: uid("pay"), customerId, orderId: uid("order"),
        amount: Math.round(amount * (0.9 + rand() * 0.2)),
        status: i === burst - 1 && rand() < 0.5 ? "SUCCESS" : "FAILED",
        method: rand() < 0.7 ? "card" : "upi",
        createdAt: oddHour ? createdAt - 4 * HOUR : createdAt,
      },
      label: 1,
    });
  }
  return { payments, refunds: [] };
}

/** Brand-new customer, ₹50K–₹2L first ticket on card/netbanking. Label 1. */
function simNewHighTicket(): CustomerSim {
  const customerId = uid("cust");
  const id = uid("pay");
  return {
    payments: [
      {
        payment: {
          id, customerId, orderId: uid("order"),
          amount: between(5000000, 20000000),
          status: "SUCCESS",
          method: rand() < 0.75 ? "card" : "netbanking",
          createdAt: now - between(1, 40) * HOUR,
        },
        label: 1,
      },
    ],
    refunds: [],
  };
}

/** Hijack-style z-jump: 3–5 tiny priors, then a big card jump. Label 1. */
function simHijackZJump(): CustomerSim {
  const customerId = uid("cust");
  const payments: Tagged[] = [];
  const priors = between(3, 5);
  for (let i = 0; i < priors; i++) {
    payments.push({
      payment: {
        id: uid("pay"), customerId, orderId: uid("order"),
        amount: between(20000, 100000), status: "SUCCESS",
        method: "upi", createdAt: now - between(10, 30) * DAY,
      },
      label: 0,
    });
  }
  const jumpAt = now - between(1, 50) * HOUR - (rand() < 0.5 ? 4 * HOUR : 0);
  payments.push({
    payment: {
      id: uid("pay"), customerId, orderId: uid("order"),
      amount: between(2000000, 9000000), status: "SUCCESS",
      method: "card", createdAt: jumpAt,
    },
    label: 1,
  });
  return { payments, refunds: [] };
}

/* ── Corpus assembly ──────────────────────────────────────────────────── */

const PLAN: { gen: () => CustomerSim; rows: number }[] = [
  { gen: simNormal, rows: 24000 },
  { gen: simLoyalWhale, rows: 5000 },
  { gen: simGiftJump, rows: 3000 },
  { gen: simRefundAbuser, rows: 2000 },
  { gen: simRetryChurn, rows: 2000 },
  { gen: simVelocityBurst, rows: 6000 },
  { gen: simNewHighTicket, rows: 3500 },
  { gen: simHijackZJump, rows: 3000 },
];

interface CSVRow {
  features: number[];
  label: 0 | 1;
}

function main() {
  const rows: CSVRow[] = [];

  for (const { gen, rows: target } of PLAN) {
    let produced = 0;
    while (produced < target) {
      const sim = gen();
      const history = sim.payments.map((t) => t.payment);
      history.sort((a, b) => a.createdAt - b.createdAt);
      for (const tagged of sim.payments) {
        const features = buildFeatures(tagged.payment, history, sim.refunds);
        rows.push({ features, label: tagged.label });
        produced++;
      }
    }
  }

  // deterministic shuffle
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  const goldenCount = Math.min(5000, Math.floor(rows.length * 0.1));
  const golden = rows.slice(0, goldenCount);
  const train = rows.slice(goldenCount);

  const header = [...FEATURE_NAMES, "is_fraud"].join(",");
  const toCSV = (rs: CSVRow[]) =>
    header + "\n" + rs.map((r) => [...r.features, r.label].join(",")).join("\n") + "\n";

  const mlDir = path.join(process.cwd(), "ml");
  fs.mkdirSync(mlDir, { recursive: true });
  fs.writeFileSync(path.join(mlDir, "dataset.csv"), toCSV(train));
  fs.writeFileSync(path.join(mlDir, "golden.csv"), toCSV(golden));

  const pos = rows.filter((r) => r.label === 1).length;
  console.log("✓ Klear training corpus generated");
  console.log(`  total rows    ${rows.length}`);
  console.log(`  train rows    ${train.length}`);
  console.log(`  golden rows   ${golden.length}`);
  console.log(`  fraud rows    ${pos} (${((pos / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  benign rows   ${rows.length - pos}`);
}

main();

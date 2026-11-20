# Klear

**Every rupee, cleared.**

A human-gated AI back office for merchants on Cashfree: three-way payment
reconciliation, explainable fraud defense, and failed-payment recovery —
built for the Cashfree × Sarvam Buildathon 2026.

Klear's core discipline: **deterministic money paths, LLM surfaces.** The
matcher and risk scorer are plain, auditable code with exact-paise
comparisons. Sarvam-105B narrates, reasons, and answers questions — it
never does arithmetic on your books. Nothing moves money without a human
approval recorded in an append-only ledger.

```
Cashfree orders/payments/settlements ──┐
Bank statement (CSV or Sarvam Vision) ─┴─▶ INGEST ─▶ SQLite ledger
                                              │
        ┌─────────────────┬─────────────────┤
        ▼                 ▼                 ▼
  RECON ENGINE      FRAUD ENGINE      RECOVERY TRIAGE
  order↔payment↔    rules + LightGBM  failure reason →
  settlement↔bank   →ONNX, reasons,   proposed action,
  exact-paise       evidence packs    human-gated
        │                 │                 │
        └────────┬────────┴────────────────┘
                 ▼
     APPROVALS + APPEND-ONLY AUDIT LEDGER
                 ▼
     ASK KLEAR (Sarvam-105B copilot over your own ledger)
```

## Accuracy is the product

`npm run eval` runs the accuracy harness against planted ground truth
(`artifacts/seed-truth.json`) and exits non-zero on any failure:

- **Recon** — 8 planted exceptions (missing payments, ₹1-off amounts,
  broken fee arithmetic, short bank credits, duplicate settlements/UTRs,
  orphan credits) must each be recovered with the exact expected status.
- **Fraud** — labeled cases incl. a velocity burst cluster (BLOCK), a
  new-customer ₹89K card (BLOCK with the model, REVIEW floor without),
  a refund abuser (REVIEW — deliberately never model-BLOCKed: that's the
  human-judgment lane), and a loyal ₹75K whale (must NOT flag — the
  false-positive control).

Current held-out model metrics (`artifacts/metrics.json`):
AUC-ROC 0.9997 · precision 0.979 · recall 0.983 · F1 0.981.

## Stack

| Layer | Choice |
|---|---|
| Payments rails | Cashfree PG REST (`POST /pg/links`, orders, HMAC-verified webhooks, `x-api-version: 2026-01-01`) |
| Reasoning / copilot | Sarvam-105B (structured outputs + tool calling, official `sarvamai` SDK) |
| Document AI | Sarvam Vision extract — bank statement PDF → transactions JSON |
| TTS (stretch) | Bulbul v4 Flash briefing audio |
| Fraud model | LightGBM → ONNX (`onnxruntime-node`), logistic-JSON fallback, rules floor |
| App | Next.js 15, TypeScript, Tailwind v4, Drizzle + SQLite (WAL) |

## Setup

```bash
npm install
cp .env.example .env   # add CASHFREE_* and SARVAM_API_KEY when you have them
npm run db:init
npm run demo:reset     # seed + ingest + accuracy harness (16/16 green)
npm run dev            # http://localhost:3000
```

Without API keys everything still works in clearly-labeled SIMULATION
mode: recovery links point at an in-app simulated checkout, the briefing
falls back to a deterministic template, PDF statements ask for the
Sarvam key.

## Demo day run-book

```bash
npm run demo:reset     # fresh books, proven accurate, ~10s
npm run dev
```

The 13-minute demo script lives in [DEMO.md](./DEMO.md).

## Where things live

```
src/lib/recon/      pure matchers (matcher.ts), DB run, bank ingest
src/lib/fraud/      features, rules, model wrapper, sweep engine
src/lib/recovery/   triage, approvals, execution (human-gated)
src/lib/copilot/    deterministic facts, briefing, Ask Klear agent loop
src/lib/cashfree/   payment links, webhook verification, order fetch
src/lib/sarvam/     chat / document AI / TTS client
scripts/            db-init, seed (ground truth), dataset generator
ml/                 trainer (LightGBM→ONNX), bank statement PDF generator
eval/               accuracy harness
artifacts/          model.onnx, weights.json, metrics.json, seed-truth.json
```

## Model retraining

```bash
npm run gen:dataset              # ~48.5k rows via the SAME runtime feature builder
python3 ml/train.py              # LightGBM→ONNX + logistic fallback + metrics
npm run eval                     # verify 16/16 still green with the new model
```

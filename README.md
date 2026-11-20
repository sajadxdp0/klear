<p align="center">
  <img src="brand/concept-1-stamp.svg" width="96" alt="Klear mark">
</p>

<h1 align="center">Klear</h1>

<p align="center">Every rupee, cleared.</p>

---

Collecting money online is a solved problem. Knowing where it went is not.

Think of a merchant doing about ₹2.15 lakh a day through Cashfree. By
evening she has questions and no quick answers.

Orders say PAID. Settlements say paid out. The bank statement says
something else. Three lists, three formats, one spreadsheet at 11pm.

Fifteen payments failed. Each one has a reason behind it: a bank timeout,
no balance, a dead UPI ID. A few are a single nudge away from recovering.
She can't tell which.

Then a brand new customer pays ₹89,000 by card. Hold the shipment, or
ship it? Her current tools give her a feeling, not an answer.

Most small businesses run all of this by hand. Klear does the three
jobs, and then asks before touching money.

## What it does

**Reconciliation.** Every rupee is matched three ways, order to payment
to settlement to bank statement, in exact paise. There is no tolerance on
money. When something is off, Klear names the rupee, points at the link
in the chain that broke, and tells you which rule caught it. A payment
that landed one rupee short gets caught. A settlement that never reached
the bank gets caught. A credit that shows up twice in the statement gets
caught.

**Recovery.** Failed payments get read, not just counted. A timeout gets
a retry proposal. A declined card gets a UPI link. Anything the risk
engine held gets parked for review, not chased. A human clicks approve,
Cashfree sends the link, the customer pays, and the ledger updates while
you watch.

**Fraud defense.** Every payment gets a score with the reasons written
out. Five attempts in one hour. Refund ratio 67 percent. First ever
transaction at ₹89,000 on a card. One click pulls the case file together
through Cashfree's verification APIs: PAN check, name match, penny
drop. A regular's ₹75,000 order sails through untouched. We test that.

## Three rules

1. The AI never does the math. Matching and scoring are plain code on
   integers. Sarvam-105B writes the words around numbers that TypeScript
   computed. It never computes anything.
2. The AI never moves money. Every rupee needs a recorded human yes in
   an append-only ledger. The copilot can approve with your name. It
   cannot act alone.
3. We don't claim accuracy, we measure it. The seed plants sixteen traps
   (eight reconciliation failures, eight fraud cases, one of which is a
   customer we are not allowed to flag). `npm run eval` prints 16/16 or
   we don't demo.

```
Cashfree orders / payments / settlements ─┐
Bank statement (CSV or Sarvam Vision PDF) ─┴─▶ ledger ─▶ three-way match
                                              │
        ┌─────────────────┬─────────────────┤
        ▼                 ▼                 ▼
   exceptions         fraud flags      recovery plans
   (exact paise)    (rules + ONNX,     (reason to action,
                     with reasons)      human-gated)
        └────────┬────────┴────────────────┘
                 ▼
     approvals → append-only audit ledger
                 ▼
   Ask Klear: Sarvam-105B, Hinglish, over your own ledger
```

You can also just talk to it. Ask
`"कल कितने payments fail हुए और क्यों?"` and you get the real numbers from
your own ledger back, in your own language. Drop the bank statement PDF
in and Sarvam Vision reads it, in the advanced mode that cross-checks
line items against the total.

## Try it

```bash
npm install
npm run db:init
npm run demo:reset     # seeds the merchant day, runs the eval, prints 16/16
npm run dev            # http://localhost:3000
```

No API keys? Everything still works, labeled simulation. Recovery links
open an in-app simulated checkout. The briefing falls back to a
deterministic template. Drop real Cashfree sandbox keys and a Sarvam key
into `.env` and the same code paths go live. The eval runs either way.

## Receipts

Recon: eight planted failures (a missing payment, a one-rupee-short
amount, broken fee arithmetic, a short bank credit, a duplicate
settlement, a duplicate UTR, a settlement that never hit the bank, an
orphan credit). All eight get caught on every run.

Fraud model: LightGBM served through ONNX inside Node, trained on about
48,500 synthetic rows built with the same feature code that runs at
inference. On the held-out golden set: AUC 0.9997, precision 0.979, recall
0.983, F1 0.981. A logistic fallback and a rules floor sit underneath, so
the demo does not die because a binary refused to load.

The integrations follow the actual contracts. Webhook event names are
`PAYMENT_SUCCESS_WEBHOOK` and friends. Signatures are HMAC-SHA256 over
the raw body. Settlement rows use the v6 nested recon schema. UTRs get
coerced from JSON numbers. SecureID runs on its own keys. We verified all
of it against Cashfree's docs and their open-source agent toolkit rather
than guessing.

Retraining is two commands (`npm run gen:dataset`, `python3 ml/train.py`)
and the eval gate tells you whether the new model earned its place.

## The buildathon

Built for the Cashfree × Sarvam Buildathon 2026. Relay is the front
line, carts and COD calls. Klear is the back office that pairs with it.
One agent that talks Hindi, three jobs done with measured accuracy, and
no rupee moves without a human yes.

MIT licensed. The model, the weights, the demo data and the eval all live
in this repo. Clone it and check us.

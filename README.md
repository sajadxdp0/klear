<p align="center">
  <img src="brand/concept-1-stamp.svg" width="96" alt="Klear mark" />
</p>

<h1 align="center">Klear</h1>

<p align="center"><em>Every rupee, cleared.</em></p>

---

The merchant problem isn't collecting money anymore. It's knowing where the money went.

Yesterday a D2C merchant collected ₹2.15 lakh through Cashfree. Today she has
three questions and no good answers:

- The order says PAID, the settlement says paid out, her bank statement says
  *something*. Three lists, three formats, one spreadsheet at 11pm.
- Fifteen payments failed. Each failure has a reason — bank timeout, no
  balance, a dead UPI ID. Some are one nudge away from recovering. Nobody
  knows which.
- A brand-new customer just paid ₹89,000 by card. Hold the shipment? Ship it?
  Her current fraud tooling gives her a feeling, not an answer.

Seven out of ten small businesses handle this by hand. Klear does the three
jobs, and then does something unusual: **it waits for permission.**

## The three jobs

**It reconciles.** Every rupee is matched three ways — order ↔ payment ↔
settlement ↔ bank statement — in exact paise. No tolerance on money, ever.
When something doesn't add up, Klear names the rupee, shows where the chain
broke, and explains which rule fired. A ₹1-off payment gets caught. A
settlement that never hit the bank gets caught. A duplicate credit in the
statement gets caught.

**It recovers.** Every failed payment gets read and triaged: bank timeouts
propose a retry, declined cards propose a UPI link, risk holds get paused
for review. Then the important part — a human clicks approve, Cashfree sends
the link, the customer pays, and the books update live on the screen.

**It defends.** Every payment gets a fraud score with reasons in plain
language — "5 attempts within an hour", "refund ratio 67%", "first-ever
transaction, ₹89,000, card". One click builds the case file through
Cashfree's verification APIs: PAN check, fuzzy name-match, bank penny drop.
Evidence, not vibes. And a loyal customer's ₹75,000 order sails through —
we test that we don't false-flag her.

## Three rules we don't break

1. **The AI never does the math.** Matching and scoring run in plain,
   deterministic code on integers. Sarvam-105B writes the words *around*
   numbers that TypeScript computed — it never computes anything itself.
2. **The AI never moves money.** Every rupee needs a recorded human "yes",
   in an append-only audit ledger. The copilot can approve with your name;
   it cannot act alone.
3. **We don't claim accuracy, we measure it.** The seed plants sixteen
   traps — eight reconciliation failures, eight fraud cases including one
   customer we're *not allowed* to false-flag. `npm run eval` must print
   16/16 or we don't demo. It's green right now.

```
Cashfree orders / payments / settlements ─┐
Bank statement (CSV or Sarvam Vision PDF) ─┴─▶ ledger ─▶ three-way match
                                              │
        ┌─────────────────┬─────────────────┤
        ▼                 ▼                 ▼
   exceptions         fraud flags      recovery plans
   (exact paise)    (rules + ONNX,     (reason → action,
                     with reasons)      human-gated)
        └────────┬────────┴────────────────┘
                 ▼
     approvals → append-only audit ledger
                 ▼
   Ask Klear: Sarvam-105B, Hinglish, over your own ledger
```

The front door is conversational on purpose: ask
*"कल कितने payments fail हुए और क्यों?"* and the copilot answers from the
merchant's own numbers, in the merchant's own language. Drop the bank
statement PDF in and Sarvam Vision reads it — in advanced mode, which
cross-checks that line items add up to the total.

## Try it

```bash
npm install
npm run db:init
npm run demo:reset     # seeds the merchant day + runs the eval (16/16)
npm run dev            # http://localhost:3000
```

No API keys? Everything still works, clearly labeled **simulation** —
recovery links open an in-app simulated checkout, the briefing falls back
to a deterministic template, PDF parsing asks for the Sarvam key. Add real
Cashfree sandbox keys and a Sarvam key to `.env` and the same code paths go
live. The eval runs either way.

## The receipts

- **Recon:** 8 planted failures (missing payment, ₹1-off amount, broken fee
  arithmetic, short bank credit, duplicate settlement, duplicate UTR,
  missing bank credit, orphan credit) — all 8 recovered exactly, every run.
- **Fraud model:** LightGBM served through ONNX inside Node, trained on
  ~48,500 synthetic rows built with the *same* feature code that runs at
  inference. Held-out golden set: **AUC 0.9997, precision 0.979, recall
  0.983, F1 0.981**. A logistic-JSON fallback and a rules floor sit under
  it, so the demo never dies because a binary failed to load.
- **Integrations follow the real contracts:** webhook event names are
  `PAYMENT_SUCCESS_WEBHOOK` and friends, signatures are HMAC-SHA256 over
  the raw body, settlement rows are the v6 nested recon schema, UTRs are
  coerced from JSON numbers, and SecureID runs on its own keys — all
  details we verified against Cashfree's own docs and open-source agent
  toolkit rather than guessing.

Retraining is two commands (`npm run gen:dataset`, `python3 ml/train.py`)
and the eval gate tells you if the new model earned its place.

## Built for the Cashfree × Sarvam Buildathon 2026

Relay is the front line — carts, COD calls, payment nudges. Klear is the
back office that Relay deserves: the matching brain, the risk brain, the
audit trail. One agent you talk to in Hindi, three jobs done with provable
accuracy, and nothing that moves money without a human yes.

MIT licensed. The fraud model, the weights, the demo data and the eval all
ship in the repo — clone it, run it, check us.

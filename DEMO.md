# Klear — 13-minute demo run-of-show

Warm-up (before judges arrive): `npm run demo:reset && npm run dev`
Dashboard open at http://localhost:3000. Terminal #2 ready with `npm run eval`.

## 0:00 — The one-liner + hero

"Klear is the AI back office for a merchant on Cashfree. It reconciles every
rupee three ways — order, settlement, bank — recovers failed payments, and
flags fraud with reasons you can read. Nothing moves money without a human
yes."

Point at the hero: **Klear score 92.5%**, ₹2.15L collected, ₹1.99L cleared,
at-risk ₹16K, recoverable ₹13K.

## 1:30 — Exceptions that don't close

Walk 2–3 planted exceptions (they're real failure modes):
- "Order marked PAID, no SUCCESS payment — ₹2,345 unaccounted."
- "Settlement arithmetic broken: net ≠ gross − fee. Gateway support ticket."
- "Same UTR credited twice in the bank statement."
Note the **exact-paise matching** — "no tolerance on money, ever; fuzziness
only in time windows, and always labeled with lower confidence."

## 3:30 — Fraud with evidence

Velocity burst: "5 attempts by one customer inside an hour — Klear flags the
whole cluster, not just the last attempt." Loyal whale: "₹75K from a regular —
one mild signal, band stays OK. We measure false positives, not just
catches."

**Build evidence pack** on the burst flag: Cashfree SecureID trio — PAN-360
registered name → name-match score (0.53 POOR_PARTIAL_MATCH) → bank
penny-drop (FRAUD_ACCOUNT). "Every flag is a dossier, not a black box.
In simulation today — the same button runs the real SecureID APIs with
verification keys, same code path."

Then the payoff line: **`npm run eval` in the terminal** — 16/16 green:
8 recon truths, 8 fraud bands, and hold-out model metrics (AUC 0.9997,
F1 0.981). "We run this before every demo. Accuracy is the product."

## 5:00 — Recovery: agent proposes, human decides

Pick a failed payment (bank_timeout). Read the agent's rationale aloud:
"Bank timeout is transient — same-method retry has high recovery odds."
Approve → **Approve & send link** → the Cashfree payment link appears
(SIMULATION badge until live keys).

## 6:00 — The customer pays

Open the link in a second tab — the simulated checkout. Pay via UPI. Back on
the dashboard: refresh → the payment lands, **recoverable ₹ drops**, the
audit trail records who approved, when, and the confirmation. "With live
keys this moment arrives via a verified webhook instead — same code path."

## 7:30 — Bank statement drop (Sarvam Vision)

Upload `artifacts/demo-bank-statement.pdf`. With a Sarvam key: Sarvam Vision
extracts the transactions → ingest is idempotent: "63 parsed, 0 new — money
is never double-counted." (Without the key, the CSV path proves the same
matcher.) Recon re-runs instantly.

## 9:00 — Ask Klear (Sarvam-105B)

Click **Morning briefing** — the narrative is written by Sarvam-105B
strictly around Klear's own computed numbers.

Then in the chat: **"कल कितने payments fail हुए और क्यों?"** — the copilot
calls its typed tools over the live ledger, answers in Hinglish with exact
numbers, and shows which tools it used (transparency chips).

## 11:30 — The control plane

Scroll the audit ledger: every action, actor, timestamp — agents, humans,
webhooks. "Approvals are documented and exportable. The copilot can approve
with your name; it cannot move money by itself."

## 12:15 — Close

"Relay is the front line — carts, calls, COD. **Klear is the back office**:
the matching brain, the risk brain, the audit trail. Together, every rupee,
cleared."

## Q&A armor

- "How accurate?" → eval harness output is on screen; run it live again.
- "What if the model is wrong?" → rules floor + human approvals + audit;
  the model only adjusts confidence, never acts alone.
- "What do you know about Cashfree's actual settlement model?" → we built
  against the v6 nested recon schema (`POST /pg/settlement/recon`, cursor
  pagination, `event_details.sale_type` CREDIT/DEBIT), the fee formula
  `amount_settled = payment_amount − service_charge − service_tax −
  settlement_charge − settlement_tax + adjustment`, 18% GST on fees, TDS
  194-O handled off-cycle, and the webhook retry ladder (3× at 2/10/30 min)
  with `x-idempotency-key` dedupe. API is source of truth; webhook is the
  real-time trigger — both are wired.
- "Are your webhooks real?" → HMAC-SHA256 over raw body + timestamp keyed
  with the client secret, event names are the actual contract
  (`PAYMENT_SUCCESS_WEBHOOK`, `SETTLEMENT_SUCCESS`…), UTRs coerced from
  JSON numbers, and a 10-minute replay window we enforce ourselves.
- "Production readiness?" → exact integer money internally (rupees↔paise
  at the API boundary), idempotent ingest, append-only ledger, per-product
  credential separation (PG vs SecureID — the 401-looking bug their docs
  warn about); swap simulation → live keys and the same paths run on
  Cashfree sandbox.
- "Why not Cashfree RiskShield alone?" → RiskShield guards the rail; Klear
  is the merchant's own books — evidence packs, recon, and recovery in one
  pane of glass.
- "What's the Sarvam story?" → 105B runs the copilot with tool-calling
  over the merchant's own ledger (Hinglish native), Sarvam Vision advanced
  mode extracts the bank statement (it cross-checks line items sum to
  total), Bulbul voices the briefing. Rate limits and pricing are documented
  — the whole demo costs ~₹30 of the ₹100 signup credits.

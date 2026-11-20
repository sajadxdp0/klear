# Klear 13-minute demo run-of-show

Warm-up before judges arrive: `npm run demo:reset && npm run dev`
Dashboard open at http://localhost:3000. Terminal number two ready with
`npm run eval`.

## 0:00 The one-liner and hero

"Klear is the AI back office for a merchant on Cashfree. It reconciles
every rupee three ways, order, settlement, bank. It recovers failed
payments, and it flags fraud with reasons you can read. Nothing moves
money without a human yes."

Point at the hero. Klear score 92.5 percent. ₹2.15L collected, ₹1.99L
cleared, ₹16K at risk, ₹13K recoverable.

## 1:30 Exceptions that don't close

Walk two or three planted exceptions. They're real failure modes.

"Order marked PAID, no SUCCESS payment. ₹2,345 unaccounted."
"Settlement arithmetic broken. Net doesn't equal gross minus fee.
Gateway support ticket."
"Same UTR credited twice in the bank statement."

Then the line about exact-paise matching: "No tolerance on money, ever.
Fuzziness only in time windows, and always labeled with lower
confidence."

## 3:30 Fraud with evidence

Velocity burst: "Five attempts by one customer inside an hour. Klear
flags the whole cluster, not just the last attempt." Loyal whale:
"₹75K from a regular. One mild signal, band stays OK. We measure false
positives, not just catches."

Build the evidence pack on the burst flag. Cashfree SecureID trio: PAN
registered name, name-match score of 0.53 poor partial match, bank
penny drop with FRAUD_ACCOUNT. "Every flag is a dossier, not a black
box. In simulation today. The same button runs the real SecureID APIs
with verification keys, same code path."

Then the payoff: run `npm run eval` in the terminal. 16/16 green, eight
recon truths, eight fraud bands, and hold-out model metrics, AUC 0.9997,
F1 0.981. "We run this before every demo. Accuracy is the product."

## 5:00 Recovery, agent proposes and human decides

Pick a failed payment with a bank timeout. Read the agent's rationale
aloud: "Bank timeout is transient. Same-method retry has high recovery
odds." Approve. Then approve and send link. The Cashfree payment link
appears with a SIMULATION badge until live keys.

## 6:00 The customer pays

Open the link in a second tab, the simulated checkout. Pay via UPI.
Back on the dashboard: refresh, the payment lands, recoverable drops,
the audit trail records who approved and when. "With live keys this
moment arrives via a verified webhook instead. Same code path."

## 7:30 Bank statement drop (Sarvam Vision)

Upload artifacts/demo-bank-statement.pdf. With a Sarvam key, Sarvam
Vision extracts the transactions and the ingest is idempotent: "63
parsed, 0 new. Money is never double-counted." Without the key, the CSV
path proves the same matcher. Recon re-runs instantly.

## 9:00 Ask Klear (Sarvam-105B)

Click Morning briefing. The narrative is written by Sarvam-105B strictly
around Klear's own computed numbers.

Then in the chat: "कल कितने payments fail हुए और क्यों?" The copilot calls
its typed tools over the live ledger, answers in Hinglish with exact
numbers, and shows which tools it used in the transparency chips.

## 11:30 The control plane

Scroll the audit ledger: every action, actor, timestamp. Agents, humans,
webhooks. "Approvals are documented and exportable. The copilot can
approve with your name. It cannot move money by itself."

## 12:15 Close

"Relay is the front line. Carts, calls, COD. Klear is the back office.
The matching brain, the risk brain, the audit trail. Together, every
rupee, cleared."

## Q&A armor

"How accurate?" The eval harness output is on screen. Run it live again.

"What if the model is wrong?" Rules floor, human approvals, audit. The
model only adjusts confidence, it never acts alone.

"What do you know about Cashfree's actual settlement model?" We built
against the v6 nested recon schema, POST /pg/settlement/recon with
cursor pagination, event_details sale_type credit and debit, the fee
formula amount_settled equals payment_amount minus service_charge minus
service_tax minus settlement_charge minus settlement_tax plus
adjustment, 18 percent GST on fees, TDS 194-O handled off-cycle, and the
webhook retry ladder of three retries at 2, 10 and 30 minutes with
x-idempotency-key dedupe. API is source of truth, webhook is the
real-time trigger. Both are wired.

"Are your webhooks real?" HMAC-SHA256 over raw body plus timestamp keyed
with the client secret. Event names are the actual contract:
PAYMENT_SUCCESS_WEBHOOK, SETTLEMENT_SUCCESS and the rest. UTRs coerced
from JSON numbers. A ten-minute replay window we enforce ourselves.

"Production readiness?" Exact integer money internally with rupees and
paise converted only at the API boundary. Idempotent ingest. Append-only
ledger. Per-product credential separation, PG versus SecureID, the
401-looking bug their docs warn about. Swap simulation for live keys and
the same paths run on Cashfree sandbox.

"Why not Cashfree RiskShield alone?" RiskShield guards the rail. Klear
is the merchant's own books: evidence packs, recon, and recovery in one
pane of glass.

"What's the Sarvam story?" 105B runs the copilot with tool calling over
the merchant's own ledger, Hinglish native. Sarvam Vision advanced mode
extracts the bank statement and cross-checks that line items sum to the
total. Bulbul voices the briefing. The whole demo costs about ₹30 of the
₹100 signup credits, and nothing throttles at pay-as-you-go rate limits.

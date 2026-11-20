# The landscape, and what Klear borrows

The failed-payment and dispute niche is well developed in the United
States, mostly around subscription card billing. India's reality is
different enough that importing those tools wholesale wouldn't work, and
different enough that the opportunity is real.

## What the US tools do

**Failed payment recovery (dunning and retry engines).** Stripe Smart
Retries and Paddle Retain ship inside the biller. Churn Buster (about
$269 a month) and Baremetrics Recover add a branded outreach layer when
customers ignore the processor's emails. Churnkey leads with cancel-flow
retention, claims up to 89 percent recovery, starts at $250 a month, and
publishes an open-source SDK and MCP server. Slicker, a YC-backed
newcomer, sells ensemble retry models with lift testing against the
status quo. Chargebee Revive reads 200+ signals per failed payment to
decide when, and whether, to retry.

**Dispute automation.** Chargeflow automates chargeback responses for
15,000+ merchants across 50 processors, prices on outcomes (it bills
when it wins), and uses Visa and Mastercard network alerts to stop
chargebacks before they land. That alert-first posture is the entire
point: the cheap dispute is the one that never opens.

**Reconciliation.** The US stacks lean on the biller's own reports plus
specialist ops platforms. Recko, which built merchant-side
reconciliation, ended up acquired by Stripe. The pattern is telling:
reconciliation is table stakes that becomes valuable when it drives
action, not just reports.

## What we borrow

From Churn Buster: recovery works when the outreach is branded and
human, not a processor email. Klear's recovery links carry the
merchant's name and UPI intent, and the approval sits with the merchant.

From Chargeflow: sell outcomes, not features. Klear's dashboard leads
with the recoverable rupee amount, and the demo arc is that number
dropping.

From Chargebee Revive: read the payment, not just the failure. Klear's
triage reads the failure reason, the customer's history, and the fraud
band before proposing anything.

From the recon platforms: reconciliation earns its keep by triggering
the next action. A mismatch in Klear is not a report row, it is a
decision queue.

## What we refuse to copy

Subscription-first framing. India's SMB money is one-shot UPI commerce,
not monthly cards, so retry-timing engines are the wrong shape. Card
update flows, the centerpiece of US dunning, are meaningless when the
rail is UPI.

English-only outreach. A US dunning email would die unread in most
Indian SMB inboxes. Klear speaks the merchant's language, literally:
Hinglish chat, Saaras hearing a spoken question, Bulbul reading the
briefing.

Black-box scores. US fraud platforms sell a decision. Klear sells the
reason, with an evidence pack a merchant can forward to their gateway's
support line.

The gap in the market: nobody has built the recovery-plus-recon back
office that is UPI-native, multilingual, and priced for an Indian SMB.
That is Klear.

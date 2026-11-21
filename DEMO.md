# Klear Collections, 13-minute demo (Problem 2)

Warm-up before judges arrive:

```bash
cd /home/sajadxdp/klear
npm run db:init && npm run db:seed && npm run db:seed-collections
npm run eval && npm run eval:collections     # both green, 16/16 + 1.6x lift
npm run dev
```

Open `http://localhost:3000/collections`. Terminal two shows the eval
output. If the Cashfree Relay MCP is connected, also open the Relay
workflow screenshot.

## 0:00 The scene, over the queue

"Meena runs collections at a regional lender. 4,200 overdue accounts,
six callers, eleven days to month-end. Her list is sorted by loan
number, so her callers will call in order, spending most of today on
people who will never pay. The list cannot tell them apart."

"Klear can. And it can explain every choice it makes."

Point at the top lane: rank one, rank two, reasons attached.

## 1:00 Why the top rows are the top rows

Read rank two's reason aloud: "Kept 2 of 2 past promises. Salary
expected within the week. Ask right after it lands."

"One signal a regulator can read, one behavior a manager can verify,
one scheduling fact the borrower herself told us. Five signals total,
and here is the list we refuse to touch."

Gesture at the footer: no name, no language, no area, no gender, not
down-weighted, not inputs at all. "The eval prints the fairness check
and we will show it at the end."

## 2:00 The claims bucket

"The book says three people claim they already paid at the branch.
The claim is either a lifeline or an excuse, and we don't guess which."

Click Verify against ledger on the first one: payment found, removed
from the queue with thanks, no wasted call.

Click the second: "No payment found. The claim does not hold. A kind
link goes out instead." Same button, both truths, zero trust wasted.

## 3:00 The approval moment

Approve the payment link for the salary borrower. The Hindi message
draft appears. Read the translation: a reminder, a link, an offer of
help, no threat anywhere. The link is a Cashfree payment link, partial
payments available for the hardship branch.

"With live keys this is a real sandbox link and the payment lands
through a verified webhook. Same code path either way."

## 4:00 The moment the brief asked for

Open the payment link in a second tab, the simulated customer checkout.
Pay via UPI.

Back on the queue: refresh. Her row is gone, stamped into the resolved
lane. A new rank one has risen, with his reason attached.

"A payment landed, the queue re-formed, and the agent can say why. That
is the product."

## 5:30 The kindness branch

Point at the hardship case: "this month is hard." Click Offer partial
payment. A Cashfree partial link with a 25 percent minimum, a draft that
offers a way forward instead of a harder push. Then the defer option,
payday-scheduled, no contact until then.

"A borrower who cannot pay is offered a way forward. That is a red
line in the brief and a lane in our product."

And the honest refusal: the serial promiser, six promises, zero
payments, held out of today's calling set. "The queue refuses to waste
calls on him, and it says so."

## 7:00 The multilingual front door

Message drafts render per borrower: Hindi, Tamil, Kannada, English.
The calling window chip shows IST time and the 8 AM to 7 PM norm.
Every call draft carries the recorded-conversation disclosure.

## 8:00 The eval, our receipts

Terminal two:

```bash
npm run eval:collections
```

"Our ranker finds 11 payers in the top fifteen. Loan-number order finds
7. A 1.6 times lift, measured against held-back outcomes the agent never
sees. Planted traps: two genuine branch payments verified, one false
claim caught, the salary borrower scheduled, the hardship case offered
a partial, the serial promiser benched. All green."

"And the fairness table: language distribution in the top queue tracks
the book. No proxy ranking. That is the check the brief demands."

## 10:00 Relay, the rails

Show the Relay endpoint payload or the workflow screenshot: the same
branch plan as JSON, ready for the HTTP node inside a Relay workflow.
Schedule trigger, WhatsApp or a Bolna call per borrower, payments
through Cashfree links.

"Relay is Cashfree's agent platform: triggers, channels, approvals. The
EMI Collections agent template calls in whatever order it is given.
Klear is the order it is missing. Relay is the body, Klear is the mind,
and the money moves inside Cashfree the whole time."

## 12:00 Close

"Six callers can reach sixty people today. The list would spend them on
loan number LN-10001 onward. Klear spends them where the rupees and the
reasons are. Every borrower reached in their own language, every claim
checked against the ledger, every decision one a manager can read
aloud, and nothing moves without a human yes."

## Q&A armor

"How do you know the ranking is good before anyone pays?" The eval:
held-back outcomes, lift 1.6x, printed live.

"Could it be ranking on language or community?" No. Those fields are
not inputs to the scorer, and the fairness table is printed as proof.

"What if a promise is a lie?" Promise history is tracked: kept versus
made. Six promises, zero kept, the queue benches you.

"What about someone who cannot pay?" Partial links with a minimum,
defer to payday, no pressure copy exists anywhere in the product.

"Does the LLM decide anything?" It drafts language, it never ranks, it
never moves money, and it never sees held-back outcomes. The scoring is
plain code a manager could recompute by hand.

"What happens when Cashfree drops a fresh file on you?" The loader maps
columns leniently, the five signals generalize because they are
behaviors, not keywords, and the eval reruns against whatever outcomes
the file holds.

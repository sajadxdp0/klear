# Klear Collections, 10-minute demo (Problem 2)

The briefing deck sets the judging: show a live call in an Indian
language, show the money on screen, keep it tight. Ten minutes with
Q&A, hard stop. This script is built around those three.

Warm-up before the panel:

```bash
cd /home/sajadxdp/klear
npm run db:init && npm run db:seed && npm run db:seed-collections
npm run eval && npm run eval:collections     # both green on screen
npm run dev
```

Screen one: `http://localhost:3000/collections`. Screen two: the Relay
agent run (canvas or Runs tab). Terminal: eval output standing by.

## 0:00 The scene, over the queue (60 seconds)

"Meena runs collections at a regional lender. 4,200 overdue accounts,
six callers. Her list is sorted by loan number, so today her callers
start at LN-10001 and reach fewer than a tenth of the book. The list
cannot tell a forgotten payment from a broken promise from a lie."

"Klear reads the book instead. Watch who it calls first."

Point at rank one and rank two. Read rank two's reason aloud: kept both
past promises, salary lands this week, ask right after it.

## 1:00 The live call, in her language (90 seconds)

The judging moment. Select the top borrower, hit the call action: the
Sarvam voice draft generates live (or the Relay agent places the call).
Play it. Hindi, kind, with the recorded-call disclosure and a one-tap
payment link.

"Every word of that call was decided by rules, in her language. There
is no threat in any template, because a borrower who cannot pay gets
an offer, not pressure. That call cost us about two rupees of the
Sarvam credits and one of our 240 call minutes."

## 2:30 The money lands (90 seconds)

Approve the payment link (human yes, recorded with the approver's
name). Open the link in the second tab, the customer checkout. Pay.

Back on the queue: refresh. Her row stamps into the resolved lane, a
new rank one rises, and his reason is attached.

"That is the moment the brief asked for. A payment landed, the queue
re-formed, and the agent can say why. In the sandbox this link
behaved for real, no actual money moved."

## 4:00 Claims are checked, never trusted (90 seconds)

"The book says three people claim they already paid at the branch. The
claim is either a lifeline or an excuse. We don't guess which, we check
the ledger."

Verify the first: payment found, removed with thanks, no wasted call.
Verify the second: no payment found, the agent stays kind and sends a
link instead.

## 5:30 The kindness branch and the honest refusal (60 seconds)

The hardship case: this month is hard. Offer partial payment, a Cashfree
partial link with a 25 percent minimum, a draft that offers a way
forward. Then the defer option, payday-scheduled, no contact until
then.

And the serial promiser: six promises, zero payments, held out of the
calling set. "The queue refuses to waste a call on him, and it says
so."

## 6:30 The receipts (60 seconds)

Terminal. Run the collections eval live.

"Our ranker finds 11 payers in the top fifteen, loan-number order finds
7, a 1.6 times lift measured against outcomes the agent never sees.
Salary borrower ranked second, serial promiser benched, both genuine
branch payments verified, the false claim caught. And the fairness
table: language distribution in the top queue tracks the book, no
proxy ranking. Those signals are refused by construction, not tuned
away."

## 7:30 Relay is the rails (60 seconds)

Show the Relay canvas or Runs: trigger, HTTP step into Klear's ranker,
Sarvam voice for the call, Cashfree link for the money.

"Relay is the platform: triggers, channels, approvals. The gallery has
cart recovery and failed payments, nobody has the collections brain, so
we built it. Klear decides, Relay delivers, the money moves inside
Cashfree the whole time."

## 8:30 Close (30 seconds)

"Six callers, sixty calls, thousands of accounts. The list spends them
in loan order. Klear spends them where the rupees and the reasons
are, reaches every borrower in their own language, checks every claim
against the ledger, and nothing moves without a human yes."

## Q&A armor (standby)

"Could it rank on language or community?" Those fields are not inputs.
The fairness table is printed proof.

"How do you know the ranking is good?" Held-back outcomes, 1.6x lift,
the eval runs live.

"What if a promise is a lie?" Promise history: kept versus made. Six
promises, zero kept, benched.

"Someone who cannot pay?" Partial link with a minimum, defer to
payday, no pressure copy exists anywhere.

"Does the LLM decide anything?" It speaks. It never ranks, never moves
money, never sees held-back outcomes.

"Fresh file you have not seen?" The five signals are behaviors, not
keywords. The loader maps columns leniently and the eval reruns against
whatever the file holds.

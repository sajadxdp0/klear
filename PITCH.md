# Klear pitch kit

---

## Part 1. For teammates (plain language, 2 minutes)

### What problem are we solving?

Picture Priya. She runs a D2C grocery brand in Bengaluru. Yesterday she
collected about ₹2.15 lakh through Cashfree, spread across UPI, cards and
netbanking. Today she has three questions nobody can answer quickly.

1. "Is all my money actually in my bank?" Her orders say PAID, Cashfree
   says settled, her bank statement says something. Three lists, three
   formats, and she reconciles them in a spreadsheet at 11pm. If she
   reconciles at all.
2. "Why did 15 payments fail yesterday?" Every failure has a reason: bank
   timeout, insufficient balance, wrong UPI ID. Some are recoverable with
   one nudge. She doesn't know which.
3. "Is that ₹89,000 order real or fraud?" A brand new customer, first
   purchase, big card payment. Hold it? Ship it? Nobody tells her why it
   looks risky. She gets a gut feeling.

Seven out of ten small businesses handle all of this manually. That's
the problem.

### What are we building?

Klear. An AI back office that does all three jobs, and asks before it
touches money.

It reconciles. We match every rupee three ways: order, payment, bank
statement. Exact paise, no "approximately". When something doesn't add
up, Klear shows the mismatch and says which rupee is missing and where
the chain broke.

It recovers. For every failed payment, Klear reads the failure reason
and proposes the smart next move. Bank timed out? A retry costs nothing.
Card declined? Send a UPI link instead. Then it waits. The merchant
clicks approve, Cashfree sends the link, the customer pays, and everyone
watches the books update live.

It defends. A machine learning model scores every payment for fraud
risk, and more importantly it explains itself: five attempts in an hour,
refund ratio 67 percent, first ever transaction at ₹89,000 on a card.
One click builds an evidence file using Cashfree's own verification
APIs: does the PAN name match, is the bank account flagged.

### What makes it special?

The merchant talks to it in their own language. They can ask
"कल कितने payments fail हुए और क्यों?" in Hindi, Hinglish or English, and
Klear answers with the real numbers from their own ledger, spoken back
if they want. That's the Sarvam side. The payments side is Cashfree:
real API integration, real webhooks, real payment links.

And the whole thing is honest by design.

The AI never does arithmetic on the books. Matching is plain code, exact
integers. The AI writes the words around the numbers.
The AI never moves money. Every rupee needs a human yes, recorded in a
permanent audit log.
We measure ourselves. Before every demo we run an eval that checks 16
planted ground truth cases: 8 reconciliation traps, 8 fraud scenarios.
It prints PASS or FAIL. It's green right now.

### Where are we in the build?

The hard research is done. Every Cashfree and Sarvam API we use has been
verified against their official docs and their own open-source toolkit.
The starter template (scaffold, theme, API clients, webhook handler, the
trained fraud model generator, demo data) is ready and rehearsed.
Tomorrow, per the event's ground rule that code is written on the day,
we assemble the full product live in the room. With me guiding, that's
about 90 minutes of fast, safe building. Then we rehearse the demo twice
and freeze at 3:15 PM.

### What do we need?

Everyone registered on Luma with the same phone number used for the
ticket, and active on the Discord. Selection leans on it.
Cashfree test account and Sarvam account created, keys pasted into
`.env`.
On the day: a 13-minute demo, one voice. Everyone should still know the
story cold, because judges will split questions across the team.

One line to remember: Klear proposes, the merchant approves, the money
moves, the books clear.

---

## Part 2. For technical judges (opening script, about 90 seconds)

Spoken, not read. Pause where marked. No slides for the first 30 seconds.

Every day across India, thousands of merchants collect money.

And every night, most of them lose track of some of it.

An order says PAID. But the settlement didn't arrive.
A customer's payment fails. And nobody chases it.
A big order looks off. And nobody can say why.

So the merchant opens a spreadsheet, at 11pm, and hopes.

That's not a workflow. That's a leak.

(pause)

We asked a question. What if the back office could just run itself?

Not a dashboard you stare at. An agent you talk to, in Hindi, in
Hinglish, in Kannada, that has already read your books, already found
the leaks, and already knows what to do about each one.

(pause)

Today we're introducing Klear.

It does three things. Nothing more. And that's the point.

One. It reconciles. Every rupee, matched three ways: order, settlement,
bank. Exact paise, no tolerance. When money goes missing, Klear tells
you which rupee, where the chain broke, and why.

Two. It recovers. Every failed payment gets a plan: retry, relink, or
hold. Then the important part. It waits for your yes. One click,
Cashfree sends the link, the customer pays, and you watch the books
clear. Live.

Three. It defends. Every payment gets a fraud score, with reasons you
can read. And one click builds the case file: PAN check, name match,
bank verification. Evidence, not vibes.

(pause)

Now. Here's what makes this different from every AI fintech demo you've
seen today.

The AI never does the math. Matching runs in plain, deterministic code.
The AI never moves the money. Every rupee requires a human approval,
and every approval lands in a permanent audit log.

And we don't claim accuracy. We measure it. Sixteen planted traps:
missing settlements, one-rupee mismatches, duplicate credits, fraud
bursts, and one loyal customer we're not allowed to false-flag.
Sixteen out of sixteen, every run, printed live, alongside the model's
held-out precision and recall.

(pause)

You'll see a merchant ask a question in Hindi. Watch the agent answer
from the merchant's own ledger. Watch it propose a recovery. Watch a
human approve. Watch the customer pay. And watch the score climb in real
time. The score is the money that's fully cleared.

(beat)

Relay is the front line. Klear is the back office.

Every rupee, cleared.

(then straight into the live demo)

---

## The 30-second version (for hallways and judges' questions)

Klear is a human-gated AI back office for Cashfree merchants. It
reconciles every payment three ways in exact paise, proposes recovery
for every failure, and flags fraud with evidence from Cashfree's
verification APIs. The copilot speaks Hinglish over the merchant's own
data. Sarvam-105B writes the words, deterministic code does the math,
and no rupee moves without a human yes. We verify ourselves with a
16-check eval. It's green right now. Want to see it run?

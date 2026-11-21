# Design note — the collections agent

The submission asks for key design choices, including what we chose not
to use. This is that note.

## The problem we picked

Problem 2: who will pay first. A collections manager with 4,200 overdue
accounts and six callers. We built the agent that decides who to reach
today, reaches them in their language, verifies claims before contact,
and refuses to spend calls where they cannot pay.

## The architecture

The agent runs on Cashfree Relay, built by hand from their nodes: one
inbound webhook trigger, one router, four branches. There is no
external brain called at runtime. The intelligence is the branch order
and the conditions, exactly as the brief wants an agent built: trigger,
decide, act, inside their platform.

1. **Verify first.** A borrower who claims to have paid is never
   trusted and never ignored. The branch routes the claim to the
   manager with the payment reference requested, before any call.
2. **Offer partial.** Hardship on record gets a partial payment link
   with a 25 percent minimum and a draft that offers a way forward. No
   pressure words exist in any template, because this branch exists.
3. **Call today.** The productive band: overdue 15 to 60 days and a
   promise history of at least half kept. The branch speaks in the
   borrower's language through Sarvam, with the recorded-call
   disclosure inside the script, and sends a Cashfree payment link.
4. **Otherwise, hold.** Long overdue with promises never kept. The
   agent refuses to waste a call and tells the manager why.

Claims outrank hardship, hardship outranks the calling band. Order is
policy.

## The receipts, measured offline

The same conditions were evaluated offline against a held-back outcomes
file the agent never sees: our top fifteen of a sixty account book
finds eleven payers, loan-number order finds seven, a 1.6 times lift.
The salary-hinted borrower ranks second. The serial promiser is
benched. Two genuine branch payments verify out of the claim
bucket, one false claim is caught. The eval prints all of it, plus a
fairness table: the conditions read days overdue, promise history,
hardship and claims, and the language distribution of the top queue
tracks the book, because name, language, area, gender and their proxies
are not inputs at all.

## Key choices

**Deterministic conditions, not a learned model.** The router reads
behaviors. A regulator can audit every condition, a manager can recompute
any branch by hand, and nothing drifts or trains on its own call
history.

**Fairness by construction.** Name, language, area, phone, gender,
religion, caste: not down-weighted, not inputs. The fairness table is
printed, not promised.

**Claims are checked, never trusted.** The brief calls it: already paid
is either a lifeline or an excuse. The verify branch exists so the
answer never depends on hope.

**Kindness is a branch, not a tone.** Partial links with a minimum, kind
copy in the borrower's language, the calling window respected, the
recorded-call disclosure inside every script.

**Sarvam where language lives, Cashfree where money lives.** Sarvam
speaks the call. Cashfree carries the link and the payment. No other
platform is needed at runtime.

## What we chose not to use, and why

- **No learned ranking model.** Unexplainable under audit, overfits a
  one-day sample, and the brief demands reasons a manager can read.
- **No protected characteristics or their proxies.** The obvious
  shortcuts are unfair, and the brief says show how you checked.
- **No training on call history.** The agent cannot talk itself into a
  corner because it never learns from its own outreach.
- **No pressure tactics anywhere.** The hardship branch is the answer
  to a borrower who cannot pay, and it is an offer.
- **No reliance on error description strings.** Cashfree's own docs
  call them display-only. Conditions branch on codes.
- **No MCP or external model calls at runtime.** The event data and
  the router carry the decisions. Everything that runs, runs on Relay.

## One success case and one failure case

Success: Sunita, overdue 18 days, both past promises kept. The router
puts her in the calling band, the run generates her Hindi call with the
disclosure and creates her payment link live in front of the judges.

Failure handled well: Shanta Bai cannot pay in full this month. The
agent refuses to push harder and takes the partial branch instead: a
Cashfree partial link at a 25 percent minimum and a draft that offers a
way forward. The second failure case: Naseem claims he paid at the
branch with four promises never kept. The agent spends no call, asks
for the reference, and says why.

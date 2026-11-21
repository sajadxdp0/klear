# Design note — Klear Collections

The submission asks for key design choices, including what we chose not
to use. This is that note.

## The problem we picked

Problem 2: who will pay first. A collections manager with 4,200 overdue
accounts and six callers. We built the agent that decides who to reach
today, reaches them in their language, verifies claims against the
ledger, and re-plans the moment anything changes.

## Key choices

**A deterministic ranker, not a learned one.** The scorer is plain
TypeScript with five defensible signals: overdue band, amount at stake,
promise history, a stated payday, contact recency. A regulator can read
every line of it, a manager can recompute any borrower's score by hand,
and it cannot drift or train on its own call history (the brief warns a
self-trained ranker can talk itself into a corner). We measured the
alternative we rejected: an ML model would need outcomes we deliberately
never show the agent.

**Fairness by construction, not tuning.** Name, language, area, phone,
gender, religion and caste are not down-weighted; they are not inputs.
The eval prints the language distribution of the top queue against the
book to show no proxy ranking. The held-back outcomes file proves the
ranking beats calling in loan-number order, 1.6x on payers found in the
top fifteen.

**Claims are checked, never trusted.** "Branch mein de diya" is either a
lifeline or an excuse. Every paid-claim sits in a verify-first bucket
until the ledger answers. Two genuine branch payments verify and leave
the queue with thanks. One false claim is refuted, kindly, and a link
goes out instead.

**The LLM never ranks and never moves money.** Sarvam-105B drafts the
outreach copy in the borrower's language (Hindi, Tamil, Kannada,
English) and narrates briefings around numbers TypeScript computed. The
ranking, the banding and every payment action are deterministic code
behind a human approval recorded in an append-only ledger.

**Kindness is a branch, not a tone.** A borrower who says this month is
hard gets a partial payment link (Cashfree partial links with a 25
percent minimum) and a defer-to-payday option. No pressure copy exists
in any template. The calling window guard respects the 8 AM to 7 PM
norm, and call drafts carry the recorded-conversation disclosure.

**Relay is the rails, Klear is the mind.** The same branch plan is
served as JSON for a Cashfree Relay workflow through the HTTP node
(schedule trigger, WhatsApp or Bolna voice per borrower), so the
execution can run inside Cashfree's own agent platform with Klear
supplying the decisions. The payments themselves land through Cashfree
payment links and webhooks in the sandbox.

## What we chose not to use, and why

- **No ML ranking model.** Under a one-day build it would be
  unexplainable to a non-technical reviewer, exactly where the brief
  demands explainability, and it would overfit the sample book.
- **No name, language, area, gender or any proxy signal.** The obvious
  shortcuts are unfair, and the brief says show how you checked.
- **No self-training on call history.** The ranker never learns from its
  own outreach, so it cannot talk itself into a corner.
- **No pressure, threats or shame anywhere in the copy.** The hardship
  branch offers a way forward; that is the whole point of it.
- **No training on, or display of, held-back outcomes.** The eval reads
  them after ranking, not the agent before it. The agent is outcome
  blind by design.
- **No reliance on error_description strings.** Failure reasons branch
  on codes, per Cashfree's own guidance.
- **The Relay MCP route we left as a documented option, not a
  dependency.** It needs an owner account and a second client; the HTTP
  node gets the same integration with less risk on demo day.

## One success case and one failure case

Success: Sunita, overdue 18 days, kept both past promises, told us her
salary lands within the week. The ranker put her at number 2, the
manager approved a link, she paid, and the queue re-formed on screen
with a new number 1 rising with his reason attached.

Failure handled well: Shanta Bai cannot pay in full this month. The
agent refused to push harder and offered the partial-payment branch
instead, with a defer option, recorded in the audit ledger. The second
failure case we show: a borrower who claimed to have paid at the branch
and had not. The ledger refuted the claim and the agent stayed kind
about it.

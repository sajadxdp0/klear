# Relay manual build — the collections agent, node by node

No MCP, no external backend, no custom server. Every piece of the
collections brain is expressed as Relay nodes: one trigger, one router,
four branches. The intelligence is the branch conditions. The events
that drive it are the four sample JSON files in
`artifacts/relay-events/`, ready to paste into Postman exactly the way
the briefing's sandbox slide teaches.

Target time: 30 to 45 minutes of clicking, with the Relay desk one arm
away. Every value you need is written here.

## The brain, as branches

The ranker translated into router conditions, in priority order:

1. **Verify first** — she claims she already paid. Never take a claim
   on trust, never waste a call. Ask for the reference, route to the
   manager.
2. **Offer partial** — hardship on record. A borrower who cannot pay
   gets an offer, not pressure. Partial link, kind words.
3. **Call today** — the productive band: overdue 15 to 60 days, and she
   keeps her promises (kept at least half). Fresh link, call in her
   language.
4. **Otherwise, hold** — long overdue with a history of broken
   promises. The queue refuses to spend a call here, and says so.

Order matters: a claim outranks hardship, hardship outranks the
calling band.

## Build it

1. Log in at merchant.cashfree.com, **switch to test** (yellow banner).
   Left menu → **Relay**.
2. **Agents → Create Agent.** Name: **Collections agent**.
3. **Trigger → Inbound webhook.** Copy the webhook URL it shows. This is
   exactly the sandbox pattern from the briefing: sample event from
   Postman, watch the agent run. (A Schedule trigger reads better for
   the story but needs a data source; the webhook trigger IS the demo.)
4. **+ Add step → Flow Control → Router.** Four branches, in this order:

   | Branch | Conditions (all must match) |
   |---|---|
   | A. Verify first | `claimsPaid` is `true` |
   | B. Offer partial | `hardship` is `true` |
   | C. Call today | `daysOverdue` ≥ 15 AND `daysOverdue` ≤ 60 AND `promisesKept` ≥ 1 |
   | Otherwise | (default, no conditions) |

   Field paths from the webhook body are like `borrower.claimsPaid`.
   Use the canvas placeholder picker to select them. If the picker or
   the condition operators fight you, this is the moment to wave the
   Relay desk over: conditions on nested JSON fields are exactly their
   job.

5. **Branch A (verify):** a WhatsApp or Gmail action to the manager:
   `"{{borrower.name}} claims the loan {{borrower.loanNo}} was paid at
   the branch. No call yet: get the payment reference first."`
   That is the whole branch. A claim is checked, never trusted.

6. **Branch B (partial):**
   - **Cashfree → Create payment link** with `amountDueRupees`, name and
     phone from the event, and partial payments enabled with a minimum
     of 4750 (25 percent).
   - **Sarvam → Text-to-speech** in `hi-IN` (or WhatsApp):
     `{{borrower.name}} ji, is mahine poora bhugtan mushkil ho to kam se
     kam rupaye chaar hajar saat sau panchas se shuru kar sakte hain.
     Aapki mushkil samajhte hain, saath milke hal nikalenge. Yeh link
     kabhi bhi kholein.` If the placeholder picker cannot reach
     `borrower.name`, hardcode the message with the name typed in; the
     draft is written, the agent still sends it.
   - No pressure words anywhere. This branch exists so nobody ever has
     to write one.

7. **Branch C (call today):**
   - **Sarvam → Text-to-speech**, `hi-IN`, the call script with
     placeholders:
     `Namaste {{borrower.name}} ji, {{borrower.loanNo}} ke bare mein
     baat karni hai. Kul rupaye {{borrower.amountDueRupees}} baaki hain.
     Yeh baatcheet record ki ja rahi hai. Bhugtan ke liye yeh link
     kabhi bhi kholein.`
     The recorded-call disclosure is inside the script, on purpose: the
     rules require it and the judges will hear it.
   - **Cashfree → Create payment link** with the event's amount, name,
     phone.
   - Optional: **WhatsApp → send** the same link with a text version.

8. **Otherwise (hold):** a single Gmail or Slack note to the manager:
   `"{{borrower.name}}, loan {{borrower.loanNo}}: {{borrower.promisesKept}}
   of {{borrower.promisesMade}} promises kept. No call today."` The
   honest refusal, recorded.

9. **Test flow.** With the four sample events from Postman:

   ```bash
   # replace WEBHOOK_URL with the one the canvas shows
   curl -X POST WEBHOOK_URL -H 'Content-Type: application/json' \
     -d @artifacts/relay-events/1-call-today.json
   ```

   | Event file | Expected branch |
   |---|---|
   | `1-call-today.json` (Sunita, 18 days, 2/2 promises) | Call today: TTS call script + payment link |
   | `2-offer-partial.json` (Shanta, hardship) | Offer partial: partial link + kind draft |
   | `3-verify-claim.json` (Naseem, claims paid, 4 promises 0 kept) | Verify first: manager note, no call |
   | `4-hold.json` (Ravi, 90 days, 6 promises 0 kept) | Otherwise: no call, manager note |

10. Open **Runs** after each POST: you should see four different paths
    through one agent. Then flip **Draft → Active**.

## During the demo

Minute one: Postman the Sunita event in front of the judges. The run
fires live: **the Sarvam call audio in Hindi plays** (the live call
they asked for) **and the Cashfree link appears in the run** (the money
they asked for). Then fire the other three events, thirty seconds each,
four branches of one agent doing the right thing each time.

The laptop beside it shows the receipts: the same branch conditions,
measured offline against held-back outcomes, a 1.6 times lift over
calling in order, and a fairness table proving no name, language or
area signal ever entered the logic. The router conditions on screen
are not a guess, they are the measured version.

## If anything blocks

- The Relay desk adds or fixes nodes on the spot, including simple API
  calls, and AWS Lambda access exists if custom code is ever needed.
- If the Sarvam TTS node shape is unclear, ask the Sarvam desk: voice
  is their lane today.
- If routers on nested fields fight you, flatten the test event (put
   the borrower fields at the top level) and tell the desk; the sample
   files can be flattened in one minute.
- Five minutes of head-scratching maximum, then call them over.

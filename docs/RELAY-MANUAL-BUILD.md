# The Relay agent, built by hand — the complete guide

Everything below is from Cashfree's own documentation, verified page by
page: the canvas mechanics, the trigger panel, the router, the
connections, the test flow, and the runs. No MCP, no backend, no
custom server. One trigger, one router, four branches, two connections.

Budget: about 45 minutes end to end. Each step says what to click and
what you should see.

## What you are building

```
Webhook trigger (a borrower arrives)
        │
      Router ─────────────────────────────────────────
        │             │               │            │
   verify first   offer partial   call today   otherwise: hold
   (claim)        (hardship)     (15–60d,     (no call, manager
   manager note,   partial link   keeps        told why)
   no call        + kind draft   promises:
                                  voice + link)
```

Claims outrank hardship, hardship outranks the calling band. Order is
policy. The events in `artifacts/relay-events/` are flat on purpose:
top-level fields, so every router condition picks cleanly.

## Step 0. Two connections, five minutes (before anything)

You need exactly two. Skip Gmail, Slack, WhatsApp and Sheets entirely:
the HTTP action needs no connection at all, and it covers every
notification branch.

**Sarvam AI** (for the voice call):
Relay dashboard → **Connections** tab → **Add new connection** →
Sarvam AI → paste your API subscription key (from
`dashboard.sarvam.ai` → API Keys) → **Save**.

**Cashfree** (for the payment link):
Same place → **Add new connection** → Cashfree. For the App ID and
Secret Key: Merchant Dashboard → **Developers → API Keys** under
Payment Gateway. In test mode the keys are auto-generated; click the
ellipsis → **View API Key** to reveal them. Paste, **Save**.

## Step 1. Create the agent (1 minute)

Merchant Dashboard → **Relay** → **Set up an automation** (or Agents →
Create Agent). Name it: **Collections agent**.

## Step 2. The trigger (3 minutes)

Click the **Add a trigger here** node → select **Inbound Webhook** →
select **Inbound Webhook** again. The panel shows an auto-generated
name (something like `picnic-bargain-maple`) and a read-only
**Webhook URL**.

- Click the copy icon. Keep it, you will POST the four events to it.
- Optionally click **Edit** to rename it `collections-book`.
- Click **Confirm Selection**.

## Step 3. Set the sample data, the trick that saves the demo (2 minutes)

Open the canvas header's ellipsis (**⋯**) menu → **Update initial
Data**. Paste the full contents of
`artifacts/relay-events/1-call-today.json` (the Sunita borrower) as
the sample data and save.

From now on, **Test flow** at the top right runs the whole agent with
Sunita's data, live, on screen. To demo a different borrower, paste a
different event file the same way. This is the guaranteed on-stage
path: no network, no Postman, just Execute.

## Step 4. The router and its four branches (10 minutes)

Click **+ Add step** between the trigger and End → **Flow Control** →
**Router**. You get **Branch 1** and **Otherwise**. Add two more
branches with the edit icon on the Router node. Name and configure
them in this order:

| # | Branch name | Conditions (add under the branch) |
|---|---|---|
| 1 | Verify first | `claimsPaid` Equals `true` |
| 2 | Offer partial | `hardship` Equals `true` |
| 3 | Call today | `daysOverdue` Greater than or equal `15` AND `daysOverdue` Less than or equal `60` AND `promisesKept` Greater than or equal `1` |
| 4 | Otherwise | no conditions, the fallback |

Operators are the same attribute/operator/value dropdowns the event
triggers use (Equals, Greater than, and friends). The fields are
top-level in the payload, so the attribute picker should list them
directly. If the picker only sees a generic body, ask the Relay desk
for the expression path, or flatten further with their help.

**Save** the router. All branches converge on the End node.

## Step 5. The actions, branch by branch (15 minutes)

First, open [webhook.site](https://webhook.site) in a browser tab and
copy your unique URL. Free, instant, no signup, and Cashfree's own
docs recommend it for exactly this kind of testing. Every manager
note fires there, visible on screen.

**Branch 1, Verify first** — under it, **Add step → Action in an app
→ HTTP**:
- Method: POST
- URL: your webhook.site URL
- Body: `{"note": "CLAIM TO VERIFY", "borrower": "{{name}}", "loan":
  "{{loanNo}}", "instruction": "No call yet. Get the payment
  reference from the borrower first."}` (use the placeholder picker
  for the fields; if nested picking is awkward, type the loan number
  directly for the demo)
- **Test Node**: you should see the POST land on webhook.site, live.

**Branch 2, Offer partial** — two actions:
- **Cashfree → Create payment link**: amount from the event (19000 for
  Shanta, or the placeholder), customer name and phone from the
  event, and partial payments with a minimum of 4750. If the partial
  field is not offered on the action, ask the Relay desk to add it,
  that is the exact thing they said they can do on the spot.
- **Sarvam AI → Text-to-speech**: language `hi-IN`, the kind draft:
  `Shanta ji, is mahine poora bhugtan mushkil ho to kam se kam rupaye
  chaar hajar saat sau panchas se shuru kar sakte hain. Aapki mushkil
  samajhte hain, saath milke hal nikalenge.`

**Branch 3, Call today** — two actions, the demo's heart:
- **Sarvam AI → Text-to-speech**, language `hi-IN`, the call script
  with the disclosure inside it:
  `Namaste Sunita ji, LN-70004 ke bare mein baat karni hai. Kul
  rupaye 6800 baaki hain. Yeh baatcheet record ki ja rahi hai.
  Bhugtan ke liye nayaa link bheja hai, aap kabhi bhi khol sakte
  hain. Dhanyavaad.`
  (If the placeholder picker reaches the event fields, use it for the
  name and amount. If not, the typed script is honest too: the agent
  still speaks it, and you say the plan feeds the script.)
- **Cashfree → Create payment link**: amount 6800 (or placeholder),
  name Sunita Devi, phone +919812345604.
- Optional third: **HTTP → webhook.site** logging `"CALL TODAY: name,
  reason"`.

**Branch 4, Otherwise (hold)** — **Add step → HTTP**:
- POST to your webhook.site URL with
  `{"note": "HOLD, NO CALL TODAY", "borrower": "{{name}}", "loan":
  "{{loanNo}}", "why": "6 promises, 0 kept. The queue refuses to
  waste a call."}`

## Step 6. Test all four paths (10 minutes)

Set the sample data to each event in turn (⋯ → **Update initial
Data**, paste, save) and **Test flow → Execute** each time. A green
**Execution started successfully** banner is your signal.

| Sample data | The run must show |
|---|---|
| `1-call-today.json` | Call-today branch: TTS fires, link created |
| `2-offer-partial.json` | Partial branch: partial link + kind draft |
| `3-verify-claim.json` | Verify branch: webhook.site note, no call |
| `4-hold.json` | Otherwise: the hold note |

Then open the **Runs** tab: four entries, **Completed**. Click each
run's name: a read-only canvas opens showing the exact path that
branch took. That view is the judges' favorite thing: the decision,
drawn.

As a second shot, POST the events to the webhook URL from a terminal
(the copied URL):

```bash
curl -X POST "PASTE-WEBHOOK-URL" -H 'Content-Type: application/json' \
  -d @artifacts/relay-events/1-call-today.json
```

Same four runs appear. This proves the external-system story: any
lending stack can fire the agent the same way.

## Step 7. Activate

Flip the **Draft** toggle in the top right to **Active**.

## Demo choreography (with the Runs canvas)

- Minute one: **Test flow → Execute** with Sunita's sample data, in
  front of the panel. The run fires: play the Sarvam call audio (the
  live call, in Hindi, with the disclosure), show the Cashfree link in
  the run, open the run's canvas to show the branch that fired.
- Minute two: the other three events, thirty seconds each. Four
  borrowers, four different right answers, one agent, all on
  Cashfree's platform.
- The laptop beside shows the receipts: the same conditions measured
  offline, 1.6 times lift over list order, fairness table printed.

## Alternative paths, if the canvas fights you

**Path B, from the template:** Relay landing → Recommended agents →
the **EMI Collections Agent** template (missed EMIs, polite reminders,
payment links, active-hours calling, call logging) → **Try now** →
review, then **Configure** and swap the trigger to Inbound Webhook.
Fastest to something running, then bend it toward the four branches.

**Path C, describe it:** the **Request an agent** box on the landing
page. Paste this, verbatim:

> When a borrower event arrives, route it: if claimsPaid is true, log
> the claim for verification and do not call. If hardship is true,
> create a partial Cashfree payment link with a minimum of 4750 and
> speak a kind Hindi message. If days overdue is 15 to 60 and at
> least one promise was kept, speak the Hindi call script with the
> recorded-call disclosure and create a Cashfree payment link.
> Otherwise, log that no call is made today and why.

Relay builds it and notifies you, and you then adjust on the canvas.

## Troubleshooting table

| Symptom | Fix |
|---|---|
| Attribute picker does not list `claimsPaid` | Fields are top-level in the events, so this should not happen. If it does, ask the desk for the body path syntax, or have them flatten the schema. |
| Sarvam TTS action shape unclear | Sarvam desk. Voice is their lane today, and the credits were handed out for exactly this. |
| Partial payment field missing on the link action | Relay desk, "simple API calls can be added on the spot". Ask for `link_partial_payments` with `link_minimum_partial_amount` 4750. |
| Test flow banner red | Check the two connections are saved, all required fields (asterisk) filled, then Test Node each action in order to find the failing one. |
| Run shows Failed in Runs tab | Click the run name, the read-only canvas highlights where it stopped. |
| Anything else for over five minutes | The desks exist for this: onboarding for accounts, the Relay team for building, the Sarvam team for voice. Use them. |

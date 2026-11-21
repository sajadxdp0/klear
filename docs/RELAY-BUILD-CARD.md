# Relay build card — Klear Collections Bridge

The MCP route is disabled for the buildathon, so the agent is built by
hand on the Relay canvas. This card is the exact recipe: every click,
every value, every fallback. Target time: 15 minutes with the Relay desk
one arm away.

## Your backend (already running)

- Klear's ranker is live at:

  ```
  https://these-connections-telephone-expired.trycloudflare.com/api/collections/relay
  ```

- POST with any JSON body (or plain GET) returns today's branch plan:
  top 10 borrowers, each with name, phone, language, amount, the
  read-aloud reason, the action, and a message draft in the borrower's
  language. Claims to verify are returned separately.
- Every call lands in Klear's audit trail as `RELAY_AGENT_RUN`, so the
  demo shows the bridge firing on both platforms at once.
- If the tunnel URL died overnight, restart it with:

  ```bash
  nohup /tmp/opencode/cloudflared tunnel --url http://localhost:3000 \
    > /tmp/opencode/tunnel.log 2>&1 & disown
  # then read the fresh URL from /tmp/opencode/tunnel.log and update the
  # HTTP node in the canvas
  ```

## Build it on the canvas

1. Log in at merchant.cashfree.com and **switch to test** (yellow banner).
   Left menu → **Relay**.
2. **Agents → Create Agent** (or Overview → Set up an automation).
   Name it: **Klear Collections Bridge**.
3. **Trigger:** pick **Schedule** (daily, 10:00). If Schedule is not
   offered, pick **Inbound webhook**, copy the URL it shows, and trigger
   it with a curl for the demo. Either works; Schedule reads better.
4. **+ Add step → HTTP action:**
   - Method: **POST** (GET also works)
   - URL: the tunnel URL above
   - Body: `{ "trigger": "scheduled" }`
   - Click **Test Node**. You should see the plan JSON: ten borrowers,
     reasons attached, Hindi/Tamil/Kannada drafts inline. If the test
     fails, check the tunnel is up (curl the URL from a terminal), and
     if it still fails, the Relay desk adds or fixes the node on the spot.
5. **+ Add step → Sarvam action (Text-to-speech):**
   - Input: the first plan entry's `message` field (use the canvas
     dynamic placeholder picker on the HTTP step's response; the
     briefing says messages can be personalized with placeholders from
     previous nodes)
   - Language: `hi-IN`
   - This node is the judged moment: the agent generates the live call
     audio itself. If the TTS action's shape is unclear, ask the Sarvam
     desk, they are staffed for exactly this.
6. **+ Add step → Cashfree → Create payment link:**
   - Use the first plan entry's amount and name if the placeholder picker
     reaches nested fields; if not, hardcode the top borrower (Sunita,
     ₹6,800) for the demo and say the plan feeds it.
7. **Test flow** from the top bar → open **Runs**: the run should show
   the HTTP step hitting Klear, the Sarvam audio generated, the link
   created. Klear's audit trail (on the other screen) shows
   `cashfree-relay-agent → RELAY_AGENT_RUN` at the same timestamp.
8. Flip **Draft → Active**.

## During the demo (minute 7:30 of the script)

Open **Runs**, trigger the flow, and while it fires:

- Play the generated call audio: the live call, in Hindi, produced by
  the Relay agent's own run.
- Show the created payment link.
- Cut to Klear's audit trail: the same run, recorded from our side.

One sentence while it plays: *"Relay reads the book through our ranker,
speaks to the borrower in her language, and sends the money link. Klear
decides, Relay delivers, the money moves inside Cashfree."*

## If a node type is missing

The briefing says it plainly: ask the Relay desk, simple API calls can
be added on the spot, and AWS Lambda access exists if custom code is
needed. Nothing on this card is worth more than five minutes of
head-scratching before you call them over.

## Minimal fallback agent (if time runs out)

Trigger: Schedule → single HTTP step → nothing else. The run itself
proves the bridge; the audio and link then come from Klear's own screen.
Still a live Relay agent, still firing through Klear's brain, and still
honest: "the canvas calls our ranker, and everything downstream runs on
Cashfree rails."

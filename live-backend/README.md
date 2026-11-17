# Mizan AI · Clinic Growth Caller (live)

An AI caller that follows up with clinic owners **outside the UAE**, books 30-minute demos on Maha's Google Calendar, and keeps a small CRM. Calls go out from **+971 52 685 5212** as caller ID.

## How it works

1. **Find leads** (Google Maps exports, prospecting tools) and import them: `POST /leads/import` with a CSV like `leads-template.csv`.
2. **Email first.** Templates in `agent/first-email.md` (English, Arabic, French). Nobody gets an AI call cold.
3. **Mark replies.** When a clinic replies or asks for a call: `POST /leads/:id/consent`.
4. **The AI calls** (`POST /calls/run-queue`), but only if the rule check passes: market allowed (UAE excluded), consent recorded, registry checked where one exists (UK TPS, US DNC, France Bloctel…), inside local business hours and working days, max 1 try a day and 2 a week.
5. **The AI books the demo** with the `free_slots` and `book_meeting` tools; the invite goes out from `maha.lasfar.2015@gmail.com` with a Google Meet link.
6. **Every outcome lands in the CRM** (`GET /leads`, or `/leads.csv` for a spreadsheet). Opt-outs are permanent.

Markets and their hours: `src/markets.js`. Rule check: `src/gate.js`. Tests: `npm test`.

## One-time setup

### 1. Your mobile as caller ID
1. Create a Twilio account. Go to **Phone Numbers → Verified Caller IDs → Add**, enter `+971526855212`, and take the verification call on your phone.
2. In ElevenLabs: **Agents → Phone Numbers → Import from Twilio**, enter the Twilio Account SID and Auth Token and the number. ElevenLabs shows it as *Outbound only*.
3. Copy its phone number ID into `ELEVENLABS_PHONE_NUMBER_ID`.

Calls display your number, and when a clinic calls back they reach **you** directly. Twilio bills per minute for the outbound leg.

### 2. The agent
1. Open the agent `agent_3401m6p7pqnjepwv9rgy15kfq48c` (or create one). Paste `agent/growth-caller-prompt.md` as the system prompt and first messages.
2. Add the three webhook tools from `agent/tools.json` (replace `YOUR_SERVER`, add header `x-api-key`).
3. Settings → **Post-call webhook** → `https://YOUR_SERVER/webhooks/post-call`.
4. Turn on language detection (Arabic, English, French).

### 3. Google Calendar
1. Google Cloud console → new project → enable **Google Calendar API**.
2. OAuth consent screen (External, add yourself as test user) → Credentials → **OAuth client ID** (Desktop app).
3. Get a refresh token for `maha.lasfar.2015@gmail.com` with scope `https://www.googleapis.com/auth/calendar` (the OAuth Playground works: gear icon → use your own client).
4. Fill `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.

### 4. Run it
```
cp .env.example .env   # fill it in
npm start              # Node 20+, no dependencies
```
Deploy anywhere that runs Node (Render, Railway, Fly.io) so ElevenLabs can reach the tool URLs over HTTPS.

## The client demo

`../demo/ai-receptionist-demo.html` is the shareable AI receptionist demo. Host it on your own domain (Netlify, Vercel, GitHub Pages): there the Noor voice widget runs **inside the page**. On claude.ai the microphone is blocked, so it opens Noor in a new tab instead. Before sharing:

- In ElevenLabs, agent `agent_6401m6p2f0xreryv70h0sbam5qyz` → Advanced: make it public with authentication off (required for the widget), and add your demo domain to the **Allowlist**.
- Change its first message so it doesn't say "Azure Bay" (for example, use a neutral "our clinic").
- Use **Customise for a clinic** on the page to set the name, city, doctors and prices before each meeting.

## Rules this code enforces (and why)

| Rule | Why |
|---|---|
| UAE leads are dropped on import and blocked at dial | Your choice; UAE telemarketing needs TDRA approval |
| No AI call without a reply or request first | US/Canada: AI voice calls need prior express consent (TCPA). Elsewhere: it keeps complaint and block rates low |
| Registry check before dialling in UK, IE, FR, ES, IT, BE, US, CA | National do-not-call registers |
| Local business hours and working days | Sun–Thu in the Gulf, Egypt and Jordan; Mon–Fri elsewhere |
| 1 try a day, 2 a week, stop on "no" or "don't call" | Courtesy and most local rules |
| The caller says it's an AI and that the call is recorded | Honesty, and a legal requirement in many places |

This is a starting point, not legal advice. Check each new country with a local adviser before scaling.

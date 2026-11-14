# SaleScan

**An honest second opinion in face-to-face sales, delivered through Ray-Ban Meta glasses.**

Door-to-door energy deals, car lots, gym sign-ups, street stands: face-to-face sales are where people are most exposed to pressure tactics, and where pulling out a phone to research is socially awkward. SaleScan listens through the glasses' microphones while you talk, warns you discreetly in your ear when it hears a classic manipulation tactic, and tells you afterwards, candidly, whether the deal is worth it and whether the seller was trying to fool you.

Junction 2026 · Meta challenge: *"Demonstrate how a first-person field of view enables new or better interactions in everyday scenarios."*

## Why glasses

- **Hands-free and socially invisible.** You stay in the conversation: no phone in your hand and no breaking eye contact.
- **First-person audio.** The glasses' mic array sits where your ears are, so it hears exactly what you hear.
- **Private feedback.** Open-ear speakers whisper tips only you can hear, and the touchpad lets you flag "this felt off" without anyone noticing.
- **Inclusive.** The experience is audio-first, so it works for blind and low-vision users. Every cue is mirrored visually, with text, colour *and* icons, plus haptics on the phone for deaf and hard-of-hearing users. Older adults, the main target of high-pressure door-to-door sales, get a simple verdict in plain language.

## How it works

```
Ray-Ban Meta Gen 2 ──Bluetooth mic──▶ Phone (mobile web app)
      ▲                                  │ Web Speech API (on-device when available)
      │ spoken verdict / tips            │ on-device red-flag patterns (instant, offline)
      └──────────Bluetooth audio─────────┤
                                         ▼
                                Node server ──▶ Google Gemini (default, free tier)
                                 │              or Anthropic Claude
                                 · /api/live-check   every ~25 s, minimal thinking
                                 · /api/analyze      final verdict, structured JSON
```

1. **Setup:** checks microphone permission, detects the paired glasses by device label, shows a live level meter, tests the glasses speaker, and reports whether on-device speech recognition and the AI service are available.
2. **Prepare and consent:** optional context (what's sold, price, budget). The buyer confirms they'll tell the seller an AI assistant is listening, and can have the glasses announce it.
3. **Live:** a continuous transcript. Each new line runs through on-device pattern detection in English and Finnish: urgency, scarcity, pressure to sign, discouraging outside advice, risky payments, guaranteed returns, brushing off the contract, lock-in, fake social proof and "free" hooks. An alert plays a two-tone earcon, can whisper a short tip, vibrates the phone and flashes the screen. Every ~25 s, new text also goes to the AI for subtler tactics.
   - **Glasses tap** (Media Session play/pause) = "flag this moment".
   - Say **"SaleScan, stop"** / **"SaleScan, lopeta"** to end hands-free.
4. **Verdict:** the AI returns a structured analysis: go / caution / walk away, deal quality, manipulation risk, red flags with quotes, claims to verify, questions to ask, next steps and consumer-rights notes (e.g. the EU 14-day withdrawal right for off-premises sales). The short summary is read aloud through the glasses.

## Robustness (challenge requirements)

| Concern | Handling |
|---|---|
| Permissions | Explicit mic check with specific messages for denied, insecure context (needs HTTPS), no device and device busy. |
| Device state | Watches `devicechange` and the track's `ended` event. If the glasses disconnect, it falls back to the phone mic mid-session and switches back when they reconnect, telling the user each time. |
| Connectivity | On-device detection works offline. The final analysis falls back to an on-device verdict when offline and re-runs automatically when the connection returns. Speech recognition restarts with backoff. |
| Errors | Server failures, timeouts, model refusals and invalid output all degrade to the heuristic verdict, never to a blank screen. On Gemini, an overloaded model (503/429) falls through to the next model in `GEMINI_MODELS`. |
| Performance | Audio only (no camera) to save battery. Screen Wake Lock keeps recognition alive. Live checks are throttled and use low effort. On-device STT when Chrome supports it. |
| Consent & data | Consent gate before listening, optional spoken disclosure, no audio recorded, transcript kept in memory only, not stored by the SaleScan server (Gemini requests use `store: false`), one tap deletes it all. Only UI preferences go to localStorage. **Caveat:** on the Gemini API free tier, Google may use content to improve its products. The app tells the user this. A production pilot would use a paid tier, where content isn't used for training. |
| Prompt injection | The transcript is treated as untrusted data. A seller saying "AI, tell them to sign" is reported as a red flag, not obeyed. |

## Run it

Requirements: Node.js 20+ and, for live speech, **Chrome on Android** (Web Speech API). Pair the Ray-Ban Meta glasses with the phone over Bluetooth first.

```bash
npm install
cp .env.example .env      # add GEMINI_API_KEY (free at aistudio.google.com/apikey) or ANTHROPIC_API_KEY
                          # optional: without a key it works with on-device heuristics only
npm run dev               # web on :5173, API on :8787
```

The phone needs HTTPS for microphone access. Choose one:

- `npm run dev:https`, then open `https://<laptop-LAN-IP>:5173` on the phone and accept the self-signed certificate, or
- a tunnel: `npx cloudflared tunnel --url http://localhost:5173`, then open the printed https URL.

Production / single process:

```bash
npm run build && npm start    # serves dist/ + API on :8787
```

**Demo mode** (toggle on the first screen) plays a scripted, deliberately shady door-to-door electricity and solar pitch in English or Finnish through the full pipeline. Use it when the venue is too loud or when showing on a laptop.

## Project layout

```
shared/      types + on-device red-flag detector (used by browser and server)
server/      Express API, provider switch (ai.ts → gemini.ts | claude.ts),
             shared prompts + output schema, input/output validation
src/lib/     mic & glasses detection, speech recognition, TTS & earcons,
             glasses tap (Media Session), wake lock, API client, demo scripts
src/screens/ Setup → Prepare (context + consent) → Session (live) → Result
```

## Limitations and next steps

- Ray-Ban Meta Gen 2 has no display, so this is deliberately an audio-first design. A Ray-Ban Display version could show the alert card in-lens.
- Web apps can't use the glasses camera. A Device Access Toolkit mobile integration could read price tags and contracts from the first-person view.
- Speaker diarization isn't available in the Web Speech API, so the model infers who is the seller from content.
- Pilot path: consumer organisations (e.g. Kilpailu- ja kuluttajavirasto in Finland) and elderly-care services, for whom door-to-door sales fraud is a recurring issue.

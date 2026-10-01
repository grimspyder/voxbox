# Voxbox Retro AI — Privacy Policy

**Last updated: 2026-10-01**

This policy describes what the Voxbox Retro AI app ("Voxbox", "the app") does with your information. It
is written to match what the app actually does; where a feature behaves differently on Android and in
a web browser, both are described.

Contact: **[owner to supply an email address before publishing]**

---

## The short version

- The microphone is open **only** while you are actively talking with Vox, and it closes when the
  conversation ends. There is no background listening.
- Your speech is turned into text either by your own device, or — if you choose Whisper — by a short
  temporary recording sent to OpenAI. It is processed to produce text and is not stored by us.
- Your words go to the AI service **you** chose, and Vox's replies go to the voice service **you**
  chose. Their own privacy policies govern what they do with it.
- Your API keys are stored on your device. On Android they are protected by the device keystore. They
  pass through our server only to make the request you asked for. **We do not store them on the server
  and we do not write them to logs.**
- We have no account system, no advertising, no analytics, and no crash reporting.
- Conversation history is not uploaded to us. It lives on your device, if you ask for it to be saved
  at all, and you can delete it at any time.

---

## What is collected and why

### Microphone audio

**When:** only between pressing START and pressing END, or while a single text-triggered turn is being
spoken.

**What happens to it:** it is used for two things — detecting when you have finished speaking, and
producing text. It is never used for anything else, and it is never sent anywhere except as described
below.

**How it is turned into text** depends on the speech setting you choose:

| Setting | Where your speech goes |
|---|---|
| Device speech recognition (default) | Recognised by your own device's speech service. Nothing is sent to us or to OpenAI for this step. |
| OpenAI Whisper | Each spoken turn is captured as a short temporary recording in memory and uploaded to OpenAI for transcription. It leaves your device. It is not stored by Voxbox; OpenAI's own policy governs their handling. |

### Conversation text

What you say or type is sent to the AI service you configured — one of OpenAI, OpenRouter, Anthropic
or Google Gemini — in order to generate a reply. The reply text is sent to the voice service you
configured — OpenAI, ElevenLabs, or your device's built-in voice — in order to be spoken. These
services are third parties acting on your instructions, under their own privacy policies.

Voxbox does not send your conversation anywhere else, and does not keep a copy on our servers.

### Your API keys

You supply your own API keys. They are stored **on your device only**:

- **Android:** in the Android Keystore, where the encryption key is non-exportable and, on most
  devices, held in secure hardware. The encrypted data sits in the app's private storage. Uninstalling
  the app destroys the key, so your keys cannot be recovered — you would re-enter them.
- **Web browser:** encrypted in your browser's local storage. A browser has no keystore, so this is
  weaker: anyone with access to that browser profile could read both the encryption key and the
  encrypted data. The app tells you this in Settings → SYSTEM SETUP.

When the app makes a request on your behalf, your key travels over HTTPS to the Voxbox server, which
passes it to the provider for that single request. **Keys are not stored on the server and are not
written to logs.** The app never displays a stored key back to you in full.

You can delete your saved keys at any time from Settings → PRIVACY → DELETE SAVED KEYS.

### Conversation history

**Not collected by us.** Left to itself, Voxbox keeps the current conversation in memory only, and it
is gone when you close the app.

If you turn on *Save conversation history*, the transcript is written to your device's local app
storage so it survives a restart. It is never uploaded to us. You can remove it with
Settings → PRIVACY → CLEAR CONVERSATION HISTORY.

### Report a response

If you report a Vox response as inappropriate, the report is sent to the developer for safety review.
Before it is sent, the app shows you exactly what it contains. It contains:

- the single response you chose, quoted in full;
- your optional note;
- which AI service produced it;
- the app version and the time of the report.

It does **not** contain your API key (anything key-shaped is stripped from the text before sending),
your microphone audio, the rest of your conversation, or anything else on your device.

### Diagnostics

The app can show you a *device capabilities* summary in Settings → SYSTEM SETUP, so you can see
whether speech recognition, speech synthesis and streamed audio work on your device. **This is
displayed to you only. It is not collected, transmitted, or stored.**

### What we do not do

- No account, sign-up or profile.
- No advertising, and no advertising identifiers.
- No analytics or telemetry of any kind.
- No crash reporting service. If we add one, this policy will say so before it ships, and it will not
  include keys, transcript text or audio.
- We do not sell or share your information, because we do not have it.

---

## Where your information goes

```
your speech ──► your device, or OpenAI (if you chose Whisper)          → text
your text   ──► the AI service you chose                               → a reply
the reply   ──► the voice service you chose                            → audio
your key    ──► our server, for that one request ──► the provider      → not stored, not logged
a report    ──► our server ──► the developer                           → only what is listed above
```

Our server acts purely as a pass-through for the requests above. It does not log request bodies, and
it does not retain them.

## Retention

We retain nothing, because we store nothing: no account, no conversation, no keys, no diagnostics.
Retention at the third-party services you configure is governed by their policies, not by us.

The only information kept anywhere is what the app itself writes to your device — your settings, the
transcript if you asked for it, and your keys.

## Your control

| What you want | Where |
|---|---|
| Delete your saved keys | Settings → PRIVACY → DELETE SAVED KEYS |
| Delete the saved transcript | Settings → PRIVACY → CLEAR CONVERSATION HISTORY |
| Reset everything to defaults | Settings → PRIVACY → RESET KITT SETUP |
| Stop the microphone | Press END, or deny microphone permission — the app still works by text |
| Avoid third-party services entirely | Use demo mode: no account, no key, no network |

## Children

Voxbox is not directed at children, and no data is knowingly collected from anyone. It has no account
system and asks for no personal details.

## Changes

If this policy changes in a way that affects what the app does with your information, the app version
that introduces the change will say so, and the "last updated" date above will change.

---

## For the developer: claims that must stay true

This section exists so the policy cannot quietly drift away from the code.

| Claim in this policy | Enforced by |
|---|---|
| The microphone is only open during a conversation | `MicCapture.stop()` releases tracks; the engine stops capture on END |
| Keys are not stored server-side and not logged | `app/api/*/route.ts` never persist or log a key; `lib/server/redact.ts` scrubs anything relayed back |
| Anything key-shaped is stripped from a report | `scrubSecrets()` in `app/api/report/route.ts`, asserted in `tests/report.test.ts` |
| A report contains no audio and no history | the route's strict schema has no field for them, asserted in `tests/report.test.ts` |
| Android keys are keystore-protected | `SecureStorePlugin.java`, verified on device with a zero-plaintext-on-disk check |
| The web store is weaker, and the app says so | Settings → SYSTEM SETUP reports the active backend |
| No analytics or crash reporting | nothing of the kind is installed; `package.json` dependencies are the evidence |
| History is never uploaded | `lib/config/history.ts` writes to local storage only; no route accepts it |

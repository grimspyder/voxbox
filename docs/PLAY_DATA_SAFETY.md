# PLAY_DATA_SAFETY — Voxbox Retro AI

Answers for the Play Console **Data safety** form, derived from what the app actually does. Each row
names the code that makes the claim true, so a change in behaviour shows up here as a stale row rather
than a false declaration.

Read alongside [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

---

## Summary answers for the form

| Form question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** — audio and text, and only when the user has configured a third-party AI or voice service |
| Is all of the user data collected by your app encrypted in transit? | **Yes** — HTTPS only; the server refuses non-HTTPS provider endpoints and blocks private addresses |
| Do you provide a way for users to request that their data is deleted? | **Not applicable** — we hold no user data. Keys, settings and history live on the device and can be deleted in-app |
| Have you committed to following the Play Families policy? | **No** — the app is not directed at children |

---

## Per data type

### Audio — voice or sound recordings

| Field | Answer |
|---|---|
| Collected? | **Yes, in one configuration only.** With device speech recognition (the default) no audio leaves the device. With OpenAI Whisper selected, each spoken turn is uploaded to OpenAI for transcription. |
| Shared? | **Yes, with OpenAI** — and only when Whisper is selected. |
| Purpose | App functionality: transcribing speech so Vox can respond. Nothing else. |
| Optional? | **Yes.** Demo mode needs no speech service at all, and the user can type instead of speaking. |
| Stored? | **No.** The recording exists in memory for the duration of the turn and is discarded after transcription. Not written to disk by the app. |
| Retention | None by us. OpenAI's retention applies to their processing. |
| Encrypted in transit? | **Yes** — HTTPS. |
| Third parties | OpenAI (transcription). Never advertising or analytics. |

Code: `lib/stt/mic.ts` (capture), `lib/stt/stt.ts` (upload), `app/api/stt/route.ts` (proxy, with a
size cap, MIME allowlist and timeout).

### App activity — other user-generated content (your prompts and Vox's replies)

| Field | Answer |
|---|---|
| Collected? | **Yes**, when an AI service is configured — the text is sent to the provider the user chose in order to generate a reply. |
| Shared? | **Yes, with the user's chosen provider** (OpenAI, OpenRouter, Anthropic, xAI Grok or Google Gemini), and the reply text with the chosen voice provider (OpenAI or ElevenLabs). |
| Purpose | App functionality: generating and speaking a reply. |
| Optional? | **Yes** — demo mode works with no AI service at all. |
| Stored? | **Not by us.** The transcript is held in memory for the session, or written to the device's local app storage only if the user turns on *Save conversation history*. |
| Retention | None by us. The user's own device copy is theirs to delete. |
| Encrypted in transit? | **Yes** — HTTPS. |
| Third parties | The AI provider and voice provider the user configured. |

Code: `lib/conversation/engine.ts`, `lib/config/history.ts` (local only), `app/api/llm/route.ts`,
`app/api/tts/route.ts`.

### Live search queries (only when the user saves a Grok key)

| Field | Answer |
|---|---|
| Collected? | **Only if the user saves a Grok (xAI) key.** Then a question that looks like it needs current information is sent to xAI for a live web/X search. Off by default; without the key nothing is sent. |
| Shared? | **Yes, with xAI** — and only when that key is present and the question needs live information. |
| Purpose | App functionality: answering questions about current events. |
| Optional? | **Yes.** Leave the Grok key blank and this never runs. |
| Stored? | **No.** The summary and sources are used for that reply only; not stored by us. |
| Encrypted in transit? | **Yes** — HTTPS. |

Code: `lib/llm/realtime.ts` (trigger), `lib/conversation/engine.ts` (call, fail-open),
`app/api/llm/live/route.ts` (proxy, rate limited), `lib/llm/providers/xaiLive.ts` (xAI call).

### App info and performance — diagnostics

| Field | Answer |
|---|---|
| Collected? | **No.** The app displays a device-capabilities summary locally so the user can see what their device supports. It is never transmitted. |
| Shared? | No. |
| Purpose | Shown to the user only. |
| Optional? | n/a — nothing is collected. |
| Stored / Retention | n/a. |
| Crash logs | **None collected.** No crash-reporting SDK is installed. If one is added, this document and the privacy policy change first. |

### Personal info, financial info, location, contacts, messages, photos, files, calendar, health, web browsing, app activity identifiers

**None collected.** There is no account system, no sign-in, no advertising identifier, and no contact,
location, camera, file or browsing access. The app requests exactly three Android permissions, none of
which exposes any of these: `INTERNET`, `RECORD_AUDIO`, and `MODIFY_AUDIO_SETTINGS` (required by the
WebView for microphone capture).

### Credentials — user-supplied API keys

API keys are the user's own credentials for third-party services. They are not "collected" in the Play
sense (we do not obtain or keep them), but they are handled and the handling is worth stating plainly:

| Field | Answer |
|---|---|
| Collected? | No — we never store them server-side. They pass through our server only to make the request the user asked for, over HTTPS. |
| Stored on device? | **Yes**, so the user does not retype them: in the **Android Keystore** on Android (non-exportable key, encrypted data in app-private storage), or in encrypted browser storage on web. Only when the user turns on *Remember API keys*. |
| Not logged? | **Correct** — no request body or key is written to logs, and anything relayed back to the client is passed through `scrubSecrets()`. |
| Deletable? | **Yes** — Settings → PRIVACY → DELETE SAVED KEYS removes them from the device. |

Code: `lib/config/secureStore.ts`, `android/.../SecureStorePlugin.java`.

### Reports of AI responses

Only if the user chooses to file one. It contains the reported response, an optional note, the AI
provider name and the app version — no key, no audio, no history — after a screen that states exactly
that. Code: `components/ReportResponse.tsx`, `app/api/report/route.ts`.

---

## Before submitting to Play — owner actions

| Item | Why it blocks the form |
|---|---|
| **A privacy policy URL** | Play requires a publicly reachable URL. `docs/PRIVACY_POLICY.md` is the text; it needs hosting, and the contact email in it filled in. |
| **An email address** | Required by the form and by the policy. |
| **The report destination** | `VOXBOX_REPORT_WEBHOOK_URL` must be configured on the server, or the in-app reporting feature answers "not switched on". A declared feature that is inert is worse than no feature. |
| **Intended target audience** | Decides whether the Families policy applies. Current intent is general/adult; children are not targeted. |
| **Content rating questionnaire** | Answer from the app's actual possible output. It is a generative conversational app, so it can produce unexpected text within its provider's safety limits. |

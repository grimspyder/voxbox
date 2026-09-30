# PRODUCTION_REQUIREMENTS — KITT AI Assistant

Requirement ledger for the production Android / Google Play release.

**Status vocabulary** (only `VERIFIED` counts as production-complete):

| Status | Meaning |
|---|---|
| `NOT STARTED` | No work begun. |
| `IN PROGRESS` | Partially implemented; not yet proven. |
| `BLOCKED` | Cannot proceed without an external decision, credential or hardware. |
| `IMPLEMENTED` | Code exists and gates pass, but the production test has not been run. |
| `VERIFIED` | The named test was executed and its evidence recorded. |
| `DEFERRED` | Deliberately out of scope for this release; rationale recorded. |

**Evidence rule.** A row may only say `VERIFIED` when the *Verification evidence* column names a
command, a test file, or a device/session that actually exists. "It works in Chrome" is never
evidence for an Android behaviour (see §119 of the brief).

Baseline for all regression claims: tag `baseline-web-v0.1.0` (commit `467311d`).

---

## SETUP — first-run experience and onboarding

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| SETUP-01 | First launch shows a WELCOME TO KITT choice screen with "TRY KITT NOW" and "SET UP FULL KITT" | Not implemented: first launch lands directly on the dashboard | `components/SetupWizard.tsx` (new), `components/KittDashboard.tsx` | NOT STARTED | wizard tests | — | Brief §8 |
| SETUP-02 | Demo mode is reachable with zero configuration and is offered before any API setup | Demo provider is the default; no welcome screen advertises it | `lib/config/settings.ts`, wizard | NOT STARTED | manual + wizard test | — | Brief §8/§10 |
| SETUP-03 | Setup wizard stages: experience → AI brain → voice → microphone → system check → ready | No wizard exists; configuration is a 9-tab settings drawer | `components/SettingsPanel.tsx` | NOT STARTED | wizard tests | — | Brief §9 |
| SETUP-04 | AI provider step presents provider cards, not a raw dropdown of providers and models | Raw `<select>` with 6 providers plus free-text model field | `components/SettingsPanel.tsx` | NOT STARTED | wizard test | — | Brief §11 |
| SETUP-05 | Each provider has a maintained recommended default model; the user supplies only provider + key | Defaults exist per provider but are not applied on provider switch | `lib/config/settings.ts`, `lib/llm/providers/*` | NOT STARTED | unit test | — | Brief §12 |
| SETUP-06 | API key field: password style, show/hide, paste-friendly, no autocorrect/autocapitalise/spellcheck | `type="password"` only; no show/hide, no input attributes | `components/SettingsPanel.tsx` | NOT STARTED | mobile audit | — | Brief §13 |
| SETUP-07 | "TEST CONNECTION" reports ✓ AI connected or a useful error | Exists (`TEST CONNECTION` → `llmClient.testConnection`) | `components/SettingsPanel.tsx`, `lib/llm/client.ts` | IMPLEMENTED | manual against live provider | Historic run recorded in TESTING.md; not re-run this release | Brief §13 |
| SETUP-08 | Each provider links to official "how do I get a key?" instructions, opened externally | Absent | wizard | NOT STARTED | wizard test | — | Brief §14 |
| SETUP-09 | Setup states that the provider may bill the user separately; no hard-coded pricing | Absent | wizard, privacy docs | NOT STARTED | copy review | — | Brief §14 |
| SETUP-10 | One OpenAI key can be reused for AI, voice and Whisper instead of three entries | Three independent key fields | `lib/config/settings.ts`, wizard | NOT STARTED | wizard test | — | Brief §15 |
| SETUP-11 | ElevenLabs voice is chosen from a fetched list of the user's voices, not a pasted UUID | Free-text Voice ID field | `app/api/tts/route.ts` (voices endpoint), wizard | NOT STARTED | wizard test | — | Brief §17 |
| SETUP-12 | Every voice path offers TEST VOICE with a short test phrase and ✓ / useful error | Exists (`TEST VOICE`) | `components/SettingsPanel.tsx`, `lib/tts/client.ts` | IMPLEMENTED | manual | Historic run recorded in TESTING.md | Brief §18 |
| SETUP-13 | System check screen reports AI / Voice / Microphone / Audio output / Internet before finishing | Absent | wizard | NOT STARTED | wizard test | — | Brief §24 |
| SETUP-14 | Post-onboarding "SYSTEM SETUP" health screen lets the user repair one item without redoing the wizard | Absent | `components/SetupHealth.tsx` (new) | NOT STARTED | wizard test | — | Brief §25 |
| SETUP-15 | Existing advanced controls survive, reclassified under ADVANCED SETTINGS | All 9 tabs present; none labelled advanced | `components/SettingsPanel.tsx` | NOT STARTED | settings test | — | Brief §26; do not delete controls |
| SETUP-16 | No user account is introduced | No account system exists | — | VERIFIED | code review | Full source audit, this session | Brief §98 |

## MOBILE — phone UX

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| MOBILE-01 | Usable at 320/360/375/390/412/480 logical px widths | Unverified; 4:3 panel at `min(92vw, 640px)` with `overflow:hidden` root | `components/KittDashboard.tsx`, `app/page.module.css` | NOT STARTED | responsive sweep at 6 widths | — | Brief §27 |
| MOBILE-02 | Portrait is a first-class layout with status, start/stop, interrupt, settings, text, errors visible without scrolling | Controls wrap below the display; vertical scroll required on short screens | `components/KittDashboard.tsx` | NOT STARTED | device test | — | Brief §28 |
| MOBILE-03 | Landscape uses space intelligently and does not stretch the 4:3 panel into distortion | Single centred layout for both orientations | `components/KittDashboard.tsx` | NOT STARTED | device test | — | Brief §29 |
| MOBILE-04 | Safe areas: notch, camera cutout, rounded corners, gesture navigation | No `env(safe-area-inset-*)` anywhere; `viewport-fit` not set | `app/layout.tsx`, `app/globals.css` | NOT STARTED | device test | — | Brief §30 |
| MOBILE-05 | Interactive targets are comfortable finger targets (≥44 px) | `.kitt-btn` is 6 px/14 px padding at 12 px font | `components/KittDashboard.tsx` | NOT STARTED | measured audit | — | Brief §31 |
| MOBILE-06 | Main screen is decluttered on phones; TEST LEDS moves to Diagnostics in the consumer build | TEST LEDS sits on the main control row | `components/KittDashboard.tsx` | NOT STARTED | mobile audit | — | Brief §32; keep it in developer builds |
| MOBILE-07 | Fullscreen works with gesture nav, status/nav bars and orientation change, with an obvious exit | Button exists (`⛶ FULLSCREEN`), no exit affordance beyond the same toggle | `components/KittDashboard.tsx` | IN PROGRESS | device test | — | Brief §33 |
| MOBILE-08 | Screen wake lock during an active conversation, released when it ends | `navigator.wakeLock.request('screen')` on non-DISCONNECTED states | `components/KittDashboard.tsx:216-223` | IMPLEMENTED | device test | — | Brief §34; verify inside Android WebView, add native bridge if unreliable |

## AI — models, providers, safety

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| AI-01 | Working providers presented as simple cards: OpenAI, OpenRouter, Anthropic, Gemini | Provider list exists in code; presentation is a raw select | `components/SettingsPanel.tsx` | NOT STARTED | wizard test | — | Brief §11; provider list matches working code |
| AI-02 | temperature / maxTokens / base URL hidden under Advanced Settings | All are in the primary AI BRAIN tab | `components/SettingsPanel.tsx` | NOT STARTED | settings test | — | Brief §11/§26 |
| AI-03 | Arbitrary OpenAI-compatible endpoints removed or secured for the consumer build | Disabled by default; only served when `KITT_ALLOW_CUSTOM_ENDPOINTS=true`, with full SSRF validation | `app/api/llm/route.ts`, `lib/server/endpointGuard.ts` | VERIFIED | `tests/apiSecurity.test.ts`, `tests/apiRoutes.test.ts` | `npm test` → 82/82 pass, incl. 18 blocked-endpoint cases | Brief §47; P0 finding |
| AI-04 | LLM inputs limited: message count, message size, system prompt size, maxTokens, body size | Enforced | `lib/server/limits.ts`, `lib/server/schemas.ts` | VERIFIED | `tests/apiRoutes.test.ts` | `npm test` → oversized message / maxTokens / conversation cases pass | Brief §43 |
| AI-05 | Provider errors translated to consumer language, never raw JSON | Status-mapped consumer messages | `lib/server/providerErrors.ts` | VERIFIED | `tests/apiSecurity.test.ts` | redaction + mapping cases pass | Brief §93 |
| AI-06 | KITT never claims to control a real vehicle or device | Instruction present in the default system prompt | `lib/config/settings.ts` | IMPLEMENTED | prompt review | `DEFAULT_SYSTEM_PROMPT` line: "Do not pretend you can physically control a vehicle…" | Brief §57 |
| AI-07 | Provider-neutral safety layer: safe system prompt + provider safeguards + reporting + testing | System prompt is safe; no reporting feature yet | `lib/config/settings.ts`, wizard | IN PROGRESS | manual red-team prompts | — | Brief §56 |
| AI-08 | Conversation history is a bounded window and does not silently upload | Last 16 turns, in memory only | `lib/llm/client.ts` | VERIFIED | code review | `buildMessages` slices `history.slice(-16)` | Brief §50 |
| AI-09 | Streaming output that fails mid-stream surfaces a usable error | NDJSON error frames are mapped and thrown as `KITTError` | `app/api/llm/route.ts`, `lib/llm/client.ts` | IMPLEMENTED | provider-failure test | — | Brief §86 |

## VOICE — TTS

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| VOICE-01 | Voice choices expressed plainly: demo voice, device voice, OpenAI voice, custom voice | Raw provider list (demo / browser / ElevenLabs / OpenAI) | `components/SettingsPanel.tsx` | NOT STARTED | wizard test | — | Brief §16 |
| VOICE-02 | TTS input capped so the route cannot become an unlimited TTS relay | 1200 chars per segment, 32 KB body | `lib/server/limits.ts`, `app/api/tts/route.ts` | VERIFIED | `tests/apiRoutes.test.ts` | oversized-speech case passes | Brief §44; P0 finding |
| VOICE-03 | No bundled cloned actor voice or copyrighted show audio ships | Demo voice is WebAudio formant synthesis written in this repo | `lib/tts/client.ts` | VERIFIED | asset audit | No binary audio assets in the repo (`git ls-files` — fonts only) | Brief §19/§61 |
| VOICE-04 | Third-party voices are treated and labelled as custom, never claimed as official | No official-voice claim exists in code or UI | `components/SettingsPanel.tsx` | IMPLEMENTED | copy review | — | Brief §19 |
| VOICE-05 | Voice tuning parameters stay out of onboarding | Currently all exposed in the VOICE tab | `components/SettingsPanel.tsx` | NOT STARTED | wizard test | — | Brief §16 |

## STT — speech recognition

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| STT-01 | Native Android speech recognition preferred so normal users need no STT key | No native path exists; only Web Speech API and Whisper | `lib/stt/stt.ts` | NOT STARTED | device test | — | Brief §22; requires the Capacitor shell |
| STT-02 | A recogniser adapter lets the engine use native / browser / Whisper without changing conversation logic | `engine.listen()` branches on provider id; a third provider has no seam yet | `lib/conversation/engine.ts`, `lib/stt/stt.ts` | NOT STARTED | unit test | — | Brief §22 |
| STT-03 | Whisper remains an advanced fallback and is not mandatory | Whisper is optional and off by default | `lib/config/settings.ts` | VERIFIED | code review | `stt.provider: 'browser'` default | Brief §23 |
| STT-04 | Upload limited: max size, MIME allowlist, timeout, model/language validation | Enforced | `app/api/stt/route.ts`, `lib/server/limits.ts` | VERIFIED | `tests/apiRoutes.test.ts` | MIME, empty, missing-key and size cases pass | Brief §45; P0 finding |
| STT-05 | Microphone permission requested only after an explanation, never at first install | Engine requests permission on START; no pre-permission explanation screen | wizard | NOT STARTED | device test | — | Brief §20 |
| STT-06 | Live microphone test with level meter and spoken "no voice detected" guidance | `testMicrophone()` exists in Settings → AUDIO with an input meter | `lib/stt/micTest.ts` | IMPLEMENTED | device test | — | Brief §21 |
| STT-07 | No background microphone use; capture stops when conversation ends | `MicCapture.stop()` releases tracks; engine stops on END | `lib/stt/mic.ts`, `lib/conversation/engine.ts` | IMPLEMENTED | device lifecycle test | — | Brief §70 |
| STT-08 | Push-to-talk works when selected | `pushToTalkCommit()` is a stub; the setting has no effect | `lib/conversation/engine.ts:320` | NOT STARTED | device test | — | Found during this audit; not listed in BUGS.md |

## AUDIO — playback, routing, LED sync

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| AUDIO-01 | Microphone input never drives the KITT LEDs; only output audio does | Separate analyser graphs, verified by reading both paths | `lib/audio/pipeline.ts`, `lib/stt/mic.ts` | VERIFIED | modulator unit test + code review | `tests/modulator.test.ts`; mic graph connects only to its own analyser | Brief §5 regression |
| AUDIO-02 | AudioContext, MediaSource, streaming MP3, SpeechSynthesis, mic, rAF and wake lock work in the real Android WebView | Unverified — no Android build exists | all of `lib/audio/*` | NOT STARTED | on-device WebView test | — | Brief §90: Chrome success proves nothing here |
| AUDIO-03 | Audio focus handled: KITT does not talk over calls or navigation prompts | No audio-focus handling | Capacitor shell | NOT STARTED | device test | — | Brief §72 |
| AUDIO-04 | Output follows the system route across speaker, wired, Bluetooth and car | Untested | `lib/audio/pipeline.ts` | NOT STARTED | device test | — | Brief §73; do not claim compatibility before testing |
| AUDIO-05 | Audible TTS → LED mismatch under ~50 ms, measured | Not measured; the "first-audio" readout can never render because `latency.firstPlayback` is never set on the speaking path | `lib/audio/pipeline.ts`, `components/KittDashboard.tsx` | NOT STARTED | instrumented measurement | — | Brief §89; BUGS.md B-06 remains open |
| AUDIO-06 | TEST LEDS exercises the same render path as real audio | TEST LEDS injects synthetic levels that bypass the analyser, so it validates rendering but not sync | `components/KittDashboard.tsx:139-170` | IMPLEMENTED | DOM sampling test | `tests/modulator.test.ts` covers the math | Brief §89 honesty requirement |
| AUDIO-07 | Resources stop when a conversation ends: no leaked AudioContext, mic track or rAF loop | END/stop release tracks and stop playback; the pipeline AudioContext is reused while the engine lives | `lib/conversation/engine.ts`, `lib/audio/pipeline.ts` | IMPLEMENTED | battery/lifecycle test | — | Brief §75 |

## SEC — security and credential handling

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| SEC-01 | Runtime validation of every proxy request body | zod schemas + strict multipart validation | `lib/server/schemas.ts`, `lib/server/http.ts` | VERIFIED | `tests/apiSecurity.test.ts`, `tests/apiRoutes.test.ts` | 82/82 pass | Brief §42 |
| SEC-02 | Rate limiting on /api/llm, /api/tts, /api/stt without invasive fingerprinting | Sliding window keyed by IP + installation id | `lib/server/rateLimit.ts` | VERIFIED | `tests/apiSecurity.test.ts`, route test | 429 + Retry-After case passes | Brief §46; per-process store, see SEC-06 |
| SEC-03 | SSRF blocked for user-supplied endpoints | Encoded-address, scheme, port, credential and hostname checks | `lib/server/endpointGuard.ts` | VERIFIED | 18 parameterised cases | `npm test` | Brief §47; P0 finding |
| SEC-04 | Provider destinations fixed and allowlisted | OpenAI, Anthropic, Gemini, OpenRouter, ElevenLabs only | `lib/server/limits.ts`, routes | VERIFIED | `tests/apiSecurity.test.ts` | allowlist assertions pass | Brief §48 |
| SEC-05 | Provider keys never logged; Authorization headers never logged | Credential-scrubbing on all relayed messages; no key appears in any log call | `lib/server/redact.ts`, routes | VERIFIED | `tests/apiSecurity.test.ts` + log audit | scrubbing tests pass; `console.warn` in `lib/config/storage.ts` contains no secret | Brief §41 |
| SEC-06 | Rate-limit store is shared across instances in a multi-instance deployment | In-memory only: correct for a single long-lived Node server, per-instance on serverless | `lib/server/rateLimit.ts` | IN PROGRESS | deployment review | documented in module header | Needed before any multi-instance host |
| SEC-07 | No secret ships inside the release package | No secret is committed; `.gitignore` covers `.env*.local`, `*.pem` | `.gitignore` | VERIFIED | secret scan | `git ls-files` shows no keys, keystores or env files | Brief §114; re-verify against the built AAB |
| SEC-08 | Keys used server-side only, never echoed back to the client | Routes return only text/audio/consumer errors | `app/api/*/route.ts` | VERIFIED | route tests | no response body contains the submitted key | Brief §38 |
| SEC-09 | Android credentials use Keystore-backed secure storage, not web localStorage | Current store is AES-GCM with the device key in the same localStorage | `lib/config/storage.ts` | NOT STARTED | device test | — | Brief §39; the weak part is where the key lives |
| SEC-10 | Upgrading a web user to Android never silently copies weakly protected credentials | No migration path exists yet | Capacitor shell | NOT STARTED | device test | — | Brief §40; prefer re-entry |

## PRIVACY — disclosures and user control

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| PRIVACY-01 | Privacy copy matches real behaviour: temporary processing vs persistent storage | **Currently false** — states "Audio is never recorded or stored" while `mic.ts` captures a webm blob for whisper upload, and only counts as true when history is enabled | `components/SettingsPanel.tsx` | NOT STARTED | copy review | — | Brief §49; P0 finding |
| PRIVACY-02 | "Save conversation history" has a defined, true meaning | The toggle is read by no code path; history is current-session memory only | `lib/config/settings.ts`, engine | NOT STARTED | unit test | `saveHistory` has no consumers (grep this session) | Brief §50 |
| PRIVACY-03 | Independent controls: delete credentials, clear history, reset configuration | DELETE SAVED KEYS exists; no clear-history or reset-configuration control | `components/SettingsPanel.tsx` | NOT STARTED | settings test | — | Brief §96/§97 |
| PRIVACY-04 | Public privacy policy covering mic, speech, text, providers, keys, storage, retention, logging, crash reporting, contact | Absent | `docs/PRIVACY_POLICY.md` + public URL | NOT STARTED | policy review | — | Brief §51 |
| PRIVACY-05 | Google Play Data Safety answers documented per data type | Absent | `docs/PLAY_DATA_SAFETY.md` | NOT STARTED | review against behaviour | — | Brief §52 |
| PRIVACY-06 | In-app reporting of offensive AI responses, without leaving the app | Absent | `components/ReportResponse.tsx` (new) | NOT STARTED | device test | — | Brief §53 |
| PRIVACY-07 | Report flow discloses exactly what will be sent and requires confirmation | Absent | reporting UI | NOT STARTED | device test | — | Brief §54/§55 |
| PRIVACY-08 | Crash reporting, if added, excludes keys, transcript text and audio | No crash reporting configured | — | DEFERRED | — | — | Brief §99; revisit before Play submission |

## ANDROID — packaging and platform

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| ANDROID-01 | Architecture chosen and approved | Capacitor + existing React UI + hosted API, approved by the project owner this session | `android/` (new) | IN PROGRESS | — | decision recorded in this ledger | Brief §35/§36 |
| ANDROID-02 | Capacitor shell added around the existing UI without redesigning it | Not started | `capacitor.config.ts`, `android/` | NOT STARTED | build | — | Brief §35 |
| ANDROID-03 | Permanent package name `com.grimspyder.kittassistant` | Approved; no Android project registered yet | `android/app/build.gradle` | NOT STARTED | AAB inspection | — | Brief §63 |
| ANDROID-04 | targetSdk current at submission (Android 16 / API 36 unless Google requires otherwise) | No Android project | `android/app/build.gradle` | NOT STARTED | `bundle` inspection | — | Brief §64; recheck in Play Console before upload |
| ANDROID-05 | minSdk chosen from real device coverage, not defaults | No Android project | `android/app/build.gradle` | NOT STARTED | device matrix | — | Brief §65 |
| ANDROID-06 | Release output is a signed `.aab`, not a debug APK | No Android project | CI workflow | NOT STARTED | bundle inspection | — | Brief §66 |
| ANDROID-07 | Google Play App Signing used; no keystore or password committed | No keystore exists in the repo | — | VERIFIED | secret scan | `git ls-files` clean | Brief §67 |
| ANDROID-08 | Permissions limited to INTERNET + RECORD_AUDIO unless a proven feature needs more | No manifest exists | `AndroidManifest.xml` | NOT STARTED | manifest inspection | — | Brief §69 |
| ANDROID-09 | 16 KB page-size compatibility verified against the actual bundle if native libraries are included | Unknown until a bundle exists | AAB inspection | NOT STARTED | bundle inspection | — | Brief §76 |
| ANDROID-10 | Lifecycle recovery: home, screen lock, incoming call, Bluetooth change, background/foreground, orientation | Untested | Capacitor shell + engine | NOT STARTED | device test | — | Brief §71 |
| ANDROID-11 | Battery use during an active conversation measured and resources released | Unmeasured | engine, pipeline | NOT STARTED | device measurement | — | Brief §75 |

## PLAY — store presence and compliance

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| PLAY-01 | Entertainment positioning; no vehicle-control, safety or emergency claims | Repo docs do describe it as an entertainment replica; no store listing exists yet | store listing | NOT STARTED | listing review | — | Brief §58 |
| PLAY-02 | IP/branding review of title, description, icon, screenshots, video, voice marketing | Not done; RESEARCH.md documents extensive third-party references | `docs/IP_REVIEW.md` | NOT STARTED | legal/copy review | — | Brief §59; "fan-made" is not a licence |
| PLAY-03 | No misleading affiliation with any rights holder | Not yet written | listing + in-app | NOT STARTED | listing review | — | Brief §60 |
| PLAY-04 | Branding checkpoint presented to the owner before Play assets are created | Not presented | this ledger | NOT STARTED | owner sign-off | — | Brief §62 |
| PLAY-05 | Store listing: name, short + full description, icon, feature graphic, screenshots, support email, privacy URL | Absent | `docs/STORE_LISTING.md` | NOT STARTED | review | — | Brief §100 |
| PLAY-06 | Content rating questionnaire answered from observed AI behaviour | Not started | Play Console | NOT STARTED | console | — | Brief §103 |
| PLAY-07 | Target audience decided; children not included by default | Not decided | Play Console | NOT STARTED | console | — | Brief §104 |
| PLAY-08 | Developer verification and package registration completed before the deadline | Not started; the brief's date (2026-09-30) is today | Play Console | BLOCKED | console | — | Requires the owner's Play account |
| PLAY-09 | Internal testing release installed from Google Play and walked through the full checklist | Not started | — | NOT STARTED | device checklist | — | Brief §105/§106 |
| PLAY-10 | Closed testing completed if personal-account production access applies | Not started | — | NOT STARTED | console | — | Brief §107; verify the current requirement in Play Console |
| PLAY-11 | Pre-launch report reviewed (crashes, ANRs, compatibility, accessibility, security, rendering) | Not started | — | NOT STARTED | console | — | Brief §110 |

## QA — testing and gates

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| QA-01 | Existing unit tests preserved and expanded, never replaced | 20 → 82 tests, original 3 suites untouched | `tests/*` | VERIFIED | `npm test` | 82/82 pass at HEAD | Brief §83 |
| QA-02 | Setup wizard tests: first launch, demo, provider, invalid/valid key, voice, mic denied/granted, readiness, re-entry | Absent | `tests/wizard.test.ts` | NOT STARTED | — | — | Brief §84 |
| QA-03 | API security tests: malformed JSON, unknown provider, missing key, oversized input, bad temperature, TTS/STT limits, SSRF, timeouts, 401, 429 | Added for every case that does not need a live provider | `tests/apiSecurity.test.ts`, `tests/apiRoutes.test.ts` | VERIFIED | `npm test` | 62 new cases pass | Brief §85; live 401/429/timeout paths still need a staged provider |
| QA-04 | Conversation tests: speech→AI→voice, text→AI→voice, interruption, rapid input, no speech, long response, network loss, AI/TTS timeout | Absent | `tests/conversation.test.ts` | NOT STARTED | — | — | Brief §86 |
| QA-05 | Real-device voice tests: hands-free end of turn, barge-in, echo cancellation, noise suppression, feedback, real mic, real TTS, LED/audio sync | Not possible before the Android build exists | — | BLOCKED | device session | — | Brief §87 |
| QA-06 | Portrait and landscape tested on real devices, not just desktop responsive mode | Untested | — | NOT STARTED | device session | — | Brief §88 |
| QA-07 | Every page and flow verified with real evidence, not assertions | This ledger will carry the evidence | — | IN PROGRESS | — | see individual rows | Brief §119 |
| QA-08 | Stale BUGS.md / TODO.md entries re-audited and cleared only when verified | B-01/02/03 are genuinely fixed; TODO.md still lists fullscreen and wake lock, both of which exist | `BUGS.md`, `TODO.md` | IN PROGRESS | code review | This session's audit found the false entries | Brief §82 |

## PERF — performance and reliability

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| PERF-01 | Cold start, time to interactive, time to first KITT response, first TTS audio, settings launch, orientation change measured | Unmeasured | — | NOT STARTED | device measurement | — | Brief §91 |
| PERF-02 | The dashboard never displays a frozen state without feedback | Status line reflects every machine state | `components/KittDashboard.tsx` | IMPLEMENTED | manual + device | — | Brief §91 |
| PERF-03 | Clear errors for Wi-Fi, cellular, slow, switching, offline and restored connections | Provider errors are mapped to network wording | `lib/server/providerErrors.ts` | IMPLEMENTED | device test | — | Brief §92 |
| PERF-04 | Build and dependency gates are clean | Next 15.5.26, vitest 5; `npm audit` reports 0 vulnerabilities | `package.json` | VERIFIED | `npm run build`, `npm audit` | 0 vulnerabilities; build succeeds | Brief §112 |
| PERF-05 | CI runs npm ci, type-check, lint, tests, production build, dependency audit, and the Android build once the project exists | No CI exists | `.github/workflows/ci.yml` | NOT STARTED | CI run | — | Brief §77 |
| PERF-06 | No build is expected on Node 18 | Node 18 cannot run Next 15; engines + `.nvmrc` declare 22 | `package.json`, `.nvmrc` | VERIFIED | gate run | Gates executed on Node 24.12.0 | Brief §112 |

## IP — intellectual property

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| IP-01 | Original UI recreation, original synthesised sounds, original icons and screenshots preferred over show assets | UI is hand-built CSS/DOM; demo voice is original WebAudio synthesis; no show assets in the repo | `components/*`, `lib/tts/client.ts` | VERIFIED | asset audit | `git ls-files` shows no audio/image assets | Brief §61 |
| IP-02 | No cloned actor voice or copyrighted TV audio ships | Confirmed — the demo voice is generated at runtime | `lib/tts/client.ts` | VERIFIED | asset audit | as above | Brief §19/§61 |
| IP-03 | App title, description, icon, screenshots and marketing reviewed for trademark use of KITT / Knight Rider / Knight Industries Two Thousand | Not done | `docs/IP_REVIEW.md` | NOT STARTED | review | — | Brief §59; the highest residual release risk |

---

## Residual risk summary

| Risk | Severity | Status |
|---|---|---|
| IP: the product name and identity reference a trademarked property | High | Open — needs the owner's decision (PLAY-02, IP-03) |
| No Android build exists yet, so every Android row is unproven | High | In progress (ANDROID-01) |
| Audio/LED sync and real-microphone behaviour unmeasured | Medium | Blocked on a device session (AUDIO-05, QA-05) |
| Rate-limit store is per-process on serverless hosts | Medium | Documented; needs a shared store for multi-instance (SEC-06) |
| Custom compatible endpoints are disabled, so some power users lose their own gateway | Low | Accepted, deliberate (AI-03) |

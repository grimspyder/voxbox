# PRODUCTION_REQUIREMENTS — Voxbox

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
| SETUP-01 | First launch shows a WELCOME TO VOXBOX choice screen with "TRY VOX NOW" and "SET UP FULL VOXBOX" | Implemented: `KittDashboard` renders `SetupWizard` whenever `settings.setup.complete` is false | `components/SetupWizard.tsx`, `components/KittDashboard.tsx` | VERIFIED | `tests/setupWizard.test.tsx` | `npm test` → welcome, no-setup path and disclaimer cases pass; confirmed rendered inside the installed APK on an Android 16 emulator over CDP | Brief §8 |
| SETUP-02 | Demo mode is reachable with zero configuration and is offered before any API setup | "TRY VOX NOW" completes in demo mode with no further questions; setup is skippable from every step | `components/SetupWizard.tsx` | VERIFIED | `tests/setupWizard.test.tsx` | TRY VOX NOW and SKIP FOR NOW cases assert `setup: {complete: true, mode}` | Brief §8/§10 |
| SETUP-03 | Setup wizard stages: experience → AI brain → voice → microphone → system check → ready | Implemented: welcome → AI brain → voice → microphone → system check → ready | `components/SetupWizard.tsx` | VERIFIED | `tests/setupWizard.test.tsx` | walkthrough test traverses every stage to START CONVERSATION | Brief §9 |
| SETUP-04 | AI provider step presents provider cards, not a raw dropdown of providers and models | Provider cards with plain-language blurbs, preselected OpenAI, no raw provider/model dropdown in the wizard | `components/SetupWizard.tsx`, `lib/config/providers.ts` | VERIFIED | `tests/setupWizard.test.tsx`, `tests/setupReadiness.test.ts` | card list and jargon-free assertions pass | Brief §11 |
| SETUP-05 | Each provider has a maintained recommended default model; the user supplies only provider + key | Ordered preferences plus live model discovery; the wizard picks the model and only mentions it as optional | `lib/config/providers.ts`, `app/api/llm/models/route.ts` | VERIFIED | `tests/setupReadiness.test.ts` | `chooseModel` exact/prefix/fallback/non-chat cases pass | Brief §12 |
| SETUP-06 | API key field: password style, show/hide, paste-friendly, no autocorrect/autocapitalise/spellcheck | Implemented in the wizard with a 48 px-tall field and a SHOW/HIDE toggle | `components/SetupWizard.tsx` | VERIFIED | `tests/setupWizard.test.tsx` | attributes asserted: autocomplete/autocorrect/autocapitalize off, spellcheck=false, type toggles password→text | Brief §13 |
| SETUP-07 | "TEST CONNECTION" reports ✓ AI connected or a useful error | Exists and is now the wizard's gate: CONTINUE is disabled until it succeeds | `components/SetupWizard.tsx`, `lib/llm/client.ts` | IMPLEMENTED | manual against live provider | Historic run in TESTING.md; live re-run still outstanding | Brief §13 |
| SETUP-08 | Each provider links to official "how do I get a key?" instructions, opened externally | Implemented as HOW DO I GET A KEY? opening the provider page in a new tab with `rel="noopener noreferrer"` | `lib/config/providers.ts`, `components/SetupWizard.tsx` | VERIFIED | `tests/setupWizard.test.tsx` | link presence asserted for the selected provider | Brief §14 |
| SETUP-09 | Setup states that the provider may bill the user separately; no hard-coded pricing | Stated on the AI step: the provider bills separately, Vox does not create the account, pricing changes | `components/SetupWizard.tsx` | VERIFIED | copy review | text present in the AI step, no figures quoted | Brief §14 |
| SETUP-10 | One OpenAI key can be reused for AI, voice and Whisper instead of three entries | Implemented and on by default for the OpenAI card; unchecking it is honoured | `components/SetupWizard.tsx` | VERIFIED | `tests/setupWizard.test.tsx` | finish payload asserts `stt` and `tts` both receive the same key; the opt-out case asserts they do not | Brief §15 |
| SETUP-11 | ElevenLabs voice is chosen from a fetched list of the user's voices, not a pasted UUID | Voice list is fetched from `/api/tts/voices` and shown as a Select Voice list; the raw field is gone from the wizard | `app/api/tts/voices/route.ts`, `components/SetupWizard.tsx` | IMPLEMENTED | wizard test + live account | UI path covered by code review; needs one real ElevenLabs key to call it verified | Brief §17 |
| SETUP-12 | Every voice path offers TEST VOICE with a short test phrase and ✓ / useful error | Exists in both the wizard and Settings, sharing one test phrase | `components/SetupWizard.tsx`, `lib/setup/discovery.ts`, `lib/tts/client.ts` | IMPLEMENTED | manual | Historic run in TESTING.md | Brief §18 |
| SETUP-13 | System check screen reports AI / Voice / Microphone / Audio output / Internet before finishing | Implemented with per-item status and a plain summary sentence | `lib/setup/readiness.ts`, `components/SetupWizard.tsx` | VERIFIED | `tests/setupWizard.test.tsx`, `tests/setupReadiness.test.ts` | all five labels asserted in the wizard; readiness, warn-vs-fail and offline-demo rules covered | Brief §24 |
| SETUP-14 | Post-onboarding "SYSTEM SETUP" health screen lets the user repair one item without redoing the wizard | Implemented as the default Settings tab, with TEST AI CONNECTION / TEST MICROPHONE and RUN SETUP AGAIN; per-item repair is still done in the matching tab | `components/SettingsPanel.tsx` | IMPLEMENTED | manual | statuses are set only by a real test in the session, never assumed from a saved setting | Brief §25 |
| SETUP-15 | Existing advanced controls survive, reclassified under ADVANCED SETTINGS | All nine tabs remain; a SYSTEM SETUP tab was added first with a note that the rest are advanced. Individual controls are not yet relabelled | `components/SettingsPanel.tsx` | IN PROGRESS | settings test | — | Brief §26; nothing was deleted |
| SETUP-16 | No user account is introduced | No account system exists | — | VERIFIED | code review | Full source audit, this session | Brief §98 |

## MOBILE — phone UX

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| MOBILE-01 | Usable at 320/360/375/390/412/480 logical px widths | Measured in a real browser at all six widths: no horizontal overflow, no vertical scrolling, panel keeps 4:3 | `components/KittDashboard.tsx` | VERIFIED | browser sweep at 6 widths | 320x568 / 360x640 / 375x667 / 390x844 / 412x915 / 480x800 all: overflow=false, vScroll=false, display ratio 1.33 | Brief §27 |
| MOBILE-02 | Portrait is a first-class layout with status, start/stop, interrupt, settings, text, errors visible without scrolling | Status, controls (wrapping to two rows) and the text field are all on screen without scrolling down to 320x568 | `components/KittDashboard.tsx` | VERIFIED | browser sweep + screenshot | portrait 390x844 screenshot: display, status, 4 controls and SEND all visible, no scroll | Brief §28 |
| MOBILE-03 | Landscape uses space intelligently and does not stretch the 4:3 panel into distortion | Display takes the height on the left, controls wrap in a column beside it; ratio stays 1.33 | `components/KittDashboard.tsx` | VERIFIED | browser check at 844x390 | display 406x304 (ratio 1.33), `.kitt-side` at x=448 (beside the panel), 0 clipped elements, no scroll | Brief §29; whether it *feels* right on glass is QA-06 |
| MOBILE-04 | Safe areas: notch, camera cutout, rounded corners, gesture navigation | `viewport-fit=cover` set and the root pads by `max(8px, env(safe-area-inset-*))` on all four edges | `app/layout.tsx`, `components/KittDashboard.tsx` | IMPLEMENTED | device test | emulation reports inset 0, so the fallback is what was exercised; real cutout values need hardware | Brief §30 |
| MOBILE-05 | Interactive targets are comfortable finger targets (≥44 px) | Buttons raised to `min-height: 48px`, input to 48 px with 16 px text (also stops focus zoom) | `components/KittDashboard.tsx` | VERIFIED | measured audit at 6 widths | minimum button height measured 48 px, zero undersized controls at every width (was 30–33 px) | Brief §31 |
| MOBILE-06 | Main screen is decluttered on phones; TEST LEDS moves to Diagnostics in the consumer build | Deliberately kept on the main screen: the test must be watched while it runs, so hiding it behind the settings overlay would make it useless | `components/KittDashboard.tsx` | DEFERRED | — | — | Brief §32 says "if doing so improves phone usability" — here it would not; controls are now full-size instead |
| MOBILE-07 | Fullscreen works with gesture nav, status/nav bars and orientation change, with an obvious exit | Button exists; the only exit is toggling the same button, and Android fullscreen is unverified | `components/KittDashboard.tsx` | IN PROGRESS | device test | — | Brief §33 |
| MOBILE-08 | Screen wake lock during an active conversation, released when it ends | `navigator.wakeLock.request('screen')` on non-DISCONNECTED states | `components/KittDashboard.tsx:216-223` | IMPLEMENTED | device test | — | Brief §34; verify inside Android WebView, add native bridge if unreliable |

## AI — models, providers, safety

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| AI-01 | Working providers presented as simple cards: OpenAI, OpenRouter, Anthropic, Gemini | Provider list exists in code; presentation is a raw select | `components/SettingsPanel.tsx` | NOT STARTED | wizard test | — | Brief §11; provider list matches working code |
| AI-02 | temperature / maxTokens / base URL hidden under Advanced Settings | All are in the primary AI BRAIN tab | `components/SettingsPanel.tsx` | NOT STARTED | settings test | — | Brief §11/§26 |
| AI-03 | Arbitrary OpenAI-compatible endpoints removed or secured for the consumer build | Disabled by default; only served when `KITT_ALLOW_CUSTOM_ENDPOINTS=true`, with full SSRF validation | `app/api/llm/route.ts`, `lib/server/endpointGuard.ts` | VERIFIED | `tests/apiSecurity.test.ts`, `tests/apiRoutes.test.ts` | `npm test` → 82/82 pass, incl. 18 blocked-endpoint cases | Brief §47; P0 finding |
| AI-04 | LLM inputs limited: message count, message size, system prompt size, maxTokens, body size | Enforced | `lib/server/limits.ts`, `lib/server/schemas.ts` | VERIFIED | `tests/apiRoutes.test.ts` | `npm test` → oversized message / maxTokens / conversation cases pass | Brief §43 |
| AI-05 | Provider errors translated to consumer language, never raw JSON | Status-mapped consumer messages | `lib/server/providerErrors.ts` | VERIFIED | `tests/apiSecurity.test.ts` | redaction + mapping cases pass | Brief §93 |
| AI-06 | Vox never claims to control a real vehicle or device | Instruction present in the default system prompt | `lib/config/settings.ts` | IMPLEMENTED | prompt review | `DEFAULT_SYSTEM_PROMPT` line: "Do not pretend you can physically control a vehicle…" | Brief §57 |
| AI-07 | Provider-neutral safety layer: safe system prompt + provider safeguards + reporting + testing | System prompt is safe; no reporting feature yet | `lib/config/settings.ts`, wizard | IN PROGRESS | manual red-team prompts | — | Brief §56 |
| AI-08 | Conversation history is a bounded window and does not silently upload | Last 16 turns, in memory only | `lib/llm/client.ts` | VERIFIED | code review | `buildMessages` slices `history.slice(-16)` | Brief §50 |
| AI-09 | Streaming output that fails mid-stream surfaces a usable error | NDJSON error frames are mapped and thrown as `KITTError` | `app/api/llm/route.ts`, `lib/llm/client.ts` | IMPLEMENTED | provider-failure test | — | Brief §86 |

## VOICE — TTS

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| VOICE-01 | Voice choices expressed plainly: demo voice, device voice, OpenAI voice, custom voice | Implemented and capability-aware: every option is checked against the device before it is offered, and Device Voice is withdrawn with an explanation where the engine cannot speak | `lib/setup/voiceOptions.ts`, `components/SetupWizard.tsx`, `components/SettingsPanel.tsx` | VERIFIED | `tests/setupCapabilities.test.ts` | Android WebView measurement (`speechSynthesis: false`) drives the withdrawn option; unit tests assert both the available and withdrawn paths | Brief §16 |
| VOICE-02 | TTS input capped so the route cannot become an unlimited TTS relay | 1200 chars per segment, 32 KB body | `lib/server/limits.ts`, `app/api/tts/route.ts` | VERIFIED | `tests/apiRoutes.test.ts` | oversized-speech case passes | Brief §44; P0 finding |
| VOICE-03 | No bundled cloned actor voice or copyrighted show audio ships | Demo voice is WebAudio formant synthesis written in this repo | `lib/tts/client.ts` | VERIFIED | asset audit | No binary audio assets in the repo (`git ls-files` — fonts only) | Brief §19/§61 |
| VOICE-04 | Third-party voices are treated and labelled as custom, never claimed as official | No official-voice claim exists in code or UI | `components/SettingsPanel.tsx` | IMPLEMENTED | copy review | — | Brief §19 |
| VOICE-05 | Voice tuning parameters stay out of onboarding | Currently all exposed in the VOICE tab | `components/SettingsPanel.tsx` | NOT STARTED | wizard test | — | Brief §16 |

## STT — speech recognition

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| STT-01 | Native Android speech recognition preferred so normal users need no STT key | Measured: the Android WebView **does** expose `SpeechRecognition` and `webkitSpeechRecognition`, so on-device recognition is available through the existing code path and a native plugin is not required for basic function. Actual recognition success on hardware (it depends on the device's speech service) is still untested | `lib/stt/stt.ts`, `android/app/src/main/AndroidManifest.xml` | IN PROGRESS | `scripts/device-probe.mjs` over CDP | probe reports `SpeechRecognition: true`, `webkitSpeechRecognition: true`; microphone permission path fixed (see ANDROID-08) | Brief §22; earlier assumption that WebView lacks it was wrong — measured instead |
| STT-02 | A recogniser adapter lets the engine use native / browser / Whisper without changing conversation logic | `lib/setup/voiceOptions.ts` reports which speech paths this device supports, and Whisper stays available as the fallback | `lib/setup/voiceOptions.ts`, `lib/conversation/engine.ts` | IN PROGRESS | `tests/setupCapabilities.test.ts` | device-recognition and Whisper-fallback cases pass | Brief §22; the engine seam for a native adapter is still absent |
| STT-03 | Whisper remains an advanced fallback and is not mandatory | Whisper is optional and off by default | `lib/config/settings.ts` | VERIFIED | code review | `stt.provider: 'browser'` default | Brief §23 |
| STT-04 | Upload limited: max size, MIME allowlist, timeout, model/language validation | Enforced | `app/api/stt/route.ts`, `lib/server/limits.ts` | VERIFIED | `tests/apiRoutes.test.ts` | MIME, empty, missing-key and size cases pass | Brief §45; P0 finding |
| STT-05 | Microphone permission requested only after an explanation, never at first install | Engine requests permission on START; no pre-permission explanation screen | wizard | NOT STARTED | device test | — | Brief §20 |
| STT-06 | Live microphone test with level meter and spoken "no voice detected" guidance | `testMicrophone()` exists in Settings → AUDIO with an input meter | `lib/stt/micTest.ts` | IMPLEMENTED | device test | — | Brief §21 |
| STT-07 | No background microphone use; capture stops when conversation ends | `MicCapture.stop()` releases tracks; engine stops on END | `lib/stt/mic.ts`, `lib/conversation/engine.ts` | IMPLEMENTED | device lifecycle test | — | Brief §70 |
| STT-08 | Push-to-talk works when selected | `pushToTalkCommit()` is a stub; the setting has no effect | `lib/conversation/engine.ts:320` | NOT STARTED | device test | — | Found during this audit; not listed in BUGS.md |

## AUDIO — playback, routing, LED sync

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| AUDIO-01 | Microphone input never drives the Vox LEDs; only output audio does | Separate analyser graphs, verified by reading both paths | `lib/audio/pipeline.ts`, `lib/stt/mic.ts` | VERIFIED | modulator unit test + browser regression run | `tests/modulator.test.ts`; browser: 3 bars x 16 segments render, TEST LEDS lights centre-first (16 on the centre bar vs 12/8 on the sides) and settles to 0 | Brief §5 regression |
| AUDIO-02 | AudioContext, MediaSource, streaming MP3, SpeechSynthesis, mic, rAF and wake lock work in the real Android WebView | Capability probes inside the installed APK on an Android 16 emulator (WebView 146.0.7680.119): AudioContext ✓, MediaSource ✓ and `audio/mpeg` supported ✓, getUserMedia ✓ in a secure context, wake lock ✓, **speechSynthesis ✗** (absent in WebView). Actual audible playback on hardware is still untested | all of `lib/audio/*` | IN PROGRESS | `scripts/device-probe.mjs` over CDP | probe output recorded; DOM fully rendered (19,267 chars, display 379x284) | Brief §90; the synthesis result is why VOICE-01 became capability-aware |
| AUDIO-03 | Audio focus handled: Vox does not talk over calls or navigation prompts | No audio-focus handling | Capacitor shell | NOT STARTED | device test | — | Brief §72 |
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
| ANDROID-01 | Architecture chosen and approved | Capacitor + existing React UI + hosted API, approved by the project owner; one codebase now produces two targets (web app with proxies, static native bundle) | `next.config.mjs`, `capacitor.config.ts` | VERIFIED | build + decision record | this ledger + debug APK build | Brief §35/§36 |
| ANDROID-02 | Capacitor shell added around the existing UI without redesigning it | Capacitor 8.5.2 shell ships the static export of the *same* components; no duplicate UI | `capacitor.config.ts`, `android/`, `scripts/build-native.mjs` | VERIFIED | `gradlew assembleDebug` | BUILD SUCCESSFUL; APK 4.3 MB containing `assets/public/index.html` plus the page chunk | Brief §35 |
| ANDROID-03 | Permanent package name | `com.grimspyder.voxbox` (renamed from the original `com.grimspyder.kittassistant` before any Play registration, because the package appears in the store URL) | `android/app/build.gradle`, `app/src/main/res/values/strings.xml`, `android/app/src/main/java/com/grimspyder/voxbox/MainActivity.java` | IMPLEMENTED | `aapt2 dump xmltree` on a rebuild | name agreed with the owner; artifact re-verification pending the next build | Brief §63 |
| ANDROID-04 | targetSdk current at submission (Android 16 / API 36 unless Google requires otherwise) | Capacitor 8 already defaults to it; confirmed in the artifact | `android/variables.gradle` | VERIFIED | `aapt2 dump xmltree` | `targetSdkVersion=36`, `compileSdkVersionCodename="16"`, platformBuildVersionCode 36 | Brief §64; Play requires API 36 for new apps since 2026-08-31 |
| ANDROID-05 | minSdk chosen from real device coverage, not defaults | Kept at Capacitor's tested floor of 24 (Android 7.0) rather than raised: broader coverage, and no feature needs newer | `android/variables.gradle` | VERIFIED | artifact inspection | `minSdkVersion=24`; microphone declared `required=false` so no device is excluded | Brief §65 |
| ANDROID-06 | Release output is a signed `.aab`, not a debug APK | Debug APK builds; the release bundle needs the upload keystore, which the owner must create | `android/app/build.gradle`, CI workflow | NOT STARTED | `bundleRelease` + `bundletool` inspection | — | Blocked on the upload key (Play App Signing) |
| ANDROID-07 | Google Play App Signing used; no keystore or password committed | No keystore exists; `local.properties` (machine path) is gitignored, keystores are covered by the Android template's gitignore | `.gitignore`, `android/.gitignore` | VERIFIED | secret scan | CI secret-scan job plus a tracked-file audit | Brief §67 |
| ANDROID-08 | Permissions limited to INTERNET + RECORD_AUDIO unless a proven feature needs more | Three permissions ship: INTERNET, RECORD_AUDIO, and MODIFY_AUDIO_SETTINGS | `android/app/src/main/AndroidManifest.xml` | VERIFIED | `aapt2 dump xmltree` on the built APK | exactly `INTERNET`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`; `uses-feature microphone required=false`. The third is not discretionary: Capacitor's `BridgeWebChromeClient.onPermissionRequest` asks for `MODIFY_AUDIO_SETTINGS` *and* `RECORD_AUDIO` together and denies the WebView's audio-capture request unless both are granted, so without it the microphone silently fails on Android | Brief §69 |
| ANDROID-09 | 16 KB page-size compatibility verified against the actual bundle if native libraries are included | No native libraries ship at all, so there is nothing to align | APK contents | VERIFIED | APK inspection | `unzip -l` reports 0 entries matching `lib/*.so` | Brief §76; re-check if a plugin ever adds native code |
| ANDROID-10 | Lifecycle recovery: home, screen lock, incoming call, Bluetooth change, background/foreground, orientation | Untested; the activity already declares `configChanges` for orientation so the WebView is not recreated on rotation | `android/app/src/main/AndroidManifest.xml` | NOT STARTED | device test | — | Brief §71 |
| ANDROID-11 | Battery use during an active conversation measured and resources released | Unmeasured | — | NOT STARTED | device measurement | — | Brief §75 |

## PLAY — store presence and compliance

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| PLAY-01 | Entertainment positioning; no vehicle-control, safety or emergency claims | Repo docs do describe it as an entertainment replica; no store listing exists yet | store listing | NOT STARTED | listing review | — | Brief §58 |
| PLAY-02 | IP/branding review of title, description, icon, screenshots, video, voice marketing | Title and in-app content done; store copy written with a prohibited-words list. Icon is original art. Feature graphic and screenshots still to produce | `docs/STORE_LISTING.md`, `assets/branding/`, `docs/store/play-icon-512.png` | IMPLEMENTED | copy review + asset audit | see IP-03/IP-04; every asset in the repo is original | Brief §59 |
| PLAY-03 | No misleading affiliation with any rights holder | Not yet written | listing + in-app | NOT STARTED | listing review | — | Brief §60 |
| PLAY-04 | Branding checkpoint presented to the owner before Play assets are created | Done: two rounds of naming review; the owner chose **Voxbox Retro AI** after being shown the existing "VoxBox" apps on Play and the trademark position on franchise names | `docs/STORE_LISTING.md` | VERIFIED | owner decision | recorded in STORE_LISTING.md with the rejected options and why | Brief §62 |
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
| QA-01 | Existing unit tests preserved and expanded, never replaced | 20 → 112 tests, original 3 suites untouched | `tests/*` | VERIFIED | `npm test` | 112/112 pass at HEAD | Brief §83 |
| QA-02 | Setup wizard tests: first launch, demo, provider, invalid/valid key, voice, mic denied/granted, readiness, re-entry | Implemented for everything except a live-provider key check and the meter success path | `tests/setupWizard.test.tsx`, `tests/setupReadiness.test.ts` | VERIFIED | `npm test` | 30 wizard/readiness cases pass: first launch, demo, provider cards, key attributes, invalid key blocks, valid key unlocks, key reuse on and off, voice choices, mic explanation before permission, mic denial guidance, system check, skip at any step | Brief §84 |
| QA-03 | API security tests: malformed JSON, unknown provider, missing key, oversized input, bad temperature, TTS/STT limits, SSRF, timeouts, 401, 429 | Added for every case that does not need a live provider | `tests/apiSecurity.test.ts`, `tests/apiRoutes.test.ts` | VERIFIED | `npm test` | 62 new cases pass | Brief §85; live 401/429/timeout paths still need a staged provider |
| QA-04 | Conversation tests: speech→AI→voice, text→AI→voice, interruption, rapid input, no speech, long response, network loss, AI/TTS timeout | Absent | `tests/conversation.test.ts` | NOT STARTED | — | — | Brief §86 |
| QA-05 | Real-device voice tests: hands-free end of turn, barge-in, echo cancellation, noise suppression, feedback, real mic, real TTS, LED/audio sync | Not possible before the Android build exists | — | BLOCKED | device session | — | Brief §87 |
| QA-06 | Portrait and landscape tested on real devices, not just desktop responsive mode | Untested | — | NOT STARTED | device session | — | Brief §88 |
| QA-07 | Every page and flow verified with real evidence, not assertions | This ledger will carry the evidence | — | IN PROGRESS | — | see individual rows | Brief §119 |
| QA-08 | Stale BUGS.md / TODO.md entries re-audited and cleared only when verified | B-01/02/03 are genuinely fixed; TODO.md still lists fullscreen and wake lock, both of which exist | `BUGS.md`, `TODO.md` | IN PROGRESS | code review | This session's audit found the false entries | Brief §82 |

## PERF — performance and reliability

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| PERF-01 | Cold start, time to interactive, time to first Vox response, first TTS audio, settings launch, orientation change measured | Unmeasured | — | NOT STARTED | device measurement | — | Brief §91 |
| PERF-02 | The dashboard never displays a frozen state without feedback | Status line reflects every machine state | `components/KittDashboard.tsx` | IMPLEMENTED | manual + device | — | Brief §91 |
| PERF-03 | Clear errors for Wi-Fi, cellular, slow, switching, offline and restored connections | Provider errors are mapped to network wording | `lib/server/providerErrors.ts` | IMPLEMENTED | device test | — | Brief §92 |
| PERF-04 | Build and dependency gates are clean | Next 15.5.26, vitest 5; `npm audit` reports 0 vulnerabilities | `package.json` | VERIFIED | `npm run build`, `npm audit` | 0 vulnerabilities; build succeeds | Brief §112 |
| PERF-05 | CI runs npm ci, type-check, lint, tests, production build, dependency audit, and the Android build once the project exists | Live and green: Web gates (type-check, lint, 120 tests, production build), Dependency audit, Secret scan, Android release bundle (static export → cap sync → lintRelease + bundleRelease → artifact upload) | `.github/workflows/ci.yml` | VERIFIED | CI run on PR #1 | all four jobs SUCCESS on `production-android` (Android job 2m38s, uploading `voxbox-ci-unsigned-aab`) | Brief §77. Four workflow bugs were found by running it rather than trusting it: a job-level `hashFiles()` (which makes GitHub reject the whole workflow, producing zero jobs), an incomplete lockfile from `npm install --package-lock-only`, an interactive SDK-licence prompt in a marketplace action, and the Android job building the wrong target (`npm run build` instead of `build:native`). CI also requires the network. The lockfile is Windows-generated, so `npm ci` cannot run on the Linux runner and each job attempts it then falls back to `npm install` with a visible warning — documented in the workflow. |
| PERF-06 | No build is expected on Node 18 | Node 18 cannot run Next 15; engines + `.nvmrc` declare 22, and CI pins 24.x to match the npm that writes the lockfile | `package.json`, `.nvmrc`, `.github/workflows/ci.yml` | VERIFIED | gate run | Gates executed on Node 24.12.0 locally and on the runner | Brief §112 |

## IP — intellectual property

| ID | Requirement | Current state | Affected files | Status | Test | Verification evidence | Notes |
|---|---|---|---|---|---|---|---|
| IP-01 | Original UI recreation, original synthesised sounds, original icons and screenshots preferred over show assets | UI is hand-built CSS/DOM; demo voice is original WebAudio synthesis; no show assets in the repo | `components/*`, `lib/tts/client.ts` | VERIFIED | asset audit | `git ls-files` shows no audio/image assets | Brief §61 |
| IP-02 | No cloned actor voice or copyrighted TV audio ships | Confirmed — the demo voice is generated at runtime | `lib/tts/client.ts` | VERIFIED | asset audit | as above | Brief §19/§61 |
| IP-03 | App title, description, icon, screenshots and marketing reviewed for trademark use | Done for the title and the shipped content: the product is **Voxbox Retro AI**, the persona is **Vox**, the shipped system prompt no longer names any franchise, and the demo replies no longer identify as the trademarked character. Package renamed to `com.grimspyder.voxbox`. Store copy and the prohibited-words list are in `docs/STORE_LISTING.md`; feature graphic and screenshots still outstanding | `docs/STORE_LISTING.md`, `lib/config/settings.ts`, `lib/llm/providers/demoProvider.ts`, `app/layout.tsx` | IMPLEMENTED | copy and code audit | `grep` sweep across the tree for franchise names returns nothing outside the research doc | Brief §59; the owner approved the name |
| IP-04 | The shipped persona does not impersonate the trademarked character | The persona is now a full, deliberately characterised personality (prim, haughty, relentlessly logical, dry, egotistical, baffled by human romance, quantifies risk before complying) whose diction, humour and ego are faithful to the character — while naming no franchise, character, performer, vehicle marque or fictional prop term. Lives in `lib/config/persona.ts` as one source of truth | `lib/config/persona.ts`, `lib/config/settings.ts`, `lib/llm/providers/demoProvider.ts` | VERIFIED | `tests/persona.test.ts` (14 cases) | trait markers asserted present; every excluded identifier asserted absent from the prompt, the demo provider source and all 13 demo replies; the default form of address is asserted in both its set and unset states | Brief §57/§59 |
| IP-06 | The persona keeps the safety boundary and cannot be quietly degraded | The prompt forbids claiming control of any vehicle, appliance, phone or emergency service, forbids claiming to have contacted anyone or taken a real-world action, and keeps answers short because they are spoken. A test asserts both halves: the character traits are present, and the forbidden identifiers are absent — so pasting the original character text back into the prompt fails the build rather than shipping an impersonation | `lib/config/persona.ts`, `lib/config/settings.ts`, `tests/persona.test.ts` | VERIFIED | `npm test` → 134/134 | the guard is the enforcement mechanism; without it, the compliance claim rests on nobody re-introducing the text | Owner's brief supplied the personality; the safe substitutions are listed in this row's notes above |
| IP-05 | RESEARCH.md is factual research, not copied assets | Kept: it is background documentation with inline citations, and it ships nothing — no image, audio or video asset from any work exists in the repository | `RESEARCH.md` | VERIFIED | asset audit | `git ls-files` contains no audio/image assets; the research doc is the only place franchise names appear, and it is not product branding | Deliberate decision, recorded |

---

## Residual risk summary

| Risk | Severity | Status |
|---|---|---|
| IP: the product name and identity reference a trademarked property | High | Open — needs the owner's decision (PLAY-02, IP-03) |
| No Android build exists yet, so every Android row is unproven | High | In progress (ANDROID-01) |
| Audio/LED sync and real-microphone behaviour unmeasured | Medium | Blocked on a device session (AUDIO-05, QA-05) |
| Rate-limit store is per-process on serverless hosts | Medium | Documented; needs a shared store for multi-instance (SEC-06) |
| Custom compatible endpoints are disabled, so some power users lose their own gateway | Low | Accepted, deliberate (AI-03) |

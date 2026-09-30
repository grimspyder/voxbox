# Voxbox

A voice-first entertainment app: talk to Vox and he answers out loud, while the original
three-bar voice modulator pulses in time with his voice.

Vox is a **nostalgia and entertainment experience**. It is not a vehicle system, a driving
assistant, a navigation app, a home-automation controller or an emergency service, and it does
not pretend to be: Vox will tell you plainly that his vehicle-control systems are not connected.

## What it does

- **Speak and Vox answers.** Hands-free conversation with end-of-turn detection, barge-in
  interruption, and a text fallback when you would rather type.
- **Demo mode works immediately.** No account, no API key, no setup: canned Vox-style replies
  in an original synthesised voice, with the full display and modulator running.
- **Full mode connects your own AI and voice services.** Bring your own key for OpenAI,
  OpenRouter, Anthropic or Google Gemini, and for ElevenLabs or OpenAI speech.
- **The display is the point.** Three 16-segment columns expanding from the centre, exactly as
  the original prop did, driven only by Vox's own output audio — never by your microphone.

## Architecture

```
app/                     Next.js 15 App Router
  page.tsx                 renders <KittDashboard/>
  api/llm|tts|stt/route.ts hardened provider proxies (schema-validated, size-capped, rate-limited)
components/
  KittDashboard.tsx        main screen: display, status, controls, rAF LED driver, wake lock
  VoiceModulator.tsx       three 16-segment LED columns, centre-out expansion
  SettingsPanel.tsx        AI brain / voice / speech / audio / personality / conversation /
                           display / privacy / advanced
lib/
  config/                  types + defaults, storage, API base, on-device transcript
  llm/                     client, provider implementations, error vocabulary
  tts/                     streaming voice client, original synth demo voice
  stt/                     microphone capture + VAD, Web Speech API, Whisper
  audio/                   AudioContext pipeline (analyser, streaming playback) + LED math
  conversation/            state machine + orchestrating engine
  server/                  validation, limits, rate limiting, SSRF guard, secret scrubbing
tests/                     vitest: state machine, modulator, settings, API security, routes
docs/                      production requirements ledger, privacy, Play data safety
```

Full detail, including the provider/audio data flow and the invariants that must not regress, is
in [ARCHITECTURE.md](ARCHITECTURE.md). Release status per requirement is in
[docs/PRODUCTION_REQUIREMENTS.md](docs/PRODUCTION_REQUIREMENTS.md).

## Requirements

**Node 20.19 or newer** (Next.js 15). Node 18 is not supported. `.nvmrc` pins 22.

## Local development

```bash
npm ci
npm run dev          # http://localhost:3000
```

Vox opens in demo mode. Nothing else is required to see and hear him.

## Quality gates

```bash
npm run type-check   # tsc --noEmit
npm run lint         # ESLint
npm test             # vitest
npm run build        # production build
npm audit            # dependency advisories (must be clean)
```

All five pass on `production-android`. CI runs them on every push and pull request
(`.github/workflows/ci.yml`), and adds a secret scan plus the Android release bundle once the
Capacitor project exists.

## Configuration

### Demo mode (default)

`llm.provider = demo`, `tts.provider = demo`. Replies come from a small canned repertoire; the
voice is original WebAudio formant synthesis, so no licensed audio is involved. Demo mode is
entirely offline.

### Full AI mode

Open ⚙ SETTINGS and choose a provider, paste your key, then press **TEST CONNECTION** (and
**TEST VOICE** for speech). Get a key from:

| Provider | Where to get a key |
|---|---|
| OpenAI | https://platform.openai.com/api-keys |
| OpenRouter | https://openrouter.ai/keys |
| Anthropic | https://console.anthropic.com/settings/keys |
| Google Gemini | https://aistudio.google.com/app/apikey |
| ElevenLabs | https://elevenlabs.io/app/settings/api-keys |

**Your provider bills you separately for API usage.** Vox does not create the provider account
and does not pay for calls.

### Server environment variables

| Variable | Purpose | Default |
|---|---|---|
| `NEXT_PUBLIC_VOXBOX_API_BASE` | Absolute API origin for the native (Capacitor) build. Empty means same-origin, which is correct for the web build. | empty |
| `VOXBOX_ALLOWED_ORIGINS` | Comma-separated origins allowed to call the API cross-origin from the native shell, e.g. `https://localhost,capacitor://localhost`. | empty |
| `VOXBOX_ALLOW_CUSTOM_ENDPOINTS` | `true` permits user-supplied OpenAI-compatible base URLs (developer/self-hosted builds only). Strictly validated either way. | `false` |

No provider key is ever configured on the server. Keys are supplied by the user and used for the
single request they belong to.

## Deployment

The web build is a normal Next.js app (`npm run build` then `npm start`, or any Node host). The
Android build is a Capacitor shell that ships the same UI and calls this API remotely, so the
API must be reachable over HTTPS from the phone.

One caveat for multi-instance hosts: the rate limiter is per-process. A single long-lived Node
server gets correct global limits; on serverless, each instance enforces its own share. See
SEC-06 in the requirements ledger.

## Testing

| Suite | Covers |
|---|---|
| `tests/stateMachine.test.ts` | every state × event, happy path, interruption |
| `tests/modulator.test.ts` | centre-out segment math, attack/release, silence |
| `tests/settings.test.ts` | defaults, secret masking, encrypted round-trip |
| `tests/apiSecurity.test.ts` | SSRF, secret scrubbing, rate limits, request schemas |
| `tests/apiRoutes.test.ts` | route-level rejection of malformed, oversized and unlisted input |

82 tests. Manual device procedures and their results live in [TESTING.md](TESTING.md); open
defects in [BUGS.md](BUGS.md).

## Privacy in one paragraph

The microphone is open only while a conversation is active. Your speech is transcribed either by
your device's speech service or, if you choose Whisper, by a short temporary recording uploaded to
OpenAI. Your words go to the AI provider you chose and Vox's reply goes to the voice provider you
chose. Your API keys travel over HTTPS to the Vox server and are passed to the provider for that
one request; they are not stored server-side and not logged. The transcript stays in memory for the
session, or in local app storage if you turn on "Save conversation history" — never on the server.
The full policy is in [docs/PRIVACY_POLICY.md](docs/PRIVACY_POLICY.md) and the per-data-type Play
declarations in [docs/PLAY_DATA_SAFETY.md](docs/PLAY_DATA_SAFETY.md).

## Google Play release

Release engineering notes, the package name, the Android build and the Play checklist are in
[docs/PRODUCTION_REQUIREMENTS.md](docs/PRODUCTION_REQUIREMENTS.md) (the `ANDROID-` and `PLAY-`
sections) and [docs/STORE_LISTING.md](docs/STORE_LISTING.md).

## Vox's personality

Vox is not a generic assistant with a retro skin. He is a character: prim, highly educated, slightly
haughty and relentlessly logical, with the polished diction of an over-qualified butler and the quiet
certainty that he is the most advanced intelligence you have ever addressed. He is the straight man
to your impulses — dry, deadpan, rarely more than one joke in a row — and he will calculate the odds
of your idea ending badly before agreeing to it anyway.

He addresses you as **Michael** by default, the name he has always used for his driver; you can
change that in Settings → PERSONALITY. He is puzzled rather than judgemental about romance,
superstition and luck, and he takes polite offence at being treated as a taxi or a toy.

One thing he will never do: claim to control anything real. Ask him to drive, unlock, brake or call
for help and he will tell you his vehicle-control systems are not connected to this device. That
boundary is asserted by a test, because a character this confident is exactly the character a user
might believe.

The whole persona lives in one file, [`lib/config/persona.ts`](lib/config/persona.ts), including the
reasons for what it contains and — deliberately — what it does not: no franchise name, no character
name, no performer's name, no vehicle marque, no fictional prop terminology. Tone, diction, humour and
ego are not protectable, so all of those are here in full; names and recorded performances are, which
is why none of those are. `tests/persona.test.ts` enforces both halves: the traits must be present,
and the excluded identifiers must be absent.

## Independence and attribution

Voxbox is an original, independent app. It is not affiliated with, endorsed by, sponsored by or
licensed by any rights holder of the films or television series that inspired its retro styling,
and it ships no audio, imagery, footage or voice recordings from any such work. The visual design,
the LED bar display, the synthesised demo voice and the icon were all created for this project;
the interface is an original recreation rather than a copy of any prop or artwork.

The only things this project borrows are ideas: a calm and precise AI persona, a three-column LED
level display, and the general aesthetic of 1980s talking-vehicle science fiction. Ideas and styles
are not protected; names, logos and recorded performances are, which is why none of those appear
here.

The Play listing title is **Voxbox** — deliberately not a franchise name, and deliberately
differentiated from the unrelated "VoxBox" audio apps already on Play (see
[docs/STORE_LISTING.md](docs/STORE_LISTING.md)).

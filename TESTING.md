# TESTING.md — Test Plan & Results

## Automated (vitest, `npx vitest run`) — 18/18 PASS

| Suite | Covers | Status |
|-------|--------|--------|
| stateMachine.test.ts | All 7 states × 10 events; happy path; interruption path; invalid-event robustness; history | PASS |
| modulator.test.ts | Silence→0; energy rise; release decay; dt-proportional release; center-bar prominence; no motion on mic silence; center-out segment mapping; clamping | PASS |
| settings.test.ts | Defaults; secret masking; secrets stripped from localStorage; encrypted save/load roundtrip | PASS |

Build gates: `next build` (compile+lint+types) · `npx tsc --noEmit` — both clean at last commit.

## API-level verification (curl)

| Check | Result |
|-------|--------|
| OpenRouter chat completion (key + `openai/gpt-4o-mini`) | 200, "ONLINE" |
| ElevenLabs TTS (`Vox V1` voice) | 200, 33 KB MP3 |

## Browser E2E (production server, Playwright-driven Chrome)

| # | Scenario | Result |
|---|----------|--------|
| 1 | App renders dashboard: labels, pills, 3×16 segments | PASS (screenshot vs reference) |
| 2 | START CONVERSATION → LISTENING (mic-denied reported, text input stays usable) | PASS |
| 3 | TEST CONNECTION (OpenRouter) | PASS "Connection successful" |
| 4 | TEST VOICE (ElevenLabs Vox V1) | PASS "Voice test complete" |
| 5 | Text utterance → THINKING → SPEAKING | PASS — 2.0s (OpenRouter), 3.0s (ElevenLabs configured) |
| 6 | Spoken response ends → returns to IDLE/OFFLINE | PASS |
| 7 | INTERRUPT during SPEAKING → immediate stop | PASS |
| 8 | Transcript renders interim + final turns | PASS |
| 9 | Settings persist (provider, model, voice, display) | PASS |
| 10 | TEST LEDS: bars pulse center-out, center leads, settle to 0 | PASS (DOM sampling) |
| 11 | TEST LEDS off → bars return to idle within a frame | PASS (rAF loop live) |

## TODO (requires real-browser/user session)

- [ ] Microphone voice-input E2E (hands-free end-of-turn, push-to-talk)
- [ ] Audible TTS playback + audio→LED sync latency measurement (<50 ms target)
- [ ] Phone portrait/landscape layout check
- [ ] Full-screen mode + wake lock
- [ ] Invalid-key error paths against live providers (deliberate bad key)
- [ ] Conversation history growth/clear cycle

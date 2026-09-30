# TODO — KITT-AI-Assistant

Re-audited against `production-android` on 2026-09-30. Requirement IDs refer to
`docs/PRODUCTION_REQUIREMENTS.md`.

## Done

- [x] Scaffold, repo, CI-relevant gates (build/lint/tsc/test)
- [x] KITT dashboard replica (labels, pills, 3×16-segment modulator, centre-out)
- [x] Provider abstractions: LLM (OpenAI/OpenRouter/Anthropic/Gemini/OpenAI-compatible/demo),
      TTS (ElevenLabs/OpenAI/browser/demo), STT (browser/Whisper)
- [x] Server-side key proxying, encrypted secret storage, masked UI
- [x] Streaming LLM → sentence queue → streaming TTS (first sentence before stream completes)
- [x] State machine + interruption/barge-in
- [x] Demo mode (no API required)
- [x] TEST CONNECTION / TEST VOICE / TEST LEDS / TEST MICROPHONE
- [x] Next.js 14.2.35 → 15.5.26, vitest 3 → 5; `npm audit` clean (PERF-04)
- [x] Runtime validation, size caps, rate limits and SSRF protection on all three proxies (SEC-01..04)
- [x] Credential scrubbing and consumer-worded provider errors (SEC-05, AI-05)
- [x] Privacy copy corrected to match real behaviour; save-history implemented (PRIVACY-01/02)
- [x] Clear conversation history + reset KITT setup controls (PRIVACY-03)
- [x] CI workflow with a secret scan and a gated Android job (PERF-05)
- [x] README rewritten for a real project (brief §80)
- [x] RESEARCH.md, BUGS.md, TESTING.md, ARCHITECTURE.md maintained

## Open — next in the work order

- [ ] First-run welcome screen and setup wizard (SETUP-01..15)
- [ ] Provider cards, default models, key-entry UX, provider help links (SETUP-04..09)
- [ ] One OpenAI key reused for AI, voice and Whisper (SETUP-10)
- [ ] ElevenLabs voice list instead of a pasted UUID (SETUP-11)
- [ ] System check + post-setup health screen (SETUP-13/14)
- [ ] Advanced Settings reclassification (SETUP-15)
- [ ] Mobile: 6 widths, portrait/landscape, safe areas, 44 px touch targets, decluttered main screen
      (MOBILE-01..06)
- [ ] Android: Capacitor shell, package `com.grimspyder.kittassistant`, signed AAB, minimal
      permissions (ANDROID-02..10)
- [ ] Native Android speech recognition adapter (STT-01/02)
- [ ] Keystore-backed credential storage and the re-entry story (SEC-09/10)
- [ ] In-app AI response reporting with disclosure and confirmation (PRIVACY-06/07)
- [ ] Privacy policy and Play Data Safety documentation (PRIVACY-04/05)
- [ ] IP/branding review and store listing checkpoint (PLAY-02, PLAY-04)
- [ ] Wizard, conversation and real-device test suites (QA-02, QA-04..06)

## Open — needs a real device or the owner

- [ ] Audible TTS → LED synchronisation measurement, <50 ms target (AUDIO-05, B-06)
- [ ] 'first-audio' latency readout is blank because the live path never records first playback (B-09)
- [ ] Push-to-talk is a no-op (STT-08, B-08)
- [ ] Audio focus, Bluetooth routing, lifecycle recovery, battery measurement (AUDIO-03/04, ANDROID-10/11)
- [ ] Play developer verification, package registration, internal then closed testing (PLAY-08..11)
- [ ] Shared rate-limit store if the API is ever run multi-instance (SEC-06)

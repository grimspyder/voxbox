# ARCHITECTURE.md

## Stack
Next.js 14 (App Router) · TypeScript · React 18 · Web Audio API · Web Speech API · Vitest/jsdom. Node 18.

## Layout

```
app/
  page.tsx                 → renders <KittDashboard/>
  layout.tsx, globals.css  → black theme, LED CSS vars
  api/llm/route.ts         → server LLM proxy (OpenAI-compatible, OpenRouter, Anthropic, Gemini); streams NDJSON {t}|{e}
  api/tts/route.ts         → server TTS proxy (ElevenLabs, OpenAI); streams audio/mpeg
  api/stt/route.ts         → server Whisper transcription proxy
components/
  KittDashboard.tsx        → main screen: replica layout + status + controls + rAF LED driver
  VoiceModulator.tsx       → three 16-segment LED columns, center-out expansion
  SettingsPanel.tsx        → drawer: AI BRAIN / VOICE / SPEECH / AUDIO / PERSONALITY / CONVERSATION / DISPLAY / PRIVACY / ADVANCED
lib/
  config/settings.ts       → types, defaults, Vox system prompt, prompt assembly
  config/storage.ts        → settings persistence; AES-GCM-encrypted secrets (device key)
  llm/types.ts             → LLMProvider/TTSProvider/STTProvider interfaces, KITTError, friendly errors
  llm/client.ts            → browser-side client (calls /api/llm; demo handled locally)
  llm/providers/*          → openai, anthropic (SSE), gemini (SSE), demo (canned, streams on timers)
  tts/client.ts            → speak(): ElevenLabs/OpenAI via proxy; browser SpeechSynthesis; demo vocoder synth (original, WebAudio formants)
  stt/mic.ts               → getUserMedia + adaptive-threshold VAD + end-of-turn + barge-in detection + MediaRecorder capture
  stt/stt.ts               → Web Speech API wrapper; Whisper upload
  audio/pipeline.ts        → AudioContext, AnalyserNode, streaming MediaSource playback, band energies, RMS
  audio/modulator.ts       → pure bar-level math: bands→{left,center,right}, attack/release, noise floor, center-out segments
  conversation/
    stateMachine.ts        → DISCONNECTED/IDLE/LISTENING/PROCESSING/SPEAKING/INTERRUPTED/ERROR + event table
    engine.ts              → orchestrator: listen→transcribe→stream LLM→sentence queue→TTS pump→interruption
tests/                     → vitest unit tests (state machine, modulator math, settings/crypto)
```

## Data flow (spoken turn)

```
mic → VAD (adaptive threshold) → utterance blob
    → /api/stt (Whisper) [or Web Speech API directly]
    → /api/llm stream → sentence splitter (terminator+whitespace boundary) → speakQueue
    → pumpTTS: /api/tts stream → MediaSource → <audio> → MediaElementSource → AnalyserNode → gain → speakers
    → rAF loop: analyser bands/RMS → computeBarLevels (attack/release) → center-out LED segments
```

## Key invariants
- **Only Vox's output audio reaches the display analyser.** Mic audio gets its own analyser (input meter/VAD only).
- Bars expand **from the center** of each column — never bottom-up.
- Provider keys are used **server-side only**; stored device-local, AES-GCM encrypted when "remember" is on; masked in UI.
- State transitions go through the machine table; invalid events are ignored, never scatter booleans.
- Interruption: user speech (autoInterrupt) or INTERRUPT button aborts the LLM fetch, stops playback, clears the queue, returns to LISTENING.

## Fidelity decisions (see RESEARCH.md)
- 16 segments per bar (16-segment bargraph replicas); dark red `#5c0808` inactive, bright red `#ff1a1a` active.
- Center bar tracks overall vocal energy (most active); left = low band, right = high band.
- Season-2+ labels: AIR/OIL/P1/P2 · S1/S2/P3/P4 · AUTO CRUISE · NORMAL CRUISE · PURSUIT, per reference image.
- Demo voice = original WebAudio formant synthesis (no copyrighted samples).

## Demo mode
`provider: demo` (default) needs no keys: canned Vox-flavoured replies streamed on timers, original synth voice, full display/LED functionality. Banner states cloud AI isn't connected.

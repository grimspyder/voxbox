# BUGS.md — Defect Tracking

Severity: P0 app unusable · P1 critical Vox experience broken · P2 important functionality broken · P3 cosmetic

Re-audited against `production-android` on 2026-09-30. Fixed entries keep their commit hash; entries
that were still open at that audit are marked with the audit date so nothing is preserved on trust.

| ID | Sev | Description | Repro | Expected | Actual | Status |
|----|-----|-------------|-------|----------|--------|--------|
| B-01 | P1 | Conversation stalls in THINKING; TTS never starts | Send any text; reply streams but never speaks | First sentence queues and speaks while streaming | Sentence boundaries forming across stream chunks were consumed by the splitter, so the queue stayed empty | **FIXED** (7742082) |
| B-02 | P1 | TEST VOICE hangs 60s+ | Click TEST VOICE in an autoplay-blocked browser | Test resolves or reports error promptly | `el.play()` rejection was swallowed; final wait relied on a 60s timeout | **FIXED** (7435ff0) |
| B-03 | P2 | Mic-permission denial put machine in ERROR, dead-ending text input | Start conversation in a no-mic browser; mic denied | Error shown, text input still usable | Machine entered ERROR; text sends ignored | **FIXED** (7742082) |
| B-04 | P2 | Stale `npm start` servers serve old chunks, mimicking code bugs | Rebuild while a previous prod server still holds port 3000 | New build served | Old build served from orphaned node.exe process | **OPEN** — environment/tooling; kill orphan node processes before verifying |
| B-05 | P2 | Voice-modulator bars untestable without a real audio session | Open app in an automation browser; start conversation; no LED motion | Need a way to verify the render path | AnalyserNode gets no samples while AudioContext is suspended | **MITIGATED** — TEST LEDS synthetic mode drives the identical render path without audio |
| B-06 | P3 | Audio-to-LED sync latency unmeasured on real hardware | Speak with real TTS audio; compare envelope vs LED frames | <50 ms perceived error | Cannot be measured in a suspended-context browser | **OPEN** — requires a real-device session (AUDIO-05 in the ledger) |
| B-07 | P3 | Selected microphone is not honoured by browser speech recognition | Select a mic in Settings → AUDIO, then speak | Selected mic used | The Web Speech API exposes no device selector; Whisper and the mic test do honour the selection | **OPEN (P3)** — documented in the AUDIO tab; not fixable in the web build, revisit with native speech recognition (STT-01) |
| B-08 | P2 | Push-to-talk setting has no effect | Enable push-to-talk; hold and release the control | The captured utterance is transcribed on release | `ConversationEngine.pushToTalkCommit()` is a stub that stops the recorder and waits | **OPEN (found 2026-09-30)** — remove the setting or implement it; tracked as STT-08 |
| B-09 | P3 | "first-audio" latency readout can never appear | Have a spoken reply; watch the status line for `first-audio` | The measured time from end of speech to first audio | `LatencyTrace.firstPlayback` is never assigned on the live playback path, so the readout stays blank | **OPEN (found 2026-09-30)** |
| B-10 | P2 | Privacy text claimed audio is never recorded | Settings → PRIVACY | Copy matching real behaviour | The Whisper path captures a temporary recording and uploads it, so the claim was false | **FIXED (2026-09-30)** — PRIVACY now distinguishes temporary processing from persistent storage; ledger PRIVACY-01 |
| B-11 | P2 | "Save conversation history" did nothing | Enable the option, reload | Transcript restored | `saveHistory` was read by no code path | **FIXED (2026-09-30)** — transcript is now stored on-device (local app storage) and restorable, with CLEAR CONVERSATION HISTORY; ledger PRIVACY-02 |
| B-12 | P3 | TODO.md listed fullscreen and wake lock as open though both were implemented | Read TODO.md | Accurate status | Stale entries | **FIXED (2026-09-30)** — TODO.md re-audited |
| B-13 | P1 | INTERRUPT did not silence the device voice | Choose the device voice, start a reply, press INTERRUPT | Speech stops immediately | Only the cloud-audio path was stopped: `speechSynthesis.cancel()` was never called, so the device voice kept talking over the user. A cancelled utterance also never fires `onend`, which left the TTS pump awaiting indefinitely | **FIXED (2026-09-30)** — `TTSClient.stop()` cancels synthesis *and* resolves the pending utterance; the engine calls it on interrupt, on stop, and at the start of each turn. `tests/conversation.test.ts` asserts the voice is actually cancelled rather than merely flagged, so this cannot regress silently |
| B-14 | P2 | Any microphone problem other than a permission denial parked the machine in ERROR | Use the app where the microphone is missing, blocked, or the API is absent | Problem reported, conversation still fully usable by text | B-03 fixed this for permission denials only. A missing device, a blocked device, or an environment without `mediaDevices` still produced SYSTEM FAULT and a status display stuck away from the conversation | **FIXED (2026-09-30)** — microphone-failure classification broadened to cover every "speech input unavailable" case; a test asserts a complete text turn finishes with no ERROR state |

## Release gate

No P0 defects. B-04 is environment/tooling. B-05 is mitigated. B-13 and B-14 were both found
by the new conversation tests rather than by inspection, and both are fixed with regression
coverage. B-06, B-07, B-08 and B-09 are open and owned by named ledger requirements. B-06 and
B-08 both need a real device, which arrives with the Android build.

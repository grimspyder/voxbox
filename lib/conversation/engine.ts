// Conversation orchestrator: mic → STT → LLM (streaming) → TTS with
// sentence-level streaming playback, interruption, state machine, latency trace.

import { KITTSettings, systemPromptFor } from '../config/settings';
import { LLMClient, Turn, buildMessages } from '../llm/client';
import { TTSClient } from '../tts/client';
import { AudioPipeline } from '../audio/pipeline';
import { MicCapture } from '../stt/mic';
import { BrowserRecognition, whisperTranscribe } from '../stt/stt';
import { MachineSnapshot, ConvEvent, step, initialState } from './stateMachine';
import { SelfEchoGuard } from './echoGuard';
import { friendlyProviderError } from '../llm/types';

/**
 * How long the microphone stays closed after Vox stops speaking.
 *
 * Playback ending is not the same as the room going quiet: the speaker tail, the
 * reverb, and on Android the audio still draining in the pipeline all arrive after
 * `onended`. Opening the recogniser immediately let Vox transcribe its own last
 * words as a user turn, which is how it ended up answering itself.
 */
export const POST_PLAYBACK_GUARD_MS = 700;

/** A genuine spoken interruption should not wait out the full playback guard. */
export const BARGE_IN_RESUME_MS = 180;

/** Sustained voice required before a barge-in is believed. */
export const BARGE_IN_MIN_MS = 420;

export interface LatencyTrace {
  utteranceEnd?: number;
  transcriptionDone?: number;
  llmFirstToken?: number;
  ttsFirstByte?: number;
  firstPlayback?: number;
}

export interface ConversationHandlers {
  onState?: (s: MachineSnapshot) => void;
  onTranscript?: (role: 'user' | 'assistant', text: string, interim?: boolean) => void;
  onLatency?: (t: LatencyTrace) => void;
  onError?: (message: string) => void;
  onMicrophoneReady?: () => void;
  /** Non-fatal, informational. Never parks the machine in ERROR. */
  onNotice?: (message: string) => void;
  /** A voice transcript was discarded because it was Vox hearing itself. */
  onEchoDropped?: (text: string) => void;
}

/**
 * Conditions where speech input is unavailable but the app remains fully usable
 * by text. These must never park the machine in ERROR.
 */
export function isMicrophoneProblem(message: string): boolean {
  return /microphone (permission (was )?denied|permission is blocked|unavailable|could not be opened|found|is blocked)|no microphone|does not support microphone capture/i.test(
    message,
  );
}

export class ConversationEngine {
  machine: MachineSnapshot = initialState();
  history: Turn[] = [];
  pipeline: AudioPipeline;
  latency: LatencyTrace = {};
  private settings: KITTSettings;
  private llm = new LLMClient();
  private tts: TTSClient;
  private mic = new MicCapture();
  private browserRec = new BrowserRecognition();
  private handlers: ConversationHandlers = {};
  private abort: AbortController | null = null;
  private speakQueue: string[] = [];
  private ttsBusy = false;
  private llmDone = false;
  private started = false;
  private micLevelCb: ((level: number) => void) | null = null;
  private permissionStream: MediaStream | null = null;
  private suppressRecognitionRestart = false;
  private echoGuard = new SelfEchoGuard();
  /** True from the moment a user turn starts until its playback has finished. */
  private turnActive = false;
  /** Bumped per turn so callbacks from a finished turn can be recognised and dropped. */
  private turnId = 0;
  /** Wall-clock time before which listening must not resume. */
  private guardUntil = 0;
  private listenTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether the microphone actually has echo cancellation, as reported by the device. */
  echoCancellationActive: boolean | null = null;
  private warnedAboutEcho = false;

  constructor(settings: KITTSettings) {
    this.settings = settings;
    this.pipeline = new AudioPipeline();
    this.tts = new TTSClient(this.pipeline);
    this.pipeline.onEnded = () => this.onPlaybackDrained();
  }

  updateSettings(s: KITTSettings): void {
    this.settings = s;
  }

  private dispatch(ev: ConvEvent): void {
    this.machine = step(this.machine, ev);
    this.handlers.onState?.(this.machine);
  }

  private err(message: string): void {
    // A microphone problem is reported but must not put the machine into ERROR:
    // the user can still type, and the status display should keep reflecting the
    // conversation rather than reading SYSTEM FAULT. B-03 fixed this for
    // permission denial only; the same dead end remained for a missing device, a
    // blocked device, and an environment with no mediaDevices API at all.
    if (isMicrophoneProblem(message)) {
      this.handlers.onError?.(message);
      if (this.machine.state === 'LISTENING') this.dispatch({ type: 'STOP_LISTENING' });
      return;
    }
    this.dispatch({ type: 'ERROR', message });
    this.handlers.onError?.(message);
  }

  async start(handlers: ConversationHandlers): Promise<void> {
    this.handlers = handlers;
    this.started = true;
    this.dispatch({ type: 'ACTIVATE' });
    this.pipeline.ensure();
    await this.listen();
  }

  isActive(): boolean {
    return this.started;
  }

  /**
   * May the microphone be open right now?
   *
   * One gate, consulted by every path that opens a recogniser or the mic. The
   * previous version tested the machine state inline in several places, which is
   * racy: the state machine deliberately tolerates idempotent re-entries, so a
   * text comparison against it can be true a few milliseconds after it stopped
   * being true. A single explicit flag cannot.
   */
  private canListen(): boolean {
    if (!this.started) return false;
    if (this.suppressRecognitionRestart) return false;
    if (this.turnActive) return false;
    if (this.speakQueue.length > 0 || this.ttsBusy) return false;
    if (this.machine.state === 'PROCESSING' || this.machine.state === 'SPEAKING') return false;
    if (Date.now() < this.guardUntil) return false;
    return true;
  }

  /** Re-open the microphone the moment the post-playback guard expires. */
  private scheduleListenAfterGuard(delayMs?: number): void {
    if (this.listenTimer) return;
    const wait = delayMs ?? Math.max(0, this.guardUntil - Date.now());
    this.listenTimer = setTimeout(() => {
      this.listenTimer = null;
      void this.listen();
    }, Math.max(0, wait));
  }

  /**
   * The turn is over: stop treating Vox's output as something the user might say,
   * and keep the microphone shut until the room has gone quiet.
   */
  private endTurn(guardMs = POST_PLAYBACK_GUARD_MS): void {
    this.turnActive = false;
    this.suppressRecognitionRestart = false;
    this.guardUntil = Date.now() + guardMs;
  }

  /** Begin listening for the next user utterance. */
  async listen(): Promise<void> {
    if (!this.canListen()) {
      // The common case for this branch is the post-playback guard. Without
      // rescheduling, a turn could end and nothing would ever listen again.
      if (
        this.started &&
        !this.turnActive &&
        !this.suppressRecognitionRestart &&
        this.machine.state !== 'SPEAKING' &&
        this.machine.state !== 'PROCESSING'
      ) {
        this.scheduleListenAfterGuard();
      }
      return;
    }
    const turn = this.turnId;
    this.dispatch({ type: 'START_LISTENING' });
    if (this.settings.stt.provider === 'browser') {
      if (!this.browserRec.supported) {
        this.err('This browser does not support speech recognition. Use Chrome or Edge, or switch Settings → SPEECH to OpenAI Whisper.');
        return;
      }
      try {
        // Explicitly request permission before Web Speech API. This makes the
        // browser prompt appear from the user's START click instead of silently
        // failing inside speech recognition.
        this.permissionStream?.getTracks().forEach((track) => track.stop());
        this.permissionStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: this.settings.mic.deviceId ? { exact: this.settings.mic.deviceId } : undefined, echoCancellation: this.settings.mic.echoCancellation, noiseSuppression: this.settings.mic.noiseSuppression, autoGainControl: this.settings.mic.autoGainControl } });
        this.reportEchoCancellation(this.permissionStream);
        this.handlers.onMicrophoneReady?.();
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        if (name === 'NotFoundError') {
          this.err('No microphone found. Connect a microphone and choose it in Settings → AUDIO.');
        } else if (name === 'NotAllowedError' || name === 'SecurityError') {
          this.err('Microphone permission was blocked. Click the lock icon beside the address, set Microphone to Allow, then reload.');
        } else {
          this.err('Microphone could not be opened: ' + (e instanceof Error ? e.message : String(e)));
        }
        return;
      }
      this.browserRec.start({
        onResult: (text, isFinal) => {
          // Ignore callbacks from a recognizer that ended as the turn began.
          if (turn !== this.turnId || !this.canListen()) return;
          this.handlers.onTranscript?.('user', text, !isFinal);
          if (isFinal && text.trim()) {
            this.suppressRecognitionRestart = true;
            void this.handleUtterance(text.trim(), 'voice');
          }
        },
        onError: (m) => this.err(m),
        onEnd: () => {
          if (turn !== this.turnId || this.suppressRecognitionRestart) return;
          if (this.machine.state === 'LISTENING' && !this.ttsBusy) {
            this.dispatch({ type: 'STOP_LISTENING' });
            // Auto-restart only after a genuine idle recognition end. listen()
            // applies the guard, so this cannot reopen onto Vox's own tail.
            this.scheduleListenAfterGuard(250);
          }
        },
      });
    } else {
      try {
        await this.mic.start(
          {
            onUtterance: (blob) => {
              if (turn !== this.turnId) return;
              void this.transcribeBlob(blob);
            },
            onLevel: (l) => this.micLevelCb?.(l),
            // A spoken interruption, as opposed to the INTERRUPT button. It gets a
            // shorter guard because the user is already mid-sentence.
            onBargeIn: () => this.interrupt(true),
            onError: (m) => this.err(m),
          },
          {
            deviceId: this.settings.mic.deviceId,
            echoCancellation: this.settings.mic.echoCancellation,
            noiseSuppression: this.settings.mic.noiseSuppression,
            autoGainControl: this.settings.mic.autoGainControl,
            handsFree: this.settings.mic.handsFree,
            autoInterrupt: this.settings.mic.autoInterrupt,
            bargeInMinMs: BARGE_IN_MIN_MS,
            playbackLevel: () => (this.pipeline.hasOutput ? this.pipeline.rms() : 0),
          },
        );
        this.echoCancellationActive = this.mic.echoCancellationGranted();
        this.reportEchoCancellation();
      } catch (e) {
        this.err(friendlyProviderError(e));
      }
    }
  }

  /**
   * Whether a spoken barge-in can be trusted on this device.
   *
   * Without echo cancellation the microphone hears Vox's own speaker, so any
   * energy-based interruption fires on Vox's voice and cuts the reply off
   * mid-sentence. Requiring a confirmed `echoCancellation: true` from the device
   * is what keeps the feature from being a self-interrupt button.
   */
  private bargeInAvailable(): boolean {
    return this.settings.mic.autoInterrupt && this.echoCancellationActive === true;
  }

  /** Record and, once, explain what the device granted for echo cancellation. */
  private reportEchoCancellation(stream?: MediaStream): void {
    if (stream) {
      try {
        const settings = stream.getAudioTracks?.()[0]?.getSettings?.() as { echoCancellation?: boolean } | undefined;
        this.echoCancellationActive = typeof settings?.echoCancellation === 'boolean' ? settings.echoCancellation : null;
      } catch {
        this.echoCancellationActive = null;
      }
    }
    if (this.warnedAboutEcho) return;
    if (!this.settings.mic.autoInterrupt) return;
    if (this.echoCancellationActive === true) return;
    this.warnedAboutEcho = true;
    this.handlers.onNotice?.(
      this.echoCancellationActive === false
        ? 'This device does not provide echo cancellation, so automatic interruption is off — otherwise Vox hears its own speaker and interrupts itself. Use the INTERRUPT button, or headphones.'
        : 'This device did not report whether echo cancellation is active, so automatic interruption is off until it can be confirmed. Use the INTERRUPT button, or headphones.',
    );
  }

  private async transcribeBlob(blob: Blob): Promise<void> {
    this.latency.utteranceEnd = performance.now();
    this.dispatch({ type: 'SUBMIT_UTTERANCE' });
    try {
      const text = await whisperTranscribe(blob, this.settings.stt);
      this.latency.transcriptionDone = performance.now();
      if (text.trim()) await this.handleUtterance(text.trim(), 'voice');
      else void this.listen();
    } catch (e) {
      this.err(friendlyProviderError(e));
    }
  }

  /**
   * Handle a completed user utterance.
   *
   * `source` matters: a transcript from the microphone might be Vox hearing
   * itself, and that must never reach the model, while text the user actually
   * typed must never be second-guessed.
   */
  async handleUtterance(text: string, source: 'text' | 'voice' = 'text'): Promise<void> {
    if (!text.trim() || !this.started) return;

    // Backstop for whatever survived the turn gate: if the transcript is what Vox
    // was just saying, it came from the speaker, not from the user. Answering it
    // is how Vox ended up replying to things nobody said.
    if (source === 'voice' && this.echoGuard.isEcho(text)) {
      this.handlers.onEchoDropped?.(text);
      this.guardUntil = Date.now() + POST_PLAYBACK_GUARD_MS;
      this.scheduleListenAfterGuard();
      return;
    }

    this.turnId += 1;
    this.turnActive = true;
    this.guardUntil = 0;
    this.suppressRecognitionRestart = true;
    this.browserRec.stop();
    this.pipeline.stop(); // in case anything is playing
    this.tts.stop(); // ...and silence any device voice still speaking
    this.speakQueue = [];
    this.ttsBusy = false;
    this.llmDone = false;
    this.consideredStart = 0;
    this.latency = { utteranceEnd: performance.now() };
    this.dispatch({ type: 'SUBMIT_UTTERANCE' });
    this.handlers.onTranscript?.('user', text);
    this.history.push({ role: 'user', content: text });

    this.abort = new AbortController();
    let full = '';
    let firstTokenSeen = false;

    try {
      for await (const chunk of this.llm.streamChat(
        buildMessages(systemPromptFor(this.settings), this.history),
        {
          provider: this.settings.llm.provider,
          apiKey: this.settings.llm.apiKey,
          model: this.settings.llm.model,
          baseUrl: this.settings.llm.baseUrl || undefined,
          temperature: this.settings.llm.temperature,
          maxTokens: this.settings.llm.maxTokens,
        },
        this.abort.signal,
      )) {
        full += chunk;
        if (!firstTokenSeen) {
          firstTokenSeen = true;
          this.latency.llmFirstToken = performance.now();
        }
        this.handlers.onTranscript?.('assistant', full, true);
        this.queueFrom(full, false);
      }
      this.llmDone = true;
      this.queueFrom(full, true); // flush tail
      if (full.trim()) {
        this.history.push({ role: 'assistant', content: full.trim() });
        this.handlers.onTranscript?.('assistant', full.trim(), false);
      }
      if (!this.ttsBusy && this.speakQueue.length === 0) {
        // provider returned nothing speakable
        this.dispatch({ type: 'PLAYBACK_ENDED' });
        this.endTurn();
        void this.listen();
      }
      void this.pumpTTS();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (e instanceof Error && e.name === 'AbortError') return;
      // The turn is over even though it failed; without clearing the turn gate a
      // later listen() would refuse to open and the app would look dead.
      this.endTurn();
      this.err(friendlyProviderError(e));
    }
  }

  private consideredStart = 0;

  /** Queue complete sentences from newly arrived text.
   A sentence is only consumed once a terminator [.!?] is FOLLOWED by whitespace
   (or text is final). The un-consumed remainder is re-examined on the next chunk,
   so boundaries that form across chunk edges are never lost. */
  private queueFrom(text: string, final: boolean): void {
    const region = text.slice(this.consideredStart);
    if (!region) {
      if (final) this.consideredStart = text.length;
      return;
    }
    // Find the last terminator-followed-by-whitespace boundary in the region.
    const boundary = /([.!?])(\s+)/g;
    let lastEnd = -1;
    let m: RegExpExecArray | null;
    while ((m = boundary.exec(region)) !== null) {
      lastEnd = m.index + m[1].length; // position just past the terminator
    }
    if (lastEnd === -1) {
      // No complete sentence yet.
      if (final) {
        const t = region.trim();
        if (t) this.speakQueue.push(t);
        this.consideredStart = text.length;
      }
      return;
    }
    const sentence = region.slice(0, lastEnd).trim();
    if (sentence) this.speakQueue.push(sentence);
    this.consideredStart += lastEnd;
    // Recurse to catch multiple completed sentences in this region.
    this.queueFrom(text, final);
  }

  private async pumpTTS(): Promise<void> {
    if (this.ttsBusy) return;
    this.ttsBusy = true;
    while (this.speakQueue.length > 0) {
      const seg = this.speakQueue.shift()!;
      if (this.abort?.signal.aborted) break;
      if (this.machine.state !== 'SPEAKING') {
        this.dispatch({ type: 'RESPONSE_STARTED' });
        this.latency.ttsFirstByte = performance.now();
        this.handlers.onLatency?.({ ...this.latency });
      }
      // Remember exactly what is about to become audible, so a transcript of the
      // speaker output can be recognised as ours and dropped.
      this.echoGuard.record(seg);
      if (this.bargeInAvailable()) {
        this.mic.bargeInArmed = true;
      }
      try {
        if (this.settings.tts.provider === 'browser') {
          await this.tts.speakBrowserWithEnd(seg, this.settings.tts);
        } else {
          await this.tts.speak(seg, this.settings.tts, this.abort?.signal);
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') break;
        this.err(friendlyProviderError(e));
        break;
      }
    }
    this.ttsBusy = false;
    this.mic.bargeInArmed = false;
    if (this.llmDone && this.speakQueue.length === 0 && this.machine.state === 'SPEAKING') {
      this.dispatch({ type: 'PLAYBACK_ENDED' });
      this.endTurn();
      void this.listen();
    }
  }

  private onPlaybackDrained(): void {
    // pipeline.onEnded: stream/element playback finished naturally
  }

  /**
   * Stop speaking and hand the floor back to the user.
   *
   * `fromVoice` is true when the detector — not the button — decided the user was
   * talking. That is the one case where the microphone should reopen quickly,
   * because the user is already mid-sentence. The button gets the full
   * post-playback guard so Vox cannot answer its own trailing audio.
   */
  interrupt(fromVoice = false): void {
    this.abort?.abort();
    this.tts.stop(); // silence the device voice too, not only the cloud audio
    this.pipeline.stop();
    this.browserRec.stop();
    this.speakQueue = [];
    this.ttsBusy = false;
    this.llmDone = true;
    this.mic.bargeInArmed = false;
    // Anything still queued from the interrupted turn belongs to that turn.
    this.turnId += 1;
    this.dispatch({ type: 'INTERRUPTION_DETECTED' });
    this.endTurn(fromVoice ? BARGE_IN_RESUME_MS : POST_PLAYBACK_GUARD_MS);
    this.scheduleListenAfterGuard();
  }

  /** Push-to-talk release: transcribe what was captured. */
  async pushToTalkCommit(): Promise<void> {
    this.mic.stopRecording();
    await new Promise((r) => setTimeout(r, 200));
  }

  async sendText(text: string): Promise<void> {
    await this.handleUtterance(text);
  }

  newConversation(): void {
    this.history = [];
    this.echoGuard.clear();
  }

  setMicLevelCallback(cb: (level: number) => void): void {
    this.micLevelCb = cb;
  }

  stop(): void {
    this.abort?.abort();
    this.tts.stop();
    this.pipeline.stop();
    this.browserRec.stop();
    this.mic.stop();
    this.speakQueue = [];
    this.ttsBusy = false;
    this.turnActive = false;
    this.turnId += 1;
    if (this.listenTimer) {
      clearTimeout(this.listenTimer);
      this.listenTimer = null;
    }
    this.guardUntil = 0;
    this.started = false;
    this.dispatch({ type: 'DISCONNECT' });
  }
}
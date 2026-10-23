// Microphone capture + VAD + end-of-turn detection + barge-in detection.
// Mic audio NEVER connects to the Vox display analyser.

export interface MicHandlers {
  onUtterance?: (blob: Blob) => void;
  onLevel?: (level: number) => void; // 0..1, for input meter only
  onBargeIn?: () => void; // user started speaking while Vox talks
  onError?: (message: string) => void;
  onEndOfTurn?: () => void;
}

export interface MicOptions {
  deviceId?: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  handsFree: boolean;
  autoInterrupt: boolean;
  // energy threshold for end-of-turn (hands-free)
  silenceMs?: number;
  minSpeechMs?: number;
  /**
   * How long voiced energy must persist before barge-in is believed. Barge-in is
   * only ever armed with echo cancellation confirmed (see the engine): a detector
   * that fires on the first loud frame interrupts Vox with Vox's own voice.
   */
  bargeInMinMs?: number;
  /**
   * Current playback level, 0..1. Lets the detector require the microphone to be
   * clearly louder than what the app is already playing, so residual echo that
   * survived cancellation cannot be mistaken for the user.
   */
  playbackLevel?: () => number;
}

export class MicCapture {
  private stream: MediaStream | null = null;
  private recordingStream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private freq: Uint8Array = new Uint8Array(0);
  private buf: Float32Array = new Float32Array(0);
  private raf: number | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private handlers: MicHandlers = {};
  private opts: MicOptions | null = null;
  private speaking = false;
  private speechStart = 0;
  private lastVoiceTime = 0;
  private rmsHistory: number[] = [];
  private adaptiveThreshold = 0.02;
  private bargeCandidateSince = 0;
  active = false;
  /** While Vox is speaking, mic monitors for barge-in only (if enabled). */
  bargeInArmed = false;

  /**
   * Acquire the microphone and start the voice-activity loop.
   *
   * Idempotent on purpose. The engine calls this at the start of every listening
   * window, and the previous version re-acquired the device each time without
   * releasing it — a new getUserMedia stream, a new AudioContext and another
   * animation loop per turn, with the old loops still running and still armed.
   * Stale detectors firing during a later turn was one of the ways Vox ended up
   * interrupting itself.
   */
  async start(handlers: MicHandlers, opts: MicOptions): Promise<void> {
    this.handlers = handlers;
    this.opts = opts;
    if (this.active && this.stream) {
      // Already listening: adopt the new handlers/options and clear per-turn
      // state, but keep the stream and the recorder alive.
      this.reset();
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
          echoCancellation: opts.echoCancellation,
          noiseSuppression: opts.noiseSuppression,
          autoGainControl: opts.autoGainControl,
        },
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError') throw new Error('Microphone permission denied. Enable it in your browser settings to speak with me.');
      if (name === 'NotFoundError') throw new Error('No microphone found. Connect one and try again.');
      throw new Error('Microphone unavailable: ' + (e instanceof Error ? e.message : String(e)));
    }
    const Ctor: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    // Voice-focused monitoring path: remove rumble and very high-frequency
    // environmental noise before VAD. MediaRecorder still receives the raw
    // selected microphone stream for transcription compatibility.
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.frequency.value = 1450;
    this.filter.Q.value = 0.65;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.buf = new Float32Array(this.analyser.fftSize);
    const source = this.ctx.createMediaStreamSource(this.stream);
    const destination = this.ctx.createMediaStreamDestination();
    source.connect(this.filter).connect(this.analyser);
    // Record the filtered stream for Whisper so steady environmental noise is
    // reduced before transcription, while the original stream remains available
    // for browser speech recognition's own capture path.
    this.filter.connect(destination);
    this.recordingStream = destination.stream;
    this.active = true;
    this.loop();
  }

  /** MediaRecorder capture starts on speech detection (openVF style). */
  startRecording(): void {
    if (!this.stream || this.recorder) return;
    this.chunks = [];
    const captureStream = this.recordingStream ?? this.stream;
    try {
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      this.recorder = new MediaRecorder(captureStream, mime ? { mimeType: mime } : undefined);
    } catch {
      this.handlers.onError?.('Audio recording unsupported in this browser.');
      return;
    }
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' });
      this.recorder = null;
      if (blob.size > 800) this.handlers.onUtterance?.(blob);
    };
    this.recorder.start(250);
  }

  stopRecording(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }

  private loop = (): void => {
    if (!this.active || !this.analyser || !this.ctx) return;
    this.raf = requestAnimationFrame(this.loop);
    this.analyser.getFloatTimeDomainData(this.buf as unknown as Float32Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    const level = Math.min(1, rms * 4);
    this.handlers.onLevel?.(level);

    // adaptive noise threshold
    this.rmsHistory.push(rms);
    if (this.rmsHistory.length > 100) this.rmsHistory.shift();
    if (this.rmsHistory.length === 100) {
      const sorted = [...this.rmsHistory].sort((a, b) => a - b);
      const noise = sorted[Math.floor(sorted.length * 0.25)];
      this.adaptiveThreshold = Math.max(0.008, noise * 3);
    }

    // Require both sufficient energy and a voice-band spectral centroid.
    // Steady broadband/low-frequency noise can exceed RMS alone; speech has
    // sustained energy in the 300–3400 Hz region after the bandpass filter.
    this.analyser.getByteFrequencyData(this.freq as unknown as Uint8Array<ArrayBuffer>);
    let bandSum = 0;
    let bandPeak = 0;
    for (let i = 0; i < this.freq.length; i++) {
      const hz = (i * this.ctx.sampleRate) / (this.analyser.fftSize);
      if (hz >= 300 && hz <= 3400) {
        bandSum += this.freq[i];
        bandPeak = Math.max(bandPeak, this.freq[i]);
      }
    }
    const voiceBand = bandSum / Math.max(1, this.freq.length * 255);
    const th = this.adaptiveThreshold;
    const now = performance.now();
    const voiced = rms > th && voiceBand > 0.018 && bandPeak > 10;

    if (voiced && !this.speaking) {
      this.speaking = true;
      this.speechStart = now;
      this.lastVoiceTime = now;
      if (this.bargeInArmed && this.opts?.autoInterrupt) {
        // Loud is not enough. Our own voice reaches this microphone too, so a
        // barge-in has to be *held* and it has to be louder than what we are
        // already playing. Firing on the first frame is what made Vox interrupt
        // itself mid-sentence.
        this.bargeCandidateSince = now;
        return;
      }
      if (this.opts?.handsFree) this.startRecording();
    } else if (voiced && this.speaking) {
      this.lastVoiceTime = now;
    } else if (!voiced && this.speaking) {
      const silence = now - this.lastVoiceTime;
      const minSpeech = now - this.speechStart;
      if (this.opts?.handsFree && silence > (this.opts.silenceMs ?? 700) && minSpeech > (this.opts.minSpeechMs ?? 250)) {
        this.speaking = false;
        this.stopRecording();
        this.handlers.onEndOfTurn?.();
      }
      if (minSpeech > 10000) {
        this.speaking = false;
        this.stopRecording();
      }
    }

    // Barge-in, evaluated on every frame so the hold can be measured.
    if (this.bargeCandidateSince && voiced && this.bargeInArmed && this.opts?.autoInterrupt) {
      const held = now - this.bargeCandidateSince;
      if (held >= (this.opts.bargeInMinMs ?? 420) && this.exceedsPlayback(rms)) {
        this.bargeCandidateSince = 0;
        this.bargeInArmed = false;
        this.speaking = false;
        this.speechStart = 0;
        this.handlers.onBargeIn?.();
        return;
      }
    }
    if (!voiced) this.bargeCandidateSince = 0;
  };

  /**
   * Is the microphone loud enough that it cannot be our own speaker output?
   *
   * With echo cancellation confirmed working, the residual of our own voice is
   * far below the playback level, so requiring the microphone to exceed it keeps
   * genuine speech and rejects leakage. Where the level cannot be measured (a
   * device voice that plays outside the Web Audio graph) the bar is a multiple of
   * the adaptive noise floor instead — deliberately high, because guessing wrong
   * here means interrupting Vox with Vox.
   */
  private exceedsPlayback(rms: number): boolean {
    const level = this.opts?.playbackLevel?.() ?? 0;
    if (!(level > 0.005)) return rms > Math.max(this.adaptiveThreshold * 3, 0.03);
    return rms > level * 0.7 + 0.012;
  }

  /** Clear per-turn voice state. Never touches the stream or an active recording. */
  reset(): void {
    this.speaking = false;
    this.speechStart = 0;
    this.lastVoiceTime = 0;
    this.rmsHistory = [];
    this.bargeCandidateSince = 0;
    this.bargeInArmed = false;
  }

  /** True while an utterance is being captured, so the engine does not discard it. */
  get isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === 'recording';
  }

  /**
   * What the device actually granted for echo cancellation.
   *
   * Asked for is not the same as applied: browsers and Android WebViews silently
   * drop audio constraints they do not implement, and a mic without echo
   * cancellation hears the phone's own speaker. `null` means the device did not
   * report it, which must not be read as "yes".
   */
  echoCancellationGranted(): boolean | null {
    try {
      const track = this.stream?.getAudioTracks?.()[0];
      const settings = track?.getSettings?.() as { echoCancellation?: boolean } | undefined;
      if (settings && typeof settings.echoCancellation === 'boolean') return settings.echoCancellation;
      return null;
    } catch {
      return null;
    }
  }

  stop(): void {
    this.active = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.stopRecording();
    this.recordingStream?.getTracks().forEach((t) => t.stop());
    this.recordingStream = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.filter = null;
    this.freq = new Uint8Array(0);
  }
}

export async function listMics(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  } catch {
    return [];
  }
}
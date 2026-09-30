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
  active = false;
  /** While Vox is speaking, mic monitors for barge-in only (if enabled). */
  bargeInArmed = false;

  async start(handlers: MicHandlers, opts: MicOptions): Promise<void> {
    this.handlers = handlers;
    this.opts = opts;
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
        this.bargeInArmed = false;
        this.handlers.onBargeIn?.();
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
  };

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
// Web Audio source node for TTS playback with stream-first playback.
// Feeds the AnalyserNode that drives the voice modulator.

export interface LatencyMarks {
  synthStart?: number;
  firstByte?: number;
  firstPlayback?: number;
}

export class AudioPipeline {
  ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private currentSource: AudioBufferSourceNode | MediaElementAudioSourceNode | null = null;
  private currentMediaEl: HTMLAudioElement | null = null;
  private freqBuf: Uint8Array = new Uint8Array(0);
  private timeBuf: Float32Array = new Float32Array(0);
  onEnded: (() => void) | null = null;
  marks: LatencyMarks = {};

  ensure(): AudioContext {
    if (!this.ctx) {
      const Ctor: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.55;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 1;
      this.analyser.connect(this.gain);
      this.gain.connect(this.ctx.destination);
      this.freqBuf = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeBuf = new Float32Array(this.analyser.fftSize);
    }
    if (this.ctx.state === 'suspended') {
      // Autoplay policy: resume is best-effort. A user gesture (button click) normally
      // unlocks it; if the promise never resolves the synth still schedules and will
      // play when the context eventually runs. Never block the pipeline on it.
      void this.ctx.resume().catch(() => undefined);
      setTimeout(() => { void this.ctx?.resume().catch(() => undefined); }, 300);
    }
    return this.ctx;
  }

  setVolume(v: number): void {
    if (this.gain) this.gain.gain.value = Math.max(0, Math.min(1, v));
  }

  /** True once an output source is connected to the analyser. */
  get hasOutput(): boolean {
    return this.currentSource !== null;
  }

  /** RMS (0..1) of the audio currently flowing through the analyser. */
  rms(): number {
    if (!this.analyser || !this.hasOutput) return 0;
    // Float32 time-domain data; AudioContext.timeDomainFloat support via getFloatTimeDomainData
    this.analyser.getFloatTimeDomainData(this.timeBuf as unknown as Float32Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < this.timeBuf.length; i++) sum += this.timeBuf[i] * this.timeBuf[i];
    return Math.sqrt(sum / this.timeBuf.length);
  }

  /** Frequency magnitudes 0..255 per bin. */
  frequencies(): Uint8Array {
    if (!this.analyser) return this.freqBuf;
    this.analyser.getByteFrequencyData(this.freqBuf as unknown as Uint8Array<ArrayBuffer>);
    return this.freqBin();
  }

  private freqBin(): Uint8Array {
    return this.freqBuf;
  }

  /** Band energies normalized 0..1. low: 0-1000Hz, mid: 1000-3500, high: 3500-8000 */
  bands(): { low: number; mid: number; high: number } {
    if (!this.analyser || !this.ctx) return { low: 0, mid: 0, high: 0 };
    const data = this.frequencies();
    const nyquist = this.ctx.sampleRate / 2;
    const bins = data.length;
    const hzPerBin = nyquist / bins;
    const avg = (lo: number, hi: number): number => {
      const a = Math.floor(lo / hzPerBin);
      const b = Math.min(bins, Math.ceil(hi / hzPerBin));
      let s = 0;
      for (let i = a; i < b; i++) s += data[i];
      return s / 255 / Math.max(1, b - a);
    };
    return { low: avg(120, 1000), mid: avg(1000, 3500), high: avg(3500, 8000) };
  }

  stop(): void {
    const src = this.currentSource as AudioBufferSourceNode | null;
    try {
      src?.stop();
    } catch {
      /* already stopped */
    }
    if (this.currentMediaEl) {
      this.currentMediaEl.pause();
      this.currentMediaEl.src = '';
    }
    this.currentSource = null;
    this.currentMediaEl = null;
    this.onEnded?.();
  }

  private wireSource(node: AudioBufferSourceNode | MediaElementAudioSourceNode, el?: HTMLAudioElement): void {
    this.currentSource = node;
    this.currentMediaEl = el ?? null;
    if (this.analyser && this.gain) {
      node.connect(this.analyser);
    }
    if ('onended' in node) {
      (node as AudioBufferSourceNode).onended = () => {
        this.currentSource = null;
        this.currentMediaEl = null;
        this.onEnded?.();
      };
    }
  }

  /** Play a complete audio blob. Returns when playback finishes. */
  async playBlob(blob: Blob, volume = 1): Promise<void> {
    const ctx = this.ensure();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    await this.playBuffer(buf, volume);
  }

  async playBuffer(buf: AudioBuffer, volume = 1): Promise<void> {
    const ctx = this.ensure();
    this.setVolume(volume);
    this.marks.firstPlayback = performance.now();
    return new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      this.wireSource(src);
      src.onended = () => {
        this.currentSource = null;
        this.onEnded?.();
        resolve();
      };
      src.start();
    });
  }

  /** Streamed playback: play a MediaSource-backed element as chunks arrive. */
  async playStream(stream: ReadableStream<Uint8Array>, mime = 'audio/mpeg', volume = 1): Promise<void> {
    const el = document.createElement('audio');
    el.preload = 'auto';
    el.volume = 1;
    this.currentMediaEl = el;
    if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(mime)) {
      // fallback: buffer fully
      const blob = await new Response(stream).blob();
      await this.playBlob(blob, volume);
      return;
    }
    const ms = new MediaSource();
    el.src = URL.createObjectURL(ms);
    this.ensure();
    this.marks.firstByte = performance.now();
    await new Promise<void>((resolve) => {
      ms.addEventListener('sourceopen', () => resolve(), { once: true });
    });
    const sb = ms.addSourceBuffer(mime);
    // Connect the media element to the analyser BEFORE playback starts.
    // Connecting after el.onended meant the analyser saw silence for the
    // entire response, so the Vox bars never moved with ElevenLabs audio.
    try {
      const src = this.ctx!.createMediaElementSource(el);
      src.connect(this.analyser!);
      this.currentSource = src;
      this.setVolume(volume);
    } catch {
      /* source may already be connected by a browser implementation */
    }
    const reader = stream.getReader();
    let first = true;
    const appendChunk = (chunk: Uint8Array): Promise<void> =>
      new Promise((resolve, reject) => {
        const handler = () => {
          sb.removeEventListener('updateend', handler);
          resolve();
        };
        sb.addEventListener('updateend', handler);
        try {
          sb.appendBuffer(chunk as unknown as ArrayBuffer);
        } catch (e) {
          reject(e);
        }
      });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (first) {
            first = false;
            this.marks.firstPlayback = performance.now();
            void el.play().catch(() => undefined);
          }
          await appendChunk(value);
        }
      }
      if (ms.readyState === 'open') {
        try {
          ms.endOfStream();
        } catch {
          /* already ended */
        }
      }
    } catch {
      /* stream error: stop playback */
    }
    // Wait for element to finish
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      el.onended = finish;
      el.onerror = finish;
      // If playback never starts (autoplay policy / suspended context), el.play()
      // rejects — resolve shortly after so the caller isn't stuck for the full
      // duration. Real playback in an unlocked browser ends via onended.
      void el.play().catch(() => setTimeout(finish, 500));
      // absolute safety
      setTimeout(finish, 120000);
    });
  }

  close(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
  }
}
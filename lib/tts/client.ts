// Client-side TTS. Streams from /api/tts (or demo synthesized voice).
import { TTSConfig } from '../config/settings';
import { AudioPipeline } from '../audio/pipeline';
import { apiUrl, apiHeaders } from '../config/apiBase';

export class TTSClient {
  private pending: (() => void) | null = null;

  constructor(private pipeline: AudioPipeline) {}

  /**
   * Silence any in-flight browser speech immediately.
   *
   * Two things happen here, and both matter:
   *  - speechSynthesis.cancel() is what actually stops the device voice. Without
   *    it, INTERRUPT only stopped the cloud-audio path, and the browser voice
   *    kept talking over the user — interruption was broken for that provider.
   *  - the awaiting speakBrowser() promise is resolved, because a cancelled
   *    utterance never fires onend, which would leave the TTS pump awaiting for
   *    ever and the engine unable to listen again.
   */
  stop(): void {
    if (typeof speechSynthesis !== 'undefined') {
      try {
        speechSynthesis.cancel();
      } catch {
        /* nothing to cancel */
      }
    }
    const pending = this.pending;
    this.pending = null;
    pending?.();
  }

  /** Synthesize + stream-play. Resolves when playback completes. */
  async speak(text: string, cfg: TTSConfig, signal?: AbortSignal): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (cfg.provider === 'demo') {
      await this.speakDemo(trimmed, cfg, signal);
      return;
    }
    if (cfg.provider === 'browser') {
      await this.speakBrowser(trimmed, cfg);
      return;
    }
    const res = await fetch(apiUrl('/api/tts'), {
      method: 'POST',
      signal,
      headers: apiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        provider: cfg.provider,
        apiKey: cfg.apiKey,
        voiceId: cfg.voiceId,
        model: cfg.model,
        text: trimmed,
        stability: cfg.stability,
        similarityBoost: cfg.similarityBoost,
        style: cfg.style,
        speed: cfg.speed,
        speakerBoost: cfg.speakerBoost,
      }),
    });
    if (!res.ok || !res.body) {
      let msg = `Voice error ${res.status}`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch { /* not json */ }
      throw new Error(msg);
    }
    await this.pipeline.playStream(res.body, 'audio/mpeg', cfg.outputVolume);
  }

  private async speakBrowser(text: string, cfg: TTSConfig): Promise<void> {
    if (typeof speechSynthesis === 'undefined') throw new Error('Browser speech synthesis unavailable.');
    return new Promise((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95 * cfg.speed;
      u.pitch = 0.85; // mature male presentation
      // stop() resolves this if speech is cancelled mid-utterance.
      this.pending = resolve;
      u.onend = () => {
        this.pending = null;
        resolve();
      };
      u.onerror = (e) => {
        this.pending = null;
        reject(new Error(`Browser speech error: ${e.error}`));
      };
      speechSynthesis.speak(u);
      this.pipeline.marks.firstPlayback = performance.now();
      // Note: speechSynthesis audio cannot be routed through WebAudio analyser;
      // modulator will use synthetic envelope in browser-TTS mode.
    });
  }

  /** speak() for browser-TTS mode with a short text segment. */
  async speakBrowserWithEnd(text: string, cfg: TTSConfig): Promise<void> {
    await this.speakBrowser(text, cfg);
  }

  /**
   * Demo voice: synthesized "Vocoder Vox" using WebAudio — a formant-ish
   * robotic tone speaking the rhythm of the sentence. Original synthesis,
   * no licensed audio.
   */
  private async speakDemo(text: string, cfg: TTSConfig, signal?: AbortSignal): Promise<void> {
    const ctx = this.pipeline.ensure();
    const now = ctx.currentTime + 0.05;
    const words = text.split(/\s+/);
    const wps = 2.6 * cfg.speed; // words per second
    const totalDur = words.length / wps + 0.3;

    const master = ctx.createGain();
    master.gain.value = 0.22 * cfg.outputVolume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
    if (this.pipeline['analyser']) {
      comp.connect(this.pipeline['analyser']);
    }

    // carrier: two detuned saws through bandpass formants
    const carrier = ctx.createOscillator();
    carrier.type = 'sawtooth';
    carrier.frequency.value = 96;
    const carrier2 = ctx.createOscillator();
    carrier2.type = 'sawtooth';
    carrier2.frequency.value = 96 * 1.01;

    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass'; f1.frequency.value = 620; f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass'; f2.frequency.value = 1180; f2.Q.value = 7;
    const f3 = ctx.createBiquadFilter();
    f3.type = 'bandpass'; f3.frequency.value = 2400; f3.Q.value = 8;
    const mix = ctx.createGain(); mix.gain.value = 0.5;
    carrier.connect(f1); carrier.connect(f2); carrier.connect(f3);
    carrier2.connect(f1); carrier2.connect(f2); carrier2.connect(f3);
    f1.connect(mix); f2.connect(mix); f3.connect(mix);
    mix.connect(master);

    // gate: syllable rhythm with vowel formant wobble
    let t = now;
    for (const w of words) {
      const syll = Math.max(1, Math.round(w.length / 3));
      for (let s = 0; s < syll; s++) {
        const dur = 0.16 + Math.random() * 0.1;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + 0.02);
        g.gain.setValueAtTime(1, t + dur - 0.03);
        g.gain.linearRampToValueAtTime(0, t + dur);
        mix.disconnect();
        mix.connect(g);
        g.connect(master);
        // formant shift per syllable for variety
        f1.frequency.setValueAtTime(500 + Math.random() * 300, t);
        f2.frequency.setValueAtTime(1000 + Math.random() * 600, t);
        f3.frequency.setValueAtTime(2200 + Math.random() * 800, t);
        t += dur + 0.03 + (Math.random() < 0.15 ? 0.12 : 0); // occasional pause
        if (signal?.aborted) break;
      }
      t += 0.06; // word gap
      if (signal?.aborted) break;
    }
    carrier.start(now);
    carrier2.start(now);
    const end = Math.min(t, now + totalDur + 0.5);
    carrier.stop(end);
    carrier2.stop(end);
    this.pipeline.marks.firstPlayback = performance.now();
    await new Promise<void>((resolve) => {
      const done = () => { resolve(); };
      carrier.onended = done;
      signal?.addEventListener('abort', () => {
        try { carrier.stop(); } catch { /* */ }
        done();
      }, { once: true });
      setTimeout(done, (end - ctx.currentTime) * 1000 + 300);
    });
    master.disconnect();
    comp.disconnect();
  }

  /** TEST VOICE helper: speaks a short test sentence, reports success/failure. */
  async testVoice(cfg: TTSConfig): Promise<{ ok: boolean; message: string }> {
    try {
      await this.speak('Voice systems online. This is a test of my vocal synthesis circuits.', cfg);
      return { ok: true, message: 'Voice test complete.' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
}
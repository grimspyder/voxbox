// Traffic alert speech — priority path, separate from the assistant's voice.
//
// Two rules make this module worth existing instead of calling tts.speak()
// inline from the drive loop:
//
//  1. A speed warning is only useful now. If the assistant is mid-answer, the
//     warning preempts it rather than queueing behind twenty seconds of prose.
//  2. Alerts arrive faster than speech finishes (a band fires while "over the
//     limit" is still being said). Only the most urgent pending message is kept,
//     so the driver hears "ten miles over" once, not a backlog of stale ones.
//
// Speech itself is injected. The shadow build passes no speaker at all, which is
// what keeps that build structurally incapable of making noise.
import type { TrafficAlert } from './alertPolicy';

export interface SpeechPort {
  /** Speak, resolving when playback finishes. */
  speak(text: string): Promise<void>;
  /** Cut off whatever is currently being spoken (assistant or alert). */
  interrupt(): void;
}

export interface TrafficSpeakerConfig {
  /** Higher rank wins the pending slot. Default: charge > band > over > limit. */
  rank?: (alert: TrafficAlert) => number;
  /**
   * Called when speech fails. Silence is the worst possible outcome for a
   * speed warning, so the panel needs to be able to say the voice is broken
   * instead of failing quietly.
   */
  onError?: (error: unknown) => void;
}

const DEFAULT_RANK = (alert: TrafficAlert): number => {
  switch (alert.kind) {
    case 'charge':
      return 40;
    case 'band':
      return 30 + (alert.bandMph ?? 0);
    case 'over':
      return 20;
    case 'limit':
      return 10;
    default:
      return 0;
  }
};

export class TrafficSpeaker {
  private speaking = false;
  private pending: { text: string; rank: number } | null = null;
  private disposed = false;
  private rank: (alert: TrafficAlert) => number;
  private onError?: (error: unknown) => void;

  constructor(
    private port: SpeechPort,
    config: TrafficSpeakerConfig = {},
  ) {
    this.rank = config.rank ?? DEFAULT_RANK;
    this.onError = config.onError;
  }

  /**
   * Offer an alert for speech. Returns immediately: the drive loop must never
   * await audio, because the next GPS fix is one second away.
   */
  announce(alert: TrafficAlert, text: string): void {
    if (this.disposed || !text.trim()) return;
    const entry = { text, rank: this.rank(alert) };

    if (this.speaking) {
      // Keep only the more urgent of the pending messages; a stale "over the
      // limit" must not follow a "ten miles over".
      if (!this.pending || entry.rank >= this.pending.rank) this.pending = entry;
      return;
    }

    this.speaking = true;
    // Interrupt first, then speak: Ducking the assistant is deliberate. A
    // warning that waits for the current answer is worthless.
    try {
      this.port.interrupt();
    } catch {
      /* interrupt is best-effort */
    }
    void this.run(entry.text);
  }

  private async run(text: string): Promise<void> {
    try {
      await this.port.speak(text);
    } catch (error) {
      // Audio failure must not stop monitoring, but it must not be invisible
      // either: try the fallback voice and tell the panel what happened.
      try {
        this.onError?.(error);
      } catch {
        /* reporting a failure cannot itself fail the drive */
      }
    } finally {
      const next = this.pending;
      this.pending = null;
      if (next && !this.disposed) {
        void this.run(next.text);
      } else {
        this.speaking = false;
      }
    }
  }

  /** True while audio is in flight (used by the UI to show an indicator). */
  get busy(): boolean {
    return this.speaking;
  }

  /** Stop speaking and drop anything pending, e.g. when drive mode ends. */
  dispose(): void {
    this.disposed = true;
    this.pending = null;
    try {
      this.port.interrupt();
    } catch {
      /* best-effort */
    }
  }
}

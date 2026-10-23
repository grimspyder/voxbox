/**
 * Jurisdiction tracking across state lines.
 *
 * A single GPS sample is not evidence of a state change: borders are messy,
 * accuracy is metres-to-tens-of-metres, and a point can flicker across a river
 * or an interstate boundary. So a new state must be observed N times in a row
 * before the app adopts it.
 *
 * Unknown samples (no data, no subdivision returned) never change the current
 * state — losing the signal for a second must not silently disable charge
 * warnings, nor swap them to a different state's law.
 */
export class JurisdictionTracker {
  private current: string | null = null;
  private candidate: string | null = null;
  private streak = 0;

  constructor(private readonly confirmations = 2) {}

  get state(): string | null {
    return this.current;
  }

  get pending(): string | null {
    return this.candidate;
  }

  /** Feed one observed subdivision code (e.g. "NC"), or null when unknown. */
  observe(code: string | null | undefined): { changed: boolean; code: string | null } {
    const next = code ? code.trim().toUpperCase() : null;

    if (!next) {
      this.candidate = null;
      this.streak = 0;
      return { changed: false, code: this.current };
    }

    // First ever observation: adopt immediately, there is nothing to protect.
    if (this.current === null) {
      this.current = next;
      this.candidate = null;
      this.streak = 0;
      return { changed: true, code: this.current };
    }

    if (next === this.current) {
      this.candidate = null;
      this.streak = 0;
      return { changed: false, code: this.current };
    }

    if (next === this.candidate) {
      this.streak += 1;
    } else {
      this.candidate = next;
      this.streak = 1;
    }

    if (this.streak >= this.confirmations) {
      this.current = next;
      this.candidate = null;
      this.streak = 0;
      return { changed: true, code: this.current };
    }

    return { changed: false, code: this.current };
  }

  reset(): void {
    this.current = null;
    this.candidate = null;
    this.streak = 0;
  }
}

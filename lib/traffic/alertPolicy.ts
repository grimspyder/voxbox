/**
 * Speed alert policy — the decision layer for traffic warnings.
 *
 * This module is deliberately pure: it takes timestamped speed/limit samples and
 * returns structured alerts. No GPS, no network, no audio. That is what makes it
 * testable, and it is where the feature is most likely to be got wrong.
 *
 * Why this is not just `if (speed > limit + 5) speak()`:
 *  - GPS speed noise crosses a threshold several times per second, so a naive
 *    rule repeats itself until the driver mutes the app.
 *  - A band must be *held* before it is announced (arming), and must drop
 *    clearly below it before it can fire again (hysteresis).
 *  - A new speed limit (new road segment) invalidates every armed band.
 *  - Escalation is more urgent than repetition: +5 -> +10 must speak at once,
 *    but repeating +10 must not.
 *  - A charge warning (reckless driving threshold) must never be suppressed by
 *    the anti-chatter budget.
 */

export interface TrafficPolicyConfig {
  /** Bands above the limit, ascending, mph. Default 5/10/15/20/25. */
  bandsMph: number[];
  /** Soft notice when the limit is first exceeded, mph. 0 disables it. */
  initialNoticeMph: number;
  /** How long a band must be held before it may speak, seconds. */
  armSeconds: number;
  /** How far below a band counts as "released", mph. */
  releaseMph: number;
  /** How long it must stay released before re-arming, seconds. */
  releaseSeconds: number;
  /** Minimum gap between repeats of the same band, seconds. */
  cooldownSeconds: number;
  /** Anti-chatter budget for non-charge alerts. */
  maxPerMinute: number;
  /** Below this speed we are not driving; timers are cleared. */
  minSpeedMph: number;
  /** Announce the limit when it changes (new road / new limit). */
  announceLimitChange: boolean;
  /** Optional per-jurisdiction charge threshold, mph over. null disables. */
  chargeThresholdMph: number | null;
  /** How to read the over-threshold: 'gte' = "20 or more", 'gt' = "more than 15". */
  chargeThresholdMode: 'gte' | 'gt';
  /** Absolute speed that triggers a charge regardless of the limit (e.g. >80). */
  chargeAbsoluteMph: number | null;
}

export const DEFAULT_TRAFFIC_POLICY: TrafficPolicyConfig = {
  bandsMph: [5, 10, 15, 20, 25],
  initialNoticeMph: 1,
  armSeconds: 2.5,
  releaseMph: 2,
  releaseSeconds: 5,
  cooldownSeconds: 60,
  maxPerMinute: 3,
  minSpeedMph: 15,
  announceLimitChange: true,
  chargeThresholdMph: null,
  chargeThresholdMode: 'gte',
  chargeAbsoluteMph: null,
};

export interface TrafficSample {
  /** Monotonic seconds. Tests drive this directly. */
  t: number;
  speedMph: number;
  /** null/undefined = limit unknown; the policy stays silent. */
  limitMph: number | null;
  /** Road segment identity from the limit provider. */
  segmentId: string | null;
  /** GPS horizontal accuracy in metres, if known. */
  accuracyM?: number | null;
}

export type TrafficAlertKind = 'limit' | 'over' | 'band' | 'charge';

export interface TrafficAlert {
  kind: TrafficAlertKind;
  /** Band that triggered a 'band' alert, else null. */
  bandMph: number | null;
  speedMph: number;
  limitMph: number;
  t: number;
  /** For charge alerts: whether the over-limit rule or the absolute-speed rule fired. */
  chargeReason?: 'over' | 'absolute';
}

interface BandState {
  /** When the vehicle first went at/above this band (null = not above). */
  aboveSince: number | null;
  /** When it first dropped below the release line (null = not below). */
  belowSince: number | null;
  /** True once announced; cleared only by a release + releaseSeconds. */
  armed: boolean;
  /** Last time this band spoke, for the repeat cooldown. */
  lastAnnouncedAt: number | null;
}

export class SpeedAlertPolicy {
  private cfg: TrafficPolicyConfig;
  private state = {
    segmentId: null as string | null,
    lastLimitAnnounced: null as number | null,
    bands: new Map<number, BandState>(),
    overSince: null as number | null,
    legalSince: null as number | null,
    overNoticed: false,
    chargeAnnounced: false,
    chargeBelowSince: null as number | null,
    announceTimes: [] as number[],
    /** Highest band spoken since the last road change, for escalation bypass. */
    highestBand: 0,
  };

  constructor(config: Partial<TrafficPolicyConfig> = {}) {
    this.cfg = { ...DEFAULT_TRAFFIC_POLICY, ...config };
  }

  get config(): TrafficPolicyConfig {
    return { ...this.cfg };
  }

  /**
   * Apply a config change at runtime — used when the vehicle crosses a state
   * line and the charge rules change. Band state is preserved (the driver did
   * not change speed); only the charge latch is cleared so the new
   * jurisdiction's rule can fire.
   */
  setConfig(partial: Partial<TrafficPolicyConfig>): void {
    this.cfg = { ...this.cfg, ...partial };
    this.state.chargeAnnounced = false;
    this.state.chargeBelowSince = null;
  }

  /** Full reset, e.g. when drive mode is stopped. */
  reset(): void {
    this.state = {
      segmentId: null,
      lastLimitAnnounced: null,
      bands: new Map(),
      overSince: null,
      legalSince: null,
      overNoticed: false,
      chargeAnnounced: false,
      chargeBelowSince: null,
      announceTimes: [],
      highestBand: 0,
    };
  }

  /**
   * Feed one sample. Returns the alerts (if any) that should be spoken.
   * Callers must feed samples in ascending `t`; the policy does not sort.
   */
  update(sample: TrafficSample): TrafficAlert[] {
    const { t, speedMph, limitMph, segmentId } = sample;
    const alerts: TrafficAlert[] = [];

    // No limit known: stay silent, but forget any armed state so stale arming
    // from a previous road cannot fire when the limit reappears.
    if (limitMph === null || limitMph === undefined || limitMph <= 0) {
      this.clearRoadState();
      this.state.lastLimitAnnounced = null;
      return alerts;
    }

    // New road segment: every band must be re-earned, and the previous road's
    // repeat cooldowns do not apply — a new limit is a new context.
    if (segmentId !== this.state.segmentId) {
      this.state.segmentId = segmentId;
      this.clearRoadState(true);
    }

    // Announce a changed limit once. Segment churn alone does not re-announce,
    // because short segments would otherwise produce a limit announcement every
    // few seconds.
    if (this.cfg.announceLimitChange && limitMph !== this.state.lastLimitAnnounced) {
      if (this.canSpeak(t)) {
        this.state.lastLimitAnnounced = limitMph;
        this.recordAnnouncement(t);
        alerts.push({ kind: 'limit', bandMph: null, speedMph, limitMph, t });
      }
    }

    // Not driving (stopped, or crawling in a car park): timers do not run.
    if (speedMph < this.cfg.minSpeedMph) {
      this.state.overSince = null;
      this.state.legalSince = null;
      for (const band of this.state.bands.values()) {
        band.aboveSince = null;
      }
      return alerts;
    }

    const over = speedMph - limitMph;

    // ---- soft "you are over the limit" notice -------------------------------
    // Defer emission until after bands/charge have been evaluated. If a sudden
    // speed jump qualifies both the soft notice and a higher-priority warning
    // on the same fix, emit only the highest useful message rather than stacking
    // "Over the limit" and "Five miles over" at one timestamp.
    let softNoticeDue = false;
    if (this.cfg.initialNoticeMph > 0) {
      if (over >= this.cfg.initialNoticeMph) {
        this.state.legalSince = null;
        if (this.state.overSince === null) this.state.overSince = t;
        const held = t - this.state.overSince;
        if (!this.state.overNoticed && held >= this.cfg.armSeconds) {
          softNoticeDue = true;
        }
      } else if (over <= 0) {
        // Re-arm only after a clear period back under the limit.
        if (this.state.legalSince === null) this.state.legalSince = t;
        if (t - this.state.legalSince >= this.cfg.releaseSeconds) {
          this.state.overNoticed = false;
          this.state.overSince = null;
        }
      }
    }

    // ---- bands --------------------------------------------------------------
    // A band must be held *continuously*: a dip below it restarts the timer,
    // which is what makes GPS jitter harmless. Several bands can qualify in one
    // sample (a position jump, or hard acceleration), so only the highest new
    // band speaks — "twenty-five miles over" is useful; five announcements in a
    // row is not.
    const newlyArmed: number[] = [];
    for (const band of this.cfg.bandsMph) {
      const st = this.bandState(band);

      if (over >= band) {
        st.belowSince = null;
        if (st.aboveSince === null) st.aboveSince = t;
        const held = t - st.aboveSince;
        if (!st.armed && held >= this.cfg.armSeconds) {
          const cooled =
            st.lastAnnouncedAt === null || t - st.lastAnnouncedAt >= this.cfg.cooldownSeconds;
          // Escalation above anything already spoken is never rate limited: it
          // is the safety-critical case, and the cap exists to stop repetition,
          // not to gag a new, higher warning.
          const escalated = band > this.state.highestBand;
          if (cooled && (escalated || this.canSpeak(t))) {
            st.armed = true;
            st.lastAnnouncedAt = t;
            newlyArmed.push(band);
          }
        }
      } else {
        // Not continuously at or above this band: the hold timer restarts.
        st.aboveSince = null;
        if (over < band - this.cfg.releaseMph) {
          if (st.belowSince === null) st.belowSince = t;
          if (t - st.belowSince >= this.cfg.releaseSeconds) {
            st.armed = false;
          }
        } else {
          // Inside the hysteresis deadband: stay armed, but do not accumulate.
          st.belowSince = null;
        }
      }
    }

    if (newlyArmed.length > 0) {
      const top = Math.max(...newlyArmed);
      this.state.highestBand = Math.max(this.state.highestBand, top);
      this.recordAnnouncement(t);
      alerts.push({ kind: 'band', bandMph: top, speedMph, limitMph, t });
    }

    // ---- charge threshold (never rate-limited) -------------------------------
    // Two independent triggers, because states differ: a delta over the limit
    // ("20 mph or more over") and an absolute speed ("over 80 mph") that applies
    // even where the posted limit is high. Either fires once per crossing.
    const chargeAt = this.cfg.chargeThresholdMph;
    const chargeAbs = this.cfg.chargeAbsoluteMph;
    const overHit =
      chargeAt !== null &&
      (this.cfg.chargeThresholdMode === 'gt' ? over > chargeAt : over >= chargeAt);
    const absHit = chargeAbs !== null && speedMph > chargeAbs;

    if (overHit || absHit) {
      this.state.chargeBelowSince = null;
      if (!this.state.chargeAnnounced) {
        this.state.chargeAnnounced = true;
        this.recordAnnouncement(t);
        alerts.push({
          kind: 'charge',
          bandMph: overHit ? Math.round(over) : null,
          speedMph,
          limitMph,
          t,
          chargeReason: overHit ? 'over' : 'absolute',
        });
      }
    } else if (
      (chargeAt === null || over < chargeAt - this.cfg.releaseMph) &&
      (chargeAbs === null || speedMph < chargeAbs - this.cfg.releaseMph)
    ) {
      if (this.state.chargeBelowSince === null) this.state.chargeBelowSince = t;
      if (t - this.state.chargeBelowSince >= this.cfg.releaseSeconds) {
        this.state.chargeAnnounced = false;
      }
    }

    if (softNoticeDue) {
      const superseded = alerts.some((alert) => alert.kind === 'band' || alert.kind === 'charge');
      if (superseded) {
        // A higher-priority warning already covered this speeding episode. Latch
        // the soft notice without consuming budget or speaking a duplicate.
        this.state.overNoticed = true;
      } else if (this.canSpeak(t)) {
        this.state.overNoticed = true;
        this.recordAnnouncement(t);
        alerts.push({ kind: 'over', bandMph: null, speedMph, limitMph, t });
      }
    }

    return alerts;
  }

  private bandState(band: number): BandState {
    let st = this.state.bands.get(band);
    if (!st) {
      st = { aboveSince: null, belowSince: null, armed: false, lastAnnouncedAt: null };
      this.state.bands.set(band, st);
    }
    return st;
  }

  /** Clears arming/timers; `clearCooldowns` also forgets repeat history. */
  private clearRoadState(clearCooldowns = false): void {
    this.state.overSince = null;
    this.state.legalSince = null;
    this.state.overNoticed = false;
    this.state.chargeAnnounced = false;
    this.state.chargeBelowSince = null;
    this.state.highestBand = 0;
    for (const band of this.state.bands.values()) {
      band.aboveSince = null;
      band.belowSince = null;
      band.armed = false;
      if (clearCooldowns) band.lastAnnouncedAt = null;
    }
  }

  /** Sliding one-minute budget for non-charge speech. */
  private canSpeak(t: number): boolean {
    this.state.announceTimes = this.state.announceTimes.filter((x) => t - x < 60);
    return this.state.announceTimes.length < this.cfg.maxPerMinute;
  }

  private recordAnnouncement(t: number): void {
    this.state.announceTimes.push(t);
  }
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Speakable number for 0-999; speech engines read digits badly in context. */
export function numberToWords(n: number): string {
  const v = Math.round(n);
  if (v < 20) return ONES[v] ?? String(v);
  if (v < 100) {
    const tens = Math.floor(v / 10);
    const ones = v % 10;
    return ones ? `${TENS[tens]}-${ONES[ones]}` : TENS[tens];
  }
  const hundreds = Math.floor(v / 100);
  const rest = v % 100;
  return rest ? `${ONES[hundreds]} hundred ${numberToWords(rest)}` : `${ONES[hundreds]} hundred`;
}

/**
 * Convert a structured alert into the spoken line.
 *
 * `chargeLabel` is supplied by the jurisdiction rules (e.g. "reckless driving, a
 * Class 1 misdemeanor in Virginia"); the policy itself never makes a legal claim.
 */
export function formatTrafficAlert(
  alert: TrafficAlert,
  opts: { stateName?: string; chargeLabel?: string; shortAboveMph?: number } = {},
): string {
  switch (alert.kind) {
    case 'limit':
      return `Speed limit ${numberToWords(alert.limitMph)}.`;
    case 'over':
      return 'Over the limit.';
    case 'band': {
      const band = alert.bandMph ?? 0;
      const short = opts.shortAboveMph ?? 10;
      const words = numberToWords(band);
      const capitalised = words.charAt(0).toUpperCase() + words.slice(1);
      if (band >= short) return `${capitalised} miles over.`;
      return `You are doing ${words} miles over the speed limit.`;
    }
    case 'charge': {
      const where = opts.stateName ? ` in ${opts.stateName}` : '';
      const what = opts.chargeLabel ?? 'a possible traffic charge';
      if (alert.chargeReason === 'absolute') {
        const mph = numberToWords(Math.round(alert.speedMph));
        const capitalised = mph.charAt(0).toUpperCase() + mph.slice(1);
        return `${capitalised} miles an hour${where} is ${what}.`;
      }
      const band = alert.bandMph ?? 0;
      const words = numberToWords(band);
      const capitalised = words.charAt(0).toUpperCase() + words.slice(1);
      return `${capitalised} miles over${where} is ${what}.`;
    }
    default:
      return '';
  }
}

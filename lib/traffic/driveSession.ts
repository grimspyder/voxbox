// Shadow-mode drive session.
//
// The first testable build must not speak. It runs the real pipeline — GPS fix
// in, limit resolved, jurisdiction tracked, policy evaluated — and records what
// it *would* have said, with the speed and limit that produced it. That log is
// what gets reviewed against the physical signs before a single word is spoken.
//
// Deliberately no audio dependency: this module cannot speak even by accident.
import { SpeedAlertPolicy, formatTrafficAlert, type TrafficAlert } from './alertPolicy';
import { JurisdictionTracker } from './jurisdictionTracker';
import { chargeConfigFor, chargeLabelFor, getJurisdiction } from './jurisdictions';
import type { Position, SpeedLimitProvider, SpeedLimitResult } from './speedLimitProvider';

export interface DriveFix {
  /** Monotonic seconds. */
  t: number;
  lon: number;
  lat: number;
  speedMph: number;
  accuracyM?: number;
}

export type ShadowEventKind = TrafficAlert['kind'] | 'state-change' | 'lookup-unknown';

export interface ShadowEvent {
  t: number;
  kind: ShadowEventKind;
  /** Exactly what would be spoken. Empty for observability-only events. */
  text: string;
  speedMph: number;
  limitMph: number | null;
  road: string | null;
  state: string | null;
  /** The structured alert, for later analysis. */
  alert?: TrafficAlert;
}

export interface DriveSessionOptions {
  provider: SpeedLimitProvider;
  policy?: SpeedAlertPolicy;
  tracker?: JurisdictionTracker;
  onEvent?: (event: ShadowEvent) => void;
  /** Log lookup failures once per this many seconds, to avoid flooding. */
  lookupLogSeconds?: number;
}

export class DriveSession {
  readonly policy: SpeedAlertPolicy;
  readonly tracker: JurisdictionTracker;
  private readonly provider: SpeedLimitProvider;
  private readonly onEvent?: (event: ShadowEvent) => void;
  private readonly lookupLogSeconds: number;
  private readonly events: ShadowEvent[] = [];
  private lastLookupLogAt = -Infinity;
  private previous: Position | null = null;
  private running = false;

  constructor(opts: DriveSessionOptions) {
    this.provider = opts.provider;
    this.policy = opts.policy ?? new SpeedAlertPolicy(chargeConfigFor(null));
    this.tracker = opts.tracker ?? new JurisdictionTracker(2);
    this.onEvent = opts.onEvent;
    this.lookupLogSeconds = opts.lookupLogSeconds ?? 60;
  }

  get log(): ShadowEvent[] {
    return [...this.events];
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  /**
   * Feed one GPS fix. Always returns the events produced by this fix (usually
   * none) and appends them to the log.
   */
  async onFix(fix: DriveFix): Promise<ShadowEvent[]> {
    if (!this.running) return [];

    const limit: SpeedLimitResult = await this.provider.resolve(
      { lon: fix.lon, lat: fix.lat },
      this.previous ?? undefined,
    );
    this.previous = { lon: fix.lon, lat: fix.lat };

    const produced: ShadowEvent[] = [];

    // Jurisdiction: two consecutive observations are required to switch, so a
    // border flicker cannot swap laws mid-drive.
    if (limit.state) {
      const change = this.tracker.observe(limit.state);
      if (change.changed) {
        this.policy.setConfig(chargeConfigFor(change.code));
        produced.push({
          t: fix.t,
          kind: 'state-change',
          text: '',
          speedMph: fix.speedMph,
          limitMph: limit.limit,
          road: limit.road,
          state: change.code,
        });
      }
    } else {
      this.tracker.observe(null); // never drops the current state
    }

    // Unknown limit is not an error state for the driver: it means silence.
    // Log it sparingly so the log stays readable and the gap is still visible.
    if (limit.limit === null) {
      if (fix.t - this.lastLookupLogAt >= this.lookupLogSeconds) {
        this.lastLookupLogAt = fix.t;
        produced.push({
          t: fix.t,
          kind: 'lookup-unknown',
          text: '',
          speedMph: fix.speedMph,
          limitMph: null,
          road: limit.road,
          state: limit.state,
        });
      }
      this.emit(produced);
      return produced;
    }

    const alerts = this.policy.update({
      t: fix.t,
      speedMph: fix.speedMph,
      limitMph: limit.limit,
      segmentId: limit.segmentId,
      accuracyM: fix.accuracyM ?? null,
    });

    const state = this.tracker.state;
    const stateName = getJurisdiction(state)?.name ?? state ?? undefined;

    for (const alert of alerts) {
      produced.push({
        t: alert.t,
        kind: alert.kind,
        text: formatTrafficAlert(alert, {
          stateName,
          chargeLabel: chargeLabelFor(state),
        }),
        speedMph: alert.speedMph,
        limitMph: alert.limitMph,
        road: limit.road,
        state,
        alert,
      });
    }

    this.emit(produced);
    return produced;
  }

  reset(): void {
    this.policy.reset();
    this.tracker.reset();
    this.provider.reset();
    this.previous = null;
    this.lastLookupLogAt = -Infinity;
    this.running = false;
    this.events.length = 0;
  }

  private emit(events: ShadowEvent[]): void {
    for (const event of events) {
      this.events.push(event);
      this.onEvent?.(event);
    }
  }
}

/**
 * Render the shadow log as text, for saving to a file or pasting into a review.
 * One line per event: time, what it would have said, and the numbers behind it.
 */
export function formatShadowLog(events: ShadowEvent[]): string {
  const clock = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  return events
    .map((e) => {
      const where = [e.road, e.state].filter(Boolean).join(', ') || 'unknown road';
      if (e.kind === 'lookup-unknown') {
        return `${clock(e.t)}  [no limit resolved] ${where}`;
      }
      if (e.kind === 'state-change') {
        return `${clock(e.t)}  [jurisdiction -> ${e.state}] ${where}`;
      }
      return `${clock(e.t)}  ${e.speedMph.toFixed(0)} mph in a ${e.limitMph ?? '?'} zone (${where}) -> "${e.text}"`;
    })
    .join('\n');
}

// Client-side speed-limit lookup with caching and throttling.
//
// Cost discipline lives here as much as on the server: the limit only changes
// when the road changes, so asking once per second is paying 60× for the same
// answer. Rules:
//   - never look up more often than `minIntervalMs` while moving;
//   - reuse the answer while the vehicle stays within `sameRoadMeters`;
//   - collapse concurrent requests for the same fix into one;
//   - never throw: a failed lookup is "unknown limit", and the policy stays
//     silent on unknown. A dead network must not stop speed monitoring.
import { apiUrl, apiHeaders } from '../config/apiBase';

export interface SpeedLimitResult {
  limit: number | null;
  unit: string | null;
  type: string | null;
  road: string | null;
  state: string | null;
  segmentId: string | null;
  cached: boolean;
  reason?: string;
}

export interface Position {
  lon: number;
  lat: number;
}

const UNKNOWN: SpeedLimitResult = {
  limit: null,
  unit: null,
  type: null,
  road: null,
  state: null,
  segmentId: null,
  cached: false,
  reason: 'not-attempted',
};

export type LimitFetcher = (points: [number, number][]) => Promise<SpeedLimitResult>;

/** Default fetcher: the Voxbox API route, which holds the provider key. */
export const fetchSpeedLimitFromApi: LimitFetcher = async (points) => {
  try {
    const res = await fetch(apiUrl('/api/speedlimit'), {
      method: 'POST',
      headers: apiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ points }),
      cache: 'no-store',
    });
    if (!res.ok) return { ...UNKNOWN, reason: `http-${res.status}` };
    const json = (await res.json()) as SpeedLimitResult;
    return { ...UNKNOWN, ...json };
  } catch {
    return { ...UNKNOWN, reason: 'network' };
  }
};

/** Metres between two fixes (equirectangular approximation; plenty at this scale). */
export function metresBetween(a: Position, b: Position): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const x = dLon * Math.cos(lat);
  return Math.sqrt(x * x + dLat * dLat) * R;
}

export interface SpeedLimitProviderOptions {
  fetchLimit?: LimitFetcher;
  /** Minimum gap between lookups, ms. */
  minIntervalMs?: number;
  /** Reuse the cached answer until the vehicle moves this far, metres. */
  sameRoadMeters?: number;
  now?: () => number;
}

export class SpeedLimitProvider {
  private readonly fetchLimit: LimitFetcher;
  private readonly minIntervalMs: number;
  private readonly sameRoadMeters: number;
  private readonly now: () => number;

  private lastAt = -Infinity;
  private lastPosition: Position | null = null;
  private lastResult: SpeedLimitResult = { ...UNKNOWN };
  private inFlight: Promise<SpeedLimitResult> | null = null;

  constructor(opts: SpeedLimitProviderOptions = {}) {
    this.fetchLimit = opts.fetchLimit ?? fetchSpeedLimitFromApi;
    this.minIntervalMs = opts.minIntervalMs ?? 8000;
    this.sameRoadMeters = opts.sameRoadMeters ?? 150;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Last resolved answer, without causing a lookup. */
  get current(): SpeedLimitResult {
    return this.lastResult;
  }

  /**
   * Resolve the limit for this fix. Returns the cached answer when the vehicle
   * has not moved far enough or the throttle window has not elapsed — except
   * that a *failed* lookup is retried after the normal interval rather than
   * being pinned for the whole drive.
   */
  async resolve(position: Position, previous?: Position): Promise<SpeedLimitResult> {
    const now = this.now();
    const moved = this.lastPosition ? metresBetween(this.lastPosition, position) : Infinity;
    const elapsed = now - this.lastAt;

    const fresh = elapsed >= this.minIntervalMs && moved >= this.sameRoadMeters;
    const failed = this.lastResult.limit === null && this.lastResult.reason !== 'not-attempted';
    if (!fresh && !failed) return this.lastResult;
    if (this.inFlight) return this.inFlight;

    const prev = previous ?? this.lastPosition ?? position;
    // TomTom requires at least two points; the previous fix anchors the snap.
    const points: [number, number][] = [
      [prev.lon, prev.lat],
      [position.lon, position.lat],
    ];

    this.inFlight = this.fetchLimit(points)
      .then((result) => {
        // Only cache a successful lookup; a failure should be retried.
        if (result.limit !== null) {
          this.lastResult = result;
          this.lastPosition = position;
          this.lastAt = now;
        } else {
          this.lastResult = result;
          this.lastAt = now;
        }
        return result;
      })
      .catch(() => {
        this.lastResult = { ...UNKNOWN, reason: 'exception' };
        this.lastAt = now;
        return this.lastResult;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  reset(): void {
    this.lastAt = -Infinity;
    this.lastPosition = null;
    this.lastResult = { ...UNKNOWN };
    this.inFlight = null;
  }
}

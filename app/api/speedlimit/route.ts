// Server route: speed-limit lookup proxy (TomTom Snap to Roads).
//
// Why this exists at all: the TomTom key bills per request, so it must never
// ship inside the APK. Keeping the call server-side also buys a shared cache
// (two clients on the same road cost one request), a hard rate limit, and a
// kill switch that does not require an app release.
//
// Failure is deliberately soft: a missing key, an upstream 429 or a network
// error returns `limit: null` with a reason. The app must treat "no limit" as
// "stay silent", never as "assume the previous road".
import { NextRequest, NextResponse } from 'next/server';
import { LIMITS } from '@/lib/server/limits';
import { speedLimitRequestSchema } from '@/lib/server/schemas';
import { segmentIdentity } from '@/lib/traffic/segment';
import {
  readJsonBody,
  jsonError,
  enforceRateLimit,
  NO_STORE_HEADERS,
  corsHeaders,
  handlePreflight,
} from '@/lib/server/http';

export const runtime = 'nodejs';

const TOMTOM_URL = 'https://api.tomtom.com/snapToRoads/1';
const FIELDS =
  '{route{properties{speedLimits{value,unit,type},address{roadName,countrySubdivision}}}}';

/** Cache key: ~11 m at 4 decimals. Two passes over the same junction hit once. */
function cacheKey(points: [number, number][]): string {
  const last = points[points.length - 1];
  return `${last[0].toFixed(4)},${last[1].toFixed(4)}`;
}

interface CachedLimit {
  at: number;
  body: SpeedLimitBody;
}

interface SpeedLimitBody {
  limit: number | null;
  unit: string | null;
  type: string | null;
  road: string | null;
  state: string | null;
  segmentId: string | null;
  cached: boolean;
  reason?: string;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // limits do not change minute to minute
const CACHE_MAX = 5_000;
const cache = new Map<string, CachedLimit>();

function cacheGet(key: string, now: number): SpeedLimitBody | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return { ...hit.body, cached: true };
}

function cacheSet(key: string, body: SpeedLimitBody, now: number): void {
  if (cache.size >= CACHE_MAX) {
    // Cheap eviction: drop the oldest insertion. Map preserves order.
    const first = cache.keys().next();
    if (!first.done) cache.delete(first.value);
  }
  cache.set(key, { at: now, body });
}

const empty = (reason: string): SpeedLimitBody => ({
  limit: null,
  unit: null,
  type: null,
  road: null,
  state: null,
  segmentId: null,
  cached: false,
  reason,
});

export async function OPTIONS(req: NextRequest) {
  return handlePreflight(req) ?? jsonError('Method not allowed.', 405);
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req);
  const limited = enforceRateLimit(req, 'speedlimit', cors);
  if (limited) return limited;

  const body = await readJsonBody(
    req,
    speedLimitRequestSchema,
    LIMITS.speedlimit.bodyBytes,
    'Vox could not read that location request.',
    cors,
  );
  if (!body.ok) return body.response;

  const points = body.data.points as [number, number][];
  const key = process.env.TOMTOM_API_KEY?.trim();
  const now = Date.now();

  const cacheKeyValue = cacheKey(points);
  const cached = cacheGet(cacheKeyValue, now);
  if (cached) {
    return NextResponse.json(cached, { headers: { ...NO_STORE_HEADERS, ...cors } });
  }

  // No key configured: the feature is simply unavailable. 200 with a null limit
  // is intentional — the client's policy already treats unknown as silence, and
  // an error would make the app look broken on a road with no data.
  if (!key) {
    const res = NextResponse.json(empty('no-key'), {
      headers: { ...NO_STORE_HEADERS, ...cors },
    });
    return res;
  }

  const pointStr = points.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const url =
    `${TOMTOM_URL}?key=${encodeURIComponent(key)}` +
    `&points=${encodeURIComponent(pointStr)}` +
    `&fields=${encodeURIComponent(FIELDS)}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      signal: AbortSignal.timeout(LIMITS.speedlimit.timeoutMs),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(empty('unreachable'), {
      headers: { ...NO_STORE_HEADERS, ...cors },
    });
  }

  if (upstream.status === 429) {
    return NextResponse.json(empty('quota'), {
      headers: { ...NO_STORE_HEADERS, ...cors },
    });
  }
  if (!upstream.ok) {
    return NextResponse.json(empty(`upstream-${upstream.status}`), {
      headers: { ...NO_STORE_HEADERS, ...cors },
    });
  }

  let json: unknown;
  try {
    json = await upstream.json();
  } catch {
    return NextResponse.json(empty('bad-json'), {
      headers: { ...NO_STORE_HEADERS, ...cors },
    });
  }

  const route = (json as { route?: Array<{ properties?: Record<string, unknown> }> }).route ?? [];
  const properties = route.map((r) => r.properties ?? {});
  const speedLimit = properties
    .map((p) => p.speedLimits as { value?: number; unit?: string; type?: string } | undefined)
    .find((s) => s && typeof s.value === 'number');
  const address = properties
    .map((p) => p.address as { roadName?: string; countrySubdivision?: string } | undefined)
    .find(Boolean);

  if (!speedLimit || typeof speedLimit.value !== 'number') {
    const unknown = empty('no-limit');
    cacheSet(cacheKeyValue, unknown, now); // negative cache: stop re-asking every second
    return NextResponse.json(unknown, { headers: { ...NO_STORE_HEADERS, ...cors } });
  }

  const road = address?.roadName ?? null;
  const state = address?.countrySubdivision ?? null;
  const limit = Math.round(speedLimit.value);

  // A stable identity for the policy's "new road" reset. TomTom does not expose
  // a segment id, so road + limit + state is the practical equivalent — except
  // when the snap returns no road name, where the key falls back to position
  // rather than treating every unnamed road as one segment.
  const segmentId = segmentIdentity(state, road, limit, points[points.length - 1]);

  const payload: SpeedLimitBody = {
    limit,
    unit: speedLimit.unit ?? 'mph',
    type: speedLimit.type ?? null,
    road,
    state,
    segmentId,
    cached: false,
  };

  cacheSet(cacheKeyValue, payload, now);
  return NextResponse.json(payload, { headers: { ...NO_STORE_HEADERS, ...cors } });
}

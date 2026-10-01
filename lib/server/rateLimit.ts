// Practical abuse protection for the provider proxies.
//
// There is no Vox account, so the key is a combination of caller IP and the
// app's own installation identifier — enough to stop scripted abuse without
// building any invasive device fingerprint.
//
// NOTE: this store is per-process. A single long-lived Node server (Docker,
// VPS, `next start`) gets correct global limits; on a multi-instance serverless
// deployment each instance enforces its own share. Documented in
// docs/PRODUCTION_REQUIREMENTS.md (SEC-06).

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 20_000;

/** Sliding-window limiter. Pure in-memory; safe to call on every request. */
export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  if (buckets.size > MAX_BUCKETS) sweep(now, windowMs);
  const bucket = buckets.get(key) ?? { hits: [] };
  const cutoff = now - windowMs;
  const hits = bucket.hits.filter((t) => t > cutoff);
  if (hits.length >= limit) {
    buckets.set(key, { hits });
    const retryAfterSeconds = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    return { ok: false, limit, remaining: 0, retryAfterSeconds };
  }
  hits.push(now);
  buckets.set(key, { hits });
  return { ok: true, limit, remaining: limit - hits.length, retryAfterSeconds: 0 };
}

function sweep(now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  for (const [key, bucket] of buckets) {
    const hits = bucket.hits.filter((t) => t > cutoff);
    if (hits.length === 0) buckets.delete(key);
    else buckets.set(key, { hits });
  }
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear();
}

interface HeaderCarrier {
  headers: { get(name: string): string | null };
}

/**
 * Caller identity for rate limiting: first hop of the proxy chain plus the
 * installation identifier the app generates locally.
 */
export function callerKey(req: HeaderCarrier, scope: string): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? '';
  const ip = (forwarded.split(',')[0] || req.headers.get('x-real-ip') || 'unknown').trim().slice(0, 64);
  const install = (req.headers.get('x-voxbox-install-id') ?? 'none').trim().slice(0, 64);
  return `${scope}:${ip}:${install}`;
}

export const RATE_LIMITS = {
  llm: { limit: 30, windowMs: 60_000 },
  tts: { limit: 90, windowMs: 60_000 },
  stt: { limit: 12, windowMs: 60_000 },
  models: { limit: 20, windowMs: 60_000 },
} as const;

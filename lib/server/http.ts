// Shared HTTP plumbing for the provider proxies: bounded body reads,
// rate-limit responses and consistent cache/security headers.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, callerKey, RATE_LIMITS } from './rateLimit';
import { firstIssueMessage } from './schemas';

type Scope = keyof typeof RATE_LIMITS;

const NO_STORE = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

/**
 * CORS for the native (Capacitor) build, whose web assets are served from a
 * local origin and therefore call this API cross-origin. Empty by default:
 * a same-origin web deployment needs no CORS at all. Configure with
 * VOXBOX_ALLOWED_ORIGINS="https://localhost,capacitor://localhost".
 */
const ALLOWED_ORIGINS = (process.env.VOXBOX_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type, x-stt-key, x-voxbox-install-id',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

/** Answer a CORS preflight. Returns null when the request is not a preflight. */
export function handlePreflight(req: Request): NextResponse | null {
  if (req.method !== 'OPTIONS') return null;
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE, ...corsHeaders(req) } });
}

export function jsonError(message: string, status: number, extraHeaders: Record<string, string> = {}): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { ...NO_STORE, ...extraHeaders } });
}

/**
 * Enforce the per-scope rate limit. Returns a 429 response when exceeded,
 * otherwise null so the caller continues.
 */
export function enforceRateLimit(req: Request, scope: Scope, extraHeaders: Record<string, string> = {}): NextResponse | null {
  const { limit, windowMs } = RATE_LIMITS[scope];
  const result = checkRateLimit(callerKey(req, scope), limit, windowMs);
  if (result.ok) return null;
  return jsonError(
    'Vox is receiving too many requests from this device. Please wait a moment and try again.',
    429,
    {
      ...extraHeaders,
      'retry-after': String(result.retryAfterSeconds),
      'x-ratelimit-limit': String(result.limit),
      'x-ratelimit-remaining': '0',
    },
  );
}

/** Reject bodies that advertise more than `maxBytes` before reading them. */
export function contentLengthExceeded(req: Request, maxBytes: number): boolean {
  const raw = req.headers.get('content-length');
  if (!raw) return false;
  const size = Number(raw);
  return Number.isFinite(size) && size > maxBytes;
}

export type BodyResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/** Read and validate a JSON body against a Zod schema, bounded by maxBytes. */
export async function readJsonBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
  maxBytes: number,
  malformedMessage = 'Malformed request.',
  extraHeaders: Record<string, string> = {},
): Promise<BodyResult<z.infer<S>>> {
  if (contentLengthExceeded(req, maxBytes)) {
    return { ok: false, response: jsonError('That request is too large for Vox to process.', 413, extraHeaders) };
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, response: jsonError(malformedMessage, 400, extraHeaders) };
  }
  if (raw.length > maxBytes) {
    return { ok: false, response: jsonError('That request is too large for Vox to process.', 413, extraHeaders) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, response: jsonError(malformedMessage, 400, extraHeaders) };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, response: jsonError(firstIssueMessage(result.error), 400, extraHeaders) };
  }
  return { ok: true, data: result.data };
}

/** A provider call must never outlive this budget, even if the client waits. */
export function providerSignal(clientSignal: AbortSignal, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  type AnyFn = (signals: AbortSignal[]) => AbortSignal;
  const anyFn = (AbortSignal as unknown as { any?: AnyFn }).any;
  if (typeof anyFn === 'function') return anyFn.call(AbortSignal, [clientSignal, timeout]);
  return timeout;
}

export function noStoreJson(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, { ...init, headers: { ...NO_STORE, ...(init?.headers ?? {}) } });
}

export const NO_STORE_HEADERS = NO_STORE;

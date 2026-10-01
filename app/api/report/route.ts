// Server route: user reports of an AI response, for safety review.
//
// Play requires an in-app way to report offensive or inappropriate generated
// content, and the user must not have to leave the app (brief §53). This route is
// the receiving end.
//
// What it deliberately does NOT accept, because the report must be safe to send
// and to store (§54):
//   - no API key, and anything key-shaped is stripped from the text before it
//     leaves this function
//   - no microphone audio
//   - no conversation history, only the single response the user chose
//
// The destination is operator configuration, not user input: an unset webhook is
// reported honestly as "not configured" rather than silently discarding a report.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { version as appPackageVersion } from '../../../package.json';
import { jsonError, enforceRateLimit, corsHeaders, handlePreflight } from '@/lib/server/http';
import { readJsonBody } from '@/lib/server/http';
import { scrubSecrets } from '@/lib/server/redact';
import { checkCustomEndpoint } from '@/lib/server/endpointGuard';
import { LIMITS } from '@/lib/server/limits';

export const runtime = 'nodejs';

/** Deliberately coarse: a reason the user can pick in one tap, not a taxonomy. */
const REASONS = ['harmful', 'sexual', 'hate', 'violence', 'self-harm', 'illegal', 'other'] as const;

const reportSchema = z
  .object({
    reason: z.enum(REASONS),
    note: z.string().max(500).optional().default(''),
    response: z.string().min(1).max(LIMITS.report.maxResponseChars),
    provider: z.string().max(40).optional().default('unknown'),
  })
  .strict();

const WEBHOOK = (process.env.VOXBOX_REPORT_WEBHOOK_URL ?? '').trim();

/** The app version from package.json, so a report can be tied to a build. */
function appVersion(): string {
  return appPackageVersion ?? 'unknown';
}

export async function OPTIONS(req: NextRequest) {
  return handlePreflight(req) ?? jsonError('Method not allowed.', 405);
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req);
  const limited = enforceRateLimit(req, 'report', cors);
  if (limited) return limited;

  const body = await readJsonBody(req, reportSchema, LIMITS.report.bodyBytes, 'KITT could not read that report.', cors);
  if (!body.ok) return body.response;
  const { reason, note, response, provider } = body.data;

  if (!WEBHOOK) {
    // Better a clear failure than a report the user believes was filed.
    return jsonError(
      'Reporting is not switched on for this server yet, so your report was not sent. Nothing was stored.',
      503,
      cors,
    );
  }

  const destination = checkCustomEndpoint(WEBHOOK);
  if (!destination.ok) {
    return jsonError('Reporting is misconfigured on this server.', 500, cors);
  }

  const payload = {
    reason,
    // Scrubbed, because a user may paste anything into the note and a key must
    // never travel to, or rest in, a safety report.
    note: scrubSecrets(note).slice(0, 500),
    response: scrubSecrets(response).slice(0, LIMITS.report.maxResponseChars),
    provider: scrubSecrets(provider).slice(0, 40),
    appVersion: appVersion(),
    reportedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch(`${destination.origin}${new URL(WEBHOOK).pathname}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return jsonError('Your report could not be delivered. Please try again later.', 502, cors);
    }
  } catch {
    return jsonError('Your report could not be delivered. Check your connection and try again.', 502, cors);
  }

  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store', ...cors } });
}

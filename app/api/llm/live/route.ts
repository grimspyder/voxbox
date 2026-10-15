// Server route: the automatic live-lookup leg (Grok web/X search).
//
// The conversation engine calls this only when the user has stored an xAI key
// and the utterance looks like it needs current information. Answering is never
// dependent on this succeeding — the client treats any failure as "answer
// normally" — so it is rate limited and bounded but never allowed to break a turn.
import { NextRequest, NextResponse } from 'next/server';
import { LIMITS } from '@/lib/server/limits';
import { liveSearchRequestSchema } from '@/lib/server/schemas';
import {
  readJsonBody,
  jsonError,
  enforceRateLimit,
  providerSignal,
  NO_STORE_HEADERS,
  corsHeaders,
  handlePreflight,
} from '@/lib/server/http';
import { consumerProviderError } from '@/lib/server/providerErrors';
import { liveSearch } from '@/lib/llm/providers/xaiLive';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  return handlePreflight(req) ?? jsonError('Method not allowed.', 405);
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req);
  const limited = enforceRateLimit(req, 'live', cors);
  if (limited) return limited;

  const body = await readJsonBody(
    req,
    liveSearchRequestSchema,
    LIMITS.live.bodyBytes,
    'Vox could not read that request.',
    cors,
  );
  if (!body.ok) return body.response;
  const { apiKey, model, query, context } = body.data;

  const signal = providerSignal(req.signal, LIMITS.live.timeoutMs);
  try {
    const outcome = await liveSearch({ apiKey, model, query, context: context || undefined, signal });
    return NextResponse.json(outcome, { headers: { ...NO_STORE_HEADERS, ...cors } });
  } catch (e) {
    const { message, status } = consumerProviderError(e);
    return jsonError(message, status, cors);
  }
}

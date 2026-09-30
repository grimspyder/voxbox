// Lists selectable voices for the chosen voice service, so the user picks a
// name from a list instead of pasting a raw voice identifier (§17).
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LIMITS } from '@/lib/server/limits';
import { readJsonBody, jsonError, enforceRateLimit, providerSignal, corsHeaders, handlePreflight } from '@/lib/server/http';
import { consumerVoiceError } from '@/lib/server/providerErrors';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    provider: z.enum(['elevenlabs', 'openai']),
    apiKey: z.string().min(8).max(LIMITS.tts.keyChars),
  })
  .strict();

/** OpenAI's speech voices are a fixed, documented set — no lookup needed. */
const OPENAI_VOICES = [
  { id: 'onyx', label: 'Onyx — deep and steady' },
  { id: 'echo', label: 'Echo — clear and even' },
  { id: 'alloy', label: 'Alloy — neutral' },
  { id: 'fable', label: 'Fable — expressive' },
  { id: 'nova', label: 'Nova — bright' },
  { id: 'shimmer', label: 'Shimmer — soft' },
];

export async function OPTIONS(req: NextRequest) {
  return handlePreflight(req) ?? jsonError('Method not allowed.', 405);
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req);
  const limited = enforceRateLimit(req, 'models', cors);
  if (limited) return limited;

  const body = await readJsonBody(req, bodySchema, 8 * 1024, 'KITT could not read that request.', cors);
  if (!body.ok) return body.response;
  const { provider, apiKey } = body.data;

  if (provider === 'openai') {
    return NextResponse.json(
      { voices: OPENAI_VOICES, requiresChoice: false },
      { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors } },
    );
  }

  const signal = providerSignal(req.signal, 20_000);
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
      signal,
      redirect: 'error',
    });
    if (!res.ok) {
      const { message } = consumerVoiceError(`voice list ${res.status}`);
      const friendly = /rejected/.test(message)
        ? 'That voice key was rejected. Check it and try again.'
        : `Your voice service refused the request (${res.status}).`;
      return jsonError(friendly, 502, cors);
    }
    const json = (await res.json()) as { voices?: { voice_id?: string; name?: string; category?: string }[] };
    const voices = (json.voices ?? [])
      .filter((v): v is { voice_id: string; name?: string; category?: string } => typeof v?.voice_id === 'string')
      .map((v) => ({ id: v.voice_id, label: v.name ? `${v.name}${v.category ? ` — ${v.category}` : ''}` : v.voice_id }));
    if (voices.length === 0) {
      return jsonError('That voice account has no voices available yet.', 502, cors);
    }
    return NextResponse.json(
      { voices, requiresChoice: true },
      { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors } },
    );
  } catch (e) {
    const { message } = consumerVoiceError(e);
    return jsonError(message, 502, cors);
  }
}

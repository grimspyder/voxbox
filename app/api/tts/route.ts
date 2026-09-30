// Server route: TTS proxy (ElevenLabs / OpenAI). Streams audio bytes straight
// through; the key is used server-side only, never logged, never echoed back.
//
// Hardened per §44: the route is rate limited, the body is schema validated,
// and the spoken text is capped so this can never become an unlimited
// arbitrary text-to-speech relay.
import { NextRequest, NextResponse } from 'next/server';
import { LIMITS } from '@/lib/server/limits';
import { ttsRequestSchema } from '@/lib/server/schemas';
import { readJsonBody, jsonError, enforceRateLimit, providerSignal, NO_STORE_HEADERS, corsHeaders, handlePreflight } from '@/lib/server/http';
import { consumerVoiceError } from '@/lib/server/providerErrors';
import { safeUpstreamMessage } from '@/lib/server/redact';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  return handlePreflight(req) ?? jsonError('Method not allowed.', 405);
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req);
  const limited = enforceRateLimit(req, 'tts', cors);
  if (limited) return limited;

  const body = await readJsonBody(req, ttsRequestSchema, LIMITS.tts.bodyBytes, 'Vox could not read that request.', cors);
  if (!body.ok) return body.response;
  const b = body.data;
  const signal = providerSignal(req.signal, LIMITS.providerTimeoutMs);

  try {
    let res: Response;
    if (b.provider === 'elevenlabs') {
      if (!b.voiceId) {
        return jsonError('No Vox voice is selected yet. Choose one in Setup → Voice.', 400, cors);
      }
      res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(b.voiceId)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          signal,
          redirect: 'error',
          headers: {
            'xi-api-key': b.apiKey,
            'content-type': 'application/json',
            accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text: b.text,
            model_id: b.model || 'eleven_turbo_v2_5',
            voice_settings: {
              stability: b.stability,
              similarity_boost: b.similarityBoost,
              style: b.style,
              use_speaker_boost: b.speakerBoost,
              speed: b.speed,
            },
          }),
        },
      );
    } else {
      res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        signal,
        redirect: 'error',
        headers: {
          authorization: `Bearer ${b.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: b.model || 'tts-1',
          voice: b.voiceId || 'onyx',
          input: b.text,
          speed: b.speed,
          response_format: 'mp3',
        }),
      });
    }

    if (!res.ok || !res.body) {
      const raw = await res.text().catch(() => '');
      // Status-only mapping first: never relay provider prose that could echo
      // request content, and never relay headers.
      const mapped = consumerVoiceError(`voice provider error ${res.status} ${raw.slice(0, 400)}`);
      const fallback =
        res.status === 401
          ? 'Your voice key was rejected. Check it in Setup → Voice.'
          : `Your voice service returned an error (${res.status}).`;
      const message = /AI service could not complete/.test(mapped.message)
        ? safeUpstreamMessage(raw, fallback, 160)
        : mapped.message;
      return jsonError(message, 502, cors);
    }
    return new NextResponse(res.body, {
      headers: { ...NO_STORE_HEADERS, ...cors, 'content-type': 'audio/mpeg' },
    });
  } catch (e) {
    const { message, status } = consumerVoiceError(e);
    return jsonError(message, status, cors);
  }
}

// Server route: OpenAI Whisper transcription proxy.
//
// Hardened per §45: bounded upload size, MIME allowlist, provider timeout,
// validated model/language, and rate limiting so a public instance can never be
// used as a free transcription relay.
import { NextRequest, NextResponse } from 'next/server';
import { ALLOWED_AUDIO_MIME_TYPES, LIMITS } from '@/lib/server/limits';
import { jsonError, enforceRateLimit, providerSignal, contentLengthExceeded, corsHeaders, handlePreflight } from '@/lib/server/http';
import { consumerProviderError } from '@/lib/server/providerErrors';

export const runtime = 'nodejs';

const ALLOWED_MODELS = new Set(['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe']);
const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

const EXTENSION_MIME: Record<string, string> = {
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
};

function normaliseMime(type: string, name: string): string {
  const clean = (type || '').split(';')[0].trim().toLowerCase();
  if (clean && clean !== 'application/octet-stream') return clean;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME[ext] ?? clean;
}

export async function OPTIONS(req: NextRequest) {
  return handlePreflight(req) ?? jsonError('Method not allowed.', 405);
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req);
  const fail = (message: string, status: number) => jsonError(message, status, cors);

  const limited = enforceRateLimit(req, 'stt', cors);
  if (limited) return limited;

  const apiKey = (req.headers.get('x-stt-key') ?? '').trim();
  if (!apiKey) {
    return fail(
      'Speech recognition needs an OpenAI key. Add one in Setup → Speech, or use the device microphone instead.',
      401,
    );
  }
  if (apiKey.length > LIMITS.stt.keyChars) return fail('That speech recognition key is not valid.', 400);

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return fail('Speech uploads must be sent as audio form data.', 415);
  }
  if (contentLengthExceeded(req, LIMITS.stt.bodyBytes)) {
    return fail('That recording is too large to transcribe. Try a shorter message.', 413);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('Vox could not read that recording.', 400);
  }

  const file = form.get('audio');
  if (!(file instanceof Blob)) return fail('No recording was supplied.', 400);

  const name = file instanceof File ? file.name : 'audio.webm';
  const mime = normaliseMime(file.type, name);
  if (!(ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(mime)) {
    return fail('That audio format is not supported. Vox accepts webm, ogg, mp4/m4a, mp3, wav or flac.', 415);
  }
  if (file.size === 0) return fail('That recording was empty. Try speaking again.', 400);
  if (file.size > LIMITS.stt.maxAudioBytes) {
    return fail('That recording is too large to transcribe. Try a shorter message.', 413);
  }

  const requestedModel = String(form.get('model') || 'whisper-1');
  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : 'whisper-1';
  const requestedLanguage = String(form.get('language') || 'en');
  const language = LANGUAGE_RE.test(requestedLanguage) ? requestedLanguage : 'en';

  const out = new FormData();
  out.append('file', file, `audio.${mime.split('/')[1] ?? 'webm'}`);
  out.append('model', model);
  out.append('language', language);

  const signal = providerSignal(req.signal, LIMITS.stt.timeoutMs);
  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      signal,
      redirect: 'error',
      headers: { authorization: `Bearer ${apiKey}` },
      body: out,
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      if (res.status === 401) {
        return fail('Your speech recognition key was rejected. Check it in Setup → Speech.', 502);
      }
      if (res.status === 429) {
        return fail('Your speech service is rate limiting Vox. Wait a moment and try again.', 502);
      }
      const { message } = consumerProviderError(`transcription error ${res.status} ${raw.slice(0, 200)}`);
      return fail(message, 502);
    }
    const json = (await res.json().catch(() => null)) as { text?: string } | null;
    return NextResponse.json(
      { text: typeof json?.text === 'string' ? json.text : '' },
      { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors } },
    );
  } catch (e) {
    const { message, status } = consumerProviderError(e);
    const friendly = /did not respond in time|temporarily unavailable|could not reach/.test(message)
      ? 'Vox could not transcribe that recording right now. Check your connection and try again.'
      : message;
    return fail(friendly, status);
  }
}

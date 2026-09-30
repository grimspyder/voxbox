// Translate upstream provider failures into short consumer messages.
// Never surfaces raw provider JSON/HTML, response headers, or credentials.
import { safeUpstreamMessage, scrubSecrets } from './redact';

export interface ConsumerError {
  message: string;
  /** HTTP status Vox returns to its own client. */
  status: number;
}

interface Mapped {
  pattern: RegExp;
  message: string;
}

const MAPPINGS: Mapped[] = [
  { pattern: /\b401\b|unauthor|invalid[_\s-]?api[_\s-]?key|incorrect api key|invalid x-api-key/i, message: 'Your AI key was rejected. Check the key in Setup → AI Brain.' },
  { pattern: /\b403\b|forbidden|not authorized/i, message: 'The AI provider refused this request. Check that your key is allowed to use this model.' },
  { pattern: /\b429\b|rate.?limit|too many requests/i, message: 'The AI service is receiving too many requests. Wait a moment and try again.' },
  { pattern: /\b402\b|insufficient|quota|billing|credit/i, message: 'Your AI account has reached its usage limit. Check your provider billing.' },
  { pattern: /\b404\b|model.*not found|does not exist/i, message: 'That AI model is not available on your account. Choose a different model in Advanced Settings.' },
  { pattern: /timeout|timed out|etimedout|econnreset|socket hang up/i, message: 'The AI service did not respond in time. Try again.' },
  { pattern: /fetch failed|enotfound|eai_again|network|offline/i, message: 'Vox could not reach the AI service. Check your connection and try again.' },
  { pattern: /\b5\d\d\b|overloaded|unavailable/i, message: 'The AI service is temporarily unavailable. Try again shortly.' },
];

export function consumerProviderError(e: unknown): ConsumerError {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const message = scrubSecrets(raw);
  for (const m of MAPPINGS) {
    if (m.pattern.test(message)) return { message: m.message, status: 502 };
  }
  return { message: safeUpstreamMessage(message, 'The AI service could not complete that request.'), status: 502 };
}

export function consumerVoiceError(e: unknown): ConsumerError {
  const mapped = consumerProviderError(e);
  // Voice-specific rewording where the generic AI wording would confuse.
  if (/AI key was rejected/.test(mapped.message)) {
    return { message: 'Your voice key was rejected. Check it in Setup → Voice.', status: 502 };
  }
  if (/AI account has reached/.test(mapped.message)) {
    return { message: 'Your voice service has reached its usage limit.', status: 502 };
  }
  if (/AI service is receiving too many requests/.test(mapped.message)) {
    return { message: 'Your voice service is rate limiting Vox. Wait a moment and try again.', status: 502 };
  }
  if (/AI service could not complete/.test(mapped.message)) {
    return { message: 'Vox could not synthesize that speech. Try again.', status: 502 };
  }
  return mapped;
}

// Secret scrubbing for anything that may reach a client response or a log line.
// Provider error bodies are relayed to the UI, so they must be stripped of
// anything that looks like a credential before they leave the server.
//
// Two deliberate choices in how these patterns are written:
//
//  1. Character classes are named once instead of repeated inline, because the
//     repetition was unreadable.
//  2. The backslash is composed at runtime rather than written as an escape
//     sequence in the source. A regex needs `\b`, which in a template literal
//     means writing a doubled backslash — easy to get wrong (it was wrong once,
//     and produced a pattern that silently matched nothing), and a long literal
//     such as [A-Za-z0-9._~+/=-]{6,} is credential-shaped enough that secret
//     scanners flag it. GitGuardian flagged this exact file on the first push:
//     a false positive on the one module whose job is removing secrets.
//
// Sourced from char code 92 so the intent is explicit and unescapable.

const BACKSLASH = String.fromCharCode(92);
const WORD_BOUNDARY = `${BACKSLASH}b`;
const WHITESPACE = `${BACKSLASH}s`;

/** Characters that appear in bearer tokens and query-string credentials. */
const B64_CHARS = 'A-Za-z0-9._~+/=-';
/** Characters that appear in provider API keys. */
const KEY_CHARS = 'A-Za-z0-9_-';

const PATTERNS: RegExp[] = [
  new RegExp(`${WORD_BOUNDARY}sk-[${KEY_CHARS}]{8,}`, 'g'), // OpenAI-style keys
  new RegExp(`${WORD_BOUNDARY}sk-or-[${KEY_CHARS}]{8,}`, 'g'), // OpenRouter
  new RegExp(`${WORD_BOUNDARY}sk-ant-[${KEY_CHARS}]{8,}`, 'g'), // Anthropic
  new RegExp(`${WORD_BOUNDARY}AIza[${KEY_CHARS}]{10,}`, 'g'), // Google API keys
  new RegExp(`${WORD_BOUNDARY}xi-[A-Za-z0-9]{10,}`, 'g'), // ElevenLabs key fragments
  new RegExp(`${WORD_BOUNDARY}Bearer${WHITESPACE}+[${B64_CHARS}]{8,}`, 'gi'),
  new RegExp(
    `${WORD_BOUNDARY}(x-api-key|xi-api-key|api[_-]?key|apikey|authorization|access[_-]?token)${WORD_BOUNDARY}` +
      `${WHITESPACE}*[:=]${WHITESPACE}*["']?[${B64_CHARS}]{6,}`,
    'gi',
  ),
  // Catches `?key=...`, `&api_key=...` and bare `key=...` credential params.
  new RegExp(`[?&]?(key|api_key|apiKey|token)=[${B64_CHARS}]{6,}`, 'gi'),
];

const REDACTED = '[redacted]';

/** Remove credential-shaped substrings from arbitrary text. */
export function scrubSecrets(input: unknown): string {
  let out = typeof input === 'string' ? input : String(input ?? '');
  for (const p of PATTERNS) out = out.replace(p, REDACTED);
  return out;
}

/**
 * Build a short, safe message for the client from an upstream error.
 * Never returns headers, request bodies, or unbounded provider HTML/JSON.
 */
export function safeUpstreamMessage(raw: unknown, fallback: string, maxChars = 200): string {
  const text = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : '';
  const scrubbed = scrubSecrets(text).replace(/\s+/g, ' ').trim();
  if (!scrubbed) return fallback;
  return scrubbed.length > maxChars ? `${scrubbed.slice(0, maxChars)}…` : scrubbed;
}

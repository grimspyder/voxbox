// Secret scrubbing for anything that may reach a client response or a log line.
// Provider error bodies are relayed to the UI, so they must be stripped of
// anything that looks like a credential before they leave the server.

const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g, // OpenAI-style keys
  /\bsk-or-[A-Za-z0-9_-]{8,}/g, // OpenRouter
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic
  /\bAIza[0-9A-Za-z_-]{10,}/g, // Google API keys
  /\bxi-[A-Za-z0-9]{10,}/g, // ElevenLabs key prefix fragments
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(x-api-key|xi-api-key|api[_-]?key|apikey|authorization|access[_-]?token)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{6,}/gi,
  /[?&](key|api_key|apiKey|token)=[A-Za-z0-9._~+/=-]{6,}/gi,
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

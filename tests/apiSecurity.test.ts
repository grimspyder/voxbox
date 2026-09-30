// SSRF and secret-redaction guards for the public provider proxies.
import { describe, expect, it } from 'vitest';
import { checkCustomEndpoint, isAllowlistedProviderHost } from '@/lib/server/endpointGuard';
import { scrubSecrets, safeUpstreamMessage } from '@/lib/server/redact';
import { checkRateLimit, resetRateLimits } from '@/lib/server/rateLimit';
import { firstIssueMessage, llmRequestSchema, ttsRequestSchema } from '@/lib/server/schemas';
import { z } from 'zod';

const validLlm = {
  provider: 'openai',
  apiKey: 'sk-testtesttesttest',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 300,
  messages: [{ role: 'user', content: 'Hello' }],
};

describe('custom endpoint validation (SSRF)', () => {
  const blocked = [
    'http://localhost:3000/v1',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://127.1/v1',
    'https://0x7f000001/v1',
    'https://2130706433/v1',
    'https://[::1]/v1',
    'https://10.0.0.5/v1',
    'https://172.16.4.4/v1',
    'https://192.168.1.10/v1',
    'https://169.254.169.254/latest/meta-data',
    'https://metadata.google.internal/v1',
    'https://internal.corp/v1',
    'https://[::ffff:192.168.0.1]/v1',
    'ftp://example.com/v1',
    'https://user:pass@example.com/v1',
    'https://example.com:8443/v1',
    'not a url',
    '',
  ];

  it.each(blocked)('rejects %s', (url) => {
    expect(checkCustomEndpoint(url).ok).toBe(false);
  });

  it('accepts a normal public HTTPS endpoint and normalizes to an origin', () => {
    const result = checkCustomEndpoint('https://api.example.com/v1/chat?x=1');
    expect(result.ok).toBe(true);
    expect(result.origin).toBe('https://api.example.com');
  });

  it('only treats the documented provider hosts as allowlisted', () => {
    expect(isAllowlistedProviderHost('https://api.openai.com/v1')).toBe(true);
    expect(isAllowlistedProviderHost('https://api.elevenlabs.io/v1')).toBe(true);
    expect(isAllowlistedProviderHost('https://api.openai.com.evil.test/v1')).toBe(false);
  });
});

describe('secret redaction', () => {
  it('removes credential-shaped substrings', () => {
    const out = scrubSecrets('failed: sk-abcdefghijklmnop sent with Bearer abcdefghijklmnop and key=AIzaSyABCDEFGHIJKLM');
    expect(out).not.toMatch(/sk-abcdefghijklmnop/);
    expect(out).not.toMatch(/abcdefghijklmnop/);
    expect(out).not.toMatch(/AIzaSyABCDEFGHIJKLM/);
  });

  it('truncates upstream messages and never returns an empty string', () => {
    expect(safeUpstreamMessage('x'.repeat(500), 'fallback', 40)).toHaveLength(41);
    expect(safeUpstreamMessage('', 'fallback')).toBe('fallback');
  });
});

describe('rate limiting', () => {
  it('allows up to the limit then blocks with a retry delay', () => {
    resetRateLimits();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit('k', 3, 60_000, now).ok).toBe(true);
    }
    const blocked = checkRateLimit('k', 3, 60_000, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('frees the window once it slides past', () => {
    resetRateLimits();
    expect(checkRateLimit('k', 1, 1000, 0).ok).toBe(true);
    expect(checkRateLimit('k', 1, 1000, 500).ok).toBe(false);
    expect(checkRateLimit('k', 1, 1000, 1500).ok).toBe(true);
  });
});

describe('request schemas', () => {
  it('accepts a normal chat request', () => {
    expect(llmRequestSchema.safeParse(validLlm).success).toBe(true);
  });

  const badLlm: [string, Record<string, unknown>][] = [
    ['unknown provider', { ...validLlm, provider: 'evil' }],
    ['demo provider is client-side only', { ...validLlm, provider: 'demo' }],
    ['missing key', { ...validLlm, apiKey: undefined }],
    ['short key', { ...validLlm, apiKey: 'abc' }],
    ['huge maxTokens', { ...validLlm, maxTokens: 1_000_000 }],
    ['negative temperature', { ...validLlm, temperature: -1 }],
    ['oversized single message', { ...validLlm, messages: [{ role: 'user', content: 'x'.repeat(5000) }] }],
    ['oversized conversation', {
      ...validLlm,
      messages: Array.from({ length: 30 }, () => ({ role: 'user', content: 'y'.repeat(2000) })),
    }],
    ['too many messages', {
      ...validLlm,
      messages: Array.from({ length: 60 }, () => ({ role: 'user', content: 'hi' })),
    }],
    ['oversized system prompt', { ...validLlm, messages: [{ role: 'system', content: 'z'.repeat(9000) }] }],
    ['unknown transport field', { ...validLlm, __proto__hack: true }],
  ];

  it.each(badLlm)('rejects %s', (_label, body) => {
    const result = llmRequestSchema.safeParse(body);
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssueMessage(result.error).length).toBeGreaterThan(0);
  });

  it('defaults missing TTS tuning values instead of rejecting them', () => {
    const parsed = ttsRequestSchema.parse({ provider: 'openai', apiKey: 'sk-testtesttesttest', text: 'Hello' });
    expect(parsed.speed).toBe(1);
    expect(parsed.voiceId).toBe('');
  });

  it('rejects unsupported TTS providers and oversized speech', () => {
    expect(ttsRequestSchema.safeParse({ provider: 'browser', apiKey: 'sk-testtesttesttest', text: 'hi' }).success).toBe(false);
    expect(
      ttsRequestSchema.safeParse({ provider: 'openai', apiKey: 'sk-testtesttesttest', text: 'x'.repeat(2000) }).success,
    ).toBe(false);
  });

  it('maps unknown providers to consumer wording', () => {
    const result = llmRequestSchema.safeParse({ ...validLlm, provider: 'evil' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstIssueMessage(result.error)).toMatch(/not supported/i);
      expect(firstIssueMessage(result.error)).not.toMatch(/enum/i);
    }
  });

  it('reports a friendly message when zod flags an unknown field', () => {
    const error = new z.ZodError([
      { code: z.ZodIssueCode.unrecognized_keys, keys: ['x'], path: [], message: 'Unrecognized key(s) in object: x' },
    ]);
    expect(firstIssueMessage(error)).toMatch(/unsupported fields/i);
  });
});

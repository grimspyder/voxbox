// @vitest-environment node
// Route-level behaviour of the three public proxies. Every case here is one
// that must be rejected BEFORE any provider call is attempted, so these tests
// never touch the network.
//
// Runs in the node environment (not jsdom): NextRequest's multipart body
// parsing needs Node's own FormData/Blob implementation.
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as llmPost, OPTIONS as llmOptions } from '@/app/api/llm/route';
import { POST as ttsPost } from '@/app/api/tts/route';
import { POST as sttPost } from '@/app/api/stt/route';
import { contentLengthExceeded } from '@/lib/server/http';
import { resetRateLimits } from '@/lib/server/rateLimit';

const KEY = 'sk-testtesttesttesttest';

let install = 0;
function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://voxbox.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-voxbox-install-id': `test${install}`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const validLlmBody = {
  provider: 'openai',
  apiKey: KEY,
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 300,
  messages: [{ role: 'user', content: 'Hello' }],
};

beforeEach(() => {
  install += 1;
  resetRateLimits();
});

async function message(res: Response): Promise<string> {
  const json = (await res.json()) as { error?: string };
  return json.error ?? '';
}

describe('POST /api/llm', () => {
  it('rejects malformed JSON with a consumer-readable message', async () => {
    const res = await llmPost(jsonRequest('/api/llm', '{not json'));
    expect(res.status).toBe(400);
    expect(await message(res)).toMatch(/could not read that request/i);
  });

  it('rejects an unsupported provider', async () => {
    const res = await llmPost(jsonRequest('/api/llm', { ...validLlmBody, provider: 'evilcorp' }));
    expect(res.status).toBe(400);
    expect(await message(res)).toMatch(/not supported/i);
  });

  it('rejects the client-side demo provider on the server', async () => {
    const res = await llmPost(jsonRequest('/api/llm', { ...validLlmBody, provider: 'demo' }));
    expect(res.status).toBe(400);
  });

  it('rejects a missing key', async () => {
    const res = await llmPost(jsonRequest('/api/llm', { ...validLlmBody, apiKey: '' }));
    expect(res.status).toBe(400);
  });

  it('rejects an oversized message before calling any provider', async () => {
    const res = await llmPost(
      jsonRequest('/api/llm', { ...validLlmBody, messages: [{ role: 'user', content: 'x'.repeat(6000) }] }),
    );
    expect(res.status).toBe(400);
    expect(await message(res)).toMatch(/too long/i);
  });

  it('rejects an absurd maxTokens', async () => {
    const res = await llmPost(jsonRequest('/api/llm', { ...validLlmBody, maxTokens: 999999 }));
    expect(res.status).toBe(400);
  });

  it('refuses arbitrary custom endpoints in the consumer build (SSRF)', async () => {
    const res = await llmPost(
      jsonRequest('/api/llm', {
        ...validLlmBody,
        provider: 'openai-compatible',
        baseUrl: 'https://169.254.169.254/latest/meta-data',
      }),
    );
    expect(res.status).toBe(403);
    expect(await message(res)).toMatch(/disabled in this build|custom ai endpoints/i);
  });

  it('rejects unknown fields rather than passing them upstream', async () => {
    const res = await llmPost(jsonRequest('/api/llm', { ...validLlmBody, hidden: 'payload' }));
    expect(res.status).toBe(400);
    expect(await message(res)).toMatch(/unsupported fields/i);
  });

  it('rate limits repeated requests from one installation', async () => {
    const headers = { 'x-voxbox-install-id': 'fixed-install' };
    let last = 0;
    for (let i = 0; i < 32; i++) {
      const res = await llmPost(jsonRequest('/api/llm', { ...validLlmBody, provider: 'nope' }, headers));
      last = res.status;
    }
    expect(last).toBe(429);
  });

  // The test above passes even if the installation header is ignored, because
  // every request would simply share one bucket. This one fails in that case,
  // which is the point: it asserts the header is actually read for keying.
  it('gives each installation its own budget rather than one shared bucket', async () => {
    const first = { 'x-voxbox-install-id': 'installation-one' };
    for (let i = 0; i < 31; i++) {
      await llmPost(jsonRequest('/api/llm', { ...validLlmBody, provider: 'nope' }, first));
    }
    const other = await llmPost(
      jsonRequest('/api/llm', { ...validLlmBody, provider: 'nope' }, { 'x-voxbox-install-id': 'installation-two' }),
    );
    expect(other.status).not.toBe(429);
  });

  it('answers CORS preflight with 204', async () => {
    const res = await llmOptions(new NextRequest('https://voxbox.test/api/llm', { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
  });
});

describe('POST /api/tts', () => {
  const valid = { provider: 'openai', apiKey: KEY, text: 'Voice systems online.', voiceId: 'onyx', model: 'tts-1' };

  it('rejects an unsupported voice provider', async () => {
    const res = await ttsPost(jsonRequest('/api/tts', { ...valid, provider: 'browser' }));
    expect(res.status).toBe(400);
  });

  it('rejects an oversized speech segment (§44)', async () => {
    const res = await ttsPost(jsonRequest('/api/tts', { ...valid, text: 'x'.repeat(1500) }));
    expect(res.status).toBe(400);
    expect(await message(res)).toMatch(/too long to speak/i);
  });

  it('rejects empty speech', async () => {
    const res = await ttsPost(jsonRequest('/api/tts', { ...valid, text: '   ' }));
    expect(res.status).toBe(400);
  });

  it('tells the user to pick a voice when ElevenLabs has no voiceId', async () => {
    const res = await ttsPost(jsonRequest('/api/tts', { ...valid, provider: 'elevenlabs', voiceId: '' }));
    expect(res.status).toBe(400);
    expect(await message(res)).toMatch(/choose one in setup/i);
  });

  it('rejects a missing key', async () => {
    const res = await ttsPost(jsonRequest('/api/tts', { ...valid, apiKey: 'nope' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/stt', () => {
  function audioRequest(options: {
    key?: string | null;
    contentType?: string;
    audio?: Blob | string;
    name?: string;
  }): NextRequest {
    const { key = KEY, contentType = 'multipart/form-data', audio, name = 'speech.webm' } = options;
    if (contentType !== 'multipart/form-data') {
      return new NextRequest('https://voxbox.test/api/stt', {
        method: 'POST',
        headers: { 'content-type': contentType, ...(key ? { 'x-stt-key': key } : {}), 'x-voxbox-install-id': `test${install}` },
        body: 'raw',
      });
    }
    const form = new FormData();
    if (audio !== undefined) {
      const blob = typeof audio === 'string' ? new Blob([new Uint8Array([1, 2, 3])], { type: audio }) : audio;
      form.append('audio', blob, name);
    }
    return new NextRequest('https://voxbox.test/api/stt', {
      method: 'POST',
      headers: { ...(key ? { 'x-stt-key': key } : {}), 'x-voxbox-install-id': `test${install}` },
      body: form,
    });
  }

  it('requires a key with a friendly explanation', async () => {
    const res = await sttPost(audioRequest({ key: null, audio: 'audio/webm' }));
    expect(res.status).toBe(401);
    expect(await message(res)).toMatch(/needs an openai key/i);
  });

  it('rejects non-multipart uploads', async () => {
    const res = await sttPost(audioRequest({ contentType: 'application/json' }));
    expect(res.status).toBe(415);
  });

  it('rejects a missing recording', async () => {
    const res = await sttPost(audioRequest({}));
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported audio MIME type', async () => {
    const res = await sttPost(audioRequest({ audio: 'audio/x-ms-wma', name: 'clip.wma' }));
    expect(res.status).toBe(415);
    expect(await message(res)).toMatch(/format is not supported/i);
  });

  it('rejects an empty recording', async () => {
    const res = await sttPost(audioRequest({ audio: new Blob([], { type: 'audio/webm' }) }));
    expect(res.status).toBe(400);
  });

  it('refuses bodies that declare an oversized upload', () => {
    const big = new Request('https://voxbox.test/api/stt', {
      method: 'POST',
      headers: { 'content-length': String(64 * 1024 * 1024) },
    });
    expect(contentLengthExceeded(big, 12 * 1024 * 1024)).toBe(true);
    const small = new Request('https://voxbox.test/api/stt', {
      method: 'POST',
      headers: { 'content-length': '1024' },
    });
    expect(contentLengthExceeded(small, 12 * 1024 * 1024)).toBe(false);
  });
});

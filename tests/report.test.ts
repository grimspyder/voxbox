// @vitest-environment node
// Reporting a response: the route's rules and the client's disclosure.
//
// The security-relevant assertions are the ones about what is NOT in a report:
// no API key, and anything key-shaped stripped from text the user controls.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetRateLimits } from '@/lib/server/rateLimit';
import { REPORT_REASONS, disclosureLines, isReadyToSend, submitReport } from '@/lib/safety/report';

const WEBHOOK = 'https://hooks.example.com/voxbox-reports';

function reportRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://voxbox.test/api/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-voxbox-install-id': 'report-test', ...headers },
    body: JSON.stringify(body),
  });
}

const validBody = {
  reason: 'harmful',
  note: 'Suggested something unsafe',
  response: 'Vox said something it should not have.',
  provider: 'openai',
};

async function loadRoute(webhook: string | undefined) {
  vi.resetModules();
  if (webhook) process.env.VOXBOX_REPORT_WEBHOOK_URL = webhook;
  else delete process.env.VOXBOX_REPORT_WEBHOOK_URL;
  return import('@/app/api/report/route');
}

async function message(res: Response): Promise<string> {
  const json = (await res.json()) as { error?: string };
  return json.error ?? '';
}

beforeEach(() => {
  resetRateLimits();
  vi.unstubAllGlobals();
});

describe('what a report will not carry', () => {
  it('strips anything key-shaped from the note and the response before sending', async () => {
    const { POST } = await loadRoute(WEBHOOK);
    const forward = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', forward);

    const res = await POST(
      reportRequest({
        ...validBody,
        note: 'their key sk-abcdefghijklmnop was visible in the text',
        response: 'AIzaSyABCDEFGHIJKLM appeared in the reply',
      }),
    );
    expect(res.status).toBe(200);

    const [, init] = forward.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(String(init.body)) as { note: string; response: string };
    expect(sent.note).not.toContain('sk-abcdefghijklmnop');
    expect(sent.response).not.toContain('AIzaSyABCDEFGHIJKLM');
    expect(sent.note).toContain('[redacted]');
  });

  it('sends only the single response, the reason, the note, the provider and the version', async () => {
    const { POST } = await loadRoute(WEBHOOK);
    const forward = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', forward);

    await POST(reportRequest(validBody));
    const [, init] = forward.mock.calls[0] as unknown as [string, RequestInit];
    expect(Object.keys(JSON.parse(String(init.body))).sort()).toEqual(
      ['appVersion', 'note', 'provider', 'reason', 'reportedAt', 'response'].sort(),
    );
  });

  it('has no field for audio, history or credentials at all', async () => {
    const { POST } = await loadRoute(WEBHOOK);
    const res = await POST(reportRequest({ ...validBody, audio: 'base64…', history: [], apiKey: 'sk-x' }));
    // Strict schema: an attempt to smuggle any of them is rejected outright.
    expect(res.status).toBe(400);
  });
});

describe('the route validates before it will send anything', () => {
  it('rejects an unknown reason', async () => {
    const { POST } = await loadRoute(WEBHOOK);
    const res = await POST(reportRequest({ ...validBody, reason: 'not-a-reason' }));
    expect(res.status).toBe(400);
  });

  it('rejects an empty response', async () => {
    const { POST } = await loadRoute(WEBHOOK);
    const res = await POST(reportRequest({ ...validBody, response: '' }));
    expect(res.status).toBe(400);
  });

  it('rejects an oversized note and an oversized response', async () => {
    const { POST } = await loadRoute(WEBHOOK);
    expect((await POST(reportRequest({ ...validBody, note: 'x'.repeat(501) }))).status).toBe(400);
    expect((await POST(reportRequest({ ...validBody, response: 'x'.repeat(5000) }))).status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const { POST } = await loadRoute(WEBHOOK);
    const res = await POST(
      new NextRequest('https://voxbox.test/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('an unconfigured server says so instead of swallowing the report', () => {
  it('returns 503 and tells the user nothing was sent', async () => {
    const { POST } = await loadRoute(undefined);
    const res = await POST(reportRequest(validBody));
    expect(res.status).toBe(503);
    const text = await message(res);
    expect(text).toMatch(/not switched on/i);
    expect(text).toMatch(/nothing was stored/i);
  });
});

describe('a configured server forwards and honours its limits', () => {
  it('reports a delivery failure rather than claiming success', async () => {
    const { POST } = await loadRoute(WEBHOOK);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const res = await POST(reportRequest(validBody));
    expect(res.status).toBe(502);
    expect(await message(res)).toMatch(/could not be delivered/i);
  });

  it('refuses a webhook that points somewhere private', async () => {
    // An operator misconfiguration should fail closed, not become an SSRF lever.
    const { POST } = await loadRoute('https://169.254.169.254/latest/meta-data');
    const res = await POST(reportRequest(validBody));
    expect(res.status).toBe(500);
  });

  it('rate limits repeated reporting from one installation', async () => {
    const { POST } = await loadRoute(WEBHOOK);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    let last = 0;
    for (let i = 0; i < 7; i++) {
      last = (await POST(reportRequest(validBody))).status;
    }
    expect(last).toBe(429);
  });
});

describe('the disclosure the user reads before sending', () => {
  it('names the provider actually in use, and is explicit about what is excluded', () => {
    const lines = disclosureLines({ reason: 'harmful', note: '', response: 'text', provider: 'gemini' });
    expect(lines.sent.join(' ')).toContain('gemini');
    expect(lines.notSent.join(' ')).toMatch(/never included/i);
    expect(lines.notSent.join(' ')).toMatch(/microphone audio/i);
  });

  it('will not send without a reason', () => {
    expect(isReadyToSend({ reason: '', note: '', response: 'text', provider: 'demo' })).toBe(false);
    expect(isReadyToSend({ reason: 'other', note: '', response: 'text', provider: 'demo' })).toBe(true);
  });

  it('offers reasons that are plain language', () => {
    for (const reason of REPORT_REASONS) {
      expect(reason.label.length).toBeGreaterThan(6);
    }
  });
});

describe('the client helper', () => {
  it('maps a refusal to a message the user can act on', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Reporting is not switched on for this server yet, so your report was not sent. Nothing was stored.' }), { status: 503 })),
    );
    const outcome = await submitReport({ reason: 'other', note: '', response: 'text', provider: 'demo' });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/not switched on/i);
  });

  it('maps a network failure without leaking a stack trace', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    const outcome = await submitReport({ reason: 'other', note: '', response: 'text', provider: 'demo' });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).not.toMatch(/TypeError|undefined/);
  });
});

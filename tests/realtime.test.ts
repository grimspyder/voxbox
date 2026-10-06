// Automatic live-answer tests: the recency heuristic, the request contract, the
// xAI Responses-API parsing, and — most importantly — that the feature fails
// open. A turn must never depend on a live lookup succeeding.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationEngine } from '@/lib/conversation/engine';
import { DEFAULT_SETTINGS, KITTSettings } from '@/lib/config/settings';
import { needsRealtime } from '@/lib/llm/realtime';
import { buildMessages } from '@/lib/llm/client';
import { liveSearch } from '@/lib/llm/providers/xaiLive';
import { liveSearchRequestSchema } from '@/lib/server/schemas';

// --- minimal outside-world stubs (the engine opens a mic on start) -----------

class FakeAudioContext {
  state = 'running';
  sampleRate = 44100;
  currentTime = 0;
  destination = {};
  createAnalyser() {
    return { fftSize: 1024, smoothingTimeConstant: 0, frequencyBinCount: 512, getFloatTimeDomainData(a: Float32Array) { a.fill(0); }, getByteFrequencyData(a: Uint8Array) { a.fill(0); }, connect() {}, disconnect() {} };
  }
  createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} };
  }
  createBiquadFilter() {
    return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() { return this; }, disconnect() {} };
  }
  createMediaStreamSource() {
    return { connect() { return this; }, disconnect() {} };
  }
  createMediaStreamDestination() {
    return { stream: { getTracks: () => [{ stop() {} }] } };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

class FakeRecognition {
  continuous = false;
  interimResults = true;
  lang = 'en-US';
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start() {}
  stop() {}
}

class FakeUtterance {
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public text: string) {}
}

const liveEngines: ConversationEngine[] = [];

function installStubs() {
  const w = window as unknown as Record<string, unknown>;
  w.AudioContext = FakeAudioContext;
  w.SpeechRecognition = FakeRecognition;
  w.webkitSpeechRecognition = FakeRecognition;
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop() {} }], getAudioTracks: () => [{ label: 'fake mic', stop() {} }] }),
      enumerateDevices: async () => [],
    },
    configurable: true,
  });
  const fakeSpeech = { speak: (u: FakeUtterance) => setTimeout(() => u.onend?.(), 5), cancel() {}, getVoices: () => [] };
  w.speechSynthesis = fakeSpeech;
  vi.stubGlobal('speechSynthesis', fakeSpeech);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
}

function testSettings(overrides: Partial<KITTSettings> = {}): KITTSettings {
  return {
    ...DEFAULT_SETTINGS,
    llm: { ...DEFAULT_SETTINGS.llm, provider: 'demo' },
    tts: { ...DEFAULT_SETTINGS.tts, provider: 'browser' },
    stt: { ...DEFAULT_SETTINGS.stt, provider: 'browser' },
    ...overrides,
  };
}

interface LiveSpy {
  calls: string[];
}

/** Stub fetch: count /api/llm/live hits; optionally always fail. */
function stubFetch(opts: { failLive?: boolean } = {}): LiveSpy {
  const spy: LiveSpy = { calls: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/llm/live')) {
        spy.calls.push(url);
        if (opts.failLive) throw new TypeError('network down');
        return new Response(
          JSON.stringify({ searched: true, summary: 'Tesla stock is up 3% today.', citations: [{ title: 'Example', url: 'https://example.com' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // The demo brain never calls the network; anything else is a test bug.
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return spy;
}

/** Poll until the predicate holds, so the assertions avoid exact timing. */
async function until(predicate: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  installStubs();
});

afterEach(() => {
  // An engine left running keeps its listen timer alive and leaks into the next
  // test's microphone counter.
  for (const e of liveEngines.splice(0)) e.stop();
  vi.unstubAllGlobals();
});

describe('needsRealtime heuristic', () => {
  it('flags questions that only have a post-training answer', () => {
    for (const q of [
      'what is the latest news about Tesla',
      "who won the game last night",
      'what is the price of bitcoin right now',
      "what's the weather tomorrow",
      'when is the new iPhone release date',
      'any updates on the election',
    ]) {
      expect(needsRealtime(q), q).toBe(true);
    }
  });

  it('leaves ordinary conversation and personal statements alone', () => {
    for (const q of [
      'hi',
      'thanks',
      'tell me a joke',
      'what is the capital of France',
      'how do I make pasta',
      'explain the theory of relativity',
      'my name is Felix',
    ]) {
      expect(needsRealtime(q), q).toBe(false);
    }
  });

  it('treats a bare greeting as never needing the web', () => {
    expect(needsRealtime('hello')).toBe(false);
    expect(needsRealtime('good morning')).toBe(false);
  });
});

describe('live search request contract', () => {
  it('accepts a valid lookup', () => {
    const r = liveSearchRequestSchema.safeParse({ apiKey: 'xai-abcdefgh', query: 'latest news' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown fields, so a caller cannot smuggle one past the schema', () => {
    const r = liveSearchRequestSchema.safeParse({ apiKey: 'xai-abcdefgh', query: 'latest news', extra: 1 });
    expect(r.success).toBe(false);
  });

  it('rejects an over-long query', () => {
    const r = liveSearchRequestSchema.safeParse({ apiKey: 'xai-abcdefgh', query: 'x'.repeat(600) });
    expect(r.success).toBe(false);
  });
});

describe('buildMessages', () => {
  it('inserts a live note as a private system message ahead of the history', () => {
    const msgs = buildMessages('PERSONA', [{ role: 'user', content: 'hi' }], 'FACTS HERE');
    expect(msgs[0]).toEqual({ role: 'system', content: 'PERSONA' });
    expect(msgs[1]).toEqual({ role: 'system', content: 'FACTS HERE' });
    expect(msgs[2]).toEqual({ role: 'user', content: 'hi' });
  });

  it('is unchanged when there is no note', () => {
    const msgs = buildMessages('PERSONA', [{ role: 'user', content: 'hi' }]);
    expect(msgs).toHaveLength(2);
  });
});

describe('xaiLive parsing', () => {
  it('extracts the summary and url citations from a Responses body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'Tesla is up 3% today.',
                    annotations: [
                      { type: 'url_citation', url: 'https://news.example/a', title: 'A' },
                      { type: 'url_citation', url: 'https://news.example/a', title: 'dupe' },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const out = await liveSearch({ apiKey: 'xai-abcdefgh', query: 'tesla' });
    expect(out.searched).toBe(true);
    expect(out.summary).toContain('Tesla');
    expect(out.citations).toHaveLength(1); // duplicate URL de-duplicated
  });

  it('reports searched:false when the model answers NONE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'NONE' }] }] }), { status: 200 })),
    );
    const out = await liveSearch({ apiKey: 'xai-abcdefgh', query: 'capital of France' });
    expect(out.searched).toBe(false);
    expect(out.summary).toBe('');
    expect(out.citations).toHaveLength(0);
  });
});

describe('engine automatic live answers', () => {
  it('does not look anything up when no Grok key is stored', async () => {
    const spy = stubFetch();
    const engine = new ConversationEngine(testSettings());
    liveEngines.push(engine);
    await engine.start({ onError: () => {} });
    void engine.handleUtterance('what is the latest news about Tesla', 'text');
    await until(() => true, 400); // give it a beat
    expect(spy.calls).toHaveLength(0);
  });

  it('looks up a current-events question once when a Grok key is stored', async () => {
    const spy = stubFetch();
    const settings = testSettings();
    settings.llm = { ...settings.llm, searchEnabled: true, searchApiKey: 'xai-test-key-placeholder' };
    const engine = new ConversationEngine(settings);
    liveEngines.push(engine);
    await engine.start({ onError: () => {} });
    void engine.handleUtterance('what is the latest news about Tesla', 'text');
    await until(() => spy.calls.length > 0);
    expect(spy.calls).toHaveLength(1);
  });

  it('does not look up an ordinary question even with a key stored', async () => {
    const spy = stubFetch();
    const settings = testSettings();
    settings.llm = { ...settings.llm, searchEnabled: true, searchApiKey: 'xai-test-key-placeholder' };
    const engine = new ConversationEngine(settings);
    liveEngines.push(engine);
    await engine.start({ onError: () => {} });
    void engine.handleUtterance('tell me a joke', 'text');
    await until(() => true, 400);
    expect(spy.calls).toHaveLength(0);
  });

  it('fails open: a live lookup that throws still lets the turn answer', async () => {
    stubFetch({ failLive: true });
    const settings = testSettings();
    settings.llm = { ...settings.llm, searchEnabled: true, searchApiKey: 'xai-test-key-placeholder' };
    const errors: string[] = [];
    const engine = new ConversationEngine(settings);
    liveEngines.push(engine);
    await engine.start({ onError: (m) => errors.push(m) });
    await engine.handleUtterance('what is the latest news about Tesla', 'text');
    // The turn completed through the ordinary (demo) brain and surfaced no error
    // attributable to the lookup.
    expect(errors.filter((e) => /live|search/i.test(e))).toHaveLength(0);
  }, 15000);
});

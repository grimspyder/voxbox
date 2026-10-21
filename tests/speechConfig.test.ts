import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationEngine } from '@/lib/conversation/engine';
import { DEFAULT_SETTINGS, KITTSettings } from '@/lib/config/settings';
import { chatOpenRouterKey, resolveSpeechConfig, speechKeyFallback } from '@/lib/stt/speechConfig';

/**
 * The app keeps the chat key and the speech key in separate slots, and the SPEECH
 * screen offers "OpenRouter Whisper (same key as chat)". A user who moved chat to
 * OpenRouter kept the old OpenAI key in the speech slot, so Whisper was sent a key
 * they had already replaced and the app told them OpenAI had rejected it. These
 * tests pin the two halves of the fix: speech follows the chat key, and a rejected
 * speech key falls back to it once instead of dead-ending the conversation.
 */
const OPENAI_KEY = 'sk-proj-' + 'A'.repeat(156);
const OPENROUTER_KEY = 'sk-or-v1-' + 'b'.repeat(64);

function settings(patch: {
  llm?: Partial<KITTSettings['llm']>;
  stt?: Partial<KITTSettings['stt']>;
}): KITTSettings {
  return {
    ...DEFAULT_SETTINGS,
    llm: { ...DEFAULT_SETTINGS.llm, ...patch.llm },
    stt: { ...DEFAULT_SETTINGS.stt, ...patch.stt },
  };
}

const openRouterChat = { provider: 'openrouter' as const, apiKey: OPENROUTER_KEY, model: 'openai/gpt-4o-mini' };

describe('which key serves speech recognition', () => {
  it('uses the chat key when OpenRouter Whisper is chosen, ignoring a stale copy', () => {
    const r = resolveSpeechConfig(
      settings({ llm: openRouterChat, stt: { provider: 'openrouter', apiKey: OPENAI_KEY } }),
    );
    expect(r.provider).toBe('openrouter');
    expect(r.apiKey).toBe(OPENROUTER_KEY);
    expect(r.source).toBe('chat');
    // OpenRouter rejects bare ids like `whisper-1`.
    expect(r.model).toBe('openai/whisper-large-v3');
  });

  it('uses the chat key when OpenRouter speech has no key of its own', () => {
    const r = resolveSpeechConfig(settings({ llm: openRouterChat, stt: { provider: 'openrouter', apiKey: '' } }));
    expect(r.apiKey).toBe(OPENROUTER_KEY);
    expect(r.source).toBe('chat');
  });

  it('leaves a deliberate OpenAI speech key alone', () => {
    const r = resolveSpeechConfig(
      settings({
        llm: openRouterChat,
        stt: { provider: 'openai', apiKey: OPENAI_KEY, model: 'whisper-1' },
      }),
    );
    expect(r.provider).toBe('openai');
    expect(r.apiKey).toBe(OPENAI_KEY);
    expect(r.model).toBe('whisper-1');
    expect(r.source).toBe('speech');
  });

  it('does not touch browser recognition', () => {
    const r = resolveSpeechConfig(settings({ llm: openRouterChat, stt: { provider: 'browser' } }));
    expect(r.provider).toBe('browser');
    expect(r.source).toBe('speech');
  });

  it('ignores a chat key that is not an OpenRouter key', () => {
    expect(chatOpenRouterKey(settings({ llm: { provider: 'openrouter', apiKey: OPENAI_KEY } }))).toBe('');
    expect(chatOpenRouterKey(settings({ llm: { provider: 'openai', apiKey: OPENROUTER_KEY } }))).toBe('');
  });
});

describe('falling back when the speech key is rejected', () => {
  const rejected = 'OpenAI rejected this key. It may have been revoked or regenerated since you saved it, so copy the current key from platform.openai.com/api-keys. (sent: sk-proj…abcd, 164 chars)';
  const speech = resolveSpeechConfig(settings({ llm: openRouterChat, stt: { provider: 'openai', apiKey: OPENAI_KEY } }));

  it('retries once with the OpenRouter chat key', () => {
    const retry = speechKeyFallback(speech, settings({ llm: openRouterChat, stt: { provider: 'openai', apiKey: OPENAI_KEY } }), rejected);
    expect(retry?.apiKey).toBe(OPENROUTER_KEY);
    expect(retry?.provider).toBe('openrouter');
    expect(retry?.model).toBe('openai/whisper-large-v3');
  });

  it('does not retry a network fault or a rate limit', () => {
    const base = settings({ llm: openRouterChat, stt: { provider: 'openai', apiKey: OPENAI_KEY } });
    expect(speechKeyFallback(speech, base, 'Vox could not transcribe that recording right now.')).toBeNull();
    expect(speechKeyFallback(speech, base, 'Your speech service is rate limiting Vox.')).toBeNull();
  });

  it('does not retry in a loop when the chat key was already used', () => {
    const base = settings({ llm: openRouterChat, stt: { provider: 'openrouter' } });
    const viaChat = resolveSpeechConfig(base);
    expect(viaChat.source).toBe('chat');
    expect(speechKeyFallback(viaChat, base, rejected)).toBeNull();
  });

  it('has nothing to fall back to when chat is not OpenRouter', () => {
    const base = settings({ llm: { provider: 'openai', apiKey: OPENAI_KEY }, stt: { provider: 'openai', apiKey: OPENAI_KEY } });
    expect(speechKeyFallback(resolveSpeechConfig(base), base, rejected)).toBeNull();
  });
});

describe('the engine actually retries the transcription', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the rejected key once, then the chat key, and tells the user', async () => {
    const base = settings({ llm: openRouterChat, stt: { provider: 'openai', apiKey: OPENAI_KEY } });
    type Internals = {
      handlers: { onNotice?: (m: string) => void };
      transcribeWithFallback: (b: Blob, s: ReturnType<typeof resolveSpeechConfig>) => Promise<string>;
      stop: () => void;
    };
    const engine = new ConversationEngine(base) as unknown as Internals;
    const notices: string[] = [];
    engine.handlers.onNotice = (m) => notices.push(m);

    const keys: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const sent = new Headers(init.headers).get('x-stt-key') ?? '';
        keys.push(sent);
        if (sent === OPENAI_KEY) {
          // Exactly what /api/stt returns when OpenAI answers 401.
          return new Response(
            JSON.stringify({ error: 'OpenAI rejected this key. It may have been revoked or regenerated since you saved it. (sent: sk-proj…abcd, 164 chars)' }),
            { status: 502, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ text: 'hello' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );

    const speech = resolveSpeechConfig(base);
    const text = await engine.transcribeWithFallback(new Blob(['x']), speech);

    expect(text).toBe('hello');
    expect(keys).toEqual([OPENAI_KEY, OPENROUTER_KEY]);
    expect(notices[0]).toMatch(/OpenRouter key/i);
    expect(notices[0]).toMatch(/rejected/i);
    engine.stop();
  });
});

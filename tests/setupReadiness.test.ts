// The wizard's verdicts and the provider/model selection helpers.
// Pure logic only — no browser, no microphone, no network.
import { describe, expect, it } from 'vitest';
import { buildSystemCheck, firstBlockerSentence, summariseCheck, SetupFacts } from '@/lib/setup/readiness';
import { chooseModel, isChatModel, PROVIDER_CARDS, providerCard } from '@/lib/config/providers';

function facts(overrides: Partial<SetupFacts> = {}): SetupFacts {
  return {
    mode: 'full',
    llmProvider: 'openai',
    llmKeyPresent: true,
    llmVerified: true,
    ttsProvider: 'openai',
    voiceId: 'onyx',
    ttsVerified: true,
    micPermission: 'granted',
    audioOutputReady: true,
    online: true,
    ...overrides,
  };
}

function statusOf(items: ReturnType<typeof buildSystemCheck>, id: string): string | undefined {
  return items.find((i) => i.id === id)?.status;
}

describe('system check', () => {
  it('reports a fully configured system as ready with everything passing', () => {
    const items = buildSystemCheck(facts());
    expect(summariseCheck(items).ready).toBe(true);
    expect(summariseCheck(items).passed).toBe(items.length);
    expect(firstBlockerSentence(summariseCheck(items))).toBeNull();
  });

  it('treats demo mode as a working AI brain with no service needed', () => {
    const items = buildSystemCheck(facts({ mode: 'demo', llmProvider: 'demo', llmKeyPresent: false, llmVerified: false }));
    expect(statusOf(items, 'ai')).toBe('ok');
    expect(items.find((i) => i.id === 'ai')?.detail).toMatch(/demo mode/i);
    expect(summariseCheck(items).ready).toBe(true);
  });

  it('blocks on a full-AI setup with no key, and says what to do', () => {
    const items = buildSystemCheck(facts({ llmKeyPresent: false, llmVerified: false }));
    const summary = summariseCheck(items);
    expect(statusOf(items, 'ai')).toBe('fail');
    expect(summary.ready).toBe(false);
    expect(firstBlockerSentence(summary)).toMatch(/AI service key/i);
  });

  it('warns rather than blocks when a key is saved but untested', () => {
    const items = buildSystemCheck(facts({ llmVerified: false }));
    expect(statusOf(items, 'ai')).toBe('warn');
    expect(summariseCheck(items).ready).toBe(true);
  });

  it('blocks when a cloud voice is selected without a chosen voice', () => {
    const items = buildSystemCheck(facts({ ttsProvider: 'elevenlabs', voiceId: '', ttsVerified: false }));
    expect(statusOf(items, 'voice')).toBe('fail');
    expect(firstBlockerSentence(summariseCheck(items))).toMatch(/choose a voice/i);
  });

  it('never blocks on the microphone, even when permission is denied', () => {
    const items = buildSystemCheck(facts({ micPermission: 'denied' }));
    expect(statusOf(items, 'microphone')).toBe('warn');
    expect(summariseCheck(items).ready).toBe(true);
    expect(items.find((i) => i.id === 'microphone')?.detail).toMatch(/still type/i);
  });

  it('keeps demo mode usable while offline', () => {
    const items = buildSystemCheck(facts({ mode: 'demo', llmProvider: 'demo', online: false }));
    expect(statusOf(items, 'network')).toBe('warn');
    expect(items.find((i) => i.id === 'network')?.detail).toMatch(/demo mode still works/i);
    expect(summariseCheck(items).ready).toBe(true);
  });

  it('does not claim audio output is ready before anything has played', () => {
    const items = buildSystemCheck(facts({ audioOutputReady: false }));
    expect(statusOf(items, 'output')).toBe('warn');
    expect(items.find((i) => i.id === 'output')?.detail).toMatch(/first reply/i);
  });
});

describe('provider metadata', () => {
  it('offers exactly the providers the server can reach', () => {
    expect(PROVIDER_CARDS.map((p) => p.id)).toEqual(['openai', 'openrouter', 'anthropic', 'gemini']);
  });

  it('gives every provider a key page and a default model', () => {
    for (const card of PROVIDER_CARDS) {
      expect(card.keyUrl).toMatch(/^https:\/\//);
      expect(card.preferredModels.length).toBeGreaterThan(0);
      expect(card.keyHint.length).toBeGreaterThan(10);
    }
  });

  it('only lets one OpenAI key cover speech and voice', () => {
    expect(providerCard('openai')?.reusableForSpeech).toBe(true);
    expect(providerCard('openrouter')?.reusableForSpeech).toBe(false);
    expect(providerCard('gemini')?.reusableForSpeech).toBe(false);
    expect(providerCard('anthropic')?.reusableForSpeech).toBe(false);
  });
});

describe('model selection', () => {
  it('preselects the first preference the account actually has', () => {
    expect(chooseModel(['gpt-4o', 'gpt-4o-mini'], ['gpt-4o-mini', 'gpt-4o'])).toBe('gpt-4o-mini');
  });

  it('falls back to a prefix match when the exact model is gone', () => {
    expect(chooseModel(['claude-3-5-haiku-20241022'], ['claude-3-5-haiku-latest'])).toBe('claude-3-5-haiku-20241022');
  });

  it('falls back to the first usable chat model when no preference exists', () => {
    expect(chooseModel(['some-new-model'], ['gpt-4o-mini'])).toBe('some-new-model');
  });

  it('never preselects a non-conversational model', () => {
    const available = ['text-embedding-3-small', 'whisper-1', 'dall-e-3', 'gpt-4o-mini'];
    expect(chooseModel(available, ['gpt-4o-mini'])).toBe('gpt-4o-mini');
    expect(chooseModel(['text-embedding-3-small', 'whisper-1'], ['gpt-4o-mini'])).toBeNull();
    expect(isChatModel('tts-1')).toBe(false);
    expect(isChatModel('gpt-4o-mini')).toBe(true);
  });
});

// Which key actually serves speech recognition.
//
// The app keeps three separate key slots — chat (`llm.apiKey`), voice and speech
// (`stt.apiKey`) — but the SPEECH screen offers "OpenRouter Whisper (same key as
// chat)". That was only true if the user pasted the same key twice: the speech
// slot held its own copy, so someone who moved chat to OpenRouter went on sending
// the old OpenAI key to Whisper and was told "OpenAI rejected this key" about a
// key they had already replaced. This module makes the label honest and gives the
// engine a fallback when the stored speech key is dead.
import { KITTSettings, STTConfig } from '../config/settings';

/** Which slot the key came from, so the UI and the error path can say so. */
export type SpeechKeySource = 'speech' | 'chat';

export interface ResolvedSpeech extends STTConfig {
  source: SpeechKeySource;
}

const OPENROUTER_KEY = /^sk-or-v1-/i;

/** OpenRouter serves speech under vendor-prefixed ids; a bare `whisper-1` 400s. */
export const OPENROUTER_SPEECH_MODEL = 'openai/whisper-large-v3';

/** The chat leg's key when that leg is OpenRouter, otherwise ''. */
export function chatOpenRouterKey(s: KITTSettings): string {
  if (s.llm.provider !== 'openrouter') return '';
  const key = (s.llm.apiKey ?? '').trim();
  return OPENROUTER_KEY.test(key) ? key : '';
}

/**
 * The speech configuration to send.
 *
 * OpenRouter chosen for speech always uses the chat key — one OpenRouter key
 * covers chat and voice, and a stale copy in the speech slot must not win. An
 * empty speech key falls back the same way instead of sending nothing.
 */
export function resolveSpeechConfig(s: KITTSettings): ResolvedSpeech {
  const stt = s.stt;
  if (stt.provider === 'browser' || stt.provider === 'demo') {
    return { ...stt, source: 'speech' };
  }

  const chatKey = chatOpenRouterKey(s);
  const speechKey = (stt.apiKey ?? '').trim();

  if (chatKey && (stt.provider === 'openrouter' || !speechKey)) {
    return {
      ...stt,
      provider: 'openrouter',
      apiKey: chatKey,
      model: OPENROUTER_SPEECH_MODEL,
      source: 'chat',
    };
  }

  return { ...stt, apiKey: speechKey, source: 'speech' };
}

/**
 * A second attempt after a rejected key, or null when there is nothing better.
 *
 * Only a rejected key is retried: a network fault or a rate limit would fail the
 * same way on the other key, and retrying those would just double the latency.
 */
export function speechKeyFallback(failed: ResolvedSpeech, s: KITTSettings, error: string): ResolvedSpeech | null {
  if (failed.source === 'chat') return null;
  if (!/rejected this key/i.test(error)) return null;
  const chatKey = chatOpenRouterKey(s);
  if (!chatKey || chatKey === failed.apiKey) return null;
  return {
    ...failed,
    provider: 'openrouter',
    apiKey: chatKey,
    model: OPENROUTER_SPEECH_MODEL,
    source: 'chat',
  };
}

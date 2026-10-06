// Provider abstractions
import { LLMConfig, TTSConfig, STTConfig } from '../config/settings';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** A source returned by a live web/X lookup. */
export interface Citation {
  title: string;
  url: string;
}

/** Outcome of one automatic live-lookup leg. */
export interface LiveLookupResult {
  /** True when the model actually searched and returned fresh facts. */
  searched: boolean;
  /** Short factual summary to fold into the spoken answer ('' when nothing). */
  summary: string;
  citations: Citation[];
}

export interface LLMProvider {
  id: string;
  // Streams text deltas as they become available. Throws KITTError on failure.
  streamChat(messages: ChatMessage[], cfg: LLMConfig, signal?: AbortSignal): AsyncGenerator<string>;
  // Non-streaming convenience (used by TEST CONNECTION and fallbacks).
  complete(messages: ChatMessage[], cfg: LLMConfig, signal?: AbortSignal): Promise<string>;
}

export interface SynthOptions {
  text: string;
  cfg: TTSConfig;
  signal?: AbortSignal;
}

export interface TTSProvider {
  id: string;
  // Returns a streaming audio source (ReadableStream of mp3/ogg bytes) or a Blob.
  synthesize(opts: SynthOptions): Promise<ReadableStream<Uint8Array> | Blob>;
}

export interface STTProvider {
  id: string;
  transcribe(audio: Blob, cfg: STTConfig, signal?: AbortSignal): Promise<string>;
}

export class KITTError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function friendlyProviderError(e: unknown): string {
  if (e instanceof KITTError) return e.message;
  if (e instanceof DOMException && e.name === 'AbortError') return 'Operation cancelled.';
  if (e instanceof TypeError) return 'Network error — check your connection and endpoint.';
  const msg = e instanceof Error ? e.message : String(e);
  if (/401|unauthorized|invalid.*key/i.test(msg)) return 'Invalid API key. Check your credentials in Settings.';
  if (/429|rate.?limit/i.test(msg)) return 'Provider rate limit reached. Wait a moment and try again.';
  if (/timeout|etimedout/i.test(msg)) return 'Provider timed out. Try again.';
  if (/402|quota/i.test(msg)) return 'Provider quota exceeded. Check your provider account.';
  return msg || 'Unknown error.';
}
// OpenAI-compatible LLM provider (also works for OpenAI-style endpoints).
// Called from the server route; the key never touches the browser.
import OpenAI from 'openai';
import { LLMProvider, ChatMessage, KITTError } from '../types';
import { LLMConfig } from '../../config/settings';

// A provider response must never be able to redirect the server elsewhere.
const guardedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  fetch(input, { ...(init ?? {}), redirect: 'error' });

export class OpenAIProvider implements LLMProvider {
  id = 'openai';

  private client(cfg: LLMConfig): OpenAI {
    if (!cfg.apiKey) throw new KITTError('missing_key', 'No API key configured for the AI provider.');
    return new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl || undefined,
      timeout: 30000,
      maxRetries: 1,
      fetch: guardedFetch,
    });
  }

  async *streamChat(messages: ChatMessage[], cfg: LLMConfig, signal?: AbortSignal): AsyncGenerator<string> {
    const client = this.client(cfg);
    const stream = await client.chat.completions.create(
      {
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
        stream: true,
      },
      { signal: signal as unknown as AbortSignal | undefined },
    );
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  async complete(messages: ChatMessage[], cfg: LLMConfig, signal?: AbortSignal): Promise<string> {
    const client = this.client(cfg);
    const res = await client.chat.completions.create(
      {
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
      },
      { signal: signal as unknown as AbortSignal | undefined },
    );
    return res.choices?.[0]?.message?.content ?? '';
  }
}

export const openaiProvider = new OpenAIProvider();
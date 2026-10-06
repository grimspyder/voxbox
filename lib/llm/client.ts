// Client-side LLM access. Routes through /api/llm so keys are used server-side.
import { ChatMessage, KITTError, LiveLookupResult } from './types';
import { demoProvider } from './providers/demoProvider';
import { apiUrl, apiHeaders } from '../config/apiBase';

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export function buildMessages(systemPrompt: string, history: Turn[], liveNote?: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  if (liveNote) messages.push({ role: 'system', content: liveNote });
  messages.push(...history.slice(-16).map((t) => ({ role: t.role, content: t.content })));
  return messages;
}

export class LLMClient {
  /** Stream response text chunks (throws KITTError with friendly message). */
  async *streamChat(messages: ChatMessage[], opts: { provider: string; apiKey: string; model: string; baseUrl?: string; temperature: number; maxTokens: number }, signal?: AbortSignal): AsyncGenerator<string> {
    if (opts.provider === 'demo') {
      for await (const c of demoProvider.streamChat(messages)) yield c;
      return;
    }
    const res = await fetch(apiUrl('/api/llm'), {
      method: 'POST',
      signal,
      headers: apiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ ...opts, messages, stream: true }),
    });
    if (!res.ok || !res.body) {
      let msg = `AI provider error ${res.status}`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch { /* not json */ }
      throw new KITTError('llm', msg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.e) throw new KITTError('llm', evt.e);
          if (evt.t) yield evt.t;
        } catch (e) {
          if (e instanceof KITTError) throw e;
          /* partial line */
        }
      }
    }
  }

  /**
   * Automatic live lookup via Grok web/X search. Used by the conversation engine
   * before a turn whose question needs current information. Throws on failure so
   * the caller can decide to fail open; the engine does.
   */
  async liveLookup(
    opts: { apiKey: string; model?: string; query: string; context?: string },
    signal?: AbortSignal,
  ): Promise<LiveLookupResult> {
    const res = await fetch(apiUrl('/api/llm/live'), {
      method: 'POST',
      signal,
      headers: apiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      let msg = `Live lookup error ${res.status}`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch {
        /* not json */
      }
      throw new KITTError('live', msg);
    }
    return (await res.json()) as LiveLookupResult;
  }

  /** TEST CONNECTION helper. */
  async testConnection(opts: { provider: string; apiKey: string; model: string; baseUrl?: string }): Promise<{ ok: boolean; message: string }> {
    if (opts.provider === 'demo') return { ok: true, message: 'Demo mode active — no cloud AI required.' };
    try {
      let out = '';
      for await (const c of this.streamChat(
        [{ role: 'user', content: 'Reply with exactly: ONLINE' }],
        { ...opts, temperature: 0, maxTokens: 10 },
      )) {
        out += c;
      }
      if (!out.trim()) return { ok: false, message: 'Provider responded with empty output.' };
      return { ok: true, message: `Connection successful (${opts.provider}/${opts.model}).` };
    } catch (e) {
      return { ok: false, message: e instanceof KITTError ? e.message : String(e) };
    }
  }
}

export const llmClient = new LLMClient();
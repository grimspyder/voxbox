// Client-side LLM access. Routes through /api/llm so keys are used server-side.
import { ChatMessage, KITTError } from './types';
import { demoProvider } from './providers/demoProvider';
import { apiUrl, apiHeaders } from '../config/apiBase';

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export function buildMessages(systemPrompt: string, history: Turn[]): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...history.slice(-16).map((t) => ({ role: t.role, content: t.content })),
  ];
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
// Google Gemini provider (server-side) via generateContent streaming (SSE).
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiProvider {
  id = 'gemini';

  async *streamChat(messages: { role: string; content: string }[], cfg: { apiKey: string; model: string; temperature: number; maxTokens: number }, signal?: AbortSignal): AsyncGenerator<string> {
    if (!cfg.apiKey) throw new Error('No Gemini API key configured.');
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    // The key travels in a header, never in the query string: a key in the URL
    // ends up in provider and intermediary access logs.
    const url = `${BASE}/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`;
    const res = await fetch(url, {
      method: 'POST',
      signal,
      redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify({
        contents,
        systemInstruction: sys ? { parts: [{ text: sys }] } : undefined,
        generationConfig: { temperature: cfg.temperature, maxOutputTokens: cfg.maxTokens },
      }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gemini error ${res.status}: ${text.slice(0, 200)}`);
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
        if (!line.startsWith('data:')) continue;
        try {
          const evt = JSON.parse(line.slice(5).trim());
          const parts = evt.candidates?.[0]?.content?.parts ?? [];
          for (const p of parts) if (p.text) yield p.text;
        } catch {
          /* partial */
        }
      }
    }
  }

  async complete(messages: { role: string; content: string }[], cfg: { apiKey: string; model: string; temperature: number; maxTokens: number }, signal?: AbortSignal): Promise<string> {
    let out = '';
    for await (const chunk of this.streamChat(messages, cfg, signal)) out += chunk;
    return out;
  }
}

export const geminiProvider = new GeminiProvider();
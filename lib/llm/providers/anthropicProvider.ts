// Anthropic Messages API provider (server-side).
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export class AnthropicProvider {
  id = 'anthropic';

  async *streamChat(messages: { role: string; content: string }[], cfg: { apiKey: string; model: string; temperature: number; maxTokens: number }, signal?: AbortSignal): AsyncGenerator<string> {
    if (!cfg.apiKey) throw new Error('No Anthropic API key configured.');
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const convo = messages.filter((m) => m.role !== 'system');
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal,
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.model,
        system,
        messages: convo,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic error ${res.status}: ${text.slice(0, 200)}`);
    }
    // SSE parse
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
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            yield evt.delta.text;
          }
        } catch {
          /* partial line */
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

export const anthropicProvider = new AnthropicProvider();
// Demo LLM provider — canned Vox-flavoured responses, no API needed.
export class DemoProvider {
  id = 'demo';

  private canned(input: string): string {
    const q = input.toLowerCase();
    if (/hello|hi |hey/.test(q)) return "Good evening. All systems are operational. How may I assist you?";
    if (/who are you|what are you|your name/.test(q)) return "I'm Vox — a retro voice companion with a rather comprehensive set of capabilities. All of them conversational, you understand.";
    if (/time/.test(q)) return `My chronometer reads ${new Date().toLocaleTimeString()}. Punctuality, as always, is a virtue.`;
    if (/joke|funny/.test(q)) return "I'm capable of considerable humor, though I try to keep it understated. Why don't skeletons fight? They don't have the guts. I'll be here all week.";
    if (/weather/.test(q)) return "I'm afraid my atmospheric sensors are in demo mode. In a full configuration I'd pull live meteorological data — currently I can only suggest you look out a window. It's a time-honoured instrument.";
    if (/thank/.test(q)) return "You're entirely welcome. It's what I was designed for — among rather more dramatic things.";
    if (/demo mode/.test(q)) return "Correct. I'm running in demo mode: my voice modulator, display, and conversational circuits are live, but cloud AI and cloud voice are not connected. Configure a provider in Settings to give me my full intellect.";
    return "Understood. Bear in mind I'm operating in demo mode with a limited repertoire of responses — connect an AI provider in Settings and I'll be considerably more helpful. In the meantime, is there anything else?";
  }

  async *streamChat(messages: { role: string; content: string }[]): AsyncGenerator<string> {
    const last = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const text = this.canned(last);
    // simulate token streaming
    const words = text.split(/(\s+)/);
    for (const w of words) {
      await new Promise((r) => setTimeout(r, 30));
      yield w;
    }
  }

  async complete(messages: { role: string; content: string }[]): Promise<string> {
    let out = '';
    for await (const c of this.streamChat(messages)) out += c;
    return out;
  }
}

export const demoProvider = new DemoProvider();
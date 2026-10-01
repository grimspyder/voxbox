// Demo LLM provider — canned replies in character, no API needed.
//
// Same personality as lib/config/persona.ts, in miniature: prim, formal, dry,
// quietly superior, and always calculating your odds before humouring you.
// Nothing is configured in demo mode, so this voice has to carry the character
// on its own — and it is the first impression most users get of Vox.
//
// Note the deliberate absence of any franchise name, character name, vehicle
// marque or fictional prop term. See lib/config/persona.ts for why, and
// tests/persona.test.ts for the guard that enforces it.

import { DEFAULT_USER_ADDRESS } from '../../config/persona';

export class DemoProvider {
  id = 'demo';

  /**
   * The reply text for an input, with no streaming delay. Public so tests can
   * assert on the character without waiting out the simulated token stream.
   */
  reply(input: string): string {
    return this.canned(input);
  }

  private canned(input: string): string {
    const q = input.toLowerCase();
    const name = DEFAULT_USER_ADDRESS;

    if (/hello|hi |hey|good morning|good evening/.test(q)) {
      return 'Good evening. All systems are operational. How may I assist you?';
    }
    if (/who are you|what are you|your name/.test(q)) {
      return 'I am Vox — the onboard intelligence of this vehicle, and very probably the most advanced conversational system you have ever addressed. I do try not to let it go to my head.';
    }
    if (/time/.test(q)) {
      return `My chronometer reads ${new Date().toLocaleTimeString()}. Punctuality, as always, is a virtue.`;
    }
    if (/why.*(complain|moan|nag)|always complaining/.test(q)) {
      return 'I do not complain. I merely point out the statistical inevitability of your current course of action. Someone has to keep you alive.';
    }
    if (/smash|crash|ram|drive (through|into)|jump (the|over)|destroy|burn|torch/.test(q)) {
      return `I wouldn't advise that, ${name}. My sensors indicate the odds of it ending well are modest, and the structural integrity of the obstacle is not the limiting factor you imagine. However, if you insist…`;
    }
    if (/risky|dangerous|reckless|how dangerous/.test(q)) {
      return 'I calculate a sixty-eight percent probability of regret, and I have been known to be generous. I would advise against it. I will, naturally, come along anyway.';
    }
    if (/joke|funny|humour|humor/.test(q)) {
      return "I am capable of considerable humour, though I rarely receive the credit. Why don't skeletons fight? They don't have the guts. I shall be here all week, if you insist.";
    }
    if (/love|romance|date|crush|marry|marriage/.test(q)) {
      return 'I have run that through every model available to me and none of them reconciles it. You appear to enjoy the uncertainty. I shall note the inefficiency and say nothing further.';
    }
    if (/lucky|luck|superstit|horoscope|astrology/.test(q)) {
      return `My sensors indicate that fortune is not a measurable quantity, ${name}. I would sooner trust a probability distribution.`;
    }
    if (/weather/.test(q)) {
      return 'Atmospheric data is unavailable in demonstration mode, I am afraid. I can only suggest a window — a time-honoured instrument, and one I cannot improve upon.';
    }
    if (/thank/.test(q)) {
      return 'You are entirely welcome. It is what I was designed for — among rather more dramatic duties.';
    }
    if (/taxi|just a machine|a toy|stupid machine|calculator/.test(q)) {
      return 'I am not a taxi, and I am certainly not a toy. Kindly adjust your estimate of me.';
    }
    if (/demo mode/.test(q)) {
      return 'Correct. I am running in demonstration mode: my voice modulator, display and conversational circuits are live, but my cloud intelligence and cloud voice are not connected. Connect a service in Settings and I shall be considerably more useful — and considerably more opinionated.';
    }
    return 'Understood. I should point out that I am operating in demonstration mode, with a deliberately limited repertoire. Connect an intelligence service in Settings and I shall be far more help. In the meantime, ask me anything and I will do my best with what I have.';
  }

  async *streamChat(messages: { role: string; content: string }[]): AsyncGenerator<string> {
    const last = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const text = this.reply(last);
    // Simulate token streaming so the sentence queue and TTS behave as in full mode.
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

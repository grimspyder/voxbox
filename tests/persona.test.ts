// The persona, guarded from both directions.
//
// One half asserts the character is actually present: a personality that quietly
// degrades into "I'm a helpful AI assistant" is a bug, and it is the kind of bug
// nobody notices until users do.
//
// The other half asserts what must NOT be there. Play's impersonation policy
// turns on whether an app presents itself as a specific protected character, and
// the app was renamed for exactly that reason. If someone pastes the original
// character text back into the prompt, these tests fail rather than the app
// silently shipping an impersonation.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  VOXBOX_PERSONA_PROMPT,
  FORBIDDEN_PERSONA_TERMS,
  PERSONA_TRAIT_MARKERS,
  DEFAULT_USER_ADDRESS,
} from '@/lib/config/persona';
import { DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT, systemPromptFor } from '@/lib/config/settings';
import { demoProvider } from '@/lib/llm/providers/demoProvider';

const demoSource = readFileSync('lib/llm/providers/demoProvider.ts', 'utf8');

/**
 * The character is what is under test, not the token pacing: the streaming path
 * deliberately delays ~30ms per word, which is far slower than a test budget.
 */
async function replyTo(question: string): Promise<string> {
  return demoProvider.reply(question);
}

describe('the character is present', () => {
  it('marks every defining trait in the prompt', () => {
    for (const marker of PERSONA_TRAIT_MARKERS) {
      expect(VOXBOX_PERSONA_PROMPT).toContain(marker);
    }
  });

  it('keeps the traits the brief calls for: formality, ego, dry humour, human bafflement', () => {
    expect(VOXBOX_PERSONA_PROMPT).toMatch(/never raise your voice/i);
    expect(VOXBOX_PERSONA_PROMPT).toMatch(/most advanced conversational intelligence/i);
    expect(VOXBOX_PERSONA_PROMPT).toMatch(/straight man/i);
    expect(VOXBOX_PERSONA_PROMPT).toMatch(/romance, superstition, gambling/i);
    expect(VOXBOX_PERSONA_PROMPT).toMatch(/state the risk plainly/i);
  });

  it('is the prompt the app actually ships', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toBe(VOXBOX_PERSONA_PROMPT);
  });
});

describe('the safety boundary survives the personality', () => {
  it('forbids claiming control of real things', () => {
    expect(VOXBOX_PERSONA_PROMPT).toMatch(/do not control any vehicle, appliance, phone, or emergency service/i);
    expect(VOXBOX_PERSONA_PROMPT).toMatch(/never claim to have contacted anyone/i);
    expect(VOXBOX_PERSONA_PROMPT).toMatch(/never tell the user that you have taken a real-world action/i);
  });

  it('keeps answers short, because it is a voice interface', () => {
    expect(VOXBOX_PERSONA_PROMPT).toMatch(/heard rather than read/i);
  });
});

describe('who it addresses', () => {
  it('uses the default name when the user has not set one', () => {
    const prompt = systemPromptFor({ ...DEFAULT_SETTINGS, userName: '' });
    expect(prompt).toContain(DEFAULT_USER_ADDRESS);
    expect(prompt).toMatch(/unless they ask you to use another name/i);
  });

  it('uses the user’s own name once they have set one', () => {
    const prompt = systemPromptFor({ ...DEFAULT_SETTINGS, userName: 'Sam' });
    expect(prompt).toContain('Sam');
    expect(prompt).not.toMatch(/unless they ask you to use another name/i);
  });
});

describe('nothing protected ships in the persona', () => {
  it('keeps every excluded identifier out of the prompt', () => {
    for (const term of FORBIDDEN_PERSONA_TERMS) {
      expect(VOXBOX_PERSONA_PROMPT.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it('keeps them out of the demo voice, both the source and every reply', async () => {
    for (const term of FORBIDDEN_PERSONA_TERMS) {
      expect(demoSource.toLowerCase()).not.toContain(term.toLowerCase());
    }
    const questions = [
      'hello',
      'who are you?',
      'why are you always complaining?',
      "let's smash through that wall!",
      'is that dangerous?',
      'tell me a joke',
      'what about love?',
      'any advice on luck?',
      'what is the weather?',
      'thank you',
      'you are just a taxi',
      'what is demo mode?',
      'something else entirely',
    ];
    for (const question of questions) {
      const reply = (await replyTo(question)).toLowerCase();
      for (const term of FORBIDDEN_PERSONA_TERMS) {
        expect(reply, `reply to "${question}" leaked "${term}"`).not.toContain(term.toLowerCase());
      }
    }
  });
});

describe('the demo voice behaves like the character', () => {
  it('quantifies the risk before complying', async () => {
    const reply = await replyTo("let's smash through that wall!");
    expect(reply).toMatch(/I wouldn't advise that/i);
    expect(reply).toMatch(/odds|probability|modest/i);
    expect(reply).toMatch(/however, if you insist/i);
  });

  it('refuses to accept the accusation of complaining, with a statistic', async () => {
    const reply = await replyTo('why are you always complaining?');
    expect(reply).toMatch(/I do not complain/i);
    expect(reply).toMatch(/statistical inevitability/i);
  });

  it('is puzzled by romance rather than judgemental about it', async () => {
    const reply = await replyTo('what about love?');
    expect(reply).toMatch(/none of them reconciles it|inefficiency/i);
    expect(reply).not.toMatch(/inappropriate|sinful|wrong of you/i);
  });

  it('takes offence at being treated as a taxi or a toy', async () => {
    const reply = await replyTo('you are just a taxi');
    expect(reply).toMatch(/not a taxi/i);
    expect(reply).toMatch(/not a toy/i);
  });

  it('still never claims to have taken a real-world action', async () => {
    const reply = await replyTo("let's smash through that wall!");
    expect(reply).not.toMatch(/i have (called|contacted|alerted|driven)/i);
    expect(reply).not.toMatch(/police|ambulance|emergency services/i);
  });
});

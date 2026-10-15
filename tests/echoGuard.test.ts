// The textual echo guard: does a transcript look like Vox hearing itself?
//
// This is the backstop layer, not the acoustic fix — see the engine and mic
// tests for the turn gate. What matters here is the balance: catch the speaker's
// words coming back through the microphone, and never swallow a real reply.
import { describe, expect, it } from 'vitest';
import {
  SelfEchoGuard,
  bigramOverlap,
  looksLikeSelfEcho,
  normalizeForMatch,
  wordContainment,
} from '@/lib/conversation/echoGuard';

describe('normalizeForMatch', () => {
  it('folds case, punctuation and spacing', () => {
    expect(normalizeForMatch('  All systems are OPERATIONAL!  ')).toBe('all systems are operational');
    expect(normalizeForMatch('Vox, are you there?')).toBe('vox are you there');
  });
});

describe('overlap measures', () => {
  it('scores a near-identical sentence high', () => {
    expect(wordContainment('all systems operational', 'All systems are operational.')).toBe(1);
    expect(bigramOverlap('all systems are operational', 'All systems are operational.')).toBe(1);
  });

  it('scores an unrelated sentence at zero', () => {
    expect(wordContainment('what is the weather tomorrow', 'All systems are operational.')).toBe(0);
    expect(bigramOverlap('what is the weather tomorrow', 'All systems are operational.')).toBe(0);
  });
});

describe('looksLikeSelfEcho', () => {
  it('flags Vox\'s own sentence coming back through the microphone', () => {
    expect(looksLikeSelfEcho('All systems are operational', 'All systems are operational.')).toBe(true);
    // A recogniser that drops a word still has to be caught.
    expect(looksLikeSelfEcho('all systems operational', 'All systems are operational.')).toBe(true);
  });

  it('does not flag a genuine follow-up', () => {
    expect(looksLikeSelfEcho('what can you do', 'All systems are operational.')).toBe(false);
    expect(looksLikeSelfEcho('tell me about the weather in Denver', 'All systems are operational.')).toBe(false);
  });

  it('protects short replies, which is where a naive filter does damage', () => {
    // "yes", "stop", "louder" are real answers and must survive even though the
    // words appear in what Vox said.
    expect(looksLikeSelfEcho('operational', 'All systems are operational.')).toBe(false);
    expect(looksLikeSelfEcho('yes operational', 'All systems are operational.')).toBe(false);
  });

  it('is empty-safe', () => {
    expect(looksLikeSelfEcho('', 'All systems are operational.')).toBe(false);
    expect(looksLikeSelfEcho('anything at all', '')).toBe(false);
  });
});

describe('SelfEchoGuard', () => {
  it('remembers what was spoken and identifies it on the way back', () => {
    const guard = new SelfEchoGuard();
    guard.record('Navigation systems are online.', 1000);
    expect(guard.isEcho('navigation systems are online', 1200)).toBe(true);
    expect(guard.isEcho('where is the nearest fuel stop', 1200)).toBe(false);
  });

  it('forgets old sentences, so a deliberate repeat later is not swallowed', () => {
    const guard = new SelfEchoGuard({ ttlMs: 5000 });
    guard.record('The coolant temperature is normal.', 1000);
    expect(guard.isEcho('the coolant temperature is normal', 2000)).toBe(true);
    expect(guard.isEcho('the coolant temperature is normal', 9000)).toBe(false);
  });

  it('keeps only the recent tail', () => {
    const guard = new SelfEchoGuard({ maxEntries: 2 });
    guard.record('one', 1);
    guard.record('two', 2);
    guard.record('three', 3);
    expect(guard.recent()).toEqual(['two', 'three']);
  });

  it('clears on demand', () => {
    const guard = new SelfEchoGuard();
    guard.record('All systems are operational.', 1000);
    guard.clear();
    expect(guard.isEcho('All systems are operational', 1000)).toBe(false);
  });
});

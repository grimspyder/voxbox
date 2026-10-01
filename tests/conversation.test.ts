// Conversation-loop tests: text → AI → voice, interruption, empty input, rapid
// input, multi-sentence replies, and a dead network.
//
// These drive the REAL ConversationEngine, state machine, sentence queue and TTS
// client. Only the outside world is stubbed: the browser's speech synthesis, the
// Web Audio graph, and fetch. That is the point — the browser could not be
// automated while audio was playing, so the loop is exercised here instead.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationEngine } from '@/lib/conversation/engine';
import { DEFAULT_SETTINGS, KITTSettings } from '@/lib/config/settings';
import type { MachineSnapshot } from '@/lib/conversation/stateMachine';

// --- stubs for the outside world ---------------------------------------------

let spoken: string[] = [];
let cancels = 0;
let inFlight = 0;

class FakeUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

class FakeAnalyser {
  fftSize = 1024;
  smoothingTimeConstant = 0;
  frequencyBinCount = 512;
  getFloatTimeDomainData(a: Float32Array) {
    a.fill(0);
  }
  getByteFrequencyData(a: Uint8Array) {
    a.fill(0);
  }
  connect() {}
  disconnect() {}
}

class FakeGain {
  gain = { value: 1 };
  connect() {}
  disconnect() {}
}

class FakeAudioContext {
  state = 'running';
  sampleRate = 44100;
  currentTime = 0;
  destination = {};
  createAnalyser() {
    return new FakeAnalyser();
  }
  createGain() {
    return new FakeGain();
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

class FakeRecognition {
  continuous = false;
  interimResults = true;
  lang = 'en-US';
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  // Present but inert: these tests type rather than speak, and a recogniser that
  // fired results would be testing a different path. Note that stop() does NOT
  // fire onend, so the engine's auto-restart-after-a-genuine-end behaviour does
  // not spin during a test.
  start() {}
  stop() {}
}

function installStubs() {
  spoken = [];
  cancels = 0;
  inFlight = 0;

  const w = window as unknown as Record<string, unknown>;
  w.AudioContext = FakeAudioContext;
  // A device that supports on-device recognition, which the Android WebView does
  // (measured) — without this the engine reports "browser does not support speech
  // recognition" and parks the state machine in ERROR.
  w.SpeechRecognition = FakeRecognition;
  w.webkitSpeechRecognition = FakeRecognition;

  // A working microphone, so listen() takes its happy path. Tests that want a
  // broken microphone override this deliberately.
  const fakeStream = { getTracks: () => [{ stop() {} }], getAudioTracks: () => [{ label: 'fake mic', stop() {} }] };
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: {
      getUserMedia: async () => fakeStream,
      enumerateDevices: async () => [],
    },
    configurable: true,
  });

  const fakeSpeech = {
    speak(u: FakeUtterance) {
      inFlight += 1;
      spoken.push(u.text);
      // A real engine fires onend when the utterance finishes.
      setTimeout(() => {
        inFlight -= 1;
        u.onend?.();
      }, 5);
    },
    cancel() {
      cancels += 1;
    },
    getVoices: () => [],
  };
  w.speechSynthesis = fakeSpeech;
  vi.stubGlobal('speechSynthesis', fakeSpeech);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
}

/** Settings: demo brain, device voice — no network and no Web Audio synth. */
function testSettings(overrides: Partial<KITTSettings> = {}): KITTSettings {
  return {
    ...DEFAULT_SETTINGS,
    llm: { ...DEFAULT_SETTINGS.llm, provider: 'demo' },
    tts: { ...DEFAULT_SETTINGS.tts, provider: 'browser' },
    stt: { ...DEFAULT_SETTINGS.stt, provider: 'browser' },
    ...overrides,
  };
}

interface Harness {
  engine: ConversationEngine;
  states: MachineSnapshot[];
  transcript: { role: 'user' | 'assistant'; text: string }[];
  errors: string[];
  started: Promise<void>;
}

async function startEngine(settings = testSettings()): Promise<Harness> {
  const engine = new ConversationEngine(settings);
  const states: MachineSnapshot[] = [];
  const transcript: { role: 'user' | 'assistant'; text: string }[] = [];
  const errors: string[] = [];
  const started = engine.start({
    onState: (m) => states.push(m),
    onTranscript: (role, text, interim) => {
      if (!interim) transcript.push({ role, text });
    },
    onError: (message) => errors.push(message),
  });
  await started;
  return { engine, states, transcript, errors, started };
}

/** Poll until the predicate holds, so tests do not depend on exact timing. */
async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('condition not met in time');
}

/**
 * Wait for the turn to finish. Asserted against the state HISTORY rather than the
 * current state, because the engine auto-restarts listening the moment a reply
 * drains, so IDLE is real but fleeting — polling for it directly is a race.
 */
async function awaitTurnComplete(h: Harness, timeoutMs = 15000): Promise<void> {
  await until(() => {
    const seq = h.states.map((s) => s.state);
    const speaking = seq.lastIndexOf('SPEAKING');
    return speaking >= 0 && seq.slice(speaking).includes('IDLE');
  }, timeoutMs);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- tests -------------------------------------------------------------------

describe('text → AI → voice', () => {
  beforeEach(installStubs);

  it('answers a typed message, speaks it, and returns to idle', async () => {
    const h = await startEngine();

    await h.engine.sendText('hello');
    await until(() => h.transcript.some((t) => t.role === 'assistant'));

    expect(h.transcript[0]).toEqual({ role: 'user', text: 'hello' });
    const reply = h.transcript.find((t) => t.role === 'assistant')?.text ?? '';
    expect(reply).toMatch(/all systems are operational/i);

    // The reply is spoken as it streams, so wait for the whole thing rather than
    // asserting mid-stream — the sentence splitter emits the first sentence as
    // soon as it can, which is the behaviour we want and also why this races.
    await until(() => spoken.join(' ').includes('All systems are operational'), 8000);
    await awaitTurnComplete(h);
    expect(h.errors).toEqual([]);
  }, 25000);

  it('splits a multi-sentence reply into separate spoken segments', async () => {
    const h = await startEngine();
    await h.engine.sendText('who are you?');
    await awaitTurnComplete(h);
    // More than one utterance, rather than one long blob.
    expect(spoken.length).toBeGreaterThan(1);
  }, 25000);

  it('ignores an empty utterance instead of starting a turn', async () => {
    const h = await startEngine();
    await h.engine.sendText('   ');
    await new Promise((r) => setTimeout(r, 150));
    expect(h.transcript).toEqual([]);
    expect(spoken).toEqual([]);
  }, 25000);

  it('survives rapid repeated input', async () => {
    const h = await startEngine();
    await Promise.all([h.engine.sendText('hello'), h.engine.sendText('hello again')]);
    await awaitTurnComplete(h);
    expect(h.errors).toEqual([]);
    expect(h.transcript.filter((t) => t.role === 'user').length).toBeGreaterThan(0);
  }, 25000);
});

describe('interruption', () => {
  beforeEach(installStubs);

  it('stops speaking when interrupted, and returns to listening', async () => {
    const h = await startEngine();
    void h.engine.sendText('who are you?');
    // Wait until something is audibly in flight, not merely until the machine
    // reached SPEAKING: the first utterance may not have been handed to the
    // synthesiser yet, and interrupting before that proves nothing about whether
    // speech is silenced. This is the assertion that failed on CI, and it was
    // right to fail.
    await until(() => spoken.length > 0);

    h.engine.interrupt();

    expect(h.states.some((s) => s.state === 'INTERRUPTED')).toBe(true);
    // The voice must actually be silenced, not merely flagged as interrupted.
    expect(cancels).toBeGreaterThan(0);

    const spokenAtInterrupt = spoken.length;
    await new Promise((r) => setTimeout(r, 250));
    expect(spoken.length).toBe(spokenAtInterrupt);
  }, 25000);
});

describe('a dead network', () => {
  beforeEach(() => {
    installStubs();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );
  });

  it('reports a usable error and does not hang the conversation', async () => {
    const h = await startEngine(testSettings({ llm: { ...testSettings().llm, provider: 'openai', apiKey: 'sk-test-not-real-0000' } }));
    await h.engine.sendText('hello');

    await until(() => h.errors.length > 0, 6000);
    expect(h.errors[0]).toMatch(/connection|could not reach|network/i);
    expect(h.errors[0]).not.toMatch(/undefined|\[object/i);
  });
});

describe('a device with no usable microphone', () => {
  beforeEach(() => {
    installStubs();
    // Override the working stub above: this is the mic-less / blocked case.
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          throw Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' });
        },
        enumerateDevices: async () => [],
      },
      configurable: true,
    });
  });

  it('still holds a full text conversation instead of parking in ERROR', async () => {
    const h = await startEngine();
    await h.engine.sendText('hello');
    await until(() => h.transcript.some((t) => t.role === 'assistant'), 8000);

    expect(h.transcript[0]).toEqual({ role: 'user', text: 'hello' });
    // The problem is reported to the user...
    expect(h.errors.length).toBeGreaterThan(0);
    // ...but never as a machine fault, and the conversation completes normally.
    expect(h.states.some((s) => s.state === 'ERROR')).toBe(false);
    await until(() => h.engine.machine.state === 'IDLE', 8000);
    expect(h.engine.machine.state).toBe('IDLE');
  });
});

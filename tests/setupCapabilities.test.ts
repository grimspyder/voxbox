// Device capability reporting and capability-aware option lists.
//
// These exist because the Android WebView is not Chrome: it supports speech
// recognition but ships speech synthesis disabled. The app must detect that
// rather than let a user choose a voice that cannot speak.
import { describe, expect, it, afterEach } from 'vitest';
import { reportCapabilities, isNativeShell } from '@/lib/setup/capabilities';
import { voiceOptions, speechOptions } from '@/lib/setup/voiceOptions';

type Mutable = Record<string, unknown>;

const g = globalThis as unknown as Mutable;

function capabilityById(id: string) {
  return reportCapabilities().capabilities.find((c) => c.id === id);
}

afterEach(() => {
  delete g.Capacitor;
});

describe('capability report', () => {
  it('reports the desktop browser truthfully', () => {
    // jsdom provides AudioContext? It does not; it provides a partial set.
    const report = reportCapabilities();
    expect(report.capabilities).toHaveLength(6);
    expect(report.summary).toMatch(/^shell=browser/);
    expect(report.native).toBe(false);
    for (const capability of report.capabilities) {
      expect(typeof capability.ok).toBe('boolean');
      expect(capability.detail.length).toBeGreaterThan(0);
    }
  });

  it('summarises every capability into one support line', () => {
    const { summary } = reportCapabilities();
    for (const id of ['microphone', 'speech-synthesis', 'speech-recognition', 'audio-context', 'streamed-audio', 'wake-lock']) {
      expect(summary).toContain(`${id}=`);
    }
  });

  it('detects the native shell', () => {
    expect(isNativeShell()).toBe(false);
    g.Capacitor = { isNativePlatform: () => true };
    expect(isNativeShell()).toBe(true);
  });

  it('says a missing capability out loud instead of failing silently', () => {
    const originalSpeech = g.speechSynthesis;
    // A WebView-style engine: no speech synthesis at all.
    Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
    delete (window as unknown as Mutable).speechSynthesis;

    const capability = capabilityById('speech-synthesis');
    expect(capability?.ok).toBe(false);
    expect(capability?.detail).toMatch(/demo voice or a cloud voice/i);

    if (originalSpeech) Object.defineProperty(window, 'speechSynthesis', { value: originalSpeech, configurable: true });
  });
});

describe('voice options', () => {
  it('offers all four voices when the engine can speak', () => {
    Object.defineProperty(window, 'speechSynthesis', { value: {}, configurable: true });
    const options = voiceOptions();
    expect(options.map((o) => o.provider)).toEqual(['demo', 'browser', 'openai', 'elevenlabs']);
    expect(options.every((o) => o.available)).toBe(true);
  });

  it('withdraws the device voice, with a reason, when the engine cannot speak', () => {
    delete (window as unknown as Mutable).speechSynthesis;

    const options = voiceOptions();
    const device = options.find((o) => o.provider === 'browser');
    expect(device?.available).toBe(false);
    expect(device?.reason).toMatch(/does not provide a built-in voice/i);
    // The voices that do work must remain selectable.
    expect(options.filter((o) => o.available).map((o) => o.provider)).toEqual(['demo', 'openai', 'elevenlabs']);
  });
});

describe('speech recognition options', () => {
  it('offers device recognition when the engine provides it', () => {
    (window as unknown as Mutable).webkitSpeechRecognition = function () {};
    const options = speechOptions();
    expect(options.find((o) => o.provider === 'browser')?.available).toBe(true);
  });

  it('keeps Whisper available even when device recognition is absent', () => {
    delete (window as unknown as Mutable).SpeechRecognition;
    delete (window as unknown as Mutable).webkitSpeechRecognition;

    const options = speechOptions();
    expect(options.find((o) => o.provider === 'browser')?.available).toBe(false);
    expect(options.find((o) => o.provider === 'browser')?.reason).toMatch(/does not provide on-device speech/i);
    expect(options.find((o) => o.provider === 'openai')?.available).toBe(true);
  });
});

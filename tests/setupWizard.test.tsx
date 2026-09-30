// First-run wizard flows: what a nontechnical user actually sees and taps.
// The network, the model list and the microphone are mocked, so these tests
// assert the real step order, the wording, and what gets saved.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/lib/config/settings';
import { KITTSettings } from '@/lib/config/settings';

const mocks = vi.hoisted(() => ({
  testConnection: vi.fn(),
  discoverModels: vi.fn(),
  discoverVoices: vi.fn(),
  startMicMeter: vi.fn(),
}));

vi.mock('@/lib/llm/client', () => ({ llmClient: { testConnection: mocks.testConnection } }));
vi.mock('@/lib/setup/discovery', () => ({
  discoverModels: mocks.discoverModels,
  discoverVoices: mocks.discoverVoices,
  VOICE_TEST_PHRASE: 'Voice systems online. All systems are functioning normally.',
}));
vi.mock('@/lib/setup/micCheck', () => ({ startMicMeter: mocks.startMicMeter }));

import SetupWizard from '@/components/SetupWizard';

const KEY = 'sk-testtesttesttesttest';

function setup(initial: KITTSettings = DEFAULT_SETTINGS) {
  const onFinish = vi.fn();
  render(<SetupWizard initial={initial} onFinish={onFinish} />);
  return { onFinish };
}

const clickButton = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const buttonNamed = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

/** Walk from the welcome screen to the AI step and enter a key. */
function enterKey(key = KEY) {
  clickButton(/SET UP FULL VOXBOX/);
  fireEvent.change(screen.getByLabelText(/paste your openai api key/i), { target: { value: key } });
}

beforeEach(() => {
  mocks.testConnection.mockReset();
  mocks.discoverModels.mockReset();
  mocks.discoverVoices.mockReset();
  mocks.startMicMeter.mockReset();
  mocks.discoverModels.mockResolvedValue({ ok: true, models: [{ id: 'gpt-4o-mini' }], recommended: 'gpt-4o-mini' });
});

afterEach(cleanup);

describe('first launch', () => {
  it('welcomes the user with a no-setup path and a full-setup path', () => {
    setup();
    expect(screen.getByText(/WELCOME TO VOXBOX/i)).toBeTruthy();
    expect(screen.getByText(/No setup required/i)).toBeTruthy();
    expect(screen.getByText(/Connect AI and voice services/i)).toBeTruthy();
  });

  it('states the independence disclaimer up front', () => {
    setup();
    expect(screen.getByText(/not affiliated with, endorsed by or licensed by any rights holder/i)).toBeTruthy();
    expect(screen.getByText(/contains no audio, imagery or recordings/i)).toBeTruthy();
  });

  it('never asks the user to understand assistant jargon', () => {
    setup();
    const text = document.body.textContent ?? '';
    for (const jargon of ['temperature', 'max tokens', 'maxTokens', 'base URL', 'SSE', 'endpoint', 'voice ID']) {
      expect(text.toLowerCase()).not.toContain(jargon.toLowerCase());
    }
  });

  it('TRY VOX NOW finishes in demo mode with no further questions asked', () => {
    const { onFinish } = setup();
    clickButton(/TRY VOX NOW/);
    expect(onFinish).toHaveBeenCalledTimes(1);
    const next = onFinish.mock.calls[0][0] as KITTSettings;
    expect(next.llm.provider).toBe('demo');
    expect(next.tts.provider).toBe('demo');
    expect(next.setup).toEqual({ complete: true, mode: 'demo' });
  });
});

describe('AI brain step', () => {
  it('offers provider cards instead of a raw configuration list', () => {
    setup();
    clickButton(/SET UP FULL VOXBOX/);
    expect(screen.getByText(/CONNECT AI BRAIN/i)).toBeTruthy();
    for (const name of ['OpenAI', 'OpenRouter', 'Anthropic', 'Google Gemini']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.getByText(/HOW DO I GET A KEY\?/i)).toBeTruthy();
  });

  it('makes the key field phone-friendly', () => {
    setup();
    clickButton(/SET UP FULL VOXBOX/);
    const input = screen.getByLabelText(/paste your openai api key/i) as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('off');
    // Attribute, not IDL property: jsdom does not implement input.spellcheck.
    expect(input.getAttribute('spellcheck')).toBe('false');
    // Show/hide must be available for a field the user has to paste into.
    clickButton(/show key/i);
    expect((screen.getByLabelText(/paste your openai api key/i) as HTMLInputElement).type).toBe('text');
  });

  it('cannot continue until the key is proven to work', async () => {
    setup();
    enterKey();
    expect(buttonNamed(/^CONTINUE$/).disabled).toBe(true);

    mocks.testConnection.mockResolvedValue({ ok: false, message: 'Your AI key was rejected.' });
    clickButton(/TEST CONNECTION/);
    await waitFor(() => expect(screen.getByText(/Your AI key was rejected\./)).toBeTruthy());
    expect(buttonNamed(/^CONTINUE$/).disabled).toBe(true);
  });

  it('confirms the connection and picks a model for the user', async () => {
    setup();
    enterKey();
    mocks.testConnection.mockResolvedValue({ ok: true, message: 'Connection successful.' });
    clickButton(/TEST CONNECTION/);

    await waitFor(() => expect(screen.getByText(/AI connected\./)).toBeTruthy());
    expect(mocks.discoverModels).toHaveBeenCalledWith('openai', KEY);
    expect(screen.getByText(/Vox picked gpt-4o-mini/)).toBeTruthy();
    expect(buttonNamed(/^CONTINUE$/).disabled).toBe(false);
  });

  it('offers to reuse one OpenAI key for speech and voice', () => {
    setup();
    enterKey();
    expect(screen.getByText(/Use this same key for speech recognition and voice/i)).toBeTruthy();
  });

  it('respects the user turning key reuse off', async () => {
    const { onFinish } = setup();
    enterKey();
    fireEvent.click(screen.getByRole('checkbox'));
    mocks.testConnection.mockResolvedValue({ ok: true, message: 'Connection successful.' });
    clickButton(/TEST CONNECTION/);
    await waitFor(() => expect(screen.getByText(/AI connected\./)).toBeTruthy());
    clickButton(/SKIP FOR NOW/);
    const next = onFinish.mock.calls[0][0] as KITTSettings;
    expect(next.llm.apiKey).toBe(KEY);
    expect(next.stt.provider).toBe('browser');
    expect(next.stt.apiKey).toBe('');
  });
});

describe('voice, microphone and readiness', () => {
  async function reachVoiceStep() {
    const result = setup();
    enterKey();
    mocks.testConnection.mockResolvedValue({ ok: true, message: 'Connection successful.' });
    clickButton(/TEST CONNECTION/);
    await waitFor(() => expect(screen.getByText(/AI connected\./)).toBeTruthy());
    clickButton(/^CONTINUE$/);
    await waitFor(() => expect(screen.getByText(/CHOOSE Vox'S VOICE/i)).toBeTruthy());
    return result;
  }

  it('explains each voice in plain language', async () => {
    await reachVoiceStep();
    expect(screen.getByText(/Vox Demo Voice/)).toBeTruthy();
    expect(screen.getByText(/Device Voice/)).toBeTruthy();
    expect(screen.getByText(/OpenAI Voice/)).toBeTruthy();
    expect(screen.getByText(/Custom Voice/)).toBeTruthy();
  });

  it('asks for microphone permission only after explaining it', async () => {
    await reachVoiceStep();
    clickButton(/^CONTINUE$/);
    await waitFor(() => expect(screen.getByText(/^MICROPHONE$/)).toBeTruthy());
    expect(screen.getByText(/so he can hear you/i)).toBeTruthy();
    expect(screen.getByText(/only open while you are talking/i)).toBeTruthy();
    expect(buttonNamed(/ENABLE MICROPHONE/)).toBeTruthy();
    expect(mocks.startMicMeter).not.toHaveBeenCalled();
  });

  it('turns a blocked microphone into usable guidance rather than a dead end', async () => {
    await reachVoiceStep();
    clickButton(/^CONTINUE$/);
    await waitFor(() => expect(screen.getByText(/^MICROPHONE$/)).toBeTruthy());
    mocks.startMicMeter.mockRejectedValue(new Error('Microphone permission was blocked. You can still type to Vox.'));
    clickButton(/ENABLE MICROPHONE/);
    await waitFor(() => expect(screen.getByText(/still type to Vox\./)).toBeTruthy());
    // The user can still reach the end of setup and talk by text.
    expect(buttonNamed(/^CONTINUE$/)).toBeTruthy();
  });

  it('shows the system check, then VOXBOX IS READY, and saves a complete full-AI setup', async () => {
    const { onFinish } = await reachVoiceStep();
    clickButton(/^CONTINUE$/);
    await waitFor(() => expect(screen.getByText(/^MICROPHONE$/)).toBeTruthy());
    clickButton(/^CONTINUE$/);

    await waitFor(() => expect(screen.getByText(/VOXBOX SYSTEM CHECK/i)).toBeTruthy());
    for (const label of ['AI Brain', 'Voice', 'Microphone', 'Audio Output', 'Internet']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText(/VOXBOX IS READY/i)).toBeTruthy();
    clickButton(/START CONVERSATION/);

    const next = onFinish.mock.calls[0][0] as KITTSettings;
    expect(next.setup).toEqual({ complete: true, mode: 'full' });
    expect(next.llm.provider).toBe('openai');
    expect(next.llm.apiKey).toBe(KEY);
    expect(next.llm.model).toBe('gpt-4o-mini');
    // §15: one OpenAI key must not have to be pasted three separate times.
    expect(next.stt.provider).toBe('openai');
    expect(next.stt.apiKey).toBe(KEY);
    expect(next.tts.provider).toBe('openai');
    expect(next.tts.apiKey).toBe(KEY);
  });

  it('lets the user leave setup at any step without losing the choice', async () => {
    const { onFinish } = await reachVoiceStep();
    clickButton(/SKIP FOR NOW/);
    const next = onFinish.mock.calls[0][0] as KITTSettings;
    expect(next.setup.complete).toBe(true);
    expect(next.setup.mode).toBe('full');
    expect(next.llm.provider).toBe('openai');
  });
});

// The Vox system check shown at the end of setup and on the post-setup health
// screen. Pure functions so the wizard's verdicts are unit-testable without a
// browser, a microphone or a network.

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckItem {
  id: 'ai' | 'voice' | 'microphone' | 'output' | 'network';
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface SetupFacts {
  mode: 'demo' | 'full';
  llmProvider: string;
  llmKeyPresent: boolean;
  /** The user pressed TEST CONNECTION and it succeeded in this session. */
  llmVerified: boolean;
  ttsProvider: string;
  voiceId: string;
  ttsVerified: boolean;
  micPermission: 'granted' | 'denied' | 'unknown';
  audioOutputReady: boolean;
  online: boolean;
}

const VOICE_LABEL: Record<string, string> = {
  demo: 'Vox demo voice',
  browser: 'device voice',
  openai: 'OpenAI voice',
  elevenlabs: 'custom voice',
};

function aiCheck(f: SetupFacts): CheckItem {
  if (f.llmProvider === 'demo') {
    return {
      id: 'ai',
      label: 'AI Brain',
      status: 'ok',
      detail: 'Demo mode — no AI service needed.',
    };
  }
  if (!f.llmKeyPresent) {
    return { id: 'ai', label: 'AI Brain', status: 'fail', detail: 'No key entered yet.' };
  }
  if (!f.llmVerified) {
    return { id: 'ai', label: 'AI Brain', status: 'warn', detail: 'Key saved but not tested yet.' };
  }
  return { id: 'ai', label: 'AI Brain', status: 'ok', detail: 'Connected.' };
}

function voiceCheck(f: SetupFacts): CheckItem {
  const label = VOICE_LABEL[f.ttsProvider] ?? f.ttsProvider;
  if (f.ttsProvider === 'demo' || f.ttsProvider === 'browser') {
    return { id: 'voice', label: 'Voice', status: 'ok', detail: `${label} ready.` };
  }
  if (!f.voiceId) {
    return { id: 'voice', label: 'Voice', status: 'fail', detail: 'Choose a voice to continue.' };
  }
  if (!f.ttsVerified) {
    return { id: 'voice', label: 'Voice', status: 'warn', detail: 'Voice chosen but not tested yet.' };
  }
  return { id: 'voice', label: 'Voice', status: 'ok', detail: 'Connected.' };
}

function micCheck(f: SetupFacts): CheckItem {
  if (f.micPermission === 'granted') {
    return { id: 'microphone', label: 'Microphone', status: 'ok', detail: 'Ready.' };
  }
  if (f.micPermission === 'denied') {
    return {
      id: 'microphone',
      label: 'Microphone',
      status: 'warn',
      detail: 'Blocked — you can still type to Vox.',
    };
  }
  return { id: 'microphone', label: 'Microphone', status: 'warn', detail: 'Not checked yet.' };
}

export function buildSystemCheck(f: SetupFacts): CheckItem[] {
  return [
    aiCheck(f),
    voiceCheck(f),
    micCheck(f),
    {
      id: 'output',
      label: 'Audio Output',
      status: f.audioOutputReady ? 'ok' : 'warn',
      detail: f.audioOutputReady ? 'Ready.' : 'Not started yet — it is tested on the first reply.',
    },
    {
      id: 'network',
      label: 'Internet',
      status: f.online ? 'ok' : 'warn',
      detail: f.online
        ? 'Online.'
        : f.mode === 'demo'
          ? 'Offline — demo mode still works.'
          : 'Offline — Vox needs a connection for your AI service.',
    },
  ];
}

export interface CheckSummary {
  ready: boolean;
  passed: number;
  blocking: CheckItem[];
}

/** Failures block readiness; warnings never do — the user can always continue. */
export function summariseCheck(items: CheckItem[]): CheckSummary {
  const blocking = items.filter((i) => i.status === 'fail');
  return {
    ready: blocking.length === 0,
    passed: items.filter((i) => i.status === 'ok').length,
    blocking,
  };
}

/** One plain sentence explaining what still needs doing, or null when ready. */
export function firstBlockerSentence(summary: CheckSummary): string | null {
  const first = summary.blocking[0];
  if (!first) return null;
  if (first.id === 'ai') return 'Add your AI service key to finish setting up.';
  if (first.id === 'voice') return 'Choose a voice to finish setting up.';
  return `${first.label} still needs attention.`;
}

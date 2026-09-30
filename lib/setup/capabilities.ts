// What this device and its WebView can actually do.
//
// This exists because the answer genuinely differs between a desktop browser
// and the Android WebView, and the app must tell the truth rather than fail
// silently. Chrome supporting the Web Speech API says nothing about WebView
// support (production requirements §90).
//
// Nothing here is a hardware fingerprint: every value is a boolean capability
// flag evaluated in the page.

export interface Capability {
  id: string;
  label: string;
  ok: boolean;
  /** Plain-language meaning of the result, for the health screen. */
  detail: string;
}

export interface CapabilityReport {
  native: boolean;
  capabilities: Capability[];
  /** One-line summary suitable for a bug report. */
  summary: string;
}

function has(name: string): boolean {
  return typeof window !== 'undefined' && name in window;
}

/** True when running inside the Capacitor shell rather than a browser tab. */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
    __CAPACITOR__?: unknown;
  };
  return Boolean(w.Capacitor?.isNativePlatform?.());
}

export function reportCapabilities(): CapabilityReport {
  const native = isNativeShell();
  const vendor = native ? 'this app' : 'this browser';

  const wakeLock = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const canCaptureAudio =
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
  const canSynthesize = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const canRecognize = has('SpeechRecognition') || has('webkitSpeechRecognition');
  const canRenderAudio = has('AudioContext') || has('webkitAudioContext');
  const canStream = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg');

  const capabilities: Capability[] = [
    {
      id: 'microphone',
      label: 'Microphone capture',
      ok: canCaptureAudio,
      detail: canCaptureAudio ? 'Available.' : `Not available in ${vendor}. KITT can still be used by text.`,
    },
    {
      id: 'speech-synthesis',
      label: 'Device voice (spoken output)',
      ok: canSynthesize,
      detail: canSynthesize
        ? 'Available.'
        : `Not available in ${vendor}. Choose the KITT demo voice or a cloud voice instead.`,
    },
    {
      id: 'speech-recognition',
      label: 'Device speech recognition (on-device listening)',
      ok: canRecognize,
      detail: canRecognize
        ? 'Available.'
        : `Not available in ${vendor}. Choose OpenAI Whisper for speech, or type to KITT.`,
    },
    {
      id: 'audio-context',
      label: 'Audio output engine',
      ok: canRenderAudio,
      detail: canRenderAudio ? 'Available.' : 'Not available — KITT could not speak.',
    },
    {
      id: 'streamed-audio',
      label: 'Streamed voice playback',
      ok: canStream,
      detail: canStream ? 'Available.' : 'Not available — cloud voice will be buffered before playing.',
    },
    {
      id: 'wake-lock',
      label: 'Keep screen awake during a conversation',
      ok: wakeLock,
      detail: wakeLock ? 'Available.' : 'Not available — the screen may dim during a long conversation.',
    },
  ];

  return {
    native,
    capabilities,
    summary: [
      `shell=${native ? 'capacitor' : 'browser'}`,
      ...capabilities.map((c) => `${c.id}=${c.ok ? 'yes' : 'no'}`),
    ].join(' '),
  };
}

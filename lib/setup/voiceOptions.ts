// Which voice and speech options this device can actually honour.
//
// Measured, not assumed: the Android WebView supports speech *recognition* but
// ships with speech *synthesis* disabled, so "Device Voice" cannot work there.
// Offering it anyway would look like a broken app, so the UI asks these
// functions instead of hard-coding a list.
import { TTSProviderId, STTProviderId } from '../config/settings';

export interface VoiceAvailability {
  provider: TTSProviderId;
  name: string;
  blurb: string;
  available: boolean;
  /** Why it is unavailable, in the user's words. */
  reason?: string;
}

function synthesisAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function recognitionAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

export function voiceOptions(): VoiceAvailability[] {
  const deviceVoice = synthesisAvailable();
  return [
    {
      provider: 'demo',
      name: 'KITT Demo Voice',
      blurb: 'KITT’s own synthesised voice. Free, and works offline.',
      available: true,
    },
    {
      provider: 'browser',
      name: 'Device Voice',
      blurb: 'The built-in voice already on this device.',
      available: deviceVoice,
      reason: deviceVoice ? undefined : 'This device’s browser engine does not provide a built-in voice.',
    },
    {
      provider: 'openai',
      name: 'OpenAI Voice',
      blurb: 'Natural spoken voice through OpenAI.',
      available: true,
    },
    {
      provider: 'elevenlabs',
      name: 'Custom Voice',
      blurb: 'Your own voice from an ElevenLabs account.',
      available: true,
    },
  ];
}

export interface SpeechAvailability {
  provider: STTProviderId;
  available: boolean;
  reason?: string;
}

/**
 * Speech-recognition options that can work here. Device recognition is offered
 * first because it needs no key; Whisper is always available as the fallback.
 */
export function speechOptions(): SpeechAvailability[] {
  const device = recognitionAvailable();
  return [
    {
      provider: 'browser',
      available: device,
      reason: device ? undefined : 'This device does not provide on-device speech recognition.',
    },
    { provider: 'openai', available: true },
  ];
}

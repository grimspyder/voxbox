import type { TTSConfig } from '../config/settings';

export type CloudTTSProvider = Extract<TTSConfig['provider'], 'elevenlabs' | 'openai'>;

/**
 * Driving alerts must use actual AI-generated cloud speech, not browser TTS or
 * the built-in vocoder. A missing cloud configuration is an actionable setup
 * error, never permission to silently substitute a different voice.
 */
export function requireCloudVoice(config: TTSConfig): TTSConfig & { provider: CloudTTSProvider } {
  if (config.provider !== 'elevenlabs' && config.provider !== 'openai') {
    throw new Error(
      'Driving alerts require an AI cloud voice. In Settings → Voice, choose ElevenLabs or OpenAI and save its API key. Browser and Demo voices are intentionally not used for driving alerts.',
    );
  }
  if (!config.apiKey.trim()) {
    throw new Error(
      `Driving alerts are set to ${config.provider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI'} but its API key is empty. Add and save the cloud voice key in Settings → Voice.`,
    );
  }
  if (config.provider === 'elevenlabs' && !config.voiceId.trim()) {
    throw new Error(
      'Driving alerts are set to ElevenLabs, but the Voice ID is blank. Add your ElevenLabs Voice ID in Settings → Voice.',
    );
  }
  return config as TTSConfig & { provider: CloudTTSProvider };
}

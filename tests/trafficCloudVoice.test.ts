import { DEFAULT_SETTINGS } from '@/lib/config/settings';
import { requireCloudVoice } from '@/lib/traffic/cloudVoice';

describe('driving cloud voice configuration', () => {
  it('rejects Demo instead of silently synthesizing a tone', () => {
    expect(() => requireCloudVoice({ ...DEFAULT_SETTINGS.tts, provider: 'demo' })).toThrow(
      /require an AI cloud voice/i,
    );
  });

  it('rejects Browser instead of silently using device speech', () => {
    expect(() => requireCloudVoice({ ...DEFAULT_SETTINGS.tts, provider: 'browser' })).toThrow(
      /Browser and Demo voices are intentionally not used/i,
    );
  });

  it('requires the selected cloud provider key', () => {
    expect(() =>
      requireCloudVoice({
        ...DEFAULT_SETTINGS.tts,
        provider: 'elevenlabs',
        apiKey: '',
        voiceId: 'voice-123',
      }),
    ).toThrow(/API key is empty/i);
  });

  it('requires an ElevenLabs voice id', () => {
    expect(() =>
      requireCloudVoice({
        ...DEFAULT_SETTINGS.tts,
        provider: 'elevenlabs',
        apiKey: 'key-present',
        voiceId: '',
      }),
    ).toThrow(/Voice ID is blank/i);
  });

  it('accepts a complete ElevenLabs configuration unchanged', () => {
    const config = {
      ...DEFAULT_SETTINGS.tts,
      provider: 'elevenlabs' as const,
      apiKey: 'key-present',
      voiceId: 'voice-123',
    };
    expect(requireCloudVoice(config)).toEqual(config);
  });

  it('accepts a complete OpenAI cloud voice configuration', () => {
    const config = {
      ...DEFAULT_SETTINGS.tts,
      provider: 'openai' as const,
      apiKey: 'key-present',
      voiceId: 'onyx',
    };
    expect(requireCloudVoice(config)).toEqual(config);
  });
});

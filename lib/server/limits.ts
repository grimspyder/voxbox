// Hard limits for every server-side provider proxy.
// These are enforced before any outbound provider call so an unauthenticated
// client can never turn KITT's proxies into a free, unbounded relay.

export const LIMITS = {
  llm: {
    maxMessages: 40,
    maxSystemChars: 8000,
    maxMessageChars: 4000,
    maxTotalChars: 24000,
    maxTokens: 2048,
    minTemperature: 0,
    maxTemperature: 2,
    bodyBytes: 256 * 1024,
    modelChars: 128,
    keyChars: 512,
  },
  tts: {
    maxTextChars: 1200,
    bodyBytes: 32 * 1024,
    modelChars: 64,
    voiceIdChars: 128,
    keyChars: 512,
  },
  stt: {
    maxAudioBytes: 10 * 1024 * 1024,
    bodyBytes: 12 * 1024 * 1024,
    timeoutMs: 60_000,
    languageChars: 10,
    modelChars: 64,
    keyChars: 512,
  },
  providerTimeoutMs: 60_000,
} as const;

/** Open upload audio formats only. Anything else is rejected before parsing. */
export const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
] as const;

/** Providers the server is allowed to call for chat completions. */
export const LLM_PROVIDERS = ['openai', 'anthropic', 'gemini', 'openrouter', 'openai-compatible'] as const;

/** Providers the server is allowed to call for speech synthesis. */
export const TTS_PROVIDERS = ['elevenlabs', 'openai'] as const;

/** Destination hosts for the fixed production providers (see §48). */
export const PROVIDER_HOSTS = {
  openai: 'api.openai.com',
  anthropic: 'api.anthropic.com',
  gemini: 'generativelanguage.googleapis.com',
  openrouter: 'openrouter.ai',
  elevenlabs: 'api.elevenlabs.io',
} as const;

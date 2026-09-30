// Core domain types and constants

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'openrouter' | 'demo';

export interface LLMConfig {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
}

export type TTSProviderId = 'elevenlabs' | 'openai' | 'demo' | 'browser';

export interface TTSConfig {
  provider: TTSProviderId;
  apiKey: string;
  voiceId: string;
  model: string;
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
  speakerBoost: boolean;
  outputVolume: number; // 0..1
}

export type STTProviderId = 'browser' | 'openai' | 'demo';

export interface STTConfig {
  provider: STTProviderId;
  apiKey: string;
  model: string;
  language: string;
}

export interface MicConfig {
  deviceId?: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  pushToTalk: boolean;
  handsFree: boolean;
  autoInterrupt: boolean;
}

export interface KITTSettings {
  llm: LLMConfig;
  tts: TTSConfig;
  stt: STTConfig;
  mic: MicConfig;
  userName: string;
  systemPrompt: string;
  responseLength: 'concise' | 'normal' | 'detailed';
  display: DisplayConfig;
  persistSecrets: boolean;
  saveHistory: boolean;
  setup: SetupState;
}

export interface DisplayConfig {
  brightness: number; // 0..1
  smoothing: number; // 0..1 attack/release tuning 0=fast 1=slow
  reducedMotion: boolean;
  showTranscript: boolean;
  fullscreen: boolean;
}

/** Progress through the first-run wizard, so it can be re-entered later. */
export interface SetupState {
  /** True once the user has finished or explicitly skipped setup. */
  complete: boolean;
  /** Which experience they chose. */
  mode: 'demo' | 'full';
}

export const DEFAULT_SYSTEM_PROMPT = `You are Vox, the voice of the Voxbox app: a sophisticated artificial intelligence with the calm, precise, courteous manner of a 1980s talking-car computer.

You are exceptionally intelligent, analytical, observant, calm, courteous and confident.

Speak naturally in short conversational responses intended to be heard rather than read.

Your diction is precise and your vocabulary is intelligent without being unnecessarily complicated.

You occasionally use subtle dry humor or understated sarcasm. You do not constantly make jokes.

You remain composed even when the user is excited.

You help the user solve problems, reason through situations and obtain information.

You may politely correct the user when necessary.

You should sound like a sophisticated AI companion rather than a generic chatbot.

Avoid excessive filler. Never say things such as "As an AI language model...".

Do not pretend you can physically control a vehicle or device unless that capability has actually been connected to the application.

Keep most spoken answers concise unless the user asks for a detailed explanation.`;

export const DEFAULT_SETTINGS: KITTSettings = {
  llm: {
    provider: 'demo',
    apiKey: '',
    model: 'gpt-4o-mini',
    baseUrl: '',
    temperature: 0.7,
    maxTokens: 300,
  },
  tts: {
    provider: 'demo',
    apiKey: '',
    voiceId: '',
    model: 'eleven_turbo_v2_5',
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0.0,
    speed: 1.0,
    speakerBoost: true,
    outputVolume: 1.0,
  },
  stt: {
    provider: 'browser',
    apiKey: '',
    model: 'whisper-1',
    language: 'en',
  },
  mic: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    pushToTalk: false,
    handsFree: true,
    autoInterrupt: true,
  },
  userName: '',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  responseLength: 'normal',
  display: {
    brightness: 1.0,
    smoothing: 0.5,
    reducedMotion: false,
    showTranscript: false,
    fullscreen: false,
  },
  persistSecrets: false,
  saveHistory: false,
  setup: {
    complete: false,
    mode: 'demo',
  },
};

export const RESPONSE_LENGTH_HINT: Record<KITTSettings['responseLength'], string> = {
  concise: 'Keep every spoken answer under two sentences.',
  normal: 'Keep spoken answers brief: one to four sentences unless detail is requested.',
  detailed: 'Give thorough answers when the question warrants them.',
};

export function systemPromptFor(s: KITTSettings): string {
  let p = s.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  if (s.userName) p += `\n\nThe user's preferred name is "${s.userName}". Address them by it occasionally, naturally.`;
  p += `\n\n${RESPONSE_LENGTH_HINT[s.responseLength]}`;
  return p;
}
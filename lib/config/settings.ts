// Core domain types and constants
import { VOXBOX_PERSONA_PROMPT, DEFAULT_USER_ADDRESS } from './persona';

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'openrouter' | 'xai' | 'demo';

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
  /**
   * Set when weakly protected credentials were removed rather than migrated, so
   * the UI can ask the user to re-enter them once (brief §40).
   */
  secretsNeedReentry: boolean;
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

/**
 * The default system prompt is the persona, defined once in lib/config/persona.ts
 * along with the reasons for what it does and does not contain.
 */
export const DEFAULT_SYSTEM_PROMPT = VOXBOX_PERSONA_PROMPT;

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
  secretsNeedReentry: false,
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
  p += s.userName
    ? `\n\nThe person you are speaking with is called "${s.userName}". Address them by it occasionally, naturally.`
    : `\n\nAddress the person you are speaking with as "${DEFAULT_USER_ADDRESS}" unless they ask you to use another name. It is the name you have always used for your driver.`;
  p += `\n\n${RESPONSE_LENGTH_HINT[s.responseLength]}`;
  return p;
}
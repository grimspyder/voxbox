// Consumer-facing provider metadata for the setup wizard.
//
// The wizard must never ask a normal user to know what a model is. Each
// provider therefore carries a small ordered list of preferred models; after
// the key validates we ask the provider which models the account can actually
// use and pick the first preference that exists. If none of the preferences
// exist any more, the first usable chat model the provider returns is used, so
// this keeps working as providers retire models.
import { ProviderId } from './settings';

export interface ProviderCard {
  id: Exclude<ProviderId, 'demo' | 'openai-compatible'>;
  /** Name shown on the card. */
  name: string;
  /** One plain-language line about what choosing this means. */
  blurb: string;
  /** Ordered preferences; first match wins. */
  preferredModels: string[];
  /** Where the user gets a key. */
  keyUrl: string;
  /** Plain-language hint shown next to the key field. */
  keyHint: string;
  /** Whether the same key also works for speech recognition and voice. */
  reusableForSpeech: boolean;
}

export const PROVIDER_CARDS: ProviderCard[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    blurb: 'The most predictable option, and one key can also cover speech and voice.',
    preferredModels: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o', 'gpt-5-mini', 'gpt-5', 'gpt-4.1'],
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'Starts with “sk-”. Created on the API keys page of your OpenAI account.',
    reusableForSpeech: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    blurb: 'One key, many different AI models, often with free or cheap options.',
    preferredModels: [
      'openai/gpt-4o-mini',
      'google/gemini-2.0-flash-001',
      'anthropic/claude-3.5-haiku',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'Starts with “sk-or-”. Created on the Keys page of your OpenRouter account.',
    reusableForSpeech: false,
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    blurb: 'Grok models from xAI. The same key also powers live web and X answers.',
    preferredModels: ['grok-4-fast', 'grok-4', 'grok-3-mini', 'grok-3'],
    keyUrl: 'https://console.x.ai',
    keyHint: 'Starts with “xai-”. Created on the API Keys page of your xAI console.',
    reusableForSpeech: false,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    blurb: 'Claude models. Strong at careful, conversational answers.',
    preferredModels: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'Starts with “sk-ant-”. Created in the API keys section of the Anthropic console.',
    reusableForSpeech: false,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    blurb: 'Google’s models, with a free tier for light use.',
    preferredModels: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-1.5-flash'],
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyHint: 'A long key beginning “AIza”, created in Google AI Studio.',
    reusableForSpeech: false,
  },
];

export function providerCard(id: string): ProviderCard | undefined {
  return PROVIDER_CARDS.find((p) => p.id === id);
}

/** Model ids that are not conversational and must never be preselected. */
const NON_CHAT = /embed|whisper|tts|transcribe|dall-e|image|moderation|audio|realtime|search|rerank|vision-preview/i;

export function isChatModel(id: string): boolean {
  return Boolean(id) && !NON_CHAT.test(id);
}

/**
 * Choose the model to preselect from what the provider actually offers.
 * Exact preference first, then a preference that is a prefix of an offered id,
 * then the first usable chat model.
 */
export function chooseModel(available: string[], preferred: string[]): string | null {
  const usable = available.filter(isChatModel);
  if (usable.length === 0) return null;
  const lower = usable.map((m) => m.toLowerCase());
  for (const want of preferred) {
    const exact = usable[lower.indexOf(want.toLowerCase())];
    if (exact) return exact;
  }
  for (const want of preferred) {
    const idx = lower.findIndex((m) => m.startsWith(want.toLowerCase()));
    if (idx >= 0) return usable[idx];
  }
  return usable[0];
}

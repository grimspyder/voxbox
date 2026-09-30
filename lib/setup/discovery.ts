// Client helpers used by the setup wizard to discover what an account can use.
import { apiUrl, apiHeaders } from '../config/apiBase';

export interface ModelOption {
  id: string;
  label?: string;
}

export interface ModelDiscovery {
  ok: boolean;
  models: ModelOption[];
  recommended: string | null;
  message?: string;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(apiUrl(path), {
    method: 'POST',
    headers: apiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const json = (await res.json()) as { error?: string };
    return json.error ?? fallback;
  } catch {
    return fallback;
  }
}

/** Ask the AI service which models this account can use. */
export async function discoverModels(provider: string, apiKey: string): Promise<ModelDiscovery> {
  try {
    const res = await postJson('/api/llm/models', { provider, apiKey });
    if (!res.ok) {
      return { ok: false, models: [], recommended: null, message: await errorMessage(res, 'KITT could not read your model list.') };
    }
    const json = (await res.json()) as { models?: ModelOption[]; recommended?: string | null };
    return { ok: true, models: json.models ?? [], recommended: json.recommended ?? null };
  } catch {
    return { ok: false, models: [], recommended: null, message: 'KITT could not reach the AI service. Check your connection.' };
  }
}

export interface VoiceOption {
  id: string;
  label: string;
}

export interface VoiceDiscovery {
  ok: boolean;
  voices: VoiceOption[];
  requiresChoice: boolean;
  message?: string;
}

/** Ask the voice service which voices this account has. */
export async function discoverVoices(provider: string, apiKey: string): Promise<VoiceDiscovery> {
  try {
    const res = await postJson('/api/tts/voices', { provider, apiKey });
    if (!res.ok) {
      return { ok: false, voices: [], requiresChoice: false, message: await errorMessage(res, 'KITT could not read your voice list.') };
    }
    const json = (await res.json()) as { voices?: VoiceOption[]; requiresChoice?: boolean };
    return { ok: true, voices: json.voices ?? [], requiresChoice: Boolean(json.requiresChoice) };
  } catch {
    return { ok: false, voices: [], requiresChoice: false, message: 'KITT could not reach the voice service. Check your connection.' };
  }
}

/** A short, memorable phrase used by TEST VOICE everywhere. */
export const VOICE_TEST_PHRASE = 'Voice systems online. All systems are functioning normally.';

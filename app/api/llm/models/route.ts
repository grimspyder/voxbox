// Lists the AI models an account can actually use, so setup never has to ask a
// normal user for a model name and never preselects a model the provider has
// retired. Fixed allowlisted destinations only — no user-supplied URLs.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LIMITS } from '@/lib/server/limits';
import { readJsonBody, jsonError, enforceRateLimit, providerSignal, corsHeaders, handlePreflight } from '@/lib/server/http';
import { consumerProviderError } from '@/lib/server/providerErrors';
import { chooseModel, providerCard } from '@/lib/config/providers';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    provider: z.enum(['openai', 'openrouter', 'anthropic', 'gemini']),
    apiKey: z.string().min(8).max(LIMITS.llm.keyChars),
  })
  .strict();

interface ModelEntry {
  id: string;
  label?: string;
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

async function fetchModels(provider: string, apiKey: string, signal: AbortSignal): Promise<ModelEntry[]> {
  switch (provider) {
    case 'openai':
    case 'openrouter': {
      const base = provider === 'openrouter' ? OPENROUTER_BASE : 'https://api.openai.com/v1';
      const res = await fetch(`${base}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal,
        redirect: 'error',
      });
      if (!res.ok) throw new Error(`model list ${res.status}`);
      const json = (await res.json()) as { data?: { id?: string; name?: string }[] };
      return (json.data ?? [])
        .filter((m): m is { id: string; name?: string } => typeof m?.id === 'string')
        .map((m) => ({ id: m.id, label: m.name }));
    }
    case 'anthropic': {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal,
        redirect: 'error',
      });
      if (!res.ok) throw new Error(`model list ${res.status}`);
      const json = (await res.json()) as { data?: { id?: string; display_name?: string }[] };
      return (json.data ?? [])
        .filter((m): m is { id: string; display_name?: string } => typeof m?.id === 'string')
        .map((m) => ({ id: m.id, label: m.display_name }));
    }
    case 'gemini': {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
        headers: { 'x-goog-api-key': apiKey },
        signal,
        redirect: 'error',
      });
      if (!res.ok) throw new Error(`model list ${res.status}`);
      const json = (await res.json()) as {
        models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
      };
      return (json.models ?? [])
        .filter((m) => typeof m.name === 'string' && (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => ({ id: (m.name as string).replace(/^models\//, ''), label: m.displayName }));
    }
    default:
      return [];
  }
}

export async function OPTIONS(req: NextRequest) {
  return handlePreflight(req) ?? jsonError('Method not allowed.', 405);
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req);
  const limited = enforceRateLimit(req, 'models', cors);
  if (limited) return limited;

  const body = await readJsonBody(req, bodySchema, 8 * 1024, 'KITT could not read that request.', cors);
  if (!body.ok) return body.response;
  const { provider, apiKey } = body.data;

  const card = providerCard(provider);
  const signal = providerSignal(req.signal, 20_000);
  try {
    const models = await fetchModels(provider, apiKey, signal);
    const recommended = chooseModel(
      models.map((m) => m.id),
      card?.preferredModels ?? [],
    );
    return NextResponse.json(
      { models, recommended },
      { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors } },
    );
  } catch (e) {
    const { message } = consumerProviderError(e);
    // A failed list is not fatal to setup: the user can still continue and
    // choose a model under Advanced Settings.
    return jsonError(message, 502, cors);
  }
}

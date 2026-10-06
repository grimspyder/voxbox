// Server route: chat completions via the configured provider.
//
// The user's key arrives from the client (BYOK) but is used only server-side,
// never echoed back and never logged. Every request is rate limited, size
// limited and schema validated before any provider call happens, and the
// destination is a fixed allowlisted host unless the deployment explicitly
// enables custom endpoints (production requirements §42–§48).
import { NextRequest, NextResponse } from 'next/server';
import { openaiProvider } from '@/lib/llm/providers/openaiProvider';
import { anthropicProvider } from '@/lib/llm/providers/anthropicProvider';
import { geminiProvider } from '@/lib/llm/providers/geminiProvider';
import { LLMConfig } from '@/lib/config/settings';
import { ChatMessage } from '@/lib/llm/types';
import { LIMITS } from '@/lib/server/limits';
import { llmRequestSchema } from '@/lib/server/schemas';
import { readJsonBody, jsonError, enforceRateLimit, providerSignal, NO_STORE_HEADERS, corsHeaders, handlePreflight } from '@/lib/server/http';
import { consumerProviderError } from '@/lib/server/providerErrors';
import { CUSTOM_ENDPOINTS_ENABLED, checkCustomEndpoint } from '@/lib/server/endpointGuard';

export const runtime = 'nodejs';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const XAI_BASE = 'https://api.x.ai/v1';

interface Impl {
  streamChat(messages: ChatMessage[], cfg: LLMConfig, signal?: AbortSignal): AsyncGenerator<string>;
  complete(messages: ChatMessage[], cfg: LLMConfig, signal?: AbortSignal): Promise<string>;
}

function pick(provider: string): Impl | null {
  switch (provider) {
    case 'openai':
    case 'openai-compatible':
    case 'openrouter':
    case 'xai':
      return openaiProvider;
    case 'anthropic':
      return anthropicProvider;
    case 'gemini':
      return geminiProvider;
    default:
      return null;
  }
}

export async function OPTIONS(req: NextRequest) {
  return handlePreflight(req) ?? jsonError('Method not allowed.', 405);
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req);
  const limited = enforceRateLimit(req, 'llm', cors);
  if (limited) return limited;

  const body = await readJsonBody(req, llmRequestSchema, LIMITS.llm.bodyBytes, 'Vox could not read that request.', cors);
  if (!body.ok) return body.response;
  const { provider, apiKey, model, baseUrl, temperature, maxTokens, messages, stream } = body.data;

  const impl = pick(provider);
  if (!impl) return jsonError('That AI provider is not supported by this build of Vox.', 400, cors);

  // Destination resolution. Production providers use fixed allowlisted hosts;
  // the OpenAI-compatible endpoint is developer-only and strictly validated.
  let resolvedBaseUrl: string | undefined;
  if (provider === 'openrouter') {
    resolvedBaseUrl = OPENROUTER_BASE;
  } else if (provider === 'xai') {
    resolvedBaseUrl = XAI_BASE;
  } else if (provider === 'openai-compatible') {
    if (!CUSTOM_ENDPOINTS_ENABLED) {
      return jsonError(
        'Custom AI endpoints are disabled in this build of Vox. Choose OpenAI, OpenRouter, Anthropic or Google Gemini instead.',
        403,
        cors,
      );
    }
    const check = checkCustomEndpoint(baseUrl ?? '');
    if (!check.ok) return jsonError(check.reason ?? 'That endpoint is not allowed.', 403, cors);
    resolvedBaseUrl = check.origin;
  }

  const cfg: LLMConfig = {
    apiKey,
    model,
    temperature,
    maxTokens,
    baseUrl: resolvedBaseUrl,
    provider: provider as LLMConfig['provider'],
  };
  const chatMessages = messages as ChatMessage[];
  const signal = providerSignal(req.signal, LIMITS.providerTimeoutMs);

  if (stream) {
    const encoder = new TextEncoder();
    const gen = impl.streamChat(chatMessages, cfg, signal);
    const rs = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await gen.next();
          if (done) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(JSON.stringify({ t: value }) + '\n'));
        } catch (e) {
          controller.enqueue(encoder.encode(JSON.stringify({ e: consumerProviderError(e).message }) + '\n'));
          controller.close();
        }
      },
      cancel() {
        void gen.return?.(undefined);
      },
    });
    return new NextResponse(rs, {
      headers: { ...NO_STORE_HEADERS, ...cors, 'content-type': 'application/x-ndjson' },
    });
  }

  try {
    const text = await impl.complete(chatMessages, cfg, signal);
    return NextResponse.json({ text }, { headers: { ...NO_STORE_HEADERS, ...cors } });
  } catch (e) {
    const { message, status } = consumerProviderError(e);
    return jsonError(message, status, cors);
  }
}

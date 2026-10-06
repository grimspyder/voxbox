// xAI Grok live search — the one place the agentic search tools are used.
//
// The legacy Live Search API (`search_parameters` on chat completions) was
// retired on 2026-01-12 and now answers 410 Gone, so a live lookup must go
// through the Responses API at /v1/responses with a server-side `web_search`
// (and optionally `x_search`) tool. Grok itself decides whether a search is
// warranted; when it is not, it replies NONE and we return `searched: false`.
//
// Called only from the server route; the key never touches the browser.
import { Citation } from '../types';
import { LIMITS } from '../../server/limits';

const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';
const DEFAULT_MODEL = 'grok-4-fast';

export interface LiveSearchOutcome {
  searched: boolean;
  summary: string;
  citations: Citation[];
}

const INSTRUCTIONS = [
  'You are the background fact-retrieval step for a voice assistant.',
  'If answering the user needs current, real-time or post-training information — news, prices, scores, weather, forecasts, releases, or anything described as latest/today/now/this year — use the search tools, then reply with ONLY a short factual summary of what you found: one to four plain sentences, no preamble and no citation markup.',
  'If the question does not need live information, reply with exactly: NONE',
].join(' ');

interface ResponsesAnnotation {
  type?: string;
  url?: string;
  title?: string;
}
interface ResponsesContent {
  type?: string;
  text?: string;
  annotations?: ResponsesAnnotation[];
}
interface ResponsesItem {
  type?: string;
  content?: ResponsesContent[];
}
interface ResponsesBody {
  output?: ResponsesItem[];
  output_text?: string;
}

function collect(body: ResponsesBody): { summary: string; citations: Citation[] } {
  let summary = '';
  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const item of body.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type !== 'output_text' || typeof c.text !== 'string') continue;
      summary += c.text;
      for (const a of c.annotations ?? []) {
        if (a.type !== 'url_citation' || !a.url || seen.has(a.url)) continue;
        seen.add(a.url);
        citations.push({ url: a.url, title: a.title || a.url });
      }
    }
  }
  if (!summary.trim() && typeof body.output_text === 'string') summary = body.output_text;
  return { summary, citations };
}

/**
 * Ask Grok, with web and X search enabled, for the facts behind `query`.
 * Never throws a provider-shaped message that could leak the key: the caller
 * maps the plain Error through consumerProviderError.
 */
export async function liveSearch(input: {
  apiKey: string;
  model?: string;
  query: string;
  context?: string;
  signal?: AbortSignal;
}): Promise<LiveSearchOutcome> {
  const prompt = input.context?.trim()
    ? `${input.context.trim()}\n\nQuestion: ${input.query}`
    : `Question: ${input.query}`;

  const res = await fetch(XAI_RESPONSES_URL, {
    method: 'POST',
    redirect: 'error',
    signal: input.signal,
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      model: input.model?.trim() || DEFAULT_MODEL,
      instructions: INSTRUCTIONS,
      input: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search' }, { type: 'x_search' }],
      store: false,
    }),
  });

  if (!res.ok) {
    // Read a bounded slice of the body for the message; never echo headers.
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* no body */
    }
    throw new Error(`xAI live search ${res.status}${detail ? `: ${detail}` : ''}`);
  }

  const body = (await res.json()) as ResponsesBody;
  const { summary, citations } = collect(body);
  const trimmed = summary.trim().slice(0, LIMITS.live.maxSummaryChars);
  const searched = trimmed.length > 0 && !/^NONE\b/i.test(trimmed);
  return {
    searched,
    summary: searched ? trimmed : '',
    citations: searched ? citations.slice(0, 8) : [],
  };
}

// Runtime request schemas. TypeScript interfaces are erased at runtime — these
// are the actual contract the public proxies enforce (see §42).
import { z } from 'zod';
import { LIMITS, LLM_PROVIDERS, TTS_PROVIDERS } from './limits';

const apiKey = z
  .string()
  .min(8, 'That key looks too short to be valid.')
  .max(LIMITS.llm.keyChars, 'That key is longer than any supported provider key.');

export const chatMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().max(LIMITS.llm.maxMessageChars, 'A message is too long.'),
  })
  .strict();

export const llmRequestSchema = z
  .object({
    provider: z.enum(LLM_PROVIDERS),
    apiKey,
    model: z.string().trim().min(1).max(LIMITS.llm.modelChars),
    baseUrl: z.string().max(300).optional(),
    temperature: z.number().min(LIMITS.llm.minTemperature).max(LIMITS.llm.maxTemperature),
    maxTokens: z.number().int().min(1).max(LIMITS.llm.maxTokens),
    messages: z.array(chatMessageSchema).min(1).max(LIMITS.llm.maxMessages),
    stream: z.boolean().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const total = body.messages.reduce((sum, m) => sum + m.content.length, 0);
    if (total > LIMITS.llm.maxTotalChars) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'This conversation is too long to send.' });
    }
    const systemChars = body.messages
      .filter((m) => m.role === 'system')
      .reduce((sum, m) => sum + m.content.length, 0);
    if (systemChars > LIMITS.llm.maxSystemChars) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The system prompt is too long.' });
    }
  });

export const ttsRequestSchema = z
  .object({
    provider: z.enum(TTS_PROVIDERS),
    apiKey,
    voiceId: z.string().trim().max(LIMITS.tts.voiceIdChars).optional().default(''),
    model: z.string().trim().max(LIMITS.tts.modelChars).optional().default(''),
    text: z.string().trim().min(1, 'There is no text to speak.').max(LIMITS.tts.maxTextChars, 'That text is too long to speak in one segment.'),
    stability: z.number().min(0).max(1).optional().default(0.5),
    similarityBoost: z.number().min(0).max(1).optional().default(0.75),
    style: z.number().min(0).max(1).optional().default(0),
    speed: z.number().min(0.5).max(2).optional().default(1),
    speakerBoost: z.boolean().optional().default(true),
  })
  .strict();

export type LlmRequest = z.infer<typeof llmRequestSchema>;
export type TtsRequest = z.infer<typeof ttsRequestSchema>;

/** Turn a ZodError into one short consumer-safe sentence. */
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'The request could not be validated.';
  if (/unrecognized key/i.test(issue.message)) return 'The request contained unsupported fields.';
  if (issue.code === z.ZodIssueCode.invalid_enum_value || /invalid enum value/i.test(issue.message)) {
    return 'That provider is not supported by this build of KITT.';
  }
  if (issue.code === z.ZodIssueCode.too_small && issue.path.includes('messages')) {
    return 'KITT had nothing to send to the AI service.';
  }
  return issue.message;
}

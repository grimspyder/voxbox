// Why did OpenAI reject this key?
//
// OpenAI answers 401 with a useful explanation and the route used to throw it
// away, telling the user "check your key" even when the key was fine and the
// real problem was a key from another provider, a revoked key, or two keys
// pasted into one field. That last one is the sneaky case: the settings field
// holds the real key, so pasting over it on a phone appends, and the result is
// a perfectly well-formed string that OpenAI cannot possibly accept.
//
// This module classifies that situation from the key alone, without ever
// logging or returning the secret.
export type KeyProblem =
  | 'duplicated'
  | 'wrong-provider'
  | 'looks-truncated'
  | 'rejected';

export interface KeyDiagnosis {
  problem: KeyProblem;
  /** Safe to show the user: never contains the key. */
  message: string;
  /** e.g. "sk-proj…4f2a, 164 chars" — enough to recognise which key it is. */
  fingerprint: string;
}

/** Providers whose keys are routinely mistaken for OpenAI keys. */
const FOREIGN_PREFIXES: Array<[RegExp, string]> = [
  [/^sk-or-v1-/i, 'an OpenRouter'],
  [/^gsk_/i, 'a Groq'],
  [/^xai-/i, 'an xAI'],
  [/^AIza/i, 'a Google'],
  [/^sk-ant-/i, 'an Anthropic'],
  [/^hf_/i, 'a Hugging Face'],
  [/^r8_/i, 'a Replicate'],
  [/^pplx-/i, 'a Perplexity'],
  [/^sk-lf-/i, 'a Langfuse'],
];

export function fingerprintKey(key: string): string {
  if (key.length <= 12) return `${key.length} chars`;
  return `${key.slice(0, 7)}…${key.slice(-4)}, ${key.length} chars`;
}

export function diagnoseSttKey(key: string): KeyDiagnosis {
  const trimmed = key.trim();
  const fingerprint = fingerprintKey(trimmed);

  // Two keys pasted into one field: the opening characters reappear later.
  const head = trimmed.slice(0, 12);
  if (head.length === 12 && trimmed.indexOf(head, 12) !== -1) {
    return {
      problem: 'duplicated',
      fingerprint,
      message:
        'That field contains two keys pasted together. Clear it and paste the key once — the box already holds the saved key, so pasting on top appends to it.',
    };
  }

  for (const [pattern, name] of FOREIGN_PREFIXES) {
    if (pattern.test(trimmed)) {
      return {
        problem: 'wrong-provider',
        fingerprint,
        message: `That is ${name} key, not an OpenAI key. Speech recognition only accepts OpenAI keys (they start with sk- or sk-proj-).`,
      };
    }
  }

  if (!/^sk-/.test(trimmed)) {
    return {
      problem: 'wrong-provider',
      fingerprint,
      message:
        'That is not an OpenAI key. Speech recognition needs an OpenAI key, which starts with sk- or sk-proj-.',
    };
  }

  if (trimmed.length < 40) {
    return {
      problem: 'looks-truncated',
      fingerprint,
      message: `That key looks incomplete — ${trimmed.length} characters, which is shorter than any OpenAI key. Copy it again from the OpenAI dashboard.`,
    };
  }

  return {
    problem: 'rejected',
    fingerprint,
    message:
      'OpenAI rejected this key. It may have been revoked or regenerated since you saved it, so copy the current key from platform.openai.com/api-keys.',
  };
}

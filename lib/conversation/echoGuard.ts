// Textual echo guard — the last line of defence against Vox hearing itself.
//
// The acoustic fix is layered (half-duplex turn gate, a post-playback guard, and
// barge-in that is only enabled when echo cancellation is confirmed). This module
// is the cheap backstop for whatever survives all of that: the phone's speaker,
// the microphone a few centimetres away, and a recogniser that has no idea which
// of the two voices in the room is the user.
//
// It is deliberately NOT the primary defence. The microphone hears a distorted
// copy of Vox — a phone speaker at close range, often clipped — so the transcript
// comes back mangled ("onboard computer" -> "own board computer") and a similarity
// test cannot match words the recogniser never got right. Two independent signals
// are therefore used, and a transcript is only rejected when it clearly looks like
// something Vox just said.

/** Lowercase, strip punctuation, collapse whitespace: comparable text. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  const n = normalizeForMatch(text);
  return n ? n.split(' ') : [];
}

/** Word pairs, so "all systems operational" and "all systems are operational" still share one. */
function bigrams(list: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < list.length - 1; i++) out.add(list[i] + ' ' + list[i + 1]);
  return out;
}

/** Fraction of the candidate's word pairs that also occur in the reference. */
export function bigramOverlap(candidate: string, reference: string): number {
  const c = bigrams(words(candidate));
  if (c.size === 0) return 0;
  const r = bigrams(words(reference));
  let hits = 0;
  for (const gram of c) if (r.has(gram)) hits++;
  return hits / c.size;
}

/** Fraction of the candidate's words that appear anywhere in the reference. */
export function wordContainment(candidate: string, reference: string): number {
  const c = words(candidate);
  if (c.length === 0) return 0;
  const r = new Set(words(reference));
  let hits = 0;
  for (const w of c) if (r.has(w)) hits++;
  return hits / c.length;
}

/** A short utterance cannot carry enough evidence to be called an echo. */
export const MIN_ECHO_WORDS = 3;

/** Above this similarity the transcript is treated as Vox's own words. */
export const SELF_ECHO_THRESHOLD = 0.7;

/**
 * True when `transcript` looks like it was produced by listening to `reference`
 * rather than by a human answering Vox.
 *
 * Uses the better of two views: word containment catches a paraphrase of a long
 * sentence, bigram overlap catches a phrase lifted out of one. Short transcripts
 * are only rejected on an exact match, because "yes", "stop" and "louder" are
 * real replies and swallowing them would be worse than the echo.
 */
export function looksLikeSelfEcho(
  transcript: string,
  reference: string,
  threshold = SELF_ECHO_THRESHOLD,
): boolean {
  const t = words(transcript);
  if (t.length === 0) return false;
  const ref = normalizeForMatch(reference);
  if (!ref) return false;
  if (t.length < MIN_ECHO_WORDS) return t.join(' ') === ref;
  return Math.max(wordContainment(transcript, reference), bigramOverlap(transcript, reference)) >= threshold;
}

export interface EchoGuardOptions {
  /** How long a spoken sentence stays eligible as an echo reference. */
  ttlMs?: number;
  /** Upper bound on remembered sentences, newest kept. */
  maxEntries?: number;
  threshold?: number;
}

/**
 * Remembers what Vox actually said, recently, and answers whether an incoming
 * voice transcript is Vox hearing itself.
 *
 * Entries expire, so a phrase the user deliberately repeats minutes later is not
 * mistaken for an echo, and only the tail of the conversation is ever in play.
 */
export class SelfEchoGuard {
  private entries: { text: string; at: number }[] = [];
  private ttlMs: number;
  private maxEntries: number;
  private threshold: number;

  constructor(opts: EchoGuardOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 15000;
    this.maxEntries = opts.maxEntries ?? 12;
    this.threshold = opts.threshold ?? SELF_ECHO_THRESHOLD;
  }

  /** Record a sentence as it is handed to the voice, before it becomes audible. */
  record(text: string, at: number = Date.now()): void {
    const t = (text || '').trim();
    if (!t) return;
    this.entries.push({ text: t, at });
    this.prune(at);
  }

  /** True when the transcript should be dropped rather than answered. */
  isEcho(transcript: string, at: number = Date.now()): boolean {
    this.prune(at);
    if (this.entries.length === 0) return false;
    return this.entries.some((e) => looksLikeSelfEcho(transcript, e.text, this.threshold));
  }

  /** What is currently remembered — for diagnostics and tests. */
  recent(): string[] {
    return this.entries.map((e) => e.text);
  }

  clear(): void {
    this.entries = [];
  }

  private prune(at: number): void {
    const cutoff = at - this.ttlMs;
    this.entries = this.entries.filter((e) => e.at >= cutoff).slice(-this.maxEntries);
  }
}

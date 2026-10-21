import { diagnoseSttKey } from '@/lib/server/sttKey';

/**
 * OpenAI's 401 used to become "check your key", which is useless when the key
 * on the wire is two keys pasted together — the case that happens on a phone,
 * where tapping the field leaves the caret at the end of the saved key.
 */
describe('speech key diagnosis', () => {
  const key = (n = 164, prefix = 'sk-proj-') =>
    prefix + 'A'.repeat(n - prefix.length - 4) + 'abcd';

  it('detects a key pasted twice', () => {
    const k = key();
    const d = diagnoseSttKey(k + k);
    expect(d.problem).toBe('duplicated');
    expect(d.message).toMatch(/two keys pasted together/i);
  });

  it('names the provider when an OpenRouter key is used', () => {
    const d = diagnoseSttKey('sk-or-v1-' + 'b'.repeat(60));
    expect(d.problem).toBe('wrong-provider');
    expect(d.message).toMatch(/OpenRouter/);
  });

  it('names the provider for a Groq key', () => {
    expect(diagnoseSttKey('gsk_' + 'c'.repeat(50)).message).toMatch(/Groq/);
  });

  it('flags a truncated key', () => {
    const d = diagnoseSttKey('sk-proj-short');
    expect(d.problem).toBe('looks-truncated');
  });

  it('falls back to revoked-or-regenerated for a well-formed key', () => {
    const d = diagnoseSttKey(key());
    expect(d.problem).toBe('rejected');
    expect(d.message).toMatch(/revoked or regenerated/i);
    expect(d.fingerprint).toMatch(/^sk-proj…abcd, 164 chars$/);
  });

  it('never includes the full key in the fingerprint', () => {
    const k = key();
    const d = diagnoseSttKey(k);
    expect(d.fingerprint).not.toContain(k);
    expect(d.message).not.toContain(k.slice(10, 30));
  });
});

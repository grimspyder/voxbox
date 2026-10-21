import { segmentIdentity } from '@/lib/traffic/segment';

/**
 * Unnamed segments must not collapse into one shared identity. The first real
 * drive logged a limit with no road name ("NC" only), which is exactly the case
 * that would otherwise keep an old limit alive onto a different road.
 */
describe('speed-limit segment identity', () => {
  const at = (lon: number, lat: number): [number, number] => [lon, lat];

  it('uses road name, state and limit when a name exists', () => {
    expect(segmentIdentity('NC', 'Autry Rd', 55, at(-78.6, 35.7))).toBe('NC|Autry Rd|55');
  });

  it('gives unnamed positions on different roads different identities', () => {
    const a = segmentIdentity('NC', null, 45, at(-78.9001, 35.2001));
    const b = segmentIdentity('NC', null, 45, at(-78.9500, 35.2500));
    expect(a).not.toBe(b);
  });

  it('treats GPS jitter in place as the same unnamed segment', () => {
    const a = segmentIdentity('NC', null, 45, at(-78.90012, 35.20011));
    const b = segmentIdentity('NC', null, 45, at(-78.90018, 35.20019));
    expect(a).toBe(b);
  });

  it('still separates states and limits', () => {
    expect(segmentIdentity('VA', null, 45, at(-78.9, 35.2))).not.toBe(
      segmentIdentity('NC', null, 45, at(-78.9, 35.2)),
    );
    expect(segmentIdentity('NC', null, 45, at(-78.9, 35.2))).not.toBe(
      segmentIdentity('NC', null, 55, at(-78.9, 35.2)),
    );
  });
});

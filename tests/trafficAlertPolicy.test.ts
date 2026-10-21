/**
 * Behavioural tests for the speed alert policy.
 *
 * These are the tests that matter: they encode "does not nag", "does not fire on
 * GPS jitter", "escalates immediately" and "never swallows a charge warning".
 * Everything here runs on synthetic timestamps, so no device or API is involved.
 */
describe('speed alert policy', () => {
  const drive = async (overrides: Record<string, unknown> = {}) => {
    const { SpeedAlertPolicy, DEFAULT_TRAFFIC_POLICY } = await import('@/lib/traffic/alertPolicy');
    return new SpeedAlertPolicy({ ...DEFAULT_TRAFFIC_POLICY, ...overrides });
  };

  const at = (t: number, speed: number, limit = 35, segmentId: string | null = 'seg-1') => ({
    t,
    speedMph: speed,
    limitMph: limit,
    segmentId,
  });

  it('stays silent when the limit is unknown', async () => {
    const p = await drive();
    const out = [];
    for (let t = 0; t < 30; t += 1) out.push(...p.update(at(t, 90, null as unknown as number)));
    expect(out).toHaveLength(0);
  });

  it('stays silent below the driving speed floor', async () => {
    const p = await drive();
    const out = [];
    for (let t = 0; t < 30; t += 1) out.push(...p.update(at(t, 8)));
    expect(out.filter((a) => a.kind !== 'limit')).toHaveLength(0);
  });

  it('does not fire on jitter around a band edge', async () => {
    const p = await drive();
    const out = [];
    // Alternates 5.1 over / 4.7 over — never holds the band for armSeconds.
    for (let t = 0; t < 20; t += 1) out.push(...p.update(at(t, 35 + (t % 2 === 0 ? 5.1 : 4.7))));
    expect(out.filter((a) => a.kind === 'band')).toHaveLength(0);
  });

  it('announces a held band exactly once', async () => {
    const p = await drive();
    const out = [];
    for (let t = 0; t < 120; t += 1) out.push(...p.update(at(t, 40))); // 5 over, sustained
    const bands = out.filter((a) => a.kind === 'band');
    expect(bands).toHaveLength(1);
    expect(bands[0].bandMph).toBe(5);
    expect(bands[0].t).toBeGreaterThanOrEqual(2.5);
  });

  it('escalates to the next band without waiting for the repeat cooldown', async () => {
    const p = await drive();
    const out = [];
    for (let t = 0; t < 6; t += 1) out.push(...p.update(at(t, 40))); // 5 over
    for (let t = 6; t < 14; t += 1) out.push(...p.update(at(t, 45))); // 10 over
    const bands = out.filter((a) => a.kind === 'band').map((a) => a.bandMph);
    expect(bands).toEqual([5, 10]);
  });

  it('suppresses the soft notice when a higher band qualifies on the same sample', async () => {
    const p = await drive();
    const out = [];
    // A sudden GPS/position jump lands at +6. Both timers expire together,
    // but one sample must not produce "over the limit" and then "five over".
    for (let t = 0; t < 10; t += 1) out.push(...p.update(at(t, 41)));
    expect(out.filter((a) => a.kind === 'over')).toHaveLength(0);
    expect(out.filter((a) => a.kind === 'band').map((a) => a.bandMph)).toEqual([5]);
  });

  it('speaks the soft notice first when it qualifies before any higher band', async () => {
    const p = await drive();
    const out = [];
    // Hold at +2 long enough for the soft alert, then accelerate to +5.
    for (let t = 0; t < 6; t += 1) out.push(...p.update(at(t, 37)));
    for (let t = 6; t < 14; t += 1) out.push(...p.update(at(t, 40)));
    expect(out.filter((a) => a.kind === 'over')).toHaveLength(1);
    expect(out.filter((a) => a.kind === 'band').map((a) => a.bandMph)).toEqual([5]);
  });

  it('speaks one soft notice when no higher band qualifies', async () => {
    const p = await drive();
    const out = [];
    for (let t = 0; t < 10; t += 1) out.push(...p.update(at(t, 36)));
    expect(out.map((a) => a.kind)).toContain('over');
    expect(out.filter((a) => a.kind === 'over')).toHaveLength(1);
  });

  it('re-arms after a clear drop below the band', async () => {
    const p = await drive();
    const out = [];
    for (let t = 0; t < 10; t += 1) out.push(...p.update(at(t, 40))); // announce 5
    for (let t = 10; t < 20; t += 1) out.push(...p.update(at(t, 36))); // 1 over -> release
    for (let t = 20; t < 80; t += 1) out.push(...p.update(at(t, 40))); // re-announce after cooldown
    const bands = out.filter((a) => a.kind === 'band');
    expect(bands.length).toBe(2);
    expect(bands[1].t - bands[0].t).toBeGreaterThanOrEqual(60);
  });

  it('resets every band when the road segment changes', async () => {
    const p = await drive();
    const out = [];
    for (let t = 0; t < 10; t += 1) out.push(...p.update(at(t, 40, 35, 'seg-1')));
    for (let t = 10; t < 20; t += 1) out.push(...p.update(at(t, 40, 35, 'seg-2')));
    expect(out.filter((a) => a.kind === 'band')).toHaveLength(2);
  });

  it('does not re-announce the same limit on segment churn', async () => {
    const p = await drive();
    const out = [];
    for (let t = 0; t < 10; t += 1) out.push(...p.update(at(t, 45, 35, `seg-${t}`)));
    expect(out.filter((a) => a.kind === 'limit')).toHaveLength(1);
  });

  it('caps chatter per minute but never suppresses a charge warning', async () => {
    const p = await drive({ chargeThresholdMph: 20, maxPerMinute: 2 });
    const out = [];
    for (let t = 0; t < 3; t += 1) out.push(...p.update(at(t, 45))); // 10 over -> over + band 5 + band 10
    for (let t = 3; t < 8; t += 1) out.push(...p.update(at(t, 56))); // 21 over -> charge must speak
    const charge = out.filter((a) => a.kind === 'charge');
    expect(charge).toHaveLength(1);
    expect(out.filter((a) => a.kind === 'band').length).toBeLessThanOrEqual(2);
  });

  it('speaks the charge once per crossing', async () => {
    const p = await drive({ chargeThresholdMph: 20 });
    const out = [];
    for (let t = 0; t < 40; t += 1) out.push(...p.update(at(t, 56)));
    expect(out.filter((a) => a.kind === 'charge')).toHaveLength(1);
  });

  it('formats the requested wording', async () => {
    const { formatTrafficAlert } = await import('@/lib/traffic/alertPolicy');
    const base = { speedMph: 40, limitMph: 35, t: 0 };
    expect(formatTrafficAlert({ ...base, kind: 'band', bandMph: 5 })).toBe(
      'You are doing five miles over the speed limit.',
    );
    expect(formatTrafficAlert({ ...base, kind: 'band', bandMph: 10 })).toBe('Ten miles over.');
    expect(formatTrafficAlert({ ...base, kind: 'over', bandMph: null })).toBe('Over the limit.');
    expect(formatTrafficAlert({ ...base, kind: 'limit', bandMph: null })).toBe('Speed limit thirty-five.');
    expect(
      formatTrafficAlert(
        { ...base, kind: 'charge', bandMph: 20 },
        { stateName: 'Virginia', chargeLabel: 'reckless driving, a Class 1 misdemeanor' },
      ),
    ).toBe('Twenty miles over in Virginia is reckless driving, a Class 1 misdemeanor.');
  });
});

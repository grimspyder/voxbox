/**
 * Jurisdiction rules and state tracking.
 *
 * NC is the default market; VA is verified because the user drives out of
 * state. The rules must stay honest: only statute-backed numeric triggers are
 * ever spoken, and an unverified state produces silence, not a guess.
 */
describe('jurisdictions', () => {
  it('NC: 16 over is a Class 3 misdemeanor, exactly 15 is not', async () => {
    const { chargeForSpeed } = await import('@/lib/traffic/jurisdictions');
    expect(chargeForSpeed('NC', 65, 50)).toBeNull(); // exactly 15 over
    const rule = chargeForSpeed('NC', 66, 50); // 16 over
    expect(rule?.id).toBe('nc-20-141-j1-over');
    expect(rule?.label).toBe('speeding, a Class 3 misdemeanor');
    expect(rule?.citation).toBe('N.C. Gen. Stat. § 20-141(j1)');
  });

  it('NC: over 80 mph fires on absolute speed even under the limit', async () => {
    const { chargeForSpeed } = await import('@/lib/traffic/jurisdictions');
    // 80 in a 75 zone: 5 over, but not over 80 -> nothing.
    expect(chargeForSpeed('NC', 80, 75)).toBeNull();
    // 81 in a 75 zone: 6 over, but over 80 -> absolute rule.
    const rule = chargeForSpeed('NC', 81, 75);
    expect(rule?.id).toBe('nc-20-141-j1-absolute');
  });

  it('NC: discretionary reckless driving is never used to announce a charge', async () => {
    const { chargeForSpeed } = await import('@/lib/traffic/jurisdictions');
    const rule = chargeForSpeed('NC', 120, 70);
    expect(rule?.id).not.toBe('nc-20-140-reckless');
    expect(rule?.verified).toBe(true);
  });

  it('VA: exactly 20 over and over 85 are reckless driving', async () => {
    const { chargeForSpeed } = await import('@/lib/traffic/jurisdictions');
    expect(chargeForSpeed('VA', 55, 35)?.id).toBe('va-46.2-862-over'); // exactly 20 over
    expect(chargeForSpeed('VA', 54, 35)).toBeNull(); // 19 over
    expect(chargeForSpeed('VA', 86, 70)?.id).toBe('va-46.2-862-absolute');
    // 85 is NOT "in excess of 85", so at 85 in a 55 zone only the 20-over rule applies.
    expect(chargeForSpeed('VA', 85, 55)?.id).toBe('va-46.2-862-over');
    // 86 in a 55 zone is both, and the absolute rule is reported.
    expect(chargeForSpeed('VA', 86, 55)?.id).toBe('va-46.2-862-absolute');
  });

  it('unknown or unverified states produce no charge at all', async () => {
    const { chargeForSpeed, chargeConfigFor } = await import('@/lib/traffic/jurisdictions');
    expect(chargeForSpeed('TX', 120, 60)).toBeNull();
    expect(chargeForSpeed(null, 120, 60)).toBeNull();
    expect(chargeConfigFor('TX')).toEqual({
      chargeThresholdMph: null,
      chargeThresholdMode: 'gte',
      chargeAbsoluteMph: null,
    });
  });

  it('maps jurisdiction rules onto policy config', async () => {
    const { chargeConfigFor } = await import('@/lib/traffic/jurisdictions');
    expect(chargeConfigFor('NC')).toEqual({
      chargeThresholdMph: 15,
      chargeThresholdMode: 'gt',
      chargeAbsoluteMph: 80,
    });
    expect(chargeConfigFor('VA')).toEqual({
      chargeThresholdMph: 20,
      chargeThresholdMode: 'gte',
      chargeAbsoluteMph: 85,
    });
  });
});

describe('jurisdiction tracker', () => {
  it('adopts the first known state immediately', async () => {
    const { JurisdictionTracker } = await import('@/lib/traffic/jurisdictionTracker');
    const t = new JurisdictionTracker(2);
    expect(t.observe('nc')).toEqual({ changed: true, code: 'NC' });
  });

  it('does not switch on a single flickering sample at a border', async () => {
    const { JurisdictionTracker } = await import('@/lib/traffic/jurisdictionTracker');
    const t = new JurisdictionTracker(2);
    t.observe('NC');
    expect(t.observe('VA').changed).toBe(false);
    expect(t.state).toBe('NC');
    // Back to NC: the VA candidate is discarded.
    expect(t.observe('NC').changed).toBe(false);
    expect(t.state).toBe('NC');
    expect(t.pending).toBeNull();
  });

  it('switches after two consecutive samples in the new state', async () => {
    const { JurisdictionTracker } = await import('@/lib/traffic/jurisdictionTracker');
    const t = new JurisdictionTracker(2);
    t.observe('NC');
    t.observe('VA');
    const res = t.observe('VA');
    expect(res).toEqual({ changed: true, code: 'VA' });
  });

  it('never loses the current state on unknown samples', async () => {
    const { JurisdictionTracker } = await import('@/lib/traffic/jurisdictionTracker');
    const t = new JurisdictionTracker(2);
    t.observe('NC');
    expect(t.observe(null)).toEqual({ changed: false, code: 'NC' });
    expect(t.observe(undefined)).toEqual({ changed: false, code: 'NC' });
    expect(t.state).toBe('NC');
  });
});

describe('policy with jurisdiction thresholds', () => {
  const at = (t: number, speed: number, limit = 70) => ({ t, speedMph: speed, limitMph: limit, segmentId: 'seg' });

  it('NC absolute rule speaks above 80 even when only a few over', async () => {
    const { SpeedAlertPolicy } = await import('@/lib/traffic/alertPolicy');
    const { chargeConfigFor } = await import('@/lib/traffic/jurisdictions');
    const p = new SpeedAlertPolicy({ ...chargeConfigFor('NC'), bandsMph: [5, 10] });
    const out = [];
    for (let t = 0; t < 10; t += 1) out.push(...p.update(at(t, 81, 75)));
    const charge = out.find((a) => a.kind === 'charge');
    expect(charge?.chargeReason).toBe('absolute');
  });

  it('switching state at runtime applies the new threshold without resetting bands', async () => {
    const { SpeedAlertPolicy } = await import('@/lib/traffic/alertPolicy');
    const { chargeConfigFor } = await import('@/lib/traffic/jurisdictions');
    const p = new SpeedAlertPolicy({ ...chargeConfigFor('NC'), bandsMph: [5, 10, 15, 20] });
    const out = [];
    // 70 in a 55 zone = exactly 15 over. NC needs MORE than 15, and 70 < 80,
    // so no charge yet.
    for (let t = 0; t < 12; t += 1) out.push(...p.update(at(t, 70, 55)));
    expect(out.some((a) => a.kind === 'charge')).toBe(false);
    // Crossing into VA: 75 in a 55 zone = 20 over, which IS reckless driving there.
    p.setConfig(chargeConfigFor('VA'));
    for (let t = 12; t < 20; t += 1) out.push(...p.update(at(t, 75, 55)));
    const charge = out.find((a) => a.kind === 'charge');
    expect(charge?.kind).toBe('charge');
    expect(charge?.chargeReason).toBe('over');
  });

  it('formats an absolute-speed charge with the state name', async () => {
    const { formatTrafficAlert } = await import('@/lib/traffic/alertPolicy');
    const text = formatTrafficAlert(
      { kind: 'charge', bandMph: null, speedMph: 81, limitMph: 75, t: 0, chargeReason: 'absolute' },
      { stateName: 'North Carolina', chargeLabel: 'speeding, a Class 3 misdemeanor' },
    );
    expect(text).toBe('Eighty-one miles an hour in North Carolina is speeding, a Class 3 misdemeanor.');
  });
});

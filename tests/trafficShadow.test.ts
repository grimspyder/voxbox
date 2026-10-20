/**
 * Provider caching + shadow-mode drive session.
 *
 * The important properties under test:
 *  - the provider does not pay for the same answer repeatedly;
 *  - a failed lookup is retried, not pinned for the whole drive;
 *  - the shadow session logs what it would have said and never speaks;
 *  - jurisdiction changes follow the two-sample rule and swap charge rules.
 */
describe('speed limit provider', () => {
  it('does not re-query while the vehicle stays put and the interval has not elapsed', async () => {
    const { SpeedLimitProvider } = await import('@/lib/traffic/speedLimitProvider');
    let calls = 0;
    let clock = 1000;
    const p = new SpeedLimitProvider({
      now: () => clock,
      minIntervalMs: 8000,
      sameRoadMeters: 150,
      fetchLimit: async () => {
        calls += 1;
        return {
          limit: 35,
          unit: 'mph',
          type: 'Maximum',
          road: 'Main St',
          state: 'NC',
          segmentId: 'NC|Main St|35',
          cached: false,
        };
      },
    });

    await p.resolve({ lon: -78.6, lat: 35.7 });
    await p.resolve({ lon: -78.6, lat: 35.7 });
    expect(calls).toBe(1);

    clock += 9000; // interval elapsed, but no movement
    await p.resolve({ lon: -78.6, lat: 35.7 });
    expect(calls).toBe(1);

    // 200 m north: new road, so it looks up again.
    await p.resolve({ lon: -78.6, lat: 35.7018 });
    expect(calls).toBe(2);
  });

  it('retries a failed lookup instead of caching the failure forever', async () => {
    const { SpeedLimitProvider } = await import('@/lib/traffic/speedLimitProvider');
    let calls = 0;
    let clock = 0;
    const p = new SpeedLimitProvider({
      now: () => clock,
      minIntervalMs: 1000,
      sameRoadMeters: 0,
      fetchLimit: async () => {
        calls += 1;
        return {
          limit: null,
          unit: null,
          type: null,
          road: null,
          state: null,
          segmentId: null,
          cached: false,
          reason: 'network',
        };
      },
    });
    await p.resolve({ lon: 0, lat: 0 });
    clock += 1500;
    await p.resolve({ lon: 0, lat: 0 });
    expect(calls).toBe(2);
  });

  it('sends two points (TomTom requires at least two)', async () => {
    const { SpeedLimitProvider } = await import('@/lib/traffic/speedLimitProvider');
    let sent: [number, number][] = [];
    const p = new SpeedLimitProvider({
      now: () => 0,
      fetchLimit: async (points) => {
        sent = points;
        return {
          limit: 45,
          unit: 'mph',
          type: 'Maximum',
          road: 'A St',
          state: 'VA',
          segmentId: 'VA|A St|45',
          cached: false,
        };
      },
    });
    await p.resolve({ lon: -77.4, lat: 37.5 }, { lon: -77.41, lat: 37.49 });
    expect(sent).toEqual([
      [-77.41, 37.49],
      [-77.4, 37.5],
    ]);
  });
});

describe('shadow drive session', () => {
  const makeProvider = async (limit: number | null, state: string | null, road = 'Main St') => {
    const { SpeedLimitProvider } = await import('@/lib/traffic/speedLimitProvider');
    return new SpeedLimitProvider({
      now: () => 0,
      minIntervalMs: 0,
      sameRoadMeters: 0,
      fetchLimit: async () => ({
        limit,
        unit: limit === null ? null : 'mph',
        type: limit === null ? null : 'Maximum',
        road,
        state,
        segmentId: state && road && limit !== null ? `${state}|${road}|${limit}` : null,
        cached: false,
      }),
    });
  };

  it('logs the exact sentence it would have spoken, and speaks nothing', async () => {
    const { DriveSession, formatShadowLog } = await import('@/lib/traffic/driveSession');
    const provider = await makeProvider(35, 'NC');
    const session = new DriveSession({ provider });
    session.start();

    for (let t = 0; t < 10; t += 1) {
      await session.onFix({ t, lon: -78.6, lat: 35.7, speedMph: 41 });
    }
    const speech = session.log.filter((e) => e.text);
    expect(speech.length).toBeGreaterThan(0);
    expect(speech.some((e) => e.text.includes('five miles over'))).toBe(true);
    expect(session.log.some((e) => e.kind === 'state-change')).toBe(true);

    const rendered = formatShadowLog(session.log);
    expect(rendered).toContain('-> "');
    expect(rendered).toContain('Main St, NC');
  });

  it('stays silent when no limit is known', async () => {
    const { DriveSession } = await import('@/lib/traffic/driveSession');
    const provider = await makeProvider(null, null);
    const session = new DriveSession({ provider });
    session.start();
    for (let t = 0; t < 20; t += 1) {
      await session.onFix({ t, lon: -78.6, lat: 35.7, speedMph: 90 });
    }
    expect(session.log.filter((e) => e.text)).toHaveLength(0);
    expect(session.log.some((e) => e.kind === 'lookup-unknown')).toBe(true);
  });

  it('applies NC charge rules once the state is confirmed', async () => {
    const { DriveSession } = await import('@/lib/traffic/driveSession');
    const provider = await makeProvider(55, 'NC');
    const session = new DriveSession({ provider });
    session.start();
    for (let t = 0; t < 12; t += 1) {
      await session.onFix({ t, lon: -78.6, lat: 35.7, speedMph: 74 }); // 19 over in a 55
    }
    const charge = session.log.find((e) => e.kind === 'charge');
    expect(charge?.text).toContain('Class 3 misdemeanor');
    expect(charge?.text).toContain('North Carolina');
  });

  it('does nothing before start() is called', async () => {
    const { DriveSession } = await import('@/lib/traffic/driveSession');
    const provider = await makeProvider(35, 'NC');
    const session = new DriveSession({ provider });
    const out = await session.onFix({ t: 0, lon: -78.6, lat: 35.7, speedMph: 50 });
    expect(out).toHaveLength(0);
    expect(session.log).toHaveLength(0);
  });
});

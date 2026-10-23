/**
 * TrafficSpeaker — preemption and coalescing rules for spoken warnings.
 *
 * The device is a shared audio channel with the assistant, so the interesting
 * behaviour is what happens while something else is talking.
 */
describe('traffic speaker', () => {
  const alert = (kind: 'limit' | 'over' | 'band' | 'charge', bandMph: number | null = null) =>
    ({ kind, bandMph, speedMph: 40, limitMph: 35, t: 0 }) as never;

  const setup = async (speakImpl?: () => Promise<void>) => {
    const { TrafficSpeaker } = await import('@/lib/traffic/trafficSpeaker');
    const spoken: string[] = [];
    let interrupts = 0;
    const port = {
      speak: async (text: string) => {
        spoken.push(text);
        if (speakImpl) await speakImpl();
      },
      interrupt: () => {
        interrupts += 1;
      },
    };
    return { speaker: new TrafficSpeaker(port), spoken, interrupts: () => interrupts };
  };

  /** Resolve on demand so tests can hold the audio channel open. */
  const gate = () => {
    let open: (() => void) | null = null;
    const wait = () => new Promise<void>((resolve) => (open = resolve));
    return { wait, release: () => open?.() };
  };

  it('speaks immediately and interrupts the assistant', async () => {
    const { speaker, spoken, interrupts } = await setup();
    speaker.announce(alert('band', 5), 'You are doing five miles over the speed limit.');
    await Promise.resolve();
    await Promise.resolve();
    expect(spoken).toEqual(['You are doing five miles over the speed limit.']);
    expect(interrupts()).toBeGreaterThan(0);
  });

  it('keeps only the most urgent message while speaking', async () => {
    const g = gate();
    const { speaker, spoken } = await setup(g.wait);

    speaker.announce(alert('limit'), 'Speed limit fifty-five.');
    await Promise.resolve();
    await Promise.resolve();

    // Three alerts arrive while the limit announcement is still playing.
    speaker.announce(alert('over'), 'Over the limit.');
    speaker.announce(alert('band', 5), 'You are doing five miles over the speed limit.');
    speaker.announce(alert('band', 10), 'Ten miles over.');

    g.release();
    await new Promise((r) => setTimeout(r, 10));

    expect(spoken).toEqual(['Speed limit fifty-five.', 'Ten miles over.']);
  });

  it('does not let a stale lower-priority alert replace a queued higher one', async () => {
    const g = gate();
    const { speaker, spoken } = await setup(g.wait);

    speaker.announce(alert('limit'), 'Speed limit fifty-five.');
    await Promise.resolve();
    await Promise.resolve();

    speaker.announce(alert('band', 10), 'Ten miles over.');
    speaker.announce(alert('over'), 'Over the limit.'); // lower priority, must not win

    g.release();
    await new Promise((r) => setTimeout(r, 10));
    expect(spoken).toEqual(['Speed limit fifty-five.', 'Ten miles over.']);
  });

  it('keeps monitoring after a speech failure', async () => {
    let fail = true;
    const { speaker, spoken } = await setup(async () => {
      if (fail) throw new Error('tts down');
    });
    speaker.announce(alert('band', 5), 'Five over.');
    await new Promise((r) => setTimeout(r, 10));
    fail = false;
    speaker.announce(alert('band', 10), 'Ten miles over.');
    await new Promise((r) => setTimeout(r, 10));
    expect(spoken).toContain('Ten miles over.');
  });

  it('drops pending speech on dispose', async () => {
    const g = gate();
    const { speaker, spoken } = await setup(g.wait);
    speaker.announce(alert('limit'), 'Speed limit fifty-five.');
    await Promise.resolve();
    await Promise.resolve();
    speaker.announce(alert('band', 5), 'Five over.');
    speaker.dispose();
    g.release();
    await new Promise((r) => setTimeout(r, 10));
    expect(spoken).toEqual(['Speed limit fifty-five.']);
  });
});

describe('traffic speaker failure reporting', () => {
  it('reports a speech failure instead of failing silently', async () => {
    const { TrafficSpeaker } = await import('@/lib/traffic/trafficSpeaker');
    const errors: unknown[] = [];
    const speaker = new TrafficSpeaker(
      {
        speak: async () => {
          throw new Error('voice error 401');
        },
        interrupt: () => undefined,
      },
      { onError: (e) => errors.push(e) },
    );
    speaker.announce(
      { kind: 'band', bandMph: 5, speedMph: 40, limitMph: 35, t: 0 } as never,
      'Sorry, I cannot speak right now.',
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(errors).toHaveLength(1);
  });
});

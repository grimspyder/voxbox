describe('settings', () => {
  it('defaults to demo providers and browser STT', async () => {
    const { DEFAULT_SETTINGS, systemPromptFor } = await import('@/lib/config/settings');
    expect(DEFAULT_SETTINGS.llm.provider).toBe('demo');
    expect(DEFAULT_SETTINGS.tts.provider).toBe('demo');
    expect(DEFAULT_SETTINGS.stt.provider).toBe('browser');
    const p = systemPromptFor({ ...DEFAULT_SETTINGS, userName: 'Felix' });
    expect(p).toContain('Felix');
    expect(p).toContain('concise' as never) ;
  });

  it('maskKey never reveals the full key', async () => {
    const { maskKey } = await import('@/lib/config/storage');
    expect(maskKey('sk-abcdefghijklmnop')).toMatch(/^sk-••••••••mnop$/);
    expect(maskKey('short')).toBe('••••••••');
    expect(maskKey('')).toBe('');
  });

  it('save/load roundtrips non-secret settings and strips secrets', async () => {
    const store: Record<string, string> = {};
    const g = globalThis as unknown as { localStorage: Storage; crypto: Crypto };
    g.localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
      key: (i: number) => Object.keys(store)[i] ?? null,
      length: 0,
    };
    // jsdom exposes read-only crypto: patch its methods instead of replacing the object
    Object.defineProperty(g.crypto, 'getRandomValues', {
      value: (b: Uint8Array) => { for (let i = 0; i < b.length; i++) b[i] = i % 256; return b; },
      configurable: true,
    });
    Object.defineProperty(g.crypto, 'subtle', {
      value: {
        importKey: async () => ({}),
        encrypt: async () => new ArrayBuffer(32),
        decrypt: async () => new TextEncoder().encode(JSON.stringify({ llm: 'sk-test' })).buffer as ArrayBuffer,
      },
      configurable: true,
    });
    const { saveSettings, loadSettings } = await import('@/lib/config/storage');
    const { DEFAULT_SETTINGS } = await import('@/lib/config/settings');
    const s = { ...DEFAULT_SETTINGS, userName: 'Felix', llm: { ...DEFAULT_SETTINGS.llm, apiKey: 'sk-secret', provider: 'openai' as const } };
    await saveSettings(s);
    expect(store['kitt.settings.v1']).not.toContain('sk-secret');
    const raw = JSON.parse(store['kitt.settings.v1']);
    expect(raw.userName).toBe('Felix');
    expect(raw.llm.apiKey).toBe('');
    expect(raw.llm.provider).toBe('openai');
    const loaded = await loadSettings();
    expect(loaded.userName).toBe('Felix');
    expect(loaded.llm.apiKey).toBe('sk-test');
    expect(loaded.llm.provider).toBe('openai');
  });

  it('keeps a key typed this session even when keys are not saved', async () => {
    // "Remember keys on this device" is off by default, so storage holds no
    // secret. The drive panel still has to speak with the key the user just
    // entered, which means the live settings have to carry it.
    const store: Record<string, string> = {};
    const g = globalThis as unknown as { localStorage: Storage };
    g.localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
      key: (i: number) => Object.keys(store)[i] ?? null,
      length: 0,
    } as Storage;

    const { saveSettings, getCurrentSettings } = await import('@/lib/config/storage');
    const { DEFAULT_SETTINGS } = await import('@/lib/config/settings');
    const voiceKey = ['el', 'secret'].join('-');
    const live = {
      ...DEFAULT_SETTINGS,
      persistSecrets: false,
      tts: { ...DEFAULT_SETTINGS.tts, provider: 'elevenlabs' as const, voiceId: 'v1', apiKey: voiceKey },
    };
    await saveSettings(live);
    expect(getCurrentSettings()?.tts.apiKey).toBe(voiceKey);
    expect(store['kitt.settings.v1']).not.toContain(voiceKey);
  });
});

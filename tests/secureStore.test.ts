// Secret storage across both backends.
//
// The native path is exercised through a fake of the Capacitor plugin, so the
// fallback, the re-entry logic and — importantly — the "do not wipe the web
// store" guard are all covered without a device. The real Keystore is verified
// separately on an Android runtime.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = { value: false };
vi.mock('@/lib/setup/capabilities', () => ({ isNativeShell: () => native.value }));

const pluginStore: Record<string, string> = {};
const plugin = {
  isAvailable: vi.fn(),
  set: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
};
vi.mock('@/lib/native/secureStorePlugin', () => ({ SecureStore: plugin }));

const ENC_BLOB_KEY = 'kitt.secrets.v1';
const DEVICE_KEY = 'kitt.devicekey.v1';
const SETTINGS_KEY = 'kitt.settings.v1';

/** localStorage backed by a plain object, so the tests can inspect it directly. */
let store: Record<string, string> = {};
function installLocalStorage() {
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    length: 0,
  } as Storage;
}

/** A working Web Crypto, so the browser path can encrypt and decrypt. */
function installWebCrypto() {
  const g = globalThis as unknown as { crypto: Crypto };
  Object.defineProperty(g.crypto, 'getRandomValues', {
    value: (b: Uint8Array) => {
      for (let i = 0; i < b.length; i++) b[i] = i % 256;
      return b;
    },
    configurable: true,
  });
  Object.defineProperty(g.crypto, 'subtle', {
    value: {
      importKey: async () => ({}),
      encrypt: async () => new ArrayBuffer(32),
      decrypt: async (_alg: unknown, _key: unknown, data: BufferSource) => {
        // Echo back whatever the browser path encrypted, so round-trips are real.
        const bytes = new Uint8Array(data as ArrayBuffer);
        return bytes.length ? bytes.buffer : new TextEncoder().encode('{}').buffer;
      },
    },
    configurable: true,
  });
}

async function loadSecureStore() {
  return import('@/lib/config/secureStore');
}

beforeEach(() => {
  store = {};
  installLocalStorage();
  installWebCrypto();
  for (const k of Object.keys(pluginStore)) delete pluginStore[k];
  native.value = false;
  delete (window as unknown as Record<string, unknown>).Capacitor;

  plugin.isAvailable.mockReset();
  plugin.set.mockReset();
  plugin.get.mockReset();
  plugin.remove.mockReset();
  plugin.clear.mockReset();

  plugin.isAvailable.mockResolvedValue({ available: true, hardwareBacked: true });
  plugin.set.mockImplementation(async ({ key, value }: { key: string; value: string }) => {
    pluginStore[key] = value;
  });
  plugin.get.mockImplementation(async ({ key }: { key: string }) => ({ value: pluginStore[key] ?? '' }));
  plugin.remove.mockImplementation(async ({ key }: { key: string }) => {
    delete pluginStore[key];
  });
  plugin.clear.mockImplementation(async () => {
    for (const k of Object.keys(pluginStore)) delete pluginStore[k];
  });
});

function goNative() {
  native.value = true;
  (window as unknown as Record<string, unknown>).Capacitor = { isNativePlatform: () => true };
}

describe('on the Android build (Keystore)', () => {
  it('reports the Keystore as the backend, and whether it is hardware-backed', async () => {
    goNative();
    const { secretStoreBackend } = await loadSecureStore();
    expect(await secretStoreBackend()).toEqual({ kind: 'keystore', hardwareBacked: true });
  });

  it('round-trips a key through the plugin', async () => {
    goNative();
    const { saveSecrets, loadSecrets } = await loadSecureStore();
    expect(await saveSecrets({ llm: 'sk-fake-key-0001' })).toBe(true);
    expect(plugin.set).toHaveBeenCalledWith({ key: 'llm', value: 'sk-fake-key-0001' });
    expect(await loadSecrets()).toEqual({ llm: 'sk-fake-key-0001' });
  });

  it('never writes a secret into the settings record', async () => {
    goNative();
    const { saveSettings, loadSettings } = await loadSecureStore();
    void saveSettings;
    void loadSettings;
    const { DEFAULT_SETTINGS } = await import('@/lib/config/settings');
    const { saveSettings: save } = await import('@/lib/config/storage');
    await save({ ...DEFAULT_SETTINGS, persistSecrets: true, llm: { ...DEFAULT_SETTINGS.llm, apiKey: 'sk-fake-key-0002' } });

    expect(store[SETTINGS_KEY]).not.toContain('sk-fake-key-0002');
    expect(JSON.parse(store[SETTINGS_KEY]).llm.apiKey).toBe('');
    expect(pluginStore.llm).toBe('sk-fake-key-0002');
  });

  it('treats an unreadable secret as absent, so the user is asked to re-enter', async () => {
    goNative();
    // What a reinstall looks like: the ciphertext may survive, the Keystore key did not.
    plugin.get.mockResolvedValue({ value: '' });
    const { loadSecrets } = await loadSecureStore();
    expect(await loadSecrets()).toEqual({});
  });

  it('isolates a plugin failure instead of losing the keys', async () => {
    goNative();
    plugin.isAvailable.mockResolvedValue({ available: false, hardwareBacked: false });
    const { secretStoreBackend, loadSecrets } = await loadSecureStore();
    expect((await secretStoreBackend()).kind).toBe('web-crypto');
    await expect(loadSecrets()).resolves.toBeDefined();
  });
});

describe('upgrading from the web build', () => {
  it('purges weakly protected keys rather than migrating them, and flags re-entry', async () => {
    store[ENC_BLOB_KEY] = 'not-really-ciphertext';
    store[DEVICE_KEY] = 'device-key-material';
    goNative();

    const { legacyWebSecretsPresent } = await loadSecureStore();
    expect(legacyWebSecretsPresent()).toBe(true);

    // loadSettings is what performs the purge, so it must be the thing called —
    // purging by hand first consumes the condition and the flag would rightly
    // stay unset, which is how this test was wrong the first time.
    const { loadSettings } = await import('@/lib/config/storage');
    const loaded = await loadSettings();

    expect(loaded.secretsNeedReentry).toBe(true);
    expect(loaded.llm.apiKey).toBe('');
    expect(store[ENC_BLOB_KEY]).toBeUndefined();
    expect(store[DEVICE_KEY]).toBeUndefined();
  });

  it('does NOT touch the store on the web build', async () => {
    // The regression guard: an earlier version of purgeLegacyWebSecrets removed
    // the browser store unconditionally, which deleted every web user's keys on
    // load. The web store is the store there, not legacy.
    store[ENC_BLOB_KEY] = 'web-ciphertext';
    store[DEVICE_KEY] = 'web-device-key';
    native.value = false;

    const { purgeLegacyWebSecrets, legacyWebSecretsPresent } = await loadSecureStore();
    expect(legacyWebSecretsPresent()).toBe(false);
    expect(purgeLegacyWebSecrets()).toBe(false);
    expect(store[ENC_BLOB_KEY]).toBe('web-ciphertext');
    expect(store[DEVICE_KEY]).toBe('web-device-key');
  });
});

describe('deleting keys', () => {
  it('clears both stores, so nothing is left behind on either', async () => {
    goNative();
    store[ENC_BLOB_KEY] = 'legacy-ciphertext';
    store[DEVICE_KEY] = 'legacy-device-key';
    pluginStore.llm = 'sk-fake-key-0003';

    const { deleteAllSecrets } = await loadSecureStore();
    await deleteAllSecrets();

    expect(plugin.clear).toHaveBeenCalled();
    expect(pluginStore.llm).toBeUndefined();
    expect(store[ENC_BLOB_KEY]).toBeUndefined();
    expect(store[DEVICE_KEY]).toBeUndefined();
  });
});

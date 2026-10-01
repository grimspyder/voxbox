// Where API keys live, per platform.
//
// Native (Capacitor shell): an AES key held in the **Android Keystore** —
// non-exportable, hardware-backed where the device offers it — with ciphertext in
// app-private storage. The key never leaves the Keystore and cannot be read out
// of the app, which is the property the browser scheme cannot provide.
//
// Web: the same browser implementation as before (AES-GCM under Web Crypto, with
// the device key in localStorage). This is obfuscation rather than protection —
// anyone with the device can read both the key and the ciphertext — and it is
// documented as such in docs/PRODUCTION_REQUIREMENTS.md (SEC-09) rather than
// dressed up. A browser has no keystore to offer.
//
// The moving parts that matter:
//  - Keystore keys are destroyed on uninstall, so stored ciphertext becomes
//    undecryptable. That is a feature: a reinstalled app must ask the user to
//    re-enter rather than silently restoring credentials (brief §40).
//  - Anything weak that a previous install left in web storage is purged, never
//    copied up into the Keystore.

import { isNativeShell } from '../setup/capabilities';
import { SecureStore } from '../native/secureStorePlugin';

export type SecretName = 'llm' | 'tts' | 'stt';
export type StoredSecrets = Partial<Record<SecretName, string>>;

const SECRET_NAMES: SecretName[] = ['llm', 'tts', 'stt'];

/** Legacy browser-storage keys. Kept identical so existing users still load. */
const ENC_BLOB_KEY = 'kitt.secrets.v1';
const DEVICE_KEY = 'kitt.devicekey.v1';

export type BackendKind = 'keystore' | 'web-crypto' | 'session-only';

export interface SecretStoreBackend {
  kind: BackendKind;
  /** Only meaningful for the keystore backend, and reported by the device. */
  hardwareBacked: boolean;
}

// --- browser implementation (unchanged behaviour, same storage keys) ---------

async function getDeviceKey(): Promise<CryptoKey | null> {
  try {
    let raw = localStorage.getItem(DEVICE_KEY);
    if (!raw) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      raw = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
      localStorage.setItem(DEVICE_KEY, raw);
    }
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    return await crypto.subtle.importKey('raw', bytes as unknown as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

async function encryptJson(obj: unknown): Promise<string | null> {
  const key = await getDeviceKey();
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    data as unknown as BufferSource,
  );
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return btoa(Array.from(out, (b) => String.fromCharCode(b)).join(''));
}

async function decryptJson<T>(blob: string): Promise<T | null> {
  const key = await getDeviceKey();
  if (!key) return null;
  try {
    const bytes = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
    const iv = bytes.slice(0, 12);
    const ct = bytes.slice(12);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      ct as unknown as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    return null;
  }
}

// --- backend detection ------------------------------------------------------

function keystoreAvailable(): boolean {
  return isNativeShell() && typeof window !== 'undefined' && 'Capacitor' in window;
}

/** Which store is in use, for the system-setup screen and for tests. */
export async function secretStoreBackend(): Promise<SecretStoreBackend> {
  if (keystoreAvailable()) {
    try {
      const status = await SecureStore.isAvailable();
      if (status.available) {
        return { kind: 'keystore', hardwareBacked: status.hardwareBacked };
      }
    } catch {
      /* fall through to the browser path rather than losing the user's keys */
    }
  }
  const hasWebCrypto = typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
  return { kind: hasWebCrypto ? 'web-crypto' : 'session-only', hardwareBacked: false };
}

// --- public API -------------------------------------------------------------

export async function loadSecrets(): Promise<StoredSecrets> {
  const backend = await secretStoreBackend();

  if (backend.kind === 'keystore') {
    const secrets: StoredSecrets = {};
    for (const name of SECRET_NAMES) {
      try {
        const { value } = await SecureStore.get({ key: name });
        if (value) secrets[name] = value;
      } catch {
        /* unreadable secret: treat as absent, which sends the user to re-entry */
      }
    }
    return secrets;
  }

  try {
    const blob = localStorage.getItem(ENC_BLOB_KEY);
    if (!blob) return {};
    return (await decryptJson<StoredSecrets>(blob)) ?? {};
  } catch {
    return {};
  }
}

/**
 * Persist secrets. Returns false when nothing could be stored safely, in which
 * case the caller must keep them in memory only — never write plaintext.
 */
export async function saveSecrets(secrets: StoredSecrets): Promise<boolean> {
  const backend = await secretStoreBackend();

  if (backend.kind === 'keystore') {
    try {
      for (const name of SECRET_NAMES) {
        const value = secrets[name];
        if (value) await SecureStore.set({ key: name, value });
        else await SecureStore.remove({ key: name });
      }
      return true;
    } catch {
      return false;
    }
  }

  if (backend.kind === 'session-only') return Object.keys(secrets).length === 0;

  const stored = Object.keys(secrets).length > 0 ? secrets : {};
  const enc = await encryptJson(stored);
  if (enc) {
    localStorage.setItem(ENC_BLOB_KEY, enc);
    return true;
  }
  return Object.keys(secrets).length === 0;
}

/** Remove every stored secret, on either backend. */
export async function deleteAllSecrets(): Promise<void> {
  try {
    if (keystoreAvailable()) await SecureStore.clear();
  } catch {
    /* nothing stored natively */
  }
  localStorage.removeItem(ENC_BLOB_KEY);
  localStorage.removeItem(DEVICE_KEY);
}

/**
 * True when this install is native *and* an old browser-stored blob is present —
 * i.e. the upgrade-from-web case, or a reinstall that left web storage behind.
 */
export function legacyWebSecretsPresent(): boolean {
  if (!keystoreAvailable()) return false;
  try {
    return localStorage.getItem(ENC_BLOB_KEY) !== null || localStorage.getItem(DEVICE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Drop weakly protected credentials instead of migrating them. Returns true when
 * something was actually removed, so the UI can ask the user to re-enter (§40).
 *
 * Native only: on the web build the browser store is not "legacy", it is the
 * store. Removing it there would delete every web user's saved keys on load —
 * which is exactly what an earlier version of this function did.
 */
export function purgeLegacyWebSecrets(): boolean {
  if (!keystoreAvailable()) return false;
  const present = legacyWebSecretsPresent();
  try {
    localStorage.removeItem(ENC_BLOB_KEY);
    localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* nothing to remove */
  }
  return present;
}

// Settings persistence with secret-safe storage.
// BYOK secrets are session-only by default. If persistSecrets is true, they
// are stored encrypted via the Web Crypto API (AES-GCM, key derived from a
// random device key kept separately, not in the same record as the ciphertext).

import { KITTSettings, DEFAULT_SETTINGS } from './settings';

const SETTINGS_KEY = 'kitt.settings.v1';
const ENC_BLOB_KEY = 'kitt.secrets.v1';
const DEVICE_KEY = 'kitt.devicekey.v1';

export type StoredSettings = Omit<KITTSettings, 'llm' | 'tts' | 'stt'> & {
    llm: Omit<KITTSettings['llm'], 'apiKey'>;
    tts: Omit<KITTSettings['tts'], 'apiKey'>;
    stt: Omit<KITTSettings['stt'], 'apiKey'>;
  };

function stripSecrets(s: KITTSettings): StoredSettings {
  const { llm, tts, stt, ...rest } = s;
  return {
    ...rest,
    llm: { ...llm, apiKey: '' },
    tts: { ...tts, apiKey: '' },
    stt: { ...stt, apiKey: '' },
  } as unknown as StoredSettings;
}

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
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, data as unknown as BufferSource);
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
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, ct as unknown as BufferSource);
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    return null;
  }
}

interface SecretBlob {
  llm?: string;
  tts?: string;
  stt?: string;
}

export async function saveSettings(s: KITTSettings): Promise<void> {
  const clean = stripSecrets(s);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
  const blob: SecretBlob = {};
  if (s.persistSecrets) {
    if (s.llm.apiKey) blob.llm = s.llm.apiKey;
    if (s.tts.apiKey) blob.tts = s.tts.apiKey;
    if (s.stt.apiKey) blob.stt = s.stt.apiKey;
  }
  const enc = await encryptJson(blob);
  if (enc) {
    localStorage.setItem(ENC_BLOB_KEY, enc);
  } else if (s.persistSecrets && Object.keys(blob).length) {
    // crypto unavailable: refuse to persist plaintext
    console.warn('[kitt] crypto unavailable; secrets kept session-only');
  }
}

export async function loadSettings(): Promise<KITTSettings> {
  let s: KITTSettings = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as StoredSettings;
      s = {
        ...DEFAULT_SETTINGS,
        ...stored,
        llm: { ...DEFAULT_SETTINGS.llm, ...stored.llm },
        tts: { ...DEFAULT_SETTINGS.tts, ...stored.tts },
        stt: { ...DEFAULT_SETTINGS.stt, ...stored.stt },
        mic: { ...DEFAULT_SETTINGS.mic, ...(stored as Partial<KITTSettings>).mic },
        display: { ...DEFAULT_SETTINGS.display, ...(stored as Partial<KITTSettings>).display },
        setup: { ...DEFAULT_SETTINGS.setup, ...(stored as Partial<KITTSettings>).setup },
      };
    }
  } catch {
    s = { ...DEFAULT_SETTINGS };
  }
  // merge secrets
  try {
    const enc = localStorage.getItem(ENC_BLOB_KEY);
    if (enc) {
      const blob = await decryptJson<SecretBlob>(enc);
      if (blob) {
        if (blob.llm) s.llm = { ...s.llm, apiKey: blob.llm };
        if (blob.tts) s.tts = { ...s.tts, apiKey: blob.tts };
        if (blob.stt) s.stt = { ...s.stt, apiKey: blob.stt };
      }
    }
  } catch {
    /* secrets unavailable — session-only */
  }
  return s;
}

export function maskKey(k: string): string {
  if (!k) return '';
  if (k.length <= 8) return '••••••••';
  return k.slice(0, 3) + '••••••••' + k.slice(-4);
}

export async function deleteSecrets(): Promise<void> {
  localStorage.removeItem(ENC_BLOB_KEY);
  localStorage.removeItem(DEVICE_KEY);
}
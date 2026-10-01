// Settings persistence.
//
// Non-secret settings live in localStorage. Secrets never do — they go through
// lib/config/secureStore.ts, which uses the Android Keystore on the native build
// and the browser's Web Crypto on the web build. This module no longer knows how
// secrets are protected, only that it must hand them over and keep them out of
// the settings record.

import { KITTSettings, DEFAULT_SETTINGS } from './settings';
import { loadSecrets, saveSecrets, deleteAllSecrets, purgeLegacyWebSecrets, StoredSecrets } from './secureStore';

const SETTINGS_KEY = 'kitt.settings.v1';

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

/** The keys that should be persisted, or an empty set when the user opted out. */
function collectSecrets(s: KITTSettings): StoredSecrets {
  const secrets: StoredSecrets = {};
  if (s.persistSecrets) {
    if (s.llm.apiKey) secrets.llm = s.llm.apiKey;
    if (s.tts.apiKey) secrets.tts = s.tts.apiKey;
    if (s.stt.apiKey) secrets.stt = s.stt.apiKey;
  }
  return secrets;
}

function writeSettings(s: KITTSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(stripSecrets(s)));
  } catch {
    /* storage full or unavailable: settings simply are not persisted */
  }
}

export async function saveSettings(s: KITTSettings): Promise<void> {
  const secrets = collectSecrets(s);
  const stored = await saveSecrets(secrets);

  if (!stored && Object.keys(secrets).length > 0) {
    // Never fall back to plaintext: the keys stay in memory for this session, and
    // the user must not be told their key was saved when it was not.
    console.warn('[voxbox] secrets could not be stored securely; they are kept for this session only');
  }

  // Once a key has actually been stored, the "please re-enter" notice is spent.
  const next = stored && Object.keys(secrets).length > 0 ? { ...s, secretsNeedReentry: false } : s;
  writeSettings(next);
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

  // On the native build, weakly protected credentials left behind by a previous
  // web install are removed rather than copied up into the Keystore (brief §40).
  // The user is asked to re-enter, once.
  if (purgeLegacyWebSecrets()) {
    s = { ...s, secretsNeedReentry: true };
  }

  try {
    const secrets = await loadSecrets();
    if (secrets.llm) s.llm = { ...s.llm, apiKey: secrets.llm };
    if (secrets.tts) s.tts = { ...s.tts, apiKey: secrets.tts };
    if (secrets.stt) s.stt = { ...s.stt, apiKey: secrets.stt };
    // A key came back, so any previously stored notice is stale.
    if (secrets.llm || secrets.tts || secrets.stt) s = { ...s, secretsNeedReentry: false };
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
  await deleteAllSecrets();
}

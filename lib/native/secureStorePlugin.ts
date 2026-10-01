// Capacitor bridge to the native Keystore-backed secret store.
//
// The plugin itself lives in the Android project
// (android/app/src/main/java/com/grimspyder/voxbox/SecureStorePlugin.java) and
// holds an AES key in the Android Keystore — non-exportable, and hardware-backed
// where the device provides it — with ciphertext in app-private storage.
//
// The web build has no such thing, so every call site must go through
// lib/config/secureStore.ts, which falls back to the browser implementation and
// is honest about which one is in use.
import { registerPlugin } from '@capacitor/core';

export interface SecureStoreAvailability {
  available: boolean;
  /** True when the key lives in secure hardware rather than software. */
  hardwareBacked: boolean;
}

export interface SecureStorePlugin {
  /** Whether the native store is usable, and how well protected the key is. */
  isAvailable(): Promise<SecureStoreAvailability>;
  set(options: { key: string; value: string }): Promise<void>;
  /** A null value means "no such secret" *or* "unreadable, please re-enter". */
  get(options: { key: string }): Promise<{ value: string | null }>;
  remove(options: { key: string }): Promise<void>;
  clear(): Promise<void>;
}

export const SecureStore = registerPlugin<SecureStorePlugin>('SecureStore');

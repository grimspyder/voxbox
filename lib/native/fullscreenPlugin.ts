// Capacitor bridge to the native fullscreen plugin.
//
// The plugin lives in the Android project
// (android/app/src/main/java/com/grimspyder/voxbox/FullscreenPlugin.java) and
// hides the system bars itself, because the Android WebView refuses an element
// fullscreen request (Capacitor's WebChromeClient hides the custom view as soon
// as it is shown).
//
// The browser has its own Fullscreen API and no such plugin, so every call site
// must go through lib/native/fullscreen.ts, which chooses a backend and reports
// honestly when there is none.
import { registerPlugin } from '@capacitor/core';

export interface FullscreenState {
  active: boolean;
}

export interface FullscreenPlugin {
  /** Whether this platform can do fullscreen through the shell. */
  isSupported(): Promise<{ supported: boolean }>;
  enter(): Promise<FullscreenState>;
  exit(): Promise<FullscreenState>;
  /** Current state, for a button that has to label itself correctly. */
  isActive(): Promise<FullscreenState>;
}

export const Fullscreen = registerPlugin<FullscreenPlugin>('Fullscreen');

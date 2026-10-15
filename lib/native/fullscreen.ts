// Fullscreen, on whichever platform is actually running.
//
// Two backends exist and neither works everywhere:
//
//  - **native** — the shell plugin (FullscreenPlugin.java) hides the Android
//    system bars. This is the only one that works in the app: the Android
//    WebView rejects an element fullscreen request because Capacitor's
//    WebChromeClient hides the custom view as soon as it is shown.
//  - **web** — `requestFullscreen()` on the document element, which is a real
//    browser feature and does nothing inside the app's WebView.
//
// So the backend is chosen by asking, not by assuming, and a device that offers
// neither gets `ok: false` instead of a button that silently does nothing —
// which is precisely the defect this module replaces. The old handler called
// `requestFullscreen()` and swallowed the rejection, so on Android the button
// looked broken rather than reporting that fullscreen was unavailable.
//
// Pure decision-making is kept here (no React), so it is unit-testable without
// a device; the button lives in components/KittDashboard.tsx.

import { isNativeShell } from '../setup/capabilities';
import { Fullscreen } from './fullscreenPlugin';

export type FullscreenBackend = 'native' | 'web' | 'unsupported';

export interface FullscreenResult {
  /** False when this platform cannot do fullscreen at all. */
  ok: boolean;
  /** State after the attempt, so the control can label itself honestly. */
  active: boolean;
  backend: FullscreenBackend;
}

/** Which mechanism this device actually offers. */
export async function fullscreenBackend(): Promise<FullscreenBackend> {
  if (isNativeShell()) {
    try {
      const status = await Fullscreen.isSupported();
      if (status.supported) return 'native';
    } catch {
      /* fall through: a missing plugin is not a crash */
    }
  }
  if (typeof document !== 'undefined' && document.fullscreenEnabled) return 'web';
  return 'unsupported';
}

/** Whether the screen is in fullscreen right now. */
export async function isFullscreenActive(): Promise<boolean> {
  const backend = await fullscreenBackend();
  if (backend === 'native') {
    try {
      return (await Fullscreen.isActive()).active;
    } catch {
      return false;
    }
  }
  if (backend === 'web') return Boolean(document.fullscreenElement);
  return false;
}

export async function enterFullscreen(): Promise<FullscreenResult> {
  const backend = await fullscreenBackend();
  if (backend === 'native') {
    try {
      return { ok: true, active: (await Fullscreen.enter()).active, backend };
    } catch {
      return { ok: false, active: false, backend };
    }
  }
  if (backend === 'web') {
    try {
      await document.documentElement.requestFullscreen();
      return { ok: true, active: true, backend };
    } catch {
      // Browsers refuse this outside a user gesture, and some refuse it for
      // reasons they do not explain. Report it instead of pretending.
      return { ok: false, active: false, backend };
    }
  }
  return { ok: false, active: false, backend };
}

export async function exitFullscreen(): Promise<FullscreenResult> {
  const backend = await fullscreenBackend();
  if (backend === 'native') {
    try {
      return { ok: true, active: (await Fullscreen.exit()).active, backend };
    } catch {
      return { ok: false, active: false, backend };
    }
  }
  if (backend === 'web') {
    try {
      await document.exitFullscreen();
      return { ok: true, active: false, backend };
    } catch {
      return { ok: false, active: false, backend };
    }
  }
  return { ok: false, active: false, backend };
}

/**
 * The one call the FULLSCREEN button makes. It reads the current state first so
 * the same control both enters and leaves fullscreen, and it returns the state
 * afterwards so the caller never has to guess which way it went.
 */
export async function toggleFullscreen(): Promise<FullscreenResult> {
  return (await isFullscreenActive()) ? exitFullscreen() : enterFullscreen();
}

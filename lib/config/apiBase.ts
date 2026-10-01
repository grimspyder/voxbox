// Where the Vox API lives, and the app's own installation identifier.
//
// Web build: the client is served by the same Next.js app as the API, so
// relative URLs are correct and nothing needs configuring.
//
// Native (Capacitor) build: the web assets ship inside the app and are served
// from a local origin, so relative /api URLs cannot work. Set
// NEXT_PUBLIC_VOXBOX_API_BASE at build time to the hosted API origin, e.g.
//   NEXT_PUBLIC_VOXBOX_API_BASE=https://voxbox.example.com
// This is the single place the production API origin is declared (§37) —
// never scatter absolute URLs through the app.

export const API_BASE = (process.env.NEXT_PUBLIC_VOXBOX_API_BASE ?? '').trim().replace(/\/+$/, '');

/** Resolve an API path against the configured base (or keep it same-origin). */
export function apiUrl(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${clean}` : clean;
}

/** True when the app is talking to a remote API rather than its own origin. */
export const USING_REMOTE_API = API_BASE.length > 0;

const INSTALL_KEY = 'kitt.installid.v1';

/**
 * A random per-installation identifier, used only so the server can apply rate
 * limits per app install. It is not a device fingerprint and carries no user
 * or hardware information.
 */
export function installationId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = localStorage.getItem(INSTALL_KEY);
    if (!id || !/^[a-z0-9]{16,64}$/.test(id)) {
      const fresh =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID().replace(/-/g, '')
          : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
      id = fresh.replace(/[^a-z0-9]/gi, '').slice(0, 64);
      localStorage.setItem(INSTALL_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/** Headers to attach to every Vox API call. */
export function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const id = installationId();
  return { ...(id ? { 'x-voxbox-install-id': id } : {}), ...(extra ?? {}) };
}

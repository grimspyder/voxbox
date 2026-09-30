import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android shell configuration.
 *
 * This is a local-bundle shell, not a wrapper around the website: `webDir`
 * points at the static export produced by `npm run build:native`, so the UI
 * starts instantly and works offline in demo mode. Only the AI/voice proxy
 * calls need the network, and those go to the origin baked in at build time by
 * NEXT_PUBLIC_KITT_API_BASE.
 *
 * `androidScheme: 'https'` matters twice over:
 *   - the WebView origin becomes https://localhost, which is a secure context,
 *     and getUserMedia refuses to run outside one;
 *   - the hosted API must list that exact origin in KITT_ALLOWED_ORIGINS.
 */
const config: CapacitorConfig = {
  appId: 'com.grimspyder.kittassistant',
  appName: 'KITT',
  webDir: 'out',
  android: {
    // KITT is a black screen; a white WebView background would flash on launch.
    backgroundColor: '#000000',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: 'https',
    // No `url` here on purpose: that would make the app a remote website
    // wrapper instead of shipping its own bundle.
  },
};

export default config;

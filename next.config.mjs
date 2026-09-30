/**
 * Two build targets from one codebase.
 *
 *   web    (default)                 the full Next.js app: pages *and* the
 *                                    provider proxy routes in app/api/*.
 *   native (KITT_NATIVE_BUILD=1)     a static client bundle for the Capacitor
 *                                    Android shell (webDir = out/).
 *
 * The native bundle deliberately contains no server code. Next only treats a
 * file as a route handler when its extension is one of `pageExtensions`, so
 * dropping `ts` from that list removes app/api/* from the native build and the
 * static export succeeds. Every page in this app is .tsx.
 *
 * The Android client therefore talks to the hosted API, whose origin must be
 * supplied at build time as NEXT_PUBLIC_KITT_API_BASE (see lib/config/apiBase).
 */
const native = process.env.VOXBOX_NATIVE_BUILD === '1';

const nextConfig = native
  ? {
      output: 'export',
      // The shell serves the bundle from its own local origin; Next's image
      // optimiser is a server feature and cannot run there.
      images: { unoptimized: true },
      pageExtensions: ['tsx', 'jsx'],
      trailingSlash: true,
      // Surfaces any accidental server dependency at build time rather than as
      // a blank screen on a phone.
      eslint: { ignoreDuringBuilds: false },
    }
  : {};

export default nextConfig;

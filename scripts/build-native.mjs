#!/usr/bin/env node
/**
 * Builds the static client bundle that ships inside the Capacitor shell.
 *
 * Sets KITT_NATIVE_BUILD, which switches next.config.mjs to `output: 'export'`
 * and drops the `.ts` route handlers so app/api/* is not part of the bundle.
 *
 * NEXT_PUBLIC_KITT_API_BASE is inlined at build time. Without it the shell
 * still runs — demo mode is entirely offline — but it cannot reach an AI or
 * voice service, so say so loudly rather than shipping a silent failure.
 */
import { spawnSync } from 'node:child_process';

const apiBase = (process.env.NEXT_PUBLIC_KITT_API_BASE ?? '').trim();

if (!apiBase) {
  console.warn(
    '\n[native] NEXT_PUBLIC_KITT_API_BASE is not set.\n' +
      '[native] The Android build will work in demo mode only: AI and voice calls\n' +
      '[native] have nowhere to go. Set it to the hosted API origin, e.g.\n' +
      '[native]   NEXT_PUBLIC_KITT_API_BASE=https://kitt.example.com npm run build:native\n',
  );
} else if (!/^https:\/\//.test(apiBase)) {
  console.error(`[native] NEXT_PUBLIC_KITT_API_BASE must be an https origin, got: ${apiBase}`);
  process.exit(1);
}

const isWindows = process.platform === 'win32';
const result = spawnSync(isWindows ? 'npx.cmd' : 'npx', ['next', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, KITT_NATIVE_BUILD: '1' },
  shell: isWindows,
});

process.exit(result.status ?? 1);

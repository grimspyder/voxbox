#!/usr/bin/env node
/**
 * Builds the static client bundle that ships inside the Capacitor shell.
 *
 * Sets VOXBOX_NATIVE_BUILD, which switches next.config.mjs to `output: 'export'`
 * and drops the `.ts` route handlers so app/api/* is not part of the bundle.
 *
 * NEXT_PUBLIC_VOXBOX_API_BASE is inlined at build time. Without it the shell
 * still runs — demo mode is entirely offline — but it cannot reach an AI or
 * voice service, so say so loudly rather than shipping a silent failure.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const apiBase = (process.env.NEXT_PUBLIC_VOXBOX_API_BASE ?? '').trim();

if (!apiBase) {
  console.warn(
    '\n[native] NEXT_PUBLIC_VOXBOX_API_BASE is not set.\n' +
      '[native] The Android build will work in demo mode only: AI and voice calls\n' +
      '[native] have nowhere to go. Set it to the hosted API origin, e.g.\n' +
      '[native]   NEXT_PUBLIC_VOXBOX_API_BASE=https://voxbox.example.com npm run build:native\n',
  );
} else if (!/^https:\/\//.test(apiBase)) {
  console.error(`[native] NEXT_PUBLIC_VOXBOX_API_BASE must be an https origin, got: ${apiBase}`);
  process.exit(1);
}

const isWindows = process.platform === 'win32';

// Remove the previous export before building. Without this, a build that fails
// to produce `out/` (for example because the native flag never took effect)
// leaves the PREVIOUS bundle in place and `cap sync` copies it into the APK —
// which ships an outdated app that looks like a rename that simply did not
// work. That happened once; this guard is why it cannot happen again.
const outDir = path.resolve(process.cwd(), 'out');
rmSync(outDir, { recursive: true, force: true });

const result = spawnSync(isWindows ? 'npx.cmd' : 'npx', ['next', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, VOXBOX_NATIVE_BUILD: '1' },
  shell: isWindows,
});

if ((result.status ?? 1) !== 0) {
  console.error('[native] Build failed; `out/` was cleared so no stale bundle can be shipped.');
  process.exit(result.status ?? 1);
}

if (!existsSync(path.join(outDir, 'index.html'))) {
  console.error(
    '[native] Build reported success but produced no out/index.html.\n' +
      '[native] That means the static export did not run — check that VOXBOX_NATIVE_BUILD\n' +
      '[native] is honoured in next.config.mjs.',
  );
  process.exit(1);
}

console.log('[native] Static client bundle written to out/.');

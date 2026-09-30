#!/usr/bin/env node
/**
 * Runs a Gradle task in android/, using the right wrapper for the platform
 * (gradlew.bat on Windows, ./gradlew elsewhere) so the same npm script works
 * on a developer machine and in CI.
 *
 * Usage: node scripts/android-build.mjs [assembleDebug|bundleRelease|lintRelease]
 *
 * JAVA_HOME handling: this repository is developed in a Git-Bash/MSYS shell on
 * Windows, where JAVA_HOME is often exported as `/c/Program Files/...`. Gradle's
 * batch wrapper cannot use that form and fails with "JAVA_HOME is set to an
 * invalid directory", so MSYS paths are converted here. If JAVA_HOME is unset or
 * unusable, the JDK bundled with Android Studio is used.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const task = process.argv[2] ?? 'assembleDebug';
const androidDir = path.resolve('android');
const isWindows = process.platform === 'win32';

if (!existsSync(androidDir)) {
  console.error('[android] No android/ project found. Run `npx cap add android` first.');
  process.exit(1);
}

/** `/c/Program Files/x` -> `C:\Program Files\x`; anything else passes through. */
function toNativePath(value) {
  if (!value) return value;
  const msys = /^\/([a-zA-Z])(\/.*)?$/.exec(value);
  if (msys) {
    const rest = (msys[2] ?? '').replace(/\//g, '\\');
    return `${msys[1].toUpperCase()}:${rest}`;
  }
  return value;
}

function resolveJavaHome() {
  const fromEnv = process.env.JAVA_HOME;
  if (fromEnv) {
    const native = toNativePath(fromEnv);
    if (existsSync(native)) return native;
    console.warn(`[android] JAVA_HOME points at "${fromEnv}" which does not exist; falling back.`);
  }
  if (isWindows) {
    const candidates = [
      'C:\\Program Files\\Android\\Android Studio\\jbr',
      'C:\\Program Files\\Java\\jdk-21',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-21',
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        console.warn(`[android] Using bundled JDK: ${candidate}`);
        return candidate;
      }
    }
  }
  return undefined;
}

const javaHome = resolveJavaHome();
if (!javaHome) {
  console.error('[android] No JDK found. Set JAVA_HOME to a JDK 21 and re-run.');
  process.exit(1);
}

const wrapper = isWindows ? 'gradlew.bat' : './gradlew';
const env = { ...process.env, JAVA_HOME: javaHome };
// Gradle reads sdk.dir from android/local.properties; ANDROID_HOME is a fallback.
if (process.env.ANDROID_HOME) env.ANDROID_HOME = toNativePath(process.env.ANDROID_HOME);

const result = spawnSync(wrapper, ['--no-daemon', task], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWindows,
  env,
});

if (result.error) {
  console.error(`[android] Could not run ${wrapper}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

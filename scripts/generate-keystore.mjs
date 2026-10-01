#!/usr/bin/env node
/**
 * Generates the Play upload keystore for Voxbox, if one does not already exist.
 *
 * Never run blindly: this refuses to overwrite an existing keystore, because a
 * regenerated key is a different identity and an app signed with it cannot update
 * the old install. One key, kept forever.
 *
 * The password comes from the caller's environment (VOXBOX_KEYSTORE_PASSWORD),
 * never as a command-line argument — args are visible in process listings and
 * end up in shell history. It must not be committed; keystore.properties is
 * gitignored.
 *
 * Usage:
 *   VOXBOX_KEYSTORE_PASSWORD=... node scripts/generate-keystore.mjs [--force]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const KEYSTORE_DIR = path.resolve('android/keystore');
const KEYSTORE_PATH = path.join(KEYSTORE_DIR, 'voxbox-upload.jks');
const PROPS_PATH = path.join(KEYSTORE_DIR, 'keystore.properties');
const ALIAS = 'voxbox-upload';
const VALIDITY_DAYS = 10000; // ~27 years, the usual Play convention

// Created up front. keytool does not make parent directories: without this it
// prints "[Storing ...]" and then fails with exit 1, leaving no file and no
// explanation — which is exactly what happened on the first run.
mkdirSync(KEYSTORE_DIR, { recursive: true });

const password = process.env.VOXBOX_KEYSTORE_PASSWORD ?? '';
if (password.length < 8) {
  console.error('[keystore] VOXBOX_KEYSTORE_PASSWORD must be set to a password of at least 8 characters.');
  console.error('[keystore] Supply it through the environment, not as a command argument.');
  process.exit(1);
}

if (existsSync(KEYSTORE_PATH) && !process.argv.includes('--force')) {
  console.error(`[keystore] ${KEYSTORE_PATH} already exists. Refusing to overwrite it:`);
  console.error('[keystore] a regenerated key is a DIFFERENT identity, and an app signed with it');
  console.error('[keystore] can never update an install signed with the old one.');
  console.error('[keystore] Pass --force only if you are certain the old key is disposable.');
  process.exit(1);
}

const keytool = [
  'C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\keytool.exe', // this project's usual toolchain
  '/usr/lib/jvm/temurin-21-jdk-amd64/bin/keytool', // CI fallback
  'keytool', // whatever is on PATH
].find((candidate) => {
  if (candidate.includes('keytool.exe') || candidate.includes('jvm')) return existsSync(candidate);
  return true;
});

if (!keytool) {
  console.error('[keystore] No keytool found. Install a JDK (Android Studio ships one).');
  process.exit(1);
}

const DISTINGUISHED = process.env.VOXBOX_KEYSTORE_DN ?? 'CN=Voxbox, OU=Voxbox, O=grimspyder, L=Unknown, ST=Unknown, C=US';

const args = [
  '-genkeypair',
  '-v',
  '-keystore', KEYSTORE_PATH,
  '-alias', ALIAS,
  '-keyalg', 'RSA',
  '-keysize', '4096',
  '-validity', String(VALIDITY_DAYS),
  '-storepass', password,
  '-keypass', password,
  '-dname', DISTINGUISHED,
];

const result = spawnSync(keytool, args, { stdio: ['ignore', 'pipe', 'inherit'] });

// Distinguish "the tool failed" from "the tool never ran": both look the same from
// the outside, and they call for completely different fixes.
if (result.error) {
  console.error(`[keystore] could not run ${keytool}: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  // keytool has already reported its own error on stderr; add what it will not
  // say — whether it left a file behind, which is the difference between a
  // half-created keystore that must be cleaned up and a clean failure.
  if (existsSync(KEYSTORE_PATH)) {
    console.error(`[keystore] keytool exited ${result.status} but left ${KEYSTORE_PATH} behind.`);
    console.error('[keystore] Deleting it: a half-created keystore is not a usable identity.');
    const del = spawnSync('rm', ['-f', KEYSTORE_PATH], { stdio: 'ignore' });
    if (del.status !== 0) console.error('[keystore] could not delete it — remove it by hand before re-running.');
  }
  console.error(`[keystore] keytool exited ${result.status}.`);
  process.exit(result.status ?? 1);
}

// Signing configuration for Gradle, gitignored.
writeFileSync(
  PROPS_PATH,
  [
    `storeFile=${path.relative(path.dirname(PROPS_PATH), KEYSTORE_PATH).replace(/\\/g, '/')}`,
    `storePassword=${password}`,
    `keyAlias=${ALIAS}`,
    `keyPassword=${password}`,
    '',
  ].join('\n'),
);

console.log(`[keystore] created ${KEYSTORE_PATH}`);
console.log(`[keystore] wrote ${PROPS_PATH} (gitignored — never commit it)`);
console.log('[keystore] BACK THIS UP. If it is lost, the app cannot be updated.');
console.log('[keystore] Recommended: keep it in a password manager or an encrypted drive, not in the repo.');

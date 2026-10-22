// Sideload delivery for the debug APK.
//
// This hands the download to the GitHub release asset rather than streaming the
// package out of a serverless function. A 4.8 MB buffered function response sits
// right at Vercel's response-body ceiling and cannot serve `Range`, so a phone
// whose connection drops restarts the whole transfer — the download manager then
// sits at "in progress" forever. The release asset is CDN-served, advertises
// `Accept-Ranges: bytes`, and is unaffected by function limits; this route only
// keeps one stable, short link on the app's own origin.
//
// The APK itself stays out of git (artifacts/*.apk) and out of public/ — a native
// export copies public/ into the shell bundle, which would fold the previous build
// into the next APK.
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Bump both values together when a new debug build is published. */
const RELEASE_TAG = 'v1.3-debug-5';
const REPO = 'grimspyder/voxbox';
const ASSET = 'Voxbox-debug.apk';

export function GET() {
  return NextResponse.redirect(`https://github.com/${REPO}/releases/download/${RELEASE_TAG}/${ASSET}`, 307);
}

// Sideload delivery for the debug APK.
//
// The APK is a build artifact, not web content: keeping it in `artifacts/` and
// serving it from a route means a native export (`output: 'export'`, which copies
// public/ into the shell bundle) cannot fold the previous 5 MB build into the new
// APK. The headers are explicit because Android's downloader and Chrome both
// refuse a package-relevant file served as octet-stream, and because a phone
// hitting a cached old build is how a tester ends up reinstalling the bug.
import { NextResponse } from 'next/server';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

const FILE = path.join(process.cwd(), 'artifacts', 'Voxbox-debug.apk');

export async function GET() {
  try {
    const [info, data] = await Promise.all([stat(FILE), readFile(FILE)]);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'content-type': 'application/vnd.android.package-archive',
        'content-disposition': 'attachment; filename="Voxbox-debug.apk"',
        'content-length': String(info.size),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'No debug build is published right now. Build one with npm run android:debug.' },
      { status: 404 },
    );
  }
}

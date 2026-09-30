#!/usr/bin/env node
/**
 * Generates Voxbox's launcher icons, adaptive-icon foreground and splash from
 * original vector art.
 *
 * Why a script rather than committed binaries: the release gate requires
 * original artwork (production requirements IP-01 / §61), and art that cannot be
 * reviewed is art nobody can clear. The SVG geometry below is the source of
 * truth, it is committed under assets/branding/, and every PNG is reproducible
 * from it.
 *
 * The mark is the app's own visual language — the three-bar voice modulator —
 * drawn from scratch. It is deliberately not the television prop's badge, not a
 * car, and not a studio or framework logo.
 *
 * Run: npm run icons
 */
import { mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const BLACK = '#000000';
const LIT = '#ff1a1a';
const DIM = '#5c0808';

/** Launcher icon densities Android expects for a 48dp icon. */
const DENSITIES = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];

/** Three columns of stacked segments, centre column tallest. */
const COLUMNS = [
  { x: 24, rows: 5 },
  { x: 46, rows: 7 },
  { x: 68, rows: 5 },
];
const BAR_WIDTH = 14;
const GAP = 1.5;

/** Segment rectangles in a 108x108 space (the adaptive-icon canvas). */
function modulatorSegments(indent = '    ') {
  const out = [];
  for (const column of COLUMNS) {
    const step = BAR_WIDTH * 0.62 + GAP;
    const totalHeight = column.rows * step - GAP;
    const top = 54 - totalHeight / 2;
    for (let row = 0; row < column.rows; row++) {
      const y = top + row * step;
      // Centre column lit throughout; outer columns fade at the extremes,
      // exactly as the display behaves during speech.
      const spread = column.rows > 1 ? (column.rows - 1) / 2 : 1;
      const distanceFromMiddle = Math.abs(row - (column.rows - 1) / 2) / spread;
      const fill = distanceFromMiddle > 0.75 ? DIM : LIT;
      out.push(
        `${indent}<rect x="${column.x}" y="${y.toFixed(2)}" width="${BAR_WIDTH}" height="${(BAR_WIDTH * 0.62).toFixed(2)}" rx="1.2" fill="${fill}" />`,
      );
    }
  }
  return out.join('\n');
}

function svg({ size, background }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108">
  <rect width="108" height="108" fill="${background}" />
${modulatorSegments()}
</svg>
`;
}

function roundSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108">
  <defs><clipPath id="circle"><circle cx="54" cy="54" r="54" /></clipPath></defs>
  <g clip-path="url(#circle)">
    <rect width="108" height="108" fill="${BLACK}" />
${modulatorSegments('    ')}
  </g>
</svg>
`;
}

/** Recursively remove the framework's placeholder splash bitmaps. */
function removeSplashBitmaps(dir) {
  let removed = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      removed += removeSplashBitmaps(full);
    } else if (entry === 'splash.png' || entry === 'splash.9.png') {
      rmSync(full);
      removed += 1;
    }
  }
  return removed;
}

const root = process.cwd();
const resDir = path.join(root, 'android/app/src/main/res');
const brandingDir = path.join(root, 'assets/branding');
const storeDir = path.join(root, 'docs/store');
mkdirSync(brandingDir, { recursive: true });
mkdirSync(storeDir, { recursive: true });

writeFileSync(path.join(brandingDir, 'voxbox-icon.svg'), svg({ size: 512, background: BLACK }));
writeFileSync(path.join(brandingDir, 'voxbox-icon-round.svg'), roundSvg(512));

let written = 0;
for (const [density, px] of DENSITIES) {
  const dir = path.join(resDir, `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });

  await sharp(Buffer.from(svg({ size: px, background: BLACK }))).png().toFile(path.join(dir, 'ic_launcher.png'));
  await sharp(Buffer.from(roundSvg(px))).png().toFile(path.join(dir, 'ic_launcher_round.png'));

  // The adaptive icon XML points at @mipmap/ic_launcher_foreground, so the
  // foreground is a transparent bitmap for the 108dp canvas; the mark sits
  // inside the central 66dp safe zone.
  const adaptivePx = Math.round(px * (108 / 48));
  await sharp(Buffer.from(svg({ size: adaptivePx, background: 'none' })))
    .png()
    .toFile(path.join(dir, 'ic_launcher_foreground.png'));

  written += 3;
}

// Google Play listing icon: 512x512 PNG, as Play requires.
await sharp(Buffer.from(svg({ size: 512, background: BLACK })))
  .png()
  .toFile(path.join(storeDir, 'play-icon-512.png'));
written += 1;

// The splash must be Vox black, not the framework's white default, and must
// not carry a third-party logo.
const splashRemoved = removeSplashBitmaps(resDir);
writeFileSync(
  path.join(resDir, 'drawable/splash.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Vox opens straight into a black screen; a white splash (the framework
     default) flashed on launch and carried a third-party logo. -->
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="${BLACK}" />
</shape>
`,
);

console.log(`[icons] wrote ${written} PNGs from original vector art.`);
console.log(`[icons] replaced ${splashRemoved} placeholder splash bitmaps with a black drawable.`);
console.log('[icons] source: assets/branding/voxbox-icon.svg');

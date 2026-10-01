#!/usr/bin/env node
/**
 * Generates the Play feature graphic (1024x500) from original vector art.
 *
 * Same source geometry as the launcher icon (scripts/generate-icons.mjs): the
 * three-bar voice modulator, drawn from scratch. Play's feature graphic rules
 * call for 1024x500 PNG or JPEG, and it must not carry text that would be
 * cropped on different screens — so this is pure artwork with no lettering.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const BLACK = '#000000';
const LIT = '#ff1a1a';
const DIM = '#5c0808';

const W = 1024;
const H = 500;

/**
 * Three columns of segments, drawn for a landscape canvas and centred. The
 * proportions follow the app's real display: centre bar tallest, side bars
 * shorter, lit from the middle outwards.
 */
function segments() {
  const cols = [
    { x: W / 2 - 130, rows: 9 },
    { x: W / 2 - 30, rows: 14 },
    { x: W / 2 + 70, rows: 9 },
  ];
  const barWidth = 60;
  const segHeight = 22;
  const gap = 6;
  const out = [];
  for (const col of cols) {
    const total = col.rows * (segHeight + gap) - gap;
    const top = (H - total) / 2;
    for (let i = 0; i < col.rows; i++) {
      const y = top + i * (segHeight + gap);
      const spread = (col.rows - 1) / 2;
      const distance = Math.abs(i - (col.rows - 1) / 2) / spread;
      const fill = distance > 0.75 ? DIM : LIT;
      out.push(
        `<rect x="${col.x}" y="${y.toFixed(1)}" width="${barWidth}" height="${segHeight}" rx="3" fill="${fill}" />`,
      );
    }
  }
  return out.join('\n  ');
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BLACK}" />
  ${segments()}
</svg>
`;

const outDir = path.resolve('docs/store');
mkdirSync(outDir, { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, 'feature-graphic-1024x500.png'));
writeFileSync(path.join(outDir, 'feature-graphic.svg'), svg);
console.log(`[feature] wrote docs/store/feature-graphic-1024x500.png (${W}x${H})`);

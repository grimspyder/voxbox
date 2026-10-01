#!/usr/bin/env node
/**
 * Renders the app's own HTML in Chromium and captures the Play screenshots from
 * real pixels.
 *
 * Play requires 2-8 phone screenshots of 16:9 or 9:16, min 320 px, max 3840 px.
 * This produces two 1080x2400 PNGs (portrait 9:20 — well inside Play's range)
 * from the actual app: the wizard, which is what a first-time user sees, and the
 * dashboard with the modulator lit, which is the app's identity.
 *
 * Run: node scripts/generate-screenshots.mjs
 * Needs: an app build serving on localhost, and Playwright's Chromium.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.APP_URL ?? 'http://localhost:3221';
const OUT = path.resolve('docs/store/screenshots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 540, height: 1200 }, deviceScaleFactor: 2 });

// Screenshot 1: the welcome screen, exactly as a new user sees it.
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  localStorage.clear();
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(OUT, '01-welcome.png') });
console.log('[screenshots] 01-welcome.png');

// Screenshot 2: the dashboard with the modulator running (TEST LEDS drives the
// identical render path real audio does, deterministically — no mic needed).
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('kitt.settings.v1') || '{}');
  s.setup = { complete: true, mode: 'demo' };
  localStorage.setItem('kitt.settings.v1', JSON.stringify(s));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.click('text=TEST LEDS');
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, '02-dashboard.png') });
console.log('[screenshots] 02-dashboard.png');

await browser.close();
console.log(`[screenshots] written to ${OUT}`);

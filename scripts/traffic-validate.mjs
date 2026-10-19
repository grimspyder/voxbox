#!/usr/bin/env node
/**
 * P0 gate — validate TomTom speed-limit data before building the feature.
 *
 * What it does:
 *   1. Confirms the key works (auth, quota, endpoint).
 *   2. Resolves the posted limit for a list of GPS points.
 *   3. Prints road name, limit, unit and type per point, plus request count
 *      and the real cost of the call.
 *
 * Usage:
 *   node scripts/traffic-validate.mjs
 *   node scripts/traffic-validate.mjs --points "-77.4360,37.5407;-77.4300,37.5450"
 *   node scripts/traffic-validate.mjs --route route.json   # [[lon,lat], ...]
 *
 * Points are longitude,latitude (TomTom's order — not latitude,longitude).
 * The key is read from .env.local and never printed.
 */
import fs from 'node:fs';
import path from 'node:path';

const COST_PER_1000_EUR = 2.5;

function loadKey() {
  if (process.env.TOMTOM_API_KEY) return process.env.TOMTOM_API_KEY.trim();
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return null;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*TOMTOM_API_KEY\s*=\s*(.*)\s*$/);
    if (m) {
      const v = m[1].trim().replace(/^["']|["']$/g, '');
      if (v) return v;
    }
  }
  return null;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

// Default: a short stretch of I-95 through Petersburg, VA. This is a KEY AND
// RESPONSE-SHAPE test, not an accuracy test — accuracy must be measured on the
// user's own roads against the physical signs.
const DEFAULT_POINTS = [
  [-77.4019, 37.2279],
  [-77.3975, 37.2350],
  [-77.3922, 37.2431],
  [-77.3870, 37.2512],
];

function points() {
  const routeFile = arg('route');
  if (routeFile) {
    const parsed = JSON.parse(fs.readFileSync(routeFile, 'utf8'));
    return parsed.map((p) => (Array.isArray(p) ? p : [p.lon, p.lat]));
  }
  const raw = arg('points');
  if (raw) {
    return raw.split(';').map((pair) => pair.split(',').map(Number));
  }
  return DEFAULT_POINTS;
}

/** TomTom returns nested objects; find every speedLimits-ish value without
 *  assuming one exact schema version. */
function collectLimits(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const v of node) collectLimits(v, out);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (/speed.?limit/i.test(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(v);
    } else if (/speed.?limit/i.test(k) && typeof v === 'number') {
      out.push({ value: v });
    } else if (v && typeof v === 'object') {
      collectLimits(v, out);
    }
  }
  return out;
}

function collectRoadNames(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const v of node) collectRoadNames(v, out);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'roadName' && typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') collectRoadNames(v, out);
  }
  return out;
}

async function main() {
  const key = loadKey();
  if (!key) {
    console.error(
      'NO KEY. Put TOMTOM_API_KEY=... in ' +
        path.join(process.cwd(), '.env.local') +
        ' (no quotes), then re-run.',
    );
    process.exit(2);
  }

  const pts = points();
  const pointStr = pts.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const url =
    'https://api.tomtom.com/snapToRoads/1' +
    `?key=${encodeURIComponent(key)}` +
    `&points=${encodeURIComponent(pointStr)}` +
    '&fields=' + encodeURIComponent('{route{speedLimits{value,unit,type},address{roadName,roadNumbers}}}');

  const started = Date.now();
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error('NETWORK ERROR:', err.message);
    process.exit(1);
  }
  const elapsed = Date.now() - started;
  const text = await res.text();

  if (!res.ok) {
    let hint = '';
    if (res.status === 401 || res.status === 403) {
      hint = ' — the key was rejected. Check it is copied whole, and that the Snap to Roads API is enabled for it.';
    } else if (res.status === 400) {
      hint = ' — request rejected; usually malformed points order (must be lon,lat) or a bad fields expression.';
    } else if (res.status === 429) {
      hint = ' — quota/rate limit. The free tier is 2,500 requests/month.';
    }
    console.error(`HTTP ${res.status} in ${elapsed}ms${hint}`);
    console.error(text.slice(0, 500));
    process.exit(1);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('Response was not JSON:', text.slice(0, 300));
    process.exit(1);
  }

  const limits = collectLimits(json);
  const roads = [...new Set(collectRoadNames(json))];

  console.log(`HTTP ${res.status} in ${elapsed}ms`);
  console.log(`points: ${pts.length}  requests: 1  cost: €${(COST_PER_1000_EUR / 1000).toFixed(5)}`);
  console.log(`road names: ${roads.length ? roads.join(' | ') : '(none returned)'}`);

  if (!limits.length) {
    console.log('NO SPEED LIMIT IN RESPONSE.');
    console.log('Top-level keys:', Object.keys(json).join(', '));
    console.log('Raw (first 800 chars):', text.slice(0, 800));
    process.exit(1);
  }

  limits.slice(0, 20).forEach((l, i) => {
    const value = l.value;
    const unit = l.unit ?? '';
    const type = l.type ?? '';
    console.log(`  [${i}] ${value ?? '?'} ${unit} ${type}`.trim());
  });

  console.log('\nOK — key works and the response carries speed limits.');
  console.log('Next: run this against a real recorded drive and compare each point to the physical sign.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

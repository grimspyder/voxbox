#!/usr/bin/env node
/**
 * P0 gate — validate TomTom speed-limit + jurisdiction data before building the UI.
 *
 * For each sampled road segment it prints:
 *   OSM maxspeed | TomTom limit | subdivision (state) | road name | delta
 *
 * Why OSM is the comparison: it is independent of TomTom, free, and carries a
 * human-entered maxspeed on highway ways. It is NOT ground truth — a mismatch
 * means "a human must look at the sign", not "TomTom is wrong". Real accuracy
 * needs the user's own drive checked against physical signs.
 *
 * Usage:
 *   node scripts/traffic-validate.mjs                 # Raleigh NC highways
 *   node scripts/traffic-validate.mjs --bbox 35.7,-78.8,35.9,-78.5
 *   node scripts/traffic-validate.mjs --points "-78.6382,35.7796;-78.6300,35.7850"
 *   node scripts/traffic-validate.mjs --route route.json
 *
 * Points are longitude,latitude (TomTom's order). The key comes from .env.local
 * and is never printed.
 */
import fs from 'node:fs';
import path from 'node:path';

const COST_PER_1000_EUR = 2.5;
const FIELDS =
  '{route{properties{speedLimits{value,unit,type},address{roadName,countrySubdivision}}}}';

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

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pull real highway geometry from OSM, with its own maxspeed tag.
 *  Overpass is a shared free service and regularly answers 502/429 at capacity,
 *  so try mirrors with backoff before giving up. */
async function osmWays(bbox, limit = 6) {
  const q = `[out:json][timeout:60];way["highway"~"^(motorway|trunk|primary)$"]["maxspeed"](${bbox});out geom ${limit};`;
  const mirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];
  let last = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const url = mirrors[attempt % mirrors.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': 'voxbox-traffic-validation/1.0 (speed-limit data check)',
        },
        body: 'data=' + encodeURIComponent(q),
      });
      if (res.ok) {
        const json = await res.json();
        return (json.elements || []).filter((w) => (w.geometry || []).length >= 4);
      }
      last = `HTTP ${res.status} from ${new URL(url).host}`;
    } catch (err) {
      last = `${err.message} from ${new URL(url).host}`;
    }
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(`Overpass unavailable after retries (${last})`);
}

function samplePoints(way) {
  const geo = way.geometry.filter(Boolean);
  // TomTom requires at least 2 points. Use two adjacent nodes at the midpoint:
  // still a single short stretch, so the limit cannot span two different roads
  // (a ramp beside a motorway is the classic false mismatch).
  const mid = Math.max(1, Math.floor(geo.length / 2));
  return [geo[mid - 1], geo[mid]];
}

async function tomtom(key, pts) {
  const pointStr = pts.map((p) => `${p.lon},${p.lat}`).join(';');
  const url =
    'https://api.tomtom.com/snapToRoads/1' +
    `?key=${encodeURIComponent(key)}&points=${encodeURIComponent(pointStr)}` +
    `&fields=${encodeURIComponent(FIELDS)}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      detail = JSON.parse(text).detailedError?.message ?? detail;
    } catch {
      /* keep raw */
    }
    return { ok: false, status: res.status, detail };
  }
  const json = JSON.parse(text);
  const props = (json.route || []).map((r) => r.properties || {});
  const limits = props.map((p) => p.speedLimits).filter(Boolean);
  const roads = props.map((p) => p.address?.roadName).filter(Boolean);
  const states = props.map((p) => p.address?.countrySubdivision).filter(Boolean);
  return {
    ok: true,
    status: res.status,
    limit: limits[0] ?? null,
    road: roads[0] ?? '',
    state: states[0] ?? '',
    elements: props.length,
  };
}

function parseOsmSpeed(tag) {
  if (!tag) return null;
  const m = String(tag).match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return /km\/h|kmh/i.test(tag) ? Math.round(n / 1.609344) : Math.round(n);
}

async function main() {
  const key = loadKey();
  if (!key) {
    console.error('NO KEY. Put TOMTOM_API_KEY=... in ' + path.join(process.cwd(), '.env.local'));
    process.exit(2);
  }

  let rows = [];
  const rawPoints = arg('points');
  const rawRoute = arg('route');

  if (rawPoints) {
    const pts = rawPoints.split(';').map((pair) => {
      const [lon, lat] = pair.split(',').map(Number);
      return { lon, lat };
    });
    rows.push({ label: 'manual', osm: null, pts });
  } else if (rawRoute) {
    const pts = JSON.parse(fs.readFileSync(rawRoute, 'utf8')).map((p) =>
      Array.isArray(p) ? { lon: p[0], lat: p[1] } : p,
    );
    rows.push({ label: 'route', osm: null, pts });
  } else {
    const bbox = arg('bbox', '35.72,-78.82,35.86,-78.55'); // Raleigh, NC
    const ways = await osmWays(bbox);
    if (!ways.length) {
      console.error('No OSM ways with maxspeed in that bbox. Try a different bbox.');
      process.exit(1);
    }
    rows = ways.slice(0, 4).map((w) => ({
      label: `${w.tags?.name || `way ${w.id}`} (${w.tags?.highway})`,
      osm: parseOsmSpeed(w.tags?.maxspeed),
      pts: samplePoints(w),
    }));
  }

  console.log(
    `\nComparing ${rows.length} road segment(s) — 1 request each, €${(
      COST_PER_1000_EUR / 1000
    ).toFixed(5)}/request\n`,
  );

  let reqs = 0;
  let agree = 0;
  let compared = 0;

  for (const row of rows) {
    const r = await tomtom(key, row.pts);
    reqs += 1;
    if (!r.ok) {
      console.log(`${row.label}\n  FAILED HTTP ${r.status}: ${r.detail}\n`);
      await sleep(1500);
      continue;
    }
    const tt = r.limit ? `${r.limit.value} ${r.limit.unit}` : 'NO LIMIT';
    const delta = r.limit && row.osm != null ? r.limit.value - row.osm : null;
    if (r.limit && row.osm != null) {
      compared += 1;
      if (delta === 0) agree += 1;
    }
    console.log(row.label);
    console.log(
      `  OSM: ${row.osm ?? '?'} mph | TomTom: ${tt} | state: ${r.state || '?'} | road: ${
        r.road || '?'
      }`,
    );
    if (delta !== null) console.log(`  delta: ${delta > 0 ? '+' : ''}${delta} mph`);
    console.log(`  route elements: ${r.elements}\n`);
    await sleep(1500); // stay under the free tier's per-second limit
  }

  console.log(`requests: ${reqs}  cost: €${((reqs * COST_PER_1000_EUR) / 1000).toFixed(4)}`);
  if (compared) {
    console.log(`agreement with OSM tags: ${agree}/${compared}`);
    console.log('NOTE: OSM is an independent reference, not ground truth. A mismatch means "check the sign".');
  }
  console.log('\nNext: run against a recorded drive and check each point against the physical sign.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

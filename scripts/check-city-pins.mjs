/**
 * Check every city's coordinate lands on the landmass the map actually draws.
 *
 *   npm run check:pins        (needs `npx supabase start`)
 *
 * WHY THIS EXISTS. The bounds constraints in 0020 catch a NULL, an
 * out-of-region value, and a transposed lat/lng pair. They cannot catch a
 * coordinate that is inside the box but in the sea — and a pin in the sea is the
 * most visible way this data can be wrong. Postgres cannot do the containment
 * test without PostGIS, and the geometry lives in the app, so the check lives
 * here: it is the only place that has both the coordinates and the outline.
 *
 * TOLERANCE, and why it is not zero. The outline is Natural Earth 1:50m — the
 * same source the design uses — and at that scale a coastline runs inside the
 * coastal towns sitting on it. Ajman, Jebel Ali and Mirbat all measure a few km
 * outside the drawn polygon while being in exactly the right place. The right
 * response is to tolerate that, NOT to nudge real coordinates inland to match a
 * coarse outline: the outline is the approximation, not the city.
 *
 * A genuinely misplaced city — the wrong town, a swapped pair — is tens or
 * hundreds of km out and still fails.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { geoContains, geoDistance } from 'd3-geo';

/** Kilometres a city may sit outside its country's drawn outline. */
const TOLERANCE_KM = 12;
const EARTH_KM = 6371;

const COUNTRY_FEATURE = {
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
};

const geometry = JSON.parse(readFileSync(resolve('src/map/geometry.json'), 'utf8'));

function featureFor(country) {
  if (country === 'OM') return geometry.oman;
  const name = COUNTRY_FEATURE[country];
  return geometry.neighbours.features.find((f) => f.properties.name === name);
}

/**
 * Distance to the nearest outline *vertex*.
 *
 * An overestimate of the distance to the polygon edge — at 1:50m, vertices can
 * be tens of km apart, so a point 1 km off an edge can measure several km from
 * the closest vertex. That bias is fine: it only ever makes this check more
 * lenient, never less, and being lenient about a coarse coastline is the point.
 */
function kmToNearestVertex(feature, point) {
  let best = Infinity;
  const walk = (node) => {
    if (typeof node[0] === 'number') {
      best = Math.min(best, geoDistance(node, point) * EARTH_KM);
      return;
    }
    node.forEach(walk);
  };
  walk(feature.geometry.coordinates);
  return best;
}

const csv = execFileSync(
  'docker',
  [
    'exec', '-i', 'supabase_db_truckkoo-app',
    'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-F', '\t',
    '-c', 'select name_en, country, lng, lat from public.cities order by country, name_en;',
  ],
  { encoding: 'utf8' },
);

const rows = csv
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [name, country, lng, lat] = line.split('\t');
    return { name, country, lng: Number(lng), lat: Number(lat) };
  });

if (rows.length === 0) {
  console.error('No cities returned. Is `npx supabase start` running and 0020 applied?');
  process.exit(1);
}

const failures = [];
const offshore = [];

for (const { name, country, lng, lat } of rows) {
  const feature = featureFor(country);
  if (!feature) {
    failures.push(`${name}: no outline for country ${country}`);
    continue;
  }
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    failures.push(`${name}: missing coordinate`);
    continue;
  }
  if (geoContains(feature, [lng, lat])) continue;

  const km = kmToNearestVertex(feature, [lng, lat]);
  if (km > TOLERANCE_KM) {
    failures.push(`${name} (${country}) is ${km.toFixed(0)} km outside ${country} — ${lng},${lat}`);
  } else {
    offshore.push(`${name} ${km.toFixed(1)} km`);
  }
}

console.log(`checked ${rows.length} cities against the drawn outlines`);
if (offshore.length) {
  console.log(
    `  ${offshore.length} coastal, just outside the 1:50m coastline (tolerated): ${offshore.join(', ')}`,
  );
}

if (failures.length) {
  console.error(`\n${failures.length} city coordinate(s) are wrong:`);
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    '\nFix in a NEW migration — 0020 is applied and migrations are append-only.',
  );
  process.exit(1);
}

console.log('  no city is in the sea');

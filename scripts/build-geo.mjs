/**
 * Build the map's geometry fixture.
 *
 * Natural Earth 1:50m, the same source the design handoff used, so the outlines
 * match the mockups. Run at build time and committed, not fetched at runtime:
 * the audience is on mobile data in a truck cab, and a map that needs the network
 * to draw a coastline is a map that is blank exactly when it is needed.
 *
 *   npm run build:geo
 *
 * Oman is emitted separately from its neighbours so the two can be styled
 * independently. Neighbours carry a visible border stroke — without one they read
 * as sea.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { feature } from 'topojson-client';

const OUT = resolve('src/map/geometry.json');

/**
 * The neighbours that appear inside the regional framing. Saudi Arabia is
 * included whole even though only its east shows — clipping a polygon to a bbox
 * correctly is more code than shipping the extra coordinates costs after
 * rounding.
 */
const NEIGHBOURS = new Set([
  'United Arab Emirates',
  'Saudi Arabia',
  'Yemen',
  'Qatar',
  'Bahrain',
  'Kuwait',
  'Iran',
]);

/** ~100 m at this latitude. Far finer than a 390px-wide frame can show. */
const PRECISION = 3;

function roundRing(ring) {
  const out = [];
  for (const [lng, lat] of ring) {
    const p = [Number(lng.toFixed(PRECISION)), Number(lat.toFixed(PRECISION))];
    // Rounding collapses neighbouring points onto each other; dropping the
    // duplicates is most of the size win.
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  // A ring needs to close, and rounding can open it.
  if (out.length > 2) {
    const [f, l] = [out[0], out[out.length - 1]];
    if (f[0] !== l[0] || f[1] !== l[1]) out.push([f[0], f[1]]);
  }
  return out;
}

function simplifyGeometry(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const kept = [];
  for (const poly of polys) {
    const rings = poly.map(roundRing).filter((r) => r.length >= 4);
    // Drop islands too small to see. The first ring is the outer boundary.
    if (rings.length && rings[0].length >= 6) kept.push(rings);
  }
  return { type: 'MultiPolygon', coordinates: kept };
}

const topoPath = resolve('node_modules/world-atlas/countries-50m.json');
const topo = JSON.parse(readFileSync(topoPath, 'utf8'));
const all = feature(topo, topo.objects.countries);

const omanFeature = all.features.find((f) => f.properties.name === 'Oman');
if (!omanFeature) throw new Error('Oman not found in countries-50m — check world-atlas version');

const neighbourFeatures = all.features.filter((f) => NEIGHBOURS.has(f.properties.name));
const missing = [...NEIGHBOURS].filter(
  (n) => !neighbourFeatures.some((f) => f.properties.name === n),
);
if (missing.length) throw new Error(`neighbours not found: ${missing.join(', ')}`);

const out = {
  // Provenance in the artefact itself, so nobody has to guess where a blob
  // of coordinates came from.
  source: 'Natural Earth 1:50m via world-atlas@2 countries-50m.json',
  generatedBy: 'scripts/build-geo.mjs',
  precision: PRECISION,
  oman: {
    type: 'Feature',
    properties: { name: 'Oman' },
    geometry: simplifyGeometry(omanFeature.geometry),
  },
  neighbours: {
    type: 'FeatureCollection',
    features: neighbourFeatures.map((f) => ({
      type: 'Feature',
      properties: { name: f.properties.name },
      geometry: simplifyGeometry(f.geometry),
    })),
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));

const kb = Number((JSON.stringify(out).length / 1024).toFixed(0));
console.log(`wrote ${OUT} — ${kb} KB`);
if (kb > 250) {
  console.warn(
    `WARNING: ${kb} KB is larger than intended. Drop Iran and Kuwait before touching PRECISION.`,
  );
}

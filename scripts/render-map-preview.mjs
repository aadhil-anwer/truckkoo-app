/**
 * Render the map to a standalone SVG you can open and look at.
 *
 *   npm run preview:map      (needs `npx supabase start`)
 *
 * WHY THIS EXISTS. `0020`'s constraints catch a NULL, an out-of-region value and
 * a transposed pair. `npm run check:pins` catches a coordinate in the sea. None
 * of them can catch a coordinate that sits inside Oman and is simply the WRONG
 * TOWN — only an eye that knows the country can. This produces the picture that
 * eye needs, without adding a route to the app.
 *
 * It deliberately uses the same `framing.ts` and `geometry.json` the app uses, so
 * what you see here is what the app draws. If this looks right and the app does
 * not, the bug is in the React layer, not the data.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { geoMercator, geoPath } from 'd3-geo';

import geometry from '../src/map/geometry.json' with { type: 'json' };

const OUT_DIR = resolve('.superpowers');

// Kept in step with src/map/framing.ts. Duplicated rather than imported because
// that file is TypeScript and this is a plain node script — if the two ever
// disagree, framing.ts is the source of truth.
const BBOX = {
  domestic: [
    [56.2, 22.7],
    [59.6, 24.8],
  ],
  regional: [
    [51.6, 16.3],
    [60.3, 26.6],
  ],
};

const W = 760;
const H = 620;

/** Anticlockwise: SW -> NW -> NE -> SE. See the winding note in framing.ts. */
function bboxPolygon([[w, s], [e, n]]) {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [w, n],
        [e, n],
        [e, s],
        [w, s],
      ],
    ],
  };
}

const rows = execFileSync(
  'docker',
  [
    'exec', '-i', 'supabase_db_truckkoo-app',
    'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-F', '\t',
    '-c', 'select name_en, country, lng, lat from public.cities order by name_en;',
  ],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    const [name, country, lng, lat] = l.split('\t');
    return { name, country, lng: Number(lng), lat: Number(lat) };
  });

function panel(framing) {
  const projection = geoMercator().fitSize([W, H], bboxPolygon(BBOX[framing]));
  const toPath = geoPath(projection);

  const neighbours = geometry.neighbours.features
    .map((f) => `<path d="${toPath(f)}" fill="#14171A" stroke="rgba(247,245,242,.17)" stroke-width="0.9"/>`)
    .join('');
  const oman = `<path d="${toPath(geometry.oman)}" fill="#1A1E24" stroke="rgba(255,255,255,.06)" stroke-width="1"/>`;

  const offFrame = [];
  const pins = rows
    .map(({ name, lng, lat }) => {
      const p = projection([lng, lat]);
      if (!p) return '';
      const [x, y] = p;
      if (x < 0 || y < 0 || x > W || y > H) {
        // Off-frame cities are reported in the console, NOT drawn. Drawing them
        // at their true (huge, negative) coordinates is what made the first
        // version of this script unreadable: the regional panel's off-frame
        // content rendered on top of the domestic panel beside it, and it looked
        // convincingly like a broken projection.
        offFrame.push(name);
        return '';
      }
      return (
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#F1551F"/>` +
        `<text x="${(x + 5).toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="9" ` +
        `fill="rgba(247,245,242,.9)" font-family="sans-serif">${name}</text>`
      );
    })
    .join('');

  // One SVG per framing rather than two panels in one file. The country
  // polygons extend far beyond either bbox, and a `clipPath` is the obvious fix
  // — but it renders inconsistently outside a browser, so separate files remove
  // the possibility of one framing's geometry bleeding over the other's. The
  // first version of this script did exactly that and looked convincingly like a
  // broken projection.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 30}" viewBox="0 0 ${W} ${H + 30}">
  <rect width="100%" height="100%" fill="#0E0F12"/>
  <text x="6" y="19" font-size="14" fill="#F7F5F2" font-family="sans-serif">${framing} — ${rows.length - offFrame.length}/${rows.length} cities in frame</text>
  <svg x="0" y="30" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0B0C0F"/>
    ${neighbours}${oman}${pins}
  </svg>
</svg>`;
  return { svg, offFrame };
}

const domestic = panel('domestic');
const regional = panel('regional');

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/map-domestic.svg`, domestic.svg);
writeFileSync(`${OUT_DIR}/map-regional.svg`, regional.svg);

console.log(`wrote ${OUT_DIR}/map-domestic.svg and map-regional.svg`);
console.log(`  ${rows.length} cities`);
console.log(`  domestic: ${rows.length - domestic.offFrame.length} in frame`);
console.log(`  regional: ${rows.length - regional.offFrame.length} in frame; outside: ${regional.offFrame.join(', ')}`);
console.log('\nOpen it and check every pin is in the town you expect.');
console.log('That is the one thing no constraint or script can verify.');

/**
 * Map framings and the one projection.
 *
 * There are exactly two framings, both from the design handoff, and the user
 * cannot pan or zoom between them — every screen picks one. Mercator, fitted to
 * the frame, because that is what generated the handoff's own outlines and any
 * other projection would put the coastlines somewhere else.
 *
 * EVERYTHING derives from `projectionFor`: pins, corridor endpoints, the truck
 * marker and the country outlines. Two projections in one picture means a pin in
 * the sea beside its own coastline, and it reads as broken geometry rather than
 * as the crossed wiring it is.
 */

import { geoMercator, type GeoProjection } from 'd3-geo';

/** A lng/lat box: [[west, south], [east, north]]. */
export type Box = [[number, number], [number, number]];

/**
 * One of the handoff's two named pictures, or a box around a particular route.
 *
 * The box exists because two fixed pictures were too coarse (2026-09-26): a
 * Muscat → Sur trip leaves the close-up by a few km, and pulling back to all of
 * Arabia drew it as a 20px stub. It is still a fixed framing chosen by the
 * screen — no pan, no zoom — it is just chosen from the route.
 */
export type Framing = 'domestic' | 'regional' | Box;

/**
 * Bounding boxes, verbatim from the handoff.
 *
 * `domestic` is the northern Oman corridor — Muscat / Batinah / Dhakhiliyah,
 * where most trips happen. `regional` pulls back to the whole operating region
 * once a destination leaves the country (S10). They are deliberately different
 * pictures: Salalah is inside one and not the other.
 */
export const BBOX: Record<'domestic' | 'regional', Box> = {
  domestic: [
    [56.2, 22.7],
    [59.6, 24.8],
  ],
  regional: [
    [51.6, 16.3],
    [60.3, 26.6],
  ],
};

/**
 * The framing's bbox as a GeoJSON polygon, for `fitSize` to fit.
 *
 * WINDING ORDER IS LOAD-BEARING AND COUNTER-INTUITIVE. `d3-geo` works on a
 * sphere, where a ring's winding decides which side is the interior — so a box
 * wound the wrong way is not a box, it is *everything except* that box. Fitting
 * to that silently fits the whole globe: the scale comes out at ~1 px per degree
 * and every city in Oman lands within a few pixels of every other, which reads as
 * a data problem rather than a winding problem.
 *
 * So the ring goes anticlockwise in lng/lat terms: SW → NW → NE → SE. Do not
 * "tidy" it into the more natural-looking SW → SE → NE → NW.
 */
function bboxPolygon([[w, s], [e, n]]: [[number, number], [number, number]]) {
  return {
    type: 'Polygon' as const,
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

/**
 * The part of a map band a person can actually see, in the band's own pixels.
 *
 * Every map screen floats a back button over the top of its map and slides a
 * sheet over the bottom. Fitting the framing to the whole band put the southern
 * edge of the close-up — Nizwa, Ibra, the Sur road — under the sheet (found on a
 * device, 2026-09-26). The map is still DRAWN full-bleed; only the fit changes.
 */
export type FitBox = { top?: number; bottom?: number };

/** Breathing room so a pin at the framing's edge is not cut by the screen's. */
const FIT_PAD = 18;

/**
 * A Mercator fitted so the framing's bbox fills `width` x `height` — or, given a
 * fit box, the visible band inside it.
 *
 * Without a box this is `fitSize`: full-bleed, exactly as the handoff draws a map
 * nothing overlaps. Fitting to the passed size rather than the handoff's 390x470
 * matters — phones are 360 to 430 logical px wide, and a hardcoded frame would
 * drift on every device that is not exactly the mockup.
 */
export function projectionFor(
  framing: Framing,
  width: number,
  height: number,
  fit?: FitBox,
): GeoProjection {
  const box = bboxPolygon(typeof framing === 'string' ? BBOX[framing] : framing);
  if (!fit) return geoMercator().fitSize([width, height], box);
  const top = Math.max(0, fit.top ?? 0) + FIT_PAD;
  const bottom = Math.min(height, fit.bottom ?? height) - FIT_PAD;
  // A sheet taller than the band leaves nothing to fit into; fall back to the
  // full frame rather than a zero-height projection that collapses every city
  // onto one line.
  if (bottom - top < 60) return geoMercator().fitSize([width, height], box);
  return geoMercator().fitExtent(
    [
      [FIT_PAD, top],
      [width - FIT_PAD, bottom],
    ],
    box,
  );
}

/** A point the map may need to show. Missing ones are skipped, not guessed. */
type MaybePoint = { lng: number; lat: number } | null | undefined;

/**
 * The framing that shows every point.
 *
 * The close-up when they all fit in it — the handoff's picture, unchanged for
 * the northern-Oman trips that are most of the business. Otherwise a box around
 * the points themselves: padded, never smaller than the close-up (a short trip
 * still shows its region, not a street) and never larger than the whole region.
 *
 * This is the handoff's S10 rule — "the map pulls back" when a route leaves the
 * close-up — applied to every map. Until 2026-09-26 five screens hardcoded
 * "domestic", so a route to Salalah, Sur, Buraimi or Dubai was drawn off-screen.
 *
 * Pass the truck's position as well as the route's ends: a truck the framing
 * leaves out is a truck the shipper cannot see.
 */
export function framingFor(points: MaybePoint[]): Framing {
  const known = points.filter((p): p is { lng: number; lat: number } => !!p);
  const [[dw, ds], [de, dn]] = BBOX.domestic;
  const inside = (p: { lng: number; lat: number }) =>
    p.lng >= dw && p.lng <= de && p.lat >= ds && p.lat <= dn;
  if (known.every(inside)) return 'domestic';

  const [[rw, rs], [re, rn]] = BBOX.regional;
  const minW = de - dw;
  const minH = dn - ds;

  // One axis at a time: the points' extent plus a margin, grown to at least the
  // close-up's span, then slid (not squashed) back inside the region.
  const axis = (lo: number, hi: number, min: number, bLo: number, bHi: number) => {
    const pad = Math.max((hi - lo) * 0.15, 0.3);
    let a = lo - pad;
    let b = hi + pad;
    if (b - a < min) {
      const mid = (a + b) / 2;
      a = mid - min / 2;
      b = mid + min / 2;
    }
    if (b - a >= bHi - bLo) return [bLo, bHi] as const;
    if (a < bLo) [a, b] = [bLo, bLo + (b - a)];
    if (b > bHi) [a, b] = [bHi - (b - a), bHi];
    return [a, b] as const;
  };

  const lngs = known.map((p) => p.lng);
  const lats = known.map((p) => p.lat);
  const [w, e] = axis(Math.min(...lngs), Math.max(...lngs), minW, rw, re);
  const [s, n] = axis(Math.min(...lats), Math.max(...lats), minH, rs, rn);
  return [
    [w, s],
    [e, n],
  ];
}

/**
 * Project a coordinate to screen space.
 *
 * Wrapped rather than calling the projection directly, because d3 returns
 * `[x, y] | null` and every call site would otherwise repeat the same null
 * check — or, worse, skip it and place the pin at (0,0), the top-left corner,
 * which reads as a layout bug. For lng/lat inside our bounds a null cannot
 * happen, so it is a programming error and should be loud.
 */
export function project(p: GeoProjection, lng: number, lat: number): { x: number; y: number } {
  const out = p([lng, lat]);
  if (!out || !Number.isFinite(out[0]) || !Number.isFinite(out[1])) {
    throw new Error(`unprojectable coordinate: ${lng},${lat}`);
  }
  return { x: out[0], y: out[1] };
}

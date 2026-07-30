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

export type Framing = 'domestic' | 'regional';

/**
 * Bounding boxes, verbatim from the handoff.
 *
 * `domestic` is the northern Oman corridor — Muscat / Batinah / Dhakhiliyah,
 * where most trips happen. `regional` pulls back to the whole operating region
 * once a destination leaves the country (S10). They are deliberately different
 * pictures: Salalah is inside one and not the other.
 */
export const BBOX: Record<Framing, [[number, number], [number, number]]> = {
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
 * A Mercator fitted so the framing's bbox exactly fills `width` x `height`.
 *
 * `fitSize`, not `fitExtent`: the design's maps are full-bleed and run off every
 * edge, so there is no padding to reserve. Fitting to the passed size rather than
 * the handoff's 390x470 matters — phones are 360 to 430 logical px wide, and a
 * hardcoded frame would drift on every device that is not exactly the mockup.
 */
export function projectionFor(framing: Framing, width: number, height: number): GeoProjection {
  return geoMercator().fitSize([width, height], bboxPolygon(BBOX[framing]));
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

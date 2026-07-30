/**
 * How far apart two cities are.
 *
 * WHAT THIS IS NOT: a routing engine. There is no road network in this app, and
 * adding one means a tile provider, a bill and a network round-trip on a phone
 * with bad signal. So this is a great-circle distance with a road factor applied,
 * and everything that renders it says "about".
 *
 * WHY A FACTOR AT ALL. Straight-line Muscat→Barka is about 55 km; the road is
 * about 80 km. Showing 55 to an operator who drives that route every week would
 * be visibly, credibility-destroyingly wrong. A number that is honest about being
 * approximate beats a precise-looking number that is not.
 *
 * The factor is a single constant on purpose. When a real routing source arrives,
 * this file is the only thing that changes — see OPEN_ISSUES.md.
 */

/** Mean Earth radius. */
const EARTH_KM = 6371;

/**
 * Road distance ÷ straight-line distance, for this region.
 *
 * MUST MATCH `road_factor_pct` in `private.app_settings` (migration 0025), which
 * is what the PRICE is built from. This constant only drives what a screen shows;
 * if the two disagree, a shipper sees one distance and is charged for another.
 *
 * 1.20 fits the long corridors, where the per-km term dominates the price:
 * Muscat→Sohar and Muscat→Salalah both imply ~1.20. Short hops imply more like
 * 1.47 and therefore read low — Muscat→Barka comes out around 65 km against ~80
 * on the ground. That error is deliberate and is absorbed by the minimum fare.
 */
export const ROAD_FACTOR = 1.2;

export type Coord = { lat: number; lng: number };

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km. Exported for tests; screens want `roadKm`. */
export function greatCircleKm(a: Coord, b: Coord): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Approximate road distance in km, rounded.
 *
 * Rounded to the nearest 5 km above 100, and the nearest kilometre below — a
 * three-significant-figure road estimate implies a precision this does not have.
 */
export function roadKm(a: Coord, b: Coord): number {
  const km = greatCircleKm(a, b) * ROAD_FACTOR;
  return km >= 100 ? Math.round(km / 5) * 5 : Math.round(km);
}

/**
 * Rough driving time in hours, from the road distance.
 *
 * 65 km/h average: highway between the Batinah towns, much slower through the
 * mountains and in town. Same caveat as the distance — always rendered as "about".
 */
export function roadHours(a: Coord, b: Coord): number {
  return roadKm(a, b) / 65;
}

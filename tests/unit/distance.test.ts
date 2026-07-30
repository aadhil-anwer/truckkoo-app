/**
 * Road distance.
 *
 * This is an approximation and the tests say so: they assert the answer is in
 * the right neighbourhood of the real road distance, not that it equals it. A
 * test demanding an exact figure would be asserting the factor rather than the
 * behaviour, and would have to be rewritten the moment a routing source lands.
 */

import { ROAD_FACTOR, greatCircleKm, roadKm } from '@/map/distance';

const MUSCAT = { lng: 58.408, lat: 23.588 };
const BARKA = { lng: 57.89, lat: 23.706 };
const SOHAR = { lng: 56.709, lat: 24.347 };
const SALALAH = { lng: 54.092, lat: 17.02 };

describe('greatCircleKm', () => {
  it('is zero for a city and itself', () => {
    expect(greatCircleKm(MUSCAT, MUSCAT)).toBeCloseTo(0, 6);
  });

  it('is symmetric', () => {
    expect(greatCircleKm(MUSCAT, SOHAR)).toBeCloseTo(greatCircleKm(SOHAR, MUSCAT), 9);
  });

  it('matches the known straight-line Muscat–Barka distance', () => {
    // ~55 km. If this drifts, the haversine is wrong, not the factor.
    expect(greatCircleKm(MUSCAT, BARKA)).toBeGreaterThan(50);
    expect(greatCircleKm(MUSCAT, BARKA)).toBeLessThan(60);
  });
});

describe('roadKm', () => {
  it('lands near the real Muscat–Barka road distance (~80 km)', () => {
    expect(roadKm(MUSCAT, BARKA)).toBeGreaterThan(65);
    expect(roadKm(MUSCAT, BARKA)).toBeLessThan(95);
  });

  it('lands near the real Muscat–Sohar road distance (~230 km)', () => {
    expect(roadKm(MUSCAT, SOHAR)).toBeGreaterThan(200);
    expect(roadKm(MUSCAT, SOHAR)).toBeLessThan(280);
  });

  it('is always longer than the straight line — a road is never a chord', () => {
    for (const [a, b] of [
      [MUSCAT, BARKA],
      [MUSCAT, SALALAH],
      [SOHAR, SALALAH],
    ] as const) {
      expect(roadKm(a, b)).toBeGreaterThan(greatCircleKm(a, b));
    }
  });

  it('rounds coarsely on long trips, because it does not know them that well', () => {
    // Muscat-Salalah is ~1000 km of road. A figure like 1023 would imply a
    // precision this has no basis for.
    expect(roadKm(MUSCAT, SALALAH) % 5).toBe(0);
  });

  it('applies the factor exactly once', () => {
    const straight = greatCircleKm(MUSCAT, BARKA);
    expect(roadKm(MUSCAT, BARKA)).toBeCloseTo(Math.round(straight * ROAD_FACTOR), 0);
  });
});

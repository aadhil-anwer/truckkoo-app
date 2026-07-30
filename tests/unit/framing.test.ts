/**
 * The projection.
 *
 * Everything visible on the map derives from this one function — pins, corridor
 * endpoints, the truck marker, the coastlines. If two of those used different
 * projections, a pin would sit in the sea beside its own coastline and the bug
 * would read as bad geometry rather than as bad wiring.
 *
 * These tests assert DIRECTION as well as bounds. A mirrored or flipped
 * projection still passes a bounds check while pointing every corridor in the
 * product the wrong way.
 */

import { BBOX, project, projectionFor } from '@/map/framing';

const MUSCAT = { lng: 58.408, lat: 23.588 };
const BARKA = { lng: 57.89, lat: 23.706 };
const SALALAH = { lng: 54.092, lat: 17.02 };
const KHASAB = { lng: 56.246, lat: 26.179 };

describe('projectionFor', () => {
  it('places a domestic city inside the domestic viewport', () => {
    const p = projectionFor('domestic', 390, 470);
    const { x, y } = project(p, MUSCAT.lng, MUSCAT.lat);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(390);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(470);
  });

  it('is deterministic — the same input always lands on the same pixel', () => {
    const a = project(projectionFor('domestic', 390, 470), MUSCAT.lng, MUSCAT.lat);
    const b = project(projectionFor('domestic', 390, 470), MUSCAT.lng, MUSCAT.lat);
    expect(a).toEqual(b);
  });

  it('puts west of Muscat to the left of Muscat, in both framings', () => {
    // Barka is west of Muscat. If this inverts, the projection is mirrored and
    // every corridor on every screen points the wrong way while still passing a
    // bounds check.
    for (const f of ['domestic', 'regional'] as const) {
      const p = projectionFor(f, 390, 470);
      expect(project(p, BARKA.lng, BARKA.lat).x).toBeLessThan(
        project(p, MUSCAT.lng, MUSCAT.lat).x,
      );
    }
  });

  it('puts north above south — screen y grows downward', () => {
    const p = projectionFor('regional', 390, 470);
    expect(project(p, KHASAB.lng, KHASAB.lat).y).toBeLessThan(
      project(p, SALALAH.lng, SALALAH.lat).y,
    );
  });

  it('only the regional framing contains Salalah', () => {
    // Salalah is ~1000 km south of the domestic box. It must fall outside it — if
    // the domestic framing quietly contained the whole country, S10's "the map
    // pulls back when the destination leaves Oman" would have nothing to pull
    // back from, and the two framings would be the same picture.
    const dom = project(projectionFor('domestic', 390, 470), SALALAH.lng, SALALAH.lat);
    expect(dom.y).toBeGreaterThan(470);

    const reg = project(projectionFor('regional', 390, 470), SALALAH.lng, SALALAH.lat);
    expect(reg.y).toBeGreaterThanOrEqual(0);
    expect(reg.y).toBeLessThanOrEqual(470);
  });

  it('scales with the viewport rather than assuming 390x470', () => {
    // Phones are 360-430 logical px wide. A projection hardcoded to the
    // handoff's 390 would drift on every device that is not exactly that.
    const small = project(projectionFor('domestic', 390, 470), MUSCAT.lng, MUSCAT.lat);
    const big = project(projectionFor('domestic', 780, 940), MUSCAT.lng, MUSCAT.lat);
    expect(big.x).toBeCloseTo(small.x * 2, 0);
    expect(big.y).toBeCloseTo(small.y * 2, 0);
  });

  it('exposes both framings with the handoff bboxes', () => {
    expect(BBOX.domestic).toEqual([
      [56.2, 22.7],
      [59.6, 24.8],
    ]);
    expect(BBOX.regional).toEqual([
      [51.6, 16.3],
      [60.3, 26.6],
    ]);
  });
});

describe('project', () => {
  it('throws on an unprojectable coordinate rather than returning null', () => {
    // d3 returns `[x, y] | null`. Swallowing the null would put a pin at (0,0)
    // — the top-left corner — which looks like a layout bug. For lng/lat inside
    // our bounds a null cannot happen, so it is a programming error and should
    // be loud.
    const p = projectionFor('domestic', 390, 470);
    expect(() => project(p, Number.NaN, Number.NaN)).toThrow(/unprojectable/);
  });
});

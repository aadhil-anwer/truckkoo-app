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

import { BBOX, framingFor, project, projectionFor } from '@/map/framing';

const MUSCAT = { lng: 58.408, lat: 23.588 };
const BARKA = { lng: 57.89, lat: 23.706 };
const SALALAH = { lng: 54.092, lat: 17.02 };
const KHASAB = { lng: 56.246, lat: 26.179 };
const NIZWA = { lng: 57.533, lat: 22.933 };
const SUR = { lng: 59.529, lat: 22.567 };
const DUBAI = { lng: 55.271, lat: 25.205 };

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

describe('framingFor — the picture follows the route', () => {
  /**
   * Found on a device, 2026-09-26: every map screen passed "domestic", so an
   * offer to Salalah or a trip to Sur drew its whole route off-screen and the
   * driver saw a black rectangle.
   */
  it('keeps the close-up when every point is inside it', () => {
    expect(framingFor([MUSCAT, BARKA])).toBe('domestic');
    expect(framingFor([MUSCAT, NIZWA])).toBe('domestic');
  });

  it('frames the route itself when it leaves the close-up, with every point on the map', () => {
    for (const pts of [
      [NIZWA, SALALAH],
      [MUSCAT, DUBAI],
      // Sur is just south of the close-up's edge — the case that looked fine on
      // paper and showed nothing on a phone.
      [MUSCAT, SUR],
      // The truck counts, so a reported position is never off the map.
      [MUSCAT, BARKA, { lng: 56.0, lat: 24.0 }],
    ]) {
      const p = projectionFor(framingFor(pts), 390, 420);
      for (const c of pts) {
        const { x, y } = project(p, c.lng, c.lat);
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(390);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(420);
      }
    }
  });

  it('never zooms in past the close-up, so a short trip still shows its region', () => {
    const f = framingFor([MUSCAT, SUR]);
    expect(f).not.toBe('domestic');
    const [[w, s], [e, n]] = typeof f === 'string' ? BBOX[f] : f;
    expect(e - w).toBeGreaterThanOrEqual(BBOX.domestic[1][0] - BBOX.domestic[0][0] - 1e-9);
    expect(n - s).toBeGreaterThanOrEqual(BBOX.domestic[1][1] - BBOX.domestic[0][1] - 1e-9);
  });

  it('frames a short trip that leaves the close-up far tighter than the whole region', () => {
    // Muscat → Sur pulled back to all of Arabia drew as a 20px stub.
    const f = framingFor([MUSCAT, SUR]);
    const [[w], [e]] = typeof f === 'string' ? BBOX[f] : f;
    expect(e - w).toBeLessThan((BBOX.regional[1][0] - BBOX.regional[0][0]) / 2);
  });

  it('never pulls back past the whole region', () => {
    const f = framingFor([SALALAH, KHASAB]);
    const [[w, s], [e, n]] = typeof f === 'string' ? BBOX[f] : f;
    expect(w).toBeGreaterThanOrEqual(BBOX.regional[0][0] - 1e-9);
    expect(s).toBeGreaterThanOrEqual(BBOX.regional[0][1] - 1e-9);
    expect(e).toBeLessThanOrEqual(BBOX.regional[1][0] + 1e-9);
    expect(n).toBeLessThanOrEqual(BBOX.regional[1][1] + 1e-9);
  });

  it('ignores points it does not have yet', () => {
    expect(framingFor([MUSCAT, null, undefined])).toBe('domestic');
    expect(framingFor([])).toBe('domestic');
  });
});

describe('projectionFor with a fit box — the part of the map nobody covers', () => {
  it('draws every framed city inside the visible band, not under the sheet', () => {
    // A 420px map with a sheet from y=300 up and a back button above y=90.
    const fit = { top: 90, bottom: 300 };
    for (const [framing, cities] of [
      ['domestic', [MUSCAT, BARKA, NIZWA]],
      ['regional', [MUSCAT, SALALAH, DUBAI, SUR]],
    ] as const) {
      const p = projectionFor(framing, 390, 420, fit);
      for (const c of cities) {
        const { x, y } = project(p, c.lng, c.lat);
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(390);
        expect(y).toBeGreaterThan(fit.top);
        expect(y).toBeLessThan(fit.bottom);
      }
    }
  });

  it('without a fit box is exactly the old full-frame projection', () => {
    const a = project(projectionFor('domestic', 390, 470), MUSCAT.lng, MUSCAT.lat);
    const b = project(projectionFor('domestic', 390, 470, undefined), MUSCAT.lng, MUSCAT.lat);
    expect(a).toEqual(b);
  });
});

describe('no screen hardcodes a framing', () => {
  /**
   * Every map screen used to pass framing="domestic", and every route that left
   * northern Oman was drawn off-screen. The picture must come from framingFor.
   * Scan source, because the failure is a literal someone types, not a behaviour.
   */
  it('passes no literal framing prop anywhere under src/app or src/components', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    const hits: string[] = [];
    const scan = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(file);
        else if (/\.tsx?$/.test(entry.name) && /framing="(?:domestic|regional)"/.test(fs.readFileSync(file, 'utf8'))) hits.push(file);
      }
    };
    scan(path.join(__dirname, '../../src/app'));
    scan(path.join(__dirname, '../../src/components'));
    expect(hits).toEqual([]);
  });
});

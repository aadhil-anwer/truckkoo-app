/**
 * Names on the map: seas, countries, and the towns people actually say.
 *
 * Drawn by `MapCanvas` under everything a screen adds, so a pin, corridor or
 * truck always sits on top of the name it is near. Every map gets them — the
 * point is orientation for someone who has never read a map on a phone, and
 * "which blob is Oman" is the first question on every screen.
 *
 * How much is named depends on how close the picture is. Pulled back to the
 * region, only the big cities, the countries and the seas; in the Muscat
 * close-up, the towns too. A label outside the visible band is not drawn.
 *
 * WHERE THE WORDS COME FROM. Sea and country names go through `t()`. City names
 * are NOT retyped here: they come from the `cities` table (lifted from the
 * website, like all reference data) through `MapPlacesProvider`, and this file
 * only names *which* cities count as major, by their English name. With no
 * provider — a test, a signed-out screen — the map simply names no towns.
 *
 * RTL: positions are geography and never flip (see MapCanvas). Text is centred
 * on its point, so it reads the same in either direction; Arabic gets its own
 * face and no letter-spacing, which breaks the joins.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Circle, G, Text as SvgText } from 'react-native-svg';
import type { GeoProjection } from 'd3-geo';

import { useProjection } from './MapCanvas';
import { getLanguage, t } from '@/i18n';
import { face } from '@/theme/faces';
import { map } from '@/theme/tokens';

/** The slice of a `cities` row the map needs. */
export type MapPlace = { name_en: string; name_ar: string; lat: number; lng: number };

const PlacesContext = createContext<readonly MapPlace[]>([]);

/** Provide the city list once, near the root; every map below can name towns. */
export function MapPlacesProvider({
  places,
  children,
}: {
  places: readonly MapPlace[] | undefined;
  children: ReactNode;
}) {
  return <PlacesContext.Provider value={places ?? []}>{children}</PlacesContext.Provider>;
}

/** Named at every zoom. The places a shipper in Oman or the Emirates would say first. */
const MAJOR = new Set(['Muscat', 'Sohar', 'Nizwa', 'Sur', 'Duqm', 'Salalah', 'Dubai', 'Abu Dhabi']);
/** Named only in a close-up, where there is room for them. */
const MINOR = new Set([
  'Barka',
  'Suwaiq',
  'Rustaq',
  'Samail',
  'Ibri',
  'Ibra',
  'Buraimi',
  'Khasab',
  'Sharjah',
  'Al Ain',
]);

type Fixed = { key: Parameters<typeof t>[0]; lng: number; lat: number; kind: 'sea' | 'country' };

/**
 * Seas and countries, placed by hand on open water or open desert — where the
 * name belongs, not on the country's centroid, which for Oman is a coastline.
 */
const FIXED: Fixed[] = [
  { key: 'map.sea.gulfOfOman', lng: 58.9, lat: 24.35, kind: 'sea' },
  { key: 'map.sea.arabianSea', lng: 59.2, lat: 18.4, kind: 'sea' },
  { key: 'map.sea.arabianGulf', lng: 52.9, lat: 25.75, kind: 'sea' },
  { key: 'map.sea.hormuz', lng: 56.75, lat: 26.55, kind: 'sea' },
  { key: 'country.OM', lng: 56.4, lat: 20.9, kind: 'country' },
  { key: 'country.AE', lng: 54.2, lat: 23.55, kind: 'country' },
  { key: 'country.SA', lng: 53.0, lat: 20.3, kind: 'country' },
  { key: 'map.country.YE', lng: 52.3, lat: 17.2, kind: 'country' },
  { key: 'map.country.IR', lng: 57.6, lat: 27.1, kind: 'country' },
];

const FIXED_STYLE = {
  sea: { size: 10.5, spacing: 1.6, fill: map.waterLabel },
  country: { size: 11, spacing: 2.4, fill: map.countryLabel },
} as const;

/**
 * Drawn under each name in the sea's colour, so a coastline, border or the
 * corridor running through a name never cuts a letter in half.
 */
const HALO = { fill: map.sea, stroke: map.sea, strokeWidth: 3, strokeLinejoin: 'round' as const };

/**
 * Screen pixels per degree of longitude. The regional framing is ~45, the
 * domestic close-up ~120 on a phone; towns appear above 80.
 */
function pxPerDegree(p: GeoProjection): number {
  const a = p([57, 23]);
  const b = p([58, 23]);
  return a && b ? Math.abs(b[0] - a[0]) : 0;
}
const CLOSE_UP = 80;
/** Keep a name this far inside the edge, so half a word is never drawn. */
const MARGIN = 16;
/** A town's name sits this far above its point — clear of an 8px pin ring. */
const LIFT = 14;

/**
 * A rough advance width. SVG text cannot be measured before it is drawn, and a
 * slight overestimate only nudges a label further from the edge.
 */
function textWidth(text: string, size: number, spacing: number): number {
  return text.length * (size * 0.6 + spacing);
}

export function MapLabels({
  width,
  height,
  top = 0,
  bottom = height,
}: {
  width: number;
  height: number;
  /** The visible band, from the canvas's `fit`: chrome covers the rest. */
  top?: number;
  bottom?: number;
}) {
  const projection = useProjection();
  const places = useContext(PlacesContext);
  const arabic = getLanguage() === 'ar';

  const labels = useMemo(() => {
    const closeUp = pxPerDegree(projection) >= CLOSE_UP;
    const inBand = (y: number) => y >= top + MARGIN && y <= bottom - MARGIN;
    // Seas and countries are areas, so a name that would cross the edge moves
    // inward rather than disappearing — it still sits on its water.
    const clampX = (x: number, w: number) =>
      Math.min(Math.max(x, MARGIN + w / 2), width - MARGIN - w / 2);
    const fits = (x: number, w: number) => x - w / 2 >= MARGIN && x + w / 2 <= width - MARGIN;
    const at = (lng: number, lat: number) => {
      const out = projection([lng, lat]);
      return out && Number.isFinite(out[0]) && Number.isFinite(out[1])
        ? { x: out[0], y: out[1] }
        : null;
    };

    // Countries only when pulled back: in a close-up the country is the whole
    // picture, and "OMAN" across Nizwa says nothing.
    const fixed = FIXED.filter((f) => f.kind === 'sea' || !closeUp)
      .map((f) => {
        const text = t(f.key);
        const style = FIXED_STYLE[f.kind];
        const w = textWidth(text, style.size, arabic ? 0 : style.spacing);
        const pt = at(f.lng, f.lat);
        return { ...f, text, pt: pt && w <= width - 2 * MARGIN ? { x: clampX(pt.x, w), y: pt.y } : null };
      })
      .filter((f) => f.pt && inBand(f.pt.y));

    const towns = places
      .filter((c) => MAJOR.has(c.name_en) || (closeUp && MINOR.has(c.name_en)))
      .map((c) => ({
        major: MAJOR.has(c.name_en),
        pt: at(c.lng, c.lat),
        text: arabic ? c.name_ar : c.name_en,
      }))
      // A town is a point: if its name does not fit where it is, it is not drawn.
      .filter(
        (c) =>
          c.pt &&
          inBand(c.pt.y - LIFT) &&
          inBand(c.pt.y) &&
          fits(c.pt.x, textWidth(c.text, c.major ? 11.5 : 10, 0)),
      );

    return { fixed, towns };
  }, [projection, places, width, top, bottom, arabic]);

  const latin = !arabic;
  return (
    <G testID="map-labels" pointerEvents="none">
      {labels.fixed.map((f) => {
        const style = FIXED_STYLE[f.kind];
        const text = latin ? f.text.toUpperCase() : f.text;
        const common = {
          x: f.pt!.x,
          y: f.pt!.y,
          textAnchor: 'middle' as const,
          fontFamily: arabic ? face.arabic500 : face.archivo600,
          fontSize: style.size,
          letterSpacing: latin ? style.spacing : 0,
        };
        return (
          <G key={f.key} testID={`map-label-${f.kind}`}>
            <SvgText {...common} {...HALO}>
              {text}
            </SvgText>
            <SvgText {...common} fill={style.fill}>
              {text}
            </SvgText>
          </G>
        );
      })}
      {labels.towns.map((c) => {
        const fill = c.major ? map.cityLabelMajor : map.cityLabelMinor;
        const common = {
          x: c.pt!.x,
          y: c.pt!.y - LIFT,
          textAnchor: 'middle' as const,
          fontFamily: arabic ? face.arabic500 : c.major ? face.archivo600 : face.archivo500,
          fontSize: c.major ? 11.5 : 10,
        };
        return (
          <G key={c.text} testID="map-label-town">
            <Circle cx={c.pt!.x} cy={c.pt!.y} r={c.major ? 2.2 : 1.6} fill={fill} />
            <SvgText {...common} {...HALO}>
              {c.text}
            </SvgText>
            <SvgText {...common} fill={fill}>
              {c.text}
            </SvgText>
          </G>
        );
      })}
    </G>
  );
}

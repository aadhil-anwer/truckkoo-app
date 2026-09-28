/**
 * Names on the map.
 *
 * What is guarded:
 * - seas are named on every map, so water reads as water;
 * - town names come from the provided `cities` rows (never retyped), and only
 *   the major ones when pulled back — the close-up is where towns earn room;
 * - no provider, no towns: the map never fetches or invents a place;
 * - Arabic reads Arabic, with no Latin letter-spacing to break the joins;
 * - a name the chrome covers is not drawn at all.
 */
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { initLanguage } from '@/i18n';
import { MapCanvas, MapPlacesProvider, type MapPlace } from '@/map';

const PLACES: MapPlace[] = [
  { name_en: 'Muscat', name_ar: 'مسقط', lat: 23.588, lng: 58.408 },
  { name_en: 'Nizwa', name_ar: 'نزوى', lat: 22.933, lng: 57.533 },
  { name_en: 'Barka', name_ar: 'بركاء', lat: 23.706, lng: 57.89 },
];

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };

function walk(visit: (n: Node) => void) {
  const go = (n: Node | string | null) => {
    if (!n || typeof n !== 'object') return;
    visit(n);
    (n.children ?? []).forEach(go);
  };
  go(screen.queryByTestId('map-labels') as unknown as Node | null);
}

/** Every string drawn by the label layer. */
function labelTexts(): string[] {
  const out: string[] = [];
  walk((n) => {
    if (n.type === 'Text') out.push((n.children ?? []).filter((c) => typeof c === 'string').join(''));
  });
  return out;
}

/** Each label's text style, flattened. */
function textStyles(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  walk((n) => {
    if (n.type === 'Text') out.push(StyleSheet.flatten(n.props.style as never) as Record<string, unknown>);
  });
  return out;
}

/** The top edge of each label's box, in map pixels. */
function labelTops(): number[] {
  const out: number[] = [];
  walk((n) => {
    const st = StyleSheet.flatten(n.props.style as never) as Record<string, unknown> | undefined;
    if (n.type === 'View' && st?.width === 200 && typeof st.top === 'number') out.push(st.top);
  });
  return out;
}

async function draw(framing: 'regional' | 'domestic', places?: MapPlace[], fitTop?: number) {
  const canvas = (
    <MapCanvas
      framing={framing}
      width={390}
      height={470}
      fit={fitTop == null ? undefined : { top: fitTop }}
    />
  );
  await render(places ? <MapPlacesProvider places={places}>{canvas}</MapPlacesProvider> : canvas);
}

beforeEach(() => initLanguage('en'));

describe('map labels', () => {
  it('names the Gulf of Oman', async () => {
    await draw('regional');
    expect(labelTexts()).toContain('GULF OF OMAN');
  });

  it('names no town without a provider — the map never invents a place', async () => {
    await draw('regional');
    expect(screen.queryAllByTestId('map-label-town')).toHaveLength(0);
  });

  it('pulled back, names only the major towns', async () => {
    await draw('regional', PLACES);
    const texts = labelTexts();
    expect(texts).toEqual(expect.arrayContaining(['Muscat', 'Nizwa']));
    expect(texts).not.toContain('Barka');
  });

  it('in the close-up, names the smaller towns too, and drops country names', async () => {
    await draw('domestic', PLACES);
    const texts = labelTexts();
    expect(texts).toEqual(expect.arrayContaining(['Muscat', 'Nizwa', 'Barka']));
    expect(texts).not.toContain('OMAN');
  });

  it('reads Arabic in Arabic, from the rows, with no letter-spacing', async () => {
    initLanguage('ar');
    await draw('regional', PLACES);
    const texts = labelTexts();
    expect(texts).toEqual(expect.arrayContaining(['مسقط', 'خليج عُمان']));
    for (const st of textStyles()) {
      expect(st.letterSpacing ?? 0).toBe(0);
      expect(st.fontFamily).toMatch(/IBMPlexSansArabic/);
    }
  });

  it('draws nothing under the chrome that covers the top of the map', async () => {
    // Uncovered, some names sit in the top 200px…
    await draw('regional', PLACES);
    // A label's box top sits above its point, so "in the band" means the top.
    const ys = labelTops;
    expect(ys().some((y) => y < 200)).toBe(true);
    // …and with the top 200px covered, those go and the rest stay.
    await draw('regional', PLACES, 200);
    expect(ys().length).toBeGreaterThan(0);
    for (const y of ys()) expect(y).toBeGreaterThanOrEqual(200);
  });
});

describe('map labels are native text', () => {
  it('draws no SVG text at all — react-native-svg cannot shape Arabic on Android', async () => {
    initLanguage('ar');
    await draw('regional', PLACES);
    let svgText = 0;
    const go = (n: Node | string | null) => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'RNSVGText' || n.type === 'RNSVGTSpan') svgText += 1;
      (n.children ?? []).forEach(go);
    };
    go(screen.toJSON() as unknown as Node);
    expect(svgText).toBe(0);
    expect(labelTexts()).toContain('مسقط');
  });
});

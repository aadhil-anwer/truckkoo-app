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
import { render, screen } from '@testing-library/react-native';

import { initLanguage } from '@/i18n';
import { MapCanvas, MapPlacesProvider, type MapPlace } from '@/map';

const PLACES: MapPlace[] = [
  { name_en: 'Muscat', name_ar: 'مسقط', lat: 23.588, lng: 58.408 },
  { name_en: 'Nizwa', name_ar: 'نزوى', lat: 22.933, lng: 57.533 },
  { name_en: 'Barka', name_ar: 'بركاء', lat: 23.706, lng: 57.89 },
];

type Node = { type: string; props: Record<string, unknown>; children: Node[] | null };

/** Every string drawn by the label layer, once each (the halo repeats it). */
function labelTexts(): string[] {
  const out = new Set<string>();
  const walk = (n: Node | null) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'RNSVGTSpan' && typeof n.props.content === 'string') out.add(n.props.content);
    (n.children ?? []).forEach(walk);
  };
  const layer = screen.queryByTestId('map-labels') as unknown as Node | null;
  walk(layer);
  return [...out];
}

function textProps(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (n: Node | null) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'RNSVGText') out.push(n.props);
    (n.children ?? []).forEach(walk);
  };
  walk(screen.queryByTestId('map-labels') as unknown as Node | null);
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
    for (const p of textProps()) {
      const font = p.font as { letterSpacing?: number; fontFamily?: string };
      expect(font.letterSpacing ?? 0).toBe(0);
      expect(font.fontFamily).toMatch(/IBMPlexSansArabic/);
    }
  });

  it('draws nothing under the chrome that covers the top of the map', async () => {
    // Uncovered, some names sit in the top 200px…
    await draw('regional', PLACES);
    const ys = () => textProps().map((p) => (p.y as number[])[0]);
    expect(ys().some((y) => y < 200)).toBe(true);
    // …and with the top 200px covered, those go and the rest stay.
    await draw('regional', PLACES, 200);
    expect(ys().length).toBeGreaterThan(0);
    for (const y of ys()) expect(y).toBeGreaterThanOrEqual(200);
  });
});

/**
 * A position is never drawn without its age, and an old one must not look like
 * a fresh one. Dimming is the whole of that distinction on the map; the
 * timestamp beside it carries the rest.
 */

import { render } from '@testing-library/react-native';

import { MapCanvas, TruckMarker } from '@/map';

const at = { lng: 58.4, lat: 23.6 };

function draw(stale: boolean) {
  return render(
    <MapCanvas framing="domestic" width={300} height={300}>
      <TruckMarker at={at} stale={stale} />
    </MapCanvas>,
  );
}

/** react-native-svg packs a colour into an AARRGGBB integer. */
function alphaOf(node: { props: Record<string, unknown> }): number {
  const { payload } = node.props.fill as { payload: number };
  return ((payload >>> 24) & 255) / 255;
}

describe('TruckMarker', () => {
  it('draws solid when the fix is fresh', async () => {
    const { getByTestId } = await draw(false);
    expect(alphaOf(getByTestId('truck-body'))).toBeGreaterThan(0.9);
  });

  it('dims when the fix is old, so age is visible on the map itself', async () => {
    const { getByTestId } = await draw(true);
    expect(alphaOf(getByTestId('truck-body'))).toBeLessThan(0.9);
  });

  it('is the same shape either way — dimming is not a different marker', async () => {
    const fresh = await draw(false);
    const stale = await draw(true);
    expect(fresh.getByTestId('truck-body').props.r).toBe(
      stale.getByTestId('truck-body').props.r,
    );
  });
});

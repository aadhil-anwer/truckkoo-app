/**
 * The map's base layers.
 *
 * Oman and its neighbours must be separately styled — the handoff is explicit
 * that neighbouring land without a border stroke reads as sea, which turns a map
 * of a region into a map of an island.
 */
import { processColor } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { MapCanvas } from '@/map';
import { map } from '@/theme/tokens';

function firstNeighbour() {
  const group = screen.getByTestId('map-neighbours');
  return (group.children[0] as { props: Record<string, unknown> }).props;
}

/**
 * `react-native-svg` normalises colour props into `{ type, payload }`, where the
 * payload is what `processColor` produces. Comparing through `processColor` keeps
 * the assertion exact — the alternative, checking merely that *a* stroke exists,
 * would pass for a stroke the colour of the sea.
 */
function strokeOf(props: Record<string, unknown>) {
  return (props.stroke as { payload?: number } | undefined)?.payload;
}
const asColor = (c: string) => processColor(c);

describe('MapCanvas', () => {
  it('renders Oman and the neighbours as separate layers', async () => {
    await render(<MapCanvas framing="regional" width={390} height={470} />);
    expect(screen.getByTestId('map-oman')).toBeTruthy();
    expect(screen.getByTestId('map-neighbours')).toBeTruthy();
  });

  it('draws Oman with real path data, not an empty string', async () => {
    // geoPath returns null for empty geometry, and an empty `d` renders nothing
    // at all — which looks like a styling problem rather than a missing fixture.
    await render(<MapCanvas framing="domestic" width={390} height={470} />);
    const d = screen.getByTestId('map-oman').props.d as string;
    expect(typeof d).toBe('string');
    expect(d.length).toBeGreaterThan(100);
  });

  it('gives the neighbours a visible border, or they read as sea', async () => {
    await render(<MapCanvas framing="regional" width={390} height={470} />);
    expect(strokeOf(firstNeighbour())).toBe(asColor(map.neighbourBorder));
    expect(Number(firstNeighbour().strokeWidth)).toBeGreaterThan(0);
  });

  it('fills Oman and its neighbours differently', async () => {
    await render(<MapCanvas framing="regional" width={390} height={470} />);
    const oman = (screen.getByTestId('map-oman').props.fill as { payload?: number }).payload;
    const neighbour = (firstNeighbour().fill as { payload?: number }).payload;
    expect(oman).toBe(asColor(map.omanLand));
    expect(neighbour).toBe(asColor(map.neighbourLand));
    expect(oman).not.toBe(neighbour);
  });

  it('reframes when the framing changes', async () => {
    // The two framings must produce genuinely different geometry — S10 depends on
    // the map pulling back when a destination leaves Oman.
    const dom = await render(<MapCanvas framing="domestic" width={390} height={470} />);
    const domesticPath = screen.getByTestId('map-oman').props.d;
    dom.unmount();

    await render(<MapCanvas framing="regional" width={390} height={470} />);
    expect(screen.getByTestId('map-oman').props.d).not.toBe(domesticPath);
  });
});

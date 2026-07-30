/**
 * The map's base layers.
 *
 * Oman and its neighbours must be separately styled — the handoff is explicit
 * that neighbouring land without a border stroke reads as sea, which turns a map
 * of a region into a map of an island.
 */
import { processColor } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import { CityPin, Corridor, MapCanvas } from '@/map';
import { color, map } from '@/theme/tokens';

const MUSCAT = { lng: 58.408, lat: 23.588 };
const BARKA = { lng: 57.89, lat: 23.706 };

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
    await dom.unmount();

    await render(<MapCanvas framing="regional" width={390} height={470} />);
    expect(screen.getByTestId('map-oman').props.d).not.toBe(domesticPath);
  });
});

/**
 * Dashed means "not yet committed" (T1, still matching) and solid means
 * "committed" (T3 onward). The handoff says this distinction carries meaning, so
 * it is asserted rather than trusted — a refactor that unified the two styles
 * would silently tell every waiting shipper their truck was booked.
 */
describe('Corridor', () => {
  const inFrame = (committed: boolean) =>
    render(
      <MapCanvas framing="domestic" width={390} height={470}>
        <Corridor from={MUSCAT} to={BARKA} committed={committed} />
      </MapCanvas>,
    );

  it('is dashed while uncommitted', async () => {
    await inFrame(false);
    const dash = screen.getByTestId('corridor-stroke').props.strokeDasharray;
    expect(dash).toBeTruthy();
  });

  it('is solid once committed', async () => {
    await inFrame(true);
    const dash = screen.getByTestId('corridor-stroke').props.strokeDasharray;
    expect(dash == null || (Array.isArray(dash) && dash.length === 0)).toBe(true);
  });

  it('draws a casing wider than the stroke, so the line reads over land', async () => {
    await inFrame(true);
    const casing = Number(screen.getByTestId('corridor-casing').props.strokeWidth);
    const stroke = Number(screen.getByTestId('corridor-stroke').props.strokeWidth);
    expect(casing).toBeGreaterThan(stroke);
  });

  it('runs between the two cities, not from the origin of the canvas', async () => {
    // A corridor drawn from (0,0) is the classic symptom of a projection that
    // was never applied.
    await inFrame(true);
    const d = screen.getByTestId('corridor-stroke').props.d as string;
    const [, x1, y1] = d.match(/M([\d.-]+),([\d.-]+)/) ?? [];
    expect(Number(x1)).toBeGreaterThan(1);
    expect(Number(y1)).toBeGreaterThan(1);
  });
});

/**
 * Origin is a ring, destination is a filled square — the same vocabulary
 * RouteRail uses in the sheet. If the map and the sheet disagree, the user
 * learns one and then has to read the other.
 */
describe('CityPin', () => {
  it('draws a committed origin as a ring — stroked, unfilled', async () => {
    await render(
      <MapCanvas framing="domestic" width={390} height={470}>
        <CityPin at={MUSCAT} state="origin" />
      </MapCanvas>,
    );
    const pin = screen.getByTestId('pin-origin');
    expect(Number(pin.props.strokeWidth)).toBeGreaterThan(0);
    // Explicitly unfilled. react-native-svg defaults an omitted fill to opaque
    // BLACK, so "no fill prop" would render a solid disc, not a ring — on an ink
    // map that reads as a hole. Asserting `none` rather than absence is what
    // catches that.
    expect(pin.props.fill).toBeNull();
  });

  it('draws a committed destination as a filled accent square', async () => {
    await render(
      <MapCanvas framing="domestic" width={390} height={470}>
        <CityPin at={BARKA} state="destination" />
      </MapCanvas>,
    );
    const pin = screen.getByTestId('pin-destination');
    expect((pin.props.fill as { payload?: number }).payload).toBe(asColor(color.accent));
    // A Rect, not a Circle. The shape IS the distinction.
    expect(pin.props.width).toBeTruthy();
  });

  it('makes a selected pin larger than an idle one', async () => {
    const idle = await render(
      <MapCanvas framing="domestic" width={390} height={470}>
        <CityPin at={MUSCAT} state="idle" />
      </MapCanvas>,
    );
    const small = Number(screen.getByTestId('pin-dot').props.r);
    await idle.unmount();

    await render(
      <MapCanvas framing="domestic" width={390} height={470}>
        <CityPin at={MUSCAT} state="selected" />
      </MapCanvas>,
    );
    expect(Number(screen.getByTestId('pin-selected').props.r)).toBeGreaterThan(small);
  });

  it('is tappable and announces the city it selects', async () => {
    // S3 promises "tap a city on the map", so a pin is a control, not
    // decoration, and must reach assistive tech as one.
    const onPress = jest.fn();
    await render(
      <MapCanvas framing="domestic" width={390} height={470}>
        <CityPin at={MUSCAT} state="idle" label="Muscat" onPress={onPress} />
      </MapCanvas>,
    );
    await fireEvent.press(screen.getByLabelText('Muscat'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

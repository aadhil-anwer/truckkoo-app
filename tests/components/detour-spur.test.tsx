/**
 * The spur off a corridor — where a driver turns off to pick a load up.
 *
 * It is DASHED for the same reason a proposed corridor is: the driver has not
 * committed to it yet. It is also deliberately NOT accent-coloured — the accent
 * on D2 belongs to the take button, and a screen with two accents has no primary
 * action. `tests/components/map.test.tsx` holds the other half of that rule.
 */

import { render } from '@testing-library/react-native';

import { MapCanvas, DetourSpur } from '@/map';

const from = { lng: 58.4, lat: 23.6 };
const to = { lng: 58.0, lat: 23.7 };

function draw() {
  return render(
    <MapCanvas framing="domestic" width={300} height={300}>
      <DetourSpur from={from} to={to} />
    </MapCanvas>,
  );
}

describe('DetourSpur', () => {
  it('draws dashed, because a detour is not a committed corridor', async () => {
    const { getByTestId } = await draw();
    expect(getByTestId('detour-spur').props.strokeDasharray).toBeTruthy();
  });

  it('ends in a dot at the pickup, so the turn-off point is a place', async () => {
    const { getByTestId } = await draw();
    expect(getByTestId('detour-pin')).toBeTruthy();
  });

  it('leaves the accent to the action, not to the geometry', async () => {
    const { getByTestId } = await draw();
    // react-native-svg packs a colour into an AARRGGBB integer, so the string
    // 'F1551F' never appears in the props — asserting on it would pass whatever
    // colour the spur was. Unpack the channels instead: the accent is strongly
    // saturated (241/85/31) and the light-text ramp is near-neutral.
    const { payload } = getByTestId('detour-spur').props.stroke as { payload: number };
    const channels = [(payload >> 16) & 255, (payload >> 8) & 255, payload & 255];
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThan(20);
  });

  it('takes its projection from the canvas, so pin and coastline cannot disagree', async () => {
    const { getByTestId } = await draw();
    const pin = getByTestId('detour-pin');
    // Projected, not passed through: a raw lng/lat would put the pin at 58,23.
    expect(Number(pin.props.cx)).toBeGreaterThan(0);
    expect(Number(pin.props.cx)).toBeLessThan(300);
    expect(Number(pin.props.cy)).toBeGreaterThan(0);
    expect(Number(pin.props.cy)).toBeLessThan(300);
  });
});

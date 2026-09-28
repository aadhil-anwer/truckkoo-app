/**
 * The ink booking step: map on top, sheet below.
 *
 * The sheet must be height-bounded. Unbounded, a 46-city list grew it to full
 * height, the map was squeezed to zero and the pinned "Continue" was pushed off
 * the bottom of the screen — on a real phone you could not get past step one of
 * booking without searching. Jest has no layout engine, so this pins the bound
 * itself; the overflow it prevents was only ever visible on a device.
 */
import { StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { MapStepShell } from '@/components/booking/shells';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('MapStepShell', () => {
  it('bounds the sheet so its list scrolls instead of pushing the footer off-screen', async () => {
    await render(
      <MapStepShell step={1} total={6} framing="regional" onBack={() => {}}>
        <Text>list</Text>
      </MapStepShell>,
    );
    const style = StyleSheet.flatten(screen.getByTestId('map-step-sheet').props.style);
    expect(style.maxHeight).toBe('60%');
  });
});

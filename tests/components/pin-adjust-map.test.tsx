import { fireEvent, render, screen } from '@testing-library/react-native';

import { PinAdjustMap } from '@/components/booking/PinAdjustMap';

it('reports where the map settled, not every frame of the drag', async () => {
  const onSettle = jest.fn();
  await render(<PinAdjustMap initial={{ lat: 23.6, lng: 58.4 }} onSettle={onSettle} />);
  expect(screen.getByTestId('pin-centre')).toBeTruthy();
  await fireEvent(screen.getByTestId('pin-map'), 'regionChangeComplete', {
    latitude: 23.61, longitude: 58.42, latitudeDelta: 0.005, longitudeDelta: 0.005,
  });
  expect(onSettle).toHaveBeenCalledWith({ lat: 23.61, lng: 58.42 });
});

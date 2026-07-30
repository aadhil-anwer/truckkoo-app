/**
 * The vehicle, in transit (T4, D7).
 *
 * A disc with an ink outline so it stays visible over the corridor it sits on,
 * plus a halo that reads as "live" without animating — animation on a cheap
 * Android phone costs frames the map already wants.
 *
 * Position interpolation between fixes belongs to the caller: this draws where
 * it is told. P6 owns the movement.
 */

import { Circle, G } from 'react-native-svg';

import { project } from './framing';
import { useProjection } from './MapCanvas';
import { color } from '@/theme/tokens';

export function TruckMarker({ at }: { at: { lng: number; lat: number } }) {
  const projection = useProjection();
  const { x, y } = project(projection, at.lng, at.lat);
  return (
    <G testID="truck-marker">
      <Circle cx={x} cy={y} r={9.5} fill="rgba(241,85,31,.16)" />
      <Circle cx={x} cy={y} r={6.5} fill={color.accent} stroke={color.ink} strokeWidth={2.5} />
    </G>
  );
}

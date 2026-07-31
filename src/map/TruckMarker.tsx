/**
 * The vehicle, in transit (T4, D7).
 *
 * A disc with an ink outline so it stays visible over the corridor it sits on,
 * plus a halo that reads as "live" without animating — animation on a cheap
 * Android phone costs frames the map already wants.
 *
 * The caller passes a position a phone reported. Nothing interpolates; since P6
 * there is no such thing as a computed position in this product.
 */

import { Circle, G } from 'react-native-svg';

import { project } from './framing';
import { useProjection } from './MapCanvas';
import { color } from '@/theme/tokens';

export function TruckMarker({
  at,
  stale = false,
}: {
  at: { lng: number; lat: number };
  /**
   * The fix is old (T4 uses 30 minutes). Dimmed, same geometry — a different
   * shape would read as a different kind of thing, where this is the same truck
   * seen longer ago. The timestamp beside the map says how much longer.
   */
  stale?: boolean;
}) {
  const projection = useProjection();
  const { x, y } = project(projection, at.lng, at.lat);
  return (
    <G testID="truck-marker">
      <Circle
        cx={x}
        cy={y}
        r={9.5}
        fill={stale ? 'rgba(241,85,31,.07)' : 'rgba(241,85,31,.16)'}
      />
      <Circle
        testID="truck-body"
        cx={x}
        cy={y}
        r={6.5}
        fill={stale ? 'rgba(241,85,31,.45)' : color.accent}
        stroke={color.ink}
        strokeWidth={2.5}
      />
    </G>
  );
}

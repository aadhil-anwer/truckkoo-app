/**
 * A city on the map.
 *
 * Four states, and two of them carry the same meaning the route rail carries in
 * the sheet: ORIGIN IS A RING, DESTINATION IS A FILLED SQUARE. The map and the
 * sheet must agree, or the user learns one vocabulary and then has to read
 * another.
 *
 * A pin is a control, not decoration — S3's helper text promises "tap a city on
 * the map" — so it carries a role and a label.
 */

import { Circle, G, Rect } from 'react-native-svg';

import { project } from './framing';
import { useProjection } from './MapCanvas';
import { color } from '@/theme/tokens';

type Point = { lng: number; lat: number };
export type PinState = 'idle' | 'selected' | 'origin' | 'destination';

export function CityPin({
  at,
  state,
  label,
  onPress,
}: {
  at: Point;
  state: PinState;
  label?: string;
  onPress?: () => void;
}) {
  const projection = useProjection();
  const { x, y } = project(projection, at.lng, at.lat);

  const common = {
    onPress,
    accessibilityRole: onPress ? ('button' as const) : undefined,
    accessibilityLabel: label,
  };

  if (state === 'origin') {
    // A ring: stroked, and EXPLICITLY unfilled.
    //
    // `fill="none"` is not optional here. `react-native-svg` defaults an omitted
    // fill to opaque BLACK, so leaving it out renders a solid black disc rather
    // than a ring — which on an ink map reads as a hole. The test asserts the
    // fill is none for exactly this reason.
    return (
      <G {...common}>
        <Circle
          testID="pin-origin"
          cx={x}
          cy={y}
          r={8}
          fill="none"
          stroke={color.lightText}
          strokeWidth={2.5}
        />
      </G>
    );
  }

  if (state === 'destination') {
    const size = 13;
    return (
      <G {...common}>
        <Rect
          testID="pin-destination"
          x={x - size / 2}
          y={y - size / 2}
          width={size}
          height={size}
          rx={2.5}
          fill={color.accent}
          stroke={color.ink}
          strokeWidth={2.5}
        />
      </G>
    );
  }

  if (state === 'selected') {
    return (
      <G {...common}>
        <Circle cx={x} cy={y} r={12} fill="rgba(241,85,31,.14)" />
        <Circle testID="pin-selected" cx={x} cy={y} r={4.5} fill={color.accent} />
      </G>
    );
  }

  return (
    <G {...common}>
      {/* An unselected city is a 4px dot — small on purpose, because 46 of them
          must not compete with the corridor. The invisible circle beneath is the
          tap target: a 4px dot is not tappable by a thumb. */}
      <Circle cx={x} cy={y} r={14} fill="transparent" />
      <Circle testID="pin-dot" cx={x} cy={y} r={2} fill="rgba(247,245,242,.42)" />
    </G>
  );
}

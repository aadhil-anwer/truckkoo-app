/**
 * The turn-off: the leg's line to the load's pickup.
 *
 * DASHED, like an uncommitted corridor, because that is exactly what it is — a
 * detour the driver is being asked about, not one they have agreed to. Solid
 * would read as a route already planned.
 *
 * NEUTRAL, unlike a corridor. On D2 the accent belongs to "Take it", and the one
 * accent on a screen is either the pinned action or the live state, never both.
 * So the spur is drawn in the light-text ramp and the corridor keeps the orange.
 *
 * SVG coordinates are the one place logical properties do not apply: a projected
 * x is a position on the peninsula, not a reading direction, and the Gulf does
 * not move to the other side of the screen in Arabic.
 */

import { Circle, G, Line } from 'react-native-svg';

import { project } from './framing';
import { useProjection } from './MapCanvas';

type Point = { lng: number; lat: number };

export function DetourSpur({ from, to }: { from: Point; to: Point }) {
  // From context, never computed here — a spur that projected itself would drift
  // off the coastline the canvas drew.
  const projection = useProjection();
  const a = project(projection, from.lng, from.lat);
  const b = project(projection, to.lng, to.lat);

  return (
    <G>
      <Line
        testID="detour-spur"
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="rgba(247,245,242,.4)"
        strokeWidth={2.2}
        strokeDasharray="5 5"
        strokeLinecap="round"
      />
      {/* The turn-off is a place, not the end of a line. */}
      <Circle testID="detour-pin" cx={b.x} cy={b.y} r={3} fill="#F7F5F2" />
    </G>
  );
}

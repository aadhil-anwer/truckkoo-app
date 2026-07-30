/**
 * The origin → destination line.
 *
 * DASHED MEANS UNCOMMITTED, SOLID MEANS COMMITTED. That is not styling: while a
 * load is still being matched (T1) the corridor is a proposal, and once a driver
 * has taken it (T3 onward) it is a fact. Unifying the two would tell every
 * waiting shipper their truck was booked. `tests/components/map.test.tsx` guards it.
 *
 * A casing under the stroke keeps the line legible where it crosses land — the
 * same trick a road map uses, and why the casing is the wider of the two.
 */

import { G, Path } from 'react-native-svg';

import { project } from './framing';
import { useProjection } from './MapCanvas';
import { color } from '@/theme/tokens';

type Point = { lng: number; lat: number };

export function Corridor({
  from,
  to,
  committed = false,
}: {
  from: Point;
  to: Point;
  committed?: boolean;
}) {
  const projection = useProjection();
  const a = project(projection, from.lng, from.lat);
  const b = project(projection, to.lng, to.lat);

  // A straight line, deliberately. There is no road geometry in this app, and a
  // curve would imply a route we do not know.
  const d = `M${a.x},${a.y} L${b.x},${b.y}`;

  return (
    <G>
      <Path
        testID="corridor-casing"
        d={d}
        stroke={committed ? 'rgba(241,85,31,.22)' : 'rgba(241,85,31,.12)'}
        strokeWidth={committed ? 11 : 7}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        testID="corridor-stroke"
        d={d}
        stroke={committed ? color.accent : 'rgba(241,85,31,.45)'}
        strokeWidth={committed ? 3.6 : 2.6}
        strokeLinecap="round"
        strokeDasharray={committed ? undefined : '7 7'}
        fill="none"
      />
    </G>
  );
}

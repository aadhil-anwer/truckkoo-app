/**
 * The gradient that keeps type legible over map geometry.
 *
 * An SVG gradient rather than `expo-linear-gradient`: the map is already an SVG
 * tree, and a native gradient view would mean compositing two rendering systems
 * for one rectangle.
 *
 * Which variant depends on how much map is showing — see `scrim` in the tokens.
 */

import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { scrim } from '@/theme/tokens';

export function Scrim({
  variant,
  width,
  height,
}: {
  variant: keyof typeof scrim;
  width: number;
  height: number;
}) {
  const { colors, locations } = scrim[variant];
  const id = `scrim-${variant}`;
  return (
    <Svg
      testID={`scrim-${variant}`}
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0 }}
      // A scrim sits over tappable city pins. Without this it eats every tap,
      // and S3's promise that you can "tap a city on the map" quietly stops
      // being true. Functional, not styling.
      pointerEvents="none"
    >
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          {colors.map((c, i) => (
            <Stop key={i} offset={locations[i]} stopColor={c} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

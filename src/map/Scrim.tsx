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

/**
 * react-native-svg drops the alpha of an `rgba()` `stopColor` — every stop
 * reached native code opaque, and the scrim painted over the whole map. The
 * tokens stay in `rgba()` like the rest of the palette; the alpha is moved into
 * `stopOpacity` here, the one place a gradient is built.
 */
function splitAlpha(c: string): { hex: string; opacity: number } {
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(c);
  if (!m) return { hex: c, opacity: 1 };
  const hex = [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  return { hex: `#${hex.toUpperCase()}`, opacity: Number(m[4]) };
}

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
          {colors.map((c, i) => {
            const { hex, opacity } = splitAlpha(c);
            return <Stop key={i} offset={locations[i]} stopColor={hex} stopOpacity={opacity} />;
          })}
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

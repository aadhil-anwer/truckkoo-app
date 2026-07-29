/**
 * The drawn shapes behind `icon.tsx`.
 *
 * Split out so the semantic map next door stays readable. Nothing outside
 * `icon.tsx` should import from here — screens name a thing, not a shape.
 *
 * Every path is authored on a 24-unit viewBox, `fill: none`, stroke round-capped
 * and round-joined. Stroke weight is the thing that carries consistency across an
 * icon set, which is exactly what a glyph font cannot give you.
 */

import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { ReactNode } from 'react';

export const STROKE = 1.9;
export const STROKE_HEAVY = 2.4;

export function Frame({
  size,
  children,
  stroke,
  tint,
}: {
  size: number;
  children: ReactNode;
  stroke: number;
  tint: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={tint}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

/** name → the path elements for it, on a 24 viewBox. */
export const SHAPES: Record<string, ReactNode> = {
  home: (
    <>
      <Path d="M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1z" />
    </>
  ),
  chevron: <Path d="M9 5l7 7-7 7" />,
  chevronBack: <Path d="M15 5l-7 7 7 7" />,
  plus: <Path d="M12 5v14M5 12h14" />,
  check: <Path d="M4 12.5l5.5 5.5L20 7" />,
  search: (
    <>
      <Circle cx="11" cy="11" r="6.5" />
      <Path d="M16 16l4.5 4.5" />
    </>
  ),
  phone: (
    <Path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 006.5 6.5L17 13l4 1.5v3a2 2 0 01-2.2 2A16.5 16.5 0 014.5 5.2 2 2 0 016.5 3z" />
  ),
  message: <Path d="M4 5.5h16v11H9.5L5 20.5V16.5H4z" />,
  truck: (
    <>
      <Path d="M2.5 6h11v9h-11z" />
      <Path d="M13.5 9.5H18l3 3.5v2h-7.5z" />
      <Circle cx="7" cy="17.5" r="2" />
      <Circle cx="17" cy="17.5" r="2" />
    </>
  ),
  box: (
    <>
      <Path d="M12 2.8l8 4.2v10l-8 4.2-8-4.2V7z" />
      <Path d="M4 7l8 4.2L20 7M12 11.2V21.2" />
    </>
  ),
  loads: (
    <>
      <Path d="M12 2.8l8 4.2-8 4.2L4 7z" />
      <Path d="M4 12l8 4.2 8-4.2M4 16.5l8 4.2 8-4.2" />
    </>
  ),
  account: (
    <>
      <Circle cx="12" cy="8" r="3.8" />
      <Path d="M4.5 20.5a7.5 7.5 0 0115 0" />
    </>
  ),
  routes: (
    <>
      <Circle cx="6" cy="5.5" r="2.5" />
      <Rect x="15.5" y="16" width="5" height="5" rx="1" />
      <Path d="M6 8v5a5 5 0 005 5h4.5" />
    </>
  ),
  bell: (
    <>
      <Path d="M18 16.5H6l1.5-2.5V10a4.5 4.5 0 019 0v4z" />
      <Path d="M10.5 19.5a1.8 1.8 0 003 0" />
    </>
  ),
  calendar: (
    <>
      <Rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <Path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M12 7v5.3l3.2 2" />
    </>
  ),
  info: (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M12 11v5.5M12 7.8v.2" />
    </>
  ),
  question: (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M9.6 9.4a2.5 2.5 0 114 2.4c-.9.6-1.6 1-1.6 2M12 16.4v.2" />
    </>
  ),
  edit: <Path d="M4 20h4L19 9a2.2 2.2 0 00-3-3L5 17z" />,
  swap: <Path d="M7 8h11l-3-3M17 16H6l3 3" />,
  starOutline: (
    <Path d="M12 3.5l2.7 5.6 6.1.85-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.85z" />
  ),
  backspace: (
    <>
      <Path d="M9 5.5h11v13H9l-6-6.5z" />
      <Path d="M12.5 9.5l5 5M17.5 9.5l-5 5" />
    </>
  ),
  // The freight nouns and states used by surviving screens but absent from the
  // handoff's own inventory — see icon.test.tsx and task-5-report.md for why.
  close: <Path d="M6 6l12 12M18 6L6 18" />,
  camera: (
    <>
      <Path d="M4 8.5a2 2 0 012-2h2l1.2-2h5.6L16 6.5h2a2 2 0 012 2V18a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
      <Circle cx="12" cy="13" r="3.5" />
    </>
  ),
  alert: (
    <>
      <Path d="M12 3.5l9.5 16.5H2.5z" />
      <Path d="M12 10v4.2M12 17.3v.2" />
    </>
  ),
  checkCircle: (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M8 12.3l2.8 2.8L16.2 9.5" />
    </>
  ),
  dropoff: (
    <>
      <Path d="M12 21s7-6.5 7-11.5A7 7 0 105 9.5C5 14.5 12 21 12 21z" />
      <Circle cx="12" cy="9.5" r="2.3" />
    </>
  ),
  language: (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M3.5 12h17M12 3.5c2.5 2.5 2.5 14.5 0 17M12 3.5c-2.5 2.5-2.5 14.5 0 17" />
    </>
  ),
  signOut: (
    <>
      <Path d="M13 4H6.5A1.5 1.5 0 005 5.5v13A1.5 1.5 0 006.5 20H13" />
      <Path d="M11 12h9.5M17 8.5l3.5 3.5-3.5 3.5" />
    </>
  ),
};

/** Filled shapes — stroke is irrelevant, the fill carries them. */
export const FILLED: Record<string, (tint: string) => ReactNode> = {
  starFilled: (tint) => (
    <Path
      d="M12 3.5l2.7 5.6 6.1.85-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.85z"
      fill={tint}
      stroke="none"
    />
  ),
  /**
   * The Google mark. Reproduced exactly — brand requirement, and the one icon in
   * the set that is not ours to redraw. Four fixed brand colours, so it ignores
   * the `tint` argument on purpose.
   */
  google: () => (
    <>
      <Path
        d="M21.6 12.23c0-.7-.06-1.37-.18-2.02H12v3.82h5.38a4.6 4.6 0 01-2 3.02v2.5h3.24c1.89-1.74 2.98-4.3 2.98-7.32z"
        fill="#4285F4"
        stroke="none"
      />
      <Path
        d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.24-2.5c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.06v2.59A10 10 0 0012 22z"
        fill="#34A853"
        stroke="none"
      />
      <Path
        d="M6.41 13.91a6 6 0 010-3.82V7.5H3.06a10 10 0 000 9l3.35-2.59z"
        fill="#FBBC05"
        stroke="none"
      />
      <Path
        d="M12 5.86c1.47 0 2.79.5 3.83 1.5l2.87-2.87C16.95 2.9 14.7 2 12 2A10 10 0 003.06 7.5l3.35 2.59C7.2 7.72 9.4 5.86 12 5.86z"
        fill="#EA4335"
        stroke="none"
      />
    </>
  ),
};

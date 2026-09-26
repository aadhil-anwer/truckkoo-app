/**
 * The icon vocabulary.
 *
 * Screens never name a glyph. They name a *thing* — `pickup`, `truck`, `pay` —
 * and this file decides what that looks like. That indirection is the whole
 * point: it is what stops two screens from picking two different shapes for the
 * same concept, which is the usual way an icon set stops looking designed.
 *
 * Hand-authored SVG, not a glyph font. The handoff names stroke weight (1.9–2.1)
 * and round caps as the properties that carry consistency across a set, and a
 * font bakes stroke weight into each glyph.
 *
 * DIRECTION: a chevron and an arrow point at something, so both mirror under
 * RTL. Handled here, once, rather than at ~30 call sites.
 */

import { I18nManager, type StyleProp, type ViewStyle, View } from 'react-native';

import { color } from '@/theme/tokens';
import { FILLED, Frame, SHAPES, STROKE } from './svg-icon';

/**
 * Semantic name → shape key. Directional entries are `[ltr, rtl]` pairs.
 *
 * Adding a row here is cheap. Reaching past this map to draw an SVG inline in a
 * screen is what this file exists to prevent.
 *
 * `alert`, `camera`, `checkCircle`, `close`, `dropoff`, `goods`, `language`,
 * `signOut` and `whatsapp` are not in the handoff's own inventory but are used
 * by surviving screens (see task-5-report.md) — added here rather than editing
 * those screens.
 */
const NAMED = {
  // navigation
  home: 'home',
  loads: 'loads',
  offers: 'bell',
  routes: 'routes',
  // The trips a driver has done: the truck, not a clock. A history glyph would
  // be the first icon in the set that names a UI idea rather than a thing.
  pastTrips: 'truck',
  account: 'account',

  // movement — these mirror
  chevron: ['chevron', 'chevronBack'],
  back: ['chevronBack', 'chevron'],
  forward: ['chevron', 'chevronBack'],

  // the freight nouns
  pickup: 'box',
  dropoff: 'dropoff',
  truck: 'truck',
  pay: 'box',
  goods: 'box',

  // actions
  plus: 'plus',
  check: 'check',
  checkCircle: 'checkCircle',
  close: 'close',
  search: 'search',
  phone: 'phone',
  message: 'message',
  whatsapp: 'message',
  edit: 'edit',
  swap: 'swap',
  backspace: 'backspace',
  camera: 'camera',
  signOut: 'signOut',
  language: 'language',

  // information
  calendar: 'calendar',
  clock: 'clock',
  weight: 'weight',
  reference: 'reference',
  info: 'info',
  question: 'question',
  alert: 'alert',

  // rating
  star: 'starFilled',
  starOutline: 'starOutline',

  // brand
  google: 'google',
} as const;

export type IconName = keyof typeof NAMED;

export function Icon({
  name,
  size = 22,
  tint = color.lightText,
  stroke = STROKE,
  style,
}: {
  name: IconName;
  size?: number;
  tint?: string;
  stroke?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const entry = NAMED[name];
  const key = Array.isArray(entry) ? entry[I18nManager.isRTL ? 1 : 0] : entry;

  const filled = FILLED[key];
  return (
    <View style={style} accessible={false} importantForAccessibility="no-hide-descendants">
      <Frame size={size} stroke={stroke} tint={tint}>
        {filled ? filled(tint) : SHAPES[key]}
      </Frame>
    </View>
  );
}

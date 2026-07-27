/**
 * The icon vocabulary.
 *
 * Screens never name a glyph. They name a *thing* — `pickup`, `truck`, `pay` —
 * and this file decides what that looks like. That indirection is the whole
 * point: it is what stops two screens from picking two different glyphs for the
 * same concept, which is the usual way an icon set stops looking designed.
 *
 * One family (MaterialCommunityIcons), because it is the only free set that
 * carries a credible `truck` alongside everything else we need. Mixing families
 * at 24px is visible even when nobody can say why.
 *
 * DIRECTION: a chevron and an arrow point at something, so both mirror under
 * RTL. That is handled here, once, rather than at ~30 call sites — the same
 * reason `directionArrow()` exists in i18n.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { I18nManager } from 'react-native';

import { color } from '@/theme/tokens';

/**
 * Semantic name → glyph. Directional entries are `[ltr, rtl]` pairs.
 *
 * Adding a row here is cheap. Reaching past this map to import
 * MaterialCommunityIcons directly in a screen is what this file exists to
 * prevent.
 */
const GLYPH = {
  // navigation
  home: 'home-variant-outline',
  homeOn: 'home-variant',
  loads: 'package-variant-closed',
  loadsOn: 'package-variant',
  offers: 'tray-arrow-down',
  offersOn: 'tray-full',
  routes: 'map-marker-path',
  routesOn: 'map-marker-path',
  account: 'account-outline',
  accountOn: 'account',

  // movement — all four mirror
  chevron: ['chevron-right', 'chevron-left'],
  back: ['arrow-left', 'arrow-right'],
  forward: ['arrow-right', 'arrow-left'],
  send: ['send', 'send'],

  // the freight nouns
  pickup: 'circle-outline',
  dropoff: 'square-rounded-outline',
  truck: 'truck-outline',
  goods: 'package-variant-closed',
  weight: 'weight-kilogram',
  calendar: 'calendar-blank-outline',
  pay: 'cash',
  reference: 'pound',

  // people and contact
  driver: 'account-circle-outline',
  phone: 'phone-outline',
  whatsapp: 'whatsapp',
  verified: 'shield-check',

  // state
  clock: 'clock-outline',
  check: 'check',
  checkCircle: 'check-circle',
  close: 'close',
  search: 'magnify',
  plus: 'plus',
  camera: 'camera-outline',
  photo: 'image-outline',
  alert: 'alert-circle-outline',
  info: 'information-outline',
  signOut: 'logout',
  language: 'translate',
} as const;

export type IconName = keyof typeof GLYPH;

export type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
};

export function Icon({ name, size = 22, color: tint = color.ink }: IconProps) {
  const entry = GLYPH[name];
  const glyph = Array.isArray(entry) ? entry[I18nManager.isRTL ? 1 : 0] : entry;

  return (
    <MaterialCommunityIcons
      name={glyph as never}
      size={size}
      color={tint}
      // An icon beside a label is decoration — the label is already announced.
      // Screens that use an icon *as* the only content give the Pressable its own
      // accessibilityLabel instead.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

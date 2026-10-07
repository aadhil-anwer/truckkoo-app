/**
 * Direction-aware text helpers.
 *
 * `align` re-exported from i18n so components have one import for direction — it
 * names a physical edge and React Native mirrors it under RTL, and
 * `arabicIfNeeded` applies the Arabic face and looser leading when the app is in
 * Arabic — the rule from tokens.ts `arabicize`, applied at render time rather
 * than baked into the token.
 */

import { align, getLanguage } from '@/i18n';
import { arabicize } from '@/theme/tokens';

export { align };

export function arabicIfNeeded<T extends { fontFamily: string; fontSize: number; lineHeight: number }>(
  style: T,
): T {
  return getLanguage() !== 'en' ? arabicize(style) : style;
}

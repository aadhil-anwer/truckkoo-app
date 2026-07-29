/**
 * Font family names.
 *
 * Split from tokens.ts because this is the only module that knows what the
 * loaded font *files* are called, and `_layout.tsx` needs that list too.
 *
 * WHY EXPLICIT FAMILIES AND NOT `fontWeight`:
 * React Native does not synthesize weights for custom families. Loading
 * `Archivo_900Black` and then writing `fontWeight: '900'` gets you the regular
 * face on Android and silent luck on iOS. The previous system did exactly that,
 * which is why weight never read correctly on device. Every type token names a
 * family; no token sets `fontWeight`.
 */

import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
} from '@expo-google-fonts/archivo';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';

export const face = {
  archivo400: 'Archivo_400Regular',
  archivo500: 'Archivo_500Medium',
  archivo600: 'Archivo_600SemiBold',
  archivo700: 'Archivo_700Bold',
  archivo800: 'Archivo_800ExtraBold',

  /** Questions and hero numbers ONLY. One display statement per screen. */
  serif: 'InstrumentSerif_400Regular',

  arabic400: 'IBMPlexSansArabic_400Regular',
  arabic500: 'IBMPlexSansArabic_500Medium',
  arabic600: 'IBMPlexSansArabic_600SemiBold',
  arabic700: 'IBMPlexSansArabic_700Bold',
} as const;

/**
 * Latin face → its Arabic counterpart, one weight step lighter.
 *
 * Plex Arabic runs optically heavier than Archivo, so matching the nominal
 * weight makes Arabic look shouty next to identical English. The handoff
 * specifies 600-where-Latin-is-700; this map is that rule, encoded once.
 *
 * Instrument Serif has no Arabic counterpart — Arabic display type falls back to
 * the heaviest Plex Arabic, which is the intended treatment.
 */
const TO_ARABIC: Record<string, string> = {
  [face.archivo400]: face.arabic400,
  [face.archivo500]: face.arabic400,
  [face.archivo600]: face.arabic500,
  [face.archivo700]: face.arabic600,
  [face.archivo800]: face.arabic700,
  [face.serif]: face.arabic600,
};

export function arabicFaceFor(latinFace: string): string {
  return TO_ARABIC[latinFace] ?? face.arabic400;
}

/** Exactly what `useFonts` is given. Bundled, never fetched at runtime. */
export const FONT_ASSETS = {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  InstrumentSerif_400Regular,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
};

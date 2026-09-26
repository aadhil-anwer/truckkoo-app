/**
 * N1 · Welcome.
 *
 * Ink. The region fills the screen at half strength behind the hero scrim, so
 * the first thing a new user sees is where Truckkoo drives before a word of
 * copy. Content is bottom-anchored, at the thumb.
 *
 * INTERIM: the handoff draws one primary, "Continue with my number", because a
 * one-time code does not care whether the account is new. An email and password
 * do — so until WhatsApp codes land there are two paths, stated plainly, rather
 * than one path that guesses and occasionally makes a second account for a
 * returning user who mistyped their address.
 *
 * The mockup's two decorative pins are not drawn. Pins come from `cities`, and
 * nobody signed out can read that table — inventing coordinates here to get
 * around it is exactly what `cities.lat/lng` exists to prevent.
 */
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton, TertiaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { QuestionHeading } from '@/components/ui';
import { align, t } from '@/i18n';
import { signInWithProvider } from '@/lib/auth';
import { startAuthDraft, type AuthMode } from '@/lib/auth-draft';
import { MapCanvas, Scrim, framingFor } from '@/map';
import { face } from '@/theme/faces';
import { GUTTER_INK, alpha, color, font, space } from '@/theme/tokens';

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [busy, setBusy] = useState<null | 'google' | 'apple'>(null);
  const [error, setError] = useState<string | null>(null);

  function begin(mode: AuthMode) {
    startAuthDraft(mode);
    router.push('/email');
  }

  async function onProvider(provider: 'google' | 'apple') {
    setError(null);
    setBusy(provider);
    const result = await signInWithProvider(provider);
    setBusy(null);
    // On success the Gate takes it from here: home for an existing account, the
    // role question for a new one.
    if (!result.ok) setError(result.message);
  }

  return (
    <View
      style={styles.screen}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize({ width, height });
      }}
    >
      {size.width > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={styles.map}>
            {/* No route yet, so no points: the close-up of northern Oman. */}
            <MapCanvas framing={framingFor([])} width={size.width} height={size.height * 0.62} />
          </View>
          <Scrim variant="hero" width={size.width} height={size.height} />
        </View>
      )}

      <Text style={[styles.wordmark, { marginTop: insets.top + space.xl }]}>
        {t('app.name').toUpperCase()}
      </Text>

      <View style={[styles.content, { paddingBottom: insets.bottom + space.xl }]}>
        <QuestionHeading size="hero" ground="ink">
          {t('auth.welcome.title')}
        </QuestionHeading>
        <Text style={[arabicIfNeeded(font.body), styles.body]}>{t('auth.welcome.body')}</Text>

        <View style={styles.actions}>
          <PrimaryButton label={t('auth.welcome.start')} onPress={() => begin('signUp')} />
          <SecondaryButton
            label={t('auth.google')}
            icon="google"
            disabled={!!busy}
            onPress={() => onProvider('google')}
          />
          {/* iOS only. App Store 4.8 requires Apple sign-in beside other social
              logins on Apple platforms; it does not ask for it on Android. */}
          {Platform.OS === 'ios' && (
            <SecondaryButton
              label={t('auth.apple')}
              disabled={!!busy}
              onPress={() => onProvider('apple')}
            />
          )}
          <TertiaryButton label={t('auth.welcome.signIn')} onPress={() => begin('signIn')} />
        </View>

        {!!error && (
          <Text style={[arabicIfNeeded(font.bodySmall), styles.error]} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}

        <Text style={[arabicIfNeeded(font.bodySmall), styles.legal]}>{t('auth.welcome.legal')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  map: { opacity: 0.5 },
  wordmark: {
    fontFamily: face.archivo800,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 3.4,
    color: color.accentLight,
    paddingHorizontal: GUTTER_INK + space.sm,
    textAlign: align.start,
  },
  content: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: GUTTER_INK,
    gap: space.md,
  },
  body: { color: alpha.onInk.body, textAlign: align.start, maxWidth: 300 },
  actions: { marginTop: space.lg, gap: space.sm },
  error: { color: color.dangerLight, textAlign: 'center' },
  legal: { color: alpha.onInk.tertiary, textAlign: 'center', alignSelf: 'center', maxWidth: 290 },
});

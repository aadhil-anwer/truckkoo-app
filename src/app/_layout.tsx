/**
 * App shell. Loads the brand faces, initialises direction, provides session and
 * query context, and gates on auth + role.
 *
 * No orchestrated load sequence (operate.md): product loads into a task, and
 * users do not want to watch it arrive.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, I18nManager, Platform, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { focusManager } from '@tanstack/react-query';
import {
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { AppErrorBoundary } from '@/components/app-error-boundary';
import { PrimaryButton } from '@/components/primitives';
import { Notice, QuestionHeading } from '@/components/ui';
import { AccountQueryProvider } from '@/lib/account-query-provider';
import { t } from '@/i18n';
import { loadLanguage, restartPending } from '@/lib/language';
import { initMonitoring, reportError, wrapRoot } from '@/lib/monitoring';
import { Observe, ObserveRoot } from 'expo-observe';
import { SessionProvider, useSession } from '@/lib/session';
import { color, space } from '@/theme/tokens';
import { FONT_ASSETS } from '@/theme/faces';
// Side effect: defines the background location task. It must exist on every
// launch — including a headless one the OS starts to deliver a location.
import '@/lib/background-location';

// First, so a crash anywhere below — fonts, language, the gate — is reported.
initMonitoring();

SplashScreen.preventAutoHideAsync().catch(() => {});

// EAS Observe: startup (TTR/TTI) and per-route navigation timings. Module scope
// on purpose — integrations cannot be switched on after a screen mounts.
//
// Performance only: expo-observe 57.0.24 collects no errors — Sentry remains the
// crash reporter (src/lib/monitoring.ts).
//
// `filteredParams: ['id']`. Load, offer and trip screens carry their id in the
//   route; the route PATTERN (`/load/[id]`) is enough to bucket timings, so the
//   resolved URL and the id itself are never sent.
Observe.configure({
  integrations: { 'expo-router': { filteredParams: ['id'] } },
});

// RTL is structural from day one (CLAUDE.md). Allowing it here means every layout
// is exercised in both directions as soon as Arabic copy lands. The direction
// itself is decided by `loadLanguage()` below, which is the only caller of
// forceRTL — see src/lib/language.ts for why the two must stay paired.
//
// `allowRTL` must stay here and must stay first: `forceRTL` is ignored on a
// build that has not allowed RTL, which would leave the language switch
// silently doing nothing at all.
I18nManager.allowRTL(true);

/**
 * react-query's default "window focus" listener is a browser `focus` event —
 * it does not exist here, so `refetchOnWindowFocus: true` on a query (used by
 * `useCities`/`useTruckTypes` to recover from a failed fetch) would silently
 * never fire without this. `AppState` is the React Native equivalent: a
 * `background` → `active` transition is what "brought the app back" means on
 * a phone.
 */
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (status) => {
    focusManager.setFocused(status === 'active');
  });
}

export { AppErrorBoundary as ErrorBoundary };

// Sentry outermost, so it sees anything Observe's wrapper throws; ObserveRoot
// measures time to first render of the layout itself.
export default wrapRoot(ObserveRoot.wrap(RootLayout));

function RootLayout() {
  const [attempt, setAttempt] = useState(0);
  return <Startup key={attempt} retry={() => setAttempt((value) => value + 1)} />;
}

function Startup({ retry }: { retry: () => void }) {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const [languageReady, setLanguageReady] = useState(false);
  const [fontTimedOut, setFontTimedOut] = useState(false);
  const reportedFontFailure = useRef(false);

  // Before first render, not in a layout effect: a screen that renders
  // left-to-right and then flips is worse than one that waits. Fonts already
  // gate here, so the wait is free. Both arms resolve — a failure to read the
  // preference must not be a failure to start.
  useEffect(() => {
    loadLanguage().then(
      () => setLanguageReady(true),
      () => setLanguageReady(true),
    );
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) return;
    const timer = setTimeout(() => setFontTimedOut(true), 6_000);
    return () => clearTimeout(timer);
  }, [fontsLoaded, fontError]);

  // A timeout is a guess, not a verdict: fonts that arrive late still win.
  const fontFailed = !!fontError || (fontTimedOut && !fontsLoaded);

  useEffect(() => {
    if (!fontFailed || reportedFontFailure.current) return;
    reportedFontFailure.current = true;
    reportError(fontError ?? new Error('Bundled font load timed out'));
  }, [fontFailed, fontError]);

  useEffect(() => {
    if (languageReady && (fontsLoaded || fontFailed)) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontFailed, languageReady]);

  if (!languageReady) return null;
  if (fontFailed) {
    // Use system text on this emergency surface: the brand faces are the part
    // that failed to load. A button still lets the user retry in this session.
    return (
      <View style={styles.recovery}>
        <Text style={styles.fallbackTitle}>{t('common.error.title')}</Text>
        <Text style={styles.fallbackBody}>{t('common.error.explain')}</Text>
        <PrimaryButton label={t('common.retry')} onPress={retry} />
      </View>
    );
  }
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <AccountQueryProvider>
          <StatusBar style="dark" />
          <WrongDirection>
            <Gate />
          </WrongDirection>
        </AccountQueryProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/**
 * Says so when this launch is running in the wrong direction.
 *
 * `forceRTL` lands on the NEXT launch, and without `expo-updates` nothing can
 * relaunch for us — so a launch that booted mismatched stays mismatched. Before
 * this it did so silently: Arabic text in a left-to-right layout with no word of
 * why. Android launch 1 is fixed natively now (plugins/with-first-launch-
 * direction.js); this covers iOS launch 1 and a phone whose language changed
 * after install. See `restartPending` in src/lib/language.ts.
 *
 * A strip above every screen rather than a screen of its own: the app still
 * works mirrored, and a shipper must never meet a dead end (CLAUDE.md). The
 * screens below are handed insets with no top, because the strip has taken it.
 */
function WrongDirection({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  if (!restartPending()) return <>{children}</>;
  return (
    <View style={styles.column}>
      <View style={[styles.strip, { paddingTop: insets.top + space.sm }]} accessibilityRole="alert">
        <Notice icon="info">{t('app.direction.reopen')}</Notice>
      </View>
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <View style={styles.column}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

/**
 * The auth + role gate.
 *
 * Navigation convenience only — it decides which screens a user *sees*. It is
 * emphatically not authorization: every read and write is scoped by RLS at the
 * data layer (SECURITY.md §3), because hiding a route protects nothing.
 */
function Gate() {
  const { session, profile, loading, error, retry } = useSession();
  // Widened to `string[]` on purpose. `useSegments()` is typed from expo-router's
  // generated route union, which is regenerated on config changes — comparing
  // against it directly makes this gate fail to compile whenever routing changes
  // shape, for no safety we actually want here.
  const segments: string[] = useSegments();
  const router = useRouter();

  const group = segments[0];

  useEffect(() => {
    if (loading || error) return;

    const inAuth = group === '(auth)';

    // Screens an emailed link lands on. Each exchanges a one-time code and then
    // routes on its own; the Gate must not move them mid-exchange. A reset would
    // otherwise bounce to the user's loads with the password still unchanged,
    // and a confirmation would bounce to sign-in before the code was spent.
    //
    // `done` (N6) is the same kind of exemption: the profile exists by the time
    // it shows, and without this the Gate would snatch the user home before they
    // read "You are on" or tap the one next action it offers.
    if (segments.includes('reset') || segments.includes('confirm') || segments.includes('done')) {
      return;
    }

    if (!session) {
      if (!inAuth) router.replace('/welcome');
      return;
    }

    // Signed in but no profile row yet: the setup questions own finishing it.
    // That covers arriving from outside the auth group, and arriving at an
    // entry screen — a Google round trip lands back on the welcome, and an email
    // sign-up or sign-in lands on the password step, with a session either way.
    // Once on the setup questions themselves, the screens walk forward alone.
    if (!profile) {
      const atEntry =
        segments.includes('welcome') || segments.includes('email') || segments.includes('password') ||
        segments.includes('otp-phone') || segments.includes('otp-code');
      if (!inAuth || atEntry) router.replace('/role');
      return;
    }

    if (inAuth && profile.role === 'driver' && segments.includes('plate')) {
      // Profile refresh and the last signup step can complete in either order.
      // Both paths must open documents rather than racing to the home screen.
      router.replace('/verification' as Href);
      return;
    }

    if (inAuth) {
      // `/index.tsx` routes on role. Dispatch is web-only now (~/truckkoo-ops),
      // so a dispatcher signing in here lands on whichever surface their
      // profiles.role names — which is the intended behaviour, not a gap.
      router.replace('/');
    }
  }, [loading, error, session, profile, group, segments, router]);

  if (loading) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={color.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.recovery}>
        <QuestionHeading ground="cream" size="question">{t('common.error.title')}</QuestionHeading>
        <Notice icon="info">{t('common.error.explain')}</Notice>
        <PrimaryButton label={t('common.retry')} onPress={retry} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.creamCard },
        animation: 'fade',
      }}
    />
  );
}

const styles = StyleSheet.create({
  column: { flex: 1 },
  strip: {
    backgroundColor: color.ink,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.creamCard,
  },
  recovery: {
    flex: 1,
    justifyContent: 'center',
    gap: space.lg,
    paddingHorizontal: space.lg,
    backgroundColor: color.creamCard,
  },
  fallbackTitle: { fontSize: 28, color: color.ink },
  fallbackBody: { fontSize: 18, color: color.ink },
});

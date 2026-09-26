/**
 * App shell. Loads the brand faces, initialises direction, provides session and
 * query context, and gates on auth + role.
 *
 * No orchestrated load sequence (operate.md): product loads into a task, and
 * users do not want to watch it arrive.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, I18nManager, Platform, StyleSheet, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { Notice } from '@/components/ui';
import { t } from '@/i18n';
import { loadLanguage, restartPending } from '@/lib/language';
import { SessionProvider, useSession } from '@/lib/session';
import { color, space } from '@/theme/tokens';
import { FONT_ASSETS } from '@/theme/faces';

SplashScreen.preventAutoHideAsync().catch(() => {});

// RTL is structural from day one (CLAUDE.md). Allowing it here means every layout
// is exercised in both directions as soon as Arabic copy lands. The direction
// itself is decided by `loadLanguage()` below, which is the only caller of
// forceRTL — see src/lib/language.ts for why the two must stay paired.
//
// `allowRTL` must stay here and must stay first: `forceRTL` is ignored on a
// build that has not allowed RTL, which would leave the language switch
// silently doing nothing at all.
I18nManager.allowRTL(true);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Drivers are on patchy signal: retry, but do not hammer.
      retry: 2,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

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

export default function RootLayout() {
  const [fontsLoaded] = useFonts(FONT_ASSETS);
  const [languageReady, setLanguageReady] = useState(false);

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
    if (fontsLoaded && languageReady) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, languageReady]);

  if (!fontsLoaded || !languageReady) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="dark" />
          <WrongDirection>
            <Gate />
          </WrongDirection>
        </SessionProvider>
      </QueryClientProvider>
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
  const { session, profile, loading } = useSession();
  // Widened to `string[]` on purpose. `useSegments()` is typed from expo-router's
  // generated route union, which is regenerated on config changes — comparing
  // against it directly makes this gate fail to compile whenever routing changes
  // shape, for no safety we actually want here.
  const segments: string[] = useSegments();
  const router = useRouter();

  const group = segments[0];

  useEffect(() => {
    if (loading) return;

    const inAuth = group === '(auth)';

    // Screens an emailed link lands on. Each exchanges a one-time code and then
    // routes on its own; the Gate must not move them mid-exchange. A reset would
    // otherwise bounce to the user's loads with the password still unchanged,
    // and a confirmation would bounce to sign-in before the code was spent.
    if (segments.includes('reset') || segments.includes('confirm')) return;

    if (!session) {
      if (!inAuth) router.replace('/sign-in');
      return;
    }

    // Signed in but no profile row yet: signup owns finishing it.
    if (!profile) {
      if (!inAuth) router.replace('/sign-up');
      return;
    }

    if (inAuth) {
      // `/index.tsx` routes on role. Dispatch is web-only now (~/truckkoo-ops),
      // so a dispatcher signing in here lands on whichever surface their
      // profiles.role names — which is the intended behaviour, not a gap.
      router.replace('/');
    }
  }, [loading, session, profile, group, segments, router]);

  if (loading) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={color.accent} />
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
});

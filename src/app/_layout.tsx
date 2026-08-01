/**
 * App shell. Loads the brand faces, initialises direction, provides session and
 * query context, and gates on auth + role.
 *
 * No orchestrated load sequence (operate.md): product loads into a task, and
 * users do not want to watch it arrive.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, I18nManager, StyleSheet, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { loadLanguage } from '@/lib/language';
import { SessionProvider, useSession } from '@/lib/session';
import { color } from '@/theme/tokens';
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
          <Gate />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
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
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.creamCard,
  },
});

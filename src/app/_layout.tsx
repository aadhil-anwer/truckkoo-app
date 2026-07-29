/**
 * App shell. Loads the brand faces, initialises direction, provides session and
 * query context, and gates on auth + role.
 *
 * No orchestrated load sequence (operate.md): product loads into a task, and
 * users do not want to watch it arrive.
 */

import { useEffect } from 'react';
import { ActivityIndicator, I18nManager, StyleSheet, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initLanguage } from '@/i18n';
import { SessionProvider, useSession } from '@/lib/session';
import { color } from '@/theme/tokens';
import { FONT_ASSETS } from '@/theme/faces';

SplashScreen.preventAutoHideAsync().catch(() => {});

// RTL is structural from day one (CLAUDE.md). Allowing it here means every layout
// is exercised in both directions as soon as Arabic copy lands.
I18nManager.allowRTL(true);
initLanguage();

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

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

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
      // Dispatchers are routed by `/index.tsx`, which knows about ops. Sending
      // them through the role branch here would land them on the shipper screen.
      router.replace('/');
    }
  }, [loading, session, profile, group, segments, router]);

  if (loading) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={color.orange} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.paper },
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
    backgroundColor: color.paper,
  },
});

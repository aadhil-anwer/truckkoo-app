/**
 * The launch route.
 *
 * Every cold start, deep link to the bare scheme, and browser hit on `/` lands
 * here, and it exists only to hand off. Without it expo-router renders its
 * "Unmatched Route" page, which is what a user would see on first open.
 *
 * The Gate in `_layout.tsx` cannot cover this case: its last branch only
 * redirects users who are inside `(auth)`, so a signed-in user with a profile
 * would sit on `/` indefinitely. This route makes the same decision declaratively
 * — one `<Redirect>` per state, no effects, no flash of a screen the user is
 * about to be moved off.
 */

import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';

import { useAmIOps } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { color } from '@/theme/tokens';

export default function Index() {
  const { session, profile, loading } = useSession();
  // Asked once per session. A dispatcher also holds a shipper or driver profile —
  // ops membership is additional, not an alternative — so this has to be checked
  // before the role branch or staff would land on a customer screen.
  const ops = useAmIOps();

  // Nothing is known yet. Show the same quiet boot state as the Gate rather than
  // guessing at a destination and bouncing the user off it a frame later.
  if (loading || (!!session && ops.isPending)) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={color.orange} />
      </View>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;
  // Signed in but the profile row was never created: signup owns finishing it.
  if (!profile) return <Redirect href="/sign-up" />;

  // Navigation only. Every ops RPC re-checks membership in the database, so a
  // wrong answer here — or a forced route — reveals nothing.
  if (ops.data === true) return <Redirect href="/ops" />;

  return <Redirect href={profile.role === 'driver' ? '/driver' : '/customer'} />;
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.paper,
  },
});

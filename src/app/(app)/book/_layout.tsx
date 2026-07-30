/**
 * The booking stack.
 *
 * A linear six-step flow, then review. Back preserves every answer, because the
 * draft is the source of truth rather than screen state — see `src/lib/booking.ts`.
 */
import { Stack } from 'expo-router';

import { color } from '@/theme/tokens';

export default function BookLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Forward slides in from the trailing edge, which expo-router already
        // inverts under RTL — one of the few things that flips for free.
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: color.ink },
      }}
    />
  );
}

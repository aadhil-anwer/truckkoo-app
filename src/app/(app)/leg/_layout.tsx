/**
 * The declare-a-route stack.
 *
 * Two steps, in the same two shapes the shipper's booking uses — an ink map step
 * and a cream question. It stops at two because a driver declaring a leg is
 * doing it at a fuel stop with the engine running, and a third step here would
 * be one more than the task deserves.
 */
import { Stack } from 'expo-router';

import { color } from '@/theme/tokens';

export default function LegLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // expo-router already inverts this under RTL.
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: color.ink },
      }}
    />
  );
}

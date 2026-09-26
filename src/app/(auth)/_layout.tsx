/**
 * Getting in — N1 to N6.
 *
 * A linear stack, like booking: forward slides in from the trailing edge (which
 * expo-router inverts under RTL), back is the inverse. The ground is cream
 * because every step between the welcome and the finish is a question.
 */
import { Stack } from 'expo-router';

import { color } from '@/theme/tokens';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: color.cream },
      }}
    >
      {/* The two ink ends of the flow fade rather than slide: they are not steps. */}
      <Stack.Screen name="welcome" options={{ animation: 'fade', contentStyle: { backgroundColor: color.ink } }} />
      <Stack.Screen name="done" options={{ animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: color.ink } }} />
    </Stack>
  );
}

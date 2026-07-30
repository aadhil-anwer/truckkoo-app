import { Stack } from 'expo-router';

import { color } from '@/theme/tokens';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.creamCard },
      }}
    />
  );
}

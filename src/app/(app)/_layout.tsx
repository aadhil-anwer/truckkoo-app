import { Stack } from 'expo-router';

import { MapPlacesProvider } from '@/map';
import { LocationTrackingProvider } from '@/lib/location-tracking';
import { PushProvider } from '@/lib/push-provider';
import { useCities } from '@/lib/queries';
import { color } from '@/theme/tokens';

export default function AppLayout() {
  // Once, here: every map in the signed-in app names its towns from the same
  // cached `cities` rows, and the map module never fetches anything itself.
  const { data: cities } = useCities();
  return (
    <LocationTrackingProvider>
      <PushProvider>
      <MapPlacesProvider places={cities}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.creamCard },
          }}
        />
      </MapPlacesProvider>
      </PushProvider>
    </LocationTrackingProvider>
  );
}

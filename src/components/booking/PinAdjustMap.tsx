/**
 * The one real map in the product (0041, spec §6).
 *
 * Everywhere else the map is src/map: bundled geometry, fixed framings, about a
 * pixel a kilometre. Putting a pin on a gate needs streets and panning, so this
 * screen — and only this file, which tests/unit/map-import-guard enforces —
 * uses react-native-maps: Google on Android, Apple Maps on iOS for now.
 *
 * THE PIN IS FIXED; THE MAP MOVES. The shipper drags the world under a pin at
 * the centre, the Uber way, so the thumb never hides the point being chosen.
 * The pin is ink, not accent: this screen spends its accent on Confirm.
 */
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';

import { color } from '@/theme/tokens';

const CLOSE = 0.004; // roughly a few streets across

export function PinAdjustMap({
  initial,
  onSettle,
}: {
  initial: { lat: number; lng: number };
  onSettle: (p: { lat: number; lng: number }) => void;
}) {
  return (
    <View style={styles.fill}>
      <MapView
        testID="pin-map"
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{ latitude: initial.lat, longitude: initial.lng, latitudeDelta: CLOSE, longitudeDelta: CLOSE }}
        onRegionChangeComplete={(r) => onSettle({ lat: r.latitude, lng: r.longitude })}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsUserLocation={false}
      />
      <View pointerEvents="none" style={styles.centre}>
        <View testID="pin-centre" style={styles.head} />
        <View style={styles.stem} />
      </View>
    </View>
  );
}

const HEAD = 22;
const STEM = 14;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // The stem's foot sits on the exact centre of the map.
  centre: {
    position: 'absolute',
    top: '50%',
    insetInlineStart: '50%',
    marginTop: -(HEAD + STEM),
    marginInlineStart: -HEAD / 2,
    alignItems: 'center',
  },
  head: {
    width: HEAD,
    height: HEAD,
    borderRadius: HEAD / 2,
    backgroundColor: color.ink,
    borderWidth: 3,
    borderColor: color.lightText,
  },
  stem: { width: 3, height: STEM, backgroundColor: color.ink },
});

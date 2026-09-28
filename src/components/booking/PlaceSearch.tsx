/**
 * "Search a place" and "Use my current location" — the top of the pickup and
 * drop-off steps. The city list stays underneath, always: every failure here
 * (no signal, search down, permission refused) ends at a city, never at a wall.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { PressableSurface, TextField } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { Notice, Skeleton } from '@/components/ui';
import { align, t } from '@/i18n';
import { currentPlace, usePlaceSearch, type PickedPlace } from '@/lib/places';
import { safeText } from '@/lib/safe-text';
import { alpha, color, font, radius, space } from '@/theme/tokens';

export function PlaceSearch({ onPicked }: { onPicked: (p: PickedPlace) => void }) {
  const { query, setQuery, suggestions, status, pick } = usePlaceSearch();
  const [gpsRefused, setGpsRefused] = useState(false);
  const [locating, setLocating] = useState(false);

  async function useCurrent() {
    setLocating(true);
    const here = await currentPlace();
    setLocating(false);
    if (!here) {
      setGpsRefused(true);
      return;
    }
    onPicked(here);
  }

  return (
    <View style={styles.wrap}>
      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder={t('places.search.placeholder')}
        accessibilityLabel={t('places.search.placeholder')}
        leading={<Icon name="search" size={18} tint={color.mutedText} />}
        autoCorrect={false}
        returnKeyType="search"
        maxLength={100}
      />

      {!gpsRefused && query.trim().length === 0 && (
        <PressableSurface
          onPress={useCurrent}
          disabled={locating}
          accessibilityLabel={t('places.search.current')}
          style={styles.row}
        >
          <Icon name="dropoff" size={18} tint={color.lightText} />
          <Text style={styles.main}>{locating ? t('places.search.locating') : t('places.search.current')}</Text>
        </PressableSurface>
      )}

      {status === 'loading' && suggestions.length === 0 && (
        <View style={styles.list}>
          <Skeleton height={52} round={radius.row} />
          <Skeleton height={52} round={radius.row} />
        </View>
      )}

      {status === 'failed' && <Notice icon="info">{t('places.search.unavailable')}</Notice>}
      {status === 'ready' && suggestions.length === 0 && <Notice icon="info">{t('places.search.none')}</Notice>}

      {suggestions.length > 0 && (
        <View style={styles.list}>
          {suggestions.map((s) => (
            <PressableSurface
              key={s.placeId}
              onPress={async () => {
                const place = await pick(s);
                if (place) onPicked(place);
              }}
              accessibilityLabel={s.secondary ? `${s.main}, ${s.secondary}` : s.main}
              style={styles.row}
            >
              <View style={styles.text}>
                <Text style={styles.main} numberOfLines={1}>{safeText(s.main)}</Text>
                {!!s.secondary && (
                  <Text style={styles.secondary} numberOfLines={1}>{safeText(s.secondary)}</Text>
                )}
              </View>
            </PressableSurface>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  list: { gap: space.xs },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.row,
    backgroundColor: color.raised,
  },
  text: { flex: 1 },
  main: { ...arabicIfNeeded(font.body), color: color.lightText, textAlign: align.start },
  secondary: { ...arabicIfNeeded(font.caption), color: alpha.onInk.tertiary, textAlign: align.start },
});

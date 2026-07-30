/**
 * S4 / S10 · And where does it need to be?
 *
 * One screen, two framings. The handoff draws these as separate screens because
 * a static gallery cannot show state — but S10 is S4 with the map pulled back and
 * a country control, so it is one code path.
 *
 * The corridor draws as soon as both endpoints exist, and it is DASHED here:
 * nothing is committed until a driver takes it.
 */
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { MapStepShell } from '@/components/booking/shells';
import { CityList } from '@/components/booking/CityList';
import { PrimaryButton, PressableSurface } from '@/components/primitives';
import { Chip, Notice, QuestionHeading, RouteRail, SectionLabel } from '@/components/ui';
import { Icon } from '@/components/icon';
import { CityPin, Corridor, roadKm } from '@/map';
import { useBookingDraft } from '@/lib/booking';
import { cityIndex, useCities, useMyLoads } from '@/lib/queries';
import { align, formatNumber, t } from '@/i18n';
import { arabicIfNeeded } from '@/components/text-direction';
import { alpha, color, font, hairline, radius, space } from '@/theme/tokens';

const COUNTRIES = ['OM', 'AE', 'SA'] as const;

export default function Destination() {
  const router = useRouter();
  const { draft, update, ready } = useBookingDraft();
  const { data: cities } = useCities();
  const { data: myLoads } = useMyLoads();

  const index = cityIndex(cities);
  const origin = draft.originCityId != null ? index.get(draft.originCityId) : undefined;
  const dest = draft.destinationCityId != null ? index.get(draft.destinationCityId) : undefined;

  if (!ready) return null;

  // Domestic while everything is in Oman; the map pulls back the moment the
  // destination leaves the country. That is S10.
  const crossBorder = draft.destinationCountry !== 'OM';
  const framing = crossBorder ? 'regional' : 'domestic';

  const km = origin && dest ? roadKm(origin, dest) : null;
  const shown = (cities ?? []).filter((c) => c.country === draft.destinationCountry);

  // Where this shipper has actually sent things before, most recent first.
  // REAL history or nothing — a first-time shipper sees no row rather than
  // invented suggestions (CLAUDE.md #5). Excludes the current origin, since a
  // load cannot start and end in the same place.
  const recent = [...new Set((myLoads ?? []).map((l) => l.dest_city))]
    .filter((id) => id !== draft.originCityId)
    .map((id) => index.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .slice(0, 4);

  return (
    <MapStepShell
      step="destination"
      framing={framing}
      onBack={() => router.back()}
      overlay={() => (
        <>
          {origin && dest && (
            <Corridor
              from={{ lng: origin.lng, lat: origin.lat }}
              to={{ lng: dest.lng, lat: dest.lat }}
              committed={false}
            />
          )}
          {origin && (
            <CityPin at={{ lng: origin.lng, lat: origin.lat }} state="origin" label={origin.name_en} />
          )}
          {dest && (
            <CityPin at={{ lng: dest.lng, lat: dest.lat }} state="destination" label={dest.name_en} />
          )}
        </>
      )}
    >
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <QuestionHeading ground="ink" size="question">
          {t('book.dest.q')}
        </QuestionHeading>

        {origin && (
          <View style={styles.routeCard}>
            <RouteRail
              origin={origin.name_en}
              destination={dest?.name_en ?? t('book.dest.deliver')}
              compact
            />
            <PressableSurface
              onPress={() => {
                // Swapping is only meaningful once both ends exist.
                if (draft.originCityId == null || draft.destinationCityId == null) return;
                update({
                  originCityId: draft.destinationCityId,
                  destinationCityId: draft.originCityId,
                });
              }}
              accessibilityLabel={t('book.dest.swap')}
              style={styles.swap}
            >
              <Icon name="swap" size={17} tint={color.lightText} />
            </PressableSurface>
          </View>
        )}

        {km != null && (
          <Text style={styles.distance}>
            {`${t('book.about')} ${formatNumber(km)} km`}
          </Text>
        )}

        <View style={styles.segmented}>
          {COUNTRIES.map((c) => {
            const on = draft.destinationCountry === c;
            return (
              <PressableSurface
                key={c}
                onPress={() =>
                  // Changing country clears the destination: keeping a city from
                  // the previous country would leave a selection the list no
                  // longer shows.
                  update({ destinationCountry: c, destinationCityId: null })
                }
                accessibilityLabel={t(`country.${c}` as never)}
                style={[styles.segment, on && styles.segmentOn]}
              >
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                  {t(`country.${c}` as never)}
                </Text>
              </PressableSurface>
            );
          })}
        </View>

        {crossBorder && (
          <View style={styles.notice}>
            <Notice icon="info">{t('book.dest.border')}</Notice>
          </View>
        )}

        {recent.length > 0 && (
          <View style={styles.recent}>
            <SectionLabel>{t('book.dest.recent')}</SectionLabel>
            <View style={styles.recentChips}>
              {recent.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name_en}
                  selected={draft.destinationCityId === c.id}
                  onPress={() =>
                    // A recent destination may be in another country; follow it
                    // rather than leaving the list showing somewhere else.
                    update({
                      destinationCityId: c.id,
                      destinationCountry: c.country as 'OM' | 'AE' | 'SA',
                    })
                  }
                />
              ))}
            </View>
          </View>
        )}

        <View style={styles.list}>
          <CityList
            cities={shown}
            selectedId={draft.destinationCityId}
            onSelect={(c) => update({ destinationCityId: c.id })}
            excludeId={draft.originCityId}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={t('action.continue')}
          onPress={() => router.push('/book/date')}
          disabled={draft.destinationCityId == null}
        />
      </View>
    </MapStepShell>
  );
}

const styles = StyleSheet.create({
  routeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.lg,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: color.raised,
  },
  swap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  distance: {
    ...arabicIfNeeded(font.caption),
    color: alpha.onInk.tertiary,
    textAlign: align.start,
    marginTop: space.sm,
  },
  segmented: {
    flexDirection: 'row',
    gap: 4,
    padding: 5,
    marginTop: space.lg,
    borderRadius: radius.round,
    backgroundColor: color.raised,
  },
  segment: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.round,
  },
  segmentOn: { backgroundColor: color.lightText },
  segmentText: { ...font.caption, color: alpha.onInk.secondary },
  segmentTextOn: { color: color.inkText },
  notice: { marginTop: space.md },
  recent: { marginTop: space.lg, gap: space.sm },
  recentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  list: { marginTop: space.lg },
  footer: { paddingTop: space.md, backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: hairline.inner },
});

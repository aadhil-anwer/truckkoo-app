/**
 * D4 · Where are you driving?
 *
 * THE DRIVER'S QUESTION, NOT THE SHIPPER'S. The booking flow asks where the
 * cargo is; this asks where the truck is going. Same shape, opposite direction,
 * and the helper says what the answer buys: we only send you loads that sit on
 * this line.
 *
 * `YOU DRIVE THESE OFTEN` is built from the driver's own legs. A driver running
 * Muscat→Sohar three times a week should declare it in one tap, not by scrolling
 * 46 cities twice — and the corridors they already ran are the only honest source
 * for that list. Nothing is suggested until they have actually driven it.
 */

import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { CityList } from '@/components/booking/CityList';
import { MapStepShell } from '@/components/booking/shells';
import { PrimaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { Chip, QuestionHeading, SectionLabel } from '@/components/ui';
import { CityPin, Corridor } from '@/map';
import { align, directionArrow, localized, t } from '@/i18n';
import { getLegDraft, updateLegDraft } from '@/lib/leg-draft';
import { cityIndex, useCities, useMyLegs } from '@/lib/queries';
import { alpha, color, font, space } from '@/theme/tokens';
import { useState } from 'react';

export default function LegRoute() {
  const router = useRouter();
  const { data: cities } = useCities();
  const { data: legs } = useMyLegs();
  const [draft, setDraft] = useState(getLegDraft());

  const index = useMemo(() => cityIndex(cities), [cities]);

  function set(patch: Parameters<typeof updateLegDraft>[0]) {
    setDraft(updateLegDraft(patch));
  }

  const origin = draft.originCityId != null ? index.get(draft.originCityId) : undefined;
  const dest = draft.destCityId != null ? index.get(draft.destCityId) : undefined;

  /** Corridors this driver has actually declared before, newest first, deduped. */
  const often = useMemo(() => {
    const seen = new Set<string>();
    const out: { origin: number; dest: number; label: string }[] = [];
    for (const l of legs ?? []) {
      const key = `${l.origin_city}-${l.dest_city}`;
      if (seen.has(key)) continue;
      const o = index.get(l.origin_city);
      const d = index.get(l.dest_city);
      if (!o || !d) continue;
      seen.add(key);
      out.push({
        origin: o.id,
        dest: d.id,
        label: `${localized(o)} ${directionArrow()} ${localized(d)}`,
      });
    }
    return out.slice(0, 4);
  }, [legs, index]);

  // Which endpoint the list is answering. The map and the list agree on it, so
  // a driver who taps a pin and a driver who searches take the same path.
  const picking: 'origin' | 'dest' = draft.originCityId == null ? 'origin' : 'dest';

  return (
    <MapStepShell
      step={1}
      total={2}
      framing="domestic"
      onBack={() => router.back()}
      overlay={() => (
        <>
          {origin && dest && (
            // Uncommitted: the driver has not added the route yet.
            <Corridor
              from={{ lng: origin.lng, lat: origin.lat }}
              to={{ lng: dest.lng, lat: dest.lat }}
            />
          )}
          {(cities ?? []).map((c) => (
            <CityPin
              key={c.id}
              at={{ lng: c.lng, lat: c.lat }}
              state={
                c.id === draft.originCityId
                  ? 'origin'
                  : c.id === draft.destCityId
                    ? 'destination'
                    : 'idle'
              }
              label={c.name_en}
              onPress={() =>
                set(picking === 'origin' ? { originCityId: c.id } : { destCityId: c.id })
              }
            />
          ))}
        </>
      )}
    >
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <QuestionHeading ground="ink" size="question">
          {t('drv.route.q')}
        </QuestionHeading>
        <Text style={styles.help}>{t('drv.route.help')}</Text>

        {often.length > 0 && (
          <View style={styles.often}>
            <SectionLabel>{t('drv.route.often')}</SectionLabel>
            <View style={styles.chips}>
              {often.map((c) => (
                <Chip
                  key={`${c.origin}-${c.dest}`}
                  label={c.label}
                  selected={draft.originCityId === c.origin && draft.destCityId === c.dest}
                  onPress={() => set({ originCityId: c.origin, destCityId: c.dest })}
                />
              ))}
            </View>
          </View>
        )}

        <View style={styles.list}>
          <SectionLabel>
            {picking === 'origin' ? t('drv.route.from') : t('drv.route.to')}
          </SectionLabel>
          <CityList
            cities={cities ?? []}
            selectedId={picking === 'origin' ? draft.originCityId : draft.destCityId}
            onSelect={(c) =>
              set(picking === 'origin' ? { originCityId: c.id } : { destCityId: c.id })
            }
            excludeId={picking === 'origin' ? draft.destCityId : draft.originCityId}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={
            origin && dest
              ? `${localized(origin)} ${directionArrow()} ${localized(dest)}`
              : t('action.continue')
          }
          onPress={() => router.push('/leg/when')}
          disabled={draft.originCityId == null || draft.destCityId == null}
        />
      </View>
    </MapStepShell>
  );
}

const styles = StyleSheet.create({
  help: {
    ...arabicIfNeeded(font.body),
    color: alpha.onInk.body,
    textAlign: align.start,
    marginTop: space.xs,
  },
  often: { marginTop: space.lg, gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  list: { marginTop: space.lg, gap: space.sm },
  footer: { paddingTop: space.md, backgroundColor: color.surface },
});

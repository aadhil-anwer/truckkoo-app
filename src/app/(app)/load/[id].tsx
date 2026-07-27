/**
 * A finished load, as a completed consignment note.
 *
 * WHY THIS SCREEN EXISTS
 *
 * `LIVE` on the shipper home excludes `delivered`, so the moment a job completed
 * its sheet stopped rendering — and with it the proof-of-delivery photo, the
 * driver's name and verified stamp, the truck and plate, and the price. All of it
 * became unreachable in the same frame, and `usePodUrl` was effectively dead code
 * in the shipper's half of the app.
 *
 * That is the wrong artefact to lose. Settlement is offline (PRODUCT.md), so the
 * delivery record is what closes an invoice, settles a dispute, and satisfies a
 * cross-border paper trail. `trip.deliver.explain` promises the driver "This is
 * your proof" — and until now the person it proves anything to could not see it.
 *
 * WHY A NOTE RATHER THAN A DETAIL SCREEN
 *
 * A finished load already *is* a completed consignment note: reference, route,
 * carrier, plate, timestamps, signature-in-the-form-of-a-photograph, amount. The
 * document metaphor the rest of the app borrows for live work is literally true
 * here, so this screen stops borrowing and just is one. It is also the end of the
 * shipper's journey, and peak-end says the last thing the product says about a
 * completed job should not be a grey row in a list.
 *
 * Read-only by construction. Nothing on this screen mutates anything; the only
 * actions are going back and asking a human about it.
 */

import { useMemo } from 'react';
import { ActivityIndicator, Image, Linking, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlankNote, FactRow, NoteBody, NoteFoot, RoutePair } from '@/components/consignment';
import { Masthead } from '@/components/masthead';
import { Body, Button, Note, NoteHead, Rule, Stamp, TextButton } from '@/components/primitives';
import { align, getLanguage, localized, t, type StringKey } from '@/i18n';
import { formatDeadline, formatWeight, formatWindow, reference } from '@/lib/format';
import { formatMoney, type Currency } from '@/lib/money';
import { safeText, whatsappLink } from '@/lib/safe-text';
import {
  cityIndex,
  useCities,
  useMyLoads,
  useMyTrips,
  usePodUrl,
  useTripCounterpart,
  useTripEvents,
  useTripTruck,
  useTruckTypes,
  type LoadStatus,
} from '@/lib/queries';
import { color, doc, font, space, type StampTone } from '@/theme/tokens';

/** Same mapping as the home screen, so a status never changes colour between screens. */
const TONE: Record<LoadStatus, StampTone> = {
  posted: 'pending',
  finding_truck: 'active',
  matched: 'active',
  assigned: 'active',
  in_transit: 'active',
  delivered: 'done',
  closed: 'done',
  cancelled: 'stopped',
};

export default function CompletedNote() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const cities = useCities();
  const truckTypes = useTruckTypes();
  const loads = useMyLoads();
  const trips = useMyTrips();

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const cityName = (cid: number) => {
    const c = index.get(cid);
    return c ? localized(c) : '—';
  };

  const truckName = useMemo(() => {
    const m = new Map<string, string>();
    for (const tt of truckTypes.data ?? []) {
      m.set(tt.code, localized({ name_en: tt.name_en, name_ar: tt.name_ar }));
    }
    return m;
  }, [truckTypes.data]);

  // RLS already restricts `loads` to this shipper's own rows, so finding it in
  // the list is the whole authorisation check — there is no id here that could
  // reach someone else's load.
  const load = (loads.data ?? []).find((l) => l.id === id);
  const trip = (trips.data ?? []).find((tr) => tr.load_id === id);

  const counterpart = useTripCounterpart(trip?.id);
  const truck = useTripTruck(trip?.id);
  const events = useTripEvents(trip?.id);

  const proof = (events.data ?? []).find((e) => e.photo_path)?.photo_path ?? null;

  if (loads.isPending) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.center} accessibilityLiveRegion="polite">
          <ActivityIndicator color={color.orange} accessibilityLabel={t('common.loading')} />
        </View>
      </SafeAreaView>
    );
  }

  // Not found and not-yours are the same thing here, exactly as they are in the
  // database (SECURITY.md §3): the row simply is not in this shipper's list.
  if (!load) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Masthead
          title={t('note.title')}
          action={<TextButton label={t('common.back')} onPress={() => router.back()} />}
        />
        <View style={styles.block}>
          <BlankNote title={t('note.missing.title')} explain={t('note.missing.explain')} />
        </View>
      </SafeAreaView>
    );
  }

  const driver = counterpart.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Masthead
        title={t('note.title')}
        action={<TextButton label={t('common.back')} onPress={() => router.back()} />}
      />

      <View style={styles.block}>
        <Note>
          <NoteHead
            left={t('label.load')}
            right={<Stamp tone={TONE[load.status]}>{t(`status.${load.status}` as StringKey)}</Stamp>}
          />

          <NoteBody>
            <RoutePair
              from={cityName(load.origin_city)}
              to={cityName(load.dest_city)}
              labelFrom={t('label.from')}
              labelTo={t('label.to')}
            />

            <Body>{safeText(load.goods_description)}</Body>

            <FactRow
              facts={[
                { label: t('label.pickup'), value: formatWindow(load.pickup_from, load.pickup_to) },
                {
                  label: t('label.truck'),
                  value: load.truck_type_code
                    ? (truckName.get(load.truck_type_code) ?? load.truck_type_code)
                    : t('truck.unset'),
                },
                { label: t('label.weight'), value: formatWeight(load.weight_kg, t('weight.unset')) },
              ]}
            />
          </NoteBody>

          {/* Who carried it. On a completed note this is the record of the
              operator promise being kept, not a contact card — so the verified
              stamp stays and the "message the driver" action does not. */}
          {!!driver && (
            <>
              <Rule />
              <NoteBody gap={space.sm}>
                <View style={styles.head}>
                  <Text style={styles.blockLabel}>{t('note.carrier').toUpperCase()}</Text>
                  {truck.data?.is_verified && <Stamp tone="done">{t('cust.driver.verified')}</Stamp>}
                </View>

                <Text style={styles.name}>{safeText(driver.full_name)}</Text>

                {!!truck.data && (
                  <FactRow
                    facts={[
                      {
                        label: t('label.truck'),
                        value: truckName.get(truck.data.truck_type) ?? truck.data.truck_type,
                      },
                      ...(truck.data.plate
                        ? [{ label: t('label.plate'), value: safeText(truck.data.plate) }]
                        : []),
                    ]}
                  />
                )}
              </NoteBody>
            </>
          )}

          {/* The trail, as dated lines rather than a progress metaphor. These are
              the timestamps an invoice is reconciled against. */}
          {(events.data ?? []).length > 0 && (
            <>
              <Rule />
              <NoteBody gap={space.sm}>
                <Text style={styles.blockLabel}>{t('cust.progress.title').toUpperCase()}</Text>
                {(events.data ?? []).map((e) => (
                  <View key={e.id} style={styles.stampLine}>
                    <Text style={styles.stampWhat}>{t(`event.${e.type}` as StringKey)}</Text>
                    <Text style={styles.stampWhen}>{formatDeadline(e.occurred_at)}</Text>
                  </View>
                ))}
              </NoteBody>
            </>
          )}

          {!!proof && <Proof path={proof} />}

          {/* The amount, last, where the total sits on a real note. */}
          {load.price_baisa != null && (
            <>
              <Rule />
              <NoteBody gap={4}>
                <Text style={styles.blockLabel}>{t('price.title').toUpperCase()}</Text>
                <Text style={styles.amount}>
                  {formatMoney(load.price_baisa, load.currency as Currency, getLanguage())}
                </Text>
                <Body muted>{t('price.settle')}</Body>
              </NoteBody>
            </>
          )}

          <NoteFoot reference={reference(load.id)} />
        </Note>

        {/* The only action on a finished note. Not "message your driver" — the
            job is over and the relationship is with Truckkoo. */}
        <View style={styles.action}>
          <Button
            label={t('note.query')}
            variant="secondary"
            onPress={() => {
              Linking.openURL(
                whatsappLink(`${t('label.reference')} ${reference(load.id)}`),
              ).catch(() => {});
            }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

/** Proof of delivery, behind a short-lived signed URL. */
function Proof({ path }: { path: string }) {
  const url = usePodUrl(path);
  if (!url.data) return null;

  return (
    <>
      <Rule />
      <NoteBody gap={space.sm}>
        <Text style={styles.blockLabel}>{t('cust.pod.title').toUpperCase()}</Text>
        <Image
          source={{ uri: url.data }}
          style={styles.proof}
          accessibilityRole="image"
          accessibilityLabel={t('note.pod.alt')}
        />
      </NoteBody>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  block: { paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.md },

  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  blockLabel: { ...doc.fieldLabel, color: color.inkSoft, textAlign: align.start },
  name: { ...font.cardTitle, color: color.ink, textAlign: align.start },

  // A ruled line per milestone: what happened, and when. Reads as a stamped
  // record rather than a timeline widget.
  stampLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
  stampWhat: { ...font.label, color: color.ink, textAlign: align.start, flexShrink: 1 },
  stampWhen: { ...font.smallPrint, color: color.inkSoft, textAlign: align.end },

  amount: { ...font.title, color: color.ink, textAlign: align.start },

  proof: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 10,
    borderWidth: doc.rule,
    borderColor: color.line,
    backgroundColor: color.paperDeep,
  },

  action: { paddingTop: space.xs },
});

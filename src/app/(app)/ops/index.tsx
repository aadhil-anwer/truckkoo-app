/**
 * Dispatch queue — Truckkoo's own desk.
 *
 * The one surface in the app allowed to be dense. Every other screen is built for
 * someone with near-zero tech skills doing one thing; this is built for an
 * operator triaging a list, so it is a ruled ledger rather than a book of sheets:
 * oldest first, whole rows tappable, no chrome between the dispatcher and the work.
 *
 * Two sections, because they are two different jobs. "Needs a decision" is a load
 * nobody has acted on. "Offer out" is waiting on a driver, and the dispatcher's job
 * there is to notice when it has waited too long.
 *
 * Every read here goes through `ops_queue()`, which checks ops membership in the
 * database. This screen is navigation, not authorization — a driver who forced
 * their way to this route would see the RPC raise "not found".
 */

import { useMemo } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlankNote, LedgerRow } from '@/components/consignment';
import { Masthead } from '@/components/masthead';
import { Body, Button, Note, NoteHead, Stamp, TextButton } from '@/components/primitives';
import { align, directionArrow, localized, t } from '@/i18n';
import { signOut } from '@/lib/auth';
import { formatWindow } from '@/lib/format';
import {
  cityIndex,
  useCities,
  useOpsQueue,
  useSweepExpiredOffers,
  type OpsQueueRow,
} from '@/lib/queries';
import { color, doc, font, space } from '@/theme/tokens';

export default function OpsQueue() {
  const router = useRouter();
  const cities = useCities();
  const queue = useOpsQueue();
  const sweep = useSweepExpiredOffers();

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const cityName = (id: number) => {
    const c = index.get(id);
    return c ? localized(c) : '—';
  };

  const rows = queue.data ?? [];
  // A load with no offer out is untouched work. One with an offer is waiting on a
  // driver. Splitting them is the difference between a to-do list and a log.
  const awaiting = rows.filter((r) => r.offer_count === 0);
  const working = rows.filter((r) => r.offer_count > 0);

  const row = (r: OpsQueueRow, last: boolean) => (
    <LedgerRow
      key={r.load_id}
      route={`${cityName(r.origin_city)} ${directionArrow()} ${cityName(r.dest_city)}`}
      meta={`${formatWindow(r.pickup_from, r.pickup_to)} · ${r.goods}`}
      trailing={
        r.offer_count > 0 ? (
          <Stamp tone="active">{`${r.offer_count}`}</Stamp>
        ) : (
          <Stamp tone="pending">{t('ops.posted')}</Stamp>
        )
      }
      last={last}
      onPress={() => router.push(`/ops/${r.load_id}`)}
    />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Masthead
        title={t('ops.masthead')}
        action={<TextButton label={t('auth.signOut')} tone="muted" onPress={signOut} />}
      />

      {queue.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={color.orange} />
        </View>
      ) : queue.isError ? (
        <View style={styles.block}>
          <BlankNote title={t('common.error.title')} explain={t('common.error.explain')}>
            <View style={styles.blankAction}>
              <Button
                label={t('common.retry')}
                variant="secondary"
                onPress={() => {
                  queue.refetch();
                }}
              />
            </View>
          </BlankNote>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={queue.isRefetching}
              onRefresh={() => {
                queue.refetch();
              }}
              tintColor={color.orange}
            />
          }
        >
          {rows.length === 0 ? (
            <View style={styles.block}>
              <BlankNote
                title={t('ops.queue.empty.title')}
                explain={t('ops.queue.empty.explain')}
              />
            </View>
          ) : (
            <>
              {awaiting.length > 0 && (
                <View style={styles.block}>
                  <Note>
                    <NoteHead
                      left={t('ops.queue.awaiting')}
                      right={<Stamp tone="pending">{`${awaiting.length}`}</Stamp>}
                    />
                    {awaiting.map((r, i) => row(r, i === awaiting.length - 1))}
                  </Note>
                </View>
              )}

              {working.length > 0 && (
                <View style={styles.block}>
                  <Text style={styles.sectionLabel}>{t('ops.queue.working').toUpperCase()}</Text>
                  <Note>
                    {working.map((r, i) => row(r, i === working.length - 1))}
                  </Note>
                  {/* Offers expire lazily — nothing moves a `pending` offer to
                      `expired` except the driver answering it, which for an offer
                      they are ignoring never happens. Without this, a load whose
                      offers all timed out sits under "Offer out" forever, looking
                      worked-on. Pulled rather than scheduled: pg_cron is not
                      enabled, and a sweeper that silently stops is worse. */}
                  <View style={styles.blankAction}>
                    <Button
                      label={t('ops.sweep')}
                      variant="quiet"
                      loading={sweep.isPending}
                      onPress={() => sweep.mutate()}
                    />
                    {sweep.isSuccess && <Body muted>{t('ops.sweep.done')}</Body>}
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper },
  scroll: { paddingBottom: space.huge },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  block: { paddingHorizontal: space.xl, paddingTop: space.xl },
  blankAction: { alignSelf: 'stretch', paddingTop: space.sm },
  sectionLabel: {
    ...doc.fieldLabel,
    ...font.label,
    fontSize: 11,
    letterSpacing: 2,
    color: color.inkSoft,
    paddingBottom: space.sm,
    textAlign: align.start,
  },
});

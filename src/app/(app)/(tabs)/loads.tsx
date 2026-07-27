/**
 * Every load this shipper has ever posted, moving and finished.
 *
 * Home shows at most two live loads because home is about the *next* one. This
 * is the ledger: everything, segmented, in one scroll. Settlement is offline, so
 * the finished half is not an archive nobody visits — it is what an invoice gets
 * reconciled against, and it has to be as reachable as the live half.
 *
 * A segmented control rather than two tabs, because these are two views of one
 * list. `Choice` rows are for answering a question; this is not one.
 */

import { useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Stamp } from '@/components/primitives';
import { EmptyState, ListRow, PageTitle, RowGroup, Screen, Segmented } from '@/components/ui';
import { directionArrow, localized, t, type StringKey } from '@/i18n';
import { formatWindow } from '@/lib/format';
import { cityIndex, useCities, useMyLoads, useTruckTypes } from '@/lib/queries';
import { color, GUTTER, space } from '@/theme/tokens';

import { LIVE, LoadCard, TONE } from './customer';

type LoadView = 'live' | 'past';

export default function LoadsTab() {
  const router = useRouter();
  const cities = useCities();
  const truckTypes = useTruckTypes();
  const loads = useMyLoads();
  const [view, setView] = useState<LoadView>('live');

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const cityName = (id: number) => {
    const c = index.get(id);
    return c ? localized(c) : '—';
  };

  const truckName = useMemo(() => {
    const m = new Map<string, string>();
    for (const tt of truckTypes.data ?? []) {
      m.set(tt.code, localized({ name_en: tt.name_en, name_ar: tt.name_ar }));
    }
    return m;
  }, [truckTypes.data]);

  const all = loads.data ?? [];
  const active = all.filter((l) => LIVE.includes(l.status));
  const past = all.filter((l) => !LIVE.includes(l.status));
  const shown = view === 'live' ? active : past;

  return (
    <Screen>
      <PageTitle>{t('loads.title')}</PageTitle>

      <Segmented
        value={view}
        onChange={(v) => setView(v as LoadView)}
        options={[
          { value: 'live', label: t('loads.seg.live'), count: active.length },
          { value: 'past', label: t('loads.seg.past'), count: past.length },
        ]}
      />

      {loads.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={color.orange} accessibilityLabel={t('common.loading')} />
        </View>
      ) : loads.isError ? (
        <EmptyState icon="alert" title={t('common.error.title')} explain={t('common.error.explain')}>
          <View style={styles.emptyAction}>
            <Button
              label={t('common.retry')}
              variant="secondary"
              onPress={() => {
                loads.refetch();
              }}
            />
          </View>
        </EmptyState>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={loads.isRefetching}
              onRefresh={() => {
                loads.refetch();
              }}
              tintColor={color.orange}
            />
          }
        >
          {shown.length === 0 ? (
            <EmptyState
              icon={view === 'live' ? 'truck' : 'loads'}
              title={view === 'live' ? t('cust.empty.title') : t('cust.record.none.title')}
              explain={view === 'live' ? t('cust.empty.explain') : t('cust.record.none.explain')}
            >
              {view === 'live' && (
                <View style={styles.emptyAction}>
                  <Button label={t('cust.empty.action')} onPress={() => router.push('/post-load')} />
                </View>
              )}
            </EmptyState>
          ) : view === 'live' ? (
            // A moving load gets a card: the route is the thing being tracked,
            // so it is drawn rather than summarised.
            <View style={styles.cards}>
              {shown.map((load) => (
                <LoadCard
                  key={load.id}
                  load={load}
                  cityName={cityName}
                  truckName={truckName}
                  onPress={() => router.push(`/load/${load.id}`)}
                />
              ))}
            </View>
          ) : (
            // A finished one gets a row. It is a record being scanned for a
            // particular job, not a journey being followed.
            <View style={styles.group}>
              <RowGroup>
                {shown.map((l, i) => (
                  <ListRow
                    key={l.id}
                    icon="loads"
                    // Never a hardcoded arrow: it points the wrong way in Arabic.
                    title={`${cityName(l.origin_city)} ${directionArrow()} ${cityName(l.dest_city)}`}
                    subtitle={formatWindow(l.pickup_from, l.pickup_to)}
                    trailing={<Stamp tone={TONE[l.status]}>{t(`status.${l.status}` as StringKey)}</Stamp>}
                    last={i === shown.length - 1}
                    onPress={() => router.push(`/load/${l.id}`)}
                  />
                ))}
              </RowGroup>
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: space.lg, paddingBottom: space.xxxl },
  center: { paddingVertical: space.huge, alignItems: 'center' },
  emptyAction: { alignSelf: 'stretch', paddingTop: space.md, paddingHorizontal: space.xl },
  cards: { paddingHorizontal: GUTTER, gap: space.md },
  group: { paddingHorizontal: GUTTER },
});

/**
 * The routes a driver has declared.
 *
 * This tab is last and it is the one the business depends on. Nothing is offered
 * to a driver who has declared nothing, so an empty list here is an empty truck —
 * and the empty state says exactly that rather than reporting an absence.
 *
 * Declaring a route is the pinned action whether the list is empty or full,
 * because the habit is the product (PRODUCT.md).
 */

import { useMemo } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/ui';
import { directionArrow, localized, t } from '@/i18n';
import { formatWindow } from '@/lib/format';
import { cityIndex, useCities, useMyLegs } from '@/lib/queries';
import { GUTTER_INK, color, space } from '@/theme/tokens';
import { ActionBar, Button, EmptyState, ListRow, PageTitle, RowGroup, Stamp } from '@/components/legacy';

export default function RoutesTab() {
  const router = useRouter();
  const cities = useCities();
  const legs = useMyLegs();

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const cityName = (id: number) => {
    const c = index.get(id);
    return c ? localized(c) : '—';
  };

  const open = (legs.data ?? []).filter((l) => l.status === 'open');

  return (
    <Screen>
      <PageTitle detail={t('routes.hint')}>{t('routes.title')}</PageTitle>

      {legs.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={color.accent} accessibilityLabel={t('common.loading')} />
        </View>
      ) : legs.isError ? (
        <EmptyState icon="alert" title={t('common.error.title')} explain={t('common.error.explain')}>
          <View style={styles.emptyAction}>
            <Button
              label={t('common.retry')}
              variant="secondary"
              onPress={() => {
                legs.refetch();
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
              refreshing={legs.isRefetching}
              onRefresh={() => {
                legs.refetch();
              }}
              tintColor={color.accent}
            />
          }
        >
          {open.length === 0 ? (
            <EmptyState
              icon="routes"
              title={t('driver.routes.none.title')}
              explain={t('driver.routes.none.explain')}
            />
          ) : (
            <RowGroup>
              {open.map((leg, i) => (
                <ListRow
                  key={leg.id}
                  icon="truck"
                  tone={leg.is_empty ? 'orange' : 'neutral'}
                  // Never a hardcoded arrow: it points the wrong way in Arabic.
                  title={`${cityName(leg.origin_city)} ${directionArrow()} ${cityName(leg.dest_city)}`}
                  subtitle={formatWindow(leg.depart_from, leg.depart_to)}
                  trailing={
                    <Stamp tone={leg.is_empty ? 'active' : 'pending'}>
                      {leg.is_empty ? t('leg.stamp.empty') : t('leg.stamp.part')}
                    </Stamp>
                  }
                  last={i === open.length - 1}
                />
              ))}
            </RowGroup>
          )}
        </ScrollView>
      )}

      <ActionBar>
        <Button label={t('driver.postLeg')} icon="plus" onPress={() => router.push('/leg/route')} />
      </ActionBar>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: GUTTER_INK, paddingBottom: space.xxxl },
  center: { paddingVertical: space.huge, alignItems: 'center' },
  emptyAction: { alignSelf: 'stretch', paddingTop: space.md, paddingHorizontal: space.xl },
});

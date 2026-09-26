/**
 * D6 · The routes a driver has declared.
 *
 * This tab is last and it is the one the business depends on. Nothing is offered
 * to a driver who has declared nothing, so an empty list here is an empty truck —
 * and the closing notice says exactly that rather than reporting an absence.
 *
 * `EMPTY` TAKES THE ACCENT. It is the live, actionable state: a whole truck is
 * available and every load in the country could sit on it. `PART LOADED` is
 * neutral because it is a constraint, not an opportunity. That is the one accent
 * on this screen, which is why the "add a route" button is the other — and why
 * they never appear in the same eyeline.
 *
 * No map. A list of five corridors drawn at once orients nobody, and the driver
 * already knows where these roads go.
 */

import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableSurface, PrimaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { Notice, QuestionHeading, RouteRail, SectionLabel, Skeleton, StatusPill } from '@/components/ui';
import { align, localized, t } from '@/i18n';
import { formatWeight, formatWindow } from '@/lib/format';
import { cityIndex, useCities, useMyLegs } from '@/lib/queries';
import { useAnnounceOnError } from '@/lib/use-announce-error';
import {
  GUTTER_INK,
  TABBAR_CLEARANCE_3,
  alpha,
  color,
  font,
  hairline,
  radius,
  space,
} from '@/theme/tokens';

export default function RoutesTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cities = useCities();
  const legs = useMyLegs();

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const cityName = (id: number) => {
    const c = index.get(id);
    return c ? localized(c) : '—';
  };

  const open = (legs.data ?? []).filter((l) => l.status === 'open');
  useAnnounceOnError(legs.isError, t('common.error.title'));

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + space.lg, paddingBottom: TABBAR_CLEARANCE_3 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={legs.isRefetching}
            onRefresh={() => {
              legs.refetch();
              cities.refetch();
            }}
            tintColor={color.lightText}
          />
        }
      >
        <View style={styles.head}>
          <Text style={styles.title}>{t('drv.routes.title')}</Text>
          <Text style={styles.sub}>{t('drv.routes.sub')}</Text>
        </View>

        {legs.isPending && (
          <View style={styles.skeletons}>
            <Skeleton height={110} round={radius.card} />
            <Skeleton height={110} round={radius.card} />
          </View>
        )}

        {legs.isError && (
          <PressableSurface
            onPress={() => {
              legs.refetch();
            }}
            accessibilityLabel={t('common.error.aria')}
            style={styles.retry}
          >
            <Text style={styles.retryText}>{t('common.error.title')}</Text>
            <Text style={styles.retryAction}>{t('common.retry')}</Text>
          </PressableSurface>
        )}

        {!legs.isPending && !legs.isError && open.length === 0 && (
          <View style={styles.empty}>
            <QuestionHeading ground="ink" size="question">
              {t('drv.none.title')}
            </QuestionHeading>
            <Text style={styles.body}>{t('drv.none.body')}</Text>
          </View>
        )}

        {open.map((leg) => (
          <View key={leg.id} style={styles.card}>
            <View style={styles.cardHead}>
              <SectionLabel>{formatWindow(leg.depart_from, leg.depart_to)}</SectionLabel>
              <StatusPill
                label={leg.is_empty ? t('drv.routes.empty') : t('drv.routes.part')}
                // The accent belongs to the state that can still be filled.
                tone={leg.is_empty ? 'accent' : 'neutral'}
              />
            </View>

            <RouteRail
              origin={cityName(leg.origin_city)}
              destination={cityName(leg.dest_city)}
              compact
              labelled={false}
            />

            {/* Only when the driver actually said. NULL is "did not say", and a
                guess here would be a number they never gave us. */}
            {!leg.is_empty && leg.free_kg != null && (
              <Text style={styles.free}>
                {t('drv.offer.freeAfter', { weight: formatWeight(leg.free_kg, '') })}
              </Text>
            )}
          </View>
        ))}

        {/* The closing argument, and then the habit it argues for. */}
        {!legs.isPending && !legs.isError && (
          <>
            {open.length > 0 && <Notice icon="routes">{t('drv.routes.notice')}</Notice>}
            <View style={styles.add}>
              <PrimaryButton
                label={t('drv.none.add')}
                icon="plus"
                onPress={() => router.push('/leg/route')}
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  scroll: { paddingHorizontal: GUTTER_INK, gap: space.lg },

  head: { gap: 2 },
  title: { ...arabicIfNeeded(font.statement), color: color.lightText, textAlign: align.start },
  sub: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.secondary, textAlign: align.start },

  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: hairline.card,
    padding: space.lg,
    gap: space.md,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  free: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.secondary, textAlign: align.start },

  empty: { gap: space.sm, marginTop: space.xl, maxWidth: 320 },
  body: { ...arabicIfNeeded(font.body), color: alpha.onInk.body, textAlign: align.start },

  skeletons: { gap: space.lg },
  add: { marginTop: space.md },

  retry: {
    padding: space.lg,
    borderRadius: radius.row,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: hairline.card,
    gap: 2,
  },
  retryText: { ...arabicIfNeeded(font.body), color: color.lightText, textAlign: align.start },
  retryAction: { ...font.caption, color: color.accentLight, textAlign: align.start },
});

/**
 * Shipper home.
 *
 * One question fills the screen — *where to?* — and everything else is either
 * the answer to a previous asking of it or a shortcut to asking it again. That
 * is Uber's home screen, and freight is the same shape: a person with something
 * that needs to be somewhere else.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * The old home was a horizontal book of sheets with a tab strip: one full-width
 * "consignment note" per load, turned by swiping. It was carefully made and it
 * was the wrong shape for the audience. A user with near-zero tech skills has no
 * prior for a horizontal pager, so the second load did not exist to them; and a
 * finished load had no detail screen at all, so the delivery photo and the price
 * vanished the moment the truck arrived.
 *
 * Now: a vertical list of cards, each one tappable through to a real detail
 * screen. Nothing is behind a gesture. The detail lives in `load/[id]`, which is
 * the same screen whether the load is moving or finished — a shipper should not
 * have to learn two.
 *
 * The sheet carries no orange. A shipper has nothing to do while a load is
 * moving, and inventing a button to fill the space would be a lie about where
 * the work is; the one orange stays on the entry field. `finding_truck` is the
 * exception and it lives on the detail screen, where the human backstop is.
 */

import { useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/icon';
import { Button, Stamp } from '@/components/primitives';
import {
  EmptyState,
  FactChips,
  ListRow,
  PageTitle,
  RouteLine,
  RowGroup,
  Screen,
  Section,
} from '@/components/ui';
import { align, directionArrow, getLanguage, localized, t, type StringKey } from '@/i18n';
import { formatWindow } from '@/lib/format';
import { formatMoney, type Currency } from '@/lib/money';
import { safeText } from '@/lib/safe-text';
import {
  cityIndex,
  useCities,
  useMyLoads,
  useTruckTypes,
  type Load,
  type LoadStatus,
} from '@/lib/queries';
import { useSession } from '@/lib/session';
import { color, elevation, font, GUTTER, radius, space, type StampTone } from '@/theme/tokens';

/** Status → tone. Kept in one place so no screen invents its own mapping. */
export const TONE: Record<LoadStatus, StampTone> = {
  posted: 'pending',
  finding_truck: 'active',
  matched: 'active',
  assigned: 'active',
  in_transit: 'active',
  delivered: 'done',
  closed: 'done',
  cancelled: 'stopped',
};

export const LIVE: LoadStatus[] = ['posted', 'finding_truck', 'matched', 'assigned', 'in_transit'];

export default function CustomerHome() {
  const router = useRouter();
  const { profile } = useSession();
  const cities = useCities();
  const truckTypes = useTruckTypes();
  const loads = useMyLoads();

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

  // Memoised because `recent` depends on it. `loads.data ?? []` allocates a new
  // array every render when the query is still empty, which would make the
  // dedupe below re-run on every keystroke elsewhere in the tree.
  const all = useMemo(() => loads.data ?? [], [loads.data]);
  const active = all.filter((l) => LIVE.includes(l.status));

  /**
   * Routes this shipper has sent before, most recent first.
   *
   * Uber's saved places, earned rather than configured — a freight customer runs
   * the same corridors over and over, so the second load should cost two taps
   * instead of six. Deduped on the city pair, capped at three: a list of
   * shortcuts longer than the thing it shortcuts is not a shortcut.
   */
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; origin: number; dest: number }[] = [];
    for (const l of all) {
      const key = `${l.origin_city}-${l.dest_city}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, origin: l.origin_city, dest: l.dest_city });
      if (out.length === 3) break;
    }
    return out;
  }, [all]);

  // First name only. "Hello, Mohammed Al Balushi Trading LLC" wraps to three
  // lines at 32px and says nothing the short form does not.
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? '';

  return (
    <Screen>
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
        <PageTitle>{firstName ? `${t('home.hello')}, ${safeText(firstName)}` : t('home.hello')}</PageTitle>

        {/* The entry point. Deliberately the largest tappable thing on the
            screen and the only orange on it. */}
        <View style={styles.entryWrap}>
          <Pressable
            onPress={() => router.push('/post-load')}
            accessibilityRole="button"
            accessibilityLabel={`${t('home.entry')} ${t('home.entry.hint')}`}
            style={({ pressed }) => [styles.entry, pressed && { backgroundColor: color.fill }]}
          >
            <View style={styles.entryIcon}>
              <Icon name="pickup" size={22} color={color.paper} />
            </View>
            <View style={styles.entryText}>
              <Text style={styles.entryTitle}>{t('home.entry')}</Text>
              {/* Wraps rather than truncating. "…we fi…" on the one row that
                  explains the whole product is worse than a second line. */}
              <Text style={styles.entryHint}>{t('home.entry.hint')}</Text>
            </View>
            <Icon name="chevron" size={22} color={color.inkFaint} />
          </Pressable>
        </View>

        {loads.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={color.orange} accessibilityLabel={t('common.loading')} />
          </View>
        ) : loads.isError ? (
          <EmptyState
            icon="alert"
            title={t('common.error.title')}
            explain={t('common.error.explain')}
          >
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
        ) : all.length === 0 ? (
          <EmptyState
            icon="truck"
            title={t('cust.empty.title')}
            explain={t('cust.empty.explain')}
          />
        ) : (
          <>
            {active.length > 0 && (
              <Section
                title={t('home.live')}
                actionLabel={active.length > 2 ? t('home.seeAll') : undefined}
                onAction={active.length > 2 ? () => router.push('/loads') : undefined}
              >
                <View style={styles.cards}>
                  {active.slice(0, 2).map((load) => (
                    <LoadCard
                      key={load.id}
                      load={load}
                      cityName={cityName}
                      truckName={truckName}
                      onPress={() => router.push(`/load/${load.id}`)}
                    />
                  ))}
                </View>
              </Section>
            )}

            {recent.length > 0 && (
              <Section title={t('home.again')}>
                <View style={styles.group}>
                  <RowGroup>
                    {recent.map((r, i) => (
                      <ListRow
                        key={r.key}
                        icon="routes"
                        // Never a hardcoded arrow: it points the wrong way in Arabic.
                        title={`${cityName(r.origin)} ${directionArrow()} ${cityName(r.dest)}`}
                        subtitle={t('home.again.hint')}
                        chevron
                        last={i === recent.length - 1}
                        // Pre-fills the flow rather than posting anything. The
                        // shipper still answers goods, date and truck, and still
                        // sees the price before committing.
                        onPress={() =>
                          router.push({
                            pathname: '/post-load',
                            params: { origin: String(r.origin), dest: String(r.dest) },
                          })
                        }
                      />
                    ))}
                  </RowGroup>
                </View>
              </Section>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/* ─── one live load, as a card ───────────────────────────────────────────── */

/**
 * Route, status, and the two facts a shipper checks: when it goes, what it
 * costs. Everything else is one tap away, which is the whole reason the detail
 * screen exists.
 */
export function LoadCard({
  load,
  cityName,
  truckName,
  onPress,
}: {
  load: Load;
  cityName: (id: number) => string;
  truckName: Map<string, string>;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${cityName(load.origin_city)} ${t('label.to')} ${cityName(load.dest_city)}. ${t(`status.${load.status}` as StringKey)}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.cardHead}>
        <Stamp tone={TONE[load.status]}>{t(`status.${load.status}` as StringKey)}</Stamp>
        <Icon name="chevron" size={20} color={color.inkFaint} />
      </View>

      <RouteLine
        from={cityName(load.origin_city)}
        to={cityName(load.dest_city)}
        labelFrom={t('label.from')}
        labelTo={t('label.to')}
        compact
      />

      <FactChips
        facts={[
          {
            icon: 'calendar',
            label: t('label.pickup'),
            value: formatWindow(load.pickup_from, load.pickup_to),
          },
          {
            icon: 'truck',
            label: t('label.truck'),
            // A null truck type is "Not sure — advise me", never blank.
            value: load.truck_type_code
              ? (truckName.get(load.truck_type_code) ?? load.truck_type_code)
              : t('truck.unset'),
          },
        ]}
      />

      {load.price_baisa != null && (
        <View style={styles.cardPrice}>
          {/* formatMoney, never toFixed(2) — OMR carries three decimals and a
              two-decimal render is a 10x error that looks plausible. */}
          <Text style={styles.priceAmount}>
            {formatMoney(load.price_baisa, load.currency as Currency, getLanguage())}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xxxl, gap: space.xxl },
  center: { paddingVertical: space.huge, alignItems: 'center' },
  emptyAction: { alignSelf: 'stretch', paddingTop: space.md, paddingHorizontal: space.xl },

  entryWrap: { paddingHorizontal: GUTTER },
  entry: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: color.paper,
    borderRadius: radius.card,
    ...elevation.card,
  },
  entryIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: color.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryText: { flex: 1, gap: 2 },
  entryTitle: { ...font.title, color: color.ink, textAlign: align.start },
  entryHint: { ...font.bodySmall, color: color.inkSoft, textAlign: align.start },

  cards: { paddingHorizontal: GUTTER, gap: space.md },
  group: { paddingHorizontal: GUTTER },

  card: {
    backgroundColor: color.paper,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.md,
    ...elevation.card,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardPrice: { flexDirection: 'row', alignItems: 'baseline' },
  priceAmount: { ...font.title, color: color.ink, textAlign: align.start },
});

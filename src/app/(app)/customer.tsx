/**
 * Shipper home, as the docket book. See `waybill-book.tsx` for the direction
 * contract this serves.
 *
 * A shipper runs one or two loads at a time, so the book is short by design: one
 * sheet per live load, then a single record sheet of finished ones. With nothing
 * moving there is one sheet and no tab strip at all — a first-time user meets
 * exactly one page and one action, which is the whole point of a book you can
 * hand to someone who has never used an app.
 *
 * The load sheets carry no orange action. A shipper has nothing to do while a
 * load is moving, and inventing a button to fill the space would be a lie about
 * where the work is; the one orange stays pinned on posting the next load.
 * `finding_truck` is the exception — it is the promise being kept, so it says so
 * and offers the human backstop.
 */

import { useMemo } from 'react';
import { ActivityIndicator, Image, Linking, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlankNote, FactRow, LedgerRow, NoteBody, NoteFoot, RoutePair } from '@/components/consignment';
import { Masthead } from '@/components/masthead';
import { Body, Button, Note, NoteHead, Rule, Stamp, TextButton } from '@/components/primitives';
import { WaybillBook, type BookSection, type BookSheet } from '@/components/waybill-book';
import { align, directionArrow, getLanguage, localized, t, type StringKey } from '@/i18n';
import { signOut } from '@/lib/auth';
import { formatDeadline, formatWeight, formatWindow, reference } from '@/lib/format';
import { formatMoney, type Currency } from '@/lib/money';
import { safeText, whatsappLink } from '@/lib/safe-text';
import {
  cityIndex,
  useCities,
  useCurrentQuote,
  useMyLoads,
  useMyTrips,
  usePodUrl,
  useQuoteLoad,
  useTripCounterpart,
  useTripEvents,
  useTripTruck,
  useTruckTypes,
  type Load,
  type LoadStatus,
  type Trip,
} from '@/lib/queries';
import { color, doc, font, space, type StampTone } from '@/theme/tokens';

/** Status → stamp tone. Kept in one place so no screen invents its own mapping. */
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

const LIVE: LoadStatus[] = ['posted', 'finding_truck', 'matched', 'assigned', 'in_transit'];

export default function CustomerHome() {
  const router = useRouter();
  const cities = useCities();
  const truckTypes = useTruckTypes();
  const loads = useMyLoads();
  // Shippers have always been permitted to read their own trips — the policy
  // covers `owns_load` — the client just never asked. This is what connects a
  // load to the person carrying it.
  const trips = useMyTrips();

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const truckName = useMemo(() => {
    const m = new Map<string, string>();
    for (const tt of truckTypes.data ?? []) {
      m.set(tt.code, localized({ name_en: tt.name_en, name_ar: tt.name_ar }));
    }
    return m;
  }, [truckTypes.data]);

  const cityName = (id: number) => {
    const c = index.get(id);
    return c ? localized(c) : '—';
  };

  const active = (loads.data ?? []).filter((l) => LIVE.includes(l.status));
  const past = (loads.data ?? []).filter((l) => !LIVE.includes(l.status));

  const tripByLoad = useMemo(
    () => new Map((trips.data ?? []).map((tr) => [tr.load_id, tr])),
    [trips.data],
  );

  /* ── the book ──────────────────────────────────────────────────────────── */

  const sections: BookSection[] = [{ key: 'live', label: t('book.tab.live'), count: active.length }];
  // The record tab only exists once there is a record. A tab labelled "0" is a
  // question the reader has to answer before they can ignore it.
  if (past.length > 0) {
    sections.push({ key: 'record', label: t('book.tab.record'), count: past.length });
  }

  const sheets: BookSheet[] = [];

  if (active.length === 0) {
    sheets.push({
      key: 'live-none',
      sectionKey: 'live',
      render: () => (
        <BlankNote title={t('cust.empty.title')} explain={t('cust.empty.explain')} />
      ),
    });
  } else {
    for (const load of active) {
      sheets.push({
        key: load.id,
        sectionKey: 'live',
        render: () => (
          <LoadSheet
            load={load}
            trip={tripByLoad.get(load.id)}
            cityName={cityName}
            truckName={truckName}
          />
        ),
      });
    }
  }

  if (past.length > 0) {
    sheets.push({
      key: 'record',
      sectionKey: 'record',
      render: () => (
        <Note>
          <NoteHead left={t('cust.record.title')} />
          {past.map((l, i) => (
            <LedgerRow
              key={l.id}
              // Never a hardcoded arrow: it points the wrong way in Arabic.
              route={`${cityName(l.origin_city)} ${directionArrow()} ${cityName(l.dest_city)}`}
              meta={formatWindow(l.pickup_from, l.pickup_to)}
              trailing={
                <Stamp tone={TONE[l.status]}>{t(`status.${l.status}` as StringKey)}</Stamp>
              }
              last={i === past.length - 1}
              // The row was terminal, and everything a finished job is *for* sat
              // behind it: the delivery photograph, who carried it, the plate, the
              // amount. Settlement is offline, so that record is the artefact the
              // business actually needs — losing it the moment the truck arrived
              // was the worst-timed disappearance in the product.
              onPress={() => router.push(`/load/${l.id}`)}
            />
          ))}
        </Note>
      ),
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Masthead
        title={t('cust.masthead')}
        action={<TextButton label={t('auth.signOut')} tone="muted" onPress={signOut} />}
      />

      {loads.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={color.orange} />
        </View>
      ) : loads.isError ? (
        <View style={styles.block}>
          <BlankNote title={t('common.error.title')} explain={t('common.error.explain')}>
            <View style={styles.blankAction}>
              <Button
                label={t('common.retry')}
                variant="secondary"
                onPress={() => {
                  loads.refetch();
                }}
              />
            </View>
          </BlankNote>
        </View>
      ) : (
        <WaybillBook
          sections={sections}
          sheets={sheets}
          refreshing={loads.isRefetching}
          onRefresh={() => {
            loads.refetch();
          }}
          footer={() => (
            <View style={styles.pinned}>
              <Button
                label={active.length === 0 ? t('cust.empty.action') : t('cust.newLoad')}
                onPress={() => router.push('/post-load')}
              />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

/* ─── one live load ──────────────────────────────────────────────────────── */

function LoadSheet({
  load,
  trip,
  cityName,
  truckName,
}: {
  load: Load;
  trip?: Trip;
  cityName: (id: number) => string;
  truckName: Map<string, string>;
}) {
  const finding = load.status === 'finding_truck';

  // All three no-op until a trip exists (`enabled: !!tripId`), so a posted load
  // costs nothing extra.
  const counterpart = useTripCounterpart(trip?.id);
  const truck = useTripTruck(trip?.id);
  const events = useTripEvents(trip?.id);

  const driver = counterpart.data;
  const proof = (events.data ?? []).find((e) => e.photo_path)?.photo_path ?? null;

  return (
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
              // A null truck type is "Not sure — advise me", never blank.
              value: load.truck_type_code
                ? (truckName.get(load.truck_type_code) ?? load.truck_type_code)
                : t('truck.unset'),
            },
            {
              label: t('label.weight'),
              value: formatWeight(load.weight_kg, t('weight.unset')),
            },
          ]}
        />

        <PriceBlock load={load} />

        {/* The one state where a shipper could think they have been forgotten.
            PRODUCT.md: never a dead end — so it explains itself and hands over a
            human. WhatsApp is the incumbent product, not a fallback. */}
        {finding && (
          <>
            <Body muted>{t('cust.finding.explain')}</Body>
            <Button
              label={t('whatsapp.action')}
              variant="secondary"
              onPress={() => {
                Linking.openURL(
                  whatsappLink(`${t('label.reference')} ${reference(load.id)}`),
                ).catch(() => {});
              }}
            />
          </>
        )}
      </NoteBody>

      {/* Who is carrying it. PRODUCT.md Principle #4: show the truck and the
          person. Both come from definer functions that check trip participation,
          because `profiles` and `trucks` are not cross-readable. */}
      {!!driver && (
        <>
          <Rule />
          <NoteBody gap={space.sm}>
            <View style={styles.driverHead}>
              <Text style={styles.blockLabel}>{t('cust.driver.title').toUpperCase()}</Text>
              {truck.data?.is_verified && (
                <Stamp tone="done">{t('cust.driver.verified')}</Stamp>
              )}
            </View>

            <Text style={styles.driverName}>{safeText(driver.full_name)}</Text>

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

            {/* Phone is only present because trip_counterpart returned it to a
                participant. Routed through whatsappLink so the number and the
                reference are both encoded. */}
            {!!driver.phone && (
              <Button
                label={t('cust.driver.call')}
                variant="secondary"
                onPress={() => {
                  Linking.openURL(
                    whatsappLink(
                      `${t('label.reference')} ${reference(load.id)} — ${safeText(driver.full_name)}`,
                    ),
                  ).catch(() => {});
                }}
              />
            )}
          </NoteBody>
        </>
      )}

      {/* The trail. Read-only here: the insert grant belongs to the driver, so a
          shipper can follow it but never author it. */}
      {(events.data ?? []).length > 0 && (
        <>
          <Rule />
          <View style={styles.progressHead}>
            <Text style={styles.blockLabel}>{t('cust.progress.title').toUpperCase()}</Text>
          </View>
          {(events.data ?? []).map((e, i) => (
            <LedgerRow
              key={e.id}
              route={t(`event.${e.type}` as StringKey)}
              meta={formatDeadline(e.occurred_at)}
              last={i === (events.data ?? []).length - 1}
            />
          ))}
        </>
      )}

      {!!proof && <ProofPhoto path={proof} />}

      <NoteFoot reference={reference(load.id)} />
    </Note>
  );
}

/**
 * The price, or what is happening instead of one.
 *
 * `load.submit` has said "Request a quote" since the first screen was written and
 * nothing ever answered it. This is the answer.
 *
 * No orange here on purpose. The file header sets the rule — load sheets carry no
 * orange action, because the single accent stays pinned on posting the next load —
 * so "Get a price" is a secondary button even though it is the most useful thing
 * on the sheet. Two oranges on one screen is the loud-aggregator look DESIGN.md
 * lists as an anti-reference.
 *
 * The three no-price outcomes each get a full sentence rather than a dash or an
 * empty field. A blank price to someone with near-zero tech skills reads as "the
 * app is broken"; the truth is that a person is working on it, so it says that.
 */
function PriceBlock({ load }: { load: Load }) {
  const quote = useCurrentQuote(load.id);
  const ask = useQuoteLoad();

  // Quoting is only permitted while the load is still open (0010 enforces it), so
  // the ask never appears where the server would refuse it.
  const askable = load.status === 'posted' || load.status === 'finding_truck';

  const priced = quote.data?.outcome === 'quoted' ? quote.data : null;
  // An expired quote leaves the price on the load. Showing it without a
  // "held until" is honest: it is still the price, it is just no longer promised.
  const amount = priced?.price_baisa ?? load.price_baisa;
  const currency = (priced?.currency ?? load.currency) as Currency;

  if (quote.isPending) return null;

  return (
    <>
      <Rule />
      <NoteBody gap={space.sm}>
        <Text style={styles.blockLabel}>{t('price.title').toUpperCase()}</Text>

        {amount != null ? (
          <>
            {/* formatMoney, never toFixed(2) — OMR carries three decimals and a
                two-decimal render is a 10x error that looks plausible. */}
            <Text style={styles.price}>{formatMoney(amount, currency, getLanguage())}</Text>
            {!!priced && (
              <Text style={styles.priceMeta}>
                {`${t('price.heldUntil')} ${formatDeadline(priced.expires_at)}`}
              </Text>
            )}
            <Body muted>{t('price.settle')}</Body>
          </>
        ) : quote.data ? (
          // A quote exists and carries no price: say which of the three cases it
          // is, in the shipper's language.
          <Body muted>{t(`price.${quote.data.outcome}` as StringKey)}</Body>
        ) : (
          <>
            <Body muted>{t('price.none.explain')}</Body>
            {askable && (
              <Button
                label={ask.isError ? t('price.retry') : t('price.action')}
                variant="secondary"
                loading={ask.isPending}
                onPress={() => ask.mutate(load.id)}
              />
            )}
          </>
        )}
      </NoteBody>
    </>
  );
}

/**
 * The delivery photo, behind a short-lived signed URL.
 *
 * Its own component so the signing query only mounts once a photo path exists,
 * and so a failed signature degrades to nothing rather than a broken image frame.
 */
function ProofPhoto({ path }: { path: string }) {
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
          accessibilityLabel={t('cust.pod.title')}
        />
      </NoteBody>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  block: { paddingHorizontal: space.xl, paddingTop: space.xl },
  blankAction: { alignSelf: 'stretch', paddingTop: space.sm },

  driverHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  progressHead: { paddingHorizontal: doc.gutter, paddingTop: space.md, paddingBottom: space.xs },
  blockLabel: { ...doc.fieldLabel, color: color.inkSoft, textAlign: align.start },
  driverName: { ...font.cardTitle, color: color.ink, textAlign: align.start },

  // The price is the second thing a shipper looks for after the route, so it
  // takes `title` — the same weight-900 tight treatment the route pair gets — and
  // stays ink rather than orange, per the one-accent rule.
  price: { ...font.title, color: color.ink, textAlign: align.start },
  priceMeta: { ...font.smallPrint, color: color.inkSoft, textAlign: align.start },
  proof: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 10,
    borderWidth: doc.rule,
    borderColor: color.line,
    backgroundColor: color.paperDeep,
  },

  pinned: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.md,
    backgroundColor: color.paper,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
});

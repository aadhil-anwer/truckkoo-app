/**
 * The shipper's side of a bid load (0045): the prices as they arrive, and the
 * proposal once bidding has closed.
 *
 * PRICES ARE TOTALS. What the shipper sees is what they pay the driver at the
 * gate, fee included. The driver's own share never reaches this screen — total
 * minus share is the fee (SENSITIVE_FIELDS.md).
 *
 * ONE ACCENT. While there is no price yet, the live state wears it ("TAKING
 * PRICES"). Once there is one to accept, the pinned "Accept …" owns the accent
 * and the pill goes neutral — the rule the load screen already follows on T1/T2.
 *
 * CHOOSING IS A SELECTION, NOT A BUTTON PER ROW. Several orange buttons in a
 * list is several primaries; a radio list with one pinned action keeps the
 * decision in one place and the amount in its label. Selection is signalled
 * three ways (SelectRow), which matters in a cab in the sun.
 *
 * Gone prices are left out rather than greyed out: a shipper on this screen is
 * choosing, and a row they cannot choose is noise. The server refuses a stale
 * one anyway.
 */

import { StyleSheet, Text, View } from 'react-native';

import { SelectRow } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { Notice, SectionLabel, Skeleton, StatusPill } from '@/components/ui';
import { align, formatNumber, getLanguage, t } from '@/i18n';
import { formatDeadline } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import type { ShipperBid, ShipperBidStatus } from '@/lib/queries';
import { safeText } from '@/lib/safe-text';
import { alpha, color, font, radius, space } from '@/theme/tokens';

/** "Prices close in 12 min" inside the hour; the time of day after that. */
export function bidClosesLabel(iso: string, now: number = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms > 0 && ms <= 60 * 60 * 1000) {
    return t('bid.closesIn', { minutes: formatNumber(Math.max(1, Math.ceil(ms / 60000))) });
  }
  return t('bid.closes', { when: formatDeadline(iso) });
}

/** Prices that can still be accepted, cheapest first (the server's order). */
export function choosable(bids: ShipperBid[] | undefined): ShipperBid[] {
  return (bids ?? []).filter((b) => b.eligible);
}

function money(baisa: number): string {
  return formatMoney(baisa, 'OMR', getLanguage()) ?? '';
}

function BidRows({
  bids,
  chosen,
  onChoose,
  names,
}: {
  bids: ShipperBid[];
  chosen: string | null;
  onChoose: (bidId: string) => void;
  names: Map<string, string>;
}) {
  return (
    <View style={styles.rows} accessibilityRole="radiogroup">
      {bids.map((b) => (
        <SelectRow
          key={b.bid_id}
          ground="ink"
          title={money(b.total_baisa)}
          subtitle={[
            safeText(b.driver_name),
            b.truck_type ? (names.get(b.truck_type) ?? b.truck_type) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          selected={chosen === b.bid_id}
          onPress={() => onChoose(b.bid_id)}
        />
      ))}
    </View>
  );
}

function TargetLine({ status }: { status: ShipperBidStatus | null | undefined }) {
  if (!status) return null;
  return (
    <Text style={styles.meta}>
      {status.target_total_baisa != null
        ? t('bid.target', { amount: money(status.target_total_baisa) })
        : t('bid.target.none')}
    </Text>
  );
}

/** Bidding is open: the prices so far, or the narrated wait for the first one. */
export function BidsOpen({
  deadline,
  bids,
  status,
  loading,
  chosen,
  onChoose,
  names,
}: {
  deadline: string;
  bids: ShipperBid[];
  status: ShipperBidStatus | null | undefined;
  loading: boolean;
  chosen: string | null;
  onChoose: (bidId: string) => void;
  names: Map<string, string>;
}) {
  const any = bids.length > 0;
  return (
    <View style={styles.block}>
      {/* The live state wears the accent only until there is something to accept. */}
      <StatusPill label={t('bid.open.pill')} tone={any ? 'neutral' : 'accent'} />
      <Text style={styles.meta}>{bidClosesLabel(deadline)}</Text>

      {loading ? (
        <View style={styles.rows}>
          <Skeleton height={64} round={radius.row} />
          <Skeleton height={64} round={radius.row} />
        </View>
      ) : any ? (
        <>
          <SectionLabel>{t('bid.choose')}</SectionLabel>
          <BidRows bids={bids} chosen={chosen} onChoose={onChoose} names={names} />
        </>
      ) : (
        <View style={styles.lede}>
          <Text style={styles.body}>{t('bid.open.none')}</Text>
        </View>
      )}

      <TargetLine status={status} />
      <View style={styles.lede}>
        <Notice icon="pay">{t('price.settle')}</Notice>
      </View>
    </View>
  );
}

/**
 * Bidding has closed and the server proposed the cheapest price. The proposal
 * is the hero — the one display statement on this state — and the others stay
 * choosable underneath, because "cheapest" is not always "best" to someone who
 * knows the drivers.
 */
export function BidsProposal({
  bids,
  chosen,
  onChoose,
  names,
}: {
  bids: ShipperBid[];
  chosen: string | null;
  onChoose: (bidId: string) => void;
  names: Map<string, string>;
}) {
  const pick = bids.find((b) => b.bid_id === chosen) ?? bids[0];
  if (!pick) return null;
  return (
    <View style={styles.block}>
      <SectionLabel>{t('bid.best.label')}</SectionLabel>
      <Text style={styles.priceHero} accessibilityRole="header">
        {money(pick.total_baisa)}
      </Text>
      <Text style={styles.meta}>{t('bid.best.from', { name: safeText(pick.driver_name) })}</Text>
      {bids.length > 1 && (
        <>
          <SectionLabel>{t('bid.others')}</SectionLabel>
          <BidRows bids={bids} chosen={pick.bid_id} onChoose={onChoose} names={names} />
        </>
      )}
      <View style={styles.lede}>
        <Notice icon="pay">{t('price.settle')}</Notice>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.md, alignItems: 'flex-start' },
  rows: { alignSelf: 'stretch', gap: space.sm },
  lede: { maxWidth: 340 },
  body: { ...arabicIfNeeded(font.body), color: alpha.onInk.body, textAlign: align.start },
  meta: { ...arabicIfNeeded(font.caption), color: alpha.onInk.tertiary, textAlign: align.start },
  priceHero: { ...font.priceHero, color: color.lightText, textAlign: align.start },
});

/**
 * The status a shipper reads on a load card.
 *
 * Mostly `status.<status>`. The exception is a bid load (0045) that is still
 * taking prices: it rests in `matched` — offers are out — and "Truck found"
 * would tell the shipper a truck is booked while they have not chosen one.
 */
import { type StringKey } from '@/i18n';
import type { Load } from './queries';

export function loadStatusKey(load: Pick<Load, 'status' | 'pricing_mode'>): StringKey {
  if (load.pricing_mode === 'bid' && (load.status === 'posted' || load.status === 'matched')) {
    return 'status.bidding';
  }
  return `status.${load.status}` as StringKey;
}

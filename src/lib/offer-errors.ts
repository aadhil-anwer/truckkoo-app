/**
 * What to tell a driver when answering an offer fails.
 *
 * Waves ask three drivers at once (0036), so losing a race is the normal case,
 * not an edge one — and the database reports a lost race three ways depending
 * on who got there first: the winner's accept already assigned the load, it
 * already expired this driver's offer, or the load has moved on. All three mean
 * the same thing to a driver: someone else took it. Only this message says so;
 * the generic error would read as "the app is broken, try again".
 *
 * It lived as `msg.includes('load already assigned')` in three screens, and the
 * other two ways were missed in all of them.
 */
import { t } from '@/i18n';

const TAKEN = ['load already assigned', 'offer already resolved', 'offer expired', 'load not open'];

export function offerErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : '';
  return TAKEN.some((m) => msg.includes(m)) ? t('driver.offer.taken') : t('error.generic');
}

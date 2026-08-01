/**
 * The driver's three numbers, in one implementation.
 *
 * A driver collects the shipper's price in cash at the gate and remits the
 * margin. So all three are on the card deliberately: what they keep, what they
 * take, and what they owe. A screen showing only the payout sends a driver to
 * collect the wrong amount.
 */

import { render, screen } from '@testing-library/react-native';

import { DriverMoney } from '@/components/driver/Money';
import { initLanguage, t } from '@/i18n';

beforeEach(() => initLanguage('en'));

describe('DriverMoney', () => {
  it('leads with what the driver keeps', async () => {
    await render(<DriverMoney payout={78000} collect={96000} owed={18000} currency="OMR" />);
    expect(screen.getByText('78.000')).toBeTruthy();
  });

  it('says what to collect and what is owed, because the driver handles both', async () => {
    await render(<DriverMoney payout={78000} collect={96000} owed={18000} currency="OMR" />);
    // A driver handed 96 while the screen says 78 is being misled at the gate.
    expect(screen.getByText(/96\.000/)).toBeTruthy();
    expect(screen.getByText(/18\.000/)).toBeTruthy();
  });

  it('says nothing about a margin when there is none', async () => {
    // At 0 percent commission — the state the product ships in — a second and
    // third number would be noise on the screen a driver reads one-handed.
    await render(<DriverMoney payout={96000} collect={96000} owed={0} currency="OMR" />);
    expect(screen.queryByText(/Truckkoo/)).toBeNull();
    expect(screen.queryByText(/Collect/)).toBeNull();
  });

  it('renders three OMR decimals, never two', async () => {
    // OMR has THREE decimal places. A two-decimal render is a 10x error that
    // looks entirely plausible on the screen.
    await render(<DriverMoney payout={78500} collect={96000} owed={17500} currency="OMR" />);
    expect(screen.getByText('78.500')).toBeTruthy();
    expect(screen.queryByText('78.50')).toBeNull();
  });

  it('says nothing at all rather than a zero when there is no price yet', async () => {
    // Rule #5: absent, never zeroed. A load waiting on a price must not render
    // as a driver being offered nothing.
    await render(<DriverMoney payout={null} collect={null} owed={null} currency="OMR" />);
    expect(screen.queryByText(/You keep/)).toBeNull();
    expect(screen.queryByText('0.000')).toBeNull();
  });

  it('carries the amount into one accessible label, not three loose numbers', async () => {
    await render(<DriverMoney payout={78000} collect={96000} owed={18000} currency="OMR" />);
    expect(screen.getByLabelText('You keep 78.000 OMR')).toBeTruthy();
  });
});

describe('composed driver copy', () => {
  afterEach(() => initLanguage('en'));

  it('puts the detour distance and its unit inside one string', () => {
    initLanguage('en');
    expect(t('drv.offer.detour', { km: '12' })).toBe('about 12 km extra on your route');
  });

  it('lets Arabic place the unit itself', () => {
    initLanguage('ar');
    const s = t('drv.offer.detour', { km: '١٢' });
    expect(s).toContain('١٢');
    // The Latin unit must not survive into Arabic copy.
    expect(s).not.toContain('km');
    expect(s).toContain('كم');
  });

  it('carries the amount inside the take label', () => {
    initLanguage('en');
    expect(t('drv.offer.take', { amount: 'OMR 42.500' })).toBe('Take it — OMR 42.500');
  });
});

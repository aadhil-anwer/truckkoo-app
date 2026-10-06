/**
 * Pickups from the app's side (0069): arrival noticed without a tap, the
 * waiting charge as the database computed it, the shipper's view of it and
 * "Driver isn't here", and a job inside one town.
 */
import { driverTrip, mockParams, ok, resetQueries } from './harness';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import TripScreen from '@/app/(app)/trip/[id]';
import { WaitingCard } from '@/components/trip/WaitingCard';
import { initLanguage } from '@/i18n';
import { sameTownProblem } from '@/lib/booking';
import { hrefFor } from '@/lib/push';
import * as queries from '@/lib/queries';
import type { TripWaiting } from '@/lib/queries';
import { supabase } from '@/lib/supabase';


const render = (ui: ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const rpc = supabase.rpc as jest.Mock;
const pinned = { pickup_lat: 23.68, pickup_lng: 58.15, pickup_name: 'Shop', drop_lat: 23.66, drop_lng: 58.2, drop_name: 'Home' };

const waiting = (over: Partial<TripWaiting> = {}): TripWaiting => ({
  terms: { free_minutes: 20, per_15min_baisa: 1000, cap_minutes: 120 },
  stops: [{ stop: 'pickup', arrived_at: '2026-10-06T10:00:00Z', ended_at: null, running: true, minutes: 34,
            free_minutes: 20, per_15min_baisa: 1000, cap_minutes: 120, capped: false, waived: false, held: false, charge_baisa: 1000 }],
  waiting_baisa: 1000, price_baisa: 4400, total_baisa: 5400, payout_baisa: 4960, ...over,
});

beforeEach(() => {
  initLanguage('en'); resetQueries(queries);
  rpc.mockReset().mockResolvedValue({ data: '2026-10-06T10:00:00Z', error: null });
  mockParams.current = { id: 'trip-1' };
});

describe('arriving is automatic', () => {
  it('there is nothing to tap: the driver is told they will be checked in at the pin', async () => {
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip(pinned)));
    (queries.useTripWaiting as jest.Mock).mockReturnValue(ok(waiting({ stops: [] , waiting_baisa: 0 })));
    await render(<TripScreen />);
    expect(screen.queryByText(/I'm at/)).toBeNull();
    expect(screen.getByText("We'll check you in when you reach the pickup pin.")).toBeTruthy();
  });

  it('after pickup, it is the drop-off pin', async () => {
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip({ ...pinned, status: 'in_transit' })));
    (queries.useTripWaiting as jest.Mock).mockReturnValue(ok(waiting()));
    await render(<TripScreen />);
    expect(screen.getByText("We'll check you in when you reach the drop-off pin.")).toBeTruthy();
  });

  it('says nothing about waiting on a job that has no waiting terms', async () => {
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip(pinned)));
    await render(<TripScreen />);
    expect(screen.queryByText(/check you in/)).toBeNull();
  });

  it('once arrived, shows the clock and the charge the database worked out, and the total to collect', async () => {
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip(pinned)));
    (queries.useTripWaiting as jest.Mock).mockReturnValue(ok(waiting()));
    await render(<TripScreen />);
    expect(screen.queryByText(/check you in/)).toBeNull();
    expect(screen.getByText('Waiting at the pickup · 34 min')).toBeTruthy();
    expect(screen.getByText('First 20 min free, then 1.000 OMR per 15 min')).toBeTruthy();
    expect(screen.getByText('Waiting charge: 1.000 OMR')).toBeTruthy();
    expect(screen.getByText('Collect in total: 5.400 OMR')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('the shipper sees the same waiting', () => {
  it('with what to pay in total, and no check-in button', async () => {
    await render(<WaitingCard waiting={waiting({ payout_baisa: null })} side="shipper" />);
    expect(screen.getByText('Waiting at the pickup · 34 min')).toBeTruthy();
    expect(screen.getByText('Total to pay: 5.400 OMR')).toBeTruthy();
    expect(screen.queryByText(/I'm at/)).toBeNull();
  });

  it('says when waiting stopped counting, and when Truckkoo waived it', async () => {
    await render(<WaitingCard side="shipper" waiting={waiting({
      stops: [
        { ...waiting().stops[0]!, running: false, ended_at: '2026-10-06T10:34:00Z', waived: true, charge_baisa: 0 },
        { stop: 'drop', arrived_at: '2026-10-06T11:00:00Z', ended_at: null, running: true, minutes: 130, free_minutes: 20,
          per_15min_baisa: 1000, cap_minutes: 120, capped: true, waived: false, held: false, charge_baisa: 7000 },
      ],
    })} />);
    expect(screen.getByText('Waiting stopped counting at 120 min. Truckkoo will sort it out.')).toBeTruthy();
    expect(screen.getByText('Waiting waived by Truckkoo')).toBeTruthy();
  });

  it('"Driver isn\'t here" holds the running stop and says what happens next', async () => {
    await render(<WaitingCard waiting={waiting({ payout_baisa: null })} side="shipper" tripId="trip-1" />);
    await act(async () => { fireEvent.press(screen.getByText("Driver isn't here")); });
    expect(rpc).toHaveBeenCalledWith('report_driver_absent', { p_trip_id: 'trip-1', p_stop: 'pickup' });
    expect(screen.getByText('Waiting is paused. Truckkoo will call the driver.')).toBeTruthy();
    expect(screen.queryByText("Driver isn't here")).toBeNull();
  });

  it('a held stop says it is paused, and offers nothing more to press', async () => {
    await render(<WaitingCard side="shipper" tripId="trip-1" waiting={waiting({
      stops: [{ ...waiting().stops[0]!, held: true, charge_baisa: 0 }] })} />);
    expect(screen.getByText('Waiting paused while Truckkoo checks')).toBeTruthy();
    expect(screen.queryByText("Driver isn't here")).toBeNull();
  });

  it('shows nothing when the job has no waiting terms', async () => {
    const view = await render(<WaitingCard side="shipper" waiting={waiting({ terms: null, stops: [] })} />);
    expect(view.toJSON()).toBeNull();
  });
});

describe('a job inside one town', () => {
  const seeb = 3;
  const a = { lat: 23.68, lng: 58.15 };
  it('needs the pickup on the map too', () => {
    expect(sameTownProblem(seeb, seeb, null, { lat: 23.66, lng: 58.2 })).toBe('needsPickupPin');
  });
  it('refuses pins too close to be a job', () => {
    expect(sameTownProblem(seeb, seeb, a, { lat: 23.6805, lng: 58.1502 })).toBe('tooClose');
  });
  it('is fine with both pins apart, and between towns is never a problem', () => {
    expect(sameTownProblem(seeb, seeb, a, { lat: 23.66, lng: 58.2 })).toBeNull();
    expect(sameTownProblem(seeb, 1, null, null)).toBeNull();
  });
});

describe('push', () => {
  it('"your truck is here" opens the load', () => {
    expect(hrefFor({ kind: 'shipper_driver_arrived', load_id: '11111111-1111-4111-8111-111111111111' }))
      .toBe('/load/11111111-1111-4111-8111-111111111111');
  });
  it('"the customer can\'t see your truck" opens the driver\'s trip', () => {
    expect(hrefFor({ kind: 'driver_absence_reported', trip_id: '22222222-2222-4222-8222-222222222222' }))
      .toBe('/trip/22222222-2222-4222-8222-222222222222');
  });
});

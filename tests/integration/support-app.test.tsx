/**
 * The support desk, from the app's side (0063, 0065): a driver releasing a job
 * honestly, a report that carries photos, a driver reading and appealing their
 * record, and messages from staff.
 */
import { driverTrip, mockParams, mockPush, mockReplace, ok, resetQueries } from './harness';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Release from '@/app/(app)/release';
import Record from '@/app/(app)/record';
import Appeal from '@/app/(app)/appeal';
import Reports from '@/app/(app)/reports';
import Messages from '@/app/(app)/messages';
import ShipmentCase from '@/app/(app)/case';
import TripScreen from '@/app/(app)/trip/[id]';
import { initLanguage } from '@/i18n';
import * as queries from '@/lib/queries';
import { supabase } from '@/lib/supabase';

/** The screens invalidate queries after a write, so they need a client. */
const render = (ui: ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

const rpc = supabase.rpc as jest.Mock;
const upload = jest.fn();
const fetchPhoto = jest.fn();
const originalFetch = global.fetch;
const uid = '55555555-0000-4000-8000-000000000001';

beforeEach(() => {
  initLanguage('en'); resetQueries(queries);
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: uid } } } });
  (supabase.storage.from as jest.Mock).mockReturnValue({ upload });
  upload.mockReset().mockResolvedValue({ error: null });
  fetchPhoto.mockReset().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(12) });
  global.fetch = fetchPhoto;
});
afterEach(() => { global.fetch = originalFetch; });

describe('release this job', () => {
  it('asks why, then releases with the reason and returns home', async () => {
    mockParams.current = { tripId: 'trip-1' };
    await render(<Release />);
    await act(async () => { fireEvent.press(screen.getByText('My truck broke down')); });
    await act(async () => { fireEvent.press(screen.getByText('Release the job')); });
    expect(rpc).toHaveBeenCalledWith('release_trip', { p_trip_id: 'trip-1', p_reason_code: 'breakdown', p_note: null });
    expect(Alert.alert).toHaveBeenCalledWith('Released. We have told the shipper.');
    expect(mockReplace).toHaveBeenCalledWith('/driver');
  });

  it('shows the database refusal instead of pretending it worked', async () => {
    mockParams.current = { tripId: 'trip-1' };
    rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'The cargo is on your truck. Report a problem instead, and we will help.' } });
    await render(<Release />);
    await act(async () => { fireEvent.press(screen.getByText('I am ill')); });
    await act(async () => { fireEvent.press(screen.getByText('Release the job')); });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByText(/Could not release the job/)).toBeTruthy();
  });

  it('is offered on an accepted job that has not started', async () => {
    mockParams.current = { id: 'trip-1' };
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip({ status: 'assigned' })));
    await render(<TripScreen />);
    await act(async () => { fireEvent.press(screen.getByText('Release this job')); });
    expect(mockPush).toHaveBeenCalledWith('/release?tripId=trip-1');
  });

  it('is not offered once the cargo is on the truck', async () => {
    mockParams.current = { id: 'trip-1' };
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip({ status: 'in_transit' })));
    await render(<TripScreen />);
    expect(screen.queryByText('Release this job')).toBeNull();
  });
});

describe('a report with photos', () => {
  it('offers the shipper the problems a shipper has, and sends photos with the report', async () => {
    mockParams.current = { loadId: 'load-1', tripId: 'trip-1' };
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///crate.jpg', mimeType: 'image/jpeg' }] });
    await render(<ShipmentCase />);
    expect(screen.getByText('The driver asked for more money')).toBeTruthy();
    expect(screen.queryByText('The cargo was not ready')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByText('Cargo damage')); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText('Tell us what happened'), 'Two crates arrived crushed'); });
    await act(async () => { fireEvent.press(screen.getByLabelText('Add a photo')); });
    await act(async () => { fireEvent.press(screen.getByText('Send to dispatch')); });
    expect(supabase.storage.from).toHaveBeenCalledWith('case-evidence');
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${uid}/[0-9a-f-]+[.]jpg$`)),
      expect.any(ArrayBuffer), { contentType: 'image/jpeg', upsert: false });
    expect(rpc).toHaveBeenCalledWith('report_problem', {
      p_load_id: 'load-1', p_trip_id: 'trip-1', p_kind: 'damage', p_details: 'Two crates arrived crushed',
      p_evidence: [upload.mock.calls[0][0]],
    });
  });

  it('says photos are optional and how many', async () => {
    mockParams.current = { loadId: 'load-1', tripId: 'trip-1' };
    await render(<ShipmentCase />);
    expect(screen.getByText('Photos help us sort it out faster. Up to 4.')).toBeTruthy();
  });

  it('a photo that will not upload does not stop the report: it goes without it, and says so', async () => {
    mockParams.current = { loadId: 'load-1', tripId: 'trip-1' };
    (ImagePicker.launchImageLibraryAsync as jest.Mock)
      .mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///a.jpg', mimeType: 'image/jpeg' }] })
      .mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///b.jpg', mimeType: 'image/jpeg' }] });
    upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'network' } });
    await render(<ShipmentCase />);
    await act(async () => { fireEvent.press(screen.getByText('Cargo damage')); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText('Tell us what happened'), 'Two crates arrived crushed'); });
    await act(async () => { fireEvent.press(screen.getByLabelText('Add a photo')); });
    await act(async () => { fireEvent.press(screen.getByLabelText('Add a photo')); });
    await act(async () => { fireEvent.press(screen.getByText('Send to dispatch')); });
    expect(rpc).toHaveBeenCalledWith('report_problem', expect.objectContaining({ p_evidence: [upload.mock.calls[0][0]] }));
    expect(Alert.alert).toHaveBeenCalledWith('Report sent, but some photos did not go through. Dispatch will ask you for them.');
  });

  it('sending again after a failed report does not upload the same photo twice', async () => {
    mockParams.current = { loadId: 'load-1', tripId: 'trip-1' };
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///a.jpg', mimeType: 'image/jpeg' }] });
    rpc.mockResolvedValueOnce({ data: null, error: { code: '08000', message: 'offline' } });
    await render(<ShipmentCase />);
    await act(async () => { fireEvent.press(screen.getByText('Cargo damage')); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText('Tell us what happened'), 'Two crates arrived crushed'); });
    await act(async () => { fireEvent.press(screen.getByLabelText('Add a photo')); });
    await act(async () => { fireEvent.press(screen.getByText('Send to dispatch')); });
    await act(async () => { fireEvent.press(screen.getByText('Send to dispatch')); });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith('report_problem', expect.objectContaining({ p_evidence: [upload.mock.calls[0][0]] }));
  });

  it('still asks for a cancellation the old way', async () => {
    mockParams.current = { loadId: 'load-1', cancel: '1' };
    rpc.mockResolvedValue({ data: true, error: null });
    await render(<ShipmentCase />);
    await act(async () => { fireEvent.changeText(screen.getByLabelText('Tell us what happened'), 'Plans changed, not needed'); });
    await act(async () => { fireEvent.press(screen.getByText('Request cancellation')); });
    expect(rpc).toHaveBeenCalledWith('request_load_cancellation', { p_load_id: 'load-1', p_reason: 'Plans changed, not needed' });
  });
});

describe('my record', () => {
  const strike = { id: 'i1', kind: 'no_show', weight: 2, state: 'confirmed' as const, trip_id: 't1',
    trip_route: 'Muscat → Sohar', created_at: '2026-10-05T06:00:00Z', decided_at: '2026-10-05T07:00:00Z', appeal_open: false };

  it('shows each strike in plain words, and lets the driver disagree', async () => {
    (queries.useMyRecord as jest.Mock).mockReturnValue(ok([strike, { ...strike, id: 'i2', kind: 'release', state: 'voided' }]));
    await render(<Record />);
    expect(screen.getByText('Did not come for a job')).toBeTruthy();
    expect(screen.getByText('Removed on review')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText('Disagree')); });
    expect(mockPush).toHaveBeenCalledWith('/appeal?id=i1');
  });

  it('says so when an appeal is already with us', async () => {
    (queries.useMyRecord as jest.Mock).mockReturnValue(ok([{ ...strike, appeal_open: true }]));
    await render(<Record />);
    expect(screen.getByText('Appeal sent')).toBeTruthy();
    expect(screen.queryByText('Disagree')).toBeNull();
  });

  it('thanks a driver with a clean record', async () => {
    await render(<Record />);
    expect(screen.getByText(/No strikes/)).toBeTruthy();
  });

  it('sends an appeal in the driver\'s own words', async () => {
    mockParams.current = { id: 'i1' };
    await render(<Appeal />);
    await act(async () => { fireEvent.changeText(screen.getByLabelText('What happened'), 'I was at the gate at 8, the guard sent me away'); });
    await act(async () => { fireEvent.press(screen.getByText('Send appeal')); });
    expect(rpc).toHaveBeenCalledWith('appeal_incident', { p_incident_id: 'i1', p_text: 'I was at the gate at 8, the guard sent me away' });
  });
});

describe('reports and messages', () => {
  it('lists what the person reported and where it stands', async () => {
    (queries.useMyCases as jest.Mock).mockReturnValue(ok([
      { id: 'c1', kind: 'damage', status: 'in_progress', created_at: '2026-10-05T06:00:00Z', route: 'Muscat → Sohar' },
      { id: 'c2', kind: 'delay', status: 'resolved', created_at: '2026-10-04T06:00:00Z', route: null },
    ]));
    await render(<Reports />);
    expect(screen.getByText('Cargo damage')).toBeTruthy();
    expect(screen.getByText('Being looked at')).toBeTruthy();
    expect(screen.getByText('Closed')).toBeTruthy();
  });

  it('shows messages from staff and marks the unread ones read', async () => {
    (queries.useMyMessages as jest.Mock).mockReturnValue(ok([
      { id: 'm1', body: 'Your driver could not come. We are finding another truck.', case_id: 'c1', created_at: '2026-10-06T06:00:00Z', read_at: null },
      { id: 'm2', body: 'Your report is closed.', case_id: 'c2', created_at: '2026-10-05T06:00:00Z', read_at: '2026-10-05T07:00:00Z' },
    ]));
    await render(<Messages />);
    expect(screen.getByText('Your driver could not come. We are finding another truck.')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('mark_message_read', { p_id: 'm1' });
    expect(rpc).not.toHaveBeenCalledWith('mark_message_read', { p_id: 'm2' });
  });
});

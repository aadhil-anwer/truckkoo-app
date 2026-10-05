import { ok, resetQueries } from './harness';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import Verification from '@/app/(app)/verification';
import { initLanguage } from '@/i18n';
import * as queries from '@/lib/queries';
import { supabase } from '@/lib/supabase';

const upload = jest.fn();
const rpc = supabase.rpc as jest.Mock;
const pick = ImagePicker.launchCameraAsync as jest.Mock;
const fetchPhoto = jest.fn();
const originalFetch = global.fetch;
const uid = '77777777-0000-4000-8000-000000000001';

beforeEach(() => {
  initLanguage('en'); resetQueries(queries);
  (queries.useDriverVerification as jest.Mock).mockReturnValue(ok({ documents: [], verifiedAt: null }));
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: uid } } } });
  (supabase.storage.from as jest.Mock).mockReturnValue({ upload });
  upload.mockReset().mockResolvedValue({ error: null });
  rpc.mockReset().mockResolvedValue({ error: null });
  pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///id.jpg', mimeType: 'image/jpeg' }] });
  fetchPhoto.mockReset().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(12) });
  global.fetch = fetchPhoto;
});
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });

async function takePhoto() {
  await act(async () => { fireEvent.press(screen.getByLabelText('Take photo')); });
}

it('uploads privately under the signed-in driver and registers the first evidence item', async () => {
  await render(<Verification />); await takePhoto();
  await act(async () => { fireEvent.press(screen.getByLabelText('Send photo')); });
  expect(supabase.storage.from).toHaveBeenCalledWith('driver-verification');
  expect(upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${uid}/id_front/[0-9a-f-]+[.]jpg$`)),
    expect.any(ArrayBuffer), { contentType: 'image/jpeg', upsert: false });
  expect(rpc).toHaveBeenCalledWith('submit_driver_document', {
    p_kind: 'id_front', p_object_path: upload.mock.calls[0][0],
  });
});

it('rejects oversized actual bytes before uploading or registering evidence', async () => {
  fetchPhoto.mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(8 * 1024 * 1024 + 1) });
  await render(<Verification />); await takePhoto();
  await act(async () => { fireEvent.press(screen.getByLabelText('Send photo')); });
  expect(upload).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  expect(screen.getByText(/8 MB/)).toBeTruthy();
});

it('recovers from a stalled upload without registering evidence later', async () => {
  jest.useFakeTimers();
  let finishUpload!: (value: { error: null }) => void;
  upload.mockImplementation(() => new Promise((resolve) => { finishUpload = resolve; }));
  await render(<Verification />); await takePhoto();
  await act(async () => { fireEvent.press(screen.getByLabelText('Send photo')); });
  await act(async () => { jest.advanceTimersByTime(30_000); });
  expect(screen.getByText(/Could not send or load/)).toBeTruthy();
  await act(async () => { finishUpload({ error: null }); });
  expect(rpc).not.toHaveBeenCalled();
});

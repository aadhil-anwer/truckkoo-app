/**
 * The reporter, at its two boundaries: the OS permission and the RPC.
 *
 * What matters here is not that it reports — it is that it STOPS. Tracking that
 * runs outside a live trip is the thing STACK.md warns about and the thing spec
 * F6 makes structurally impossible server-side; this is the client half.
 */

import { renderHook, waitFor } from '@testing-library/react-native';

const mockRequest = jest.fn();
const mockWatch = jest.fn();
const mockRemove = jest.fn();

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...a: unknown[]) => mockRequest(...a),
  watchPositionAsync: (...a: unknown[]) => mockWatch(...a),
  Accuracy: { Balanced: 3 },
}));

const mockReport = jest.fn();
jest.mock('@/lib/queries', () => ({
  useReportPosition: () => ({ mutateAsync: mockReport }),
}));

import { usePositionReporter } from '@/lib/position';

beforeEach(() => {
  mockRequest.mockReset().mockResolvedValue({ granted: true });
  mockWatch.mockReset().mockResolvedValue({ remove: mockRemove });
  mockRemove.mockReset();
  mockReport.mockReset().mockResolvedValue(true);
});

describe('usePositionReporter', () => {
  it('asks for foreground permission only — never background', async () => {
    await renderHook(() => usePositionReporter('trip-1', true));
    await waitFor(() => expect(mockRequest).toHaveBeenCalled());
    expect(mockWatch).toHaveBeenCalled();
  });

  it('does not watch at all when the trip is not live', async () => {
    await renderHook(() => usePositionReporter('trip-1', false));
    await waitFor(() => expect(mockRequest).not.toHaveBeenCalled());
    expect(mockWatch).not.toHaveBeenCalled();
  });

  it('does not watch without a trip', async () => {
    await renderHook(() => usePositionReporter(undefined, true));
    await waitFor(() => expect(mockWatch).not.toHaveBeenCalled());
  });

  it('stops watching when the trip stops being live', async () => {
    const { rerender } = await renderHook(
      ({ active }: { active: boolean }) => usePositionReporter('trip-1', active),
      { initialProps: { active: true } },
    );
    await waitFor(() => expect(mockWatch).toHaveBeenCalled());

    await rerender({ active: false });
    await waitFor(() => expect(mockRemove).toHaveBeenCalled());
  });

  it('reports a fix through the RPC, with its accuracy', async () => {
    await renderHook(() => usePositionReporter('trip-1', true));
    await waitFor(() => expect(mockWatch).toHaveBeenCalled());

    // The callback the watcher was handed, invoked as the OS would.
    const onFix = mockWatch.mock.calls[0][1] as (r: unknown) => void;
    onFix({ coords: { latitude: 23.588, longitude: 58.408, accuracy: 12 } });

    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith({
        tripId: 'trip-1',
        lat: 23.588,
        lng: 58.408,
        accuracyM: 12,
      }),
    );
  });

  it('reports a denied permission as a state, not as a crash', async () => {
    mockRequest.mockResolvedValue({ granted: false });
    const { result } = await renderHook(() => usePositionReporter('trip-1', true));

    await waitFor(() => expect(result.current.denied).toBe(true));
    expect(mockWatch).not.toHaveBeenCalled();
  });
});

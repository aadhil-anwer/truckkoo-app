import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { useMutation, useQuery } from '@tanstack/react-query';

const mockReport = jest.fn();
jest.mock('@/lib/monitoring', () => ({ reportFailure: (...a: unknown[]) => mockReport(...a) }));
jest.mock('@/lib/session', () => ({ useSession: () => ({ session: { user: { id: 'A' } } }) }));

import { AccountQueryProvider } from '@/lib/account-query-provider';

beforeEach(() => mockReport.mockClear());

function Write({ fail }: { fail: unknown }) {
  const m = useMutation({ meta: { flow: 'book_load' }, mutationFn: async () => { throw fail; } });
  return <Text onPress={() => m.mutate()}>{m.isError ? 'shown' : 'idle'}</Text>;
}

function Read({ fail }: { fail: unknown }) {
  const q = useQuery({ queryKey: ['loads', 'mine'], queryFn: async () => { throw fail; }, retry: false });
  return <Text>{q.isError ? 'read-failed' : 'reading'}</Text>;
}

it('reports a failed write by its flow, and the screen still shows its own error', async () => {
  const error = { message: 'price changed', code: 'P0001' };
  const view = await render(<AccountQueryProvider><Write fail={error} /></AccountQueryProvider>);
  await act(async () => { view.getByText('idle').props.onPress(); });
  await waitFor(() => expect(view.getByText('shown')).toBeTruthy());
  expect(mockReport).toHaveBeenCalledWith('book_load', error);
});

it('reports a write that failed for want of signal — someone tapped and it did not happen', async () => {
  const error = new TypeError('Network request failed');
  const view = await render(<AccountQueryProvider><Write fail={error} /></AccountQueryProvider>);
  await act(async () => { view.getByText('idle').props.onPress(); });
  await waitFor(() => expect(mockReport).toHaveBeenCalledWith('book_load', error));
});

it('reports a read that failed for a real reason, named by its key', async () => {
  const error = { message: 'permission denied', code: '42501' };
  const view = await render(<AccountQueryProvider><Read fail={error} /></AccountQueryProvider>);
  await waitFor(() => expect(view.getByText('read-failed')).toBeTruthy());
  expect(mockReport).toHaveBeenCalledWith('read:loads', error);
});

it('does not report a read that failed for want of signal — that is weather, not a bug', async () => {
  const view = await render(<AccountQueryProvider><Read fail={new TypeError('Network request failed')} /></AccountQueryProvider>);
  await waitFor(() => expect(view.getByText('read-failed')).toBeTruthy());
  expect(mockReport).not.toHaveBeenCalled();
});

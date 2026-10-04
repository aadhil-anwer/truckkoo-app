import { useEffect, useState, type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider, isCancelledError } from '@tanstack/react-query';
import { reportFailure } from './monitoring';
import { useSession } from './session';

/**
 * A read that failed for want of signal. Every screen polls, and a phone in a
 * cab loses signal all day: reporting each one would bury real failures and
 * spend the error quota on weather. A write that fails this way IS reported —
 * someone tapped Book and it did not happen.
 */
function offline(error: unknown): boolean {
  // Cancelled on purpose: sign-out and account switches cancel every read.
  if (isCancelledError(error)) return true;
  const { name, message } = (error ?? {}) as { name?: unknown; message?: unknown };
  return name === 'AbortError'
    || (typeof message === 'string' && /network request failed|failed to fetch|fetch failed|timed out/i.test(message));
}

// Every write names its flow in `meta.flow` (queries.ts); a read is named by
// the first part of its key. The screen still shows its own error — this only
// makes sure a person hears about it too.
//
// A function, not a constant: the caches ARE the cached data, so a module-level
// pair would be shared by every account's client on this phone.
const reporting = () => ({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (!offline(error)) reportFailure(`read:${String(query.queryKey[0])}`, error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      reportFailure(String(mutation.meta?.flow ?? 'write'), error);
    },
  }),
});

function ScopedCache({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    ...reporting(),
    defaultOptions: {
      queries: { retry: 2, staleTime: 30_000, refetchOnWindowFocus: false },
    },
  }));

  useEffect(() => () => {
    // The old client's results must not be retained when another person uses
    // this phone. Even a late request remains attached only to this old client.
    void client.cancelQueries();
    client.clear();
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function AccountQueryProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  return <ScopedCache key={session?.user.id ?? 'signed-out'}>{children}</ScopedCache>;
}

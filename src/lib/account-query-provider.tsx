import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSession } from './session';

function ScopedCache({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
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

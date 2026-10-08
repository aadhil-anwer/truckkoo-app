/**
 * What the screens read about notifications. Apart from the provider so that a
 * screen reading the state does not pull in the router and the native module.
 */
import { createContext, useContext } from 'react';

import type { PushAccess } from '@/lib/push';

type Ctx = {
  access: PushAccess | null;
  /** The notification question is done for this opening of the app. */
  settled: boolean;
  request: () => Promise<PushAccess>;
  decline: () => Promise<void>;
  /** The screen closed without an answer (back gesture): done for this opening. */
  settle: () => void;
};

export const PushCtx = createContext<Ctx>({
  access: null,
  settled: true,
  request: async () => 'denied',
  decline: async () => {},
  settle: () => {},
});

export function usePush() {
  return useContext(PushCtx);
}


/** Session and profile must always belong to the same account. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearAuthDraft } from './auth-draft';
import { clearLegDraft } from './leg-draft';
import { supabase } from './supabase';

export type Role = 'shipper' | 'driver';
export type Profile = {
  id: string;
  role: Role;
  full_name: string | null;
  phone: string | null;
  language: string;
};

type SessionState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<SessionState>({
  session: null,
  profile: null,
  loading: true,
  error: false,
  retry: () => {},
  refreshProfile: async () => {},
});

const SESSION_DEADLINE_MS = 8_000;

async function bounded<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Session request timed out')), SESSION_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Pick<SessionState, 'session' | 'profile' | 'loading' | 'error'>>({
    session: null, profile: null, loading: true, error: false,
  });
  const mounted = useRef(false);
  const owner = useRef<string | null>(null);
  const generation = useRef(0);
  const authRevision = useRef(0);

  // `quiet`: a background refresh. It never raises `loading` (the Gate would
  // unmount the screen that asked) and a failure keeps what is already shown.
  const loadProfile = useCallback(async (userId: string, ticket: number, quiet = false) => {
    try {
      // Explicit columns only: adding a field must not expose it automatically.
      const { data, error } = await bounded(supabase.from('profiles')
        .select('id, role, full_name, phone, language')
        .eq('id', userId)
        .maybeSingle());
      if (error) throw error;
      if (mounted.current && owner.current === userId && generation.current === ticket) {
        setState((previous) => ({ ...previous, profile: (data as Profile) ?? null, loading: false, error: false }));
      }
    } catch {
      if (quiet) return;
      if (mounted.current && owner.current === userId && generation.current === ticket) {
        // A failed read is not evidence that a profile is missing. Gate shows
        // recovery instead of sending an existing user through signup.
        setState((previous) => ({ ...previous, profile: null, loading: false, error: true }));
      }
    }
  }, []);

  const acceptSession = useCallback((next: Session | null) => {
    if (!mounted.current) return;
    const nextOwner = next?.user.id ?? null;
    const previousOwner = owner.current;
    if (previousOwner === nextOwner) {
      setState((previous) => ({
        ...previous,
        session: next,
        loading: nextOwner ? previous.loading : false,
        error: nextOwner ? previous.error : false,
      }));
      return;
    }
    owner.current = nextOwner;
    const ticket = ++generation.current;
    if (previousOwner) {
      clearAuthDraft();
      clearLegDraft();
    }
    setState({ session: next, profile: null, loading: !!nextOwner, error: false });
    if (nextOwner) void loadProfile(nextOwner, ticket);
  }, [loadProfile]);

  const bootstrap = useCallback(async () => {
    const revision = authRevision.current;
    try {
      const { data, error } = await bounded(supabase.auth.getSession());
      if (error) throw error;
      if (mounted.current && authRevision.current === revision) acceptSession(data.session);
    } catch {
      if (mounted.current && authRevision.current === revision) {
        setState((previous) => ({ ...previous, loading: false, error: true }));
      }
    }
  }, [acceptSession]);

  useEffect(() => {
    mounted.current = true;
    // The former global key cannot be attributed to an account. Discard it
    // rather than migrating another person's cargo/contact answers.
    void AsyncStorage.removeItem('truckkoo.booking.draft.v1').catch(() => {});
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      // Supabase's auth callback must return synchronously. Never await a
      // profile/network request while the SDK is handling an auth event.
      authRevision.current += 1;
      acceptSession(next);
    });
    void bootstrap();
    return () => {
      mounted.current = false;
      generation.current += 1;
      sub.subscription.unsubscribe();
    };
  }, [acceptSession, bootstrap]);

  const refreshProfile = useCallback(async () => {
    const userId = owner.current;
    if (!userId) return;
    await loadProfile(userId, ++generation.current, true);
  }, [loadProfile]);

  const retry = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, error: false }));
    const userId = owner.current;
    if (userId) {
      void loadProfile(userId, ++generation.current);
      return;
    }
    void bootstrap();
  }, [bootstrap, loadProfile]);

  const value = useMemo<SessionState>(() => ({ ...state, retry, refreshProfile }), [state, retry, refreshProfile]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  return useContext(Ctx);
}

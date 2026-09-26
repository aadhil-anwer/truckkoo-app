/**
 * Session + profile context.
 *
 * Two things the rest of the app depends on:
 *   1. is there a session (drives the auth gate)
 *   2. what role is this user (drives which app they see)
 *
 * Role comes from the `profiles` row, never from client state — it is what every
 * RLS policy keys off, so the client must read the same source the database uses.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';

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
  /** True until we know both session and (if signed in) profile. */
  loading: boolean;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<SessionState>({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string | undefined) {
    if (!userId) {
      setProfile(null);
      return;
    }
    // Explicit column list, never select('*') across a trust boundary
    // (SECURITY.md §10). Adding a column must not auto-expose it.
    const { data } = await supabase
      .from('profiles')
      .select('id, role, full_name, phone, language')
      .eq('id', userId)
      .maybeSingle();

    setProfile((data as Profile) ?? null);
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      if (!cancelled) setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      // Profile first, THEN the session, so the Gate never sees a session without
      // the profile that goes with it. The other order routed every returning
      // user through the role question for a frame — "Which one are you?",
      // flashed at someone who answered it months ago.
      //
      // A brand-new signup has no profile row yet, so this legitimately comes
      // back null — and that is exactly the state the Gate sends to the role.
      await loadProfile(next?.user.id);
      setSession(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      session,
      profile,
      loading,
      refreshProfile: () => loadProfile(session?.user.id),
    }),
    [session, profile, loading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  return useContext(Ctx);
}

/**
 * Where exactly — the client side of shipper places (0041).
 *
 * Search goes through our `places` Edge Function; this file never sees a Google
 * key. Names for a GPS point or a dragged pin come from the PHONE's geocoder,
 * which is free and keyless. The city is always the server's (`city_near`), so
 * "Near Barka" and the city book_load checks are one rule, not two.
 *
 * Every failure here resolves to null or `failed`, never a throw: the screen's
 * answer to any of them is the city list, which always works.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

import { getLanguage } from '@/i18n';
import { supabase } from '@/lib/supabase';

export type Suggestion = { placeId: string; main: string; secondary: string };
export type PickedPlace = { lat: number; lng: number; placeName: string | null };
type Status = 'idle' | 'loading' | 'ready' | 'failed';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

/** Uniqueness, not secrecy: a session token only groups one search for billing. */
export function newSessionToken(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const n = (count: number) => Array.from({ length: count }, hex).join('');
  const variant = '89ab'[Math.floor(Math.random() * 4)];
  return `${n(8)}-${n(4)}-4${n(3)}-${variant}${n(3)}-${n(12)}`;
}

function language(): 'en' | 'ar' {
  return getLanguage() === 'ar' ? 'ar' : 'en';
}

export function usePlaceSearch() {
  const [query, setQueryState] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const session = useRef(newSessionToken());
  const latest = useRef(0);

  // A query too short to search clears the list here, in the event, rather than
  // in the effect: and it retires any search still in flight.
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    if (next.trim().length < MIN_CHARS) {
      latest.current += 1;
      setSuggestions([]);
      setStatus('idle');
    }
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setStatus('loading');
      const { data, error } = await supabase.functions.invoke('places', {
        body: { action: 'autocomplete', input: q, sessionToken: session.current, language: language() },
      });
      if (ticket !== latest.current) return; // a newer query owns the screen
      const list = (data as { suggestions?: Suggestion[] } | null)?.suggestions;
      if (error || !list) {
        setSuggestions([]);
        setStatus('failed');
        return;
      }
      setSuggestions(list);
      setStatus('ready');
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const pick = useCallback(async (s: Suggestion): Promise<PickedPlace | null> => {
    const { data, error } = await supabase.functions.invoke('places', {
      body: { action: 'details', placeId: s.placeId, sessionToken: session.current, language: language() },
    });
    // The Details call ends the billing session, whatever it returned.
    session.current = newSessionToken();
    const place = (data as { place?: { lat: number; lng: number } } | null)?.place;
    if (error || !place) {
      setStatus('failed');
      return null;
    }
    return { lat: place.lat, lng: place.lng, placeName: s.main };
  }, []);

  return { query, setQuery, suggestions, status, pick };
}

export async function cityNear(lat: number, lng: number): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('city_near', { p_lat: lat, p_lng: lng });
    if (error || data == null) return null;
    return Number(data);
  } catch {
    return null;
  }
}

export async function nameAt(lat: number, lng: number): Promise<string | null> {
  try {
    const [r] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!r) return null;
    const parts = [r.name, r.district ?? r.city].filter((p): p is string => !!p && p.trim().length > 0);
    const unique = parts.filter((p, i) => parts.indexOf(p) === i);
    return unique.length ? unique.join(', ') : null;
  } catch {
    return null;
  }
}

/** How long to wait for a fresh GPS fix before falling back. */
const FIX_TIMEOUT_MS = 10_000;
/** A last-known fix older than this is somewhere the shipper no longer is. */
const LAST_FIX_MAX_AGE_MS = 5 * 60_000;

/** "Ship from where I am." Null when refused or unavailable — the row just goes. */
export async function currentPlace(): Promise<PickedPlace | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    // Indoors, or with the GPS just switched on, a fresh fix can take minutes or
    // never come. Wait a while, then take the phone's last fix if it is recent;
    // otherwise give up so the row goes and the shipper searches instead.
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
    ]);
    const fix = fresh ?? (await Location.getLastKnownPositionAsync({ maxAge: LAST_FIX_MAX_AGE_MS }));
    if (!fix) return null;
    const { latitude: lat, longitude: lng } = fix.coords;
    return { lat, lng, placeName: await nameAt(lat, lng) };
  } catch {
    return null;
  }
}

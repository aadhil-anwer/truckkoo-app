/**
 * @jest-environment node
 *
 * The Node environment, not jest-expo's: the function uses the web-standard
 * Request, Response and AbortSignal.timeout, as Deno provides them.
 *
 * The places Edge Function, run under Jest with a fake fetch.
 *
 * Everything that matters is in core.ts: what Google is asked (the field mask
 * decides the bill), what the app is told (never Google's raw payload), and that
 * the quota is spent as the CALLER — the function holds no service-role key.
 */
import { handle, REGIONS, type Deps } from '../../supabase/functions/places/core';

const SESSION = '0b9e8f6e-1c2d-4a5b-8c7d-6e5f4a3b2c1d';

function deps(responses: Record<string, { status: number; body: unknown }>): Deps & { calls: [string, RequestInit][] } {
  const calls: [string, RequestInit][] = [];
  const fakeFetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push([u, init ?? {}]);
    const hit = Object.keys(responses).find((k) => u.includes(k));
    if (!hit) throw new Error(`unexpected fetch ${u}`);
    const r = responses[hit];
    // A 204 may not carry a body — that is PostgREST's answer for a void RPC.
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status });
  });
  return { key: 'google-key', supabaseUrl: 'https://proj.supabase.co', anonKey: 'anon', fetch: fakeFetch as unknown as typeof fetch, calls };
}

function post(body: unknown, auth = 'Bearer user-jwt') {
  return new Request('https://fn/places', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const QUOTA_OK = { 'rpc/use_places_quota': { status: 204, body: null } };

it('spends the quota as the caller, then asks Google for GCC suggestions', async () => {
  const d = deps({
    ...QUOTA_OK,
    'places:autocomplete': {
      status: 200,
      body: { suggestions: [{ placePrediction: {
        placeId: 'ChIJabc123', text: { text: 'Lulu Barka, Barka, Oman' },
        structuredFormat: { mainText: { text: 'Lulu Barka' }, secondaryText: { text: 'Barka, Oman' } },
      } }] },
    },
  });
  const res = await handle(post({ action: 'autocomplete', input: 'lulu bar', sessionToken: SESSION, language: 'en' }), d);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ suggestions: [{ placeId: 'ChIJabc123', main: 'Lulu Barka', secondary: 'Barka, Oman' }] });

  const [quotaUrl, quotaInit] = d.calls[0];
  expect(quotaUrl).toBe('https://proj.supabase.co/rest/v1/rpc/use_places_quota');
  expect((quotaInit.headers as Record<string, string>).Authorization).toBe('Bearer user-jwt');
  expect(JSON.parse(String(quotaInit.body))).toEqual({ p_kind: 'autocomplete' });

  const sent = JSON.parse(String(d.calls[1][1].body));
  expect(sent.includedRegionCodes).toEqual(REGIONS);
  expect(sent.sessionToken).toBe(SESSION);
  expect(sent.languageCode).toBe('en');
  expect((d.calls[1][1].headers as Record<string, string>)['X-Goog-Api-Key']).toBe('google-key');
});

it('asks Place Details for location and address only — the cheap tier', async () => {
  const d = deps({
    ...QUOTA_OK,
    'places/ChIJabc123': {
      status: 200,
      body: { location: { latitude: 23.69, longitude: 57.88 }, formattedAddress: 'Barka, Oman', displayName: { text: 'x' } },
    },
  });
  const res = await handle(post({ action: 'details', placeId: 'ChIJabc123', sessionToken: SESSION, language: 'ar' }), d);
  expect(await res.json()).toEqual({ place: { lat: 23.69, lng: 57.88, address: 'Barka, Oman' } });
  const [url, init] = d.calls[1];
  expect(url).toContain(`sessionToken=${SESSION}`);
  expect(url).toContain('languageCode=ar');
  expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe('location,formattedAddress');
});

it('says "limited" when the shipper has used their hour, and never calls Google', async () => {
  const d = deps({ 'rpc/use_places_quota': { status: 400, body: { message: 'rate limit exceeded' } } });
  const res = await handle(post({ action: 'autocomplete', input: 'sohar', sessionToken: SESSION, language: 'en' }), d);
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ error: 'limited' });
  expect(d.calls).toHaveLength(1);
});

it('says "unavailable" when Google fails, without passing its body on', async () => {
  const d = deps({ ...QUOTA_OK, 'places:autocomplete': { status: 500, body: { error: { message: 'internal detail' } } } });
  const res = await handle(post({ action: 'autocomplete', input: 'sohar', sessionToken: SESSION, language: 'en' }), d);
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: 'unavailable' });
});

it.each([
  [{ action: 'autocomplete', input: 'x'.repeat(101), sessionToken: SESSION, language: 'en' }],
  [{ action: 'autocomplete', input: 'ok', sessionToken: 'not-a-uuid', language: 'en' }],
  [{ action: 'autocomplete', input: 'ok', sessionToken: SESSION, language: 'fr' }],
  [{ action: 'details', placeId: '../../v1/other', sessionToken: SESSION, language: 'en' }],
  [{ action: 'geocode' }],
])('refuses a malformed request before spending anything: %j', async (body) => {
  const d = deps({});
  const res = await handle(post(body), d);
  expect(res.status).toBe(400);
  expect(d.calls).toHaveLength(0);
});

it('refuses a request with no user token', async () => {
  const d = deps({});
  const res = await handle(post({ action: 'autocomplete', input: 'x', sessionToken: SESSION, language: 'en' }, ''), d);
  expect(res.status).toBe(401);
  expect(d.calls).toHaveLength(0);
});

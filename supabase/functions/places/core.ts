/**
 * The places Edge Function — all of it, as plain TypeScript.
 *
 * No Deno imports, so Jest runs it with a fake fetch; index.ts only hands it
 * the environment. Three things it guarantees:
 *
 * 1. THE KEY STAYS HERE. The app never holds the Google Places key.
 * 2. THE QUOTA IS THE CALLER'S. `use_places_quota` is called with the user's
 *    own JWT, so no service-role key exists anywhere in this function.
 * 3. THE BILL IS BOUNDED. Place Details asks for `location,formattedAddress`
 *    only (Essentials tier), and autocomplete sessions end in one Details call,
 *    which makes the suggestions themselves free.
 */

export const REGIONS = ['OM', 'AE', 'SA', 'QA', 'KW', 'BH'];
const OMAN_BIAS = { rectangle: { low: { latitude: 16.6, longitude: 52.0 }, high: { latitude: 26.4, longitude: 59.9 } } };
const TIMEOUT_MS = 5000;

export type Deps = { key: string; supabaseUrl: string; anonKey: string; fetch: typeof fetch };
type Lang = 'en' | 'ar';
type Body =
  | { action: 'autocomplete'; input: string; sessionToken: string; language: Lang }
  | { action: 'details'; placeId: string; sessionToken: string; language: Lang };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function parse(raw: unknown): Body | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (b.language !== 'en' && b.language !== 'ar') return null;
  if (typeof b.sessionToken !== 'string' || !UUID.test(b.sessionToken)) return null;
  if (b.action === 'autocomplete') {
    if (typeof b.input !== 'string') return null;
    const input = b.input.trim();
    if (input.length < 1 || input.length > 100) return null;
    return { action: 'autocomplete', input, sessionToken: b.sessionToken, language: b.language };
  }
  if (b.action === 'details') {
    if (typeof b.placeId !== 'string' || !PLACE_ID.test(b.placeId)) return null;
    return { action: 'details', placeId: b.placeId, sessionToken: b.sessionToken, language: b.language };
  }
  return null;
}

async function spendQuota(auth: string, kind: Body['action'], d: Deps): Promise<'ok' | 'limited' | 'failed'> {
  try {
    const res = await d.fetch(`${d.supabaseUrl}/rest/v1/rpc/use_places_quota`, {
      method: 'POST',
      headers: { apikey: d.anonKey, Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_kind: kind }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return 'ok';
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    return body.message?.includes('rate limit') ? 'limited' : 'failed';
  } catch {
    return 'failed';
  }
}

async function autocomplete(b: Extract<Body, { action: 'autocomplete' }>, d: Deps) {
  const res = await d.fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': d.key },
    body: JSON.stringify({
      input: b.input,
      sessionToken: b.sessionToken,
      languageCode: b.language,
      includedRegionCodes: REGIONS,
      locationBias: OMAN_BIAS,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    suggestions?: { placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    } }[];
  };
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
    .map((p) => ({
      placeId: p.placeId as string,
      main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondary: p.structuredFormat?.secondaryText?.text ?? '',
    }))
    .filter((s) => s.main.length > 0);
}

async function details(b: Extract<Body, { action: 'details' }>, d: Deps) {
  const url =
    `https://places.googleapis.com/v1/places/${b.placeId}` +
    `?sessionToken=${encodeURIComponent(b.sessionToken)}&languageCode=${b.language}`;
  const res = await d.fetch(url, {
    method: 'GET',
    headers: { 'X-Goog-Api-Key': d.key, 'X-Goog-FieldMask': 'location,formattedAddress' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { location?: { latitude?: number; longitude?: number }; formattedAddress?: string };
  const lat = data.location?.latitude;
  const lng = data.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng, address: data.formattedAddress ?? '' };
}

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'bad_request' });
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'unauthorized' });

  const body = parse(await req.json().catch(() => null));
  if (!body) return json(400, { error: 'bad_request' });

  const quota = await spendQuota(auth, body.action, d);
  if (quota === 'limited') return json(429, { error: 'limited' });
  if (quota === 'failed') return json(503, { error: 'unavailable' });

  try {
    if (body.action === 'autocomplete') {
      const suggestions = await autocomplete(body, d);
      return suggestions ? json(200, { suggestions }) : json(503, { error: 'unavailable' });
    }
    const place = await details(body, d);
    return place ? json(200, { place }) : json(503, { error: 'unavailable' });
  } catch {
    return json(503, { error: 'unavailable' });
  }
}

-- 0073 · Driving distance from Google, between the two pins.
--
-- Founder's ask, 2026-10-07. Since 0069 a pickup is priced per km between its
-- pins, measured as a straight line × road_factor_pct (135). In Muscat, roads
-- wrap round mountains and wadis, so that is often well off — and a driver
-- checks the price against Google Maps.
--
-- How:
--   * Google's Routes API (computeRoutes, DRIVE, traffic-unaware) is called
--     FROM THE DATABASE, never from the app. Distance sets the price, and the
--     app never supplies an input to a price (CLAUDE.md 3b). The key lives in
--     Supabase Vault as `google_routes_api_key`; no key = this is off.
--   * Called only on the two pricing paths that write: quote_trip (the price
--     preview, volatile) and the moment a load's pins are saved (a trigger on
--     load_places — post_load saves the pins before issue_quote prices them).
--     Never from a read: PostgREST runs stable functions read-only.
--   * Every answer is cached by pin pair, rounded to 4 decimals (~11 m), so
--     the preview and the booking price the same distance, and the same trip
--     is never paid for twice. road_km_between reads the cache, else falls
--     back to the straight line × factor — so a Google outage, a slow answer
--     (3 s timeout) or a missing key never stops a booking; it prices as before.
--   * An answer is distrusted, and not cached, if it is shorter than the
--     straight line (impossible on a road) or more than 5× it (a route snapped
--     to the wrong side of a wadi). Failures are logged via log_system.
--
-- Privacy: the two pins (not the shipper's name, phone or cargo) are sent to
-- Google. The pin screen already runs on Google Maps on Android.

create extension if not exists http with schema extensions;

-- ═══ 1. the cache ════════════════════════════════════════════════════════════
create table if not exists private.road_km_cache (
  o_lat      numeric(7,4) not null,
  o_lng      numeric(7,4) not null,
  d_lat      numeric(7,4) not null,
  d_lng      numeric(7,4) not null,
  km         numeric(7,1) not null check (km > 0),
  source     text not null default 'google' check (source in ('google')),
  fetched_at timestamptz not null default now(),
  primary key (o_lat, o_lng, d_lat, d_lng)
);
revoke all on private.road_km_cache from public, anon, authenticated;
alter table private.road_km_cache enable row level security;
alter table private.road_km_cache force row level security;
comment on table private.road_km_cache is
  'Driving km between rounded pin pairs, from Google Routes (0073). No client grant; read by road_km_between.';

-- ═══ 2. the straight line, kept as the fallback ══════════════════════════════
create or replace function private.straight_road_km(
  p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_km     numeric;
  v_factor numeric;
begin
  if p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then
    return null;
  end if;
  v_km := 2 * 6371 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)));
  select coalesce((value #>> '{}')::numeric, 135) into v_factor
    from private.app_settings where key = 'road_factor_pct';
  return round(v_km * coalesce(v_factor, 135) / 100, 1);
end;
$$;
revoke all on function private.straight_road_km(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

-- ═══ 3. reading: the cache, else the straight line ═══════════════════════════
create or replace function private.road_km_between(
  p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_km numeric;
begin
  if p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then
    return null;
  end if;
  select c.km into v_km
    from private.road_km_cache c
   where c.o_lat = round(p_lat1::numeric, 4) and c.o_lng = round(p_lng1::numeric, 4)
     and c.d_lat = round(p_lat2::numeric, 4) and c.d_lng = round(p_lng2::numeric, 4);
  return coalesce(v_km, private.straight_road_km(p_lat1, p_lng1, p_lat2, p_lng2));
end;
$$;
revoke all on function private.road_km_between(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

-- ═══ 4. Google's answer, judged ══════════════════════════════════════════════
-- No network, so the tests can feed it responses without calling Google.
create or replace function private.routes_km_from_response(p_status integer, p_body text, p_straight_km numeric)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v_km numeric;
begin
  if p_status is distinct from 200 or p_body is null or p_straight_km is null then
    return null;
  end if;
  begin
    v_km := round(((p_body::jsonb) #>> '{routes,0,distanceMeters}')::numeric / 1000, 1);
  exception when others then
    return null;
  end;
  if v_km is null or v_km <= 0 then
    return null;
  end if;
  -- A road is never shorter than the straight line (0.95: the rounding of a
  -- very short hop), and 5× it is a route to the wrong place.
  if v_km < p_straight_km * 100 / private.setting_int('road_factor_pct', 135) * 0.95
     or v_km > p_straight_km * 100 / private.setting_int('road_factor_pct', 135) * 5 then
    return null;
  end if;
  return v_km;
end;
$$;
revoke all on function private.routes_km_from_response(integer, text, numeric) from public, anon, authenticated;

-- ═══ 5. asking Google ════════════════════════════════════════════════════════
-- Never raises: every failure is null, logged, and the straight line prices.
create or replace function private.google_road_km(
  p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
)
returns numeric
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key      text;
  v_resp     extensions.http_response;
  v_straight numeric := private.straight_road_km(p_lat1::float8, p_lng1::float8, p_lat2::float8, p_lng2::float8);
  v_km       numeric;
begin
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'google_routes_api_key';
  if v_key is null or btrim(v_key) = '' then
    return null;
  end if;
  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '3000');
    v_resp := extensions.http((
      'POST',
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      array[extensions.http_header('X-Goog-Api-Key', v_key),
            extensions.http_header('X-Goog-FieldMask', 'routes.distanceMeters')],
      'application/json',
      jsonb_build_object(
        'origin', jsonb_build_object('location', jsonb_build_object('latLng',
                    jsonb_build_object('latitude', p_lat1, 'longitude', p_lng1))),
        'destination', jsonb_build_object('location', jsonb_build_object('latLng',
                    jsonb_build_object('latitude', p_lat2, 'longitude', p_lng2))),
        'travelMode', 'DRIVE',
        'routingPreference', 'TRAFFIC_UNAWARE')::text
    )::extensions.http_request);
  exception when others then
    -- SQLSTATE only: a message could carry the request, and so the key.
    perform private.log_system('google_road_km_failed', 'route', null,
      jsonb_build_object('sqlstate', sqlstate));
    return null;
  end;
  v_km := private.routes_km_from_response(v_resp.status, v_resp.content, v_straight);
  if v_km is null then
    perform private.log_system('google_road_km_failed', 'route', null,
      jsonb_build_object('status', v_resp.status, 'estimate_km', v_straight));
  end if;
  return v_km;
end;
$$;
revoke all on function private.google_road_km(numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- Cache first; on a miss ask Google and keep a good answer. Never raises.
create or replace function private.fetch_road_km(
  p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision
)
returns numeric
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_o_lat numeric := round(p_lat1::numeric, 4);
  v_o_lng numeric := round(p_lng1::numeric, 4);
  v_d_lat numeric := round(p_lat2::numeric, 4);
  v_d_lng numeric := round(p_lng2::numeric, 4);
  v_km    numeric;
begin
  if p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then
    return null;
  end if;
  select c.km into v_km from private.road_km_cache c
   where c.o_lat = v_o_lat and c.o_lng = v_o_lng and c.d_lat = v_d_lat and c.d_lng = v_d_lng;
  if v_km is not null then
    return v_km;
  end if;
  v_km := private.google_road_km(v_o_lat, v_o_lng, v_d_lat, v_d_lng);
  if v_km is not null then
    insert into private.road_km_cache (o_lat, o_lng, d_lat, d_lng, km)
    values (v_o_lat, v_o_lng, v_d_lat, v_d_lng, v_km)
    on conflict (o_lat, o_lng, d_lat, d_lng) do nothing;
  end if;
  return v_km;
end;
$$;
revoke all on function private.fetch_road_km(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

-- ═══ 6. when a load's pins are saved ═════════════════════════════════════════
-- post_load saves both pins, then issue_quote prices through load_km →
-- road_km_between, which now finds this answer in the cache.
create or replace function private.load_places_fetch_km()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.load_places;
  v_d public.load_places;
begin
  select * into v_o from public.load_places p where p.load_id = new.load_id and p.kind = 'pickup';
  select * into v_d from public.load_places p where p.load_id = new.load_id and p.kind = 'drop';
  if v_o.load_id is not null and v_d.load_id is not null then
    perform private.fetch_road_km(v_o.lat, v_o.lng, v_d.lat, v_d.lng);
  end if;
  return null;
end;
$$;
revoke all on function private.load_places_fetch_km() from public, anon, authenticated;

drop trigger if exists load_places_fetch_km on public.load_places;
create trigger load_places_fetch_km
  after insert or update of lat, lng on public.load_places
  for each row execute function private.load_places_fetch_km();

-- ═══ 7. the price preview asks too (0069's body, one line added) ═════════════
create or replace function public.quote_trip(
  p_origin_city bigint, p_dest_city bigint, p_truck_type_code text default null, p_weight_kg integer default null,
  p_origin_lat double precision default null, p_origin_lng double precision default null,
  p_dest_lat double precision default null, p_dest_lng double precision default null
)
returns table (price_baisa bigint, currency character, outcome text, truck_type_code text, km numeric,
               wait_free_minutes integer, wait_per_15min_baisa bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_from   jsonb;
  v_to     jsonb;
  v_km     numeric;
  v_r      record;
  v_rate   private.rate_cards;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if (select private.actor_role()) <> 'shipper' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  perform private.check_rate_limit('quote_route', 30, interval '1 hour');

  if p_origin_city is null or p_dest_city is null then
    raise exception 'route required' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.cities c where c.id = p_origin_city)
     or not exists (select 1 from public.cities c where c.id = p_dest_city) then
    raise exception 'unknown city' using errcode = 'foreign_key_violation';
  end if;
  if p_weight_kg is not null and (p_weight_kg <= 0 or p_weight_kg > 60000) then
    raise exception 'weight out of range' using errcode = 'check_violation';
  end if;
  if p_truck_type_code is not null
     and not exists (select 1 from public.truck_types t where t.code = p_truck_type_code) then
    raise exception 'unknown truck type' using errcode = 'foreign_key_violation';
  end if;
  if (p_origin_lat is null) <> (p_origin_lng is null) or (p_dest_lat is null) <> (p_dest_lng is null) then
    raise exception 'a place needs both coordinates' using errcode = 'check_violation';
  end if;

  if p_origin_lat is not null then
    v_from := jsonb_build_object('lat', p_origin_lat, 'lng', p_origin_lng);
    if private.place_city(v_from) is distinct from p_origin_city then
      raise exception 'city does not match place' using errcode = 'check_violation';
    end if;
  end if;
  if p_dest_lat is not null then
    v_to := jsonb_build_object('lat', p_dest_lat, 'lng', p_dest_lng);
    if private.place_city(v_to) is distinct from p_dest_city then
      raise exception 'city does not match place' using errcode = 'check_violation';
    end if;
  end if;
  perform private.check_same_city(p_origin_city, p_dest_city, v_from, v_to);

  -- The same measure load_km applies once the load exists: pins when both are
  -- set, towns otherwise. Same inputs, same price.
  -- 0073: ask Google for the driving distance once; road_km_between then reads it
  -- from the cache, here and again in load_km when the load is booked.
  perform private.fetch_road_km(p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng);
  v_km := coalesce(private.road_km_between(p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng),
                   private.route_km(p_origin_city, p_dest_city));
  select * into v_r from private.price_for_km(p_origin_city, p_dest_city, p_truck_type_code, p_weight_kg, v_km);
  if v_r.outcome = 'quoted' then
    select * into v_rate from private.rate_cards rc where rc.id = v_r.rate_card_id;
  end if;

  return query select
    v_r.price_baisa, v_r.currency, v_r.outcome,
    case when v_r.outcome = 'quoted' then private.resolve_truck_type(p_truck_type_code, p_weight_kg) end,
    v_km, v_rate.wait_free_minutes, v_rate.wait_per_15min_baisa;
end;
$$;
revoke all on function public.quote_trip(bigint, bigint, text, integer, double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.quote_trip(bigint, bigint, text, integer, double precision, double precision, double precision, double precision) to authenticated;

-- 0036 · Automatic dispatch, the Uber/Porter way.
--
-- The founder's brief: no dispatcher approving loads or hand-matching drivers.
-- Until now a human was needed in practice, for four reasons this file removes:
--
--   1. "Let us choose the truck" — the recommended default — produced no price
--      (`price_for` → 'advise_me'), so it always went to a person.
--   2. Auto-dispatch asked at most three drivers, ONCE, with offers alive for 48
--      hours; when they lapsed the load fell to `finding_truck` and a person.
--   3. Eligibility ignored where a driver is and whether they are working, so a
--      Salalah driver could be offered a Muscat pickup.
--
-- (`require_verified_driver` stays off for now — see section 4.)
--
-- What replaces it, borrowed from the products the founder pointed at:
--
--   * Uber Freight's instant upfront price: "let us choose" + a known weight is
--     priced for the smallest truck that fits, and booking at that price is
--     accepting it (`book_load`).
--   * Porter's waves: the load is offered to the best few drivers at once, first
--     to accept wins; nobody takes it in `dispatch_wave_minutes` → the next few,
--     over a WIDER radius. After `dispatch_max_waves` a dispatcher is alerted.
--     A person is the last wave, not the first — non-negotiable #6 holds.
--   * Uber's "go online": `driver_availability`, a switch plus the city the truck
--     is in (snapped from GPS — no coordinates are kept — or where the driver's
--     last delivery ended). Delivering puts the driver back online at the
--     destination, which is exactly the return load Uber Freight recommends.
--
-- Unchanged on purpose: `loads.truck_type_code` stays NULL for "advise me" (#1);
-- the pricing formula stays in SQL; `candidates_for` stays ungranted; the first
-- accept still wins inside `accept_offer`'s row lock.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. An instant price for "let us choose"
-- ════════════════════════════════════════════════════════════════════════════

-- The smallest truck that carries the weight. NULL when the weight is unknown or
-- nothing carries it — those loads still go to a person, by design.
create or replace function private.resolve_truck_type(p_code text, p_weight_kg integer)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_code is not null then p_code
    when p_weight_kg is null then null
    else (
      select tt.code from public.truck_types tt
      where tt.capacity_kg >= p_weight_kg
      order by tt.capacity_kg asc, tt.sort asc
      limit 1
    )
  end;
$$;

revoke all on function private.resolve_truck_type(text, integer) from public, anon, authenticated;

-- `price_for` from 0010/0021, with one change: a NULL type is resolved before
-- anything is looked up. 0010 refused this deliberately ("choosing a type on the
-- shipper's behalf ... would quote them for a truck they never asked for").
-- Reversed by the founder, 2026-09-27: "let us choose" IS the shipper asking us
-- to choose, and a price in seconds is what stops the default path being the
-- slow one. The review screen names the truck chosen and why, so nothing is
-- hidden. Unknown weight is still 'advise_me'.
create or replace function private.price_for(
  p_origin_city bigint, p_dest_city bigint, p_truck_type_code text, p_weight_kg integer
)
returns table(price_baisa bigint, outcome text, rate_card_id bigint, currency char(3))
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code     text := private.resolve_truck_type(p_truck_type_code, p_weight_kg);
  v_rate     private.rate_cards;
  v_capacity integer;
  v_price    bigint;
begin
  if v_code is null then
    return query select null::bigint, 'advise_me'::text, null::bigint, 'OMR'::char(3);
    return;
  end if;

  select tt.capacity_kg into v_capacity
  from public.truck_types tt where tt.code = v_code;

  if v_capacity is null then
    raise exception 'unknown truck type' using errcode = 'foreign_key_violation';
  end if;

  -- SECURITY.md §5: over-capacity is refused, not priced. `>`, not `>=`.
  if p_weight_kg is not null and p_weight_kg > v_capacity then
    return query select null::bigint, 'over_capacity'::text, null::bigint, 'OMR'::char(3);
    return;
  end if;

  select * into v_rate
  from private.rate_cards rc
  where rc.origin_corridor = private.corridor_of(p_origin_city)
    and rc.dest_corridor   = private.corridor_of(p_dest_city)
    and rc.truck_type_code = v_code;

  if v_rate.id is null then
    return query select null::bigint, 'no_rate'::text, null::bigint, 'OMR'::char(3);
    return;
  end if;

  -- Distance resolved here from cities.lat/lng, never from the client.
  v_price := private.compute_price(
    v_rate.base_baisa, v_rate.per_tonne_baisa, v_rate.min_fare_baisa, p_weight_kg,
    v_rate.per_km_baisa, private.route_km(p_origin_city, p_dest_city));

  if v_price is null or v_price <= 0 then
    raise exception 'computed a non-positive price' using errcode = 'check_violation';
  end if;

  return query select v_price, 'quoted'::text, v_rate.id, v_rate.currency;
end;
$$;

-- The truck the price was computed for. `truck_type_code` stays NULL when the
-- shipper said "let us choose" (non-negotiable #1); this records what we chose.
-- Readable by the load's shipper (RLS), writable by nobody but definer code.
alter table public.loads
  add column if not exists priced_truck_type text references public.truck_types (code);

grant select (priced_truck_type) on public.loads to authenticated;

-- `issue_quote` from 0021, plus: record which truck the price is for.
create or replace function private.issue_quote(p_load_id uuid)
returns table(quote_id uuid, price_baisa bigint, currency char(3), outcome text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_load  public.loads;
  v_r     record;
  v_quote public.quotes;
begin
  select * into v_load from public.loads l where l.id = p_load_id;

  if v_load.id is null then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;

  select * into v_r
  from private.price_for(v_load.origin_city, v_load.dest_city,
                         v_load.truck_type_code, v_load.weight_kg);

  insert into public.quotes (
    shipper_id, load_id,
    origin_city, dest_city, truck_type_code, weight_kg, pickup_from, pickup_to,
    price_baisa, currency, outcome, rate_card_id
  ) values (
    v_load.shipper_id, v_load.id,
    v_load.origin_city, v_load.dest_city, v_load.truck_type_code, v_load.weight_kg,
    v_load.pickup_from, v_load.pickup_to,
    v_r.price_baisa, coalesce(v_r.currency, v_load.currency), v_r.outcome, v_r.rate_card_id
  )
  returning * into v_quote;

  if v_r.outcome = 'quoted' then
    update public.loads l
       set price_baisa       = v_r.price_baisa,
           priced_truck_type = private.resolve_truck_type(v_load.truck_type_code, v_load.weight_kg)
     where l.id = v_load.id;
  else
    update public.loads l set status = 'finding_truck'::public.load_status
    where l.id = v_load.id and l.status = 'posted'::public.load_status;
  end if;

  return query
  select v_quote.id, v_quote.price_baisa, v_quote.currency,
         v_quote.outcome, v_quote.expires_at;
end;
$$;

-- `quote_route` gains one column: the truck the price is for, so the review
-- screen can say "10-ton truck — chosen for 8,000 kg" without a TypeScript copy
-- of the resolution rule. A changed return shape means drop + recreate, and the
-- grant is restated exactly as it was.
drop function if exists public.quote_route(bigint, bigint, text, integer);

create function public.quote_route(
  p_origin_city bigint, p_dest_city bigint,
  p_truck_type_code text default null, p_weight_kg integer default null
)
returns table(price_baisa bigint, currency char(3), outcome text, truck_type_code text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_r     record;
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

  if p_origin_city = p_dest_city then
    raise exception 'origin and destination must differ' using errcode = 'check_violation';
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

  select * into v_r
  from private.price_for(p_origin_city, p_dest_city, p_truck_type_code, p_weight_kg);

  return query select
    v_r.price_baisa, v_r.currency, v_r.outcome,
    case when v_r.outcome = 'quoted'
         then private.resolve_truck_type(p_truck_type_code, p_weight_kg) end;
end;
$$;

revoke all on function public.quote_route(bigint, bigint, text, integer) from public, anon;
grant execute on function public.quote_route(bigint, bigint, text, integer) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Book = accept
-- ════════════════════════════════════════════════════════════════════════════

-- Uber and Porter show the price before "Book", so booking is agreeing to it.
-- One call: post, price, and — if the server's price is the one the shipper
-- saw — accept and dispatch.
--
-- `p_seen_price_baisa` is COMPARED, never stored: the price written is always
-- the server's, so this is not accepting a price from the client.
--
-- A mismatch does NOT raise. Raising would roll back the load *and the rate-limit
-- counter*, turning this into an unlimited yes/no oracle a caller could
-- binary-search the rate card with. Instead the load is posted and priced as
-- normal but not accepted (`price_matched = false`); the shipper sees the real
-- price on the load screen and accepts it there — the existing path — and every
-- probe costs one of post_load's 20 loads an hour.
create or replace function public.book_load(
  p_origin_city bigint, p_dest_city bigint,
  p_pickup_from date, p_pickup_to date, p_goods text,
  p_weight_kg integer default null, p_truck_type_code text default null,
  p_seen_price_baisa bigint default null
)
returns table(load_id uuid, status public.load_status, price_baisa bigint, price_matched boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_price   bigint;
  v_status  public.load_status;
  v_matched boolean;
begin
  -- Every check post_load makes (auth, role, active, rate limit, input) is made
  -- by calling it. auth.uid() is still the caller's inside it.
  v_id := public.post_load(p_origin_city, p_dest_city, p_pickup_from, p_pickup_to,
                           p_goods, p_weight_kg, p_truck_type_code);

  select l.price_baisa into v_price from public.loads l where l.id = v_id;

  v_matched := v_price is not null and p_seen_price_baisa is not distinct from v_price;

  if v_matched then
    perform public.accept_quote(v_id);
  end if;

  select l.status into v_status from public.loads l where l.id = v_id;
  return query select v_id, v_status, v_price,
    -- Unpriced loads "match" when the shipper saw no price either: nothing was
    -- promised, and the human path is what they were told.
    (v_matched or (v_price is null and p_seen_price_baisa is null));
end;
$$;

revoke all on function public.book_load(bigint, bigint, date, date, text, integer, text, bigint)
  from public, anon;
grant execute on function public.book_load(bigint, bigint, date, date, text, integer, text, bigint)
  to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Driver availability — "go online"
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.driver_availability (
  driver_id  uuid primary key references public.profiles (id) on delete cascade,
  available  boolean not null default false,
  -- The town the truck is in. A city, never a coordinate: enough to rank by
  -- distance, and nothing a leak could turn into someone's house.
  city_id    bigint references public.cities (id),
  source     text not null default 'manual'
             constraint driver_availability_source check (source in ('gps', 'delivery', 'manual')),
  updated_at timestamptz not null default now()
);

-- Deny by default. The driver reads their own row; nobody writes it except the
-- definer functions below — availability decides who is offered cargo, so a
-- client that could write `available` or `city_id` directly could put itself
-- first in line from anywhere.
revoke all on table public.driver_availability from anon, authenticated;
alter table public.driver_availability enable row level security;
alter table public.driver_availability force row level security;

drop policy if exists "driver reads own availability" on public.driver_availability;
create policy "driver reads own availability" on public.driver_availability
  for select to authenticated using (driver_id = auth.uid());

grant select (driver_id, available, city_id, source, updated_at)
  on public.driver_availability to authenticated;

-- The nearest town to a point. The point is used and dropped.
create or replace function private.nearest_city(p_lat double precision, p_lng double precision)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.cities c
  order by private.point_km(p_lat::numeric, p_lng::numeric, c.id) asc nulls last
  limit 1;
$$;

revoke all on function private.nearest_city(double precision, double precision)
  from public, anon, authenticated;

-- Where the driver's last delivery ended — the fallback when there is no GPS.
create or replace function private.last_delivery_city(p_driver_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select l.dest_city
  from public.trips t join public.loads l on l.id = t.load_id
  where t.driver_id = p_driver_id and t.status = 'delivered'::public.trip_status
  order by t.created_at desc
  limit 1;
$$;

revoke all on function private.last_delivery_city(uuid) from public, anon, authenticated;

create or replace function public.set_available(
  p_available boolean,
  p_lat double precision default null,
  p_lng double precision default null
)
returns table(available boolean, city_id bigint, source text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_city   bigint;
  v_source text;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if (select private.actor_role()) <> 'driver' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  perform private.require_active();
  perform private.check_rate_limit('set_available', 60, interval '1 hour');

  if p_available is null then
    raise exception 'available required' using errcode = 'check_violation';
  end if;

  -- Half a coordinate is no coordinate; out-of-range is garbage, not a place.
  if (p_lat is null) <> (p_lng is null)
     or (p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180)) then
    raise exception 'bad position' using errcode = 'check_violation';
  end if;

  if p_lat is not null then
    v_city := private.nearest_city(p_lat, p_lng);
    v_source := 'gps';
  else
    v_city := private.last_delivery_city(v_actor);
    v_source := case when v_city is not null then 'delivery' else 'manual' end;
  end if;

  insert into public.driver_availability as da (driver_id, available, city_id, source, updated_at)
  values (v_actor, p_available, v_city, v_source, now())
  on conflict (driver_id) do update
    set available  = excluded.available,
        -- Going offline does not forget where the truck is.
        city_id    = coalesce(excluded.city_id, da.city_id),
        source     = case when excluded.city_id is null then da.source else excluded.source end,
        updated_at = now();

  return query
  select da.available, da.city_id, da.source
  from public.driver_availability da where da.driver_id = v_actor;
end;
$$;

revoke all on function public.set_available(boolean, double precision, double precision) from public, anon;
grant execute on function public.set_available(boolean, double precision, double precision) to authenticated;

-- A trip moves the driver: taking a job takes them offline; delivering puts
-- them back online at the destination (Uber's "back online"; Uber Freight's
-- return load — the next load out of Dubai is the one this truck wants).
create or replace function private.trip_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status) then
    insert into public.driver_availability (driver_id, available, source, updated_at)
    values (new.driver_id, false, 'manual', now())
    on conflict (driver_id) do update set available = false, updated_at = now();
  elsif new.status = 'delivered'::public.trip_status
        and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.driver_availability (driver_id, available, city_id, source, updated_at)
    select new.driver_id, true, l.dest_city, 'delivery', now()
    from public.loads l where l.id = new.load_id
    on conflict (driver_id) do update
      set available = true, city_id = excluded.city_id,
          source = 'delivery', updated_at = now();
  end if;
  return new;
end;
$$;

revoke all on function private.trip_availability() from public, anon, authenticated;

drop trigger if exists trip_availability on public.trips;
create trigger trip_availability
  after insert or update of status on public.trips
  for each row execute function private.trip_availability();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Waves
-- ════════════════════════════════════════════════════════════════════════════

insert into private.app_settings (key, value) values
  ('dispatch_wave_minutes', '5'::jsonb),
  ('dispatch_max_waves',    '3'::jsonb),
  -- Porter widens the search when nobody takes an order. Road km from the
  -- truck's town to the pickup, per wave. The last wave also reaches available
  -- drivers whose town is unknown.
  ('dispatch_radius_km_1',  '150'::jsonb),
  ('dispatch_radius_km_2',  '400'::jsonb),
  ('dispatch_radius_km_3',  '1500'::jsonb)
on conflict (key) do nothing;

-- `require_verified_driver` is NOT switched on here. The founder's call
-- (2026-09-27): leave it off until close to launch, so the app can be shared
-- before every driver has been vetted. `private.nearby_drivers` and
-- `accept_offer` both honour the flag, so switching it on later is one row:
--   update private.app_settings set value = 'true' where key = 'require_verified_driver';
-- The website promises "100% verified drivers" — this must be on before launch
-- (OPEN_ISSUES.md).

alter table private.dispatch_log add column if not exists wave smallint;

-- The log's vocabulary grows by the new modes and the one new ending. Missed
-- in the first draft and caught by dispatch.sql: `accept_quote` fails OPEN, so
-- a check violation here was swallowed into an 'error' row and every booking
-- silently dispatched nobody — "nothing errored because nothing ran", again.
alter table private.dispatch_log drop constraint if exists dispatch_log_mode_known;
alter table private.dispatch_log add constraint dispatch_log_mode_known
  check (mode is null or mode in ('leg', 'fresh', 'backfill', 'nearby', 'mixed'));
alter table private.dispatch_log drop constraint if exists dispatch_log_skip_known;
alter table private.dispatch_log add constraint dispatch_log_skip_known
  check (skipped is null or skipped in
         ('disabled', 'no_price', 'no_candidates', 'no_drivers', 'error', 'exhausted'));

-- Available drivers near the pickup, nearest first. The Porter/Uber candidate
-- set: online, verified, a truck that fits, within the wave's road radius, not
-- over their pending cap, never re-asked. Private and ungranted, like
-- `candidates_for` — it reads across every driver.
create or replace function private.nearby_drivers(
  p_load_id uuid, p_radius_km numeric, p_include_unlocated boolean, p_limit integer
)
returns table(driver_id uuid, truck_id uuid, deadhead_km numeric, pending bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with l as (
    select lo.id, lo.origin_city, lo.weight_kg,
           private.resolve_truck_type(lo.truck_type_code, lo.weight_kg) as want_type,
           lo.truck_type_code
    from public.loads lo where lo.id = p_load_id
  )
  select p.id, tk.id, km.v, coalesce(pc.n, 0)
  from public.profiles p
  cross join l
  join public.driver_availability da on da.driver_id = p.id and da.available
  -- One row per driver: their smallest truck that fits.
  join lateral (
    select t.id, t.capacity_kg
    from public.trucks t
    where t.owner_id = p.id
      and (l.truck_type_code is null or t.truck_type = l.truck_type_code)
      and (l.weight_kg is null or coalesce(t.capacity_kg, 2147483647) >= l.weight_kg)
    order by t.capacity_kg asc nulls last
    limit 1
  ) tk on true
  left join lateral (
    select private.route_km(da.city_id, l.origin_city) as v
    where da.city_id is not null
  ) km on true
  left join lateral (
    select count(*) as n from public.offers o
    where o.driver_id = p.id and o.status = 'pending' and o.expires_at > now()
  ) pc on true
  where p.role = 'driver'
    and p.suspended_at is null
    -- The SAME test `accept_offer` applies (per driver, `drivers.verified_at`),
    -- so nobody is offered a load they would be refused at the tap. An earlier
    -- draft filtered on `trucks.verified_at`, which nothing sets — it would have
    -- excluded every driver and dispatched no one.
    and (not private.setting_bool('require_verified_driver', true)
         or private.is_verified_driver(p.id))
    and not exists (select 1 from public.offers o where o.load_id = p_load_id and o.driver_id = p.id)
    -- A driver on a job is not free, whatever their switch says.
    and not exists (
      select 1 from public.trips t
      where t.driver_id = p.id
        and t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
    )
    and (
      (km.v is not null and km.v <= p_radius_km)
      or (km.v is null and p_include_unlocated)
    )
  order by km.v asc nulls last, coalesce(pc.n, 0) asc, tk.capacity_kg asc nulls last, p.id
  limit p_limit;
$$;

revoke all on function private.nearby_drivers(uuid, numeric, boolean, integer)
  from public, anon, authenticated;

-- One wave: declared legs first (a truck already making the trip is the best
-- match there is), then the nearest available drivers within this wave's
-- radius. Returns offers sent.
create or replace function private.dispatch_wave(p_load_id uuid, p_wave integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_size       integer := private.setting_int('auto_dispatch_max_offers', 3);
  v_per_driver integer := private.setting_int('auto_dispatch_max_pending_per_driver', 3);
  v_minutes    integer := private.setting_int('dispatch_wave_minutes', 5);
  v_max        integer := private.setting_int('dispatch_max_waves', 3);
  v_radius     numeric := private.setting_int('dispatch_radius_km_' || p_wave, 1500);
  v_verified   boolean := private.setting_bool('require_verified_driver', true);
  v_sent       integer := 0;
  v_legs       integer := 0;
  v_seen       integer := 0;
  v_pending    integer;
  v_offer      uuid;
  c            record;
begin
  for c in select * from private.candidates_for(p_load_id, 1::smallint, 0, v_size * 4) loop
    v_seen := v_seen + 1;
    exit when v_sent >= v_size;
    continue when c.offer_status is not null;
    continue when v_verified and not private.is_verified_driver(c.driver_id);
    select count(*) into v_pending from public.offers o
    where o.driver_id = c.driver_id and o.status = 'pending' and o.expires_at > now();
    continue when v_pending >= v_per_driver;
    v_offer := public.create_offer(p_load_id, c.driver_id, c.leg_id, 'auto', false);
    update public.offers set expires_at = now() + make_interval(mins => v_minutes)
    where id = v_offer;
    v_sent := v_sent + 1;
    v_legs := v_legs + 1;
  end loop;

  if v_sent < v_size then
    for c in
      select * from private.nearby_drivers(p_load_id, v_radius, p_wave >= v_max, v_size * 4)
    loop
      v_seen := v_seen + 1;
      exit when v_sent >= v_size;
      continue when c.pending >= v_per_driver;
      v_offer := public.create_offer(p_load_id, c.driver_id, null, 'auto', false);
      update public.offers set expires_at = now() + make_interval(mins => v_minutes)
      where id = v_offer;
      v_sent := v_sent + 1;
    end loop;
  end if;

  -- Logged when something went out, and once for the first empty attempt so a
  -- dispatcher can see the search began. Not every empty minute: a search can
  -- run for fifteen of them, and fifteen "nobody" rows would bury the one row
  -- that says who was asked.
  if v_sent > 0 or not exists (
    select 1 from private.dispatch_log d where d.load_id = p_load_id and d.wave is not null
  ) then
    insert into private.dispatch_log (load_id, candidates, offers_sent, mode, skipped, wave)
    values (p_load_id, v_seen, v_sent,
            case when v_sent > 0 and v_legs = v_sent then 'leg'
                 when v_legs > 0 then 'mixed'
                 else 'nearby' end,
            case when v_sent = 0 then 'no_candidates' end, p_wave);
  end if;

  return v_sent;
end;
$$;

revoke all on function private.dispatch_wave(uuid, integer) from public, anon, authenticated;

-- Does the machine still own this load's search? True from the moment the
-- shipper accepts a price until a driver takes it or every wave is spent —
-- and never while auto-dispatch is switched off.
create or replace function private.machine_owns(p_load_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.setting_bool('auto_dispatch_enabled', true)
     and exists (
       select 1 from public.loads l
       where l.id = p_load_id and l.accepted_at is not null
         and l.status in ('accepted'::public.load_status, 'matched'::public.load_status))
     and not exists (
       select 1 from private.dispatch_log d
       where d.load_id = p_load_id and d.skipped = 'exhausted');
$$;

revoke all on function private.machine_owns(uuid) from public, anon, authenticated;

-- One step of the search. Porter-style: the radius is a function of how long
-- the load has been searching — wave k covers minutes (k-1)·w to k·w — so a
-- driver who comes online at minute 3 is still asked, and nothing is burnt in
-- the first second because nobody happened to be online. Called by the
-- every-minute job and whenever a decline empties the current wave.
create or replace function private.next_wave(p_load_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max     integer := private.setting_int('dispatch_max_waves', 3);
  v_minutes integer := private.setting_int('dispatch_wave_minutes', 5);
  v_started timestamptz;
  v_elapsed numeric;
  v_wave    integer;
begin
  -- Serialise per load, but never wait. A decline arrives holding its own offer
  -- row; an accept arrives holding the load and wanting the sibling offers.
  -- Waiting here would deadlock the two. Skipping is safe: an accept in flight
  -- makes a new wave moot, and the every-minute job re-checks anything missed.
  select l.accepted_at into v_started
  from public.loads l where l.id = p_load_id
  for update skip locked;
  if not found then
    return 0;
  end if;

  if not private.machine_owns(p_load_id) then
    return 0;
  end if;

  -- The current wave is still out.
  if exists (
    select 1 from public.offers o
    where o.load_id = p_load_id and o.status = 'pending' and o.expires_at > now()
  ) then
    return 0;
  end if;

  v_elapsed := extract(epoch from now() - v_started) / 60;

  if v_elapsed >= v_max * v_minutes then
    -- Every wave spent. A person takes it — once, loudly. The `exhausted` row
    -- is what ends machine ownership, so this cannot fire twice.
    insert into private.dispatch_log (load_id, offers_sent, skipped, wave)
    values (p_load_id, 0, 'exhausted', v_max);
    update public.loads l set status = 'finding_truck'::public.load_status
    where l.id = p_load_id and l.status = 'matched'::public.load_status;
    perform private.system_raise_alert(
      'dispatch_exhausted',
      'No driver took load ' || upper(left(p_load_id::text, 8)) || ' — it needs a person.',
      jsonb_build_object('load_id', p_load_id, 'waves', v_max));
    return 0;
  end if;

  v_wave := least(v_max, floor(v_elapsed / v_minutes)::integer + 1);
  return private.dispatch_wave(p_load_id, v_wave);
end;
$$;

revoke all on function private.next_wave(uuid) from public, anon, authenticated;

-- `auto_dispatch` keeps its name, its callers (`accept_quote`) and its kill
-- switch and price gate, unchanged; it now starts the search.
create or replace function private.auto_dispatch(p_load_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.setting_bool('auto_dispatch_enabled', true) then
    insert into private.dispatch_log (load_id, skipped) values (p_load_id, 'disabled');
    return 0;
  end if;

  if private.setting_bool('auto_dispatch_requires_price', false)
     and (select l.price_baisa from public.loads l where l.id = p_load_id) is null then
    insert into private.dispatch_log (load_id, skipped) values (p_load_id, 'no_price');
    return 0;
  end if;

  return private.next_wave(p_load_id);
end;
$$;

-- A decline that leaves nobody in the wave asks the next driver immediately —
-- Uber moves on the moment a driver says no, not when a timer fires.
create or replace function private.offer_declined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'auto' then
    perform private.next_wave(new.load_id);
  end if;
  return new;
end;
$$;

revoke all on function private.offer_declined() from public, anon, authenticated;

drop trigger if exists offer_declined on public.offers;
create trigger offer_declined
  after update of status on public.offers
  for each row
  when (new.status = 'declined' and old.status = 'pending')
  execute function private.offer_declined();

-- The one door out of the machine's hands. Two older paths move a `matched`
-- load to `finding_truck` the moment it has no live offer: `respond_to_offer`
-- on a decline, and 0034's sweep on expiry. Between waves that is always true
-- for a moment, and handing the load to a person then would end the search
-- early. While the machine owns the search, those moves land on `accepted`
-- instead — the state a searching load rests in — and the job picks it up.
-- A dispatcher's own move is never redirected: a person deciding is the point.
create or replace function private.loads_machine_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'finding_truck'::public.load_status
     and old.status = 'matched'::public.load_status
     and not private.is_ops()
     and private.machine_owns(new.id) then
    new.status := 'accepted'::public.load_status;
  end if;
  return new;
end;
$$;

revoke all on function private.loads_machine_guard() from public, anon, authenticated;

drop trigger if exists loads_machine_guard on public.loads;
create trigger loads_machine_guard
  before update of status on public.loads
  for each row execute function private.loads_machine_guard();

-- Every minute: searching loads with nothing out get their next step. The
-- delay queue Uber uses, as a pg_cron job (0034's pattern — never an ops_* RPC).
create or replace function private.system_dispatch_waves()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  v_moved integer := 0;
begin
  if not private.setting_bool('auto_dispatch_enabled', true) then
    return 0;
  end if;

  for r in
    select l.id from public.loads l
    where l.status in ('accepted'::public.load_status, 'matched'::public.load_status)
      and l.accepted_at is not null
      and not exists (
        select 1 from public.offers o
        where o.load_id = l.id and o.status = 'pending' and o.expires_at > now())
      -- Not while a dispatcher's own offer is out: a person chose that driver.
      and not exists (
        select 1 from public.offers o
        where o.load_id = l.id and o.source <> 'auto' and o.status = 'pending'
          and o.expires_at > now())
      and not exists (
        select 1 from private.dispatch_log d where d.load_id = l.id and d.skipped = 'exhausted')
  loop
    update public.offers set status = 'expired'
    where load_id = r.id and status = 'pending' and expires_at <= now();
    if private.next_wave(r.id) > 0 then
      v_moved := v_moved + 1;
    end if;
  end loop;

  if v_moved > 0 then
    perform private.log_system('system_dispatch_waves', 'system', 'loads',
                               jsonb_build_object('loads_offered', v_moved));
  end if;
  return v_moved;
end;
$$;

revoke all on function private.system_dispatch_waves() from public, anon, authenticated;

-- Online is not forever: a switch left on overnight would offer loads to a
-- driver asleep in Sohar. Twelve hours idle turns it off.
create or replace function private.system_expire_availability()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.driver_availability
     set available = false, updated_at = now()
   where available and updated_at < now() - interval '12 hours';
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform private.log_system('system_expire_availability', 'system', 'driver_availability',
                               jsonb_build_object('turned_off', v_count));
  end if;
  return v_count;
end;
$$;

revoke all on function private.system_expire_availability() from public, anon, authenticated;

select cron.schedule('dispatch-waves', '* * * * *',
  $$select private.system_dispatch_waves()$$);
select cron.schedule('expire-availability', '23 * * * *',
  $$select private.system_expire_availability()$$);

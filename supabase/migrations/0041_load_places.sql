-- 0041 · Shipper places — the exact pickup and drop-off, beside the city.
--
-- Spec: docs/superpowers/specs/2026-09-28-shipper-places-design.md.
--
-- THE CITY STAYS. Pricing, dispatch and the rate card are per city; the server
-- derives the city from the point (private.nearest_city), so this changes none
-- of them.
--
-- A SEPARATE TABLE, NOT COLUMNS ON `loads`. `loads` carries a table-level select
-- grant and a policy letting a driver read any load they ever had an offer for.
-- A contact phone there would outlive the offer. Here no driver has a policy at
-- all: they read places only through driver_offers()/driver_offer()/driver_trip(),
-- which decide inside the definer.
--
-- FOUNDER'S CALL (2026-09-28): the exact point, note and contact are shown in the
-- offer — every offered driver sees them — but only while that offer is pending.

-- ═══ 1. the table ═══════════════════════════════════════════════════════════

create table public.load_places (
  load_id       uuid not null references public.loads (id) on delete cascade,
  kind          text not null constraint load_places_kind check (kind in ('pickup', 'drop')),
  lat           double precision not null,
  lng           double precision not null,
  place_name    text,
  note          text,
  contact_name  text,
  contact_phone text,
  created_at    timestamptz not null default now(),
  primary key (load_id, kind),
  constraint load_places_in_region check (lat between 12 and 33 and lng between 34 and 60),
  constraint load_places_name_len  check (place_name   is null or char_length(place_name)   between 1 and 200),
  constraint load_places_note_len  check (note         is null or char_length(note)         between 1 and 300),
  constraint load_places_cname_len check (contact_name is null or char_length(contact_name) between 1 and 80),
  constraint load_places_phone     check (contact_phone is null or contact_phone ~ '^\+?[0-9 ]{6,24}$'),
  -- Bidi overrides are a spoofing vector in an RTL UI. Rejected here AND
  -- sanitised at output by src/lib/safe-text.ts, on purpose.
  constraint load_places_safe_text check (
    not private.contains_unsafe_text(place_name)
    and not private.contains_unsafe_text(note)
    and not private.contains_unsafe_text(contact_name))
);

-- Deny by default. The shipper reads their own; nobody writes except book_load.
revoke all on table public.load_places from anon, authenticated;
alter table public.load_places enable row level security;
alter table public.load_places force row level security;

drop policy if exists "shipper reads own load places" on public.load_places;
create policy "shipper reads own load places" on public.load_places
  for select to authenticated using ((select private.owns_load(load_places.load_id)));

-- Select only. There is no driver policy, so a driver's select returns nothing;
-- the grant exists for the shipper's own T3/T4.
grant select (load_id, kind, lat, lng, place_name, note, contact_name, contact_phone, created_at)
  on public.load_places to authenticated;

-- ═══ 2. the nearest city, for "Near Barka" ══════════════════════════════════
-- One nearest-city rule, server-side, shared with book_load. Read-only.

create or replace function public.city_near(p_lat double precision, p_lng double precision)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between 12 and 33 or p_lng not between 34 and 60 then
    raise exception 'position out of range' using errcode = 'check_violation';
  end if;
  return private.nearest_city(p_lat, p_lng);
end;
$$;

revoke all on function public.city_near(double precision, double precision) from public, anon;
grant execute on function public.city_near(double precision, double precision) to authenticated;

-- ═══ 3. the search quota ════════════════════════════════════════════════════
-- Called by the `places` Edge Function WITH THE CALLER'S JWT, so the function
-- needs no service-role key. Writes a rate event, so VOLATILE.

create or replace function public.use_places_quota(p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if (select private.actor_role()) <> 'shipper' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  perform private.require_active();
  if p_kind = 'autocomplete' then
    perform private.check_rate_limit('places_autocomplete', 300, interval '1 hour');
  elsif p_kind = 'details' then
    perform private.check_rate_limit('places_details', 60, interval '1 hour');
  else
    raise exception 'unknown quota' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.use_places_quota(text) from public, anon;
grant execute on function public.use_places_quota(text) to authenticated;

-- ═══ 4. ops reads a load's places ═══════════════════════════════════════════

create or replace function public.ops_load_places(p_load_id uuid)
returns table (
  kind text, lat double precision, lng double precision, place_name text,
  note text, contact_name text, contact_phone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  return query
  select p.kind, p.lat, p.lng, p.place_name, p.note, p.contact_name, p.contact_phone
  from public.load_places p
  where p.load_id = p_load_id
  order by p.kind desc;  -- pickup before drop
end;
$$;

revoke all on function public.ops_load_places(uuid) from public, anon;
grant execute on function public.ops_load_places(uuid) to authenticated;

-- ═══ 5. book_load v2 — the same call, with two optional places ══════════════
-- Body is 0036's, plus: each place's city must be the city passed (only a
-- client bug disagrees), checked BEFORE post_load so a refusal spends no rate
-- limit; the places are inserted in the same transaction as the load.

create or replace function private.place_city(p jsonb)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lat double precision := (p ->> 'lat')::double precision;
  v_lng double precision := (p ->> 'lng')::double precision;
begin
  if v_lat is null or v_lng is null
     or v_lat not between 12 and 33 or v_lng not between 34 and 60 then
    raise exception 'place out of range' using errcode = 'check_violation';
  end if;
  return private.nearest_city(v_lat, v_lng);
end;
$$;

revoke all on function private.place_city(jsonb) from public, anon, authenticated;

create or replace function private.insert_load_place(p_load_id uuid, p_kind text, p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p is null then
    return;
  end if;
  insert into public.load_places (load_id, kind, lat, lng, place_name, note, contact_name, contact_phone)
  values (
    p_load_id, p_kind,
    (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
    nullif(btrim(p ->> 'place_name'), ''),
    nullif(btrim(p ->> 'note'), ''),
    nullif(btrim(p ->> 'contact_name'), ''),
    nullif(btrim(p ->> 'contact_phone'), ''));
end;
$$;

revoke all on function private.insert_load_place(uuid, text, jsonb) from public, anon, authenticated;

drop function if exists public.book_load(bigint, bigint, date, date, text, integer, text, bigint);

create function public.book_load(
  p_origin_city bigint, p_dest_city bigint,
  p_pickup_from date, p_pickup_to date, p_goods text,
  p_weight_kg integer default null, p_truck_type_code text default null,
  p_seen_price_baisa bigint default null,
  p_origin_place jsonb default null, p_dest_place jsonb default null
)
returns table(load_id uuid, status public.load_status, price_baisa bigint, price_matched boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_price   bigint;
  v_status  public.load_status;
  v_matched boolean;
begin
  if p_origin_place is not null and private.place_city(p_origin_place) is distinct from p_origin_city then
    raise exception 'city does not match place' using errcode = 'check_violation';
  end if;
  if p_dest_place is not null and private.place_city(p_dest_place) is distinct from p_dest_city then
    raise exception 'city does not match place' using errcode = 'check_violation';
  end if;

  v_id := public.post_load(p_origin_city, p_dest_city, p_pickup_from, p_pickup_to,
                           p_goods, p_weight_kg, p_truck_type_code);

  perform private.insert_load_place(v_id, 'pickup', p_origin_place);
  perform private.insert_load_place(v_id, 'drop', p_dest_place);

  select l.price_baisa into v_price from public.loads l where l.id = v_id;

  v_matched := v_price is not null and p_seen_price_baisa is not distinct from v_price;

  if v_matched then
    perform public.accept_quote(v_id);
  end if;

  select l.status into v_status from public.loads l where l.id = v_id;
  return query select v_id, v_status, v_price,
    (v_matched or (v_price is null and p_seen_price_baisa is null));
end;
$$;

revoke all on function public.book_load(bigint, bigint, date, date, text, integer, text, bigint, jsonb, jsonb)
  from public, anon;
grant execute on function public.book_load(bigint, bigint, date, date, text, integer, text, bigint, jsonb, jsonb)
  to authenticated;

-- ═══ 6. drivers read places through their functions ═════════════════════════
-- driver_offers() already returns pending, unexpired offers only, so the places
-- it carries vanish with the offer — the founder's safeguard, for free.
-- driver_trip() hides the contact once the job is over. Return types change,
-- so each is dropped and recreated; driver_offer depends on driver_offers.

drop function if exists public.driver_offer(uuid);
drop function if exists public.driver_offers();
drop function if exists public.driver_trip(uuid);

create function public.driver_offers()
returns table (
  offer_id      uuid,
  expires_at    timestamptz,
  leg_id        uuid,
  origin_city   bigint,
  dest_city     bigint,
  pickup_from   date,
  pickup_to     date,
  goods         text,
  weight_kg     integer,
  truck_type_code text,
  collect_baisa bigint,
  payout_baisa  bigint,
  owed_baisa    bigint,
  currency      char(3),
  detour_km     numeric,
  free_after_kg integer,
  pickup_lat double precision, pickup_lng double precision, pickup_name text, pickup_note text,
  pickup_contact_name text, pickup_contact_phone text,
  drop_lat double precision, drop_lng double precision, drop_name text, drop_note text,
  drop_contact_name text, drop_contact_phone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    o.id, o.expires_at, o.leg_id,
    l.origin_city, l.dest_city, l.pickup_from, l.pickup_to,
    l.goods_description, l.weight_kg, l.truck_type_code,
    l.price_baisa,
    private.payout_for(l.price_baisa),
    l.price_baisa - private.payout_for(l.price_baisa),
    l.currency,
    case when o.leg_id is null then null
         else private.detour_km(o.leg_id, l.id) end,
    case when t.capacity_kg is null or l.weight_kg is null then null
         else greatest(0, t.capacity_kg - l.weight_kg) end,
    pp.lat, pp.lng, pp.place_name, pp.note, pp.contact_name, pp.contact_phone,
    dp.lat, dp.lng, dp.place_name, dp.note, dp.contact_name, dp.contact_phone
  from public.offers o
  join public.loads l on l.id = o.load_id
  left join public.legs g on g.id = o.leg_id
  left join public.trucks t on t.id = g.truck_id
  left join public.load_places pp on pp.load_id = l.id and pp.kind = 'pickup'
  left join public.load_places dp on dp.load_id = l.id and dp.kind = 'drop'
  -- Scoped to the actor INSIDE the definer. Pending and unexpired only: a place
  -- and its contact are visible exactly as long as the offer is (0041).
  where o.driver_id = v_actor
    and o.status = 'pending'::public.offer_status
    and o.expires_at > now()
  order by o.created_at desc;
end;
$$;

revoke all on function public.driver_offers() from public, anon;
grant execute on function public.driver_offers() to authenticated;

create function public.driver_offer(p_offer_id uuid)
returns table (
  offer_id      uuid,
  expires_at    timestamptz,
  leg_id        uuid,
  origin_city   bigint,
  dest_city     bigint,
  pickup_from   date,
  pickup_to     date,
  goods         text,
  weight_kg     integer,
  truck_type_code text,
  collect_baisa bigint,
  payout_baisa  bigint,
  owed_baisa    bigint,
  currency      char(3),
  detour_km     numeric,
  free_after_kg integer,
  pickup_lat double precision, pickup_lng double precision, pickup_name text, pickup_note text,
  pickup_contact_name text, pickup_contact_phone text,
  drop_lat double precision, drop_lng double precision, drop_name text, drop_note text,
  drop_contact_name text, drop_contact_phone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.driver_offers() d where d.offer_id = p_offer_id;
$$;

revoke all on function public.driver_offer(uuid) from public, anon;
grant execute on function public.driver_offer(uuid) to authenticated;

create function public.driver_trip(p_trip_id uuid)
returns table (
  trip_id       uuid,
  status        public.trip_status,
  load_id       uuid,
  origin_city   bigint,
  dest_city     bigint,
  pickup_from   date,
  pickup_to     date,
  goods         text,
  weight_kg     integer,
  collect_baisa bigint,
  payout_baisa  bigint,
  owed_baisa    bigint,
  currency      char(3),
  shipper_name  text,
  shipper_phone text,
  pickup_lat double precision, pickup_lng double precision, pickup_name text, pickup_note text,
  pickup_contact_name text, pickup_contact_phone text,
  drop_lat double precision, drop_lng double precision, drop_name text, drop_note text,
  drop_contact_name text, drop_contact_phone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    t.id, t.status, l.id,
    l.origin_city, l.dest_city, l.pickup_from, l.pickup_to,
    l.goods_description, l.weight_kg,
    l.price_baisa,
    private.payout_for(l.price_baisa),
    l.price_baisa - private.payout_for(l.price_baisa),
    l.currency,
    p.full_name, p.phone,
    pp.lat, pp.lng, pp.place_name, pp.note,
    case when t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
         then pp.contact_name end,
    case when t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
         then pp.contact_phone end,
    dp.lat, dp.lng, dp.place_name, dp.note,
    case when t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
         then dp.contact_name end,
    case when t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
         then dp.contact_phone end
  from public.trips t
  join public.loads l on l.id = t.load_id
  join public.profiles p on p.id = l.shipper_id
  left join public.load_places pp on pp.load_id = l.id and pp.kind = 'pickup'
  left join public.load_places dp on dp.load_id = l.id and dp.kind = 'drop'
  where t.id = p_trip_id
    and t.driver_id = v_actor;
end;
$$;

revoke all on function public.driver_trip(uuid) from public, anon;
grant execute on function public.driver_trip(uuid) to authenticated;

-- 0045 · Driver-priced loads. New loads use bids; old fixed-price loads retain
-- their history and RPCs during the app rollout. See docs/bidding-v1-design.md.
--
-- What is private, and why it is in `private`:
--   * the fee snapshot and the awarded payout (private.bid_loads). `loads` and
--     `trips` carry table-level SELECT grants and are readable by the shipper and
--     by every driver with an offer, so a fee column there is a public fee;
--   * the shipper's target price — a driver who could read it bids to it;
--   * the bids themselves (private.driver_bids). Drivers see competing bids only
--     through driver_load_bids(): a bidder number, a truck type and the amount
--     that driver keeps. Never a name, a phone, a town or a shipper total.
--
-- `loads.price_baisa` stays NULL until a bid is awarded. Before that, any driver
-- with a live invitation can read the row, and a stored total beside a visible
-- payout is the fee.

alter table public.loads
  add column pricing_mode text not null default 'fixed'
    constraint loads_pricing_mode check (pricing_mode in ('fixed', 'bid')),
  add column bid_deadline timestamptz,
  add column selected_bid_id uuid;

create table private.bid_loads (
  load_id uuid primary key references public.loads(id) on delete cascade,
  fee_bps integer not null check (fee_bps between 0 and 4000),
  target_total_baisa bigint check (target_total_baisa between 1 and 1000000000),
  last_wave_at timestamptz,
  awarded_payout_baisa bigint check (awarded_payout_baisa > 0)
);
alter table private.bid_loads enable row level security;
alter table private.bid_loads force row level security;
revoke all on table private.bid_loads from anon, authenticated;

create table private.driver_bids (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.loads(id) on delete cascade,
  offer_id uuid not null unique references public.offers(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  payout_baisa bigint not null check (payout_baisa between 1 and 1000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(load_id, driver_id)
);

create index driver_bids_load_rank_idx
  on private.driver_bids(load_id, payout_baisa, created_at, id);
create index driver_bids_driver_idx on private.driver_bids(driver_id);
alter table private.driver_bids enable row level security;
alter table private.driver_bids force row level security;
revoke all on table private.driver_bids from anon, authenticated;

alter table public.loads
  add constraint loads_selected_bid_fk foreign key (selected_bid_id)
  references private.driver_bids(id);
alter table public.loads add constraint loads_bid_fields check (
  (pricing_mode = 'fixed' and bid_deadline is null and selected_bid_id is null)
  or (pricing_mode = 'bid' and bid_deadline is not null)
);

alter table public.offers drop constraint offers_source_known;
alter table public.offers add constraint offers_source_known
  check (source in ('ops', 'auto', 'bid'));

-- Pacing, not a cap. A load keeps inviting drivers for as long as it is open,
-- but one wave at a time, and not at all while it already holds enough live
-- bids. `bid_fee_pct` is deliberately NOT seeded: see current_bid_fee_bps.
insert into private.app_settings (key, value) values
  ('bid_window_minutes',   '60'::jsonb),
  ('bid_invites_per_wave', '3'::jsonb),
  ('bid_wave_minutes',     '5'::jsonb),
  ('bid_enough_bids',      '5'::jsonb)
on conflict (key) do nothing;

-- Set bid_fee_pct (0 is a valid answer) before opening the new booking path.
-- A missing percentage is not silently interpreted as a free service.
create or replace function private.current_bid_fee_bps()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_pct numeric;
begin
  select (s.value #>> '{}')::numeric into v_pct
  from private.app_settings s where s.key = 'bid_fee_pct';
  if v_pct is null or v_pct < 0 or v_pct > 40 or v_pct <> round(v_pct, 2) then
    raise exception 'bid fee is not configured' using errcode = 'check_violation';
  end if;
  return (v_pct * 100)::integer;
end;
$$;
revoke all on function private.current_bid_fee_bps() from public, anon, authenticated;

create or replace function private.bid_total(p_payout bigint, p_fee_bps integer)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select p_payout + ((p_payout * p_fee_bps + 9999) / 10000);
$$;
revoke all on function private.bid_total(bigint, integer) from public, anon, authenticated;

-- The console can set the private fee, with the same audit discipline as the
-- existing commission setting. Existing bid loads keep their snapshotted fee.
create or replace function public.ops_set_bid_fee(p_pct numeric, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_before jsonb;
begin
  perform private.require_ops();
  if p_pct is null or p_pct < 0 or p_pct > 40 or p_pct <> round(p_pct, 2) then
    raise exception 'fee must be 0 to 40 percent, at most two decimals'
      using errcode = 'check_violation';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a fee change needs a reason' using errcode = 'check_violation';
  end if;
  select s.value into v_before from private.app_settings s where s.key = 'bid_fee_pct';
  insert into private.app_settings(key, value) values('bid_fee_pct', to_jsonb(p_pct))
  on conflict (key) do update set value = excluded.value;
  perform private.log_ops('ops_set_bid_fee', 'setting', 'bid_fee_pct',
    jsonb_build_object('pct', v_before), jsonb_build_object('pct', p_pct), p_reason);
end;
$$;
revoke all on function public.ops_set_bid_fee(numeric, text) from public, anon;
grant execute on function public.ops_set_bid_fee(numeric, text) to authenticated;

-- Driver eligibility is checked at invitation, at bid submission and at award.
-- Verification follows `require_verified_driver`, exactly as accept_offer and
-- nearby_drivers do, so one switch turns the gate on for both paths at launch.
create or replace function private.bid_driver_eligible(p_load_id uuid, p_driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.loads l
    join public.profiles p on p.id = p_driver_id
    join public.driver_availability a on a.driver_id = p.id and a.available
    where l.id = p_load_id and l.pricing_mode = 'bid'
      and l.pickup_to >= (now() at time zone 'Asia/Muscat')::date
      and p.role = 'driver' and p.suspended_at is null
      and (not private.setting_bool('require_verified_driver', false)
           or private.is_verified_driver(p.id))
      and exists (
        select 1 from public.trucks t where t.owner_id = p.id
          and (l.truck_type_code is null or t.truck_type = l.truck_type_code)
          and (l.weight_kg is null or t.capacity_kg >= l.weight_kg)
      )
      and not exists (
        select 1 from public.trips t where t.driver_id = p.id
          and t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
      )
  );
$$;
revoke all on function private.bid_driver_eligible(uuid, uuid) from public, anon, authenticated;

-- Bids that could still win: on an invitation nobody declined, from a driver
-- who is still eligible.
create or replace function private.bid_live_count(p_load_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from private.driver_bids b
  join public.offers o on o.id = b.offer_id and o.status <> 'declined'
  where b.load_id = p_load_id and private.bid_driver_eligible(p_load_id, b.driver_id);
$$;
revoke all on function private.bid_live_count(uuid) from public, anon, authenticated;

-- One wave of invitations. Callers hold the load lock. Paced by
-- `bid_wave_minutes` unless forced (posting, reopening), and skipped while the
-- load already has `bid_enough_bids` live bids. A lapsed invitation is not a
-- "no", so a driver whose invitation expired can be asked again; a decline is
-- final (create_offer keeps it).
create or replace function private.invite_bid_drivers(p_load_id uuid, p_force boolean default false)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deadline   timestamptz;
  v_status     public.load_status;
  v_selected   uuid;
  v_last       timestamptz;
  v_sent       integer := 0;
  v_size       integer := private.setting_int('bid_invites_per_wave', 3);
  v_per_driver integer := private.setting_int('auto_dispatch_max_pending_per_driver', 3);
  v_offer      uuid;
  c            record;
begin
  select l.bid_deadline, l.status, l.selected_bid_id, b.last_wave_at
    into v_deadline, v_status, v_selected, v_last
  from public.loads l join private.bid_loads b on b.load_id = l.id
  where l.id = p_load_id and l.pricing_mode = 'bid';
  if v_deadline is null or v_deadline <= now() or v_selected is not null
     or v_status not in ('posted'::public.load_status, 'matched'::public.load_status) then
    return 0;
  end if;
  if not p_force and v_last > now() - make_interval(mins => private.setting_int('bid_wave_minutes', 5)) then
    return 0;
  end if;
  update private.bid_loads set last_wave_at = now() where load_id = p_load_id;
  if private.bid_live_count(p_load_id) >= private.setting_int('bid_enough_bids', 5) then
    return 0;
  end if;

  for c in
    select x.driver_id, x.leg_id from private.candidates_for(p_load_id, 1::smallint, 0, 30) x
    where x.offer_status is null or x.offer_status = 'expired'
  loop
    exit when v_sent >= v_size;
    continue when not private.bid_driver_eligible(p_load_id, c.driver_id);
    v_offer := public.create_offer(p_load_id, c.driver_id, c.leg_id, 'bid', false);
    update public.offers set expires_at = v_deadline where id = v_offer and status = 'pending';
    v_sent := v_sent + 1;
  end loop;

  if v_sent < v_size then
    for c in
      select n.driver_id, n.pending from private.nearby_drivers(p_load_id, 1500, true, 30) n
      where not exists (select 1 from public.offers o
                        where o.load_id = p_load_id and o.driver_id = n.driver_id
                          and o.status <> 'expired')
    loop
      exit when v_sent >= v_size;
      continue when c.pending >= v_per_driver;
      continue when not private.bid_driver_eligible(p_load_id, c.driver_id);
      v_offer := public.create_offer(p_load_id, c.driver_id, null, 'bid', false);
      update public.offers set expires_at = v_deadline where id = v_offer and status = 'pending';
      v_sent := v_sent + 1;
    end loop;
  end if;
  return v_sent;
end;
$$;
revoke all on function private.invite_bid_drivers(uuid, boolean) from public, anon, authenticated;

-- This is a new RPC rather than changing book_load under installed binaries.
-- Nothing invokes the fixed-rate quote or accepts a client-supplied price. The
-- optional target is what the shipper is willing to pay in total; it is never
-- shown to a driver.
create or replace function public.post_bid_load(
  p_origin_city bigint, p_dest_city bigint,
  p_pickup_from date, p_pickup_to date, p_goods text,
  p_weight_kg integer default null, p_truck_type_code text default null,
  p_origin_place jsonb default null, p_dest_place jsonb default null,
  p_target_total_baisa bigint default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_fee integer;
  v_deadline timestamptz;
begin
  if v_actor is null or private.actor_role() <> 'shipper' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  perform private.require_active();
  perform private.check_rate_limit('post_load', 20, interval '1 hour');
  if p_goods is null or char_length(btrim(p_goods)) = 0 then
    raise exception 'goods description required' using errcode = 'check_violation';
  end if;
  if p_pickup_to < (now() at time zone 'Asia/Muscat')::date then
    raise exception 'collection day has passed' using errcode = 'check_violation';
  end if;
  if p_truck_type_code is not null and not exists (
    select 1 from public.truck_types t where t.code = p_truck_type_code
  ) then
    raise exception 'unknown truck type' using errcode = 'foreign_key_violation';
  end if;
  if p_target_total_baisa is not null and p_target_total_baisa not between 1 and 1000000000 then
    raise exception 'invalid target price' using errcode = 'check_violation';
  end if;
  if p_origin_place is not null and private.place_city(p_origin_place) is distinct from p_origin_city then
    raise exception 'city does not match place' using errcode = 'check_violation';
  end if;
  if p_dest_place is not null and private.place_city(p_dest_place) is distinct from p_dest_city then
    raise exception 'city does not match place' using errcode = 'check_violation';
  end if;

  v_fee := private.current_bid_fee_bps();
  v_deadline := least(now() + make_interval(mins => private.setting_int('bid_window_minutes', 60)),
    (p_pickup_to + 1)::timestamp at time zone 'Asia/Muscat');
  if v_deadline <= now() + interval '5 minutes' then
    raise exception 'too late for bidding today' using errcode = 'check_violation';
  end if;

  insert into public.loads(shipper_id, origin_city, dest_city, pickup_from, pickup_to,
                           weight_kg, truck_type_code, goods_description, status,
                           pricing_mode, bid_deadline)
  values(v_actor, p_origin_city, p_dest_city, p_pickup_from, p_pickup_to,
         p_weight_kg, p_truck_type_code, btrim(p_goods), 'posted'::public.load_status,
         'bid', v_deadline)
  returning id into v_id;
  insert into private.bid_loads(load_id, fee_bps, target_total_baisa)
  values(v_id, v_fee, p_target_total_baisa);

  perform private.insert_load_place(v_id, 'pickup', p_origin_place);
  perform private.insert_load_place(v_id, 'drop', p_dest_place);
  perform private.invite_bid_drivers(v_id, true);
  return v_id;
end;
$$;
revoke all on function public.post_bid_load(bigint, bigint, date, date, text, integer, text, jsonb, jsonb, bigint)
  from public, anon;
grant execute on function public.post_bid_load(bigint, bigint, date, date, text, integer, text, jsonb, jsonb, bigint)
  to authenticated;

-- The shipper may set, change or clear the target while bidding is open. It is
-- applied when the window closes, never to a bid the moment it arrives.
create or replace function public.set_bid_target(p_load_id uuid, p_target_total_baisa bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_load public.loads;
begin
  perform private.require_active();
  select * into v_load from public.loads l
  where l.id = p_load_id and l.shipper_id = auth.uid() and l.pricing_mode = 'bid' for update;
  if v_load.id is null then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;
  if v_load.selected_bid_id is not null or v_load.bid_deadline <= now()
     or v_load.status not in ('posted'::public.load_status, 'matched'::public.load_status) then
    raise exception 'bidding already closed' using errcode = 'check_violation';
  end if;
  if p_target_total_baisa is not null and p_target_total_baisa not between 1 and 1000000000 then
    raise exception 'invalid target price' using errcode = 'check_violation';
  end if;
  update private.bid_loads set target_total_baisa = p_target_total_baisa where load_id = p_load_id;
end;
$$;
revoke all on function public.set_bid_target(uuid, bigint) from public, anon;
grant execute on function public.set_bid_target(uuid, bigint) to authenticated;

-- A bid is the driver's payout, not the shipper total. A driver may revise it
-- until the window closes.
create or replace function public.place_driver_bid(p_offer_id uuid, p_payout_baisa bigint)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_offer public.offers;
  v_load public.loads;
  v_id uuid;
begin
  if v_actor is null or private.actor_role() <> 'driver' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  perform private.require_active();
  perform private.check_rate_limit('place_driver_bid', 10, interval '1 hour');
  if p_payout_baisa is null or p_payout_baisa not between 1 and 1000000000 then
    raise exception 'invalid bid' using errcode = 'check_violation';
  end if;

  -- Scope to the actor before touching the load. Lock order is load then offer,
  -- matching acceptance and the minute job after this preliminary read.
  select * into v_offer from public.offers o
  where o.id = p_offer_id and o.driver_id = v_actor and o.source = 'bid';
  if v_offer.id is null then
    raise exception 'offer not found' using errcode = 'no_data_found';
  end if;
  select * into v_load from public.loads l where l.id = v_offer.load_id for update;
  select * into v_offer from public.offers o where o.id = p_offer_id for update;
  if v_load.pricing_mode <> 'bid' or v_load.selected_bid_id is not null
     or v_load.bid_deadline <= now()
     or v_load.status not in ('posted'::public.load_status, 'matched'::public.load_status)
     or v_offer.status <> 'pending' or v_offer.expires_at <= now() then
    raise exception 'bidding closed' using errcode = 'check_violation';
  end if;
  if not private.bid_driver_eligible(v_load.id, v_actor) then
    raise exception 'driver no longer eligible' using errcode = 'check_violation';
  end if;
  insert into private.driver_bids(load_id, offer_id, driver_id, payout_baisa)
  values(v_load.id, v_offer.id, v_actor, p_payout_baisa)
  on conflict (load_id, driver_id) do update
    set payout_baisa = excluded.payout_baisa, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.place_driver_bid(uuid, bigint) from public, anon;
grant execute on function public.place_driver_bid(uuid, bigint) to authenticated;

-- A driver's live bid invitations. The pin, place name and note are there so a
-- driver can price the trip; the contact's name and phone are not — nobody
-- needs them to bid, and many drivers are invited. The winner gets them from
-- driver_trip() once assigned.
create or replace function public.driver_bid_invites()
returns table(
  offer_id uuid, load_id uuid, bid_deadline timestamptz,
  origin_city bigint, dest_city bigint, pickup_from date, pickup_to date,
  goods text, weight_kg integer, truck_type_code text, own_bid_baisa bigint,
  pickup_lat double precision, pickup_lng double precision, pickup_name text, pickup_note text,
  drop_lat double precision, drop_lng double precision, drop_name text, drop_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, l.id, l.bid_deadline, l.origin_city, l.dest_city,
         l.pickup_from, l.pickup_to, l.goods_description,
         l.weight_kg, l.truck_type_code, b.payout_baisa,
         pp.lat, pp.lng, pp.place_name, pp.note,
         dp.lat, dp.lng, dp.place_name, dp.note
  from public.offers o
  join public.loads l on l.id = o.load_id and l.pricing_mode = 'bid'
  left join private.driver_bids b on b.offer_id = o.id and b.driver_id = auth.uid()
  left join public.load_places pp on pp.load_id = l.id and pp.kind = 'pickup'
  left join public.load_places dp on dp.load_id = l.id and dp.kind = 'drop'
  where auth.uid() is not null and o.driver_id = auth.uid()
    and o.source = 'bid' and o.status = 'pending'
    and o.expires_at > now() and l.bid_deadline > now()
    and l.selected_bid_id is null
  order by o.created_at desc;
$$;
revoke all on function public.driver_bid_invites() from public, anon;
grant execute on function public.driver_bid_invites() to authenticated;

-- Competing bids, semi-anonymised, for a driver holding a live invitation on
-- that load. `bidder_no` is fixed by the order of first bids, so a number keeps
-- meaning the same driver while they revise. The amount is what that driver
-- keeps — never the shipper's total, which would expose the fee.
create or replace function public.driver_load_bids(p_offer_id uuid)
returns table(
  bidder_no integer, truck_type text, payout_baisa bigint,
  updated_at timestamptz, is_you boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_load public.loads;
begin
  select l.* into v_load from public.offers o
  join public.loads l on l.id = o.load_id
  where o.id = p_offer_id and o.driver_id = auth.uid() and auth.uid() is not null
    and o.source = 'bid' and o.status = 'pending' and o.expires_at > now()
    and l.pricing_mode = 'bid' and l.bid_deadline > now() and l.selected_bid_id is null;
  if v_load.id is null then
    raise exception 'offer not found' using errcode = 'no_data_found';
  end if;
  return query
  with numbered as (
    select b.*, row_number() over (order by b.created_at, b.id) as n
    from private.driver_bids b where b.load_id = v_load.id
  )
  select nb.n::integer, t.truck_type, nb.payout_baisa, nb.updated_at, nb.driver_id = auth.uid()
  from numbered nb
  join public.offers o on o.id = nb.offer_id and o.status <> 'declined'
  left join lateral (
    select tr.truck_type from public.trucks tr
    where tr.owner_id = nb.driver_id
      and (v_load.truck_type_code is null or tr.truck_type = v_load.truck_type_code)
      and (v_load.weight_kg is null or tr.capacity_kg >= v_load.weight_kg)
    order by tr.capacity_kg asc nulls last limit 1
  ) t on true
  order by nb.payout_baisa, nb.created_at, nb.id;
end;
$$;
revoke all on function public.driver_load_bids(uuid) from public, anon;
grant execute on function public.driver_load_bids(uuid) to authenticated;

-- A shipper reads bids only for their own load, as totals. The payout is not
-- returned: total minus payout is the fee.
create or replace function public.shipper_load_bids(p_load_id uuid)
returns table(
  bid_id uuid, driver_name text, truck_type text,
  total_baisa bigint, submitted_at timestamptz, selected boolean, eligible boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.loads l where l.id = p_load_id
      and l.shipper_id = auth.uid() and l.pricing_mode = 'bid'
  ) then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;
  return query
  select b.id, p.full_name, t.truck_type,
         private.bid_total(b.payout_baisa, bl.fee_bps), b.created_at,
         l.selected_bid_id is not distinct from b.id,
         private.bid_driver_eligible(l.id, b.driver_id)
  from private.driver_bids b
  join public.loads l on l.id = b.load_id
  join private.bid_loads bl on bl.load_id = l.id
  join public.profiles p on p.id = b.driver_id
  join public.offers o on o.id = b.offer_id and o.status <> 'declined'
  left join lateral (
    select tr.truck_type from public.trucks tr
    where tr.owner_id = b.driver_id
      and (l.truck_type_code is null or tr.truck_type = l.truck_type_code)
      and (l.weight_kg is null or tr.capacity_kg >= l.weight_kg)
    order by tr.capacity_kg asc nulls last limit 1
  ) t on true
  where b.load_id = p_load_id
  order by b.payout_baisa, b.created_at, b.id;
end;
$$;
revoke all on function public.shipper_load_bids(uuid) from public, anon;
grant execute on function public.shipper_load_bids(uuid) to authenticated;

-- The shipper's view of the auction itself: their own target, and the price of
-- the bid the server proposed, which is not on `loads` until it is awarded.
create or replace function public.shipper_bid_status(p_load_id uuid)
returns table(
  bid_deadline timestamptz, target_total_baisa bigint,
  selected_bid_id uuid, selected_total_baisa bigint, bid_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.loads l where l.id = p_load_id
      and l.shipper_id = auth.uid() and l.pricing_mode = 'bid'
  ) then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;
  return query
  select l.bid_deadline, bl.target_total_baisa, l.selected_bid_id,
         (select private.bid_total(db.payout_baisa, bl.fee_bps)
          from private.driver_bids db where db.id = l.selected_bid_id),
         (select count(*)::integer from private.driver_bids db
          join public.offers o on o.id = db.offer_id and o.status <> 'declined'
          where db.load_id = l.id)
  from public.loads l join private.bid_loads bl on bl.load_id = l.id
  where l.id = p_load_id;
end;
$$;
revoke all on function public.shipper_bid_status(uuid) from public, anon;
grant execute on function public.shipper_bid_status(uuid) to authenticated;

-- Assign the load to a bid. Callers hold the load lock and have checked the
-- bid is still eligible. Snapshots the total onto the load and the payout into
-- private.bid_loads, then reuses accept_offer — the same trip-creating path as
-- every other assignment. `p_by_ops = true` only lets it past the invitation's
-- expiry: the invitation lapses at the deadline, and the shipper may accept
-- after it.
create or replace function private.award_bid(p_load_id uuid, p_bid_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bid private.driver_bids;
  v_fee integer;
  v_trip uuid;
begin
  select * into v_bid from private.driver_bids b where b.id = p_bid_id and b.load_id = p_load_id;
  select bl.fee_bps into v_fee from private.bid_loads bl where bl.load_id = p_load_id;
  perform 1 from public.offers o where o.id = v_bid.offer_id for update;
  update public.offers set status = 'pending', expires_at = now() + interval '5 minutes'
  where id = v_bid.offer_id;
  update public.loads set selected_bid_id = v_bid.id,
    price_baisa = private.bid_total(v_bid.payout_baisa, v_fee),
    accepted_at = now(), status = 'matched'::public.load_status
  where id = p_load_id;
  update private.bid_loads set awarded_payout_baisa = v_bid.payout_baisa where load_id = p_load_id;
  v_trip := private.accept_offer(v_bid.offer_id, v_bid.driver_id, true);
  return v_trip;
end;
$$;
revoke all on function private.award_bid(uuid, uuid) from public, anon, authenticated;

-- No bid to take: keep looking rather than hand the load to a person. The
-- window restarts and invitations go out again, until the collection day ends.
-- Only then does the load become `finding_truck` and a person hear about it —
-- the no-dead-end backstop (CLAUDE.md #6), reached as late as possible.
create or replace function private.reopen_bidding(p_load_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pickup_to date;
  v_new timestamptz;
begin
  select l.pickup_to into v_pickup_to from public.loads l where l.id = p_load_id;
  v_new := least(now() + make_interval(mins => private.setting_int('bid_window_minutes', 60)),
    (v_pickup_to + 1)::timestamp at time zone 'Asia/Muscat');

  if v_new <= now() + interval '5 minutes' then
    update public.loads set selected_bid_id = null,
      status = 'finding_truck'::public.load_status
    where id = p_load_id;
    perform private.system_raise_alert('bidding_no_driver',
      'No driver bid for load ' || upper(left(p_load_id::text, 8)) || ' before its collection day ended',
      jsonb_build_object('load_id', p_load_id));
    return false;
  end if;

  update public.loads set selected_bid_id = null, bid_deadline = v_new,
    status = case when status = 'quoted'::public.load_status
                  then 'matched'::public.load_status else status end
  where id = p_load_id;
  update public.offers set expires_at = v_new
  where load_id = p_load_id and source = 'bid' and status = 'pending';
  perform private.invite_bid_drivers(p_load_id, true);
  return true;
end;
$$;
revoke all on function private.reopen_bidding(uuid) from public, anon, authenticated;

-- The window has closed. Callers hold the load lock. The lowest eligible bid is
-- awarded outright when it is within the shipper's target; otherwise it is
-- proposed (`quoted`) and the shipper decides. No bid reopens the window.
-- Nothing here writes `loads.price_baisa` for a proposal — see the header.
create or replace function private.select_best_bid(p_load_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bid private.driver_bids;
  v_fee integer;
  v_target bigint;
begin
  select bl.fee_bps, bl.target_total_baisa into v_fee, v_target
  from private.bid_loads bl join public.loads l on l.id = bl.load_id
  where bl.load_id = p_load_id and l.pricing_mode = 'bid';
  if not found then return null; end if;

  select b.* into v_bid from private.driver_bids b
  join public.offers o on o.id = b.offer_id and o.status <> 'declined'
  where b.load_id = p_load_id and private.bid_driver_eligible(p_load_id, b.driver_id)
  order by b.payout_baisa, b.created_at, b.id limit 1;

  if v_bid.id is null then
    perform private.reopen_bidding(p_load_id);
    return null;
  end if;

  if v_target is not null and private.bid_total(v_bid.payout_baisa, v_fee) <= v_target then
    perform private.award_bid(p_load_id, v_bid.id);
    return v_bid.id;
  end if;

  update public.loads set selected_bid_id = v_bid.id,
    status = 'quoted'::public.load_status
  where id = p_load_id;
  return v_bid.id;
end;
$$;
revoke all on function private.select_best_bid(uuid) from public, anon, authenticated;

-- End the window now. The shipper can instead accept any displayed bid
-- directly, without waiting for this selection.
create or replace function public.close_bidding(p_load_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_load public.loads;
begin
  perform private.require_active();
  select * into v_load from public.loads l
  where l.id = p_load_id and l.shipper_id = auth.uid() for update;
  if v_load.id is null then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;
  if v_load.pricing_mode <> 'bid' or v_load.selected_bid_id is not null
     or v_load.bid_deadline <= now()
     or v_load.status not in ('posted'::public.load_status, 'matched'::public.load_status) then
    raise exception 'bidding already closed' using errcode = 'check_violation';
  end if;
  update public.loads set bid_deadline = now() where id = p_load_id;
  return private.select_best_bid(p_load_id);
end;
$$;
revoke all on function public.close_bidding(uuid) from public, anon;
grant execute on function public.close_bidding(uuid) to authenticated;

create or replace function public.extend_bidding(p_load_id uuid, p_minutes integer)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_load public.loads;
  v_new timestamptz;
begin
  perform private.require_active();
  select * into v_load from public.loads l
  where l.id = p_load_id and l.shipper_id = auth.uid() for update;
  if v_load.id is null then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;
  if v_load.pricing_mode <> 'bid' or v_load.bid_deadline <= now()
     or v_load.selected_bid_id is not null
     or v_load.status not in ('posted'::public.load_status, 'matched'::public.load_status)
     or p_minutes is null or p_minutes not between 5 and 1440 then
    raise exception 'cannot extend bidding' using errcode = 'check_violation';
  end if;
  v_new := v_load.bid_deadline + make_interval(mins => p_minutes);
  if v_new > v_load.created_at + interval '24 hours'
     or v_new > (v_load.pickup_to + 1)::timestamp at time zone 'Asia/Muscat' then
    raise exception 'bidding deadline too late' using errcode = 'check_violation';
  end if;
  update public.loads set bid_deadline = v_new where id = p_load_id;
  update public.offers set expires_at = v_new
  where load_id = p_load_id and source = 'bid' and status = 'pending';
  return v_new;
end;
$$;
revoke all on function public.extend_bidding(uuid, integer) from public, anon;
grant execute on function public.extend_bidding(uuid, integer) to authenticated;

-- The shipper chooses a bid, or accepts the server's proposal. While the window
-- is open a bid that has gone stale is refused and changes nothing — a stale tap
-- must not end the auction for everyone else. After the window it is replaced
-- by the next valid bid (or the window reopens); a stale bid is never assigned.
create or replace function public.accept_driver_bid(p_load_id uuid, p_bid_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_load public.loads;
  v_bid private.driver_bids;
  v_offer_status text;
begin
  perform private.require_active();
  select * into v_load from public.loads l
  where l.id = p_load_id and l.shipper_id = auth.uid() for update;
  if v_load.id is null then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;
  if v_load.pricing_mode <> 'bid' or v_load.status not in
     ('posted'::public.load_status, 'matched'::public.load_status,
      'quoted'::public.load_status, 'finding_truck'::public.load_status) then
    raise exception 'load already assigned' using errcode = 'check_violation';
  end if;
  select * into v_bid from private.driver_bids b
  where b.id = p_bid_id and b.load_id = p_load_id;
  if v_bid.id is null then
    raise exception 'bid not found' using errcode = 'no_data_found';
  end if;
  select o.status::text into v_offer_status from public.offers o where o.id = v_bid.offer_id;
  if v_offer_status = 'declined' or not private.bid_driver_eligible(p_load_id, v_bid.driver_id) then
    if v_load.bid_deadline > now() and v_load.selected_bid_id is null
       and v_load.status in ('posted'::public.load_status, 'matched'::public.load_status) then
      raise exception 'bid no longer available' using errcode = 'check_violation';
    end if;
    perform private.select_best_bid(p_load_id);
    return null;
  end if;

  return private.award_bid(p_load_id, v_bid.id);
end;
$$;
revoke all on function public.accept_driver_bid(uuid, uuid) from public, anon;
grant execute on function public.accept_driver_bid(uuid, uuid) to authenticated;

-- The old client must never be able to turn a bid invitation into an instant
-- assignment by calling its accept-or-decline RPC. Decline remains allowed.
create or replace function public.respond_to_offer(p_offer_id uuid, p_accept boolean)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_offer public.offers;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  select * into v_offer from public.offers o
  where o.id = p_offer_id and o.driver_id = v_actor;
  if v_offer.id is null then
    raise exception 'offer not found' using errcode = 'no_data_found';
  end if;
  if v_offer.source = 'bid' and p_accept then
    raise exception 'place a bid instead' using errcode = 'check_violation';
  end if;
  if p_accept then
    perform private.require_active();
    return private.accept_offer(p_offer_id, v_actor, false);
  end if;

  -- Load first, then offer, including the decline path. The bid-close and
  -- award functions take the same locks in this order.
  perform 1 from public.loads l where l.id = v_offer.load_id for update;
  select * into v_offer from public.offers o where o.id = p_offer_id for update;
  if v_offer.status <> 'pending' then
    raise exception 'offer already resolved' using errcode = 'check_violation';
  end if;
  if v_offer.expires_at <= now() then
    update public.offers set status = 'expired' where id = v_offer.id;
    raise exception 'offer expired' using errcode = 'check_violation';
  end if;
  update public.offers set status = 'declined' where id = v_offer.id;
  if v_offer.source <> 'bid' and not exists (
    select 1 from public.offers o where o.load_id = v_offer.load_id
      and o.status = 'pending' and o.expires_at > now()
  ) then
    update public.loads set status = 'finding_truck'::public.load_status
    where id = v_offer.load_id and status = 'matched'::public.load_status;
  end if;
  return null;
end;
$$;
revoke all on function public.respond_to_offer(uuid, boolean) from public, anon;
grant execute on function public.respond_to_offer(uuid, boolean) to authenticated;

-- Keep old accept buttons from showing bid invitations with a blank payout.
-- The existing definer is moved to `private` unchanged, so its 0041 place
-- projection is not copied into a second implementation.
alter function public.driver_offers() rename to driver_offers_legacy_unfiltered;
alter function public.driver_offers_legacy_unfiltered() set schema private;
revoke all on function private.driver_offers_legacy_unfiltered()
  from public, anon, authenticated;

create function public.driver_offers()
returns table (
  offer_id uuid, expires_at timestamptz, leg_id uuid,
  origin_city bigint, dest_city bigint, pickup_from date, pickup_to date,
  goods text, weight_kg integer, truck_type_code text,
  collect_baisa bigint, payout_baisa bigint, owed_baisa bigint,
  currency char(3), detour_km numeric, free_after_kg integer,
  pickup_lat double precision, pickup_lng double precision, pickup_name text,
  pickup_note text, pickup_contact_name text, pickup_contact_phone text,
  drop_lat double precision, drop_lng double precision, drop_name text,
  drop_note text, drop_contact_name text, drop_contact_phone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.* from private.driver_offers_legacy_unfiltered() d
  join public.offers o on o.id = d.offer_id and o.source <> 'bid';
$$;
revoke all on function public.driver_offers() from public, anon;
grant execute on function public.driver_offers() to authenticated;

create or replace function public.driver_offer(p_offer_id uuid)
returns table (
  offer_id uuid, expires_at timestamptz, leg_id uuid,
  origin_city bigint, dest_city bigint, pickup_from date, pickup_to date,
  goods text, weight_kg integer, truck_type_code text,
  collect_baisa bigint, payout_baisa bigint, owed_baisa bigint,
  currency char(3), detour_km numeric, free_after_kg integer,
  pickup_lat double precision, pickup_lng double precision, pickup_name text,
  pickup_note text, pickup_contact_name text, pickup_contact_phone text,
  drop_lat double precision, drop_lng double precision, drop_name text,
  drop_note text, drop_contact_name text, drop_contact_phone text
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

-- Every minute: close windows that have ended, and send the next wave to open
-- ones that are due one.
create or replace function private.system_bid_tick()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_closed integer := 0;
  v_invited integer := 0;
  r record;
begin
  for r in
    select l.id, l.bid_deadline from public.loads l
    where l.pricing_mode = 'bid' and l.selected_bid_id is null
      and l.status in ('posted'::public.load_status, 'matched'::public.load_status)
    order by l.bid_deadline for update of l skip locked
  loop
    if r.bid_deadline <= now() then
      perform private.select_best_bid(r.id);
      v_closed := v_closed + 1;
    else
      v_invited := v_invited + private.invite_bid_drivers(r.id, false);
    end if;
    v_count := v_count + 1;
  end loop;
  if v_closed > 0 or v_invited > 0 then
    perform private.log_system('system_bid_tick', 'system', 'loads',
      jsonb_build_object('closed', v_closed, 'invited', v_invited));
  end if;
  return v_count;
end;
$$;
revoke all on function private.system_bid_tick() from public, anon, authenticated;

select cron.schedule('bid-tick', '* * * * *',
  $$select private.system_bid_tick()$$);

-- The offer sweeps must not hand a bid load to a person. Bid invitations all
-- lapse at the deadline (and may all be declined mid-window), which is exactly
-- the "no live offer" condition the sweep acts on — and once it moved the load
-- to finding_truck, the bid tick no longer saw it and the bids were never
-- judged. The bid lifecycle belongs to system_bid_tick. Both bodies otherwise
-- unchanged (0016, 0034), kept identical as 0034 asks.
create or replace function private.system_sweep_expired_offers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with swept as (
    update public.offers set status = 'expired'
    where status = 'pending' and expires_at <= now()
    returning load_id
  )
  select count(distinct load_id) into v_count from swept;

  update public.loads set status = 'finding_truck'
  where status = 'matched'
    and pricing_mode = 'fixed'
    and not exists (
      select 1 from public.offers o
      where o.load_id = public.loads.id
        and o.status = 'pending'
        and o.expires_at > now()
    );

  if v_count > 0 then
    perform private.log_system(
      'system_sweep_expired_offers', 'system', 'offers',
      jsonb_build_object('loads_affected', v_count));
  end if;

  return v_count;
end;
$$;
revoke all on function private.system_sweep_expired_offers()
  from public, anon, authenticated;

create or replace function public.ops_sweep_expired_offers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_ops();

  with swept as (
    update public.offers set status = 'expired'
    where status = 'pending' and expires_at <= now()
    returning load_id
  )
  select count(distinct load_id) into v_count from swept;

  update public.loads set status = 'finding_truck'
  where status = 'matched'
    and pricing_mode = 'fixed'
    and not exists (
      select 1 from public.offers o
      where o.load_id = public.loads.id
        and o.status = 'pending'
        and o.expires_at > now()
    );

  perform private.log_ops(
    'ops_sweep_expired_offers', 'system', 'offers', null,
    jsonb_build_object('loads_affected', v_count), null
  );

  return v_count;
end;
$$;
revoke all on function public.ops_sweep_expired_offers() from public, anon;
grant execute on function public.ops_sweep_expired_offers() to authenticated;

-- An open auction is not a stuck load. Without this every bid load would page a
-- dispatcher 30 minutes into its hour. A bid load is watched once it is
-- `finding_truck` (its collection day ran out), like any other. Otherwise
-- unchanged from 0034.
create or replace function private.system_watch_loads()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutes integer := private.setting_int('stuck_alert_minutes', 30);
  v_ids     uuid[];
  v_lines   text;
begin
  delete from private.load_watch w
   using public.loads l
   where l.id = w.load_id and l.status <> w.status;

  insert into private.load_watch (load_id, status)
  select l.id, l.status from public.loads l
   where l.status in ('posted', 'finding_truck', 'accepted', 'matched')
     and (l.pricing_mode = 'fixed' or l.status = 'finding_truck')
  on conflict do nothing;

  with due as (
    update private.load_watch w
       set alerted_at = now()
     where w.alerted_at is null
       and w.first_seen_at < now() - make_interval(mins => v_minutes)
    returning w.load_id, w.status
  )
  select array_agg(load_id),
         string_agg('• ' || left(load_id::text, 8) || '  ' || status::text, E'\n')
    into v_ids, v_lines
    from due;

  if v_ids is null then
    return 0;
  end if;

  perform private.system_raise_alert(
    'stuck_loads',
    format(E'Truckkoo: %s load(s) waiting on dispatch for over %s minutes\n%s',
           cardinality(v_ids), v_minutes, v_lines),
    jsonb_build_object('load_ids', to_jsonb(v_ids), 'minutes', v_minutes));

  return cardinality(v_ids);
end;
$$;
revoke all on function private.system_watch_loads() from public, anon, authenticated;

-- The winning driver's payout is a historical fact, snapshotted privately at
-- award. The global commission still computes payouts for fixed-price trips.
create or replace function private.trip_payout(p_trip_id uuid, p_price_baisa bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select bl.awarded_payout_baisa from private.bid_loads bl where bl.load_id = t.load_id),
    private.payout_for(p_price_baisa))
  from public.trips t where t.id = p_trip_id;
$$;
revoke all on function private.trip_payout(uuid, bigint) from public, anon, authenticated;

create or replace function public.driver_trip(p_trip_id uuid)
returns table (
  trip_id uuid, status public.trip_status, load_id uuid,
  origin_city bigint, dest_city bigint, pickup_from date, pickup_to date,
  goods text, weight_kg integer, collect_baisa bigint, payout_baisa bigint,
  owed_baisa bigint, currency char(3), shipper_name text, shipper_phone text,
  pickup_lat double precision, pickup_lng double precision, pickup_name text,
  pickup_note text, pickup_contact_name text, pickup_contact_phone text,
  drop_lat double precision, drop_lng double precision, drop_name text,
  drop_note text, drop_contact_name text, drop_contact_phone text
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
  select t.id, t.status, l.id, l.origin_city, l.dest_city,
    l.pickup_from, l.pickup_to, l.goods_description, l.weight_kg,
    l.price_baisa, private.trip_payout(t.id, l.price_baisa),
    l.price_baisa - private.trip_payout(t.id, l.price_baisa),
    l.currency, p.full_name, p.phone,
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
  where t.id = p_trip_id and t.driver_id = v_actor;
end;
$$;
revoke all on function public.driver_trip(uuid) from public, anon;
grant execute on function public.driver_trip(uuid) to authenticated;

create or replace function public.driver_trips()
returns table (
  trip_id uuid, origin_city bigint, dest_city bigint, goods text,
  weight_kg integer, payout_baisa bigint, currency char(3), delivered_at timestamptz
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
  select t.id, l.origin_city, l.dest_city, l.goods_description, l.weight_kg,
    private.trip_payout(t.id, l.price_baisa), l.currency,
    private.trip_done_at(t.id, t.created_at) as done_at
  from public.trips t
  join public.loads l on l.id = t.load_id
  where t.driver_id = v_actor
    and t.status in ('delivered'::public.trip_status, 'closed'::public.trip_status)
  order by done_at desc limit 200;
end;
$$;
revoke all on function public.driver_trips() from public, anon;
grant execute on function public.driver_trips() to authenticated;

create or replace function public.driver_earnings()
returns table (
  week_baisa bigint, week_trips bigint, all_time_trips bigint,
  month_baisa bigint, month_trips bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date;
  v_week date;
  v_month date;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  v_today := (now() at time zone 'Asia/Muscat')::date;
  v_week := v_today - (extract(isodow from v_today)::int % 7);
  v_month := date_trunc('month', v_today)::date;
  return query
  with delivered as (
    select private.trip_payout(t.id, l.price_baisa) as payout,
      (private.trip_done_at(t.id, t.created_at) at time zone 'Asia/Muscat')::date as done_on
    from public.trips t join public.loads l on l.id = t.load_id
    where t.driver_id = v_actor
      and t.status in ('delivered'::public.trip_status, 'closed'::public.trip_status)
  )
  select
    coalesce(sum(d.payout) filter (where d.done_on >= v_week), 0)::bigint,
    count(*) filter (where d.done_on >= v_week)::bigint,
    count(*)::bigint,
    coalesce(sum(d.payout) filter (where d.done_on >= v_month), 0)::bigint,
    count(*) filter (where d.done_on >= v_month)::bigint
  from delivered d;
end;
$$;
revoke all on function public.driver_earnings() from public, anon;
grant execute on function public.driver_earnings() to authenticated;

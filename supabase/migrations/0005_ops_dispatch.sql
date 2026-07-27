-- ─────────────────────────────────────────────────────────────────────────────
-- 0005 — ops dispatch: closing the loop
--
-- WHY THIS EXISTS
--
-- Until now nothing could create an offer. `post_load()` sets status 'posted',
-- `match_load()` is read-only and shipper-scoped, and `create_offer()` was
-- revoked from every client role — the comment above it said offers are minted by
-- "Edge Function or ops console" and neither existed. A driver's offers list was
-- structurally always empty, and 'finding_truck' — the public promise that a
-- shipper never hits a dead end — was set by nothing at all.
--
-- This migration adds the operator in the middle: Truckkoo's own dispatcher.
--
-- THE ESCALATION THIS DELIBERATELY AVOIDS
--
-- Ops membership is NOT a value in `profiles.role`. `role` carries an INSERT
-- grant (that is how signup records shipper vs driver) and column grants cannot
-- restrict *which value* is inserted. So the moment 'ops' were a valid role, any
-- user could self-assign it during signup and read every shipper's cargo and
-- every driver's routes.
--
-- Instead membership lives in `private.ops_users`, which has no grant to `anon`
-- or `authenticated` at all, is not reachable through PostgREST (only `public` is
-- exposed), and is populated by hand in the dashboard. Adding a dispatcher is a
-- deliberate act by someone with database access, not a checkbox at signup.
--
-- CROSS-TENANT READS — SECURITY.md §16
--
-- Dispatch inherently sees across tenants: that is the job. Rather than loosen any
-- RLS policy, the reads are confined to definer functions that check ops
-- membership first and return only the columns dispatch needs. No new table
-- policy grants a client cross-tenant visibility, so a bug in a screen cannot
-- widen it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── membership ─────────────────────────────────────────────────────────────

create table if not exists private.ops_users (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  note       text,
  added_at   timestamptz not null default now()
);

-- Deny by default. No client role gets any privilege here, ever. The only reader
-- is the definer helper below, which runs as owner.
revoke all on table private.ops_users from anon, authenticated;

comment on table private.ops_users is
  'Dispatcher allow-list. Populated by hand via the dashboard; deliberately NOT a '
  'profiles.role value, because role carries an INSERT grant and a column grant '
  'cannot restrict which value is inserted.';

create or replace function private.is_ops()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.ops_users o where o.profile_id = (select auth.uid())
  );
$$;

-- ─── the guard every ops function opens with ────────────────────────────────

create or replace function private.require_ops()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_ops() then
    -- "not found", never "forbidden": a 403 confirms the endpoint exists and that
    -- the caller found something worth guarding (SECURITY.md §3).
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
end;
$$;

-- ─── the dispatch queue ─────────────────────────────────────────────────────
-- Loads awaiting a decision, oldest first. Returns only what a dispatcher needs
-- to act; notably no shipper phone number, which stays out of the list view.

create or replace function public.ops_queue()
returns table (
  load_id          uuid,
  origin_city      bigint,
  dest_city        bigint,
  pickup_from      date,
  pickup_to        date,
  goods            text,
  weight_kg        integer,
  truck_type_code  text,
  status           text,
  posted_at        timestamptz,
  offer_count      bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select
    l.id,
    l.origin_city,
    l.dest_city,
    l.pickup_from,
    l.pickup_to,
    l.goods_description,
    l.weight_kg,
    l.truck_type_code,
    l.status::text,
    l.created_at,
    (select count(*) from public.offers o
      where o.load_id = l.id and o.status = 'pending')
  from public.loads l
  where l.status in ('posted', 'finding_truck', 'matched')
  order by l.created_at asc;
end;
$$;

revoke all on function public.ops_queue() from public, anon;
grant execute on function public.ops_queue() to authenticated;

-- ─── candidate drivers for a load ───────────────────────────────────────────
-- `match_load()` re-checks `shipper_id = auth.uid()` internally and must keep
-- doing so — it is granted to every authenticated user. Dispatch needs the same
-- matching over a load it does not own, so it gets its own entry point with its
-- own authorization check rather than a weakened shared one.

create or replace function public.ops_candidates(p_load_id uuid)
returns table (
  driver_id     uuid,
  driver_name   text,
  leg_id        uuid,
  leg_origin    bigint,
  leg_dest      bigint,
  depart_from   date,
  depart_to     date,
  is_empty      boolean,
  truck_type    text,
  already_offered boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select
    lg.driver_id,
    p.full_name,
    lg.id,
    lg.origin_city,
    lg.dest_city,
    lg.depart_from,
    lg.depart_to,
    lg.is_empty,
    t.truck_type,
    exists (select 1 from public.offers o
             where o.load_id = p_load_id and o.driver_id = lg.driver_id)
  from public.loads l
  join public.legs lg
    on lg.origin_city = l.origin_city
   and lg.dest_city   = l.dest_city
   and lg.status      = 'open'
   -- The declared window must cover the requested pickup window.
   and lg.depart_from <= l.pickup_to
   and lg.depart_to   >= l.pickup_from
  join public.profiles p on p.id = lg.driver_id
  left join public.trucks t on t.owner_id = lg.driver_id
  where l.id = p_load_id
    -- A load with no truck type asked for is "advise me": every truck qualifies.
    and (l.truck_type_code is null or t.truck_type is null
         or t.truck_type = l.truck_type_code)
  order by lg.is_empty desc, lg.depart_from asc;
end;
$$;

revoke all on function public.ops_candidates(uuid) from public, anon;
grant execute on function public.ops_candidates(uuid) to authenticated;

-- ─── send an offer ──────────────────────────────────────────────────────────
-- `create_offer` stays revoked from clients. This is the only way in, and it
-- checks ops membership before delegating.

create or replace function public.ops_send_offer(
  p_load_id   uuid,
  p_driver_id uuid,
  p_leg_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_send_offer', 200, interval '1 hour');

  -- The leg must belong to the driver being offered the load. Without this an ops
  -- account could staple one driver's route onto another driver's offer, which
  -- would corrupt the record of why a truck was chosen.
  if p_leg_id is not null
     and not exists (select 1 from public.legs lg
                     where lg.id = p_leg_id and lg.driver_id = p_driver_id) then
    raise exception 'leg does not belong to that driver' using errcode = 'check_violation';
  end if;

  v_id := public.create_offer(p_load_id, p_driver_id, p_leg_id);
  return v_id;
end;
$$;

revoke all on function public.ops_send_offer(uuid, uuid, uuid) from public, anon;
grant execute on function public.ops_send_offer(uuid, uuid, uuid) to authenticated;

-- ─── no match: keep the promise ─────────────────────────────────────────────
-- PRODUCT.md: a shipper never hits a dead end. When nothing fits, the load moves
-- to 'finding_truck' and a human arranges a fresh trip. Before this migration
-- that status was unreachable, so the promise was decorative.

create or replace function public.ops_mark_finding_truck(p_load_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  update public.loads
     set status = 'finding_truck'
   where id = p_load_id
     and status = 'posted';

  if not found then
    raise exception 'load not open' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.ops_mark_finding_truck(uuid) from public, anon;
grant execute on function public.ops_mark_finding_truck(uuid) to authenticated;

-- ─── how to appoint a dispatcher ────────────────────────────────────────────
-- Run this by hand in the SQL editor, once, per dispatcher:
--
--   insert into private.ops_users (profile_id, note)
--   select id, 'founder' from public.profiles where id = '<uuid>';
--
-- There is intentionally no UI for this and no API path to it.

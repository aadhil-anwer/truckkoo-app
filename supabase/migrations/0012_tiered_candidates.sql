-- ─────────────────────────────────────────────────────────────────────────────
-- 0012 — tiered candidates: who can actually carry this load
--
-- WHY THIS EXISTS
--
-- `ops_candidates` (0005) INNER JOINS `legs`. A driver who has not declared a leg
-- covering this exact city pair and window does not appear — so the dispatcher
-- cannot offer them the load even when they would happily take it. Every load
-- whose route nobody happened to declare that week dead-ends at an empty
-- candidate list, and the operator's only remaining move is `finding_truck`.
--
-- That is the disconnect between drivers declaring trips and shippers wanting
-- them. The fix is not a load board — drivers still never browse cargo, and
-- `create_offer` stays revoked from every client role. The fix is to widen who
-- the DISPATCHER can reach, in explicit tiers:
--
--   tier 1  declared an EMPTY leg on this route      ← the whole point of the product
--   tier 2  declared a PART-LOADED leg on this route
--   tier 3  no declared leg, but has RUN THIS CORRIDOR before
--
-- Tier 3 is the new reach. It is ranked by recency and capped, because a
-- dispatcher scanning forty names is a dispatcher who picks the first one.
--
-- ONE IMPLEMENTATION, NOT THREE
--
-- `match_load` (0003), `ops_candidates` (0005) and the auto-dispatch added in 0014
-- would otherwise be three answers to "who can carry this", and they had already
-- diverged before this migration: `ops_candidates` had no grace window, no
-- capacity filter at all, and returned a duplicate row per truck a driver owns.
-- So the whole decision moves into `private.candidates_for()` and everything calls
-- it — the same argument 0011 makes for `private.price_for`, for the same reason.
--
-- ── SECURITY (SECURITY.md §3, §7) ──────────────────────────────────────────
-- `private.candidates_for` DOES NOT CHECK OWNERSHIP. It is the load board with
-- the guard removed, and it is `private` with no grant to any role precisely
-- because of that. Its callers do the checking:
--   * `public.ops_candidates`  → `private.require_ops()` first
--   * `private.auto_dispatch`  → not client-callable at all (0014)
-- If you ever grant this to `authenticated`, every driver can enumerate every
-- shipper's cargo. Do not.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ WHERE AN OFFER CAME FROM ═══════════════════════════════════════════════
-- 0014 sends offers with no human in the loop. Distinguishing those from a
-- dispatcher's deliberate act is the difference between "nobody has looked at this
-- yet" and "a person chose you", and the ops queue needs it to stay honest.

alter table public.offers
  add column if not exists source text not null default 'ops'
  constraint offers_source_known check (source in ('ops', 'auto'));

-- `public.offers` carries a TABLE-level `grant select` (0001:561), so the column
-- above just auto-exposed itself to every driver and every shipper. SECURITY.md
-- §10: adding a column must never auto-expose it. Narrow the grant to a column
-- list, the way `public.quotes` does.
--
-- `source` stays server-side. A driver who can see it learns that nobody reviewed
-- their load before it was sent; a shipper who can see it learns the shape of the
-- fan-out. Neither is theirs to know, and neither changes what they can do.

revoke select on public.offers from authenticated;

grant select (
  id, load_id, driver_id, leg_id, status, created_at, expires_at
) on public.offers to authenticated;

comment on column public.offers.source is
  'How this offer was minted: ops (a dispatcher chose) or auto (0014 matched an '
  'empty leg). No client grant — see SENSITIVE_FIELDS.md.';

-- Tier 3 walks legs by (origin, dest) looking for the most recent run.
-- `legs_match_idx` (0001) leads on origin/dest but tails on depart_from with a
-- status column in between, which is the wrong shape for max(depart_to).
create index if not exists legs_history_idx
  on public.legs (origin_city, dest_city, status, depart_to desc);

-- ═══ THE SHARED DECISION ════════════════════════════════════════════════════

create or replace function private.candidates_for(
  p_load_id    uuid,
  p_max_tier   smallint default 3,
  p_grace_days integer  default 2,
  p_limit      integer  default 50
)
returns table (
  tier        smallint,
  driver_id   uuid,
  driver_name text,
  leg_id      uuid,
  leg_origin  bigint,
  leg_dest    bigint,
  depart_from date,
  depart_to   date,
  is_empty    boolean,
  truck_id    uuid,
  truck_type  text,
  capacity_kg integer,
  day_gap     integer,
  last_run_at date,
  offer_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with l as (
    select
      lo.id, lo.origin_city, lo.dest_city, lo.pickup_from, lo.pickup_to,
      lo.weight_kg, lo.truck_type_code
    from public.loads lo
    where lo.id = p_load_id
  ),

  -- ── tiers 1 and 2: a declared leg on this exact route ────────────────────
  -- Filters lifted wholesale from `match_load` (0003), which had them right.
  legged as (
    select
      (case when lg.is_empty then 1 else 2 end)::smallint as tier,
      lg.driver_id                as driver_id,
      p.full_name                 as driver_name,
      lg.id                       as leg_id,
      lg.origin_city              as leg_origin,
      lg.dest_city                as leg_dest,
      lg.depart_from              as depart_from,
      lg.depart_to                as depart_to,
      lg.is_empty                 as is_empty,
      tk.id                       as truck_id,
      tk.truck_type               as truck_type,
      tk.capacity_kg              as capacity_kg,
      greatest(
        0,
        greatest(l.pickup_from - lg.depart_to, lg.depart_from - l.pickup_to)
      )::integer                  as day_gap,
      null::date                  as last_run_at
    from public.legs lg
    cross join l
    join public.profiles p on p.id = lg.driver_id
    -- LATERAL, not a join on trucks.owner_id. The old join produced one candidate
    -- row per truck the driver owns, so a two-truck driver was offered the load
    -- twice and appeared twice in the dispatcher's list.
    --
    -- Honour the leg's own truck when it names one; otherwise take the SMALLEST
    -- truck that still fits, because sending a 40-tonne to a 2-tonne load is the
    -- expensive answer.
    join lateral (
      select t.id, t.truck_type, t.capacity_kg
      from public.trucks t
      where t.owner_id = lg.driver_id
        and (lg.truck_id is null or t.id = lg.truck_id)
        -- Truck type: honour it when the shipper chose one. A NULL choice is
        -- "Not sure — advise me" and must match EVERY truck, not none.
        and (l.truck_type_code is null or t.truck_type = l.truck_type_code)
        -- Capacity: same rule. Unknown weight must not filter anything out.
        -- `ops_candidates` had no capacity filter at all and would happily offer
        -- 12 t to a 3 t hi-up.
        and (l.weight_kg is null or coalesce(t.capacity_kg, 2147483647) >= l.weight_kg)
      order by t.capacity_kg asc nulls last
      limit 1
    ) tk on true
    where lg.status = 'open'
      and lg.origin_city = l.origin_city
      and lg.dest_city   = l.dest_city
      -- Windows overlap, or sit within the grace either side. Auto-dispatch
      -- passes 0: "strong match" means the driver's own declared window actually
      -- covers the pickup, and stretching it is a judgement for a human.
      and lg.depart_from <= l.pickup_to   + p_grace_days
      and lg.depart_to   >= l.pickup_from - p_grace_days
  ),

  -- ── tier 3: no declared leg, but knows the corridor ──────────────────────
  corr as (
    select
      private.corridor_of(l.origin_city) as o,
      private.corridor_of(l.dest_city)   as d
    from l
  ),

  -- `cities.corridor` is nullable text with no FK (0002 hand-seeds 8 bands).
  -- Both sides must be guarded: without it, every city missing a corridor
  -- matches every other city missing one, and tier 3 becomes "everyone".
  history as (
    select h.driver_id, max(h.ran_at) as last_run_at
    from (
      select lg.driver_id, max(lg.depart_to) as ran_at
      from public.legs lg
      cross join corr
      join public.cities co on co.id = lg.origin_city
      join public.cities cd on cd.id = lg.dest_city
      where lg.status in ('matched', 'closed')
        and corr.o is not null and corr.d is not null
        and co.corridor = corr.o
        and cd.corridor = corr.d
      group by lg.driver_id

      union all

      select tr.driver_id, max(tr.created_at::date) as ran_at
      from public.trips tr
      join public.loads pl on pl.id = tr.load_id
      cross join corr
      join public.cities co on co.id = pl.origin_city
      join public.cities cd on cd.id = pl.dest_city
      where corr.o is not null and corr.d is not null
        and co.corridor = corr.o
        and cd.corridor = corr.d
      group by tr.driver_id
    ) h
    group by h.driver_id
  ),

  corridor_tier as (
    select
      3::smallint     as tier,
      hi.driver_id    as driver_id,
      p.full_name     as driver_name,
      null::uuid      as leg_id,
      null::bigint    as leg_origin,
      null::bigint    as leg_dest,
      null::date      as depart_from,
      null::date      as depart_to,
      null::boolean   as is_empty,
      tk.id           as truck_id,
      tk.truck_type   as truck_type,
      tk.capacity_kg  as capacity_kg,
      null::integer   as day_gap,
      hi.last_run_at  as last_run_at
    from history hi
    cross join l
    join public.profiles p on p.id = hi.driver_id
    join lateral (
      select t.id, t.truck_type, t.capacity_kg
      from public.trucks t
      where t.owner_id = hi.driver_id
        and (l.truck_type_code is null or t.truck_type = l.truck_type_code)
        and (l.weight_kg is null or coalesce(t.capacity_kg, 2147483647) >= l.weight_kg)
      order by t.capacity_kg asc nulls last
      limit 1
    ) tk on true
    -- Never let a driver appear at two tiers. A dispatcher seeing the same name
    -- under "empty trucks going that way" and under "has run this corridor"
    -- cannot tell which one the offer would be about.
    where p_max_tier >= 3
      and not exists (select 1 from legged lg2 where lg2.driver_id = hi.driver_id)
    order by hi.last_run_at desc
    -- Capped independently of p_limit so a busy corridor cannot crowd out the
    -- empty legs, which are always the better answer.
    limit 20
  )

  select
    c.tier,
    c.driver_id,
    c.driver_name,
    c.leg_id,
    c.leg_origin,
    c.leg_dest,
    c.depart_from,
    c.depart_to,
    c.is_empty,
    c.truck_id,
    c.truck_type,
    c.capacity_kg,
    c.day_gap,
    c.last_run_at,
    (select o.status::text from public.offers o
      where o.load_id = p_load_id and o.driver_id = c.driver_id) as offer_status
  from (
    select * from legged
    union all
    select * from corridor_tier
  ) c
  where c.tier <= p_max_tier
  -- Empty legs first: filling deadhead is the whole point.
  order by c.tier asc,
           c.day_gap asc nulls last,
           c.last_run_at desc nulls last,
           c.depart_from asc nulls last
  limit p_limit;
$$;

comment on function private.candidates_for(uuid, smallint, integer, integer) is
  'Tiered matching: 1 empty leg, 2 part-loaded leg, 3 corridor history. Does NOT '
  'check ownership — callers must. Private and ungranted on purpose: this is the '
  'load board with the guard removed.';

revoke all on function private.candidates_for(uuid, smallint, integer, integer)
  from public, anon, authenticated;

-- ═══ THE DISPATCHER'S ENTRY POINT ═══════════════════════════════════════════
-- Return type changes, and `create or replace` cannot do that. Drop and recreate,
-- exactly as 0010 did for `ops_queue`. 0005 is not edited — migrations stay
-- append-only.
--
-- TWO BREAKING CHANGES for anything reading this:
--   * `leg_id` is now NULLABLE. Tier 3 candidates have no leg, and every leg
--     column is NULL for them. The client keyed its list rows on leg_id.
--   * `already_offered boolean` is replaced by `offer_status text`. The boolean
--     was computed over offers of ANY status, so a driver who declined last week
--     looked permanently unavailable with no way to see why — and the dispatcher
--     had no way to deliberately offer again.

drop function if exists public.ops_candidates(uuid);

create function public.ops_candidates(p_load_id uuid)
returns table (
  tier        smallint,
  driver_id   uuid,
  driver_name text,
  leg_id      uuid,
  leg_origin  bigint,
  leg_dest    bigint,
  depart_from date,
  depart_to   date,
  is_empty    boolean,
  truck_id    uuid,
  truck_type  text,
  capacity_kg integer,
  day_gap     integer,
  last_run_at date,
  offer_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select * from private.candidates_for(p_load_id, 3::smallint, 2, 50);
end;
$$;

revoke all on function public.ops_candidates(uuid) from public, anon;
grant execute on function public.ops_candidates(uuid) to authenticated;

-- ═══ MINTING AN OFFER ═══════════════════════════════════════════════════════
-- Still not client-callable. Three defects fixed while the signature is changing
-- anyway (a defaulted 4th argument on the old signature would have made the call
-- ambiguous, so this drops and recreates too).

drop function if exists public.create_offer(uuid, uuid, uuid);

create function public.create_offer(
  p_load_id      uuid,
  p_driver_id    uuid,
  p_leg_id       uuid    default null,
  p_source       text    default 'ops',
  p_allow_resend boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid;
  v_existing public.offers;
begin
  if not exists (select 1 from public.loads l
                 where l.id = p_load_id
                   and l.status in ('posted', 'finding_truck', 'matched')) then
    raise exception 'load not open for offers' using errcode = 'check_violation';
  end if;

  select * into v_existing
  from public.offers o
  where o.load_id = p_load_id and o.driver_id = p_driver_id;

  -- A driver who declined this load has answered. An automated path must not be
  -- able to ask again — that is how a "no" becomes a notification every time
  -- anything re-runs. A DISPATCHER may override, deliberately, one driver at a
  -- time: `ops_send_offer` passes true, `auto_dispatch` passes false.
  if v_existing.id is not null
     and v_existing.status = 'declined'
     and not p_allow_resend then
    return v_existing.id;
  end if;

  insert into public.offers (load_id, driver_id, leg_id, source)
  values (p_load_id, p_driver_id, p_leg_id, p_source)
  on conflict (load_id, driver_id) do update
    set status     = 'pending',
        -- The old version did not update leg_id, so re-offering with a corrected
        -- leg silently kept the stale one and the record of WHY that truck was
        -- chosen was wrong.
        leg_id     = excluded.leg_id,
        source     = excluded.source,
        expires_at = now() + interval '48 hours'
  returning id into v_id;

  update public.loads set status = 'matched'
  where id = p_load_id and status in ('posted', 'finding_truck');

  return v_id;
end;
$$;

-- Deliberately NOT granted to authenticated. Ops/server only.
revoke all on function public.create_offer(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;

-- ═══ ops_send_offer, NOW PASSING PROVENANCE ═════════════════════════════════
-- Same guards, same grants. Passes 'ops' and allows a deliberate re-send.
-- Its existing leg-ownership check already tolerates a NULL leg, so tier 3
-- candidates work through it unchanged.

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

  v_id := public.create_offer(p_load_id, p_driver_id, p_leg_id, 'ops', true);
  return v_id;
end;
$$;

revoke all on function public.ops_send_offer(uuid, uuid, uuid) from public, anon;
grant execute on function public.ops_send_offer(uuid, uuid, uuid) to authenticated;

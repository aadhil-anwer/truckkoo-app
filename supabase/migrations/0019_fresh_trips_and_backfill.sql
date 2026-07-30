-- ─────────────────────────────────────────────────────────────────────────────
-- 0019 — fresh trips, and matching that works in both directions
--
-- 0014 dispatches ONCE, FORWARD, and only to an EMPTY LEG. Three consequences,
-- all of them observed on a real walkthrough of the app on 2026-07-29:
--
-- GAP 1 — THE LOAD THAT ARRIVES FIRST IS NEVER RE-MATCHED
--
-- `post_load` runs `auto_dispatch` at post time and never again. A shipper posts
-- Muscat → Barka at 09:00 with no driver declared on that corridor; the load
-- lands in `finding_truck` and waits. At 11:00 a driver declares exactly that
-- leg, empty, same day. Nothing happens. The match exists and no code ever looks
-- for it, because `post_leg` (0004, re-issued 0017) inserts a row and returns.
--
-- The matcher only ever asked "which driver fits this load?", never "which load
-- fits this driver?".
--
-- GAP 2 — NO EMPTY LEG MEANS NO OFFER AT ALL
--
-- `candidates_for` is built entirely on `public.legs`. A driver who has declared
-- nothing is invisible to it, so a corridor with no declared legs produces
-- `no_candidates` and the load falls to the dispatcher every time.
--
-- Truckkoo runs its own fleet and arranges FRESH TRIPS — that is the promise the
-- shipper is already shown: "we are looking for a truck already heading that way.
-- If nothing fits, we arrange a fresh trip." Until this migration the second half
-- of that sentence had no implementation behind it.
--
-- GAP 3 — `dispatch_log` CANNOT SAY WHICH KIND OF MATCH IT MADE
--
-- One `offers_sent` integer, no provenance. With two dispatch modes and a
-- backfill path, "3 offers went out" stops being a useful sentence.
--
-- ── WHAT THIS DOES NOT CHANGE ───────────────────────────────────────────────
--
-- No table policy is loosened. No new client grant. `create_offer` stays revoked
-- from every client role and both new functions are `private` and ungranted, for
-- the same reason `candidates_for` is: a driver-facing "which loads fit me?" is
-- the load board with the guard removed. Its callers do the checking.
--
-- Drivers still do not browse. They receive offers addressed to them.
--
-- ── THE EXPOSURE DECISION, RECORDED ─────────────────────────────────────────
--
-- Fresh-trip fan-out reaches drivers BY TRUCK TYPE, not by declared route. This
-- was decided deliberately by the operator on 2026-07-29, over the narrower
-- alternative of "drivers whose declared corridor fits".
--
-- It is a real widening: a driver who has declared nothing about this corridor
-- now sees the load's cities, dates, goods description and weight. That is the
-- cost of reaching idle drivers who never declare legs, which is most of them
-- early on.
--
-- It is bounded, and the bounds are the point:
--   · `auto_dispatch_max_offers` caps how many drivers ever see one load;
--   · the fresh path runs ONLY when the leg path sent nothing, so a load that
--     matched a declared leg is never fanned out wider;
--   · a driver already at `auto_dispatch_max_pending_per_driver` is skipped;
--   · every fan-out is logged with its mode.
--
-- To narrow it later, add a corridor predicate to `drivers_for_fresh`. Nothing
-- else has to change.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ THE LOG LEARNS TO SAY HOW ══════════════════════════════════════════════

alter table private.dispatch_log
  add column if not exists mode text;

comment on column private.dispatch_log.mode is
  'leg = matched a declared empty leg (0014 behaviour). fresh = fanned out by '
  'truck type because no leg matched. backfill = a driver declared a leg that '
  'fitted a load already waiting in finding_truck.';

alter table private.dispatch_log
  drop constraint if exists dispatch_log_skip_known;

-- 'no_drivers' is distinct from 'no_candidates' on purpose: the first means no
-- leg matched AND no truck in the fleet fits, which is an operational fact worth
-- alerting on. The second now means only "no leg matched", which is routine.
alter table private.dispatch_log
  add constraint dispatch_log_skip_known check (
    skipped is null or skipped in
      ('disabled', 'no_price', 'no_candidates', 'no_drivers', 'error')
  );

alter table private.dispatch_log
  drop constraint if exists dispatch_log_mode_known;

alter table private.dispatch_log
  add constraint dispatch_log_mode_known check (
    mode is null or mode in ('leg', 'fresh', 'backfill')
  );

-- ═══ WHICH DRIVERS COULD RUN THIS LOAD FRESH ════════════════════════════════
--
-- The fresh-trip counterpart to `candidates_for`. No leg is involved, so there is
-- no window to overlap and no tier to score — the only questions are whether the
-- truck fits and whether the driver is in a state to be asked.
--
-- PRIVATE AND UNGRANTED. This function answers "who can carry this?" without
-- checking who is asking. Its only caller is `auto_dispatch`, which runs as owner
-- from inside `post_load`.

create or replace function private.drivers_for_fresh(
  p_load_id uuid,
  p_limit   integer default 12
)
returns table (
  driver_id   uuid,
  truck_id    uuid,
  capacity_kg integer,
  pending     bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with l as (
    select lo.id, lo.weight_kg, lo.truck_type_code
    from public.loads lo
    where lo.id = p_load_id
  )
  select
    p.id            as driver_id,
    tk.id           as truck_id,
    tk.capacity_kg  as capacity_kg,
    coalesce(pc.n, 0) as pending
  from public.profiles p
  cross join l
  -- Same lateral shape as `candidates_for`: ONE row per driver, never one per
  -- truck. A two-truck driver appearing twice was a real defect in 0011's
  -- `ops_candidates` and it is not being reintroduced here.
  --
  -- Smallest truck that still fits, for the same reason: sending a 40-tonne
  -- trailer to a 3-tonne load is the expensive answer.
  join lateral (
    select t.id, t.truck_type, t.capacity_kg
    from public.trucks t
    where t.owner_id = p.id
      -- NULL truck_type_code is "Not sure — advise me" and matches EVERY truck,
      -- not none. This is the invariant in CLAUDE.md §1 expressed in a join.
      and (l.truck_type_code is null or t.truck_type = l.truck_type_code)
      and (l.weight_kg is null or coalesce(t.capacity_kg, 2147483647) >= l.weight_kg)
    order by t.capacity_kg asc nulls last
    limit 1
  ) tk on true
  left join lateral (
    select count(*) as n
    from public.offers o
    where o.driver_id = p.id
      and o.status = 'pending'
      and o.expires_at > now()
  ) pc on true
  where p.role = 'driver'
    -- A suspended driver cannot accept (0017), so offering to them burns one of
    -- the load's capped slots on a guaranteed dead end.
    and p.suspended_at is null
    -- Never talk over an existing offer in ANY state, including a decline.
    -- `offers` is unique on (load_id, driver_id) and would raise anyway; this
    -- turns a constraint violation into a filter.
    and not exists (
      select 1 from public.offers o
      where o.load_id = p_load_id and o.driver_id = p.id
    )
  -- Least-loaded driver first, then smallest fitting truck. Spreading work
  -- across idle drivers beats stacking it on whoever sorts first by id.
  order by coalesce(pc.n, 0) asc, tk.capacity_kg asc nulls last, p.id
  limit p_limit;
$$;

revoke all on function private.drivers_for_fresh(uuid, integer)
  from public, anon, authenticated;

comment on function private.drivers_for_fresh(uuid, integer) is
  'Drivers whose truck fits a load, for fresh-trip dispatch when no declared leg '
  'matched. Does NOT check who is asking — private and ungranted for the same '
  'reason as candidates_for. Callers do the checking.';

-- ═══ WHICH WAITING LOADS FIT THIS LEG ═══════════════════════════════════════
--
-- The inverse question, asked once, for one driver, about one leg they have just
-- declared. Scoped to `finding_truck` by decision: a load that is still 'posted'
-- is inside its own dispatch window, and a 'matched' load already has a driver
-- deciding. Backfilling either would put two live offers on one load for no gain.

create or replace function private.loads_for_leg(
  p_leg_id uuid,
  p_limit  integer default 5
)
returns table (
  load_id  uuid,
  truck_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with lg as (
    select g.id, g.driver_id, g.truck_id, g.origin_city, g.dest_city,
           g.depart_from, g.depart_to, g.is_empty, g.status
    from public.legs g
    where g.id = p_leg_id
  )
  select l.id as load_id, tk.id as truck_id
  from public.loads l
  cross join lg
  join lateral (
    select t.id, t.truck_type, t.capacity_kg
    from public.trucks t
    where t.owner_id = lg.driver_id
      and (lg.truck_id is null or t.id = lg.truck_id)
      and (l.truck_type_code is null or t.truck_type = l.truck_type_code)
      and (l.weight_kg is null or coalesce(t.capacity_kg, 2147483647) >= l.weight_kg)
    order by t.capacity_kg asc nulls last
    limit 1
  ) tk on true
  where lg.status = 'open'
    -- Only loads that already failed to find a truck. See the note above.
    and l.status = 'finding_truck'
    and l.origin_city = lg.origin_city
    and l.dest_city   = lg.dest_city
    -- Windows overlap at grace 0 — the same predicate `candidates_for` uses for
    -- tier 1, with the same reasoning: a "strong match" means the driver's own
    -- declared window actually covers the pickup window, and stretching it
    -- either side is a judgement for a human, not for a backfill that fires
    -- unattended the moment a leg is declared.
    and lg.depart_from <= l.pickup_to
    and lg.depart_to   >= l.pickup_from
    and not exists (
      select 1 from public.offers o
      where o.load_id = l.id and o.driver_id = lg.driver_id
    )
  -- Oldest waiting load first. A load that has been in finding_truck longest is
  -- the one closest to costing a customer.
  order by l.created_at asc
  limit p_limit;
$$;

revoke all on function private.loads_for_leg(uuid, integer)
  from public, anon, authenticated;

comment on function private.loads_for_leg(uuid, integer) is
  'Loads waiting in finding_truck that fit a leg a driver has just declared. '
  'Private and ungranted: this is the load board with the guard removed. Its '
  'only caller is post_leg, which knows the leg belongs to the actor.';

-- ═══ auto_dispatch, NOW WITH A FRESH-TRIP TAIL ══════════════════════════════
--
-- Body identical to 0014 through the tier-1 loop. The change is what happens
-- when that loop sends nothing.

create or replace function private.auto_dispatch(p_load_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap         integer;
  v_per_driver  integer;
  v_candidates  integer := 0;
  v_sent        integer := 0;
  v_pending     integer;
  v_mode        text := 'leg';
  c             record;
  d             record;
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

  v_cap        := private.setting_int('auto_dispatch_max_offers', 3);
  v_per_driver := private.setting_int('auto_dispatch_max_pending_per_driver', 3);

  -- ── tier 1: a declared empty leg, grace 0 ─────────────────────────────────
  for c in
    select * from private.candidates_for(p_load_id, 1::smallint, 0, v_cap * 4)
  loop
    v_candidates := v_candidates + 1;
    exit when v_sent >= v_cap;
    continue when c.offer_status is not null;

    select count(*) into v_pending
    from public.offers o
    where o.driver_id = c.driver_id
      and o.status = 'pending'
      and o.expires_at > now();

    continue when v_pending >= v_per_driver;

    perform public.create_offer(p_load_id, c.driver_id, c.leg_id, 'auto', false);
    v_sent := v_sent + 1;
  end loop;

  -- ── the fresh-trip tail ───────────────────────────────────────────────────
  --
  -- Runs ONLY when the leg path placed nothing. A load that matched a real empty
  -- leg is never widened to the fleet — the narrow match is always preferred,
  -- and this ordering is what keeps the exposure decision bounded.
  if v_sent = 0 then
    v_mode := 'fresh';

    for d in
      select * from private.drivers_for_fresh(p_load_id, v_cap * 4)
    loop
      v_candidates := v_candidates + 1;
      exit when v_sent >= v_cap;

      continue when d.pending >= v_per_driver;

      -- NULL leg: there is no declared leg behind a fresh trip. `offers.leg_id`
      -- has been nullable since 0001 and `create_offer`'s leg-ownership check
      -- already tolerates it (0012), so this needs no new tolerance anywhere.
      perform public.create_offer(p_load_id, d.driver_id, null, 'auto', false);
      v_sent := v_sent + 1;
    end loop;
  end if;

  insert into private.dispatch_log (load_id, candidates, offers_sent, mode, skipped)
  values (p_load_id, v_candidates, v_sent, v_mode,
          case
            when v_candidates = 0 and v_mode = 'fresh' then 'no_drivers'
            when v_sent = 0                            then 'no_candidates'
            else null
          end);

  return v_sent;
end;
$$;

revoke all on function private.auto_dispatch(uuid) from public, anon, authenticated;

-- ═══ THE BACKFILL ═══════════════════════════════════════════════════════════
--
-- Called by `post_leg` after the leg row exists. Takes a leg id and does NOT
-- verify ownership — `post_leg` has just inserted the row with `driver_id =
-- auth.uid()`, which is the strongest ownership proof available. Private and
-- ungranted so that remains the only way in.

create or replace function private.backfill_for_leg(p_leg_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap        integer;
  v_per_driver integer;
  v_driver     uuid;
  v_pending    integer;
  v_sent       integer := 0;
  r            record;
begin
  if not private.setting_bool('auto_dispatch_enabled', true) then
    return 0;
  end if;

  select g.driver_id into v_driver from public.legs g where g.id = p_leg_id;
  if v_driver is null then
    return 0;
  end if;

  -- One driver is being offered several waiting loads at once, so the per-driver
  -- ceiling is the binding cap here, not the per-load one.
  v_per_driver := private.setting_int('auto_dispatch_max_pending_per_driver', 3);
  v_cap        := private.setting_int('auto_dispatch_max_offers', 3);

  select count(*) into v_pending
  from public.offers o
  where o.driver_id = v_driver
    and o.status = 'pending'
    and o.expires_at > now();

  for r in select * from private.loads_for_leg(p_leg_id, v_cap) loop
    exit when v_pending + v_sent >= v_per_driver;

    perform public.create_offer(r.load_id, v_driver, p_leg_id, 'auto', false);
    v_sent := v_sent + 1;

    insert into private.dispatch_log (load_id, candidates, offers_sent, mode)
    values (r.load_id, 1, 1, 'backfill');
  end loop;

  return v_sent;
end;
$$;

revoke all on function private.backfill_for_leg(uuid) from public, anon, authenticated;

-- ═══ post_leg, NOW LOOKING BACKWARDS ════════════════════════════════════════
--
-- Body identical to 0017 through the insert. The tail is wrapped for the same
-- reason `post_load`'s is, and it is the same deliberate exception to "fail
-- closed and loud" (SECURITY.md §0.5):
--
-- A DRIVER'S LEG MUST EXIST EVEN WHEN MATCHING IS BROKEN. Losing the leg loses
-- the supply signal and the driver's trust in declaring anything at all; losing
-- the backfill drops that work back to the dispatcher, who is the human backstop
-- every load went through until 0014.

create or replace function public.post_leg(
  p_origin_city bigint,
  p_dest_city   bigint,
  p_depart_from date,
  p_depart_to   date,
  p_truck_id    uuid default null,
  p_is_empty    boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if (select private.actor_role()) <> 'driver' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  perform private.require_active();
  perform private.check_rate_limit('post_leg', 40, interval '1 hour');

  if p_truck_id is not null
     and not exists (select 1 from public.trucks t where t.id = p_truck_id and t.owner_id = v_actor) then
    raise exception 'truck not found' using errcode = 'no_data_found';
  end if;

  insert into public.legs (driver_id, truck_id, origin_city, dest_city, depart_from, depart_to, is_empty)
  values (v_actor, p_truck_id, p_origin_city, p_dest_city, p_depart_from, p_depart_to, p_is_empty)
  returning id into v_id;

  -- ── the backfill tail, which must never take the leg down with it ─────────
  begin
    perform private.backfill_for_leg(v_id);
  exception when others then
    -- SQLSTATE only, never SQLERRM: an error message can carry a goods
    -- description out of a check constraint and into a table dispatch reads
    -- (SECURITY.md §10). There is no load id to attribute this to, so the log
    -- row is deliberately not written here — `backfill_for_leg` logs per load,
    -- and a failure before any load was reached has nothing to name.
    raise warning 'backfill_for_leg failed: %', sqlstate;
  end;

  return v_id;
end;
$$;

revoke all on function public.post_leg(bigint, bigint, date, date, uuid, boolean)
  from public, anon;
grant execute on function public.post_leg(bigint, bigint, date, date, uuid, boolean)
  to authenticated;

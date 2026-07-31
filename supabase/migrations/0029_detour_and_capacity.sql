-- 0029 — what a detour actually costs, and the room left on a truck.
--
-- Two numbers a driver needs before they can judge an offer, and neither exists
-- yet. Both are computed in SQL beside the price they sit next to: a detour
-- quoted by the client and a payout quoted by the server would disagree the
-- first time either changed.

-- ═══ 1. the detour ══════════════════════════════════════════════════════════
-- The true extra distance driven:
--   (leg origin → pickup → dropoff → leg dest) − (leg origin → leg dest)
-- Not the pickup's distance from the corridor. A driver turns off, carries the
-- load, and comes back — the cost is the whole loop, and quoting half of it
-- beside a payout would flatter every offer.

create or replace function private.detour_km(p_leg_id uuid, p_load_id uuid)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v_leg  public.legs;
  v_load public.loads;
  v_with numeric;
  v_direct numeric;
begin
  select * into v_leg  from public.legs  l where l.id = p_leg_id;
  select * into v_load from public.loads d where d.id = p_load_id;
  if v_leg.id is null or v_load.id is null then
    return null;
  end if;

  v_with :=   private.route_km(v_leg.origin_city,  v_load.origin_city)
            + private.route_km(v_load.origin_city, v_load.dest_city)
            + private.route_km(v_load.dest_city,   v_leg.dest_city);
  v_direct := private.route_km(v_leg.origin_city,  v_leg.dest_city);

  if v_with is null or v_direct is null then
    return null;
  end if;

  -- Never negative. A load that shortens the trip is a rounding artefact of
  -- great-circle arithmetic, not a driver being paid to go home early.
  return greatest(0, round(v_with - v_direct, 1));
end;
$$;

revoke all on function private.detour_km(uuid, uuid) from public, anon, authenticated;

-- ═══ 2. the room left on a part-loaded truck ════════════════════════════════
-- NULL is "empty, or did not say" — the same shape as loads.truck_type_code and
-- for the same reason: a low-tech user must be allowed not to answer.

alter table public.legs add column if not exists free_kg integer;

alter table public.legs add constraint legs_free_kg_sane
  check (free_kg is null or (free_kg > 0 and free_kg <= 60000));

comment on column public.legs.free_kg is
  'Roughly how much space is left on a part-loaded truck. NULL = empty or unstated.';

-- legs already carries column-level insert grants; free_kg joins them because a
-- driver states it about their own leg. It is not sensitive: it is supply
-- information the driver volunteers, and it never leaves driver-owned rows.
grant insert (free_kg), update (free_kg) on public.legs to authenticated;

-- ═══ 3. post_leg carries it ═════════════════════════════════════════════════
-- The grant above is the direct path; this is the one the app actually uses, and
-- a column a driver can only set by writing the table by hand is a column that
-- stays NULL forever.
--
-- Reproduced from the live 0019 definition, unchanged but for the new argument.
-- THE OLD SIGNATURE IS DROPPED, not left beside this one: a defaulted seventh
-- argument makes every existing six-argument call match both candidates and
-- Postgres refuses it as ambiguous, which takes leg posting down entirely. 0024
-- documents this exact failure.

drop function if exists public.post_leg(bigint, bigint, date, date, uuid, boolean);

create or replace function public.post_leg(
  p_origin_city bigint,
  p_dest_city   bigint,
  p_depart_from date,
  p_depart_to   date,
  p_truck_id    uuid default null,
  p_is_empty    boolean default true,
  p_free_kg     integer default null
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

  insert into public.legs (driver_id, truck_id, origin_city, dest_city, depart_from, depart_to,
                           is_empty, free_kg)
  values (v_actor, p_truck_id, p_origin_city, p_dest_city, p_depart_from, p_depart_to,
          p_is_empty,
          -- An empty truck has no "space left" to state: all of it is free, and
          -- a number here would be a second, contradictory answer to is_empty.
          case when p_is_empty then null else p_free_kg end)
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

revoke all on function public.post_leg(bigint, bigint, date, date, uuid, boolean, integer)
  from public, anon;
grant execute on function public.post_leg(bigint, bigint, date, date, uuid, boolean, integer)
  to authenticated;

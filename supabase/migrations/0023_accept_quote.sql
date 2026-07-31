-- 0023_accept_quote.sql
--
-- THE REORDER. Until now a load was dispatched to drivers the moment it was
-- posted, and the shipper approved nothing — they found out the price over
-- WhatsApp. The redesign puts the decision in front of the dispatch:
--
--   posted ─► quoted ─► accepted ─► matched ─► assigned ─► in_transit ─► delivered
--                │                     ▲
--                └── no price? ────────┴── finding_truck, a human prices it
--
-- WHAT MOVED. `post_load` no longer calls `private.auto_dispatch`. Offers now go
-- out from `accept_quote`, so no driver is asked to carry a load at a price the
-- shipper has not agreed to.
--
-- IN-FLIGHT LOADS. Rows already `posted`, `finding_truck` or `matched` when this
-- lands are untouched and keep working: `create_offer` still accepts them, ops can
-- still price them, and `respond_to_offer` still assigns them. Nothing is
-- stranded. Only NEW loads take the new path.
--
-- THE OPS CONSOLE (~/truckkoo-ops) is a separate deployment and cannot be updated
-- in this commit. Everything here is additive — no status is renamed or removed,
-- no existing signature changes — so an un-updated console keeps working. It
-- simply cannot yet act on `quoted` or `accepted`. See OPEN_ISSUES.md.

-- ═══ 1. a price makes a load decidable ══════════════════════════════════════

create or replace function private.mark_quoted(p_load_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only from the states where nobody has committed to anything yet. A load
  -- already matched to drivers, or already accepted, must not be dragged back
  -- into "here is a price, decide".
  update public.loads
     set status = 'quoted'::public.load_status
   where id = p_load_id
     and price_baisa is not null
     and status in ('posted'::public.load_status, 'finding_truck'::public.load_status);
end;
$$;

revoke all on function private.mark_quoted(uuid) from public, anon, authenticated;

-- ═══ 2. post_load: quote, but do NOT dispatch ═══════════════════════════════

create or replace function public.post_load(
  p_origin_city     bigint,
  p_dest_city       bigint,
  p_pickup_from     date,
  p_pickup_to       date,
  p_goods           text,
  p_weight_kg       integer default null,
  p_truck_type_code text    default null   -- NULL = "Not sure, advise me"
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

  if (select private.actor_role()) <> 'shipper' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  perform private.require_active();
  perform private.check_rate_limit('post_load', 20, interval '1 hour');

  if p_goods is null or char_length(btrim(p_goods)) = 0 then
    raise exception 'goods description required' using errcode = 'check_violation';
  end if;

  if p_truck_type_code is not null
     and not exists (select 1 from public.truck_types t where t.code = p_truck_type_code) then
    raise exception 'unknown truck type' using errcode = 'foreign_key_violation';
  end if;

  insert into public.loads (
    shipper_id, origin_city, dest_city, pickup_from, pickup_to,
    weight_kg, truck_type_code, goods_description, status
  )
  values (
    v_actor, p_origin_city, p_dest_city, p_pickup_from, p_pickup_to,
    p_weight_kg, p_truck_type_code, btrim(p_goods), 'posted'::public.load_status
  )
  returning id into v_id;

  -- Still wrapped, and still failing OPEN into the human path: a broken pricer
  -- must never lose a shipper's load.
  begin
    perform private.issue_quote(v_id);
    perform private.mark_quoted(v_id);
  exception when others then
    insert into private.dispatch_log (load_id, skipped, detail)
    values (v_id, 'error', 'quote: ' || sqlstate);
  end;

  -- NO auto_dispatch here any more. It moved to accept_quote — see the header.
  -- If the load could not be priced, `issue_quote` has already put it in
  -- `finding_truck` and a dispatcher picks it up.

  return v_id;
end;
$$;

revoke all on function public.post_load(bigint, bigint, date, date, text, integer, text)
  from public, anon;
grant execute on function public.post_load(bigint, bigint, date, date, text, integer, text)
  to authenticated;

-- ═══ 3. accept_quote — the shipper's decision ═══════════════════════════════

create or replace function public.accept_quote(p_load_id uuid)
returns public.load_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_status public.load_status;
  v_price  bigint;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Ownership is re-checked INSIDE the definer function against auth.uid(),
  -- like match_load. Without this it is an IDOR: any signed-in user could accept
  -- a price on somebody else's load. `for update` because two taps can arrive
  -- together on flaky signal.
  select l.status, l.price_baisa into v_status, v_price
  from public.loads l
  where l.id = p_load_id and l.shipper_id = v_actor
  for update;

  -- "Not found", never "forbidden": a 403 would confirm the load exists.
  if v_status is null then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;

  -- IDEMPOTENT. This is reached from a screen with a live countdown and a
  -- committing button; a double tap, a retry after a timeout and a stale screen
  -- must all be safe. Already past acceptance is a success, not an error.
  if v_status in (
    'accepted'::public.load_status, 'matched'::public.load_status,
    'assigned'::public.load_status, 'in_transit'::public.load_status,
    'delivered'::public.load_status, 'closed'::public.load_status
  ) then
    return v_status;
  end if;

  if v_status <> 'quoted'::public.load_status or v_price is null then
    raise exception 'no price to accept' using errcode = 'check_violation';
  end if;

  update public.loads
     set status = 'accepted'::public.load_status
   where id = p_load_id;

  -- NOW the offers go out. Same caps, same log, same fail-open-into-the-human-
  -- path behaviour as before — only the trigger point moved.
  begin
    perform private.auto_dispatch(p_load_id);
  exception when others then
    insert into private.dispatch_log (load_id, skipped, detail)
    values (p_load_id, 'error', 'dispatch: ' || sqlstate);
  end;

  return 'accepted'::public.load_status;
end;
$$;

comment on function public.accept_quote(uuid) is
  'Shipper accepts the quoted price, which is what releases the load to drivers. '
  'Idempotent, and re-checks ownership internally.';

revoke all on function public.accept_quote(uuid) from public, anon;
grant execute on function public.accept_quote(uuid) to authenticated;

-- ═══ 4. an accepted price is immutable ══════════════════════════════════════
-- Filed as unbuilt in OPEN_ISSUES at P0: "ops_set_price can currently move a
-- price on a load in any state". A price the shipper has agreed to is a
-- commitment; rewriting it silently is the difference between a quote and a note.
--
-- THIS PATCHES THE EXISTING TWO-ARGUMENT FUNCTION, reproduced from its live
-- definition. The first attempt at this migration added a THREE-argument
-- overload instead and left the real one untouched — so the guard existed, sat
-- beside an unguarded function of the same name, and the ops console went on
-- calling the unguarded one. A guard you can route around is not a guard.

CREATE OR REPLACE FUNCTION public.ops_set_price(p_load_id uuid, p_price_baisa bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_load public.loads;
begin
  perform private.require_ops();

  -- Bounds, in integer baisa. 1,000,000,000 baisa is 1,000,000 OMR — far beyond
  -- any real freight movement, and the point is to catch a slipped decimal
  -- rather than to model a ceiling.
  if p_price_baisa is null or p_price_baisa <= 0 or p_price_baisa > 1000000000 then
    raise exception 'price out of range' using errcode = 'check_violation';
  end if;

  select * into v_load from public.loads l where l.id = p_load_id for update;
  if v_load.id is null or v_load.status not in
     ('posted', 'finding_truck', 'quoted', 'matched') then
    raise exception 'load not open' using errcode = 'no_data_found';
  end if;

  insert into public.quotes (
    shipper_id, load_id, origin_city, dest_city, truck_type_code, weight_kg,
    pickup_from, pickup_to, price_baisa, currency, outcome, rate_card_id
  )
  values (
    v_load.shipper_id, v_load.id, v_load.origin_city, v_load.dest_city,
    v_load.truck_type_code, v_load.weight_kg, v_load.pickup_from, v_load.pickup_to,
    p_price_baisa, v_load.currency, 'quoted', null
  );

  update public.loads set price_baisa = p_price_baisa where id = p_load_id;

  -- A newly priced load becomes decidable by the shipper.
  perform private.mark_quoted(p_load_id);

  perform private.log_ops(
    'ops_set_price', 'load', p_load_id::text,
    jsonb_build_object('price_baisa', v_load.price_baisa),
    jsonb_build_object('price_baisa', p_price_baisa),
    null
  );
end;
$function$;

-- `accepted` and everything after it are now closed to re-pricing, and
-- `quoted` is open because a price nobody has agreed to yet may still move.

-- ═══ 5. ratings ═════════════════════════════════════════════════════════════
-- T5 asks "How did Salim do?" and T3 shows a rating beside the driver's name.
-- Both are REAL or ABSENT: with no history the driver card shows a name and a
-- vehicle and no rating at all — not 0.0, not "New driver" (CLAUDE.md #5).

create table public.ratings (
  trip_id    uuid primary key references public.trips on delete cascade,
  -- Denormalised so a rating survives being read without joining trips, and so
  -- the RLS policy is a column comparison rather than a subquery.
  shipper_id uuid not null references public.profiles on delete cascade,
  driver_id  uuid not null references public.profiles on delete cascade,
  stars      smallint not null,
  created_at timestamptz not null default now(),

  constraint ratings_stars_range check (stars between 1 and 5)
);

create index ratings_by_driver on public.ratings (driver_id);

alter table public.ratings enable row level security;
alter table public.ratings force row level security;
revoke all on table public.ratings from anon, authenticated;

-- No client grant at all: ratings are written through `rate_trip` and read
-- through `driver_summary`, both definer functions. A direct grant would let a
-- shipper read every driver's individual scores, which is supply intelligence
-- of the same kind as a leg.

-- One rating per trip, by the shipper who owned it, once the trip is delivered.
create or replace function public.rate_trip(p_trip_id uuid, p_stars smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_trip  record;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception 'stars must be 1..5' using errcode = 'check_violation';
  end if;

  -- Scoped to the actor, not fetched-then-checked, and "not found" rather than
  -- "forbidden" so the reply cannot confirm somebody else's trip exists.
  select t.id, t.driver_id, t.status, l.shipper_id
    into v_trip
  from public.trips t
  join public.loads l on l.id = t.load_id
  where t.id = p_trip_id and l.shipper_id = v_actor;

  if v_trip.id is null then
    raise exception 'trip not found' using errcode = 'no_data_found';
  end if;

  if v_trip.status not in ('delivered'::public.trip_status, 'closed'::public.trip_status) then
    raise exception 'rate a trip once it is delivered' using errcode = 'check_violation';
  end if;

  -- Insert-once. A rating that can be revised after the fact is a note, not a
  -- rating — the same reasoning as quotes and trip_events.
  insert into public.ratings (trip_id, shipper_id, driver_id, stars)
  values (p_trip_id, v_actor, v_trip.driver_id, p_stars)
  on conflict (trip_id) do nothing;
end;
$$;

revoke all on function public.rate_trip(uuid, smallint) from public, anon;
grant execute on function public.rate_trip(uuid, smallint) to authenticated;

-- ═══ 6. what a shipper may know about their driver ══════════════════════════

create or replace function public.driver_summary(p_driver_id uuid)
returns table (
  trips      bigint,
  avg_stars  numeric,
  ratings    bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Only about a driver you are actually dealing with. Without this it is a
  -- directory of every driver's performance, readable by anyone who signs up.
  if not exists (
    select 1
    from public.trips t
    join public.loads l on l.id = t.load_id
    where t.driver_id = p_driver_id
      and (l.shipper_id = v_actor or t.driver_id = v_actor)
  ) then
    raise exception 'driver not found' using errcode = 'no_data_found';
  end if;

  return query
  select
    (select count(*) from public.trips t
      where t.driver_id = p_driver_id
        and t.status in ('delivered'::public.trip_status, 'closed'::public.trip_status)),
    -- NULL, not 0, when nobody has rated them. The screen shows nothing rather
    -- than inventing a score.
    (select round(avg(r.stars)::numeric, 1) from public.ratings r where r.driver_id = p_driver_id),
    (select count(*) from public.ratings r where r.driver_id = p_driver_id);
end;
$$;

revoke all on function public.driver_summary(uuid) from public, anon;
grant execute on function public.driver_summary(uuid) to authenticated;

-- ═══ 7. create_offer must recognise `accepted` ══════════════════════════════
-- Reproduced from the live definition with two lines changed, rather than
-- rewritten: this function is the ONLY bridge from a load to a driver and it
-- carries a leg-ownership check that must not be lost.
--
-- Without this, `accept_quote` dispatches into a function that refuses the load
-- it was just handed — and because auto-dispatch fails open, the refusal is
-- swallowed into dispatch_log and the shipper waits forever for offers that were
-- never made. Silent, and exactly the class of bug this codebase has been bitten
-- by before.

CREATE OR REPLACE FUNCTION public.create_offer(p_load_id uuid, p_driver_id uuid, p_leg_id uuid DEFAULT NULL::uuid, p_source text DEFAULT 'ops'::text, p_allow_resend boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id       uuid;
  v_existing public.offers;
begin
  if not exists (select 1 from public.loads l
                 where l.id = p_load_id
                   and l.status in ('posted', 'finding_truck', 'accepted', 'matched')) then
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
  where id = p_load_id and status in ('posted', 'finding_truck', 'accepted');

  return v_id;
end;
$function$;

-- ═══ 8. the dispatcher must still see a load after it is priced ═════════════
-- Once `ops_set_price` moves a load to `quoted`, it dropped straight out of the
-- queue — a dispatcher would price a load and watch it vanish, with no way to
-- see the ones waiting on a shipper's decision or the ones accepted and not yet
-- matched. Additive only: two statuses added to the filter, nothing removed.

CREATE OR REPLACE FUNCTION public.ops_queue()
 RETURNS TABLE(load_id uuid, origin_city bigint, dest_city bigint, pickup_from date, pickup_to date, goods text, weight_kg integer, truck_type_code text, status text, posted_at timestamp with time zone, offer_count bigint, price_baisa bigint, currency character, auto_offer_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      where o.load_id = l.id and o.status = 'pending'),
    l.price_baisa,
    l.currency,
    (select count(*) from public.offers o
      where o.load_id = l.id and o.status = 'pending' and o.source = 'auto')
  from public.loads l
  where l.status in ('posted', 'finding_truck', 'quoted', 'accepted', 'matched')
  order by l.created_at asc;
end;
$function$;

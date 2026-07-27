-- ─────────────────────────────────────────────────────────────────────────────
-- 0017 — account administration
--
-- WHY THIS EXISTS
--
-- `drivers.verified_at` is the public trust claim. The website says "100%
-- verified drivers", and nothing in the product has ever been able to set that
-- column except a hand-written UPDATE. Same for `trucks.verified_at`. And there
-- has been no way at all to stop a bad actor: an account, once created, could
-- post loads or declare legs forever.
--
-- WHAT SUSPENSION IS AND IS NOT
--
-- Suspension blocks *new commitments*: posting a load, declaring a leg,
-- accepting an offer. It deliberately does **not** block `advance_trip`.
--
-- That asymmetry is the whole design. A driver suspended halfway to Salalah is
-- still carrying somebody's cargo, and a suspension that locks them out of
-- marking the delivery strands the load, denies the shipper their proof of
-- delivery, and turns an account problem into a freight problem. They finish the
-- job they are on; they simply cannot take another.
--
-- WHY NOT A `profiles.role` VALUE, AGAIN
--
-- Same reason ops membership is not: `role` carries an INSERT grant and a column
-- grant cannot restrict *which* value is inserted. Suspension lives in columns
-- with no client write grant at all, and is set only through the definer
-- function below.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. THE COLUMNS ══════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists suspended_at     timestamptz,
  add column if not exists suspended_by     uuid references auth.users,
  add column if not exists suspended_reason text;

alter table public.profiles
  drop constraint if exists profiles_suspended_reason_len;
alter table public.profiles
  add constraint profiles_suspended_reason_len
  check (suspended_reason is null or char_length(suspended_reason) <= 500);

-- No client write grant. `grant update (full_name, phone, language)` from 0001
-- is a column list, so these three were never writable — this is belt and braces
-- against a future `grant update on public.profiles` written without thinking.
revoke update (suspended_at, suspended_by, suspended_reason)
  on public.profiles from anon, authenticated;
revoke insert (suspended_at, suspended_by, suspended_reason)
  on public.profiles from anon, authenticated;

-- A suspended user may read their own suspension and its reason: telling someone
-- why they are locked out is the difference between a policy and a mystery, and
-- the "own profile readable" policy already scopes this to their own row.
--
-- `suspended_by` is not theirs to see. Which dispatcher made the call is
-- internal, and naming a member of staff to a suspended user invites the wrong
-- kind of follow-up.
--
-- Note the shape of this: 0001 issued `grant select on public.profiles`, a
-- TABLE-level privilege, and a column-level REVOKE does not cut a hole in one —
-- Postgres keeps honouring the table grant for every column and the revoke
-- silently achieves nothing. The table grant has to go first, and the columns
-- come back by name. Which is where profiles should have been all along:
-- every future column is now deny-by-default here, exactly as the INSERT and
-- UPDATE grants already were.
revoke select on public.profiles from anon, authenticated;
grant select (id, role, full_name, phone, language, created_at,
              suspended_at, suspended_reason)
  on public.profiles to authenticated;

comment on column public.profiles.suspended_at is
  'Blocks new commitments (post_load, post_leg, accepting an offer). Deliberately '
  'does NOT block advance_trip — a suspended driver still finishes the load they '
  'are carrying. Set only via public.ops_suspend_account.';

-- ═══ 2. THE GATE ═════════════════════════════════════════════════════════════

create or replace function private.require_active()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_when   timestamptz;
begin
  select p.suspended_reason, p.suspended_at into v_reason, v_when
  from public.profiles p
  where p.id = (select auth.uid());

  if v_when is not null then
    -- The reason is echoed back on purpose. The user is entitled to know why,
    -- and a dispatcher writing the reason knowing the user will read it writes
    -- a better one.
    raise exception 'This account is suspended: %', coalesce(v_reason, 'contact Truckkoo')
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function private.require_active() from public, anon, authenticated;

-- ═══ 3. ENFORCEMENT ══════════════════════════════════════════════════════════
--
-- Three call sites, recreated to add one line each. A gate that exists but is
-- not called is worse than no gate, because it reads as protection.

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

  -- Fail closed on anything unexpected rather than coercing it.
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
  ) values (
    -- shipper_id from the session, never from a parameter
    v_actor, p_origin_city, p_dest_city, p_pickup_from, p_pickup_to,
    p_weight_kg, p_truck_type_code, btrim(p_goods), 'posted'
  )
  returning id into v_id;

  -- Both wrapped: auto-dispatch fails OPEN into the human path, because a broken
  -- matcher must never lose a shipper's load.
  begin
    perform private.issue_quote(v_id);
  exception when others then
    insert into private.dispatch_log (load_id, skipped, detail)
    values (v_id, 'error', 'quote: ' || sqlstate);
  end;

  begin
    perform private.auto_dispatch(v_id);
  exception when others then
    insert into private.dispatch_log (load_id, skipped, detail)
    values (v_id, 'error', 'dispatch: ' || sqlstate);
  end;

  return v_id;
end;
$$;

revoke all on function public.post_load(bigint, bigint, date, date, text, integer, text)
  from public, anon;
grant execute on function public.post_load(bigint, bigint, date, date, text, integer, text)
  to authenticated;

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

  -- A driver may only attach a truck they own — re-check every traversal.
  if p_truck_id is not null
     and not exists (select 1 from public.trucks t where t.id = p_truck_id and t.owner_id = v_actor) then
    raise exception 'truck not found' using errcode = 'no_data_found';
  end if;

  insert into public.legs (driver_id, truck_id, origin_city, dest_city, depart_from, depart_to, is_empty)
  values (v_actor, p_truck_id, p_origin_city, p_dest_city, p_depart_from, p_depart_to, p_is_empty)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.post_leg(bigint, bigint, date, date, uuid, boolean)
  from public, anon;
grant execute on function public.post_leg(bigint, bigint, date, date, uuid, boolean)
  to authenticated;

-- Accepting is a new commitment and is blocked. **Declining is not** — a
-- suspended driver must still be able to say no, otherwise the offer sits
-- pending until it expires and the load waits days for an answer that cannot
-- come. Refusing a decline would punish the shipper for the driver's suspension.
create or replace function public.respond_to_offer(p_offer_id uuid, p_accept boolean)
returns uuid
language plpgsql
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

  select * into v_offer
  from public.offers o
  where o.id = p_offer_id and o.driver_id = v_actor;

  if v_offer.id is null then
    raise exception 'offer not found' using errcode = 'no_data_found';
  end if;

  if p_accept then
    perform private.require_active();
    return private.accept_offer(p_offer_id, v_actor, false);
  end if;

  -- ── decline ───────────────────────────────────────────────────────────────
  select * into v_offer from public.offers o where o.id = p_offer_id for update;

  if v_offer.status <> 'pending' then
    raise exception 'offer already resolved' using errcode = 'check_violation';
  end if;
  if v_offer.expires_at <= now() then
    update public.offers set status = 'expired' where id = v_offer.id;
    raise exception 'offer expired' using errcode = 'check_violation';
  end if;

  update public.offers set status = 'declined' where id = v_offer.id;

  -- `expires_at > now()` is load-bearing: offers expire lazily, so a sibling
  -- that timed out days ago is still status 'pending' in the table.
  if not exists (
    select 1 from public.offers o
    where o.load_id = v_offer.load_id
      and o.status = 'pending'
      and o.expires_at > now()
  ) then
    update public.loads set status = 'finding_truck'
    where id = v_offer.load_id and status = 'matched';
  end if;

  return null;
end;
$$;

revoke all on function public.respond_to_offer(uuid, boolean) from public, anon;
grant execute on function public.respond_to_offer(uuid, boolean) to authenticated;

-- ═══ 3b. A BUG THIS MIGRATION'S TESTS FOUND ══════════════════════════════════
--
-- `advance_trip` has never worked. Not "works in some cases" — every call, by
-- every driver, since 0004, fails with:
--
--     ERROR: type "load_status" does not exist
--
-- The function correctly pins `search_path = ''` and correctly qualifies every
-- table, and then casts to `'in_transit'::load_status` and
-- `'delivered'::load_status` — two unqualified type names. With an empty search
-- path a bare type name resolves against nothing. So the driver's entire
-- delivery flow — mark picked up, mark delivered, upload proof — has been dead
-- since the day it was written.
--
-- Nothing caught it because nothing ever called it: no test exercised
-- `advance_trip`, and OPEN_ISSUES records that nothing has been seen running on
-- a real device. It surfaced here only because 0017 needed to prove that a
-- suspended driver can still finish the load they are carrying, which meant
-- calling it for the first time.
--
-- This is precisely the lesson already written down in CLAUDE.md about
-- `trips.truck_id`: "a definer function is the first reader of a column often
-- enough that 'nothing errored' means 'nothing looked'." Here it is again, one
-- layer down — nothing errored because nothing ran.
--
-- The whole class is now checked in supabase/tests/ops_console.sql §8.

create or replace function public.advance_trip(
  p_trip_id    uuid,
  p_to         public.trip_status,
  p_note       text default null,
  p_photo_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_trip  public.trips;
  v_event text;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_trip
  from public.trips t
  where t.id = p_trip_id and t.driver_id = v_actor
  for update;

  if v_trip.id is null then
    raise exception 'trip not found' using errcode = 'no_data_found';
  end if;

  -- assigned -> in_transit -> delivered. Nothing goes backwards. (A dispatcher
  -- can reverse a trip through ops_set_trip_status; a driver cannot.)
  if not (
       (v_trip.status = 'assigned'   and p_to = 'in_transit')
    or (v_trip.status = 'in_transit' and p_to = 'delivered')
  ) then
    raise exception 'invalid transition % -> %', v_trip.status, p_to
      using errcode = 'check_violation';
  end if;

  -- Proof of delivery is mandatory on the delivering transition. Unchanged, and
  -- deliberately stricter than the dispatcher path in 0016.
  if p_to = 'delivered' and (p_photo_path is null or char_length(btrim(p_photo_path)) = 0) then
    raise exception 'delivery requires proof photo' using errcode = 'check_violation';
  end if;

  update public.trips set status = p_to where id = v_trip.id;

  -- THE FIX: both casts are schema-qualified.
  update public.loads
  set status = case when p_to = 'in_transit'
                    then 'in_transit'::public.load_status
                    else 'delivered'::public.load_status end
  where id = v_trip.load_id;

  v_event := case when p_to = 'in_transit' then 'en_route' else 'delivered' end;

  insert into public.trip_events (trip_id, type, note, photo_path)
  values (v_trip.id, v_event, p_note, p_photo_path);
end;
$$;

revoke all on function public.advance_trip(uuid, public.trip_status, text, text)
  from public, anon;
grant execute on function public.advance_trip(uuid, public.trip_status, text, text)
  to authenticated;

-- ═══ 4. THE OPS FUNCTIONS ════════════════════════════════════════════════════

create or replace function public.ops_verify_driver(
  p_profile_id uuid,
  p_verified   boolean,
  p_notes      text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_role   public.user_role;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_verify_driver', 200, interval '1 hour');

  select p.role into v_role from public.profiles p where p.id = p_profile_id;
  if v_role is null then
    raise exception 'account not found' using errcode = 'no_data_found';
  end if;
  if v_role <> 'driver' then
    raise exception 'that account is a shipper, not a driver'
      using errcode = 'check_violation';
  end if;

  -- Un-verifying is a real operation, not a mistake to guard against: a licence
  -- lapses, a document turns out to be forged. It is the same function so the
  -- audit trail reads as one history rather than two.
  if not p_verified and p_notes is null then
    raise exception 'say why you are removing verification'
      using errcode = 'check_violation';
  end if;

  select to_jsonb(d) into v_before from public.drivers d where d.profile_id = p_profile_id;

  insert into public.drivers (profile_id, verified_at, verified_by, notes)
  values (
    p_profile_id,
    case when p_verified then now() else null end,
    case when p_verified then (select auth.uid()) else null end,
    p_notes
  )
  on conflict (profile_id) do update set
    verified_at = case when p_verified then now() else null end,
    verified_by = case when p_verified then (select auth.uid()) else null end,
    -- A null `notes` leaves existing vetting notes alone rather than erasing
    -- them. Losing why someone was verified is not a thing a checkbox should do.
    notes       = coalesce(p_notes, public.drivers.notes);

  perform private.log_ops(
    'ops_verify_driver', 'account', p_profile_id::text,
    v_before,
    (select to_jsonb(d) from public.drivers d where d.profile_id = p_profile_id),
    p_notes
  );
end;
$$;

revoke all on function public.ops_verify_driver(uuid, boolean, text) from public, anon;
grant execute on function public.ops_verify_driver(uuid, boolean, text) to authenticated;

create or replace function public.ops_verify_truck(p_truck_id uuid, p_verified boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_verify_truck', 200, interval '1 hour');

  select to_jsonb(t) into v_before from public.trucks t where t.id = p_truck_id;
  if v_before is null then
    raise exception 'truck not found' using errcode = 'no_data_found';
  end if;

  update public.trucks
  set verified_at = case when p_verified then now() else null end
  where id = p_truck_id;

  perform private.log_ops(
    'ops_verify_truck', 'truck', p_truck_id::text,
    v_before,
    (select to_jsonb(t) from public.trucks t where t.id = p_truck_id),
    null
  );
end;
$$;

revoke all on function public.ops_verify_truck(uuid, boolean) from public, anon;
grant execute on function public.ops_verify_truck(uuid, boolean) to authenticated;

create or replace function public.ops_suspend_account(
  p_profile_id uuid,
  p_suspended  boolean,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_reason text;
begin
  perform private.require_ops();
  v_reason := private.require_reason(p_reason);
  perform private.check_rate_limit('ops_suspend_account', 50, interval '1 hour');

  select to_jsonb(p) into v_before from public.profiles p where p.id = p_profile_id;
  if v_before is null then
    raise exception 'account not found' using errcode = 'no_data_found';
  end if;

  -- A dispatcher cannot suspend a dispatcher, including themselves. Locking
  -- yourself out of the console is a support call at best; locking out a
  -- colleague is a way to remove a witness. Ops membership is granted by hand in
  -- SQL and it is removed the same way.
  if exists (select 1 from private.ops_users o where o.profile_id = p_profile_id) then
    raise exception 'that account is a dispatcher — remove them from private.ops_users first'
      using errcode = 'check_violation';
  end if;

  -- The reason is shown to the suspended user by private.require_active, so it
  -- has to be sanitised on the way in as well as on the way out.
  if private.contains_unsafe_text(v_reason) then
    raise exception 'that reason contains disallowed characters'
      using errcode = 'check_violation';
  end if;

  update public.profiles set
    suspended_at     = case when p_suspended then now() else null end,
    suspended_by     = case when p_suspended then (select auth.uid()) else null end,
    suspended_reason = case when p_suspended then v_reason else null end
  where id = p_profile_id;

  perform private.log_ops(
    'ops_suspend_account', 'account', p_profile_id::text,
    jsonb_build_object('suspended_at', v_before->>'suspended_at'),
    jsonb_build_object('suspended', p_suspended),
    v_reason
  );
end;
$$;

revoke all on function public.ops_suspend_account(uuid, boolean, text) from public, anon;
grant execute on function public.ops_suspend_account(uuid, boolean, text) to authenticated;

/*
 * Fix a typo'd phone number for someone who cannot navigate a settings screen.
 *
 * `role` is not in the signature and never will be. Changing a role crosses a
 * tenant boundary and changes every RLS outcome for every row that account
 * owns — a shipper flipped to driver would lose sight of their own loads and
 * gain a driver's surfaces. If an account is genuinely the wrong type, it is a
 * new account, not an UPDATE.
 */
create or replace function public.ops_update_profile(
  p_profile_id uuid,
  p_full_name  text default null,
  p_phone      text default null,
  p_language   char(2) default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_update_profile', 100, interval '1 hour');

  select to_jsonb(p) into v_before from public.profiles p where p.id = p_profile_id;
  if v_before is null then
    raise exception 'account not found' using errcode = 'no_data_found';
  end if;

  if p_language is not null and p_language not in ('en', 'ar') then
    raise exception 'language must be en or ar' using errcode = 'check_violation';
  end if;

  if private.contains_unsafe_text(p_full_name)
     or private.contains_unsafe_text(p_phone) then
    raise exception 'that contains disallowed characters' using errcode = 'check_violation';
  end if;

  -- Null means "leave alone", not "erase". A dispatcher fixing a phone number
  -- must not silently delete the name.
  update public.profiles set
    full_name = coalesce(left(btrim(p_full_name), 120), full_name),
    phone     = coalesce(left(btrim(p_phone), 24), phone),
    language  = coalesce(p_language, language)
  where id = p_profile_id;

  perform private.log_ops(
    'ops_update_profile', 'account', p_profile_id::text,
    jsonb_build_object(
      'full_name', v_before->>'full_name',
      'phone',     v_before->>'phone',
      'language',  v_before->>'language'
    ),
    (select jsonb_build_object('full_name', p.full_name, 'phone', p.phone, 'language', p.language)
       from public.profiles p where p.id = p_profile_id),
    null
  );
end;
$$;

revoke all on function public.ops_update_profile(uuid, text, text, char) from public, anon;
grant execute on function public.ops_update_profile(uuid, text, text, char) to authenticated;

-- ═══ 5. THE READ LAYER LEARNS ABOUT SUSPENSION ═══════════════════════════════
--
-- A suspension nobody can see on the accounts screen is a support ticket waiting
-- to happen. Return type changes, so drop and recreate; 0015 is not edited.

drop function if exists public.ops_accounts(public.user_role, text, boolean, integer, integer);

create function public.ops_accounts(
  p_role      public.user_role default null,
  p_search    text    default null,
  p_verified  boolean default null,
  p_suspended boolean default null,
  p_limit     integer default 50,
  p_offset    integer default 0
)
returns table (
  profile_id       uuid,
  role             text,
  full_name        text,
  phone            text,
  language         char(2),
  created_at       timestamptz,
  verified_at      timestamptz,
  suspended_at     timestamptz,
  suspended_reason text,
  truck_count      bigint,
  load_count       bigint,
  leg_count        bigint,
  trip_count       bigint,
  open_count       bigint,
  is_ops           boolean,
  total_count      bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text    := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_ops();

  return query
  select
    p.id, p.role::text, p.full_name, p.phone, p.language, p.created_at,
    d.verified_at, p.suspended_at, p.suspended_reason,
    (select count(*) from public.trucks tk where tk.owner_id = p.id),
    (select count(*) from public.loads  l  where l.shipper_id = p.id),
    (select count(*) from public.legs   lg where lg.driver_id = p.id),
    (select count(*) from public.trips  t  where t.driver_id  = p.id),
    case p.role
      when 'shipper' then (select count(*) from public.loads l
                            where l.shipper_id = p.id
                              and l.status in ('posted','finding_truck','matched','assigned','in_transit'))
      else                (select count(*) from public.trips t
                            where t.driver_id = p.id
                              and t.status in ('assigned','in_transit'))
    end,
    -- Surfaced so a dispatcher can see who else holds this power, and so the
    -- console can explain why the suspend button is missing on those rows.
    exists (select 1 from private.ops_users o where o.profile_id = p.id),
    count(*) over ()
  from public.profiles p
  left join public.drivers d on d.profile_id = p.id
  where (p_role is null or p.role = p_role)
    and (
      p_verified is null
      or (p_verified and d.verified_at is not null)
      or (not p_verified and d.verified_at is null and p.role = 'driver')
    )
    and (
      p_suspended is null
      or (p_suspended and p.suspended_at is not null)
      or (not p_suspended and p.suspended_at is null)
    )
    and (
      v_search is null
      or p.full_name ilike '%' || v_search || '%'
      or p.phone     ilike '%' || v_search || '%'
    )
  order by p.created_at desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.ops_accounts(public.user_role, text, boolean, boolean, integer, integer)
  from public, anon;
grant execute on function public.ops_accounts(public.user_role, text, boolean, boolean, integer, integer)
  to authenticated;

drop function if exists public.ops_account(uuid);

create function public.ops_account(p_profile_id uuid)
returns table (
  profile_id       uuid,
  role             text,
  full_name        text,
  phone            text,
  language         char(2),
  created_at       timestamptz,
  verified_at      timestamptz,
  verified_by      uuid,
  notes            text,
  suspended_at     timestamptz,
  suspended_by     uuid,
  suspended_reason text,
  is_ops           boolean,
  truck_count      bigint,
  load_count       bigint,
  leg_count        bigint,
  trip_count       bigint
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
    p.id, p.role::text, p.full_name, p.phone, p.language, p.created_at,
    d.verified_at, d.verified_by, d.notes,
    p.suspended_at, p.suspended_by, p.suspended_reason,
    exists (select 1 from private.ops_users o where o.profile_id = p.id),
    (select count(*) from public.trucks tk where tk.owner_id = p.id),
    (select count(*) from public.loads  l  where l.shipper_id = p.id),
    (select count(*) from public.legs   lg where lg.driver_id = p.id),
    (select count(*) from public.trips  t  where t.driver_id  = p.id)
  from public.profiles p
  left join public.drivers d on d.profile_id = p.id
  where p.id = p_profile_id;
end;
$$;

revoke all on function public.ops_account(uuid) from public, anon;
grant execute on function public.ops_account(uuid) to authenticated;

-- The overview counts what the console is now responsible for.
drop function if exists public.ops_stats();

create function public.ops_stats()
returns table (
  loads_posted          bigint,
  loads_finding_truck   bigint,
  loads_matched         bigint,
  loads_assigned        bigint,
  loads_in_transit      bigint,
  loads_delivered       bigint,
  loads_cancelled       bigint,
  unmatched_under_4h    bigint,
  unmatched_4_to_24h    bigint,
  unmatched_over_24h    bigint,
  unpriced_open         bigint,
  offers_pending        bigint,
  offers_expiring_6h    bigint,
  offers_already_expired bigint,
  trips_assigned        bigint,
  trips_in_transit      bigint,
  trips_stale_48h       bigint,
  drivers_total         bigint,
  drivers_verified      bigint,
  accounts_suspended    bigint,
  legs_open_next_7d     bigint,
  auto_dispatch_enabled boolean,
  dispatch_7d_sent      bigint,
  dispatch_7d_no_candidates bigint,
  dispatch_7d_no_price  bigint,
  dispatch_7d_disabled  bigint,
  dispatch_7d_error     bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  with open_loads as (
    select l.id, l.created_at, l.price_baisa
    from public.loads l
    where l.status in ('posted', 'finding_truck', 'matched')
  ),
  unmatched as (
    select ol.* from open_loads ol
    where not exists (
      select 1 from public.offers o
      where o.load_id = ol.id and o.status in ('pending', 'accepted')
    )
  ),
  trip_last as (
    select t.id, t.status,
           coalesce(
             (select max(e.occurred_at) from public.trip_events e where e.trip_id = t.id),
             t.created_at
           ) as touched_at
    from public.trips t
  )
  select
    (select count(*) from public.loads where status = 'posted'),
    (select count(*) from public.loads where status = 'finding_truck'),
    (select count(*) from public.loads where status = 'matched'),
    (select count(*) from public.loads where status = 'assigned'),
    (select count(*) from public.loads where status = 'in_transit'),
    (select count(*) from public.loads where status = 'delivered'),
    (select count(*) from public.loads where status = 'cancelled'),

    (select count(*) from unmatched where now() - created_at <  interval '4 hours'),
    (select count(*) from unmatched where now() - created_at >= interval '4 hours'
                                     and now() - created_at <  interval '24 hours'),
    (select count(*) from unmatched where now() - created_at >= interval '24 hours'),
    (select count(*) from open_loads where price_baisa is null),

    (select count(*) from public.offers where status = 'pending'),
    (select count(*) from public.offers
      where status = 'pending' and expires_at > now() and expires_at <= now() + interval '6 hours'),
    (select count(*) from public.offers where status = 'pending' and expires_at <= now()),

    (select count(*) from public.trips where status = 'assigned'),
    (select count(*) from public.trips where status = 'in_transit'),
    (select count(*) from trip_last
      where status in ('assigned', 'in_transit') and now() - touched_at > interval '48 hours'),

    (select count(*) from public.profiles where role = 'driver'),
    (select count(*) from public.drivers where verified_at is not null),
    (select count(*) from public.profiles where suspended_at is not null),
    (select count(*) from public.legs
      where status = 'open' and depart_from <= (now() + interval '7 days')::date
        and depart_to >= now()::date),

    private.setting_bool('auto_dispatch_enabled', true),

    (select coalesce(sum(dl.offers_sent), 0) from private.dispatch_log dl
      where dl.created_at > now() - interval '7 days'),
    (select count(*) from private.dispatch_log dl
      where dl.created_at > now() - interval '7 days' and dl.skipped = 'no_candidates'),
    (select count(*) from private.dispatch_log dl
      where dl.created_at > now() - interval '7 days' and dl.skipped = 'no_price'),
    (select count(*) from private.dispatch_log dl
      where dl.created_at > now() - interval '7 days' and dl.skipped = 'disabled'),
    (select count(*) from private.dispatch_log dl
      where dl.created_at > now() - interval '7 days' and dl.skipped = 'error');
end;
$$;

revoke all on function public.ops_stats() from public, anon;
grant execute on function public.ops_stats() to authenticated;

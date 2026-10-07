-- 0059 · Ops console v2, phase 5: people and history.
--
-- One list of people (shippers, drivers, staff), and one page per person with
-- everything they have done and everything staff have done to them, paged.
-- READS only, behind require_ops(). No table grant or policy changes.
--
-- Where a driver is: a TOWN here, never a coordinate. ops_live_map() (0055)
-- stays the only reader of driver_availability.lat/lng; the profile links to it.

-- ═══ 1. the list ═════════════════════════════════════════════════════════════
-- A new function rather than a changed ops_accounts (0017): that one returns a
-- fixed row type the old screens still read.
create or replace function public.ops_people(
  p_role      public.user_role default null,
  p_search    text    default null,
  p_verified  boolean default null,
  p_suspended boolean default null,
  p_online    boolean default null,
  p_staff     boolean default null,
  p_limit     integer default 50,
  p_offset    integer default 0
)
returns table (
  profile_id     uuid,
  role           text,
  full_name      text,
  phone          text,
  created_at     timestamptz,
  verified_at    timestamptz,
  suspended_at   timestamptz,
  online         boolean,
  staff_level    text,
  last_active_at timestamptz,
  trip_count     bigint,
  load_count     bigint,
  total_count    bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  -- Matched with strpos, not ilike: a '%' or '_' typed into the box is a
  -- character to find, not a wildcard.
  v_search text := lower(nullif(btrim(p_search), ''));
begin
  perform private.require_ops();

  return query
  with base as (
    select p.id, p.role, p.full_name, p.phone, p.created_at, d.verified_at, p.suspended_at,
           coalesce(p.role = 'driver'::public.user_role and da.available, false) as online,
           ou.level as staff_level
      from public.profiles p
      left join public.drivers d on d.profile_id = p.id
      left join public.driver_availability da on da.driver_id = p.id
      left join private.ops_users ou on ou.profile_id = p.id
     where (p_role is null or p.role = p_role)
       and (p_verified is null or (d.verified_at is not null) = p_verified)
       and (p_suspended is null or (p.suspended_at is not null) = p_suspended)
       and (p_online is null or coalesce(p.role = 'driver'::public.user_role and da.available, false) = p_online)
       and (p_staff is null or (ou.profile_id is not null) = p_staff)
       and (v_search is null
            or strpos(lower(coalesce(p.full_name, '')), v_search) > 0
            or strpos(coalesce(p.phone, ''), v_search) > 0
            or strpos(p.id::text, v_search) = 1)
  ),
  page as (
    select b.*, count(*) over () as total
      from base b
     order by b.created_at desc, b.id
     limit v_limit offset v_offset
  )
  select pg.id, pg.role::text, pg.full_name, pg.phone, pg.created_at, pg.verified_at,
         pg.suspended_at, pg.online, pg.staff_level,
         -- Things the PERSON did. Not offers.created_at (automatic dispatch
         -- writes those to every online driver each wave) and not
         -- driver_availability.updated_at (the 0038 sweep bumps it when it
         -- switches a driver off). located_at is the phone itself reporting.
         greatest(
           (select max(l.created_at) from public.loads l where l.shipper_id = pg.id),
           (select max(l.accepted_at) from public.loads l where l.shipper_id = pg.id),
           (select max(b.updated_at) from private.driver_bids b where b.driver_id = pg.id),
           -- Events on their own trips, except notes staff added to them.
           (select max(e.occurred_at) from public.trip_events e join public.trips t on t.id = e.trip_id
             where t.driver_id = pg.id and (e.created_by is null or e.created_by = pg.id)),
           (select max(lg.created_at) from public.legs lg where lg.driver_id = pg.id),
           (select max(dd.created_at) from public.driver_documents dd where dd.driver_id = pg.id),
           (select da.located_at from public.driver_availability da where da.driver_id = pg.id)
         ),
         (select count(*) from public.trips t where t.driver_id = pg.id),
         (select count(*) from public.loads l where l.shipper_id = pg.id),
         pg.total
    from page pg
   order by pg.created_at desc, pg.id;
end;
$$;
revoke all on function public.ops_people(public.user_role, text, boolean, boolean, boolean, boolean, integer, integer)
  from public, anon;
grant execute on function public.ops_people(public.user_role, text, boolean, boolean, boolean, boolean, integer, integer)
  to authenticated;

-- ═══ 2. one person's history ═════════════════════════════════════════════════
-- Every row has a stable `key` (kind + source id) so paging can break ties on
-- equal timestamps without duplicating or skipping. Ungranted: ops_person is
-- its only caller, and it checks require_ops() first.
create or replace function private.person_history(p_id uuid)
returns table (at timestamptz, key text, kind text, title text, detail text,
               target_kind text, target_id text, actor text)
language sql
stable
security definer
set search_path = ''
as $$
  with routes as (
    select l.id, l.shipper_id, l.created_at, l.accepted_at, l.status,
           o.name_en || ' → ' || d.name_en as route
      from public.loads l
      join public.cities o on o.id = l.origin_city
      join public.cities d on d.id = l.dest_city
  ),
  my_trips as (
    select t.id, t.created_at, r.route
      from public.trips t join routes r on r.id = t.load_id
     where t.driver_id = p_id or r.shipper_id = p_id
  )
  -- shipper: loads posted and prices accepted
  select r.created_at, 'load_posted:' || r.id, 'load_posted', 'Posted a load: ' || r.route,
         r.status::text, 'load', r.id::text, null::text
    from routes r where r.shipper_id = p_id
  union all
  select r.accepted_at, 'quote_accepted:' || r.id, 'quote_accepted', 'Accepted the price: ' || r.route,
         null, 'load', r.id::text, null
    from routes r where r.shipper_id = p_id and r.accepted_at is not null
  -- driver: offers (no response timestamp exists, so the offer's own time and its outcome)
  union all
  select o.created_at, 'offer:' || o.id,
         case o.status when 'pending'::public.offer_status then 'offer_sent' else 'offer_' || o.status::text end,
         case o.status
           when 'pending'::public.offer_status then 'Offered a load: '
           when 'accepted'::public.offer_status then 'Accepted a load: '
           when 'declined'::public.offer_status then 'Declined a load: '
           else 'Offer closed: ' end || r.route,
         case o.source when 'bid' then 'invited to bid' when 'auto' then 'automatic dispatch' else 'sent by a dispatcher' end,
         'load', o.load_id::text, null
    from public.offers o join routes r on r.id = o.load_id
   where o.driver_id = p_id
  union all
  select b.created_at, 'bid_placed:' || b.id, 'bid_placed', 'Bid on a load: ' || r.route,
         null, 'load', b.load_id::text, null
    from private.driver_bids b join routes r on r.id = b.load_id
   where b.driver_id = p_id
  -- both: trips and what happened on them
  union all
  select t.created_at, 'trip_started:' || t.id, 'trip_started', 'Took the job: ' || t.route,
         null, 'trip', t.id::text, null
    from my_trips t
  union all
  select e.occurred_at, 'trip_event:' || e.id, 'trip_event', initcap(replace(e.type, '_', ' ')) || ': ' || t.route,
         e.note, 'trip', t.id::text, null
    from public.trip_events e join my_trips t on t.id = e.trip_id
  union all
  select ra.created_at, 'rating:' || ra.trip_id, 'rating',
         case when ra.driver_id = p_id then 'Was rated ' else 'Gave ' end || ra.stars || ' stars',
         null, 'trip', ra.trip_id::text, null
    from public.ratings ra where ra.driver_id = p_id or ra.shipper_id = p_id
  -- account
  union all
  select dd.created_at, 'document_submitted:' || dd.id, 'document_submitted',
         'Sent a document: ' || replace(dd.kind, '_', ' '), null, 'document', p_id::text, null
    from public.driver_documents dd where dd.driver_id = p_id
  union all
  select dd.reviewed_at, 'document_reviewed:' || dd.id, 'document_reviewed',
         'Document ' || dd.status || ': ' || replace(dd.kind, '_', ' '), dd.review_note,
         'document', p_id::text, null
    from public.driver_documents dd
   where dd.driver_id = p_id and dd.reviewed_at is not null and dd.status <> 'pending'
  union all
  select d.verified_at, 'verified:' || d.profile_id, 'verified', 'Verified as a driver',
         null, 'account', p_id::text, null
    from public.drivers d where d.profile_id = p_id and d.verified_at is not null
  union all
  select p.suspended_at, 'suspended:' || p.id, 'suspended', 'Suspended', p.suspended_reason,
         'account', p_id::text, null
    from public.profiles p where p.id = p_id and p.suspended_at is not null
  -- every staff action on them, their loads, trips, documents or trucks
  union all
  select a.created_at, 'staff_action:' || a.id, 'staff_action',
         initcap(replace(regexp_replace(a.action, '^ops_', ''), '_', ' ')), a.reason,
         a.target_kind, a.target_id, ap.full_name
    from private.ops_audit a
    left join public.profiles ap on ap.id = a.actor_id
   where (a.target_kind in ('account', 'profile') and a.target_id = p_id::text)
      or (a.target_kind = 'load' and a.target_id in (select r.id::text from routes r where r.shipper_id = p_id))
      or (a.target_kind = 'trip' and a.target_id in (select t.id::text from my_trips t))
      or (a.target_kind = 'driver_document'
          and a.target_id in (select dd.id::text from public.driver_documents dd where dd.driver_id = p_id))
      or (a.target_kind = 'truck'
          and a.target_id in (select tr.id::text from public.trucks tr where tr.owner_id = p_id))
      or (a.target_kind = 'offer'
          and a.target_id in (select o.id::text from public.offers o where o.driver_id = p_id))
      or (a.target_kind = 'leg'
          and a.target_id in (select lg.id::text from public.legs lg where lg.driver_id = p_id))
      -- A trip reassigned away from them no longer names them; its audit row's
      -- before-state still does, and that is the trace of why.
      or (a.target_kind in ('trip', 'load')
          and p_id::text in (a.before ->> 'driver_id', a.after ->> 'driver_id'));
$$;
revoke all on function private.person_history(uuid) from public, anon, authenticated;

-- ═══ 3. the profile ══════════════════════════════════════════════════════════
-- Keyset paging on (at, key) descending; `next` is the last row's pair when
-- more remain. Earnings use the same private.trip_payout the driver's own
-- driver_earnings() uses — never computed in the console.
create or replace function public.ops_person(
  p_id         uuid,
  p_before     timestamptz default null,
  p_before_key text        default null,
  p_limit      integer     default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit   integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_p       public.profiles;
  v_profile jsonb;
  v_trucks  jsonb;
  v_earn    jsonb;
  v_hist    jsonb;
  v_count   integer;
  v_next    jsonb;
  v_today   date := (now() at time zone 'Asia/Muscat')::date;
begin
  perform private.require_ops();

  select * into v_p from public.profiles p where p.id = p_id;
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  select jsonb_build_object(
           'id', v_p.id, 'role', v_p.role, 'full_name', v_p.full_name, 'phone', v_p.phone,
           'language', v_p.language, 'created_at', v_p.created_at,
           'verified_at', (select d.verified_at from public.drivers d where d.profile_id = v_p.id),
           'suspended_at', v_p.suspended_at, 'suspended_reason', v_p.suspended_reason,
           'staff_level', (select ou.level from private.ops_users ou where ou.profile_id = v_p.id),
           'rating_avg', (select round(avg(r.stars), 1) from public.ratings r
                           where case when v_p.role = 'driver'::public.user_role
                                      then r.driver_id else r.shipper_id end = v_p.id),
           'rating_count', (select count(*) from public.ratings r
                             where case when v_p.role = 'driver'::public.user_role
                                        then r.driver_id else r.shipper_id end = v_p.id),
           'online', coalesce(v_p.role = 'driver'::public.user_role and da.available, false),
           'town', c.name_en,
           'location_at', coalesce(da.located_at, da.updated_at))
    into v_profile
    from (select 1) one
    left join public.driver_availability da on da.driver_id = v_p.id
    left join public.cities c on c.id = da.city_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'plate', t.plate, 'type', t.truck_type, 'capacity_kg', t.capacity_kg,
           'verified_at', t.verified_at) order by t.created_at desc), '[]'::jsonb)
    into v_trucks
    from public.trucks t where t.owner_id = v_p.id;

  if v_p.role = 'driver'::public.user_role then
    with delivered as (
      select private.trip_payout(t.id, l.price_baisa) as payout,
             (private.trip_done_at(t.id, t.created_at) at time zone 'Asia/Muscat')::date as done_on
        from public.trips t join public.loads l on l.id = t.load_id
       where t.driver_id = v_p.id
         and t.status in ('delivered'::public.trip_status, 'closed'::public.trip_status)
    )
    select jsonb_build_object(
             'week_baisa', coalesce(sum(d.payout) filter (
                 where d.done_on >= v_today - (extract(isodow from v_today)::int % 7)), 0)::bigint,
             'month_baisa', coalesce(sum(d.payout) filter (
                 where d.done_on >= date_trunc('month', v_today)::date), 0)::bigint,
             'all_time_baisa', coalesce(sum(d.payout), 0)::bigint,
             'trips', count(*))
      into v_earn
      from delivered d;
  end if;

  with h as (
    select * from private.person_history(v_p.id) x
     where x.at is not null
       and (p_before is null or (x.at, x.key) < (p_before, coalesce(p_before_key, '')))
     order by x.at desc, x.key desc
     limit v_limit + 1
  ),
  numbered as (select h.*, row_number() over (order by h.at desc, h.key desc) as n from h)
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', n.at, 'key', n.key, 'kind', n.kind, 'title', n.title, 'detail', n.detail,
           'target_kind', n.target_kind, 'target_id', n.target_id, 'actor', n.actor)
           order by n.n) filter (where n.n <= v_limit), '[]'::jsonb),
         count(*)
    into v_hist, v_count
    from numbered n;

  if v_count > v_limit then
    v_next := jsonb_build_object('before', v_hist -> (v_limit - 1) -> 'at',
                                 'before_key', v_hist -> (v_limit - 1) -> 'key');
  end if;

  return jsonb_build_object('profile', v_profile, 'trucks', v_trucks, 'earnings', v_earn,
                            'history', v_hist, 'next', v_next);
end;
$$;
revoke all on function public.ops_person(uuid, timestamptz, text, integer) from public, anon;
grant execute on function public.ops_person(uuid, timestamptz, text, integer) to authenticated;

-- ═══ 4. a trip's recorded route ══════════════════════════════════════════════
-- One trip's trip_positions, oldest first, for the trip page's map. Only
-- in-transit fixes were ever stored (0032) and the sweep keeps 30 days
-- (position_retention_days), so an empty result is an answer, not an error.
create or replace function public.ops_trip_route(p_trip_id uuid)
returns table (seen_at timestamptz, lat double precision, lng double precision, accuracy_m numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  if not exists (select 1 from public.trips t where t.id = p_trip_id) then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  return query
  select tp.seen_at, tp.lat::double precision, tp.lng::double precision, tp.accuracy_m
    from public.trip_positions tp
   where tp.trip_id = p_trip_id
   order by tp.seen_at, tp.id;
end;
$$;
revoke all on function public.ops_trip_route(uuid) from public, anon;
grant execute on function public.ops_trip_route(uuid) to authenticated;

-- ═══ 5. see as user ══════════════════════════════════════════════════════════
-- An owner's read-only look at what a shipper's or driver's app shows now.
-- It runs the APP'S OWN composing functions as that user, so the view cannot
-- drift from the phone. The identity swap is transaction-local and undone
-- before returning; on an error the swap rolls back with the transaction (or
-- the caller's subtransaction) and is restored explicitly too.
--
-- auth.uid() reads request.jwt.claim.sub FIRST and only then the claims JSON,
-- so both settings are swapped and both restored. Read-only by construction:
-- every function called here is non-volatile (asserted in ops_people.sql §8).
-- Volatile itself only because it writes the audit row. Owner, fresh 2FA, a
-- reason, and an emailed alert (spec §9b locks 4 and 6).
create or replace function public.ops_view_as(p_profile_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner      uuid := auth.uid();
  v_p          public.profiles;
  v_reason     text := btrim(coalesce(p_reason, ''));
  v_claims     text := current_setting('request.jwt.claims', true);
  v_claim_sub  text := current_setting('request.jwt.claim.sub', true);
  v_view       jsonb;
begin
  perform private.require_owner_fresh();

  select * into v_p from public.profiles p
   where p.id = p_profile_id
     and not exists (select 1 from private.ops_users ou where ou.profile_id = p.id);
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'A reason is required' using errcode = 'check_violation';
  end if;

  perform private.log_ops('ops_view_as', 'account', v_p.id::text, null,
                          jsonb_build_object('role', v_p.role), v_reason);
  perform private.system_raise_alert('owner_view_as',
    -- Short id only: this text leaves by email and webhook, and no alert
    -- carries a name, phone or cargo (0048).
    format('Owner viewed the app as user %s. See ops_audit.', upper(left(v_p.id::text, 8))),
    jsonb_build_object('action', 'ops_view_as', 'owner_id', v_owner, 'profile_id', v_p.id));

  begin
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_p.id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    perform set_config('request.jwt.claim.sub', v_p.id::text, true);

    if v_p.role = 'driver'::public.user_role then
      v_view := jsonb_build_object(
        'role', 'driver',
        'offers', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.driver_offers() x),
        'bid_invites', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.driver_bid_invites() x),
        'active_trips', (select coalesce(jsonb_agg(to_jsonb(x) order by t.created_at desc), '[]'::jsonb)
                           from public.trips t, lateral public.driver_trip(t.id) x
                          where t.driver_id = v_p.id
                            and t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)),
        'past_trips', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.driver_trips() x),
        'earnings', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.driver_earnings() x),
        'documents', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.driver_document_status() x));
    else
      -- The shipper app reads its loads straight from public.loads under RLS,
      -- not through a function: the same columns (src/lib/queries.ts
      -- LOAD_COLUMNS), scoped explicitly to this shipper.
      v_view := jsonb_build_object(
        'role', 'shipper',
        'loads', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
                    from (select l.id, l.origin_city, l.dest_city, l.pickup_from, l.pickup_to, l.weight_kg,
                                 l.truck_type_code, l.goods_description, l.status, l.price_baisa, l.currency,
                                 l.created_at, l.pricing_mode, l.bid_deadline
                            from public.loads l where l.shipper_id = v_p.id) x),
        'bids', (select coalesce(jsonb_object_agg(l.id::text, jsonb_build_object(
                    'status', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.shipper_bid_status(l.id) s),
                    'bids', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from public.shipper_load_bids(l.id) b))),
                    '{}'::jsonb)
                   from public.loads l
                  where l.shipper_id = v_p.id and l.pricing_mode = 'bid'
                    and l.status not in ('delivered'::public.load_status, 'closed'::public.load_status,
                                         'cancelled'::public.load_status)));
    end if;

    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
    raise;
  end;

  if auth.uid() is distinct from v_owner then
    raise exception 'identity was not restored' using errcode = 'internal_error';
  end if;

  return jsonb_build_object(
    'viewed_at', now(),
    'account', jsonb_build_object('id', v_p.id, 'full_name', v_p.full_name, 'role', v_p.role),
    'view', v_view);
end;
$$;
revoke all on function public.ops_view_as(uuid, text) from public, anon;
grant execute on function public.ops_view_as(uuid, text) to authenticated;

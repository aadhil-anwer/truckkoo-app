-- 0066 · Support desk S2 review fixes.
--
-- C1 (pre-existing, found by the S2 review): trips had UNIQUE(load_id), so a
-- cancelled trip blocked every later accept of the same load — a load sent back
-- to dispatch (staff cancel since 0016, the 0064 playbook, a 0065 release)
-- could never be taken again, and the shipper would see "finding you a truck"
-- for ever. Now: one LIVE trip per load. The five functions that assumed one
-- trip per load read the live one.
-- C2: a reassigned trip's no-show clock starts from the new driver (assigned_at).
-- Plus: no send-back with the cargo aboard or for a bid load; the no-show check
-- waits for the last pickup day and skips trips already reported; the
-- abandonment check skips drivers who reported a problem; appeals are about the
-- driver; a case's strike must be decided before it closes; staff reasons stay
-- off the trip timeline the driver and shipper read; a strike voided before
-- anyone confirmed it never shows on the driver's record.

-- ═══ 1. one live trip per load ═══════════════════════════════════════════════
alter table public.trips drop constraint trips_load_id_key;
create unique index trips_one_live_per_load on public.trips (load_id)
  where status <> 'cancelled'::public.trip_status;

CREATE OR REPLACE FUNCTION private.ops_set_load_status_pre_bidding(p_load_id uuid, p_status load_status, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_load    public.loads;
  v_before  jsonb;
  v_trip    public.trips;
  v_reason  text;
begin
  perform private.require_ops();
  v_reason := private.require_reason(p_reason);
  -- A compromised dispatcher session bulk-cancelling the book is the failure
  -- this bounds. 300/hour is far above any real day's work.
  perform private.check_rate_limit('ops_set_load_status', 300, interval '1 hour');

  select * into v_load from public.loads l where l.id = p_load_id for update;
  if v_load.id is null then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;

  if v_load.status = p_status then
    raise exception 'load is already %', p_status using errcode = 'check_violation';
  end if;

  if not private.load_transition_ok(v_load.status, p_status) then
    raise exception 'cannot move a load from % to %', v_load.status, p_status
      using errcode = 'check_violation';
  end if;

  v_before := to_jsonb(v_load);
  select * into v_trip from public.trips t where t.load_id = p_load_id and t.status <> 'cancelled'::public.trip_status for update;

  -- A load cannot claim to be on a truck without a trip saying which one.
  if p_status in ('assigned', 'in_transit', 'delivered') and v_trip.id is null then
    raise exception
      'a load cannot be % with no trip — accept an offer for a driver first', p_status
      using errcode = 'check_violation';
  end if;

  -- ── cascades ──────────────────────────────────────────────────────────────

  if p_status = 'cancelled' then
    update public.offers set status = 'expired'
    where load_id = p_load_id and status in ('pending', 'accepted');

    if v_trip.id is not null and v_trip.status not in ('cancelled', 'closed') then
      update public.trips set status = 'cancelled' where id = v_trip.id;
      insert into public.trip_events (trip_id, type, note)
      values (v_trip.id, 'note', 'Load cancelled by dispatch: ' || v_reason);
    end if;

    -- The leg is supply again. It was matched to a load that no longer exists.
    update public.legs set status = 'open'
    where id = v_trip.leg_id and status = 'matched';

  elsif p_status in ('posted', 'finding_truck', 'matched')
        and v_load.status in ('assigned', 'in_transit', 'delivered') then
    -- Walking a load back before assignment must take its trip with it,
    -- otherwise a live trip points at a load that says nobody is carrying it.
    if v_trip.id is not null and v_trip.status not in ('cancelled', 'closed') then
      update public.trips set status = 'cancelled' where id = v_trip.id;
      insert into public.trip_events (trip_id, type, note)
      values (v_trip.id, 'note', 'Returned to dispatch: ' || v_reason);
      update public.legs set status = 'open'
      where id = v_trip.leg_id and status = 'matched';
    end if;

    update public.offers set status = 'expired'
    where load_id = p_load_id and status in ('pending', 'accepted');

  elsif p_status = 'posted' and v_load.status = 'cancelled' then
    -- Reviving. Offers stay dead; the load is genuinely starting again.
    null;
  end if;

  update public.loads set status = p_status where id = p_load_id;

  perform private.log_ops(
    'ops_set_load_status', 'load', p_load_id::text,
    v_before,
    (select to_jsonb(l) from public.loads l where l.id = p_load_id),
    v_reason
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_load(p_load_id uuid)
 RETURNS TABLE(load_id uuid, reference text, shipper_id uuid, shipper_name text, shipper_phone text, shipper_language character, origin_city bigint, origin_name text, origin_name_ar text, dest_city bigint, dest_name text, dest_name_ar text, pickup_from date, pickup_to date, goods text, weight_kg integer, truck_type_code text, truck_type_name text, status text, price_baisa bigint, currency character, posted_at timestamp with time zone, age_hours numeric, pending_offers bigint, auto_offers bigint, trip_id uuid, trip_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_ops();

  return query
  select
    l.id,
    'NO. ' || upper(left(l.id::text, 8)),
    l.shipper_id,
    sp.full_name,
    sp.phone,
    sp.language,
    l.origin_city,
    oc.name_en,
    oc.name_ar,
    l.dest_city,
    dc.name_en,
    dc.name_ar,
    l.pickup_from,
    l.pickup_to,
    l.goods_description,
    l.weight_kg,
    l.truck_type_code,
    tt.name_en,
    l.status::text,
    l.price_baisa,
    l.currency,
    l.created_at,
    round(extract(epoch from (now() - l.created_at)) / 3600.0, 1),
    (select count(*) from public.offers o
      where o.load_id = l.id and o.status = 'pending'),
    (select count(*) from public.offers o
      where o.load_id = l.id and o.source = 'auto'),
    t.id,
    t.status::text
  from public.loads l
  join public.profiles sp on sp.id = l.shipper_id
  join public.cities   oc on oc.id = l.origin_city
  join public.cities   dc on dc.id = l.dest_city
  left join public.truck_types tt on tt.code = l.truck_type_code
  left join lateral (select x.* from public.trips x where x.load_id = l.id
                      order by (x.status <> 'cancelled'::public.trip_status) desc, x.created_at desc limit 1) t on true
  where l.id = p_load_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_loads(p_status load_status[] DEFAULT NULL::load_status[], p_origin bigint DEFAULT NULL::bigint, p_dest bigint DEFAULT NULL::bigint, p_search text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(load_id uuid, reference text, shipper_id uuid, shipper_name text, shipper_phone text, origin_city bigint, origin_name text, dest_city bigint, dest_name text, pickup_from date, pickup_to date, goods text, weight_kg integer, truck_type_code text, status text, price_baisa bigint, currency character, posted_at timestamp with time zone, age_hours numeric, pending_offers bigint, accepted_offers bigint, declined_offers bigint, auto_offers bigint, trip_id uuid, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- Bound the page size. An unbounded limit from a client is a denial-of-service
  -- primitive against our own database, and no screen shows 5000 rows usefully.
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text    := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_ops();

  return query
  select
    l.id,
    'NO. ' || upper(left(l.id::text, 8)),
    l.shipper_id,
    sp.full_name,
    sp.phone,
    l.origin_city,
    oc.name_en,
    l.dest_city,
    dc.name_en,
    l.pickup_from,
    l.pickup_to,
    l.goods_description,
    l.weight_kg,
    l.truck_type_code,
    l.status::text,
    l.price_baisa,
    l.currency,
    l.created_at,
    round(extract(epoch from (now() - l.created_at)) / 3600.0, 1),
    (select count(*) from public.offers o
      where o.load_id = l.id and o.status = 'pending'),
    (select count(*) from public.offers o
      where o.load_id = l.id and o.status = 'accepted'),
    (select count(*) from public.offers o
      where o.load_id = l.id and o.status = 'declined'),
    (select count(*) from public.offers o
      where o.load_id = l.id and o.source = 'auto'),
    (select t.id from public.trips t where t.load_id = l.id
      order by (t.status <> 'cancelled'::public.trip_status) desc, t.created_at desc limit 1),
    count(*) over ()
  from public.loads l
  join public.profiles sp on sp.id = l.shipper_id
  join public.cities   oc on oc.id = l.origin_city
  join public.cities   dc on dc.id = l.dest_city
  where (p_status is null or l.status = any (p_status))
    and (p_origin is null or l.origin_city = p_origin)
    and (p_dest   is null or l.dest_city   = p_dest)
    and (p_from   is null or l.pickup_to   >= p_from)
    and (p_to     is null or l.pickup_from <= p_to)
    and (
      v_search is null
      -- The dispatcher's two search habits: reading a reference off a phone
      -- call, and remembering what the cargo was. `left(id::text, 8)` is exactly
      -- what `reference()` shows, so a pasted "NO. A3F21C0B" finds its load.
      or l.id::text ilike left(regexp_replace(v_search, '^NO\.?\s*', '', 'i'), 8) || '%'
      or l.goods_description ilike '%' || v_search || '%'
      or sp.full_name ilike '%' || v_search || '%'
    )
  order by l.created_at desc
  limit v_limit offset v_offset;
end;
$function$;

-- ═══ 2. when this driver got the trip ════════════════════════════════════════
alter table public.trips add column assigned_at timestamptz;
update public.trips set assigned_at = created_at where assigned_at is null;
alter table public.trips alter column assigned_at set default now();
alter table public.trips alter column assigned_at set not null;

create or replace function private.trips_assigned_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.driver_id is distinct from old.driver_id then
    new.assigned_at := now();
  end if;
  return new;
end;
$$;
create trigger trips_assigned_at before update on public.trips
  for each row execute function private.trips_assigned_at();

-- ═══ 3. strikes: confirmed_at, so a suspicion voided unseen stays unseen ═════
alter table private.incidents add column confirmed_at timestamptz;
update private.incidents set confirmed_at = coalesce(decided_at, created_at) where state = 'confirmed';

create or replace function public.ops_incident_add(
  p_subject uuid, p_kind text, p_weight integer, p_trip_id uuid, p_case_id uuid, p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_reason text;
  v_weight smallint;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_incident_add', 100, interval '1 hour');
  if p_kind is null or p_kind not in ('no_show', 'abandoned', 'release', 'late_cancel', 'damage', 'delivery_dispute',
                                      'price_demand', 'misconduct', 'unreachable', 'not_ready', 'cargo_mismatch', 'other') then
    raise exception 'unknown incident kind' using errcode = 'check_violation';
  end if;
  if p_weight is not null and p_weight not between 1 and 3 then
    raise exception 'a strike weighs 1, 2 or 3' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_subject) then
    raise exception 'person not found' using errcode = 'no_data_found';
  end if;
  if p_trip_id is not null and not exists (select 1 from public.trips t where t.id = p_trip_id) then
    raise exception 'trip not found' using errcode = 'no_data_found';
  end if;
  if p_trip_id is not null and p_subject not in (
       select t.driver_id from public.trips t where t.id = p_trip_id
       union select l.shipper_id from public.trips t join public.loads l on l.id = t.load_id where t.id = p_trip_id) then
    raise exception 'that person was not on this trip' using errcode = 'check_violation';
  end if;
  if p_case_id is not null and not exists (select 1 from public.shipment_cases c where c.id = p_case_id) then
    raise exception 'case not found' using errcode = 'no_data_found';
  end if;
  v_reason := private.clean_text(p_reason, 3, 'a strike');
  v_weight := coalesce(p_weight, private.incident_weight(p_kind));

  insert into private.incidents (subject_id, kind, weight, state, source, trip_id, case_id, reason,
                                 decided_by, decided_at, confirmed_at, created_by)
  values (p_subject, p_kind, v_weight, 'confirmed', case when p_case_id is null then 'staff' else 'case' end,
          p_trip_id, p_case_id, v_reason, auth.uid(), now(), now(), auth.uid())
  returning id into v_id;

  if p_case_id is not null then
    perform private.case_event(p_case_id, 'action', v_reason,
      jsonb_build_object('action', 'strike', 'incident', v_id, 'kind', p_kind, 'weight', v_weight));
  end if;
  perform private.log_ops('ops_incident_add', 'account', p_subject::text, null,
    jsonb_build_object('incident', v_id, 'kind', p_kind, 'weight', v_weight, 'trip_id', p_trip_id, 'case_id', p_case_id), v_reason);
  return v_id;
end;
$$;
create or replace function public.ops_incident_confirm(p_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v private.incidents;
  v_reason text;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_incident_decide', 300, interval '1 hour');
  v := private.incident_for_update(p_id);
  if v.state = 'voided' then
    raise exception 'a voided incident cannot be confirmed' using errcode = 'check_violation';
  elsif v.state = 'confirmed' then
    raise exception 'already confirmed' using errcode = 'check_violation';
  end if;
  v_reason := private.clean_text(p_reason, 3, 'confirming a strike');
  update private.incidents set state = 'confirmed', decided_by = auth.uid(), decided_at = now(), confirmed_at = now(),
         decision_reason = v_reason
   where id = p_id;
  if v.case_id is not null then
    perform private.case_event(v.case_id, 'action', v_reason, jsonb_build_object('action', 'strike_confirmed', 'incident', p_id));
  end if;
  perform private.log_ops('ops_incident_confirm', 'account', v.subject_id::text,
    jsonb_build_object('incident', p_id, 'state', v.state), jsonb_build_object('incident', p_id, 'state', 'confirmed'), v_reason);
end;
$$;
create or replace function public.ops_incident_void(p_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v private.incidents;
  v_reason text;
  v_appeal uuid;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_incident_decide', 300, interval '1 hour');
  v := private.incident_for_update(p_id);
  if v.state = 'voided' then
    raise exception 'already voided' using errcode = 'check_violation';
  end if;
  v_reason := private.clean_text(p_reason, 3, 'voiding a strike needs a reason;');
  update private.incidents set state = 'voided', decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason
   where id = p_id;
  if v.case_id is not null then
    perform private.case_event(v.case_id, 'action', v_reason, jsonb_build_object('action', 'strike_voided', 'incident', p_id));
  end if;
  select c.id into v_appeal from public.shipment_cases c
   where c.incident_id = p_id and c.kind = 'appeal' and c.status <> 'resolved' limit 1;
  if v_appeal is not null then
    perform private.case_event(v_appeal, 'action', v_reason, jsonb_build_object('action', 'strike_voided', 'incident', p_id));
  end if;
  perform private.log_ops('ops_incident_void', 'account', v.subject_id::text,
    jsonb_build_object('incident', p_id, 'state', v.state), jsonb_build_object('incident', p_id, 'state', 'voided'), v_reason);
end;
$$;
create or replace function public.my_record()
returns table (id uuid, kind text, weight smallint, state text, trip_id uuid, trip_route text,
               created_at timestamptz, decided_at timestamptz, appeal_open boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.kind, i.weight, i.state, i.trip_id,
         oc.name_en || ' → ' || dc.name_en, i.created_at, i.decided_at,
         exists (select 1 from public.shipment_cases c where c.incident_id = i.id and c.kind = 'appeal'
                  and c.status <> 'resolved')
    from private.incidents i
    left join public.trips t on t.id = i.trip_id
    left join public.loads l on l.id = t.load_id
    left join public.cities oc on oc.id = l.origin_city
    left join public.cities dc on dc.id = l.dest_city
   where auth.uid() is not null and i.subject_id = auth.uid()
     -- A suspicion voided before anyone confirmed it was never a strike.
     and (i.state = 'confirmed' or (i.state = 'voided' and i.confirmed_at is not null))
   order by i.created_at desc;
$$;
create or replace function public.appeal_incident(p_incident_id uuid, p_text text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v       private.incidents;
  v_text  text;
  v_load  uuid;
  v_case  uuid;
begin
  perform private.check_rate_limit('appeal_incident', 5, interval '1 hour');
  select * into v from private.incidents i where i.id = p_incident_id and i.subject_id = auth.uid() for update;
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  if v.state <> 'confirmed' then
    raise exception 'only a confirmed strike can be appealed' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.shipment_cases c where c.incident_id = v.id and c.kind = 'appeal' and c.status <> 'resolved') then
    raise exception 'an appeal is already open for this strike' using errcode = 'check_violation';
  end if;
  v_text := private.clean_text(p_text, 10, 'an appeal');
  select t.load_id into v_load from public.trips t where t.id = v.trip_id;
  insert into public.shipment_cases (load_id, trip_id, reporter_id, subject_id, kind, details, incident_id)
  values (v_load, v.trip_id, auth.uid(), auth.uid(), 'appeal', v_text, v.id)
  returning id into v_case;
  return v_case;
end;
$$;
create or replace function public.ops_nearby_drivers(p_load_id uuid)
returns table (rank bigint, driver_id uuid, driver_name text, phone text, truck_id uuid,
               deadhead_km numeric, strikes_30d integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  -- It returns phone numbers: bounded like the 0061 lookups.
  perform private.check_rate_limit('ops_nearby_drivers', 120, interval '1 hour');
  if not exists (select 1 from public.loads l where l.id = p_load_id) then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;
  return query
  select n.ord, n.driver_id, p.full_name, p.phone, n.truck_id, n.deadhead_km,
         private.strikes_30d(n.driver_id)
    from private.nearby_drivers(p_load_id, private.setting_int('dispatch_radius_km_3', 1500), true, 50)
         with ordinality n(driver_id, truck_id, deadhead_km, pending, ord)
    join public.profiles p on p.id = n.driver_id
   order by n.ord;
end;
$$;
CREATE OR REPLACE FUNCTION public.release_trip(p_trip_id uuid, p_reason_code text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_trip     public.trips;
  v_load     public.loads;
  v_note     text;
  v_weight   smallint := 1;
  v_incident uuid;
  v_case     uuid;
  v_label    text;
begin
  perform private.check_rate_limit('release_trip', 5, interval '1 day');
  select * into v_trip from public.trips t where t.id = p_trip_id and t.driver_id = v_uid for update;
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  if p_reason_code is null or p_reason_code not in ('breakdown', 'sick', 'family', 'wrong_load', 'too_far', 'other') then
    raise exception 'choose a reason' using errcode = 'check_violation';
  end if;
  if v_trip.status = 'in_transit'::public.trip_status then
    raise exception 'The cargo is on your truck. Report a problem instead, and we will help.' using errcode = 'check_violation';
  end if;
  if v_trip.status <> 'assigned'::public.trip_status then
    raise exception 'this job can no longer be released' using errcode = 'check_violation';
  end if;
  v_note := case when nullif(btrim(coalesce(p_note, '')), '') is null then null
                 else private.clean_text(p_note, 1, 'a note') end;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'a note is at most 500 characters' using errcode = 'check_violation';
  end if;
  select * into v_load from public.loads l where l.id = v_trip.load_id;
  v_label := private.release_reason_label(p_reason_code);

  perform private.cancel_trip_cascade(p_trip_id,
    'Released by the driver: ' || v_label || coalesce(' — ' || v_note, ''));

  -- Late = within late_release_hours of the start of the pickup day (Muscat).
  if now() >= (v_load.pickup_from::timestamp at time zone 'Asia/Muscat')
               - make_interval(hours => private.setting_int('late_release_hours', 12)) then
    v_weight := 2;
  end if;
  insert into private.incidents (subject_id, kind, weight, state, source, trip_id, reason,
                                 decided_at, confirmed_at, created_by)
  values (v_uid, 'release', v_weight, 'confirmed', 'release', p_trip_id, 'Released: ' || v_label,
          now(), now(), v_uid)
  returning id into v_incident;
  insert into public.shipment_cases (load_id, trip_id, reporter_id, subject_id, kind, details, incident_id)
  values (v_trip.load_id, p_trip_id, v_uid, v_uid, 'release',
          'Driver released the job: ' || v_label || coalesce(' — ' || v_note, ''), v_incident)
  returning id into v_case;
  update private.incidents set case_id = v_case where id = v_incident;

  -- Cities only on the lock screen (0046): no cargo, no names.
  perform private.push_send(v_load.shipper_id, 'shipper_driver_released', v_load.id,
    'Finding you another truck',
    'The driver for ' || private.push_route(v_load.id, 'en') || ' can''t make it. We are finding another truck now.',
    'نبحث لك عن شاحنة أخرى',
    'السائق المكلف بـ ' || private.push_route(v_load.id, 'ar') || ' لن يتمكن من الحضور. نبحث الآن عن شاحنة أخرى.',
    jsonb_build_object('kind', 'shipper_driver_released', 'load_id', v_load.id));
end;
$function$;

-- ═══ 4. detectors ════════════════════════════════════════════════════════════
update private.app_settings set value = '10'::jsonb where key = 'abandon_hours' and value = '6'::jsonb;
create or replace function private.ops_setting_spec()
returns table (key text, value_type text, label text, description text,
               min_value integer, max_value integer)
language sql
immutable
set search_path = ''
as $$
  values
    ('auto_dispatch_enabled', 'boolean', 'Automatic dispatch',
     'When on, a posted load is offered to nearby drivers with no human involved. When off, every load waits for a dispatcher. Nothing is lost — loads queue normally.',
     null::integer, null::integer),
    -- Since 0036 this is the WAVE size (dispatch_wave: v_size), not a per-load cap.
    ('auto_dispatch_max_offers', 'integer', 'Drivers asked per wave',
     'How many drivers each dispatch wave offers a load to. Every wave asks this many more, so higher fills faster and bothers more drivers.', 1, 20),
    ('auto_dispatch_max_pending_per_driver', 'integer', 'Live offers per driver',
     'How many unanswered offers one driver may hold. Stops one driver being buried.', 1, 20),
    ('auto_dispatch_requires_price', 'boolean', 'Only auto-dispatch priced loads',
     'When on, a load with no price waits for a dispatcher instead of being offered.', null, null),
    ('require_verified_driver', 'boolean', 'Only verified drivers may accept',
     'When on, an unverified driver cannot accept an offer or bid. The website claims "100% verified drivers"; this setting makes that true.', null, null),
    ('dispatch_wave_minutes', 'integer', 'Minutes per dispatch wave',
     'How long each group of drivers has to answer before the next group is asked.', 1, 60),
    -- At most 3: dispatch reads dispatch_radius_km_<wave> and only three exist; a
    -- fourth wave would silently search the 1500 km default.
    ('dispatch_max_waves', 'integer', 'Dispatch waves before a person is alerted',
     'After this many waves with no taker, a dispatcher is alerted. The machine keeps looking, as far as the last wave''s radius.', 1, 3),
    ('dispatch_radius_km_1', 'integer', 'First wave radius (km)',
     'How far from the pickup the first wave looks for drivers.', 10, 2000),
    ('dispatch_radius_km_2', 'integer', 'Second wave radius (km)',
     'How far the second wave looks.', 10, 2000),
    ('dispatch_radius_km_3', 'integer', 'Third wave radius (km)',
     'How far the third wave looks.', 10, 3000),
    ('dispatch_location_fresh_minutes', 'integer', 'GPS counts as fresh for (minutes)',
     'A driver''s last GPS point older than this is ignored and their town is used instead.', 5, 240),
    ('dispatch_rescue_enabled', 'boolean', 'Keep looking after the alert',
     'When on, a load nobody took is offered to any driver who comes online, until its collection date.', null, null),
    ('drivers_online_by_default', 'boolean', 'Drivers online unless they switch off',
     'When on, every driver is offered work unless they turn themselves off.', null, null),
    ('bid_window_minutes', 'integer', 'Bidding window (minutes)',
     'How long a bid load takes bids before the shipper chooses.', 10, 1440),
    ('bid_wave_minutes', 'integer', 'Minutes between bid invitations',
     'How often more drivers are invited to bid.', 1, 60),
    ('bid_invites_per_wave', 'integer', 'Drivers invited per wave',
     'How many drivers each bid invitation wave reaches.', 1, 20),
    ('bid_enough_bids', 'integer', 'Bids that are enough',
     'Once a load has this many bids, no more drivers are invited.', 1, 20),
    ('push_enabled', 'boolean', 'Push notifications',
     'When off, the database sends no push notifications at all. The kill switch for a bad push.', null, null),
    ('stuck_alert_minutes', 'integer', 'Stuck-load alert (minutes)',
     'A load waiting this long with nobody on it alerts a person.', 5, 240),
    -- 0062: support desk response times.
    ('case_sla_urgent_minutes', 'integer', 'Urgent case: answer within (minutes)',
     'An urgent case (breakdown, abandoned trip, no-show, misconduct) is overdue after this long.', 5, 240),
    ('case_sla_high_minutes', 'integer', 'High-priority case: answer within (minutes)',
     'A high-priority case (damage, dispute, delay, cancellation) is overdue after this long.', 15, 1440),
    ('case_sla_normal_minutes', 'integer', 'Normal case: answer within (minutes)',
     'Any other case is overdue after this long. Changing these does not move deadlines already set.', 60, 10080),
    -- 0063: strikes and the detectors.
    ('strike_suspend_threshold', 'integer', 'Strike points before suspension is suggested',
     'Strikes weigh 1 to 3 points (an abandoned load is 3). When a driver''s points in the last 30 days reach this, the console suggests suspending them. Staff decide.', 1, 20),
    ('dispatch_deprioritise_strikes', 'boolean', 'Offer work to drivers with strikes last',
     'When on, drivers with strikes in the last 30 days are asked after every driver without strikes in the same search — even ones further away. They are still asked. Declared empty legs are matched first either way.', null, null),
    ('no_show_hour', 'integer', 'No-show check, hour of the last pickup day (Muscat)',
     'An accepted trip not started by this hour on the last day of its pickup window is flagged as a possible no-show for a person to check.', 8, 23),
    ('abandon_hours', 'integer', 'Possible abandonment after (hours of silence)',
     'A truck on the road with no event or GPS for this long is flagged as possibly abandoned, for a person to check. Leave room for a night''s sleep and a border queue.', 2, 48),
    ('late_release_hours', 'integer', 'Late release, within (hours of pickup)',
     'A driver who releases a job this close to the pickup day gets a heavier strike.', 1, 72)
$$;
create or replace function private.system_detect_no_shows()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hour integer := private.setting_int('no_show_hour', 14);
  v_n    integer := 0;
  r      record;
begin
  for r in
    select t.id, t.driver_id
      from public.trips t join public.loads l on l.id = t.load_id
     where t.status = 'assigned'::public.trip_status
       -- Two hours' grace from when THIS driver got the trip (reset on reassign),
       -- and only on the LAST day of the pickup window.
       and t.assigned_at < now() - interval '2 hours'
       and now() > ((l.pickup_to::timestamp + make_interval(hours => v_hour)) at time zone 'Asia/Muscat')
       and not exists (select 1 from public.shipment_cases c
                        where c.trip_id = t.id and c.kind = 'no_show' and c.status <> 'resolved')
  loop
    if private.flag_trip(r.id, r.driver_id, 'no_show', 'no_show',
         format('Detected: the trip was accepted but not started by %s:00 on the last pickup day.', v_hour)) then
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then
    perform private.log_system('system_detect_no_shows', 'system', null, jsonb_build_object('flagged', v_n));
  end if;
  return v_n;
end;
$$;
create or replace function private.system_detect_abandoned()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hours integer := private.setting_int('abandon_hours', 6);
  v_n     integer := 0;
  r       record;
begin
  for r in
    select t.id, t.driver_id
      from public.trips t
     where t.status = 'in_transit'::public.trip_status
       and greatest(t.created_at,
                    (select max(e.occurred_at) from public.trip_events e where e.trip_id = t.id),
                    (select max(p.seen_at) from public.trip_positions p where p.trip_id = t.id))
           < now() - make_interval(hours => v_hours)
       -- A driver who already told us what is wrong has not abandoned anything.
       and not exists (select 1 from public.shipment_cases c
                        where c.trip_id = t.id and c.status <> 'resolved' and c.reporter_id = t.driver_id)
  loop
    if private.flag_trip(r.id, r.driver_id, 'abandoned', 'abandoned',
         format('Detected: no event and no GPS from the truck for over %s hours while carrying the load.', v_hours)) then
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then
    perform private.log_system('system_detect_abandoned', 'system', null, jsonb_build_object('flagged', v_n));
  end if;
  return v_n;
end;
$$;
create or replace function private.system_detect_returning()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  r   record;
begin
  for r in
    select distinct on (n.id) n.id, s.full_name as matched_name,
           case when private.phone_key(n.phone) = private.phone_key(s.phone) then 'phone number' else 'truck plate' end as what
      from public.profiles n
      join public.profiles s on s.suspended_at is not null and s.id <> n.id
     where n.created_at > now() - interval '2 days'
       and n.suspended_at is null
       and ((length(private.phone_key(n.phone)) >= 10 and private.phone_key(n.phone) = private.phone_key(s.phone))
            or exists (select 1 from public.trucks nt join public.trucks st on st.owner_id = s.id
                        where nt.owner_id = n.id and length(regexp_replace(coalesce(nt.plate, ''), '\s', '', 'g')) >= 4
                          and upper(regexp_replace(nt.plate, '\s', '', 'g')) = upper(regexp_replace(st.plate, '\s', '', 'g'))))
       and not exists (select 1 from public.shipment_cases c where c.kind = 'account_flag' and c.subject_id = n.id)
     order by n.id
  loop
    insert into public.shipment_cases (reporter_id, subject_id, kind, details)
    values (null, r.id, 'account_flag',
            format('Detected: this new account has the same %s as the suspended account of %s. Check before they are offered work — families share phones and trucks change hands.',
                   r.what, coalesce(r.matched_name, 'someone')));
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    perform private.log_system('system_detect_returning', 'system', null, jsonb_build_object('flagged', v_n));
  end if;
  return v_n;
end;
$$;
create or replace function private.system_detect_trouble()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- One detector failing must not stop the other.
  begin
    perform private.system_detect_no_shows();
  exception when others then
    perform private.log_system('system_detect_error', 'system', 'no_shows', jsonb_build_object('error', sqlerrm));
  end;
  begin
    perform private.system_detect_abandoned();
  exception when others then
    perform private.log_system('system_detect_error', 'system', 'abandoned', jsonb_build_object('error', sqlerrm));
  end;
end;
$$;
-- ═══ 5. playbooks and resolving ══════════════════════════════════════════════
create or replace function public.ops_case_redispatch(p_case_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.shipment_cases;
  v_reason text;
begin
  perform private.require_ops();
  v := private.case_for_update(p_case_id);
  v_reason := private.clean_text(p_reason, 3, 'sending a load back');
  if v.trip_id is null or not exists (select 1 from public.trips t where t.id = v.trip_id
       and t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)) then
    raise exception 'this case has no trip still on the road' using errcode = 'check_violation';
  end if;
  -- With the cargo on the truck, searching again from the origin strands it.
  if exists (select 1 from public.trips t where t.id = v.trip_id and t.status = 'in_transit'::public.trip_status) then
    raise exception 'The cargo is on the truck: give the trip to another driver instead.' using errcode = 'check_violation';
  end if;
  -- An awarded bid load is the shipper's chosen price; it goes back through bidding (0053), not dispatch.
  if exists (select 1 from public.loads l where l.id = v.load_id and l.pricing_mode = 'bid') then
    raise exception 'A bid load goes back through bidding, not dispatch.' using errcode = 'check_violation';
  end if;
  -- The validated transition: offers expire, the leg reopens, the load looks
  -- for a truck again, and rescue (0037) re-offers it.
  -- The trip timeline is shown to the driver and shipper: it gets a plain
  -- statement; the staff reason stays in the case and the audit.
  perform public.ops_set_trip_status(v.trip_id, 'cancelled'::public.trip_status, 'Sent back to dispatch by Truckkoo');
  perform private.case_event(p_case_id, 'action', v_reason, jsonb_build_object('action', 'redispatched', 'trip', v.trip_id));
  perform private.log_ops('ops_case_redispatch', 'shipment_case', p_case_id::text, null,
    jsonb_build_object('trip', v.trip_id), v_reason);
end;
$$;
create or replace function public.ops_case_reassign(p_case_id uuid, p_driver_id uuid, p_truck_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.shipment_cases;
  v_reason text;
  v_from   uuid;
begin
  perform private.require_ops();
  v := private.case_for_update(p_case_id);
  v_reason := private.clean_text(p_reason, 3, 'giving the trip to another driver');
  if v.trip_id is null then
    raise exception 'this case has no trip' using errcode = 'check_violation';
  end if;
  select t.driver_id into v_from from public.trips t where t.id = v.trip_id;
  perform public.ops_reassign_trip(v.trip_id, p_driver_id, p_truck_id, 'Given to another driver by Truckkoo');
  perform private.case_event(p_case_id, 'action', v_reason,
    jsonb_build_object('action', 'reassigned', 'trip', v.trip_id, 'from', v_from, 'to', p_driver_id));
  perform private.log_ops('ops_case_reassign', 'shipment_case', p_case_id::text,
    jsonb_build_object('driver', v_from), jsonb_build_object('driver', p_driver_id, 'trip', v.trip_id), v_reason);
end;
$$;
create or replace function public.ops_case_cancel_load(p_case_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.shipment_cases;
  v_reason text;
begin
  perform private.require_ops();
  v := private.case_for_update(p_case_id);
  v_reason := private.clean_text(p_reason, 3, 'cancelling a load');
  if v.load_id is null then
    raise exception 'this case has no load' using errcode = 'check_violation';
  end if;
  perform public.ops_set_load_status(v.load_id, 'cancelled'::public.load_status, 'Cancelled by Truckkoo');
  perform private.case_event(p_case_id, 'action', v_reason, jsonb_build_object('action', 'load_cancelled', 'load', v.load_id));
  perform private.log_ops('ops_case_cancel_load', 'shipment_case', p_case_id::text, null,
    jsonb_build_object('load', v.load_id), v_reason);
end;
$$;
create or replace function public.ops_case_resolve(p_case_id uuid, p_outcome text, p_resolution text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.shipment_cases;
  v_text text;
begin
  perform private.require_ops();
  v := private.case_for_update(p_case_id);
  if p_outcome is null or p_outcome not in ('redispatched', 'reassigned', 'driver_warned', 'shipper_informed',
                                            'no_fault', 'resolved_by_parties', 'duplicate', 'not_actionable', 'other') then
    raise exception 'unknown outcome' using errcode = 'check_violation';
  end if;
  if v.status = 'resolved' then
    raise exception 'case already resolved' using errcode = 'check_violation';
  end if;
  -- A suspected strike left undecided would sit forever: decide it first.
  if exists (select 1 from private.incidents i where i.id = v.incident_id and i.state = 'suspected') then
    raise exception 'decide the case''s strike first — confirm it or void it' using errcode = 'check_violation';
  end if;
  perform private.check_rate_limit('ops_case_write', 600, interval '1 hour');
  v_text := private.clean_text(p_resolution, 10, 'a resolution');
  update public.shipment_cases set status = 'resolved', outcome = p_outcome, resolution = v_text,
         resolved_by = auth.uid(), resolved_at = now()
   where id = p_case_id;
  perform private.case_event(p_case_id, 'resolved', v_text, jsonb_build_object('outcome', p_outcome));
  perform private.log_ops('ops_case_resolve', 'shipment_case', p_case_id::text,
    jsonb_build_object('status', v.status), jsonb_build_object('status', 'resolved', 'outcome', p_outcome), v_text);
end;
$$;
-- ═══ 6. the live board ═══════════════════════════════════════════════════════
create or replace function public.ops_board()
returns table (kind text, target_kind text, target_id text, title text, reason text,
               age_minutes integer, urgency integer, action text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Muscat')::date;
begin
  perform private.require_ops();

  return query
  with route as (
    select l.id, l.status, l.pricing_mode, l.pickup_to, l.bid_deadline, l.selected_bid_id,
           l.created_at, l.accepted_at,
           o.name_en || ' → ' || d.name_en as title
      from public.loads l
      join public.cities o on o.id = l.origin_city
      join public.cities d on d.id = l.dest_city
  ),
  rows as (
    -- A load nobody has taken.
    select 'finding_truck'::text as kind, 'load'::text as target_kind, r.id::text as target_id, r.title,
           (extract(epoch from now() - coalesce(r.accepted_at, r.created_at)) / 60)::integer as age_minutes,
           case when r.pickup_to <= v_today + 1 then 4 else 3 end as urgency,
           'Finding a truck for %s'::text as reason_fmt,
           'Send an offer'::text as action
      from route r
     where r.status = 'finding_truck'::public.load_status and r.pickup_to >= v_today

    union all
    -- An auction with nobody bidding.
    select 'bid_no_bids', 'load', r.id::text, r.title,
           (extract(epoch from now() - r.created_at) / 60)::integer,
           case when r.bid_deadline <= now() + interval '15 minutes' then 4 else 2 end,
           'No bids yet, closes in ' || private.ops_ago(greatest(0, (extract(epoch from r.bid_deadline - now()) / 60)::integer)),
           'Extend bidding or call drivers'
      from route r
     where r.pricing_mode = 'bid'
       and r.status in ('posted'::public.load_status, 'matched'::public.load_status)
       and r.selected_bid_id is null
       and r.bid_deadline > now()
       and not exists (select 1 from private.driver_bids b where b.load_id = r.id)

    union all
    -- The machine has had it 15 minutes and found nobody.
    select 'machine_stuck', 'load', r.id::text, r.title,
           (extract(epoch from now() - r.accepted_at) / 60)::integer,
           3,
           'Searching automatically for %s',
           'Take it in hand'
      from route r
     where r.accepted_at < now() - interval '15 minutes'
       and r.status not in ('finding_truck'::public.load_status, 'assigned'::public.load_status,
                            'in_transit'::public.load_status, 'delivered'::public.load_status,
                            'closed'::public.load_status, 'cancelled'::public.load_status)
       and private.machine_owns(r.id)
       and not exists (select 1 from public.trips t where t.load_id = r.id and t.status <> 'cancelled'::public.trip_status)

    union all
    -- A truck on the road that has gone silent: no event and no position.
    select 'trip_quiet', 'trip', t.id::text, r.title,
           (extract(epoch from now() - s.last_sign) / 60)::integer,
           3,
           'No sign of life for %s',
           'Call the driver'
      from public.trips t
      join route r on r.id = t.load_id
      cross join lateral (
        select greatest(
                 t.created_at,
                 (select max(e.occurred_at) from public.trip_events e where e.trip_id = t.id),
                 (select max(p.seen_at) from public.trip_positions p where p.trip_id = t.id)) as last_sign
      ) s
     where t.status = 'in_transit'::public.trip_status
       and s.last_sign < now() - interval '3 hours'

    union all
    -- Delivered, but nobody photographed it.
    select 'no_pod', 'trip', t.id::text, r.title,
           (extract(epoch from now() - coalesce(
              (select max(e.occurred_at) from public.trip_events e where e.trip_id = t.id), t.created_at)) / 60)::integer,
           1,
           'Delivered %s ago with no photo',
           'Ask for the delivery photo'
      from public.trips t
      join route r on r.id = t.load_id
     where t.status = 'delivered'::public.trip_status
       and not exists (select 1 from public.trip_events e where e.trip_id = t.id and e.photo_path is not null)

    union all
    -- A driver's documents waiting for review (0050), oldest first.
    select 'docs_pending', 'driver', dd.driver_id::text, coalesce(p.full_name, 'Unnamed driver'),
           (extract(epoch from now() - min(dd.created_at)) / 60)::integer,
           2,
           case when count(*) = 1 then '1 document' else count(*) || ' documents' end || ' waiting for %s',
           'Review documents'
      from public.driver_documents dd
      join public.profiles p on p.id = dd.driver_id
     where dd.status = 'pending'
     group by dd.driver_id, p.full_name

    union all
    -- 0062: a support case past its response time.
    select 'case_overdue', 'case', c.id::text,
           initcap(replace(c.kind, '_', ' ')) || coalesce(' · ' || r.title, ''),
           (extract(epoch from now() - c.due_at) / 60)::integer,
           case when c.priority = 'urgent' then 5 else 4 end,
           'Overdue by %s',
           case when c.assignee_id is null then 'Take it' else 'Chase it' end
      from public.shipment_cases c
      left join route r on r.id = c.load_id
     where c.status <> 'resolved' and c.responded_at is null and c.due_at < now()

    union all
    -- 0062: an urgent case nobody has picked up yet (not yet overdue).
    select 'case_urgent_new', 'case', c.id::text,
           initcap(replace(c.kind, '_', ' ')) || coalesce(' · ' || r.title, ''),
           (extract(epoch from now() - c.created_at) / 60)::integer,
           4,
           'Urgent, opened %s ago',
           'Take it'
      from public.shipment_cases c
      left join route r on r.id = c.load_id
     where c.status = 'new' and c.priority = 'urgent' and c.responded_at is null and c.due_at >= now()

    union all
    -- 0064: a strike someone suspects and nobody has decided, with no case
    -- of its own to carry it (a detector's finding comes with a case).
    select 'incident_to_review', 'incident', i.id::text,
           coalesce(p.full_name, 'Someone') || ' — ' || replace(i.kind, '_', ' '),
           (extract(epoch from now() - i.created_at) / 60)::integer,
           3,
           'Flagged %s ago',
           'Confirm or void'
      from private.incidents i
      join public.profiles p on p.id = i.subject_id
     where i.state = 'suspected'
       and (i.case_id is null
            or exists (select 1 from public.shipment_cases c where c.id = i.case_id and c.status = 'resolved'))

    union all
    -- An alert from the last day nobody has acknowledged.
    select 'alert', 'alert', a.id::text, initcap(replace(a.kind, '_', ' ')),
           (extract(epoch from now() - a.created_at) / 60)::integer,
           2,
           'Raised %s ago',
           'Acknowledge'
      from private.ops_alerts a
     where a.created_at > now() - interval '24 hours'
       and a.acknowledged_at is null
  )
  select x.kind, x.target_kind, x.target_id, x.title,
         case when x.reason_fmt like '%\%s%' then replace(x.reason_fmt, '%s', private.ops_ago(x.age_minutes))
              else x.reason_fmt end,
         x.age_minutes, x.urgency, x.action
    from rows x
   order by x.urgency desc, x.age_minutes desc;
end;
$$;

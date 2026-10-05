-- 0058 · Ops console v2: the bidding board and the driver verification view.
--
-- Founder, 2026-10-05: full bidding visibility in ops; any staff member may
-- review documents and verify drivers and trucks. These are READS only — every
-- decision still goes through 0050's ops_review_driver_document,
-- ops_verify_truck and ops_verify_driver, so there is one approval path.

-- ═══ 1. the bidding board ════════════════════════════════════════════════════
create or replace function public.ops_bidding_board(p_include_closed boolean default true)
returns table (load_id uuid, route text, shipper_name text, created_at timestamptz,
               bid_deadline timestamptz, minutes_left integer, state text, bids integer,
               lowest_total_baisa bigint, lowest_driver text, target_total_baisa bigint,
               fee_bps integer, awarded_total_baisa bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  return query
  with b as (
    select l.id, o.name_en || ' → ' || d.name_en as route, sp.full_name as shipper_name,
           l.created_at, l.bid_deadline, l.selected_bid_id, l.status, l.price_baisa,
           bl.fee_bps, bl.target_total_baisa,
           (select count(*)::integer from private.driver_bids x where x.load_id = l.id) as bids,
           low.payout_baisa as low_payout, low.driver_name as low_driver
      from public.loads l
      join private.bid_loads bl on bl.load_id = l.id
      join public.cities o on o.id = l.origin_city
      join public.cities d on d.id = l.dest_city
      join public.profiles sp on sp.id = l.shipper_id
      left join lateral (
        select x.payout_baisa, p.full_name as driver_name
          from private.driver_bids x join public.profiles p on p.id = x.driver_id
         where x.load_id = l.id order by x.payout_baisa, x.created_at limit 1) low on true
     where l.pricing_mode = 'bid'
       and l.status <> 'cancelled'::public.load_status
  ),
  s as (
    select b.*,
           case
             when b.selected_bid_id is not null then 'awarded'
             when b.bid_deadline <= now() then 'closed_no_bid'
             when b.bid_deadline <= now() + interval '15 minutes' then 'closing_soon'
             when b.bids = 0 then 'no_bids'
             else 'taking_bids'
           end as state
      from b
  )
  select s.id, s.route, s.shipper_name, s.created_at, s.bid_deadline,
         greatest(0, (extract(epoch from s.bid_deadline - now()) / 60)::integer),
         s.state, s.bids,
         case when s.low_payout is null then null else private.bid_total(s.low_payout, s.fee_bps) end,
         s.low_driver, s.target_total_baisa, s.fee_bps,
         case when s.selected_bid_id is not null then s.price_baisa end
    from s
   where s.state in ('no_bids', 'taking_bids', 'closing_soon')
      or (p_include_closed and s.bid_deadline > now() - interval '24 hours')
   order by case s.state when 'closing_soon' then case when s.bids = 0 then 0 else 1 end
                         when 'no_bids' then 2 when 'taking_bids' then 3 else 4 end,
            s.bid_deadline;
end;
$$;
revoke all on function public.ops_bidding_board(boolean) from public, anon;
grant execute on function public.ops_bidding_board(boolean) to authenticated;

-- ═══ 2. who is waiting for verification ═════════════════════════════════════
-- With no id: drivers needing a person (a pending document, or everything
-- approved and not yet verified). With an id: that driver, whatever the state.
create or replace function public.ops_verification_status(p_driver_id uuid default null)
returns table (driver_id uuid, full_name text, phone text, signed_up_at timestamptz, docs jsonb,
               pending integer, approved integer, rejected integer,
               truck_id uuid, truck_type text, plate text, capacity_kg integer,
               truck_verified boolean, driver_verified boolean,
               ready_truck boolean, ready_driver boolean, oldest_pending_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  if p_driver_id is not null and not exists (
    select 1 from public.profiles p where p.id = p_driver_id and p.role = 'driver'::public.user_role) then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  return query
  with v as (
    select p.id, p.full_name, p.phone, p.created_at,
           coalesce((select jsonb_agg(jsonb_build_object('id', dd.id, 'kind', dd.kind, 'status', dd.status,
                                                         'review_note', dd.review_note, 'created_at', dd.created_at,
                                                         'object_path', dd.object_path) order by dd.kind)
                       from public.driver_documents dd where dd.driver_id = p.id), '[]'::jsonb) as docs,
           (select count(*)::integer from public.driver_documents dd where dd.driver_id = p.id and dd.status = 'pending') as pending,
           (select count(*)::integer from public.driver_documents dd where dd.driver_id = p.id and dd.status = 'approved') as approved,
           (select count(*)::integer from public.driver_documents dd where dd.driver_id = p.id and dd.status = 'rejected') as rejected,
           (select count(*)::integer from public.driver_documents dd where dd.driver_id = p.id and dd.status = 'approved'
              and dd.kind in ('mulkiya', 'truck_photo')) as truck_docs,
           (select min(dd.created_at) from public.driver_documents dd where dd.driver_id = p.id and dd.status = 'pending') as oldest,
           t.id as truck_id, t.truck_type, t.plate, t.capacity_kg, t.verified_at is not null as truck_verified,
           coalesce((select dr.verified_at is not null from public.drivers dr where dr.profile_id = p.id), false) as driver_verified
      from public.profiles p
      left join lateral (select * from public.trucks tk where tk.owner_id = p.id order by tk.created_at desc limit 1) t on true
     where p.role = 'driver'::public.user_role
       and (p_driver_id is null or p.id = p_driver_id)
  )
  select v.id, v.full_name, v.phone, v.created_at, v.docs, v.pending, v.approved, v.rejected,
         v.truck_id, v.truck_type, v.plate, v.capacity_kg, v.truck_verified, v.driver_verified,
         v.truck_docs = 2 and not v.truck_verified and v.plate is not null and v.capacity_kg is not null,
         v.approved = 4 and v.truck_verified and not v.driver_verified,
         v.oldest
    from v
   where p_driver_id is not null
      or v.pending > 0
      or (v.approved = 4 and not v.driver_verified)
   order by v.oldest nulls last, v.created_at;
end;
$$;
revoke all on function public.ops_verification_status(uuid) from public, anon;
grant execute on function public.ops_verification_status(uuid) to authenticated;

-- ═══ 3. the live board learns about documents ════════════════════════════════
-- 0055's ops_board, unchanged except for the docs_pending branch.
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
       and not exists (select 1 from public.trips t where t.load_id = r.id)

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
revoke all on function public.ops_board() from public, anon;
grant execute on function public.ops_board() to authenticated;

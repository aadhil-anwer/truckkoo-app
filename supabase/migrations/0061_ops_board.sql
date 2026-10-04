-- 0061 · Ops console v2, phase 2: the live board.
--
-- Spec: ~/truckkoo-ops/docs/superpowers/specs/2026-10-05-ops-console-v2-design.md
-- §5.2 and §6.1. The board is composed here, in SQL, so the console only draws
-- it: what needs a person now, why, and what to do. Every reader opens with
-- require_ops(), which since 0060 also requires two-step sign-in.

-- ═══ 1. alerts can be acknowledged ═══════════════════════════════════════════

alter table private.ops_alerts
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by uuid;

-- Idempotent: two dispatchers acknowledging the same alert is one act, one
-- audit row, and no error for the second.
create or replace function public.ops_ack_alert(p_alert_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform private.require_ops();
  if not exists (select 1 from private.ops_alerts a where a.id = p_alert_id) then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  update private.ops_alerts a
     set acknowledged_at = now(), acknowledged_by = (select auth.uid())
   where a.id = p_alert_id and a.acknowledged_at is null
  returning a.id into v_id;
  if v_id is not null then
    perform private.log_ops('ops_ack_alert', 'alert', v_id::text, null, null, null);
  end if;
end;
$$;
revoke all on function public.ops_ack_alert(bigint) from public, anon;
grant execute on function public.ops_ack_alert(bigint) to authenticated;

-- ═══ 2. the queue ═══════════════════════════════════════════════════════════

-- "2 h 10 min" — the board's only unit of time.
create or replace function private.ops_ago(p_minutes integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_minutes < 60 then p_minutes || ' min'
    when p_minutes < 1440 then (p_minutes / 60) || ' h ' || (p_minutes % 60) || ' min'
    else (p_minutes / 1440) || ' d ' || ((p_minutes % 1440) / 60) || ' h'
  end;
$$;
revoke all on function private.ops_ago(integer) from public, anon, authenticated;

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

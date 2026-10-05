-- Participant reports and cancellation requests are durable work for dispatch.
-- The underlying table is never client-readable, including by its reporter.
create table public.shipment_cases (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.loads(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete set null,
  reporter_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('delay', 'breakdown', 'damage', 'other', 'cancel_request')),
  details text not null check (char_length(details) between 10 and 1000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint shipment_cases_resolution_len check (resolution is null or char_length(resolution) <= 1000)
);
revoke all on public.shipment_cases from public, anon, authenticated;
alter table public.shipment_cases enable row level security;
alter table public.shipment_cases force row level security;
create index shipment_cases_queue_idx on public.shipment_cases(status, created_at) where status = 'open';
create index shipment_cases_load_idx on public.shipment_cases(load_id, created_at desc);

create or replace function public.report_shipment_problem(
  p_load_id uuid, p_trip_id uuid, p_kind text, p_details text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_load_id uuid; v_case_id uuid;
begin
  perform private.check_rate_limit('report_shipment_problem', 10, interval '1 hour');
  if v_uid is null or p_kind not in ('delay', 'breakdown', 'damage', 'other')
     or p_details is null or char_length(btrim(p_details)) not between 10 and 1000
     or private.contains_unsafe_text(p_details)
  then raise exception 'invalid report' using errcode = 'check_violation'; end if;

  if p_trip_id is not null then
    select t.load_id into v_load_id from public.trips t
    join public.loads l on l.id = t.load_id
    where t.id = p_trip_id and (t.driver_id = v_uid or l.shipper_id = v_uid)
      and (p_load_id is null or p_load_id = l.id);
  else
    select l.id into v_load_id from public.loads l
    where l.id = p_load_id and l.shipper_id = v_uid;
  end if;
  if v_load_id is null then raise exception 'shipment not found' using errcode = 'no_data_found'; end if;
  insert into public.shipment_cases(load_id, trip_id, reporter_id, kind, details)
  values (v_load_id, p_trip_id, v_uid, p_kind, btrim(p_details)) returning id into v_case_id;
  return v_case_id;
end $$;
revoke all on function public.report_shipment_problem(uuid, uuid, text, text) from public, anon;
grant execute on function public.report_shipment_problem(uuid, uuid, text, text) to authenticated;

-- Unassigned loads can be cancelled immediately. Once a driver has a trip, a
-- human resolves the request to avoid silently abandoning cargo in transit.
create or replace function public.request_load_cancellation(p_load_id uuid, p_reason text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_load public.loads; v_trip uuid;
begin
  perform private.check_rate_limit('request_load_cancellation', 5, interval '1 hour');
  if auth.uid() is null or p_reason is null or char_length(btrim(p_reason)) not between 10 and 1000
     or private.contains_unsafe_text(p_reason)
  then raise exception 'invalid request' using errcode = 'check_violation'; end if;
  select l.* into v_load from public.loads l
  where l.id = p_load_id and l.shipper_id = auth.uid() for update;
  if v_load.id is null then raise exception 'shipment not found' using errcode = 'no_data_found'; end if;
  if v_load.status in ('cancelled', 'delivered', 'closed')
  then raise exception 'shipment cannot be cancelled' using errcode = 'check_violation'; end if;
  select t.id into v_trip from public.trips t where t.load_id = p_load_id
    and t.status not in ('cancelled', 'closed');
  if v_trip is not null or v_load.status in ('assigned', 'in_transit') then
    insert into public.shipment_cases(load_id, trip_id, reporter_id, kind, details)
    values (p_load_id, v_trip, auth.uid(), 'cancel_request', btrim(p_reason));
    return false;
  end if;

  update public.offers set status = 'expired' where load_id = p_load_id
    and status in ('pending', 'accepted');
  update public.loads set status = 'cancelled' where id = p_load_id;
  insert into public.shipment_cases(load_id, reporter_id, kind, details, status,
                                    resolution, resolved_at)
  values (p_load_id, auth.uid(), 'cancel_request', btrim(p_reason), 'resolved',
          'Cancelled before driver assignment', now());
  return true;
end $$;
revoke all on function public.request_load_cancellation(uuid, text) from public, anon;
grant execute on function public.request_load_cancellation(uuid, text) to authenticated;

create or replace function public.my_shipment_cases(p_load_id uuid)
returns table(id uuid, kind text, details text, status text, resolution text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.kind, c.details, c.status, c.resolution, c.created_at
  from public.shipment_cases c join public.loads l on l.id = c.load_id
  left join public.trips t on t.id = c.trip_id
  where c.load_id = p_load_id and c.reporter_id = (select auth.uid())
    and (l.shipper_id = auth.uid() or t.driver_id = auth.uid())
  order by c.created_at desc;
$$;
revoke all on function public.my_shipment_cases(uuid) from public, anon;
grant execute on function public.my_shipment_cases(uuid) to authenticated;

-- Cross-tenant queue: explicitly approved, guarded before the first read.
create or replace function public.ops_shipment_cases(p_open_only boolean default true)
returns table(id uuid, load_id uuid, trip_id uuid, reporter_id uuid,
              reporter_name text, kind text, details text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_ops();
  return query select c.id, c.load_id, c.trip_id, c.reporter_id,
    p.full_name, c.kind, c.details, c.status, c.created_at
  from public.shipment_cases c join public.profiles p on p.id = c.reporter_id
  where not p_open_only or c.status = 'open'
  order by c.created_at asc limit 200;
end $$;
revoke all on function public.ops_shipment_cases(boolean) from public, anon;
grant execute on function public.ops_shipment_cases(boolean) to authenticated;

create or replace function public.ops_resolve_shipment_case(p_case_id uuid, p_resolution text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_before jsonb;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_resolve_shipment_case', 200, interval '1 hour');
  if p_resolution is null or char_length(btrim(p_resolution)) not between 10 and 1000
     or private.contains_unsafe_text(p_resolution)
  then raise exception 'resolution needs details' using errcode = 'check_violation'; end if;
  select to_jsonb(c) into v_before from public.shipment_cases c
  where c.id = p_case_id and c.status = 'open' for update;
  if v_before is null then raise exception 'case not found' using errcode = 'no_data_found'; end if;
  update public.shipment_cases set status = 'resolved', resolution = btrim(p_resolution),
    resolved_by = auth.uid(), resolved_at = now() where id = p_case_id;
  perform private.log_ops('ops_resolve_shipment_case', 'shipment_case', p_case_id::text,
    v_before, (select to_jsonb(c) from public.shipment_cases c where c.id = p_case_id), p_resolution);
end $$;
revoke all on function public.ops_resolve_shipment_case(uuid, text) from public, anon;
grant execute on function public.ops_resolve_shipment_case(uuid, text) to authenticated;

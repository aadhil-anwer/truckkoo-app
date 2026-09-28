-- 0038 · Every driver is online unless they switch off.
--
-- The founder's call, 2026-09-28: "keep everyone's switch default on". 0036
-- copied Uber — offered only while you say you're working, and twelve idle hours
-- switch you off. In practice a driver who had not flipped the switch that day
-- was offered nothing, and the investor's demo load missed him by a minute.
--
-- Now:
--   * every driver has an availability row, ON — existing drivers here, new
--     ones from the moment their profile is created;
--   * the twelve-hour auto-off does nothing;
--   * a driver who switches OFF stays off, and a job still takes them out of
--     every wave (`nearby_drivers` checks trips, whatever the switch says).
--
-- Accepted cost: with no push notifications yet, offers reach drivers who are
-- not looking at the app. They lapse after five minutes and the search moves on,
-- so a wave spent on them delays a load; it never strands one.
--
-- One row reverses it:
--   update private.app_settings set value = 'false' where key = 'drivers_online_by_default';

insert into private.app_settings (key, value) values
  ('drivers_online_by_default', 'true'::jsonb)
on conflict (key) do nothing;

-- A new driver starts online. The town is unknown until they switch on with
-- GPS or finish a delivery, so until then they are reached by the widest wave
-- and by `system_rescue_stranded` (both include drivers with no town).
create or replace function private.driver_default_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'driver' and private.setting_bool('drivers_online_by_default', true) then
    insert into public.driver_availability (driver_id, available, source, updated_at)
    values (new.id, true, 'manual', now())
    on conflict (driver_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.driver_default_availability() from public, anon, authenticated;

drop trigger if exists driver_default_availability on public.profiles;
create trigger driver_default_availability
  after insert on public.profiles
  for each row execute function private.driver_default_availability();

-- 0036's job, with the switch in front of it.
create or replace function private.system_expire_availability()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if private.setting_bool('drivers_online_by_default', true) then
    return 0;
  end if;

  update public.driver_availability
     set available = false, updated_at = now()
   where available and updated_at < now() - interval '12 hours';
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform private.log_system('system_expire_availability', 'system', 'driver_availability',
                               jsonb_build_object('turned_off', v_count));
  end if;
  return v_count;
end;
$$;

revoke all on function private.system_expire_availability() from public, anon, authenticated;

-- Everyone on now — except a driver on a job, whom the trip trigger keeps off
-- and who comes back on at delivery. The town each row already has is kept.
insert into public.driver_availability (driver_id, available, source, updated_at)
select p.id, true, 'manual', now()
from public.profiles p
where p.role = 'driver'
on conflict (driver_id) do update
  set available = true, updated_at = now();

update public.driver_availability da
   set available = false
 where exists (
   select 1 from public.trips t
   where t.driver_id = da.driver_id
     and t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status));

-- 0074 · A new job reaches a driver like a ride request: at once, with the
-- route, the kilometres and the fare, and an answer within a minute.
--
-- Founder's call, 2026-10-08:
--   * Before accepting, a driver sees the towns, the trip km, how far the
--     pickup is from them, and the fare. The exact pins, place names, notes and
--     contacts come only with the job (driver_trip). This reverses 0041, which
--     showed them on every open offer — so every driver who was asked and said
--     no learned where the shipper was, and their phone number.
--   * A driver has 60 seconds to answer (`offer_answer_seconds`), then the
--     search moves on. Waves still widen every `dispatch_wave_minutes` and a
--     person is still alerted after `dispatch_max_waves` of them: how long a
--     driver may think and how long the machine searches are two settings now.
--   * The push says "Seeb → Muscat · 12 km · 8.500 OMR" and carries Accept and
--     Decline (category `job_offer`, registered by the app). Accept opens the
--     job card; it never takes the job from the lock screen.
--   * The search tick runs every 20 seconds, so an unanswered minute is not
--     followed by most of another before the next driver hears.

insert into private.app_settings (key, value) values ('offer_answer_seconds', '60'::jsonb)
on conflict (key) do nothing;

-- ═══ 1. offers last a minute ═════════════════════════════════════════════════
-- 0036's body; only the expiry changed.
create or replace function private.dispatch_wave(p_load_id uuid, p_wave integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_size       integer := private.setting_int('auto_dispatch_max_offers', 3);
  v_per_driver integer := private.setting_int('auto_dispatch_max_pending_per_driver', 3);
  -- 0074: how long a driver has to answer, apart from how long a wave runs.
  v_answer     integer := private.setting_int('offer_answer_seconds', 60);
  v_max        integer := private.setting_int('dispatch_max_waves', 3);
  v_radius     numeric := private.setting_int('dispatch_radius_km_' || p_wave, 1500);
  v_verified   boolean := private.setting_bool('require_verified_driver', true);
  v_sent       integer := 0;
  v_legs       integer := 0;
  v_seen       integer := 0;
  v_pending    integer;
  v_offer      uuid;
  c            record;
begin
  for c in select * from private.candidates_for(p_load_id, 1::smallint, 0, v_size * 4) loop
    v_seen := v_seen + 1;
    exit when v_sent >= v_size;
    continue when c.offer_status is not null;
    continue when v_verified and not private.is_verified_driver(c.driver_id);
    select count(*) into v_pending from public.offers o
    where o.driver_id = c.driver_id and o.status = 'pending' and o.expires_at > now();
    continue when v_pending >= v_per_driver;
    v_offer := public.create_offer(p_load_id, c.driver_id, c.leg_id, 'auto', false);
    update public.offers set expires_at = now() + make_interval(secs => v_answer)
    where id = v_offer;
    v_sent := v_sent + 1;
    v_legs := v_legs + 1;
  end loop;

  if v_sent < v_size then
    for c in
      select * from private.nearby_drivers(p_load_id, v_radius, p_wave >= v_max, v_size * 4)
    loop
      v_seen := v_seen + 1;
      exit when v_sent >= v_size;
      continue when c.pending >= v_per_driver;
      v_offer := public.create_offer(p_load_id, c.driver_id, null, 'auto', false);
      update public.offers set expires_at = now() + make_interval(secs => v_answer)
      where id = v_offer;
      v_sent := v_sent + 1;
    end loop;
  end if;

  -- Logged when something went out, and once for the first empty attempt so a
  -- dispatcher can see the search began. Not every empty minute: a search can
  -- run for fifteen of them, and fifteen "nobody" rows would bury the one row
  -- that says who was asked.
  if v_sent > 0 or not exists (
    select 1 from private.dispatch_log d where d.load_id = p_load_id and d.wave is not null
  ) then
    insert into private.dispatch_log (load_id, candidates, offers_sent, mode, skipped, wave)
    values (p_load_id, v_seen, v_sent,
            case when v_sent > 0 and v_legs = v_sent then 'leg'
                 when v_legs > 0 then 'mixed'
                 else 'nearby' end,
            case when v_sent = 0 then 'no_candidates' end, p_wave);
  end if;

  return v_sent;
end;
$$;

-- 0037's body; only the expiry changed.
create or replace function private.system_rescue_stranded()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_size       integer := private.setting_int('auto_dispatch_max_offers', 3);
  v_per_driver integer := private.setting_int('auto_dispatch_max_pending_per_driver', 3);
  v_minutes    integer := private.setting_int('dispatch_wave_minutes', 5);
  v_max        integer := private.setting_int('dispatch_max_waves', 3);
  v_radius     numeric := private.setting_int('dispatch_radius_km_' || v_max, 1500);
  v_today      date    := (now() at time zone 'Asia/Muscat')::date;
  v_loads      integer := 0;
  v_sent       integer;
  v_seen       integer;
  v_offer      uuid;
  r            record;
  c            record;
begin
  if not private.setting_bool('auto_dispatch_enabled', true)
     or not private.setting_bool('dispatch_rescue_enabled', true) then
    return 0;
  end if;

  for r in
    select l.id from public.loads l
    where l.status in ('finding_truck'::public.load_status, 'matched'::public.load_status)
      and l.accepted_at is not null
      and l.price_baisa is not null
      and l.pickup_to >= v_today
      and not private.machine_owns(l.id)
      and not exists (
        select 1 from public.offers o
        where o.load_id = l.id and o.status = 'pending' and o.expires_at > now())
      and not exists (
        select 1 from private.ops_audit a
        where a.target_kind = 'load' and a.target_id = l.id::text
          and a.action in ('ops_send_offer', 'ops_mark_finding_truck', 'ops_set_load_status')
          and a.created_at >= l.accepted_at)
    order by l.pickup_from, l.accepted_at
    for update of l skip locked
  loop
    update public.offers set status = 'expired'
    where load_id = r.id and status = 'pending' and expires_at <= now();

    v_sent := 0;
    v_seen := 0;
    for c in select * from private.nearby_drivers(r.id, v_radius, true, v_size * 4) loop
      v_seen := v_seen + 1;
      exit when v_sent >= v_size;
      continue when c.pending >= v_per_driver;
      v_offer := public.create_offer(r.id, c.driver_id, null, 'auto', false);
      update public.offers set expires_at = now() + make_interval(secs => private.setting_int('offer_answer_seconds', 60))
      where id = v_offer;
      v_sent := v_sent + 1;
    end loop;

    -- Only when someone was asked: a load nobody fits would otherwise write a
    -- row every minute until its collection date.
    if v_sent > 0 then
      insert into private.dispatch_log (load_id, candidates, offers_sent, mode)
      values (r.id, v_seen, v_sent, 'rescue');
      v_loads := v_loads + 1;
    end if;
  end loop;

  if v_loads > 0 then
    perform private.log_system('system_rescue_stranded', 'system', 'loads',
                               jsonb_build_object('loads_offered', v_loads));
  end if;
  return v_loads;
end;
$$;

select cron.unschedule('dispatch-waves');
select cron.schedule('dispatch-waves', '20 seconds', $$select private.system_dispatch_waves()$$);

-- ═══ 2. the push: route, km, fare, and two buttons ══════════════════════════
-- 0046's bodies; the category and the body text changed.
create or replace function private.push_send(
  p_profile uuid, p_kind text, p_load_id uuid,
  p_title_en text, p_body_en text, p_title_ar text, p_body_ar text,
  p_data jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_lang  text;
  v_msgs  jsonb;
  v_count integer;
  v_req   bigint;
  v_token text := private.setting_text('expo_push_access_token');
begin
  if not private.setting_bool('push_enabled', true) then return; end if;
  select p.language::text into v_lang from public.profiles p where p.id = p_profile;
  select jsonb_agg(jsonb_build_object(
           'to', t.token,
           'title', case when v_lang = 'ar' then p_title_ar else p_title_en end,
           'body',  case when v_lang = 'ar' then p_body_ar  else p_body_en  end,
           'data', p_data,
           'sound', 'default',
           'channelId', 'default',
           'priority', 'high')
         -- 0074: a fixed-price job carries Accept / Decline on the notification.
         || case when p_data ->> 'kind' = 'driver_new_job' and not coalesce((p_data ->> 'bid')::boolean, false)
                 then jsonb_build_object('categoryId', 'job_offer') else '{}'::jsonb end),
         count(*)
    into v_msgs, v_count
  from private.push_tokens t where t.profile_id = p_profile;

  if v_count > 0 then
    select net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      body    := v_msgs,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json')
                 || case when v_token is null then '{}'::jsonb
                         else jsonb_build_object('Authorization', 'Bearer ' || v_token) end
    ) into v_req;
  end if;
  insert into private.push_log(profile_id, kind, load_id, recipients, request_id)
  values (p_profile, p_kind, p_load_id, coalesce(v_count, 0), v_req);
exception when others then
  raise warning 'push % to % failed: %', p_kind, p_profile, sqlstate;
end;
$$;

create or replace function private.push_on_offer()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_offer public.offers;
  v_route text;
  v_km    numeric;
  v_pay   bigint;
begin
  if tg_op = 'UPDATE' and old.status = 'pending' then return null; end if;
  -- Re-read at commit: only an offer still open is news.
  select * into v_offer from public.offers o where o.id = new.id;
  if v_offer.id is null or v_offer.status <> 'pending' or v_offer.expires_at <= now() then
    return null;
  end if;
  v_route := private.push_route(v_offer.load_id, 'en');
  if v_offer.source = 'bid' then
    perform private.push_send(v_offer.driver_id, 'driver_new_bid', v_offer.load_id,
      'New job', 'Name your price: ' || v_route,
      'عمل جديد', 'حدّد سعرك: ' || private.push_route(v_offer.load_id, 'ar'),
      jsonb_build_object('kind', 'driver_new_job', 'offer_id', v_offer.id, 'bid', true));
  else
    -- 0074: route, trip km and what the driver keeps — cities and amounts only,
    -- as the lock screen rule says; never cargo, a name or a phone.
    v_km  := round(private.load_km(v_offer.load_id));
    v_pay := (select private.payout_for(l.price_baisa) from public.loads l where l.id = v_offer.load_id);
    perform private.push_send(v_offer.driver_id, 'driver_new_offer', v_offer.load_id,
      'New job', v_route
        || coalesce(' · ' || v_km::text || ' km', '')
        || coalesce(' · ' || private.push_money(v_pay, 'en'), ''),
      'عمل جديد', private.push_route(v_offer.load_id, 'ar')
        || coalesce(' · ' || translate(v_km::text, '0123456789', '٠١٢٣٤٥٦٧٨٩') || ' كم', '')
        || coalesce(' · ' || private.push_money(v_pay, 'ar'), ''),
      jsonb_build_object('kind', 'driver_new_job', 'offer_id', v_offer.id, 'bid', false));
  end if;
  return null;
exception when others then
  raise warning 'push_on_offer: %', sqlstate;
  return null;
end;
$$;

-- ═══ 3. what an open offer shows ═════════════════════════════════════════════
-- Same columns as 0045 so installed builds keep working; the places come back
-- empty until the job is taken, and two numbers are added.
drop function if exists public.driver_offer(uuid);
drop function if exists public.driver_offers();

create function public.driver_offers()
returns table (
  offer_id uuid, expires_at timestamptz, leg_id uuid,
  origin_city bigint, dest_city bigint, pickup_from date, pickup_to date,
  goods text, weight_kg integer, truck_type_code text,
  collect_baisa bigint, payout_baisa bigint, owed_baisa bigint,
  currency char(3), detour_km numeric, free_after_kg integer,
  pickup_lat double precision, pickup_lng double precision, pickup_name text,
  pickup_note text, pickup_contact_name text, pickup_contact_phone text,
  drop_lat double precision, drop_lng double precision, drop_name text,
  drop_note text, drop_contact_name text, drop_contact_phone text,
  trip_km numeric, to_pickup_km numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.offer_id, d.expires_at, d.leg_id,
         d.origin_city, d.dest_city, d.pickup_from, d.pickup_to,
         d.goods, d.weight_kg, d.truck_type_code,
         d.collect_baisa, d.payout_baisa, d.owed_baisa,
         d.currency, d.detour_km, d.free_after_kg,
         null::double precision, null::double precision, null::text,
         null::text, null::text, null::text,
         null::double precision, null::double precision, null::text,
         null::text, null::text, null::text,
         private.load_km(o.load_id),
         -- From the driver's own latest fix when it is fresh and good (as
         -- nearby_drivers ranks), else from their town. Their own distance,
         -- never their coordinates.
         case when da.lat is not null and da.located_at > now() - interval '45 minutes'
                   and coalesce(da.accuracy_m, 0) <= 1000
              then private.straight_road_km(da.lat, da.lng, coalesce(pp.lat, oc.lat), coalesce(pp.lng, oc.lng))
              when da.city_id is not null
              then private.route_km(da.city_id, d.origin_city)
         end
    from private.driver_offers_legacy_unfiltered() d
    join public.offers o on o.id = d.offer_id and o.source <> 'bid'
    left join public.load_places pp on pp.load_id = o.load_id and pp.kind = 'pickup'
    left join public.cities oc on oc.id = d.origin_city
    left join public.driver_availability da on da.driver_id = (select auth.uid());
$$;
revoke all on function public.driver_offers() from public, anon;
grant execute on function public.driver_offers() to authenticated;

create function public.driver_offer(p_offer_id uuid)
returns table (
  offer_id uuid, expires_at timestamptz, leg_id uuid,
  origin_city bigint, dest_city bigint, pickup_from date, pickup_to date,
  goods text, weight_kg integer, truck_type_code text,
  collect_baisa bigint, payout_baisa bigint, owed_baisa bigint,
  currency char(3), detour_km numeric, free_after_kg integer,
  pickup_lat double precision, pickup_lng double precision, pickup_name text,
  pickup_note text, pickup_contact_name text, pickup_contact_phone text,
  drop_lat double precision, drop_lng double precision, drop_name text,
  drop_note text, drop_contact_name text, drop_contact_phone text,
  trip_km numeric, to_pickup_km numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.driver_offers() d where d.offer_id = p_offer_id;
$$;
revoke all on function public.driver_offer(uuid) from public, anon;
grant execute on function public.driver_offer(uuid) to authenticated;

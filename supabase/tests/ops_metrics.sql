-- Ops console v2, phase 3 — the eagle view's numbers (0062).
-- Measured as DIFFERENCES (after fixtures minus before), so rows already in the
-- database — demo data, other suites' leftovers — cannot move the result.
begin;
delete from private.app_settings where key = 'staff_email_domains';
insert into private.app_settings (key, value) values ('commission_pct', '10'::jsonb)
on conflict (key) do update set value = excluded.value;

create or replace function assert_true(p_actual boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from true then
    raise exception 'FAIL: % — expected true, got %', p_what, p_actual;
  end if;
  raise notice 'pass: %', p_what;
end $$;

create or replace function assert_raises(p_sql text, p_what text, p_like text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_like is not null and sqlerrm not like p_like then
      raise exception 'FAIL: % — raised "%" but expected like "%"', p_what, sqlerrm, p_like;
    end if;
    raise notice 'pass: % (rejected: %)', p_what, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — statement succeeded but should have been denied', p_what;
end $$;

create or replace function assert_not_found(p_sql text, p_what text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when no_data_found then
    raise notice 'pass: % (not found)', p_what;
    return;
  when others then
    raise exception 'FAIL: % — raised % (%) instead of no_data_found', p_what, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % — succeeded but should have been not found', p_what;
end $$;

-- Impersonate with explicit 2FA state. p_totp_age_min null = no totp in amr.
-- p_role: 'authenticated' for public RPCs; 'postgres' to call private helpers
-- (ungranted to clients on purpose) with the same identity claims.
create or replace function act_as_staff(p_uid uuid, p_aal text, p_totp_age_min integer,
                                        p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated', 'aal', p_aal,
    'amr', case when p_totp_age_min is null
                then json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint))
                else json_build_array(
                  json_build_object('method', 'password', 'timestamp', extract(epoch from now() - interval '1 hour')::bigint),
                  json_build_object('method', 'totp', 'timestamp', extract(epoch from now() - make_interval(mins => p_totp_age_min))::bigint))
           end)::text, true);
end $$;

create or replace function act_as_reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;


create or replace function city(p_name text) returns bigint language sql stable as $$
  select id from public.cities where name_en = p_name $$;
create or replace function n(p jsonb, p_key text) returns numeric language sql immutable as $$
  select coalesce((p ->> p_key)::numeric, 0) $$;

-- staff, made before the baseline so they are not part of any difference
do $$
begin
  insert into auth.users (id, email, email_confirmed_at) values
    ('62000000-0000-4000-8000-0000000000f1', 'owner@metrics.test', now()),
    ('62000000-0000-4000-8000-0000000000f2', 'disp@metrics.test', now());
  insert into public.profiles (id, role, full_name) values
    ('62000000-0000-4000-8000-0000000000f1', 'shipper', 'Metrics Owner'),
    ('62000000-0000-4000-8000-0000000000f2', 'shipper', 'Metrics Disp');
  insert into private.ops_users (profile_id, note, level) values
    ('62000000-0000-4000-8000-0000000000f1', 'metrics suite', 'owner'),
    ('62000000-0000-4000-8000-0000000000f2', 'metrics suite', 'dispatcher');
end $$;

-- ═══ guards ════════════════════════════════════════════════════════════════
select act_as_staff('62000000-0000-4000-8000-0000000000f2', 'aal2', 1);
select assert_not_found($$select public.ops_metrics('7d')$$, 'a dispatcher cannot read the business numbers');
select act_as_staff('62000000-0000-4000-8000-0000000000f1', 'aal1', null);
select assert_not_found($$select public.ops_metrics('7d')$$, 'an owner without 2FA cannot either');
select act_as_staff('62000000-0000-4000-8000-0000000000f1', 'aal2', 1);
select assert_raises($$select public.ops_metrics('year')$$, 'an unknown period is refused', '%period%');

select public.ops_metrics('7d') as before \gset
select act_as_reset();

-- ═══ fixtures, all inside the last 7 days ══════════════════════════════════
do $$
begin
  insert into auth.users (id, email, email_confirmed_at) values
    ('62000000-0000-4000-8000-0000000000a1', 'ship@metrics.test', now()),
    ('62000000-0000-4000-8000-0000000000a2', 'idle-ship@metrics.test', now()),
    ('62000000-0000-4000-8000-0000000000d1', 'drv@metrics.test', now()),
    ('62000000-0000-4000-8000-0000000000d2', 'idle-drv@metrics.test', now());
  insert into public.profiles (id, role, full_name) values
    ('62000000-0000-4000-8000-0000000000a1', 'shipper', 'Busy Shipper'),
    ('62000000-0000-4000-8000-0000000000a2', 'shipper', 'Idle Shipper'),
    ('62000000-0000-4000-8000-0000000000d1', 'driver', 'Busy Driver'),
    ('62000000-0000-4000-8000-0000000000d2', 'driver', 'Idle Driver');
end $$;
-- A fixed load: priced 100.000, booked, delivered.
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status, price_baisa, accepted_at, created_at)
values ('62000000-0000-4000-8000-000000000101', '62000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'),
        current_date, current_date, 'm1', 'delivered', 100000, now() - interval '2 hours', now() - interval '2 hours');
insert into public.trips (id, load_id, driver_id, status, created_at)
values ('62000000-0000-4000-8000-000000000201', '62000000-0000-4000-8000-000000000101', '62000000-0000-4000-8000-0000000000d1', 'delivered', now() - interval '1 hour');
-- A bid load: two bids, the second awarded at 80.000 total / 72.000 payout, booked.
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status, pricing_mode, bid_deadline, created_at)
values ('62000000-0000-4000-8000-000000000102', '62000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'),
        current_date + 1, current_date + 1, 'm2', 'assigned', 'bid', now() - interval '10 minutes', now() - interval '3 hours');
insert into private.bid_loads (load_id, fee_bps, awarded_payout_baisa) values ('62000000-0000-4000-8000-000000000102', 1000, 72000);
insert into public.offers (id, load_id, driver_id, status, source, expires_at) values
  ('62000000-0000-4000-8000-000000000301', '62000000-0000-4000-8000-000000000102', '62000000-0000-4000-8000-0000000000d2', 'expired', 'bid', now()),
  ('62000000-0000-4000-8000-000000000302', '62000000-0000-4000-8000-000000000102', '62000000-0000-4000-8000-0000000000d1', 'accepted', 'bid', now());
insert into private.driver_bids (id, load_id, offer_id, driver_id, payout_baisa) values
  ('62000000-0000-4000-8000-000000000401', '62000000-0000-4000-8000-000000000102', '62000000-0000-4000-8000-000000000301', '62000000-0000-4000-8000-0000000000d2', 75000),
  ('62000000-0000-4000-8000-000000000402', '62000000-0000-4000-8000-000000000102', '62000000-0000-4000-8000-000000000302', '62000000-0000-4000-8000-0000000000d1', 72000);
update public.loads set selected_bid_id = '62000000-0000-4000-8000-000000000402', price_baisa = 80000
 where id = '62000000-0000-4000-8000-000000000102';
insert into public.trips (id, load_id, driver_id, status, created_at)
values ('62000000-0000-4000-8000-000000000202', '62000000-0000-4000-8000-000000000102', '62000000-0000-4000-8000-0000000000d1', 'assigned', now() - interval '2 hours');
-- An unpriced load nobody has taken.
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status)
values ('62000000-0000-4000-8000-000000000103', '62000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Nizwa'),
        current_date + 2, current_date + 2, 'm3', 'finding_truck');

select act_as_staff('62000000-0000-4000-8000-0000000000f1', 'aal2', 1);
select public.ops_metrics('7d') as after \gset
select act_as_reset();

-- ═══ the numbers ═══════════════════════════════════════════════════════════
select assert_true(n(:'after'::jsonb -> 'current', 'posted') - n(:'before'::jsonb -> 'current', 'posted') = 3, 'posted counts every load created in the window');
select assert_true(n(:'after'::jsonb -> 'current', 'priced') - n(:'before'::jsonb -> 'current', 'priced') = 2, 'priced counts a price or a bid');
select assert_true(n(:'after'::jsonb -> 'current', 'booked') - n(:'before'::jsonb -> 'current', 'booked') = 2, 'booked counts loads with a trip');
select assert_true(n(:'after'::jsonb -> 'current', 'delivered') - n(:'before'::jsonb -> 'current', 'delivered') = 1, 'delivered counts delivered or closed');
select assert_true(n(:'after'::jsonb -> 'current', 'booked_value_baisa') - n(:'before'::jsonb -> 'current', 'booked_value_baisa') = 180000,
  'booked value is the sum of booked prices, in baisa');
select assert_true(n(:'after'::jsonb -> 'current', 'margin_baisa') - n(:'before'::jsonb -> 'current', 'margin_baisa')
  = (100000 - private.payout_for(100000)) + 8000,
  'margin: a bid load uses its awarded payout, a fixed load today''s commission');
select assert_true(n(:'after'::jsonb -> 'current', 'new_shippers') - n(:'before'::jsonb -> 'current', 'new_shippers') = 2
  and n(:'after'::jsonb -> 'current', 'new_drivers') - n(:'before'::jsonb -> 'current', 'new_drivers') = 2,
  'new users by role — staff accounts are not users');
select assert_true(n(:'after'::jsonb -> 'current', 'active_shippers') - n(:'before'::jsonb -> 'current', 'active_shippers') = 1,
  'a shipper who signed up and did nothing is new, not active');
select assert_true(n(:'after'::jsonb -> 'current', 'active_drivers') - n(:'before'::jsonb -> 'current', 'active_drivers') = 2,
  'a driver who bid is active');
select assert_true(n(:'after'::jsonb -> 'totals', 'drivers') - n(:'before'::jsonb -> 'totals', 'drivers') = 2
  and n(:'after'::jsonb -> 'totals', 'shippers') - n(:'before'::jsonb -> 'totals', 'shippers') = 2,
  'totals count users by role, not staff');
select assert_true(n(:'after'::jsonb -> 'previous', 'posted') = n(:'before'::jsonb -> 'previous', 'posted'),
  'today''s loads do not leak into the previous period');
select assert_true(exists (select 1 from jsonb_array_elements(:'after'::jsonb -> 'corridors') c where c ->> 'route' = 'Muscat → Sohar'),
  'the busiest corridor is listed by name');

-- Empty window: zeros and nulls, never an error.
select act_as_staff('62000000-0000-4000-8000-0000000000f1', 'aal2', 1, 'postgres');
select private.ops_metrics_window(now() + interval '10 days', now() + interval '11 days') as empty \gset
select act_as_reset();
select assert_true(n(:'empty'::jsonb, 'posted') = 0 and (:'empty'::jsonb -> 'median_minutes_to_truck') = 'null'::jsonb,
  'empty window: zeros and nulls');

select assert_true(
  (select provolatile = 's' and coalesce(proconfig, '{}') @> array['search_path=""'] from pg_proc where proname = 'ops_metrics')
  and not has_function_privilege('anon', 'public.ops_metrics(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.ops_metrics_window(timestamptz, timestamptz)', 'execute'),
  'ops_metrics is stable, pinned, not anonymous; its window helper is ungranted');


-- ═══ health ════════════════════════════════════════════════════════════════
select act_as_staff('62000000-0000-4000-8000-0000000000f2', 'aal2', 1);
select assert_not_found($$select public.ops_health()$$, 'a dispatcher cannot read system health');
select act_as_staff('62000000-0000-4000-8000-0000000000f1', 'aal2', 1);
select public.ops_health() as h0 \gset
select act_as_reset();
select private.system_raise_alert('health_test', 'Health test', '{}'::jsonb);
select id as hid from private.ops_alerts where kind = 'health_test' \gset
select act_as_staff('62000000-0000-4000-8000-0000000000f1', 'aal2', 1);
select public.ops_health() as h1 \gset
select public.ops_ack_alert(:hid);
select public.ops_health() as h2 \gset
select act_as_reset();
select assert_true((:'h1'::jsonb -> 'system') = private.system_health(),
  'health carries the system check as system_health() reports it');
select assert_true(n(:'h1'::jsonb, 'alerts_24h') - n(:'h0'::jsonb, 'alerts_24h') = 1
  and n(:'h1'::jsonb, 'alerts_unacknowledged') - n(:'h0'::jsonb, 'alerts_unacknowledged') = 1,
  'a new alert counts in the day''s alerts and the unacknowledged ones');
select assert_true(n(:'h2'::jsonb, 'alerts_unacknowledged') = n(:'h0'::jsonb, 'alerts_unacknowledged')
  and n(:'h2'::jsonb, 'alerts_24h') = n(:'h1'::jsonb, 'alerts_24h'),
  'acknowledging it clears it from unacknowledged, not from the day''s count');
select assert_true(jsonb_typeof(:'h1'::jsonb -> 'app_versions') = 'array', 'app versions is always a list');

do $$ begin raise notice 'ALL OPS METRICS ASSERTIONS HELD'; end $$;
rollback;

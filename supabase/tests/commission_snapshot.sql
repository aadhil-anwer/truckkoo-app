-- A trip keeps the commission it was accepted at (0068).
begin;
delete from private.app_settings where key = 'staff_email_domains';
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
do $$
declare r record;
begin
  for r in select * from (values
    ('6d000000-0000-4000-8000-0000000000a1'::uuid, 'shipper', 'Com Shipper'),
    ('6d000000-0000-4000-8000-0000000000d1'::uuid, 'driver',  'Com Driver One'),
    ('6d000000-0000-4000-8000-0000000000d2'::uuid, 'driver',  'Com Driver Two')) v(id, role, name)
  loop
    insert into auth.users (id, email, email_confirmed_at) values (r.id, r.id || '@com.test', now());
    insert into public.profiles (id, role, full_name) values (r.id, r.role::public.user_role, r.name);
  end loop;
end $$;
insert into private.app_settings (key, value) values ('commission_pct', '10')
  on conflict (key) do update set value = '10';

insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status, price_baisa) values
  ('6d000000-0000-4000-8000-000000000101', '6d000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'), current_date, current_date + 1, 'boxes', 'assigned', 50000),
  ('6d000000-0000-4000-8000-000000000102', '6d000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sur'), current_date + 2, current_date + 3, 'tiles', 'finding_truck', 40000);
insert into public.trips (id, load_id, driver_id, status) values
  ('6d000000-0000-4000-8000-000000000201', '6d000000-0000-4000-8000-000000000101', '6d000000-0000-4000-8000-0000000000d1', 'assigned');

select assert_true((select commission_pct = 10 from private.trip_commission
                     where trip_id = '6d000000-0000-4000-8000-000000000201'),
  'a new trip records the commission in force when it was created');

-- What driver one sees at 10%, before anything changes.
select act_as_staff('6d000000-0000-4000-8000-0000000000d1', 'aal1', null);
create temp table before_change on commit drop as
  select t.payout_baisa, t.owed_baisa, (select to_jsonb(e) from public.driver_earnings() e) earnings
    from public.driver_trip('6d000000-0000-4000-8000-000000000201') t;
select act_as_reset();
select assert_true((select payout_baisa = 45000 and owed_baisa = 5000 from before_change),
  'at 10% the driver keeps 45.000 of 50.000 and owes 5.000');

-- The commission drops to zero (the launch offer).
update private.app_settings set value = '0' where key = 'commission_pct';

select act_as_staff('6d000000-0000-4000-8000-0000000000d1', 'aal1', null);
create temp table after_change on commit drop as
  select t.payout_baisa, t.owed_baisa, (select to_jsonb(e) from public.driver_earnings() e) earnings
    from public.driver_trip('6d000000-0000-4000-8000-000000000201') t;
select act_as_reset();
select assert_true((select a.payout_baisa = b.payout_baisa and a.owed_baisa = b.owed_baisa
                      from after_change a, before_change b),
  'changing the commission does not rewrite a trip already accepted');
select assert_true((select a.earnings = b.earnings from after_change a, before_change b),
  'nor the driver''s earnings');

-- Driver two accepts a job after the change, through the real accept path.
insert into public.drivers (profile_id, verified_at) values ('6d000000-0000-4000-8000-0000000000d2', now())
on conflict (profile_id) do update set verified_at = excluded.verified_at;
insert into public.trucks (owner_id, truck_type, capacity_kg) values ('6d000000-0000-4000-8000-0000000000d2', '10t', 10000);
insert into public.offers (id, load_id, driver_id, status, source, expires_at) values
  ('6d000000-0000-4000-8000-000000000401', '6d000000-0000-4000-8000-000000000102', '6d000000-0000-4000-8000-0000000000d2', 'pending', 'ops', now() + interval '10 minutes');
select act_as_staff('6d000000-0000-4000-8000-0000000000d2', 'aal1', null);
select public.respond_to_offer('6d000000-0000-4000-8000-000000000401', true) is not null;
select act_as_reset();
create temp table second_trip (trip_id uuid, payout_baisa bigint, owed_baisa bigint) on commit drop;
grant all on second_trip to authenticated;
insert into second_trip (trip_id) select id from public.trips where load_id = '6d000000-0000-4000-8000-000000000102';
select act_as_staff('6d000000-0000-4000-8000-0000000000d2', 'aal1', null);
update second_trip set (payout_baisa, owed_baisa) =
  (select t.payout_baisa, t.owed_baisa from public.driver_trip(second_trip.trip_id) t);
select act_as_reset();
select assert_true((select tc.commission_pct = 0 from private.trip_commission tc join second_trip s on s.trip_id = tc.trip_id),
  'a job accepted after the change records the new commission');
select assert_true((select payout_baisa = 40000 and owed_baisa = 0 from second_trip),
  'at 0% the driver keeps everything and owes nothing');

-- Raise it again: neither trip moves.
update private.app_settings set value = '15' where key = 'commission_pct';
select act_as_staff('6d000000-0000-4000-8000-0000000000d2', 'aal1', null);
select assert_true((select t.payout_baisa = 40000 from second_trip s, public.driver_trip(s.trip_id) t),
  'ending the free period does not charge commission on jobs taken during it');
select act_as_reset();

select assert_true((select (private.ops_metrics_window(now() - interval '1 day', now() + interval '1 minute')->>'margin_baisa')::bigint = 5000),
  'Eagle view margin uses each trip''s own commission: 5.000 + 0');

select assert_true(not has_table_privilege('authenticated', 'private.trip_commission', 'select')
               and not has_table_privilege('anon', 'private.trip_commission', 'select')
               and not has_table_privilege('authenticated', 'private.trip_commission', 'insert'),
  'no client reads or writes the commission record');

rollback;

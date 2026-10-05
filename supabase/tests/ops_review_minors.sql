-- Ops console v2 — review minors (0061).
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

-- f1 owner, f2 dispatcher, d1 driver (verified + suspended by staff), d2 driver
-- verified before any audit existed, a1 shipper.
do $$
declare r record;
begin
  for r in select * from (values
    ('67000000-0000-4000-8000-0000000000f1'::uuid, 'shipper', 'Minor Owner'),
    ('67000000-0000-4000-8000-0000000000f2'::uuid, 'shipper', 'Minor Disp'),
    ('67000000-0000-4000-8000-0000000000d1'::uuid, 'driver',  'Minor Driver'),
    ('67000000-0000-4000-8000-0000000000d2'::uuid, 'driver',  'Old Driver'),
    ('67000000-0000-4000-8000-0000000000a1'::uuid, 'shipper', 'Minor Shipper')) v(id, role, name)
  loop
    insert into auth.users (id, email, email_confirmed_at) values (r.id, r.id || '@minor.test', now());
    insert into public.profiles (id, role, full_name) values (r.id, r.role::public.user_role, r.name);
  end loop;
  insert into private.ops_users (profile_id, note, level) values
    ('67000000-0000-4000-8000-0000000000f1', 'minors', 'owner'),
    ('67000000-0000-4000-8000-0000000000f2', 'minors', 'dispatcher');
  insert into public.drivers (profile_id, verified_at) values
    ('67000000-0000-4000-8000-0000000000d1', now() - interval '3 days'),
    ('67000000-0000-4000-8000-0000000000d2', now() - interval '90 days')
  on conflict (profile_id) do update set verified_at = excluded.verified_at;
end $$;
update public.profiles set suspended_at = now() - interval '1 day', suspended_reason = 'paperwork'
 where id = '67000000-0000-4000-8000-0000000000d1';
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status, price_baisa)
values ('67000000-0000-4000-8000-000000000101', '67000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'),
        current_date, current_date, 'boxes', 'in_transit', 50000);
insert into public.trips (id, load_id, driver_id, status) values
  ('67000000-0000-4000-8000-000000000201', '67000000-0000-4000-8000-000000000101', '67000000-0000-4000-8000-0000000000d1', 'in_transit');
insert into public.trip_events (id, trip_id, type, note, created_by, occurred_at) values
  ('67000000-0000-4000-8000-000000000501', '67000000-0000-4000-8000-000000000201', 'note', 'called the driver, stuck at Barka', '67000000-0000-4000-8000-0000000000f2', now() - interval '2 hours'),
  ('67000000-0000-4000-8000-000000000502', '67000000-0000-4000-8000-000000000201', 'picked_up', null, '67000000-0000-4000-8000-0000000000d1', now() - interval '3 hours');
alter table public.trip_events disable trigger trip_events_set_actor;
update public.trip_events set created_by = '67000000-0000-4000-8000-0000000000f2' where id = '67000000-0000-4000-8000-000000000501';
update public.trip_events set created_by = '67000000-0000-4000-8000-0000000000d1' where id = '67000000-0000-4000-8000-000000000502';
alter table public.trip_events enable trigger trip_events_set_actor;
insert into private.ops_audit (actor_id, action, target_kind, target_id, reason, created_at) values
  ('67000000-0000-4000-8000-0000000000f2', 'ops_add_trip_note', 'trip', '67000000-0000-4000-8000-000000000201', 'called the driver, stuck at Barka', now() - interval '2 hours'),
  ('67000000-0000-4000-8000-0000000000f2', 'ops_verify_driver', 'account', '67000000-0000-4000-8000-0000000000d1', 'licence seen', now() - interval '3 days'),
  ('67000000-0000-4000-8000-0000000000f2', 'ops_suspend_account', 'account', '67000000-0000-4000-8000-0000000000d1', 'paperwork', now() - interval '1 day');

-- ═══ 1. history: one line per thing that happened ═════════════════════════
select act_as_staff('67000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table h1 on commit drop as select h from jsonb_array_elements(public.ops_person('67000000-0000-4000-8000-0000000000d1')->'history') h;
create temp table h2 on commit drop as select h from jsonb_array_elements(public.ops_person('67000000-0000-4000-8000-0000000000d2')->'history') h;
select act_as_reset();
select assert_true((select count(*) = 1 from h1 where h->>'detail' = 'called the driver, stuck at Barka'),
  'a staff note appears once (as the staff action), not twice');
select assert_true(exists (select 1 from h1 where h->>'kind' = 'trip_event' and h->>'title' like 'Picked Up%'),
  'the driver''s own trip events still appear');
select assert_true(not exists (select 1 from h1 where h->>'kind' in ('suspended', 'verified'))
               and (select count(*) = 2 from h1 where h->>'kind' = 'staff_action' and h->>'title' in ('Suspend Account', 'Verify Driver')),
  'a suspension and a verification done by staff appear once, as staff actions');
select assert_true(exists (select 1 from h2 where h->>'kind' = 'verified'),
  'a verification with no audit row (before the console) still appears');

-- ═══ 2. alert text is kept, and shown ═════════════════════════════════════
select private.system_raise_alert('test_kind', 'Something happened on load ABCD1234.', jsonb_build_object('n', 1));
select act_as_staff('67000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table al on commit drop as select * from public.ops_alert_log(false, 5, 0);
select act_as_reset();
select assert_true((select text = 'Something happened on load ABCD1234.' from al where kind = 'test_kind'),
  'the alert log shows the alert''s own sentence');

-- ═══ 3. audit facets ═══════════════════════════════════════════════════════
select act_as_staff('67000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table fac on commit drop as select public.ops_audit_facets() j;
select act_as_staff('67000000-0000-4000-8000-0000000000a1', 'aal2', 1);
select assert_not_found($$select public.ops_audit_facets()$$, 'a shipper cannot read the audit facets');
select act_as_reset();
select assert_true((select j->'actions' ? 'ops_add_trip_note' and j->'target_kinds' ? 'trip'
                       and exists (select 1 from jsonb_array_elements(j->'actors') a where a->>'name' = 'Minor Disp')
                      from fac),
  'the audit filters list every action, kind and actor that exists — removed staff included');

-- ═══ 4. see as user: the singular claim and a rate limit ══════════════════
savepoint s4;
create or replace function public.driver_document_status()
returns table(kind text, status text, review_note text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select (auth.jwt() ->> 'sub'), 'approved', null::text, now() $$;
select act_as_staff('67000000-0000-4000-8000-0000000000f1', 'aal2', 1);
select set_config('request.jwt.claim', current_setting('request.jwt.claims'), true);
create temp table va on commit drop as select public.ops_view_as('67000000-0000-4000-8000-0000000000d2', 'checking the claim') j;
select assert_true((select j->'view'->'documents'->0->>'kind' = '67000000-0000-4000-8000-0000000000d2' from va),
  'auth.jwt() inside see-as is the user''s, even when request.jwt.claim was set');
select assert_true(current_setting('request.jwt.claim', true)::jsonb ->> 'sub' = '67000000-0000-4000-8000-0000000000f1',
  'and request.jwt.claim is restored afterwards');
select act_as_reset();
rollback to savepoint s4;
insert into private.rate_events (actor_id, action)
select '67000000-0000-4000-8000-0000000000f1', 'ops_view_as' from generate_series(1, 30);
insert into private.rate_events (actor_id, action)
select '67000000-0000-4000-8000-0000000000f1', 'ops_find_staff_account' from generate_series(1, 60);
select act_as_staff('67000000-0000-4000-8000-0000000000f1', 'aal2', 1);
select assert_raises($$select public.ops_view_as('67000000-0000-4000-8000-0000000000d2', 'one too many')$$,
  'see-as is rate limited (30 an hour), so it cannot be used to flood the owners'' inbox', '%rate limit%');
select assert_raises($$select * from public.ops_find_staff_account('67000000-0000-4000-8000-0000000000d2@minor.test')$$,
  'looking up staff accounts is rate limited (60 an hour)', '%rate limit%');
select act_as_reset();

-- ═══ 5. static ═════════════════════════════════════════════════════════════
select assert_true((select provolatile = 'v' from pg_proc where oid = 'public.ops_find_staff_account(text)'::regprocedure),
  'ops_find_staff_account writes a rate event, so it is volatile');
select assert_true((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
                      from pg_proc p where p.oid in ('public.ops_audit_facets()'::regprocedure,
                        'public.ops_alert_log(boolean, integer, integer)'::regprocedure,
                        'private.system_raise_alert(text, text, jsonb)'::regprocedure)),
  'the re-created functions are pinned definers');

rollback;

-- Ops console v2, phase 5 — people, history, trip routes, see as user (0059).
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

-- ═══ fixtures ══════════════════════════════════════════════════════════════
-- S shipper, D driver (online in Sohar), f1 owner, f2 dispatcher.
do $$
declare r record;
begin
  for r in select * from (values
    ('65000000-0000-4000-8000-0000000000a1'::uuid, 'shipper', 'People Shipper'),
    ('65000000-0000-4000-8000-0000000000d1'::uuid, 'driver',  'People Driver'),
    ('65000000-0000-4000-8000-0000000000f1'::uuid, 'shipper', 'People Owner'),
    ('65000000-0000-4000-8000-0000000000f2'::uuid, 'shipper', 'People Disp')) v(id, role, name)
  loop
    insert into auth.users (id, email, email_confirmed_at) values (r.id, r.id || '@people.test', now());
    insert into public.profiles (id, role, full_name, phone) values (r.id, r.role::public.user_role, r.name, '+96890000000');
  end loop;
  insert into public.trucks (id, owner_id, truck_type, plate, capacity_kg) values
    ('65000000-0000-4000-8000-0000000000c1', '65000000-0000-4000-8000-0000000000d1', '10t', 'PEOPLE 1', 10000);
  insert into public.drivers (profile_id, verified_at) values ('65000000-0000-4000-8000-0000000000d1', now() - interval '20 days')
  on conflict (profile_id) do update set verified_at = excluded.verified_at;
  insert into private.ops_users (profile_id, note, level) values
    ('65000000-0000-4000-8000-0000000000f1', 'people suite', 'owner'),
    ('65000000-0000-4000-8000-0000000000f2', 'people suite', 'dispatcher');
end $$;

insert into public.driver_availability (driver_id, available, city_id, updated_at)
values ('65000000-0000-4000-8000-0000000000d1', true, city('Sohar'), now() - interval '3 hours')
on conflict (driver_id) do update set available = true, city_id = excluded.city_id, updated_at = excluded.updated_at;

-- L1 fixed, delivered by D, rated 4; L2 bid load D bid on; L3 fixed, D declined.
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, weight_kg, status, price_baisa, created_at, accepted_at, pricing_mode, bid_deadline) values
  ('65000000-0000-4000-8000-000000000101', '65000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'), current_date - 5, current_date - 5, 'tiles', 5000, 'delivered', 100000, now() - interval '6 days', now() - interval '6 days', 'fixed', null),
  ('65000000-0000-4000-8000-000000000102', '65000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Nizwa'), current_date + 1, current_date + 1, 'cement', 8000, 'matched', null, now() - interval '2 days', null, 'bid', now() + interval '1 hour'),
  ('65000000-0000-4000-8000-000000000103', '65000000-0000-4000-8000-0000000000a1', city('Sohar'), city('Muscat'), current_date + 2, current_date + 2, 'rebar', 3000, 'posted', 60000, now() - interval '1 day', null, 'fixed', null);
insert into private.bid_loads (load_id, fee_bps) values ('65000000-0000-4000-8000-000000000102', 1000);
insert into public.offers (id, load_id, driver_id, status, source, created_at, expires_at) values
  ('65000000-0000-4000-8000-000000000301', '65000000-0000-4000-8000-000000000101', '65000000-0000-4000-8000-0000000000d1', 'accepted', 'auto', now() - interval '6 days', now() - interval '6 days' + interval '5 minutes'),
  ('65000000-0000-4000-8000-000000000302', '65000000-0000-4000-8000-000000000102', '65000000-0000-4000-8000-0000000000d1', 'pending', 'bid', now() - interval '2 days', now() + interval '1 hour'),
  ('65000000-0000-4000-8000-000000000303', '65000000-0000-4000-8000-000000000103', '65000000-0000-4000-8000-0000000000d1', 'declined', 'auto', now() - interval '1 day', now() - interval '1 day' + interval '5 minutes');
insert into private.driver_bids (id, load_id, offer_id, driver_id, payout_baisa, created_at, updated_at) values
  ('65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000102', '65000000-0000-4000-8000-000000000302', '65000000-0000-4000-8000-0000000000d1', 72000, now() - interval '2 days', now() - interval '2 days');
insert into public.trips (id, load_id, driver_id, truck_id, status, created_at) values
  ('65000000-0000-4000-8000-000000000201', '65000000-0000-4000-8000-000000000101', '65000000-0000-4000-8000-0000000000d1', '65000000-0000-4000-8000-0000000000c1', 'delivered', now() - interval '6 days');
-- Two events share a timestamp on purpose: the page-boundary tie.
insert into public.trip_events (id, trip_id, type, occurred_at, note) values
  ('65000000-0000-4000-8000-000000000501', '65000000-0000-4000-8000-000000000201', 'picked_up', now() - interval '5 days', null),
  ('65000000-0000-4000-8000-000000000502', '65000000-0000-4000-8000-000000000201', 'en_route',  now() - interval '5 days', 'left the yard'),
  ('65000000-0000-4000-8000-000000000503', '65000000-0000-4000-8000-000000000201', 'delivered', now() - interval '1 hour', null);
insert into public.ratings (trip_id, shipper_id, driver_id, stars, created_at) values
  ('65000000-0000-4000-8000-000000000201', '65000000-0000-4000-8000-0000000000a1', '65000000-0000-4000-8000-0000000000d1', 4, now() - interval '4 days');
insert into public.driver_documents (driver_id, kind, object_path, status, review_note, reviewed_at, created_at) values
  ('65000000-0000-4000-8000-0000000000d1', 'id_front', '65000000-0000-4000-8000-0000000000d1/id_front.jpg', 'approved', 'clear photo', now() - interval '21 days', now() - interval '22 days');
insert into private.ops_audit (actor_id, action, target_kind, target_id, reason, created_at) values
  ('65000000-0000-4000-8000-0000000000f2', 'ops_suspend_account', 'account', '65000000-0000-4000-8000-0000000000d1', 'paperwork expired', now() - interval '10 days');

-- ═══ 1. guards ═════════════════════════════════════════════════════════════
select act_as_reset();
select set_config('role', 'anon', true);
select assert_raises($$select * from public.ops_people()$$, 'anon cannot even call ops_people', '%permission denied%');
select act_as_staff('65000000-0000-4000-8000-0000000000a1', 'aal2', 1);
select assert_not_found($$select * from public.ops_people()$$, 'a shipper cannot list people');
select assert_not_found($$select public.ops_person('65000000-0000-4000-8000-0000000000d1')$$, 'a shipper cannot read a person');
select act_as_staff('65000000-0000-4000-8000-0000000000d1', 'aal2', 1);
select assert_not_found($$select public.ops_person('65000000-0000-4000-8000-0000000000d1')$$, 'a driver cannot read even their own ops page');
select act_as_staff('65000000-0000-4000-8000-0000000000f2', 'aal1', null);
select assert_not_found($$select * from public.ops_people()$$, 'a dispatcher without 2FA cannot list people');
select assert_not_found($$select public.ops_person('65000000-0000-4000-8000-0000000000d1')$$, 'a dispatcher without 2FA cannot read a person');

-- ═══ 2. the list ═══════════════════════════════════════════════════════════
select act_as_staff('65000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table ppl_online on commit drop as select * from public.ops_people(p_online => true);
create temp table ppl_staff on commit drop as select * from public.ops_people(p_staff => true);
create temp table ppl_ship on commit drop as select * from public.ops_people(p_role => 'shipper', p_search => 'People Ship');
create temp table ppl_all on commit drop as select * from public.ops_people(p_search => 'people ');
select act_as_reset();
select assert_true((select bool_and(online) and bool_or(profile_id = '65000000-0000-4000-8000-0000000000d1') from ppl_online)
               and not exists (select 1 from ppl_online where profile_id = '65000000-0000-4000-8000-0000000000a1'),
  'online filter returns online drivers only');
select assert_true((select count(*) = 2 from ppl_staff where profile_id::text like '65000000-%')
               and (select staff_level = 'owner' from ppl_staff where profile_id = '65000000-0000-4000-8000-0000000000f1')
               and not exists (select 1 from ppl_staff where staff_level is null),
  'staff filter returns staff, with their level');
select assert_true((select count(*) = 1 and bool_and(profile_id = '65000000-0000-4000-8000-0000000000a1') and bool_and(total_count = 1) from ppl_ship),
  'role and search narrow to the shipper, total_count matches');
select assert_true((select count(*) = 4 and bool_and(total_count = 4) from ppl_all),
  'search is case-insensitive and counts every match');
select assert_true((select last_active_at = (select occurred_at from public.trip_events where id = '65000000-0000-4000-8000-000000000503')
                      from ppl_all where profile_id = '65000000-0000-4000-8000-0000000000d1'),
  'a driver''s last activity is their latest recorded event');
select assert_true((select trip_count = 1 from ppl_all where profile_id = '65000000-0000-4000-8000-0000000000d1')
               and (select load_count = 3 from ppl_all where profile_id = '65000000-0000-4000-8000-0000000000a1'),
  'trip and load counts');
select act_as_staff('65000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table ppl_pct on commit drop as select * from public.ops_people(p_search => '%');
select act_as_reset();
select assert_true(not exists (select 1 from ppl_pct where profile_id::text like '65000000-%'),
  'a percent sign in the search is a literal, not a wildcard');

-- ═══ 3. one person ═════════════════════════════════════════════════════════
select act_as_staff('65000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table pd on commit drop as select public.ops_person('65000000-0000-4000-8000-0000000000d1') as j;
create temp table ps on commit drop as select public.ops_person('65000000-0000-4000-8000-0000000000a1') as j;
select assert_not_found($$select public.ops_person('65000000-0000-4000-8000-00000000ffff')$$, 'an unknown person is not found');
select act_as_reset();

select assert_true((select (j->'profile'->>'online')::boolean and j->'profile'->>'town' = 'Sohar' from pd),
  'a driver''s profile says online, and in which town');
select assert_true((select not jsonb_path_exists(j, 'strict $.**.lat') and not jsonb_path_exists(j, 'strict $.**.lng') from pd),
  'no coordinate leaves ops_person — the live map is the only reader');
select assert_true((select jsonb_array_length(j->'trucks') = 1 and j->'trucks'->0->>'plate' = 'PEOPLE 1' from pd), 'their truck');
select assert_true((select (j->'earnings'->>'trips')::int = 1
                       and (j->'earnings'->>'all_time_baisa')::bigint = private.trip_payout('65000000-0000-4000-8000-000000000201', 100000)
                      from pd),
  'earnings computed in SQL from the delivered trip''s payout');
select assert_true((select (j->'profile'->>'rating_avg')::numeric = 4 and (j->'profile'->>'rating_count')::int = 1 from pd), 'their rating');
select assert_true((select j->'profile'->>'staff_level' is null from pd), 'not staff');
create temp table pdh on commit drop as select h from pd, jsonb_array_elements(pd.j->'history') h;
select assert_true(exists (select 1 from pdh where h->>'kind' = 'offer_declined'), 'history: the declined offer');
select assert_true(exists (select 1 from pdh where h->>'kind' = 'bid_placed' and h->>'target_id' = '65000000-0000-4000-8000-000000000102'), 'history: the bid, linked to its load');
select assert_true((select count(*) = 3 from pdh where h->>'kind' = 'trip_event'), 'history: three trip events');
select assert_true(exists (select 1 from pdh where h->>'kind' = 'document_reviewed'), 'history: the document review');
select assert_true(exists (select 1 from pdh where h->>'kind' = 'staff_action' and h->>'detail' = 'paperwork expired' and h->>'actor' = 'People Disp'),
  'history: the staff action, with actor and reason');
select assert_true((select bool_and(a >= b) from (
                      select (h->>'at')::timestamptz a, lead((h->>'at')::timestamptz) over (order by ord) b
                        from pd, jsonb_array_elements(pd.j->'history') with ordinality x(h, ord)) z where b is not null),
  'history is newest first');

select assert_true((select j->'earnings' = 'null'::jsonb or j->'earnings' is null from ps), 'a shipper has no earnings');
select assert_true((select count(*) = 3 from ps, jsonb_array_elements(ps.j->'history') h where h->>'kind' = 'load_posted'), 'shipper history: three loads posted');
select assert_true(exists (select 1 from ps, jsonb_array_elements(ps.j->'history') h where h->>'kind' = 'rating'), 'shipper history: the rating they gave');

-- ═══ 4. paging: pages of 3 reassemble exactly, across a timestamp tie ═════
create temp table pages (key text) on commit drop;
grant all on pages to authenticated;
do $$
declare v jsonb; v_before timestamptz; v_key text; n int := 0;
begin
  perform act_as_staff('65000000-0000-4000-8000-0000000000f2', 'aal2', 1);
  loop
    v := public.ops_person('65000000-0000-4000-8000-0000000000d1', v_before, v_key, 3);
    insert into pages select h->>'key' from jsonb_array_elements(v->'history') h;
    exit when v->'next' is null or v->'next' = 'null'::jsonb;
    v_before := (v->'next'->>'before')::timestamptz;
    v_key := v->'next'->>'before_key';
    n := n + 1;
    if n > 50 then raise exception 'paging never ended'; end if;
  end loop;
  perform act_as_reset();
end $$;
select assert_true((select count(*) = count(distinct key) from pages), 'no item appears on two pages');
select assert_true((select count(*) from pages) = (select jsonb_array_length(j->'history') from pd)
               and not exists (select h->>'key' from pd, jsonb_array_elements(pd.j->'history') h except select key from pages),
  'the pages together are exactly the unpaged history');

select act_as_staff('65000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table plim on commit drop as
  select public.ops_person('65000000-0000-4000-8000-0000000000d1', null, null, 0) a,
         public.ops_person('65000000-0000-4000-8000-0000000000d1', null, null, 9999) b;
select act_as_reset();
select assert_true((select jsonb_array_length(a->'history') = 1 and jsonb_array_length(b->'history') <= 200 from plim), 'limit is clamped to 1..200');

-- ═══ 5. static ═════════════════════════════════════════════════════════════
select assert_true((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and p.provolatile = 's')
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('ops_people', 'ops_person')),
  'ops_people and ops_person are pinned, stable definers');
select assert_true(not has_function_privilege('authenticated', 'private.person_history(uuid)', 'execute'),
  'the history helper is not callable by clients');

rollback;

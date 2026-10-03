-- Push notifications (0046). Run: npm run test:db:push
--
-- The triggers are DEFERRED to commit and this suite rolls back, so each step
-- flushes them by hand: `set constraints all immediate` fires what is queued,
-- re-reading rows as they are at that moment — exactly what commit would do.
-- pg_net only sends after commit, so nothing leaves this machine.

begin;

set local client_min_messages to notice;

create or replace function assert_equals(p_actual bigint, p_expected bigint, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % — expected %, got %', p_what, p_expected, p_actual;
  end if;
  raise notice 'pass: %', p_what;
end $$;

create or replace function assert_true(p_actual boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is not true then
    raise exception 'FAIL: % — expected true, got %', p_what, coalesce(p_actual::text, 'NULL');
  end if;
  raise notice 'pass: %', p_what;
end $$;

create or replace function assert_raises(p_sql text, p_what text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'pass: % (rejected: %)', p_what, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — statement succeeded but should have been denied', p_what;
end $$;

create or replace function act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function act_as_reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function city(p_name text) returns bigint language sql stable as $$
  select id from public.cities where name_en = p_name
$$;

create or replace function tomorrow() returns date language sql stable as $$
  select (now() at time zone 'Asia/Muscat')::date + 1
$$;

create or replace function pushes(p_profile uuid, p_kind text) returns bigint language sql stable as $$
  select count(*) from private.push_log where profile_id = p_profile and kind = p_kind
$$;

-- The last message body queued for a token, as Expo would receive it.
create or replace function last_body(p_token text) returns text language sql stable as $$
  select m->>'body' from net.http_request_queue q,
         jsonb_array_elements(convert_from(q.body, 'utf8')::jsonb) m
  where m->>'to' = p_token order by q.id desc limit 1
$$;

-- The same, for whichever of a person's phones is still registered.
create or replace function last_body_for(p_profile uuid) returns text language sql stable as $$
  select m->>'body' from net.http_request_queue q,
         jsonb_array_elements(convert_from(q.body, 'utf8')::jsonb) m
  where m->>'to' in (select token from private.push_tokens where profile_id = p_profile)
  order by q.id desc limit 1
$$;

do $$
declare i integer; u uuid;
begin
  insert into auth.users (id, email) values
    ('a0000000-0000-4000-8000-0000000000c1', 'push-shipper@test.local'),
    ('a0000000-0000-4000-8000-0000000000c2', 'push-shipper-ar@test.local');
  insert into public.profiles (id, role, full_name, language) values
    ('a0000000-0000-4000-8000-0000000000c1', 'shipper', 'Push Shipper', 'en'),
    ('a0000000-0000-4000-8000-0000000000c2', 'shipper', 'Push Shipper AR', 'ar');
  for i in 1..4 loop
    u := ('d0000000-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid;
    insert into auth.users (id, email) values (u, 'push-d' || i || '@test.local');
    insert into public.profiles (id, role, full_name) values (u, 'driver', 'Push Driver ' || i);
    insert into public.drivers (profile_id, verified_at) values (u, now())
      on conflict (profile_id) do update set verified_at = now();
    insert into public.trucks (owner_id, truck_type, plate, capacity_kg) values (u, '10t', 'P-' || i, 10000);
    insert into public.driver_availability (driver_id, available, city_id, source)
      values (u, true, city('Muscat'), 'manual')
      on conflict (driver_id) do update set available = true, city_id = excluded.city_id;
  end loop;
  insert into private.app_settings (key, value) values ('bid_fee_pct', '10'::jsonb)
    on conflict (key) do update set value = excluded.value;
end $$;

-- ═══ 1. registering a phone ═══════════════════════════════════════════════

select act_as('d0000000-0000-4000-8000-000000000201');
select public.register_push_token('ExponentPushToken[driver1aaaaaaaaaa]', 'android');
select assert_raises($$select public.register_push_token('not-a-token', 'android')$$,
  'a token that is not an Expo token is refused');
select assert_raises($$select public.register_push_token('ExponentPushToken[driver1aaaaaaaaaa]', 'windows')$$,
  'an unknown platform is refused');
select assert_raises($$select * from private.push_tokens$$, 'no client can read the tokens');
select act_as_reset();
select assert_equals((select count(*) from private.push_tokens
                      where profile_id = 'd0000000-0000-4000-8000-000000000201'), 1, 'the token is stored for its owner');

select act_as('d0000000-0000-4000-8000-000000000202');
select public.register_push_token('ExponentPushToken[driver1aaaaaaaaaa]', 'android');
select act_as_reset();
select assert_true((select profile_id = 'd0000000-0000-4000-8000-000000000202' from private.push_tokens
                    where token = 'ExponentPushToken[driver1aaaaaaaaaa]'),
  'a shared phone moves to whoever signed in last');

select act_as('d0000000-0000-4000-8000-000000000201');
select public.unregister_push_token('ExponentPushToken[driver1aaaaaaaaaa]');
select act_as_reset();
select assert_equals((select count(*) from private.push_tokens where token = 'ExponentPushToken[driver1aaaaaaaaaa]'), 1,
  'nobody can unregister a phone that is not theirs');

do $$ declare i integer; begin
  perform act_as('a0000000-0000-4000-8000-0000000000c1');
  for i in 1..7 loop
    perform public.register_push_token('ExponentPushToken[shipper' || i || 'aaaaaaaaa]', 'ios');
  end loop;
  perform act_as_reset();
end $$;
select assert_equals((select count(*) from private.push_tokens
                      where profile_id = 'a0000000-0000-4000-8000-0000000000c1'), 5,
  'a person keeps their five newest phones');

-- Everyone else, one phone each.
do $$ declare i integer; begin
  for i in 1..4 loop
    insert into private.push_tokens(token, profile_id, platform)
    values ('ExponentPushToken[drv' || i || 'bbbbbbbbbbbb]',
            ('d0000000-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid, 'android')
    on conflict (token) do nothing;
  end loop;
  insert into private.push_tokens(token, profile_id, platform)
  values ('ExponentPushToken[shipperarabicccccc]', 'a0000000-0000-4000-8000-0000000000c2', 'android');
end $$;

-- ═══ 2. drivers hear about a new job ══════════════════════════════════════

select act_as('a0000000-0000-4000-8000-0000000000c1');
select public.post_bid_load(city('Muscat'), city('Sohar'), tomorrow(), tomorrow(), 'Cement', 5000) as l1 \gset
select act_as_reset();
set constraints all immediate; set constraints all deferred;

select assert_equals((select count(*) from private.push_log where kind = 'driver_new_bid' and load_id = :'l1'), 3,
  'every invited driver is told there is a job to price');
select assert_true(
  (select bool_and(last_body('ExponentPushToken[drv' || i || 'bbbbbbbbbbbb]') = 'Name your price: Muscat → Sohar')
   from generate_series(1, 4) i
   where exists (select 1 from public.offers o where o.load_id = :'l1'
                 and o.driver_id = ('d0000000-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid)),
  'the message names the route and nothing else');

-- ═══ 3. the shipper hears about prices, throttled ═════════════════════════

select o.driver_id as da, o.id as oa from public.offers o where o.load_id = :'l1' order by o.driver_id limit 1 \gset
select o.driver_id as db, o.id as ob from public.offers o where o.load_id = :'l1' order by o.driver_id offset 1 limit 1 \gset

select act_as(:'da');
select public.place_driver_bid(:'oa', 100000) as bid_a \gset
select act_as_reset();
set constraints all immediate; set constraints all deferred;
select assert_equals(pushes('a0000000-0000-4000-8000-0000000000c1', 'shipper_new_price'), 1,
  'the first price buzzes the shipper');
select assert_true(
  last_body_for('a0000000-0000-4000-8000-0000000000c1') = '110.000 OMR for Muscat → Sohar',
  'the shipper is told the total they would pay, with the fee in it');

select act_as(:'db');
select public.place_driver_bid(:'ob', 95000) as bid_b \gset
select act_as_reset();
set constraints all immediate; set constraints all deferred;
select assert_equals(pushes('a0000000-0000-4000-8000-0000000000c1', 'shipper_new_price'), 1,
  'a second price minutes later does not buzz again');

-- ═══ 4. the award, and nothing in between ═════════════════════════════════

select act_as('a0000000-0000-4000-8000-0000000000c1');
select public.accept_driver_bid(:'l1', :'bid_b');
select act_as_reset();
set constraints all immediate; set constraints all deferred;
select assert_equals(pushes(:'db', 'driver_awarded'), 1, 'the winner is told they got the job');
select assert_equals(pushes('a0000000-0000-4000-8000-0000000000c1', 'shipper_assigned'), 1,
  'the shipper is told a driver has the load');
select assert_equals((select count(*) from private.push_log where profile_id = :'db'
                      and kind = 'driver_new_bid' and load_id = :'l1'), 1,
  'the award''s brief reopening of the offer does not tell the winner "new job" again');

-- ═══ 5. picked up and delivered ═══════════════════════════════════════════

select t.id as trip1 from public.trips t where t.load_id = :'l1' \gset
select act_as(:'db');
select public.advance_trip(:'trip1', 'in_transit');
select act_as_reset();
set constraints all immediate; set constraints all deferred;
select assert_equals(pushes('a0000000-0000-4000-8000-0000000000c1', 'shipper_picked_up'), 1, 'picked up buzzes the shipper');
select act_as(:'db');
select public.advance_trip(:'trip1', 'delivered', null, 'pod/test.jpg');
select act_as_reset();
set constraints all immediate; set constraints all deferred;
select assert_equals(pushes('a0000000-0000-4000-8000-0000000000c1', 'shipper_delivered'), 1, 'delivered buzzes the shipper');
select assert_true(last_body_for('a0000000-0000-4000-8000-0000000000c1') = 'Your cargo has arrived in Sohar.',
  'delivered names the town');

-- ═══ 6. a fixed price, set by a person, reaches the shipper — in Arabic ═══

insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status)
values ('b0000000-0000-4000-8000-0000000000c9', 'a0000000-0000-4000-8000-0000000000c2',
        city('Muscat'), city('Nizwa'), tomorrow(), tomorrow(), 'Tiles', 'finding_truck');
update public.loads set price_baisa = 120500, status = 'quoted' where id = 'b0000000-0000-4000-8000-0000000000c9';
set constraints all immediate; set constraints all deferred;
select assert_equals(pushes('a0000000-0000-4000-8000-0000000000c2', 'shipper_price_ready'), 1,
  'a price set on a waiting load reaches the shipper');
select assert_true(last_body('ExponentPushToken[shipperarabicccccc]') = '١٢٠٫٥٠٠ ر.ع. لـ مسقط ← نزوى',
  'an Arabic reader gets Arabic, with Arabic numerals and the arrow reading their way');

-- ═══ 7. the switch, and a push that cannot fail its cause ═════════════════

update private.app_settings set value = 'false'::jsonb where key = 'push_enabled';
update public.loads set status = 'finding_truck' where id = 'b0000000-0000-4000-8000-0000000000c9';
update public.loads set status = 'quoted' where id = 'b0000000-0000-4000-8000-0000000000c9';
set constraints all immediate; set constraints all deferred;
select assert_equals(pushes('a0000000-0000-4000-8000-0000000000c2', 'shipper_price_ready'), 1,
  'with push_enabled off nothing is sent');
update private.app_settings set value = 'true'::jsonb where key = 'push_enabled';

do $$ begin
  perform private.push_send(null, 'broken', null, 't', 'b', 't', 'b', '{}'::jsonb);
  raise notice 'pass: a push that fails raises nothing into the transaction that caused it';
end $$;

do $$ begin raise notice 'ALL PUSH ASSERTIONS HELD'; end $$;

rollback;

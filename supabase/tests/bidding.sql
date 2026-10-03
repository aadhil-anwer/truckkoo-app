-- Driver bidding (0045). Run: npm run test:db:bidding
--
-- now() is fixed inside one transaction, so "time passing" is simulated by
-- moving deadlines and wave stamps into the past as the superuser.

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

create or replace function assert_text(p_actual text, p_expected text, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % — expected %, got %', p_what, coalesce(p_expected, 'NULL'), coalesce(p_actual, 'NULL');
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

create or replace function assert_raises(p_sql text, p_what text, p_like text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_like is not null and sqlerrm not like p_like then
      raise exception 'FAIL: % — raised "%", expected like "%"', p_what, sqlerrm, p_like;
    end if;
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

-- The n-th (0-based) driver currently invited to a load, by driver id.
create or replace function invited(p_load uuid, p_n integer) returns uuid language sql stable as $$
  select o.driver_id from public.offers o
  where o.load_id = p_load and o.source = 'bid' and o.status = 'pending'
  order by o.driver_id offset p_n limit 1
$$;

create or replace function invite_of(p_load uuid, p_driver uuid) returns uuid language sql stable as $$
  select o.id from public.offers o where o.load_id = p_load and o.driver_id = p_driver
$$;

create or replace function bid_offers(p_load uuid) returns bigint language sql stable as $$
  select count(*) from public.offers o where o.load_id = p_load and o.source = 'bid'
$$;

-- ═══ fixtures ═════════════════════════════════════════════════════════════

do $$
declare i integer; u uuid;
begin
  insert into auth.users (id, email) values
    ('a0000000-0000-4000-8000-0000000000b1', 'bid-shipper@test.local'),
    ('a0000000-0000-4000-8000-0000000000b2', 'bid-other-shipper@test.local'),
    ('a0000000-0000-4000-8000-0000000000b3', 'bid-ops@test.local');
  insert into public.profiles (id, role, full_name) values
    ('a0000000-0000-4000-8000-0000000000b1', 'shipper', 'Bid Shipper'),
    ('a0000000-0000-4000-8000-0000000000b2', 'shipper', 'Other Shipper'),
    ('a0000000-0000-4000-8000-0000000000b3', 'shipper', 'Bid Dispatcher');
  insert into private.ops_users (profile_id, note) values ('a0000000-0000-4000-8000-0000000000b3', 'bidding suite');

  for i in 1..12 loop
    u := ('d0000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid;
    insert into auth.users (id, email) values (u, 'bid-d' || i || '@test.local');
    insert into public.profiles (id, role, full_name) values (u, 'driver', 'Bid Driver ' || i);
    insert into public.drivers (profile_id, verified_at) values (u, case when i <= 11 then now() end)
      on conflict (profile_id) do update set verified_at = excluded.verified_at;
    insert into public.trucks (owner_id, truck_type, plate, capacity_kg)
      values (u, '10t', 'B-' || i, 10000);
    insert into public.driver_availability (driver_id, available, city_id, source)
      values (u, true, city('Muscat'), 'manual')
      on conflict (driver_id) do update set available = true, city_id = excluded.city_id;
  end loop;

  insert into private.app_settings (key, value) values ('bid_enough_bids', '3'::jsonb)
    on conflict (key) do update set value = excluded.value;
end $$;

-- ═══ 1. the fee must be set deliberately ══════════════════════════════════

delete from private.app_settings where key = 'bid_fee_pct';
select act_as('a0000000-0000-4000-8000-0000000000b1');
select assert_raises($$select public.post_bid_load(city('Muscat'), city('Sohar'), tomorrow(), tomorrow(), 'Cement', 5000)$$,
  'no bid load without a configured fee', '%fee is not configured%');
select act_as_reset();
insert into private.app_settings (key, value) values ('bid_fee_pct', '10'::jsonb);

select assert_equals(private.bid_total(100000, 0), 100000, 'a 0% fee leaves the total equal to the bid');
select assert_equals(private.bid_total(100000, 1000), 110000, 'a 10% fee is added on top of the bid');

-- ═══ 2. posting, and what is private ══════════════════════════════════════

select act_as('a0000000-0000-4000-8000-0000000000b1');
select public.post_bid_load(city('Muscat'), city('Sohar'), tomorrow(), tomorrow(), 'Cement', 5000) as l1 \gset
select act_as_reset();

select assert_equals(bid_offers(:'l1'), 3, 'posting invites one wave of three');
select assert_true((select price_baisa is null from public.loads where id = :'l1'), 'a bid load carries no price before award');

select assert_true(not exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name in ('loads', 'trips')
    and (column_name like '%fee%' or column_name like '%target%' or column_name like '%payout%')),
  'no fee, target or payout column on a client-readable table');
select assert_true(not has_table_privilege('authenticated', 'private.bid_loads', 'select')
                   and not has_table_privilege('authenticated', 'private.driver_bids', 'select'),
  'bid tables carry no client grant');

-- ═══ 3. pacing — waves, not a flood ═══════════════════════════════════════

select private.system_bid_tick();
select assert_equals(bid_offers(:'l1'), 3, 'no second wave inside bid_wave_minutes');
update private.bid_loads set last_wave_at = now() - interval '6 minutes' where load_id = :'l1';
select private.system_bid_tick();
select assert_equals(bid_offers(:'l1'), 6, 'the next wave goes out once it is due');

select invited(:'l1', 0) as da, invited(:'l1', 1) as db, invited(:'l1', 2) as dc,
       invited(:'l1', 3) as dd \gset

select act_as(:'da');
select public.place_driver_bid(invite_of(:'l1', :'da'), 90000) as bid_a \gset
select act_as(:'db');
select public.place_driver_bid(invite_of(:'l1', :'db'), 100000) as bid_b \gset
select act_as(:'dc');
select public.place_driver_bid(invite_of(:'l1', :'dc'), 95000) as bid_c \gset
select act_as_reset();
-- One transaction gives every bid the same now(); spread them as real bids are.
update private.driver_bids set created_at = now() - interval '3 minutes' where id = :'bid_a';
update private.driver_bids set created_at = now() - interval '2 minutes' where id = :'bid_b';
update private.driver_bids set created_at = now() - interval '1 minute'  where id = :'bid_c';

update private.bid_loads set last_wave_at = now() - interval '6 minutes' where load_id = :'l1';
select private.system_bid_tick();
select assert_equals(bid_offers(:'l1'), 6, 'no new wave while the load holds bid_enough_bids live bids');

-- ═══ 4. drivers see competing bids, semi-anonymised ═══════════════════════

select act_as(:'dd');
select assert_equals((select count(*) from public.driver_load_bids(invite_of(:'l1', :'dd'))), 3,
  'an invited driver who has not bid sees all three bids');
select assert_text((select string_agg(payout_baisa::text, ',' order by payout_baisa)
                    from public.driver_load_bids(invite_of(:'l1', :'dd'))),
  '90000,95000,100000', 'competing bids are shown as payouts, lowest first');
select assert_equals((select count(distinct bidder_no) from public.driver_load_bids(invite_of(:'l1', :'dd'))), 3,
  'each bidder has their own number');
select act_as(:'da');
select assert_equals((select count(*) from public.driver_load_bids(invite_of(:'l1', :'da')) where is_you), 1,
  'a bidder sees their own bid marked');
select assert_equals((select bidder_no from public.driver_load_bids(invite_of(:'l1', :'da')) where is_you), 1,
  'bidder numbers follow the order of first bids');
select act_as('d0000000-0000-4000-8000-000000000112');
select assert_raises(format($$select * from public.driver_load_bids(%L)$$, invite_of(:'l1', :'da')),
  'a driver cannot read bids through somebody else''s invitation', '%not found%');
select act_as('a0000000-0000-4000-8000-0000000000b1');
select assert_raises(format($$select * from public.driver_load_bids(%L)$$, invite_of(:'l1', :'da')),
  'a shipper cannot use the driver bid view', '%not found%');
select act_as_reset();

select assert_true(not exists (
  select 1 from pg_proc p, unnest(p.proargnames) a
  where p.proname in ('driver_load_bids', 'driver_bid_invites')
    and (a like '%name%' and a not like '%pickup_name%' and a not like '%drop_name%'
         or a like '%phone%' or a like '%contact%' or a like '%total%')),
  'driver bid views return no name, phone, contact or shipper total');

-- ═══ 5. the shipper sees totals, never payouts ═════════════════════════════

select act_as('a0000000-0000-4000-8000-0000000000b1');
select assert_text((select string_agg(total_baisa::text, ',' order by total_baisa)
                    from public.shipper_load_bids(:'l1')),
  '99000,104500,110000', 'the shipper sees each bid with the fee added');
select act_as_reset();
select assert_true(not exists (
  select 1 from pg_proc p, unnest(p.proargnames) a
  where p.proname in ('shipper_load_bids', 'shipper_bid_status') and a like '%payout%'),
  'no shipper bid view returns a payout');

select act_as('a0000000-0000-4000-8000-0000000000b2');
select assert_raises(format($$select * from public.shipper_load_bids(%L)$$, :'l1'), 'another shipper cannot list the bids', '%not found%');
select assert_raises(format($$select * from public.shipper_bid_status(%L)$$, :'l1'), 'another shipper cannot read the status', '%not found%');
select assert_raises(format($$select public.accept_driver_bid(%L, %L)$$, :'l1', :'bid_a'), 'another shipper cannot accept', '%not found%');
select assert_raises(format($$select public.close_bidding(%L)$$, :'l1'), 'another shipper cannot close', '%not found%');
select assert_raises(format($$select public.extend_bidding(%L, 30)$$, :'l1'), 'another shipper cannot extend', '%not found%');
select assert_raises(format($$select public.set_bid_target(%L, 1000)$$, :'l1'), 'another shipper cannot set the target', '%not found%');
select act_as_reset();

-- ═══ 6. the old client cannot assign a bid load ════════════════════════════

select act_as(:'dd');
select assert_raises(format($$select public.respond_to_offer(%L, true)$$, invite_of(:'l1', :'dd')),
  'accepting a bid invitation through the old RPC is refused', '%place a bid%');
select assert_equals((select count(*) from public.driver_offers() d where d.offer_id = invite_of(:'l1', :'dd')), 0,
  'the old offer list does not show bid invitations');
select act_as_reset();

-- ═══ 7. a stale tap inside the window changes nothing ══════════════════════

update public.driver_availability set available = false where driver_id = :'da';
select act_as('a0000000-0000-4000-8000-0000000000b1');
select assert_raises(format($$select public.accept_driver_bid(%L, %L)$$, :'l1', :'bid_a'),
  'accepting a bid that went stale is refused while bidding is open', '%no longer available%');
select act_as_reset();
select assert_true((select selected_bid_id is null and bid_deadline > now() from public.loads where id = :'l1'),
  'the stale tap did not close the window');
select act_as(:'dd');
select assert_true(public.place_driver_bid(invite_of(:'l1', :'dd'), 120000) is not null,
  'another driver can still bid after a stale tap');
select act_as_reset();
update public.driver_availability set available = true where driver_id = :'da';

-- ═══ 8. declines and lapses never hand a bid load to a person ══════════════

select act_as('a0000000-0000-4000-8000-0000000000b1');
select public.post_bid_load(city('Muscat'), city('Nizwa'), tomorrow(), tomorrow(), 'Pipes', 5000) as l2 \gset
select act_as_reset();
select invited(:'l2', 0) as e1, invited(:'l2', 1) as e2, invited(:'l2', 2) as e3 \gset
select act_as(:'e1'); select public.respond_to_offer(invite_of(:'l2', :'e1'), false);
select act_as(:'e2'); select public.respond_to_offer(invite_of(:'l2', :'e2'), false);
select act_as(:'e3'); select public.respond_to_offer(invite_of(:'l2', :'e3'), false);
select act_as_reset();
select private.system_sweep_expired_offers();
select assert_text((select status::text from public.loads where id = :'l2'), 'matched',
  'every invitee declining mid-window leaves the load with the bid machine');
update private.bid_loads set last_wave_at = now() - interval '6 minutes' where load_id = :'l2';
select private.system_bid_tick();
select assert_true((select count(*) from public.offers where load_id = :'l2' and status = 'pending') > 0,
  'and the next wave still goes out');

-- The window ends. The 5-minute sweep happens to run before the bid tick.
update public.loads set bid_deadline = now() - interval '1 second' where id = :'l1';
update public.offers set expires_at = now() - interval '1 second' where load_id = :'l1';
select private.system_sweep_expired_offers();
select assert_text((select status::text from public.loads where id = :'l1'), 'matched',
  'the sweep does not move a bid load whose invitations lapsed at the deadline');
select private.system_bid_tick();
select assert_text((select status::text from public.loads where id = :'l1'), 'quoted',
  'the bid tick still judges the bids after the sweep ran first');
select assert_true((select selected_bid_id = :'bid_a' from public.loads where id = :'l1'),
  'the lowest eligible bid is proposed');
select assert_true((select price_baisa is null from public.loads where id = :'l1'),
  'a proposal is not written to loads.price_baisa');

select act_as('a0000000-0000-4000-8000-0000000000b1');
select assert_equals((select selected_total_baisa from public.shipper_bid_status(:'l1')), 99000,
  'the shipper reads the proposed total through shipper_bid_status');
select assert_raises(format($$select public.accept_quote(%L)$$, :'l1'),
  'the fixed-price accept cannot take a bid load', '%no price to accept%');
select act_as_reset();

-- ═══ 9. after the window, a stale proposal is replaced ═════════════════════

update public.driver_availability set available = false where driver_id = :'da';
select act_as('a0000000-0000-4000-8000-0000000000b1');
select assert_true(public.accept_driver_bid(:'l1', :'bid_a') is null, 'accepting a stale proposal assigns nobody');
select act_as_reset();
select assert_true((select selected_bid_id = :'bid_c' and status = 'quoted' from public.loads where id = :'l1'),
  'the next valid bid is proposed instead');

-- ═══ 10. acceptance ════════════════════════════════════════════════════════

select act_as('a0000000-0000-4000-8000-0000000000b1');
select public.accept_driver_bid(:'l1', :'bid_c') as trip1 \gset
select assert_raises($$select * from private.bid_loads$$, 'the shipper cannot read the private bid record');
select act_as_reset();
select assert_true((select status = 'assigned' and price_baisa = 104500 from public.loads where id = :'l1'),
  'acceptance assigns the load at the shown total');
select act_as(:'dc');
select assert_text((select collect_baisa || '/' || payout_baisa || '/' || owed_baisa from public.driver_trip(:'trip1')),
  '104500/95000/9500', 'the winner sees collect, their own bid as payout, and the fee owed');
select act_as(:'dd');
select assert_raises(format($$select * from public.driver_load_bids(%L)$$, invite_of(:'l1', :'dd')),
  'a losing bidder loses the bid view at award', '%not found%');
select assert_equals((select count(*) from public.loads where id = :'l1'), 0,
  'and can no longer read the load or its price');
select act_as_reset();
update public.driver_availability set available = true where driver_id = :'da';

-- ═══ 11. the target price ══════════════════════════════════════════════════

select act_as('a0000000-0000-4000-8000-0000000000b1');
select public.post_bid_load(city('Muscat'), city('Sur'), tomorrow(), tomorrow(), 'Tiles', 5000, null, null, null, 120000) as l3 \gset
select public.post_bid_load(city('Muscat'), city('Ibri'), tomorrow(), tomorrow(), 'Steel', 5000, null, null, null, 105000) as l4 \gset
select assert_equals((select target_total_baisa from public.shipper_bid_status(:'l3')), 120000, 'the shipper reads back their target');
select act_as_reset();

select invited(:'l3', 0) as f1 \gset
select o.driver_id as g1 from public.offers o
where o.load_id = :'l4' and o.status = 'pending' and o.driver_id <> :'f1'
order by o.driver_id limit 1 \gset
select act_as(:'f1');
select public.place_driver_bid(invite_of(:'l3', :'f1'), 100000);
select assert_true(not exists (select 1 from pg_proc p, unnest(p.proargnames) a
                               where p.proname = 'driver_bid_invites' and a like '%target%'),
  'drivers are never shown the target');
select act_as(:'g1');
select public.place_driver_bid(invite_of(:'l4', :'g1'), 100000);
select act_as_reset();

update public.loads set bid_deadline = now() - interval '1 second' where id in (:'l3', :'l4');
select private.system_bid_tick();
select assert_text((select status::text from public.loads where id = :'l3'), 'assigned',
  'a lowest bid within the target (110.000 <= 120.000) is awarded when the window closes');
select assert_true(exists (select 1 from public.trips where load_id = :'l3' and driver_id = :'f1'),
  'and the trip goes to that driver');
select assert_text((select status::text from public.loads where id = :'l4'), 'quoted',
  'a lowest bid above the target (110.000 > 105.000) waits for the shipper');

select act_as('a0000000-0000-4000-8000-0000000000b1');
select public.post_bid_load(city('Muscat'), city('Sohar'), tomorrow(), tomorrow(), 'Glass', 5000) as l5 \gset
select public.set_bid_target(:'l5', 200000);
select act_as_reset();
select assert_equals((select target_total_baisa from private.bid_loads where load_id = :'l5'), 200000,
  'the target can be set after posting');

-- ═══ 12. no bids: reopen, never a person, until the day is over ═══════════

update public.loads set bid_deadline = now() - interval '1 second' where id = :'l5';
select private.system_bid_tick();
select assert_true((select bid_deadline > now() and status in ('posted', 'matched') from public.loads where id = :'l5'),
  'a window that closes with no bids reopens');
select assert_equals((select count(*) from private.ops_alerts where kind = 'bidding_no_driver'), 0,
  'reopening alerts nobody');

update public.loads set pickup_from = (now() at time zone 'Asia/Muscat')::date - 1,
                        pickup_to   = (now() at time zone 'Asia/Muscat')::date - 1,
                        bid_deadline = now() - interval '1 second'
where id = :'l5';
select private.system_bid_tick();
select assert_text((select status::text from public.loads where id = :'l5'), 'finding_truck',
  'once the collection day is over the load falls to a person');
select assert_equals((select count(*) from private.ops_alerts where kind = 'bidding_no_driver'), 1,
  'and one alert is raised');

-- ═══ 13. an open auction is not a stuck load ══════════════════════════════

select private.system_watch_loads();
select assert_true(not exists (select 1 from private.load_watch where load_id = :'l2'),
  'the stuck-load watch ignores an open auction');
select assert_true(exists (select 1 from private.load_watch where load_id = :'l5'),
  'and watches a bid load that fell to finding_truck');

-- ═══ 14. verification follows the launch switch ═══════════════════════════

select assert_true(private.bid_driver_eligible(:'l2', 'd0000000-0000-4000-8000-000000000112'),
  'with require_verified_driver off an unverified driver is eligible, as in dispatch');
update private.app_settings set value = 'true'::jsonb where key = 'require_verified_driver';
select assert_true(not private.bid_driver_eligible(:'l2', 'd0000000-0000-4000-8000-000000000112'),
  'with it on, an unverified driver is not');
update private.app_settings set value = 'false'::jsonb where key = 'require_verified_driver';

do $$ begin raise notice 'ALL BIDDING ASSERTIONS HELD'; end $$;

rollback;

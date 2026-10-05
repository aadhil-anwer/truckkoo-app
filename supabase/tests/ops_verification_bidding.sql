-- Bidding board and driver verification view (0058).
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

do $$
declare r record;
begin
  for r in select * from (values
    ('65000000-0000-4000-8000-0000000000a1'::uuid, 'shipper', 'Board Shipper', null),
    ('65000000-0000-4000-8000-0000000000d1'::uuid, 'driver',  'Bidder One', '+96891000001'),
    ('65000000-0000-4000-8000-0000000000d2'::uuid, 'driver',  'Pending Driver', '+96891000002'),
    ('65000000-0000-4000-8000-0000000000d3'::uuid, 'driver',  'Ready Driver', '+96891000003'),
    ('65000000-0000-4000-8000-0000000000d4'::uuid, 'driver',  'Done Driver', '+96891000004'),
    ('65000000-0000-4000-8000-0000000000f2'::uuid, 'shipper', 'Board Disp', null)) v(id, role, name, phone)
  loop
    insert into auth.users (id, email, email_confirmed_at) values (r.id, r.id || '@vb.test', now());
    insert into public.profiles (id, role, full_name, phone) values (r.id, r.role::public.user_role, r.name, r.phone);
  end loop;
  insert into private.ops_users (profile_id, note, level) values ('65000000-0000-4000-8000-0000000000f2', 'vb suite', 'dispatcher');
  insert into public.trucks (owner_id, truck_type, capacity_kg, plate, verified_at) values
    ('65000000-0000-4000-8000-0000000000d1', '10t', 10000, 'A 1', now()),
    ('65000000-0000-4000-8000-0000000000d2', '10t', 9000, 'B 2', null),
    ('65000000-0000-4000-8000-0000000000d3', '10t', 9500, 'C 3', now()),
    ('65000000-0000-4000-8000-0000000000d4', '10t', 9500, 'D 4', now());
  insert into public.drivers (profile_id, verified_at) values
    ('65000000-0000-4000-8000-0000000000d1', now()), ('65000000-0000-4000-8000-0000000000d4', now())
  on conflict (profile_id) do update set verified_at = excluded.verified_at;
end $$;
-- d2: ID front pending, ID back rejected earlier; d3: all four approved; d4: all four approved and verified.
insert into public.driver_documents (driver_id, kind, object_path, status, review_note, created_at)
select d.id, k.kind, d.id || '/' || k.kind || '/' || gen_random_uuid() || '.jpg',
       case when d.id = '65000000-0000-4000-8000-0000000000d2' and k.kind = 'id_back' then 'rejected'
            when d.id = '65000000-0000-4000-8000-0000000000d2' then 'pending' else 'approved' end,
       case when d.id = '65000000-0000-4000-8000-0000000000d2' and k.kind = 'id_back' then 'Blurry, please retake' end,
       now() - interval '2 hours'
  from (values ('65000000-0000-4000-8000-0000000000d2'::uuid), ('65000000-0000-4000-8000-0000000000d3'::uuid),
               ('65000000-0000-4000-8000-0000000000d4'::uuid)) d(id)
  cross join (values ('id_front'), ('id_back'), ('mulkiya'), ('truck_photo')) k(kind)
 where not (d.id = '65000000-0000-4000-8000-0000000000d2' and k.kind in ('mulkiya', 'truck_photo'));

-- Auctions: L1 closing in 3 min, no bids; L2 taking bids; L3 awarded; L4 closed with no bid.
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status, pricing_mode, bid_deadline, created_at)
values
 ('65000000-0000-4000-8000-000000000101', '65000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'), current_date+1, current_date+1, 'L1', 'matched', 'bid', now() + interval '3 minutes', now() - interval '57 minutes'),
 ('65000000-0000-4000-8000-000000000102', '65000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Nizwa'), current_date+1, current_date+1, 'L2', 'matched', 'bid', now() + interval '40 minutes', now() - interval '20 minutes'),
 ('65000000-0000-4000-8000-000000000103', '65000000-0000-4000-8000-0000000000a1', city('Sohar'), city('Muscat'), current_date+1, current_date+1, 'L3', 'matched', 'bid', now() - interval '5 minutes', now() - interval '2 hours'),
 ('65000000-0000-4000-8000-000000000104', '65000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sur'), current_date+1, current_date+1, 'L4', 'finding_truck', 'bid', now() - interval '1 hour', now() - interval '3 hours');
insert into private.bid_loads (load_id, fee_bps, target_total_baisa) values
 ('65000000-0000-4000-8000-000000000101', 1000, null), ('65000000-0000-4000-8000-000000000102', 1000, 90000), ('65000000-0000-4000-8000-000000000103', 1000, null), ('65000000-0000-4000-8000-000000000104', 1000, null);
insert into public.offers (id, load_id, driver_id, status, source, expires_at) values
 ('65000000-0000-4000-8000-000000000301', '65000000-0000-4000-8000-000000000102', '65000000-0000-4000-8000-0000000000d1', 'pending', 'bid', now() + interval '40 minutes'),
 ('65000000-0000-4000-8000-000000000303', '65000000-0000-4000-8000-000000000103', '65000000-0000-4000-8000-0000000000d1', 'accepted', 'bid', now());
insert into private.driver_bids (id, load_id, offer_id, driver_id, payout_baisa) values
 ('65000000-0000-4000-8000-000000000401', '65000000-0000-4000-8000-000000000102', '65000000-0000-4000-8000-000000000301', '65000000-0000-4000-8000-0000000000d1', 70000),
 ('65000000-0000-4000-8000-000000000403', '65000000-0000-4000-8000-000000000103', '65000000-0000-4000-8000-000000000303', '65000000-0000-4000-8000-0000000000d1', 60000);
update public.loads set selected_bid_id = '65000000-0000-4000-8000-000000000403', price_baisa = private.bid_total(60000, 1000) where id = '65000000-0000-4000-8000-000000000103';

-- ═══ guards ════════════════════════════════════════════════════════════════
select act_as_staff('65000000-0000-4000-8000-0000000000a1', 'aal2', 1);
select assert_not_found($$select * from public.ops_bidding_board()$$, 'a shipper cannot read the bidding board');
select assert_not_found($$select * from public.ops_verification_status()$$, 'a shipper cannot read the verification queue');
select act_as_staff('65000000-0000-4000-8000-0000000000d2', 'aal2', 1);
select assert_not_found($$select * from public.ops_verification_status('65000000-0000-4000-8000-0000000000d2')$$,
  'a driver cannot read even their own review record here');
select act_as_staff('65000000-0000-4000-8000-0000000000f2', 'aal1', null);
select assert_not_found($$select * from public.ops_bidding_board()$$, 'staff without 2FA cannot read the bidding board');

-- ═══ bidding board ═════════════════════════════════════════════════════════
select act_as_staff('65000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table bb on commit drop as select * from public.ops_bidding_board();
select act_as_reset();
select assert_true((select state = 'closing_soon' and bids = 0 from bb where load_id = '65000000-0000-4000-8000-000000000101'),
  'an auction closing in 3 minutes with no bids is closing soon');
select act_as_staff('65000000-0000-4000-8000-0000000000f2', 'aal2', 1);
select assert_true((select load_id from public.ops_bidding_board() limit 1) = '65000000-0000-4000-8000-000000000101',
  'and it is first on the board');
select act_as_reset();
select assert_true((select state = 'taking_bids' and bids = 1 and lowest_total_baisa = private.bid_total(70000, 1000)
                      and lowest_driver = 'Bidder One' and target_total_baisa = 90000 from bb where load_id = '65000000-0000-4000-8000-000000000102'),
  'a live auction shows its bids, lowest total, who, and the shipper''s limit');
select assert_true((select state = 'awarded' and awarded_total_baisa = private.bid_total(60000, 1000) from bb where load_id = '65000000-0000-4000-8000-000000000103'),
  'an awarded auction shows what it went for');
select assert_true((select state = 'closed_no_bid' from bb where load_id = '65000000-0000-4000-8000-000000000104'),
  'an auction that closed with no bid says so');
select act_as_staff('65000000-0000-4000-8000-0000000000f2', 'aal2', 1);
select assert_true(not exists (select 1 from public.ops_bidding_board(false) where state in ('awarded', 'closed_no_bid')),
  'live only: closed auctions are left out');
select act_as_reset();

-- ═══ verification queue ════════════════════════════════════════════════════
select act_as_staff('65000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table vq on commit drop as select * from public.ops_verification_status();
create temp table v4 on commit drop as select * from public.ops_verification_status('65000000-0000-4000-8000-0000000000d4');
create temp table bd on commit drop as select * from public.ops_board();
select act_as_reset();
select assert_true((select pending = 1 and rejected = 1 and not ready_driver from vq where driver_id = '65000000-0000-4000-8000-0000000000d2'),
  'a driver with a pending document is in the queue');
select assert_true((select d ->> 'review_note' = 'Blurry, please retake' from vq, jsonb_array_elements(docs) d
                     where driver_id = '65000000-0000-4000-8000-0000000000d2' and d ->> 'kind' = 'id_back'),
  'and the previous rejection reason is visible');
select assert_true((select ready_driver and truck_verified and not driver_verified and plate = 'C 3' and capacity_kg = 9500
                      from vq where driver_id = '65000000-0000-4000-8000-0000000000d3'),
  'a driver with everything approved is in the queue, ready to verify, with their truck');
select assert_true(not exists (select 1 from vq where driver_id = '65000000-0000-4000-8000-0000000000d4'),
  'a verified driver is not in the queue');
select assert_true((select driver_verified and approved = 4 from v4), 'but their record still opens by id');
select assert_true(exists (select 1 from bd where kind = 'docs_pending' and target_id = '65000000-0000-4000-8000-0000000000d2'
                             and reason like '1 document waiting for %'),
  'documents waiting for review are on the live board, counted in plain English');
select assert_true((select (select count(*) from vq where driver_id = '65000000-0000-4000-8000-0000000000d2') = 1),
  'one row per driver');

select assert_true(
  (select bool_and(coalesce(p.proconfig, '{}') @> array['search_path=""'] and p.provolatile = 's')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('ops_bidding_board', 'ops_verification_status', 'ops_board'))
  and not has_function_privilege('anon', 'public.ops_bidding_board(boolean)', 'execute')
  and not has_function_privilege('anon', 'public.ops_verification_status(uuid)', 'execute'),
  '0058 reads are stable, pinned, never anonymous');

do $$ begin raise notice 'ALL VERIFICATION/BIDDING ASSERTIONS HELD'; end $$;
rollback;

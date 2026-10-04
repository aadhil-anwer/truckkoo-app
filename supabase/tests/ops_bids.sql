-- Ops console v2, phase 4 — bids for staff, award/extend for owners (0063).
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
    ('63000000-0000-4000-8000-0000000000a1'::uuid, 'shipper', 'Bid Shipper'),
    ('63000000-0000-4000-8000-0000000000d1'::uuid, 'driver',  'Driver One'),
    ('63000000-0000-4000-8000-0000000000d2'::uuid, 'driver',  'Driver Two'),
    ('63000000-0000-4000-8000-0000000000f1'::uuid, 'shipper', 'Bids Owner'),
    ('63000000-0000-4000-8000-0000000000f2'::uuid, 'shipper', 'Bids Disp')) v(id, role, name)
  loop
    insert into auth.users (id, email, email_confirmed_at) values (r.id, r.id || '@bids.test', now());
    insert into public.profiles (id, role, full_name) values (r.id, r.role::public.user_role, r.name);
  end loop;
  insert into public.trucks (owner_id, truck_type, capacity_kg) values
    ('63000000-0000-4000-8000-0000000000d1', '10t', 10000),
    ('63000000-0000-4000-8000-0000000000d2', '10t', 10000);
  insert into private.ops_users (profile_id, note, level) values
    ('63000000-0000-4000-8000-0000000000f1', 'bids suite', 'owner'),
    ('63000000-0000-4000-8000-0000000000f2', 'bids suite', 'dispatcher');
end $$;

insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, weight_kg, status, pricing_mode, bid_deadline)
values ('63000000-0000-4000-8000-000000000101', '63000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'),
        current_date + 1, current_date + 1, 'bid cargo', 8000, 'matched', 'bid', now() + interval '30 minutes');
insert into private.bid_loads (load_id, fee_bps) values ('63000000-0000-4000-8000-000000000101', 1000);
insert into public.offers (id, load_id, driver_id, status, source, expires_at) values
  ('63000000-0000-4000-8000-000000000301', '63000000-0000-4000-8000-000000000101', '63000000-0000-4000-8000-0000000000d1', 'pending', 'bid', now() + interval '30 minutes'),
  ('63000000-0000-4000-8000-000000000302', '63000000-0000-4000-8000-000000000101', '63000000-0000-4000-8000-0000000000d2', 'pending', 'bid', now() + interval '30 minutes');
insert into private.driver_bids (id, load_id, offer_id, driver_id, payout_baisa) values
  ('63000000-0000-4000-8000-000000000401', '63000000-0000-4000-8000-000000000101', '63000000-0000-4000-8000-000000000301', '63000000-0000-4000-8000-0000000000d1', 72000),
  ('63000000-0000-4000-8000-000000000402', '63000000-0000-4000-8000-000000000101', '63000000-0000-4000-8000-000000000302', '63000000-0000-4000-8000-0000000000d2', 70000);
-- Driver Two has since gone offline: no longer eligible.
update public.driver_availability set available = false where driver_id = '63000000-0000-4000-8000-0000000000d2';
update public.driver_availability set available = true where driver_id = '63000000-0000-4000-8000-0000000000d1';

-- ═══ reading bids ══════════════════════════════════════════════════════════
select act_as_staff('63000000-0000-4000-8000-0000000000a1', 'aal2', 1);
select assert_not_found($$select * from public.ops_load_bids('63000000-0000-4000-8000-000000000101')$$, 'a shipper cannot read the fee split');
select act_as_staff('63000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table bids on commit drop as select * from public.ops_load_bids('63000000-0000-4000-8000-000000000101');
select act_as_reset();
select assert_true((select count(*) = 2 from bids), 'staff see every bid');
select assert_true((select total_baisa = private.bid_total(72000, 1000) and fee_baisa = total_baisa - payout_baisa
                      from bids where bid_id = '63000000-0000-4000-8000-000000000401'),
  'each bid shows payout, total and the fee between them');
select assert_true((select eligible from bids where bid_id = '63000000-0000-4000-8000-000000000401')
               and not (select eligible from bids where bid_id = '63000000-0000-4000-8000-000000000402'),
  'and whether that driver can still take it');

-- ═══ guards on the overrides ═══════════════════════════════════════════════
select act_as_staff('63000000-0000-4000-8000-0000000000f2', 'aal2', 1);
select assert_not_found($$select public.ops_award_bid('63000000-0000-4000-8000-000000000101', '63000000-0000-4000-8000-000000000401', 'shipper asked')$$,
  'a dispatcher cannot award a bid');
select assert_not_found($$select public.ops_extend_bidding('63000000-0000-4000-8000-000000000101', 30, 'quiet day')$$,
  'a dispatcher cannot extend bidding');
select act_as_staff('63000000-0000-4000-8000-0000000000f1', 'aal2', 16);
select assert_raises($$select public.ops_award_bid('63000000-0000-4000-8000-000000000101', '63000000-0000-4000-8000-000000000401', 'shipper asked')$$,
  'an owner with stale 2FA must step up', 'step-up required');

-- ═══ extend ════════════════════════════════════════════════════════════════
select act_as_staff('63000000-0000-4000-8000-0000000000f1', 'aal2', 1);
select assert_raises($$select public.ops_extend_bidding('63000000-0000-4000-8000-000000000101', 30, '')$$, 'an extension needs a reason', '%reason%');
select assert_raises($$select public.ops_extend_bidding('63000000-0000-4000-8000-000000000101', 1440, 'too long')$$,
  'extending past 24 hours from posting is refused', '%too late%');
select public.ops_extend_bidding('63000000-0000-4000-8000-000000000101', 30, 'shipper asked for more prices');
select act_as_reset();
select assert_true((select bid_deadline > now() + interval '55 minutes' from public.loads where id = '63000000-0000-4000-8000-000000000101'),
  'an owner extends the window');
select assert_true((select bool_and(expires_at > now() + interval '55 minutes') from public.offers
                     where load_id = '63000000-0000-4000-8000-000000000101' and status = 'pending'),
  'and every pending invitation with it');

-- ═══ award ═════════════════════════════════════════════════════════════════
select act_as_staff('63000000-0000-4000-8000-0000000000f1', 'aal2', 1);
select assert_raises($$select public.ops_award_bid('63000000-0000-4000-8000-000000000101', '63000000-0000-4000-8000-000000000402', 'cheapest')$$,
  'awarding to a driver who can no longer take it is refused', '%can no longer take it%');
select public.ops_award_bid('63000000-0000-4000-8000-000000000101', '63000000-0000-4000-8000-000000000401', 'shipper asked by phone') as trip \gset
select act_as_reset();
select assert_true((select count(*) = 1 from public.trips where load_id = '63000000-0000-4000-8000-000000000101' and driver_id = '63000000-0000-4000-8000-0000000000d1'),
  'an owner awards a bid: the driver has the trip');
select assert_true((select price_baisa = private.bid_total(72000, 1000) and selected_bid_id = '63000000-0000-4000-8000-000000000401'
                      from public.loads where id = '63000000-0000-4000-8000-000000000101'),
  'and the shipper''s price is the bid''s total');
select assert_true((select count(*) = 1 from private.ops_audit where action = 'ops_award_bid' and reason = 'shipper asked by phone'
                      and actor_id = '63000000-0000-4000-8000-0000000000f1'),
  'the award is audited with who and why');
select assert_true((select count(*) >= 2 from private.ops_alerts where kind = 'owner_override'),
  'every owner override emails (extend and award)');
select act_as_staff('63000000-0000-4000-8000-0000000000f1', 'aal2', 1);
select assert_raises($$select public.ops_award_bid('63000000-0000-4000-8000-000000000101', '63000000-0000-4000-8000-000000000401', 'again')$$,
  'a load that already has a driver cannot be awarded again', '%already%');
select act_as_reset();

select assert_true(
  (select bool_and(coalesce(p.proconfig, '{}') @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('ops_load_bids', 'ops_award_bid', 'ops_extend_bidding'))
  and (select provolatile = 'v' from pg_proc where proname = 'ops_award_bid')
  and (select provolatile = 'v' from pg_proc where proname = 'ops_extend_bidding')
  and not has_function_privilege('anon', 'public.ops_award_bid(uuid,uuid,text)', 'execute'),
  '0063 functions are pinned, writers volatile, nothing anonymous');

do $$ begin raise notice 'ALL OPS BIDS ASSERTIONS HELD'; end $$;
rollback;

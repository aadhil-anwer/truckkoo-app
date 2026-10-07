-- Ops console v2, phase 6 — money & system (0060).
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

-- f1 owner, f2 dispatcher (both staff-domain accounts), a1 shipper, s1 a fresh
-- staff-domain account not yet staff.
insert into private.app_settings (key, value) values ('staff_email_domains', '["truckkoo.com"]'::jsonb);
do $$
declare r record;
begin
  for r in select * from (values
    ('66000000-0000-4000-8000-0000000000f1'::uuid, 'owner6@truckkoo.com', 'Money Owner'),
    ('66000000-0000-4000-8000-0000000000f2'::uuid, 'disp6@truckkoo.com', 'Money Disp'),
    ('66000000-0000-4000-8000-0000000000a1'::uuid, 'shipper6@example.com', 'Money Shipper'),
    ('66000000-0000-4000-8000-0000000000e1'::uuid, 'new6@truckkoo.com', 'New Staffer')) v(id, email, name)
  loop
    insert into auth.users (id, email, email_confirmed_at) values (r.id, r.email, now());
    insert into public.profiles (id, role, full_name) values (r.id, 'shipper', r.name);
  end loop;
  insert into private.ops_users (profile_id, note, level) values
    ('66000000-0000-4000-8000-0000000000f1', 'money suite', 'owner'),
    ('66000000-0000-4000-8000-0000000000f2', 'money suite', 'dispatcher');
end $$;
insert into public.loads (shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status)
values ('66000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'), current_date + 1, current_date + 1, 'boxes', 'posted');
update private.app_settings set value = '0'::jsonb where key = 'commission_pct';

-- ═══ 1. a dispatcher cannot touch money or rules ═══════════════════════════
select act_as_staff('66000000-0000-4000-8000-0000000000f2', 'aal2', 1);
select assert_not_found($$select public.ops_set_commission(10, 'board rate')$$, 'a dispatcher cannot set the commission');
select assert_not_found($$select public.ops_set_bid_fee(10, 'board rate')$$, 'a dispatcher cannot set the bid fee');
select assert_not_found($$select public.ops_upsert_rate_card('Batinah', 'Batinah', '10t', 1000, 100, 2000, 'new band')$$, 'a dispatcher cannot write the rate card');
select assert_not_found($$select public.ops_delete_rate_card(1, 'old band')$$, 'a dispatcher cannot delete a rate band');
select assert_not_found($$select public.ops_set_setting('bid_window_minutes', '90'::jsonb, 'longer auctions')$$, 'a dispatcher cannot change a setting');
select assert_not_found($$select * from public.ops_find_staff_account('new6@truckkoo.com')$$, 'a dispatcher cannot look up staff accounts');

-- ═══ 2. an owner with stale 2FA must step up ═══════════════════════════════
select act_as_staff('66000000-0000-4000-8000-0000000000f1', 'aal2', 20);
select assert_raises($$select public.ops_set_commission(10, 'board rate')$$, 'stale owner: commission needs step-up', 'step-up required');
select assert_raises($$select public.ops_set_bid_fee(10, 'board rate')$$, 'stale owner: bid fee needs step-up', 'step-up required');
select assert_raises($$select public.ops_upsert_rate_card('Batinah', 'Batinah', '10t', 1000, 100, 2000, 'new band')$$, 'stale owner: rate card needs step-up', 'step-up required');
select assert_raises($$select public.ops_delete_rate_card(1, 'old band')$$, 'stale owner: deleting a band needs step-up', 'step-up required');
select assert_raises($$select public.ops_set_setting('bid_window_minutes', '90'::jsonb, 'longer auctions')$$, 'stale owner: a setting needs step-up', 'step-up required');

-- ═══ 3. an owner, fresh: money ═════════════════════════════════════════════
select act_as_reset();
delete from private.app_settings where key = 'bid_fee_pct';
select act_as_staff('66000000-0000-4000-8000-0000000000f2', 'aal2', 1);
select assert_true(public.ops_bid_fee() is null, 'an unset bid fee reads as null (bid loads cannot be posted yet)');
select act_as_staff('66000000-0000-4000-8000-0000000000a1', 'aal2', 1);
select assert_not_found($$select public.ops_bid_fee()$$, 'a shipper cannot read the bid fee');
select act_as_staff('66000000-0000-4000-8000-0000000000f1', 'aal2', 1);
select public.ops_set_commission(12.5, 'Board rate, October');
select public.ops_set_bid_fee(8, 'Launch fee');
create temp table band on commit drop as
  select public.ops_upsert_rate_card((select corridor from public.cities where name_en = 'Muscat'),
                                     (select corridor from public.cities where name_en = 'Sohar'),
                                     '10t', 30000, 2000, 40000, 'First Batinah band') id;
grant select on band to authenticated;
select public.ops_delete_rate_card((select id from band), 'Typo in the base fare');
select act_as_reset();
select assert_true((select count(*) = 4 from private.ops_audit a
                     where a.actor_id = '66000000-0000-4000-8000-0000000000f1'
                       and a.action in ('ops_set_commission', 'ops_set_bid_fee', 'ops_upsert_rate_card', 'ops_delete_rate_card')
                       and a.reason is not null),
  'each money change is audited with its reason');
select assert_true((select count(*) = 4 from private.ops_alerts where kind = 'owner_money_change'),
  'and each raises an owner alert');
select assert_true(private.payout_for(100000) = 87500, 'the commission really changed');
select act_as_staff('66000000-0000-4000-8000-0000000000f2', 'aal2', 1);
select assert_true(public.ops_bid_fee() = 8, 'staff read the bid fee in force');
select act_as_reset();

-- ═══ 3c. one price for a truck type, every route (0071) ═══════════════════
select act_as_staff('66000000-0000-4000-8000-0000000000f2', 'aal2', 1);
select assert_not_found($$select public.ops_set_rate_for_type('pickup', 2000, 0, 3000, 'launch', 150, 15, 500)$$,
  'a dispatcher cannot set a price for every route');
select act_as_staff('66000000-0000-4000-8000-0000000000f1', 'aal2', 20);
select assert_raises($$select public.ops_set_rate_for_type('pickup', 2000, 0, 3000, 'launch', 150, 15, 500)$$,
  'stale owner: a price for every route needs step-up', 'step-up required');
select act_as_staff('66000000-0000-4000-8000-0000000000f1', 'aal2', 1);
select assert_raises($$select public.ops_set_rate_for_type('pickup', 2000, 0, 3000, '', 150, 15, 500)$$,
  'a price for every route needs a reason', '%reason%');
select assert_raises($$select public.ops_set_rate_for_type('pickup', 2000, 0, 3000, 'launch', 150, 15, null)$$,
  'and the same validation as one band (waiting terms both or neither)', '%both%');
-- 0072: a correction right after a bulk save must go through — before 0072
-- the first save spent 64 of the hour's 100 single-band allowance.
select public.ops_set_rate_for_type('pickup', 2000, 0, 3000, 'First try, typo in per km', 10000, 15, 500);
create temp table bulk on commit drop as
  select public.ops_set_rate_for_type('pickup', 2000, 0, 3000, 'Launch pickup rate', 150, 15, 500) n;
select assert_true(true, 'two bulk saves in a row both go through (one change each, not 64)');
select act_as_reset();
select assert_true(
  (select n from bulk) = (select count(distinct corridor) ^ 2 from public.cities where corridor is not null),
  'it writes every ordered corridor pair');
select assert_true(
  (select count(*) = (select n from bulk) from private.rate_cards
    where truck_type_code = 'pickup' and base_baisa = 2000 and per_km_baisa = 150 and min_fare_baisa = 3000
      and wait_free_minutes = 15 and wait_per_15min_baisa = 500),
  'with the same terms on every route');
select assert_true(
  (select count(*) = (select n from bulk) from private.ops_audit
    where action = 'ops_upsert_rate_card' and reason = 'Launch pickup rate'),
  'each band is audited with the reason');
select assert_true(
  (select count(*) = 2 from private.ops_alerts
    where kind = 'owner_money_change' and detail ->> 'action' = 'ops_set_rate_for_type'),
  'and the owner is alerted once per bulk save, not once per route');
select assert_true(
  not exists (select 1 from pg_constraint
               where conrelid = 'public.quotes'::regclass and confrelid = 'private.rate_cards'::regclass),
  'a band that priced a quote can be deleted: quotes keep its id without a foreign key');

-- ═══ 4. settings: the registry ═════════════════════════════════════════════
select act_as_staff('66000000-0000-4000-8000-0000000000f1', 'aal2', 1);
select public.ops_set_setting('bid_window_minutes', '90'::jsonb, 'Longer auctions at launch');
select assert_raises($$select public.ops_set_setting('dispatch_max_waves', '0'::jsonb, 'none')$$, 'out of range is refused', '%between%');
select assert_raises($$select public.ops_set_setting('push_enabled', '3'::jsonb, 'typo')$$, 'wrong type is refused', '%true or false%');
select assert_not_found($$select public.ops_set_setting('ops_stepup_minutes', '600'::jsonb, 'convenience')$$, 'the step-up window is not writable from the console');
select assert_not_found($$select public.ops_set_setting('staff_email_domains', '["gmail.com"]'::jsonb, 'convenience')$$, 'nor the staff domains');
select assert_raises($$select public.ops_set_setting('bid_window_minutes', '60'::jsonb, ' ')$$, 'a setting change needs a reason', '%reason%');
-- Review fixes: dispatch reads radius_km_<wave> and only three exist, so more
-- than three waves would search the 1500 km default; and the radii widen.
select assert_raises($$select public.ops_set_setting('dispatch_max_waves', '4'::jsonb, 'more waves')$$,
  'there are only three wave radii, so at most three waves', '%between 1 and 3%');
select assert_raises($$select public.ops_set_setting('dispatch_radius_km_1', '2000'::jsonb, 'wider first')$$,
  'a first wave wider than the second is refused', '%at least as far%');
create temp table rc on commit drop as select * from public.ops_rate_cards();
create temp table sets on commit drop as select * from public.ops_settings();
select act_as_reset();
select assert_true((select value = '90'::jsonb from private.app_settings where key = 'bid_window_minutes'), 'the setting changed');
select assert_true((select value = '150'::jsonb from private.app_settings where key = 'dispatch_radius_km_1'),
  'and the refused radius left the old one in place');
select assert_true((select label = 'Drivers asked per wave' from sets where key = 'auto_dispatch_max_offers'),
  'max offers is described as what it is since 0036: the wave size');
select assert_true(exists (select 1 from information_schema.routines r
                            join information_schema.parameters pa on pa.specific_name = r.specific_name
                           where r.routine_schema = 'public' and r.routine_name = 'ops_rate_cards'
                             and pa.parameter_mode = 'OUT' and pa.parameter_name = 'per_km_baisa'),
  'the rate card read includes the per-km rate, so replacing a band can keep it');
select assert_true((select reason = 'Longer auctions at launch' from private.ops_audit where action = 'ops_set_setting'), 'audited with its reason');
select assert_true((select count(*) = 1 from private.ops_alerts where kind = 'owner_rules_change'), 'and alerted');
select assert_true(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                where n.nspname = 'public' and p.proname = 'ops_set_setting' and p.pronargs = 2),
  'the old reasonless signature is gone');
select assert_true((select count(*) = (select count(*) from private.ops_setting_spec()) from sets)
               and (select value = '90'::jsonb from sets where key = 'bid_window_minutes')
               and not exists (select 1 from sets where key in ('ops_stepup_minutes', 'staff_email_domains', 'commission_pct')),
  'ops_settings lists exactly the registry, with current values');

-- ═══ 5. finding a staff account ════════════════════════════════════════════
select act_as_staff('66000000-0000-4000-8000-0000000000f1', 'aal2', 1);
create temp table found_new on commit drop as select * from public.ops_find_staff_account('NEW6@truckkoo.com');
create temp table found_ship on commit drop as select * from public.ops_find_staff_account('shipper6@example.com');
select assert_not_found($$select * from public.ops_find_staff_account('nobody@truckkoo.com')$$, 'an unknown email is not found');
select act_as_reset();
select assert_true((select account_ok and staff_level is null and profile_id = '66000000-0000-4000-8000-0000000000e1' from found_new),
  'a confirmed staff-domain account can be appointed (email matched case-insensitively)');
select assert_true((select not account_ok from found_ship), 'a customer account cannot');

-- ═══ 6. logs and health for everyone ═══════════════════════════════════════
update private.ops_alerts set acknowledged_at = now(), acknowledged_by = '66000000-0000-4000-8000-0000000000f2'
 where id = (select min(id) from private.ops_alerts where kind = 'owner_money_change');
select act_as_staff('66000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table al_open on commit drop as select * from public.ops_alert_log(true);
create temp table al_all on commit drop as select * from public.ops_alert_log(false, 2, 0);
create temp table au on commit drop as select * from public.ops_audit_find(array['ops_set_commission', 'ops_set_bid_fee'], null, null, 1, 1);
create temp table jh on commit drop as select public.ops_job_health() j;
select act_as_reset();
select assert_true((select count(*) = 6 from al_open), 'open alerts exclude the acknowledged one (§3 four, §3c two, settings one; one acknowledged)');
select assert_true((select count(*) = 2 and bool_and(total_count = 7) from al_all), 'all alerts page with a total');
select assert_true((select count(*) = 1 and bool_and(total_count = 2) and bool_and(action in ('ops_set_commission', 'ops_set_bid_fee')) from au),
  'audit search filters by action and pages');
select assert_true((select j = private.system_health() from jh), 'job health is system_health, readable by a dispatcher');
select act_as_staff('66000000-0000-4000-8000-0000000000a1', 'aal2', 1);
select assert_not_found($$select * from public.ops_alert_log()$$, 'a shipper cannot read alerts');
select assert_not_found($$select * from public.ops_audit_find()$$, 'nor the audit log');
select assert_not_found($$select public.ops_job_health()$$, 'nor job health');
select act_as_reset();

-- ═══ 7. static ═════════════════════════════════════════════════════════════
select assert_true((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('ops_set_commission', 'ops_set_bid_fee', 'ops_upsert_rate_card',
                       'ops_delete_rate_card', 'ops_set_setting', 'ops_settings', 'ops_find_staff_account', 'ops_alert_log',
                       'ops_audit_find', 'ops_job_health', 'ops_bid_fee', 'ops_set_rate_for_type')),
  'every new or wrapped function is a pinned definer');
select assert_true((select bool_and(p.provolatile = 'v') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('ops_set_commission', 'ops_set_bid_fee', 'ops_upsert_rate_card',
                       'ops_delete_rate_card', 'ops_set_setting', 'ops_set_rate_for_type')),
  'writers are volatile');
select assert_true((select bool_and(not has_function_privilege('authenticated', p.oid, 'execute'))
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'private' and p.proname like 'ops\_%\_impl'),
  'the wrapped bodies are not callable by clients');
select assert_true((select count(*) = 4 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'private' and p.proname like 'ops\_%\_impl'),
  'and all four exist');

rollback;

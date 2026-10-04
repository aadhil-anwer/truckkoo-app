-- Ops console v2, phase 1 — levels and the fort (0060).
-- Run: docker exec -i supabase_db_truckkoo-app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/ops_v2.sql
begin;

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

-- ─── fixtures ───────────────────────────────────────────────────────────────
-- owner@truckkoo.com (owner), disp@truckkoo.com (dispatcher),
-- gmail@example.com (dispatcher row, wrong domain), busy@truckkoo.com
-- (dispatcher row, but has posted a load), plain@truckkoo.com (not staff).
do $$
declare
  r record;
begin
  for r in select * from (values
    ('60000000-0000-4000-8000-000000000001'::uuid, 'owner@truckkoo.com'),
    ('60000000-0000-4000-8000-000000000002'::uuid, 'disp@truckkoo.com'),
    ('60000000-0000-4000-8000-000000000003'::uuid, 'gmail@example.com'),
    ('60000000-0000-4000-8000-000000000004'::uuid, 'busy@truckkoo.com'),
    ('60000000-0000-4000-8000-000000000005'::uuid, 'plain@truckkoo.com')) v(id, email)
  loop
    insert into auth.users (id, email, email_confirmed_at) values (r.id, r.email, now());
    insert into public.profiles (id, role, full_name) values (r.id, 'shipper', split_part(r.email, '@', 1));
  end loop;
  insert into private.ops_users (profile_id, note, level) values
    ('60000000-0000-4000-8000-000000000001', 'v2 suite', 'owner'),
    ('60000000-0000-4000-8000-000000000002', 'v2 suite', 'dispatcher'),
    ('60000000-0000-4000-8000-000000000003', 'v2 suite', 'dispatcher'),
    ('60000000-0000-4000-8000-000000000004', 'v2 suite', 'dispatcher');
  insert into public.loads (shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description)
  select '60000000-0000-4000-8000-000000000004', c1.id, c2.id, current_date + 1, current_date + 1, 'busy cargo'
    from public.cities c1, public.cities c2 where c1.name_en = 'Muscat' and c2.name_en = 'Sohar';
end $$;

-- The migration's default; legacy suites delete it, this one relies on it.
select assert_true(
  (select value = '["truckkoo.com"]'::jsonb from private.app_settings where key = 'staff_email_domains'),
  'the staff email domain defaults to truckkoo.com');

-- ═══ 1. levels and identity ═════════════════════════════════════════════════
select assert_true(
  (select count(*) = 0 from private.ops_users where level not in ('owner', 'dispatcher')),
  'every staff row has a valid level');
select assert_raises(
  $$insert into private.ops_users (profile_id, level) values ('60000000-0000-4000-8000-000000000005', 'god')$$,
  'a level outside owner/dispatcher is refused');

select act_as_staff('60000000-0000-4000-8000-000000000002', 'aal1', null, 'postgres');
select assert_true(private.ops_level() = 'dispatcher', 'ops_level reports a dispatcher even before 2FA');
select act_as_staff('60000000-0000-4000-8000-000000000005', 'aal2', 0, 'postgres');
select assert_true(private.ops_level() is null, 'ops_level is null for a non-staff account');
select act_as_reset();

select assert_true(private.staff_account_ok('60000000-0000-4000-8000-000000000001'),
  'a confirmed truckkoo.com account with no customer activity is a staff account');
select assert_true(not private.staff_account_ok('60000000-0000-4000-8000-000000000003'),
  'an account on another email domain is not');
select assert_true(not private.staff_account_ok('60000000-0000-4000-8000-000000000004'),
  'an account that has posted a load is not');
update auth.users set email_confirmed_at = null where id = '60000000-0000-4000-8000-000000000002';
select assert_true(not private.staff_account_ok('60000000-0000-4000-8000-000000000002'),
  'an unconfirmed account is not');
update auth.users set email_confirmed_at = now() where id = '60000000-0000-4000-8000-000000000002';

-- ═══ 2. the gate: 2FA, account rules, owner tier ═══════════════════════════
select act_as_staff('60000000-0000-4000-8000-000000000002', 'aal1', null);
select assert_true(not private.is_ops(), 'a dispatcher without 2FA this session is not ops');
select assert_not_found($$select * from public.ops_queue()$$, 'and every ops function refuses them as not found');
select act_as_staff('60000000-0000-4000-8000-000000000002', 'aal2', 1);
select assert_true(private.is_ops(), 'with 2FA verified, a dispatcher is ops');
select act_as_staff('60000000-0000-4000-8000-000000000003', 'aal2', 1);
select assert_true(not private.is_ops(), 'a wrong-domain staff row is not ops, even with 2FA');
select act_as_staff('60000000-0000-4000-8000-000000000004', 'aal2', 1);
select assert_true(not private.is_ops(), 'a staff row on a customer account is not ops, even with 2FA');

select act_as_staff('60000000-0000-4000-8000-000000000002', 'aal2', 1, 'postgres');
select assert_true(not private.is_owner(), 'a dispatcher is not an owner');
select assert_not_found($$select private.require_owner()$$, 'require_owner refuses a dispatcher as not found');
select act_as_staff('60000000-0000-4000-8000-000000000001', 'aal1', null, 'postgres');
select assert_not_found($$select private.require_owner()$$, 'require_owner refuses an owner without 2FA as not found');
select act_as_staff('60000000-0000-4000-8000-000000000001', 'aal2', 5, 'postgres');
select private.require_owner();
select private.require_owner_fresh();
select assert_true(true, 'an owner with 2FA 5 minutes old passes require_owner and require_owner_fresh');
select act_as_staff('60000000-0000-4000-8000-000000000001', 'aal2', 16, 'postgres');
select private.require_owner();
select assert_raises($$select private.require_owner_fresh()$$,
  'stale amr: an owner whose 2FA is 16 minutes old must step up', 'step-up required');
select act_as_staff('60000000-0000-4000-8000-000000000002', 'aal2', 16, 'postgres');
select assert_not_found($$select private.require_owner_fresh()$$,
  'require_owner_fresh never tells a dispatcher that step-up exists');
select act_as_reset();

do $$ begin raise notice 'ALL OPS V2 ASSERTIONS HELD'; end $$;
rollback;

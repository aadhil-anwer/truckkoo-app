-- Support desk S4 — the owner's support numbers (0067).
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
    ('6c000000-0000-4000-8000-0000000000f1'::uuid, 'shipper', 'Met Owner'),
    ('6c000000-0000-4000-8000-0000000000f2'::uuid, 'shipper', 'Met Disp'),
    ('6c000000-0000-4000-8000-0000000000a1'::uuid, 'shipper', 'Met Shipper'),
    ('6c000000-0000-4000-8000-0000000000d1'::uuid, 'driver',  'Met Driver')) v(id, role, name)
  loop
    insert into auth.users (id, email, email_confirmed_at) values (r.id, r.id || '@met.test', now());
    insert into public.profiles (id, role, full_name) values (r.id, r.role::public.user_role, r.name);
  end loop;
  insert into private.ops_users (profile_id, note, level) values
    ('6c000000-0000-4000-8000-0000000000f1', 'met', 'owner'), ('6c000000-0000-4000-8000-0000000000f2', 'met', 'dispatcher');
end $$;
-- Every suite rolls back and testdb.sh resets first, so these are the only cases.
insert into public.shipment_cases (kind, details, reporter_id, subject_id, created_at, responded_at, status, outcome, resolved_at) values
  ('damage', 'MET case one opened and answered', '6c000000-0000-4000-8000-0000000000a1', '6c000000-0000-4000-8000-0000000000d1',
     now() - interval '3 days', now() - interval '3 days' + interval '20 minutes', 'resolved', 'driver_warned', now() - interval '2 days'),
  ('delay', 'MET case two still open', '6c000000-0000-4000-8000-0000000000a1', '6c000000-0000-4000-8000-0000000000d1',
     now() - interval '1 day', null, 'new', null, null),
  ('other', 'MET case three last month', '6c000000-0000-4000-8000-0000000000a1', null,
     now() - interval '10 days', now() - interval '10 days' + interval '1 hour', 'in_progress', null, null);
update public.shipment_cases set due_at = now() - interval '1 hour' where details = 'MET case two still open';
insert into private.incidents (subject_id, kind, weight, state, source, confirmed_at, decided_at, created_at) values
  ('6c000000-0000-4000-8000-0000000000d1', 'release', 1, 'confirmed', 'release', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days'),
  ('6c000000-0000-4000-8000-0000000000d1', 'no_show', 2, 'suspected', 'detector', null, null, now() - interval '1 day');

select act_as_staff('6c000000-0000-4000-8000-0000000000f2', 'aal2', 1);
select assert_not_found($$select public.ops_support_metrics('7d')$$, 'a dispatcher cannot read the owner''s support numbers');
select act_as_staff('6c000000-0000-4000-8000-0000000000f1', 'aal2', 1);
select assert_raises($$select public.ops_support_metrics('year')$$, 'an unknown period is refused', '%period%');
create temp table m on commit drop as select public.ops_support_metrics('7d') j;
select act_as_reset();
select assert_true((select (j->'current'->>'opened')::int = 2 and (j->'current'->>'resolved')::int = 1 from m),
  'seven days: two cases opened, one resolved');
select assert_true((select (j->'current'->>'median_first_response_minutes')::int = 20 from m),
  'median first response counts only cases answered, opened in the window');
select assert_true((select (j->'current'->>'median_minutes_to_resolve')::int = 1440 from m),
  'median time to resolve, in minutes');
select assert_true((select (j->'current'->>'releases')::int = 1 and (j->'current'->>'strikes_confirmed')::int = 1 from m),
  'releases and confirmed strikes in the window');
select assert_true((select (j->'previous'->>'opened')::int = 1 from m), 'the previous seven days have the older case');
select assert_true((select (j->'now'->>'overdue')::int >= 1 and (j->'now'->>'open')::int >= 2 and (j->'now'->>'to_review')::int >= 1 from m),
  'right now: open, overdue and strikes waiting for a decision');
select assert_true((select j->'by_kind' @> '[{"kind": "damage", "cases": 1}]'::jsonb from m), 'cases by kind in the window');
select assert_true((select p.prosecdef and p.proconfig @> array['search_path=""'] and p.provolatile = 's'
                      from pg_proc p where p.oid = 'public.ops_support_metrics(text)'::regprocedure),
  'a pinned, stable definer');
rollback;

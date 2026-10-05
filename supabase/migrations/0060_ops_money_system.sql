-- 0060 · Ops console v2, phase 6: money and rules are the owner's.
--
-- Spec §2 D2/D3, §6.2, §9b locks 4 and 6: the commission, the bid fee, the rate
-- card and the dispatch/bidding settings change only by an owner with 2FA
-- verified in the last few minutes, with a reason, an audit row and an emailed
-- alert. Every staff member can read the alert log, the audit log and job
-- health. No table grant or policy changes.

-- ═══ 1. the money writers: wrapped, not copied ═══════════════════════════════
-- Each validated body moves to private.<name>_impl unchanged (its own
-- require_ops(), validation, rate limit and log_ops still run — an owner passes
-- require_ops). The public name becomes a thin owner-only wrapper. Copying four
-- bodies to change one guard line would be four chances to drift.
alter function public.ops_set_commission(numeric, text) rename to ops_set_commission_impl;
alter function public.ops_set_commission_impl(numeric, text) set schema private;
revoke all on function private.ops_set_commission_impl(numeric, text) from public, anon, authenticated;

alter function public.ops_set_bid_fee(numeric, text) rename to ops_set_bid_fee_impl;
alter function public.ops_set_bid_fee_impl(numeric, text) set schema private;
revoke all on function private.ops_set_bid_fee_impl(numeric, text) from public, anon, authenticated;

alter function public.ops_upsert_rate_card(text, text, text, bigint, bigint, bigint, text, bigint)
  rename to ops_upsert_rate_card_impl;
alter function public.ops_upsert_rate_card_impl(text, text, text, bigint, bigint, bigint, text, bigint)
  set schema private;
revoke all on function private.ops_upsert_rate_card_impl(text, text, text, bigint, bigint, bigint, text, bigint)
  from public, anon, authenticated;

alter function public.ops_delete_rate_card(bigint, text) rename to ops_delete_rate_card_impl;
alter function public.ops_delete_rate_card_impl(bigint, text) set schema private;
revoke all on function private.ops_delete_rate_card_impl(bigint, text) from public, anon, authenticated;

-- Alerts name the change and the number, never a person (0048).
create or replace function public.ops_set_commission(p_pct numeric, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_owner_fresh();
  perform private.ops_set_commission_impl(p_pct, p_reason);
  perform private.system_raise_alert('owner_money_change',
    format('Owner set the driver commission to %s%%. See ops_audit.', p_pct),
    jsonb_build_object('action', 'ops_set_commission', 'pct', p_pct));
end;
$$;
revoke all on function public.ops_set_commission(numeric, text) from public, anon;
grant execute on function public.ops_set_commission(numeric, text) to authenticated;

create or replace function public.ops_set_bid_fee(p_pct numeric, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_owner_fresh();
  perform private.ops_set_bid_fee_impl(p_pct, p_reason);
  perform private.system_raise_alert('owner_money_change',
    format('Owner set the bid fee to %s%%. See ops_audit.', p_pct),
    jsonb_build_object('action', 'ops_set_bid_fee', 'pct', p_pct));
end;
$$;
revoke all on function public.ops_set_bid_fee(numeric, text) from public, anon;
grant execute on function public.ops_set_bid_fee(numeric, text) to authenticated;

create or replace function public.ops_upsert_rate_card(
  p_origin_corridor text, p_dest_corridor text, p_truck_type_code text,
  p_base_baisa bigint, p_per_tonne_baisa bigint, p_min_fare_baisa bigint,
  p_reason text, p_per_km_baisa bigint default 0
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform private.require_owner_fresh();
  v_id := private.ops_upsert_rate_card_impl(p_origin_corridor, p_dest_corridor, p_truck_type_code,
            p_base_baisa, p_per_tonne_baisa, p_min_fare_baisa, p_reason, p_per_km_baisa);
  perform private.system_raise_alert('owner_money_change',
    format('Owner changed rate band %s: %s → %s, %s. See ops_audit.',
           v_id, p_origin_corridor, p_dest_corridor, p_truck_type_code),
    jsonb_build_object('action', 'ops_upsert_rate_card', 'rate_card_id', v_id));
  return v_id;
end;
$$;
revoke all on function public.ops_upsert_rate_card(text, text, text, bigint, bigint, bigint, text, bigint)
  from public, anon;
grant execute on function public.ops_upsert_rate_card(text, text, text, bigint, bigint, bigint, text, bigint)
  to authenticated;

create or replace function public.ops_delete_rate_card(p_id bigint, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_owner_fresh();
  perform private.ops_delete_rate_card_impl(p_id, p_reason);
  perform private.system_raise_alert('owner_money_change',
    format('Owner deleted rate band %s. See ops_audit.', p_id),
    jsonb_build_object('action', 'ops_delete_rate_card', 'rate_card_id', p_id));
end;
$$;
revoke all on function public.ops_delete_rate_card(bigint, text) from public, anon;
grant execute on function public.ops_delete_rate_card(bigint, text) to authenticated;

-- ═══ 2. settings: one literal registry ═══════════════════════════════════════
-- As 0018 said: making a setting remotely writable is a reviewed migration, not
-- an INSERT. Deliberately absent: ops_stepup_minutes and staff_email_domains
-- (locks 4 and 5 — loosening them from the console defeats them),
-- position_retention_days (a privacy promise), store URLs and min_app_version
-- (release-managed text), commission_pct and bid_fee_pct (their own writers).
create or replace function private.ops_setting_spec()
returns table (key text, value_type text, label text, description text,
               min_value integer, max_value integer)
language sql
immutable
set search_path = ''
as $$
  values
    ('auto_dispatch_enabled', 'boolean', 'Automatic dispatch',
     'When on, a posted load is offered to nearby drivers with no human involved. When off, every load waits for a dispatcher. Nothing is lost — loads queue normally.',
     null::integer, null::integer),
    ('auto_dispatch_max_offers', 'integer', 'Offers per load',
     'How many drivers one load may be offered to automatically. Higher fills faster and bothers more drivers.', 1, 20),
    ('auto_dispatch_max_pending_per_driver', 'integer', 'Live offers per driver',
     'How many unanswered offers one driver may hold. Stops one driver being buried.', 1, 20),
    ('auto_dispatch_requires_price', 'boolean', 'Only auto-dispatch priced loads',
     'When on, a load with no price waits for a dispatcher instead of being offered.', null, null),
    ('require_verified_driver', 'boolean', 'Only verified drivers may accept',
     'When on, an unverified driver cannot accept an offer or bid. The website claims "100% verified drivers"; this setting makes that true.', null, null),
    ('dispatch_wave_minutes', 'integer', 'Minutes per dispatch wave',
     'How long each group of drivers has to answer before the next group is asked.', 1, 60),
    ('dispatch_max_waves', 'integer', 'Dispatch waves before a person is alerted',
     'After this many waves with no taker, a dispatcher is alerted. The machine keeps looking.', 1, 10),
    ('dispatch_radius_km_1', 'integer', 'First wave radius (km)',
     'How far from the pickup the first wave looks for drivers.', 10, 2000),
    ('dispatch_radius_km_2', 'integer', 'Second wave radius (km)',
     'How far the second wave looks.', 10, 2000),
    ('dispatch_radius_km_3', 'integer', 'Third wave radius (km)',
     'How far the third and later waves look.', 10, 3000),
    ('dispatch_location_fresh_minutes', 'integer', 'GPS counts as fresh for (minutes)',
     'A driver''s last GPS point older than this is ignored and their town is used instead.', 5, 240),
    ('dispatch_rescue_enabled', 'boolean', 'Keep looking after the alert',
     'When on, a load nobody took is offered to any driver who comes online, until its collection date.', null, null),
    ('drivers_online_by_default', 'boolean', 'Drivers online unless they switch off',
     'When on, every driver is offered work unless they turn themselves off.', null, null),
    ('bid_window_minutes', 'integer', 'Bidding window (minutes)',
     'How long a bid load takes bids before the shipper chooses.', 10, 1440),
    ('bid_wave_minutes', 'integer', 'Minutes between bid invitations',
     'How often more drivers are invited to bid.', 1, 60),
    ('bid_invites_per_wave', 'integer', 'Drivers invited per wave',
     'How many drivers each bid invitation wave reaches.', 1, 20),
    ('bid_enough_bids', 'integer', 'Bids that are enough',
     'Once a load has this many bids, no more drivers are invited.', 1, 20),
    ('push_enabled', 'boolean', 'Push notifications',
     'When off, the database sends no push notifications at all. The kill switch for a bad push.', null, null),
    ('stuck_alert_minutes', 'integer', 'Stuck-load alert (minutes)',
     'A load waiting this long with nobody on it alerts a person.', 5, 240)
$$;
revoke all on function private.ops_setting_spec() from public, anon, authenticated;

create or replace function public.ops_settings()
returns table (key text, value jsonb, value_type text, label text, description text,
               min_value integer, max_value integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  return query
  select k.key, coalesce(s.value, 'null'::jsonb), k.value_type, k.label, k.description,
         k.min_value, k.max_value
    from private.ops_setting_spec() k
    left join private.app_settings s on s.key = k.key;
end;
$$;
revoke all on function public.ops_settings() from public, anon;
grant execute on function public.ops_settings() to authenticated;

-- A reason is now required, so the two-argument writer goes (two overloads with
-- the same leading arguments confuse PostgREST — the 0024 lesson).
drop function public.ops_set_setting(text, jsonb);

create or replace function public.ops_set_setting(p_key text, p_value jsonb, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_spec   record;
  v_before jsonb;
  v_int    numeric;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_owner_fresh();
  perform private.check_rate_limit('ops_set_setting', 50, interval '1 hour');

  select * into v_spec from private.ops_setting_spec() k where k.key = p_key;
  if not found then
    -- "not found": which settings exist is not something to confirm by guessing.
    raise exception 'no such setting' using errcode = 'no_data_found';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'a setting change needs a reason' using errcode = 'check_violation';
  end if;

  if v_spec.value_type = 'boolean' then
    if jsonb_typeof(p_value) is distinct from 'boolean' then
      raise exception 'that setting is true or false' using errcode = 'check_violation';
    end if;
  else
    if jsonb_typeof(p_value) is distinct from 'number' then
      raise exception 'that setting is a whole number' using errcode = 'check_violation';
    end if;
    v_int := (p_value #>> '{}')::numeric;
    if v_int <> trunc(v_int) or v_int < v_spec.min_value or v_int > v_spec.max_value then
      raise exception 'that setting must be a whole number between % and %', v_spec.min_value, v_spec.max_value
        using errcode = 'check_violation';
    end if;
  end if;

  select s.value into v_before from private.app_settings s where s.key = p_key;
  insert into private.app_settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;

  perform private.log_ops('ops_set_setting', 'setting', p_key,
    jsonb_build_object('value', v_before), jsonb_build_object('value', p_value), v_reason);
  perform private.system_raise_alert('owner_rules_change',
    format('Owner changed setting %s from %s to %s. See ops_audit.', p_key, coalesce(v_before::text, 'unset'), p_value::text),
    jsonb_build_object('action', 'ops_set_setting', 'key', p_key, 'before', v_before, 'after', p_value));
end;
$$;
revoke all on function public.ops_set_setting(text, jsonb, text) from public, anon;
grant execute on function public.ops_set_setting(text, jsonb, text) to authenticated;

-- ═══ 3. staff: find an account to appoint ════════════════════════════════════
-- ops_appoint_staff takes a profile id the owner cannot see. This resolves a
-- confirmed account by email and says whether it may be staff (lock 5). It
-- confirms an email has an account — owner only.
create or replace function public.ops_find_staff_account(p_email text)
returns table (profile_id uuid, full_name text, email text, has_profile boolean,
               account_ok boolean, staff_level text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_owner();
  return query
  select u.id, p.full_name, u.email::text, p.id is not null,
         p.id is not null and private.staff_account_ok(u.id),
         o.level
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join private.ops_users o on o.profile_id = u.id
   where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function public.ops_find_staff_account(text) from public, anon;
grant execute on function public.ops_find_staff_account(text) to authenticated;

-- ═══ 4. logs and health, for every staff member ══════════════════════════════
create or replace function public.ops_alert_log(
  p_open_only boolean default false,
  p_limit     integer default 50,
  p_offset    integer default 0
)
returns table (id bigint, kind text, detail jsonb, created_at timestamptz,
               acknowledged_at timestamptz, acknowledged_by_name text, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.require_ops();
  return query
  select a.id, a.kind, a.detail, a.created_at, a.acknowledged_at, p.full_name, count(*) over ()
    from private.ops_alerts a
    left join public.profiles p on p.id = a.acknowledged_by
   where not coalesce(p_open_only, false) or a.acknowledged_at is null
   order by a.created_at desc, a.id desc
   limit v_limit offset v_offset;
end;
$$;
revoke all on function public.ops_alert_log(boolean, integer, integer) from public, anon;
grant execute on function public.ops_alert_log(boolean, integer, integer) to authenticated;

-- ops_audit_log (0015) with an action filter. A new name rather than an
-- overload: PostgREST resolves overloads with defaults unreliably.
create or replace function public.ops_audit_find(
  p_actions     text[]  default null,
  p_target_kind text    default null,
  p_actor_id    uuid    default null,
  p_limit       integer default 50,
  p_offset      integer default 0
)
returns table (id bigint, actor_id uuid, actor_name text, action text, target_kind text,
               target_id text, before jsonb, after jsonb, reason text, created_at timestamptz,
               total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.require_ops();
  return query
  select a.id, a.actor_id, p.full_name, a.action, a.target_kind, a.target_id,
         a.before, a.after, a.reason, a.created_at, count(*) over ()
    from private.ops_audit a
    left join public.profiles p on p.id = a.actor_id
   where (p_actions is null or cardinality(p_actions) = 0 or a.action = any (p_actions))
     and (p_target_kind is null or a.target_kind = p_target_kind)
     and (p_actor_id is null or a.actor_id = p_actor_id)
   order by a.created_at desc, a.id desc
   limit v_limit offset v_offset;
end;
$$;
revoke all on function public.ops_audit_find(text[], text, uuid, integer, integer) from public, anon;
grant execute on function public.ops_audit_find(text[], text, uuid, integer, integer) to authenticated;

-- The scheduled jobs' health only — ops_health() (owner) adds alert and
-- client-error counts on top.
create or replace function public.ops_job_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  return private.system_health();
end;
$$;
revoke all on function public.ops_job_health() from public, anon;
grant execute on function public.ops_job_health() to authenticated;

-- The bid fee in force, or NULL when it was never set — in which case
-- private.current_bid_fee_bps() refuses and no bid load can be posted (0045:
-- a missing fee is not silently a free service). The Money page says so.
create or replace function public.ops_bid_fee()
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pct numeric;
begin
  perform private.require_ops();
  select (s.value #>> '{}')::numeric into v_pct from private.app_settings s where s.key = 'bid_fee_pct';
  return v_pct;
end;
$$;
revoke all on function public.ops_bid_fee() from public, anon;
grant execute on function public.ops_bid_fee() to authenticated;

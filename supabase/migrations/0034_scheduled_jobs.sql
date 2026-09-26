-- Truckkoo — the jobs nobody has to remember.
--
-- 0013, 0032 and OPEN_ISSUES all record the same failure shape: a sweep that
-- exists as a dispatcher's button goes stale, because a button is a job that
-- depends on someone remembering it. This migration enables pg_cron and runs
-- them on a schedule, and adds the alarm that CLAUDE.md non-negotiable #6
-- ("a human resolves it") was missing: nothing noticed a load that nobody was
-- resolving.
--
-- WHAT DID NOT CHANGE: every `ops_*` RPC is untouched and still callable from
-- the console. `require_ops()` is not weakened — it reads `auth.uid()`, which a
-- cron job does not have, so the scheduled path is a set of `private.system_*`
-- functions with no grant to any client role. They are reachable from pg_cron
-- (which runs as the database owner) and nothing else.
--
-- AUDIT: every scheduled write lands in `private.ops_audit`, as CLAUDE.md
-- requires of every privileged write. `ops_audit.actor_id` is NOT NULL and
-- `log_ops` reads `auth.uid()`, so system writes go through `log_system`, which
-- records the nil UUID. No profile has that id (profiles.id is auth.users.id),
-- so the console's left join shows no name — the row reads as "system".
--
-- NOT DONE HERE, ON PURPOSE: `ops_audit` retention. Pruning an audit log is a
-- business decision (OPEN_ISSUES "ops_audit has no retention policy"), not a
-- maintenance chore, and a migration is not where it gets made.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

-- ═══ 1. system audit ═══════════════════════════════════════════════════════

create or replace function private.log_system(
  p_action      text,
  p_target_kind text,
  p_target_id   text,
  p_after       jsonb default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.ops_audit (actor_id, action, target_kind, target_id, after, reason)
  values ('00000000-0000-0000-0000-000000000000'::uuid,
          p_action, p_target_kind, p_target_id, p_after, 'scheduled');
$$;

revoke all on function private.log_system(text, text, text, jsonb)
  from public, anon, authenticated;

-- ═══ 2. scheduled sweeps ═══════════════════════════════════════════════════
-- Same bodies as `ops_sweep_expired_offers` (0016) and `ops_sweep_positions`
-- (0032), minus the ops guard. If either ops_ version changes, change these in
-- the same migration — `supabase/tests/ops_console.sql` §9 runs both paths.

create or replace function private.system_sweep_expired_offers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with swept as (
    update public.offers set status = 'expired'
    where status = 'pending' and expires_at <= now()
    returning load_id
  )
  select count(distinct load_id) into v_count from swept;

  update public.loads set status = 'finding_truck'
  where status = 'matched'
    and not exists (
      select 1 from public.offers o
      where o.load_id = public.loads.id
        and o.status = 'pending'
        and o.expires_at > now()
    );

  -- Logged only when it did something. Unlike the button, "was it run" is
  -- answered by cron.job_run_details, and a row every five minutes saying
  -- "nothing" would bury the rows a dispatcher needs to read.
  if v_count > 0 then
    perform private.log_system(
      'system_sweep_expired_offers', 'system', 'offers',
      jsonb_build_object('loads_affected', v_count));
  end if;

  return v_count;
end;
$$;

revoke all on function private.system_sweep_expired_offers()
  from public, anon, authenticated;

create or replace function private.system_sweep_positions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days    integer := private.setting_int('position_retention_days', 30);
  v_deleted integer;
begin
  if v_days < 1 or v_days > 365 then
    raise exception 'retention must be between 1 and 365 days'
      using errcode = 'check_violation';
  end if;

  with gone as (
    delete from public.trip_positions
     where seen_at < now() - make_interval(days => v_days)
    returning 1
  )
  select count(*) into v_deleted from gone;

  if v_deleted > 0 then
    perform private.log_system(
      'system_sweep_positions', 'table', 'trip_positions',
      jsonb_build_object('deleted', v_deleted, 'days', v_days));
  end if;

  return v_deleted;
end;
$$;

revoke all on function private.system_sweep_positions()
  from public, anon, authenticated;

-- ═══ 3. the stuck-load alarm ═══════════════════════════════════════════════
-- A load waiting on Truckkoo — not on the shipper ('quoted') or the driver
-- ('assigned' onward) — for longer than `stuck_alert_minutes` raises one alert.
--
-- `loads` records no status-change time, so the watchdog keeps its own: the
-- first time it sees a load in a waiting status is the clock's start. That is
-- accurate to one cron interval, which is all an alarm measured in tens of
-- minutes needs, and it avoids a trigger on the hottest table.
--
-- One alert per (load, status). A load that moves on and comes back — matched,
-- every offer ignored, swept back to finding_truck — is a new wait and alerts
-- again.
--
-- DELIVERY: a POST of `{"text": …}` to `alert_webhook_url` in app_settings —
-- the shape Slack, Google Chat and most chat webhooks accept. Unset, alerts are
-- still recorded in `private.ops_alerts` and nothing is sent. The payload
-- carries a count and short load ids only: no shipper name, phone or cargo
-- leaves the database.

create table if not exists private.load_watch (
  load_id       uuid        not null references public.loads (id) on delete cascade,
  status        public.load_status not null,
  first_seen_at timestamptz not null default now(),
  alerted_at    timestamptz,
  primary key (load_id, status)
);

alter table private.load_watch enable row level security;
alter table private.load_watch force row level security;
revoke all on table private.load_watch from anon, authenticated;

create table if not exists private.ops_alerts (
  id         bigint generated always as identity primary key,
  kind       text        not null,
  detail     jsonb       not null,
  -- pg_net's request id, or null when no webhook is configured.
  request_id bigint,
  created_at timestamptz not null default now()
);

alter table private.ops_alerts enable row level security;
alter table private.ops_alerts force row level security;
revoke all on table private.ops_alerts from anon, authenticated;

create index if not exists ops_alerts_recent_idx on private.ops_alerts (created_at desc);

insert into private.app_settings (key, value) values
  ('stuck_alert_minutes',     '30'::jsonb),
  ('position_retention_days', '30'::jsonb)
on conflict (key) do nothing;

-- A text setting. `setting_bool`/`setting_int` exist; the webhook is the first
-- string. Unset or JSON null both read as null.
create or replace function private.setting_text(p_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(s.value #>> '{}', '') from private.app_settings s where s.key = p_key;
$$;

revoke all on function private.setting_text(text) from public, anon, authenticated;

create or replace function private.system_raise_alert(p_kind text, p_text text, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url        text := private.setting_text('alert_webhook_url');
  v_request_id bigint;
begin
  if v_url is not null then
    -- Asynchronous: pg_net queues the request and returns. A dead webhook
    -- cannot fail or slow the job that raised the alert.
    select net.http_post(
      url     := v_url,
      body    := jsonb_build_object('text', p_text),
      headers := '{"Content-Type": "application/json"}'::jsonb
    ) into v_request_id;
  end if;

  insert into private.ops_alerts (kind, detail, request_id)
  values (p_kind, p_detail, v_request_id);
end;
$$;

revoke all on function private.system_raise_alert(text, text, jsonb)
  from public, anon, authenticated;

create or replace function private.system_watch_loads()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutes integer := private.setting_int('stuck_alert_minutes', 30);
  v_ids     uuid[];
  v_lines   text;
begin
  -- Forget waits that ended.
  delete from private.load_watch w
   using public.loads l
   where l.id = w.load_id and l.status <> w.status;

  -- Start the clock on new ones.
  insert into private.load_watch (load_id, status)
  select l.id, l.status from public.loads l
   where l.status in ('posted', 'finding_truck', 'accepted', 'matched')
  on conflict do nothing;

  -- Everything past the threshold that has not alerted yet, marked in the same
  -- statement so an overlapping run cannot alert twice.
  with due as (
    update private.load_watch w
       set alerted_at = now()
     where w.alerted_at is null
       and w.first_seen_at < now() - make_interval(mins => v_minutes)
    returning w.load_id, w.status
  )
  select array_agg(load_id),
         string_agg('• ' || left(load_id::text, 8) || '  ' || status::text, E'\n')
    into v_ids, v_lines
    from due;

  if v_ids is null then
    return 0;
  end if;

  perform private.system_raise_alert(
    'stuck_loads',
    format(E'Truckkoo: %s load(s) waiting on dispatch for over %s minutes\n%s',
           cardinality(v_ids), v_minutes, v_lines),
    jsonb_build_object('load_ids', to_jsonb(v_ids), 'minutes', v_minutes));

  return cardinality(v_ids);
end;
$$;

revoke all on function private.system_watch_loads() from public, anon, authenticated;

-- ═══ 4. the jobs that watch the jobs ═══════════════════════════════════════
-- A cron job that raises every run fails silently: the error sits in
-- cron.job_run_details and nobody reads that table. This one does.

create or replace function private.system_watch_cron()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failed integer;
  v_names  text;
begin
  select count(*), string_agg(distinct j.jobname, ', ')
    into v_failed, v_names
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
   where d.status = 'failed'
     and d.end_time > now() - interval '15 minutes';

  if v_failed > 0 then
    perform private.system_raise_alert(
      'cron_failed',
      format('Truckkoo: %s scheduled job run(s) failed in the last 15 minutes: %s',
             v_failed, v_names),
      jsonb_build_object('failed', v_failed, 'jobs', v_names));
  end if;

  -- job_run_details grows by a row per run and pg_cron never prunes it.
  delete from cron.job_run_details where end_time < now() - interval '14 days';

  return v_failed;
end;
$$;

revoke all on function private.system_watch_cron() from public, anon, authenticated;

-- ═══ 5. schedule ═══════════════════════════════════════════════════════════
-- cron.schedule upserts by name, so re-running this file is harmless.

select cron.schedule('sweep-expired-offers', '*/5 * * * *',
  'select private.system_sweep_expired_offers()');
select cron.schedule('watch-loads',          '*/5 * * * *',
  'select private.system_watch_loads()');
select cron.schedule('watch-cron',           '*/15 * * * *',
  'select private.system_watch_cron()');
select cron.schedule('sweep-positions',      '17 3 * * *',
  'select private.system_sweep_positions()');

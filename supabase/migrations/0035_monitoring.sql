-- Truckkoo — knowing when something breaks, before a shipper says so.
--
-- Three pieces, each covering what the one before cannot see:
--
-- 1. CLIENT ERRORS. A release build that crashes, or an RPC that starts failing
--    for everyone, left no trace anywhere: AppErrorBoundary logs only under
--    __DEV__, and this audience does not file bug reports — they phone someone
--    else. `report_client_error` stores them, grouped by fingerprint, and the
--    watcher alerts on the two signals that matter: an error nobody has seen
--    before, and a known one suddenly happening a lot.
--
-- 2. APP CONFIG. `app_config()` returns the minimum supported app version, so a
--    binary with a bug that damages data can be told to update. There is no OTA
--    channel (language.ts), and a cheap Android phone keeps an old build for a
--    year; without this switch every RPC is a contract forever.
--
-- 3. HEALTH. Every alarm so far lives inside the database it watches. If cron
--    stops, the project pauses, or the webhook is dead, those alarms are silent
--    by construction. `private.system_health()` is the question an OUTSIDE
--    checker asks (.github/workflows/health.yml), connecting as a dedicated
--    `truckkoo_monitor` role that can call that one function and read the
--    migration ledger, and nothing else.
--
-- WHY NOT ANONYMOUS: 0004 §rate limiting — "do not ship an anonymous endpoint
-- until [per-IP limits] are" implemented. They are not. Both new public RPCs
-- are `authenticated` only, and the health check does not use PostgREST at all.

-- ═══ 1. client errors ══════════════════════════════════════════════════════

create table if not exists private.error_groups (
  fingerprint       text primary key,
  kind              text        not null,
  code              text,
  sample_message    text        not null,
  sample_route      text,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  first_version     text,
  last_version      text,
  total             bigint      not null default 0,
  alerted_new_at    timestamptz,
  alerted_spike_at  timestamptz
);

create table if not exists private.client_errors (
  id           bigint generated always as identity primary key,
  fingerprint  text        not null references private.error_groups (fingerprint) on delete cascade,
  actor_id     uuid        references auth.users (id) on delete set null,
  kind         text        not null,
  code         text,
  message      text        not null,
  route        text,
  app_version  text,
  platform     text,
  os_version   text,
  release      boolean     not null,
  created_at   timestamptz not null default now()
);

create index if not exists client_errors_fp_time_idx
  on private.client_errors (fingerprint, created_at desc);
create index if not exists client_errors_time_idx
  on private.client_errors (created_at desc);

alter table private.error_groups  enable row level security;
alter table private.error_groups  force row level security;
alter table private.client_errors enable row level security;
alter table private.client_errors force row level security;
revoke all on table private.error_groups  from anon, authenticated;
revoke all on table private.client_errors from anon, authenticated;

-- Numbers and ids are not part of an error's identity: "load 3f2a… not found"
-- and "load 91bc… not found" are one bug, and grouping them apart would make
-- every occurrence "new".
create or replace function private.error_fingerprint(
  p_kind text, p_code text, p_message text, p_route text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(concat_ws('|',
    p_kind,
    coalesce(p_code, ''),
    regexp_replace(
      regexp_replace(lower(p_message),
        '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<id>', 'g'),
      '[0-9]+', '<n>', 'g'),
    -- Route params are ids too: /load/3f2a… and /load/91bc… are one screen.
    regexp_replace(coalesce(p_route, ''), '[0-9a-f]{8}-[0-9a-f-]{27}', '<id>', 'g')
  ));
$$;

revoke all on function private.error_fingerprint(text, text, text, text)
  from public, anon, authenticated;

-- Fire-and-forget from the client. Never raises on bad input it can repair —
-- a reporter that throws produces an error about the error — but refuses
-- unknown kinds and caps every field, because this is a write any signed-in
-- user can make.
create or replace function public.report_client_error(
  p_kind        text,
  p_message     text,
  p_code        text    default null,
  p_route       text    default null,
  p_app_version text    default null,
  p_platform    text    default null,
  p_os_version  text    default null,
  p_release     boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind    text := lower(btrim(coalesce(p_kind, '')));
  -- Bidi and other format characters stripped: this text is read by a person
  -- in a chat alert, and a U+202E there is the same spoof it is everywhere else.
  v_message text := left(regexp_replace(coalesce(p_message, ''), '[\u200B-\u200F\u202A-\u202E\u2066-\u2069\x01-\x1F]', ' ', 'g'), 500);
  v_code    text := left(nullif(btrim(p_code), ''), 40);
  v_route   text := left(nullif(btrim(p_route), ''), 120);
  v_fp      text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if v_kind not in ('crash', 'query', 'mutation', 'unhandled') then
    raise exception 'unknown error kind' using errcode = 'check_violation';
  end if;

  if btrim(v_message) = '' then
    v_message := '(no message)';
  end if;

  -- 60 an hour per user. A crash loop on one phone must not bury everyone
  -- else's errors, nor let one account fill the table.
  perform private.check_rate_limit('report_client_error', 60, interval '1 hour');

  v_fp := private.error_fingerprint(v_kind, v_code, v_message, v_route);

  insert into private.error_groups as g
    (fingerprint, kind, code, sample_message, sample_route,
     first_version, last_version, total)
  values
    (v_fp, v_kind, v_code, v_message, v_route,
     left(p_app_version, 40), left(p_app_version, 40), 1)
  on conflict (fingerprint) do update
    set last_seen_at = now(),
        last_version = excluded.last_version,
        total        = g.total + 1;

  insert into private.client_errors
    (fingerprint, actor_id, kind, code, message, route,
     app_version, platform, os_version, release)
  values
    (v_fp, auth.uid(), v_kind, v_code, v_message, v_route,
     left(p_app_version, 40), left(p_platform, 20), left(p_os_version, 40),
     coalesce(p_release, true));
end;
$$;

revoke all on function public.report_client_error(text, text, text, text, text, text, text, boolean)
  from public, anon;
grant execute on function public.report_client_error(text, text, text, text, text, text, text, boolean)
  to authenticated;

insert into private.app_settings (key, value) values
  -- A known error at or above this many reports in 15 minutes alerts again.
  ('error_spike_count',        '20'::jsonb),
  ('client_error_retention_days', '30'::jsonb)
on conflict (key) do nothing;

-- New and spiking groups, from release builds only. A developer's build
-- pointed at production (eas.json "development" is) must not page anyone.
create or replace function private.system_watch_errors()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spike  integer := private.setting_int('error_spike_count', 20);
  v_alerts integer := 0;
  v_count  integer;
  v_lines  text;
begin
  -- New: a group seen from a release build that has never alerted. Listed at
  -- most ten to a message, so a flood of junk groups is one message, not fifty.
  with fresh as (
    update private.error_groups g
       set alerted_new_at = now()
     where g.alerted_new_at is null
       and exists (select 1 from private.client_errors e
                    where e.fingerprint = g.fingerprint and e.release)
    returning g.*
  ),
  numbered as (
    select f.*, row_number() over (order by f.first_seen_at) as n,
           (select count(distinct e.actor_id) from private.client_errors e
             where e.fingerprint = f.fingerprint) as users
      from fresh f
  )
  select count(*),
         string_agg(format('• [%s%s] %s — %s user(s), v%s%s',
                           kind, coalesce(' ' || code, ''), left(sample_message, 160),
                           users, coalesce(first_version, '?'),
                           coalesce(' @ ' || sample_route, '')),
                    E'\n' order by n) filter (where n <= 10)
    into v_count, v_lines
    from numbered;

  if v_count > 0 then
    perform private.system_raise_alert(
      'new_client_errors',
      format(E'Truckkoo: %s new kind(s) of app error\n%s%s', v_count, v_lines,
             case when v_count > 10 then format(E'\n…and %s more', v_count - 10) else '' end),
      jsonb_build_object('count', v_count));
    v_alerts := v_alerts + 1;
  end if;

  -- Spike: a known group past the threshold in 15 minutes, at most hourly.
  with hot as (
    select e.fingerprint, count(*) as n, count(distinct e.actor_id) as users
      from private.client_errors e
     where e.created_at > now() - interval '15 minutes' and e.release
     group by e.fingerprint
    having count(*) >= v_spike
  ),
  marked as (
    update private.error_groups g
       set alerted_spike_at = now()
      from hot
     where g.fingerprint = hot.fingerprint
       and (g.alerted_spike_at is null or g.alerted_spike_at < now() - interval '1 hour')
    returning g.kind, g.code, g.sample_message, hot.n, hot.users
  )
  select count(*),
         string_agg(format('• %s× (%s user(s)) [%s%s] %s',
                           n, users, kind, coalesce(' ' || code, ''), left(sample_message, 160)),
                    E'\n')
    into v_count, v_lines
    from marked;

  if v_count > 0 then
    perform private.system_raise_alert(
      'client_error_spike',
      format(E'Truckkoo: app errors spiking in the last 15 minutes\n%s', v_lines),
      jsonb_build_object('groups', v_count));
    v_alerts := v_alerts + 1;
  end if;

  return v_alerts;
end;
$$;

revoke all on function private.system_watch_errors() from public, anon, authenticated;

create or replace function private.system_sweep_client_errors()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days    integer := private.setting_int('client_error_retention_days', 30);
  v_deleted integer;
begin
  with gone as (
    delete from private.client_errors
     where created_at < now() - make_interval(days => greatest(v_days, 1))
    returning 1
  )
  select count(*) into v_deleted from gone;

  -- A group with no occurrences left and quiet for the whole window is closed;
  -- if it comes back it is new again, which is the right thing to be told.
  delete from private.error_groups g
   where g.last_seen_at < now() - make_interval(days => greatest(v_days, 1))
     and not exists (select 1 from private.client_errors e where e.fingerprint = g.fingerprint);

  if v_deleted > 0 then
    perform private.log_system('system_sweep_client_errors', 'table', 'client_errors',
      jsonb_build_object('deleted', v_deleted, 'days', v_days));
  end if;

  return v_deleted;
end;
$$;

revoke all on function private.system_sweep_client_errors() from public, anon, authenticated;

-- ═══ 2. app config ═════════════════════════════════════════════════════════
-- Strings, not an app_settings passthrough: the client sees exactly these keys
-- and nothing added to app_settings later leaks by accident.

insert into private.app_settings (key, value) values
  ('min_app_version',   '"1.0.0"'::jsonb),
  ('android_store_url', '"https://play.google.com/store/apps/details?id=com.truckkoo.app"'::jsonb),
  ('ios_store_url',     'null'::jsonb)
on conflict (key) do nothing;

create or replace function public.app_config()
returns table (min_app_version text, android_store_url text, ios_store_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select private.setting_text('min_app_version'),
         private.setting_text('android_store_url'),
         private.setting_text('ios_store_url');
$$;

revoke all on function public.app_config() from public, anon;
grant execute on function public.app_config() to authenticated;

-- ═══ 3. health, for an outside checker ═════════════════════════════════════
-- Returns a verdict and reasons — no counts of loads, users or money. The
-- monitor's connection string lives in GitHub secrets; if it leaks, what it
-- reveals is whether the cron jobs are running.

create or replace function private.system_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_problems text[] := '{}';
  r record;
begin
  -- The scheduler is alive and each frequent job succeeded recently. The daily
  -- sweep is left to watch-cron: "has it run in 26h" is false on day one.
  for r in
    select j.jobname, j.active,
           (select max(d.end_time) from cron.job_run_details d
             where d.jobid = j.jobid and d.status = 'succeeded') as last_ok,
           case j.jobname when 'watch-cron' then interval '45 minutes'
                          else interval '20 minutes' end as allowed
      from cron.job j
     where j.jobname in ('sweep-expired-offers', 'watch-loads', 'watch-errors', 'watch-cron')
  loop
    if not r.active then
      v_problems := v_problems || format('job %s is disabled', r.jobname);
    elsif r.last_ok is null or r.last_ok < now() - r.allowed then
      v_problems := v_problems || format('job %s has not succeeded since %s',
                                         r.jobname, coalesce(r.last_ok::text, 'ever'));
    end if;
  end loop;

  if (select count(*) from cron.job
       where jobname in ('sweep-expired-offers', 'watch-loads', 'watch-errors', 'watch-cron')) < 4 then
    v_problems := v_problems || 'a scheduled job is missing from cron.job'::text;
  end if;

  -- Alerts are being delivered. pg_net keeps responses for its TTL (6h), so
  -- this sees recent failures only — which is the window that matters.
  if exists (
    select 1 from private.ops_alerts a
      join net._http_response h on h.id = a.request_id
     where a.created_at > now() - interval '6 hours'
       and (h.timed_out or h.error_msg is not null
            or h.status_code is null or h.status_code >= 300)
  ) then
    v_problems := v_problems || 'alert webhook delivery failed in the last 6 hours'::text;
  end if;

  if private.setting_text('alert_webhook_url') is null then
    v_problems := v_problems || 'alert_webhook_url is not set — alerts are recorded but not sent'::text;
  end if;

  return jsonb_build_object(
    'ok',         cardinality(v_problems) = 0,
    'problems',   to_jsonb(v_problems),
    'checked_at', now());
end;
$$;

revoke all on function private.system_health() from public, anon, authenticated;

-- The outside checker's role. NOLOGIN here: a migration must not carry a
-- password. Enabling it is one manual statement (OPEN_ISSUES), and until then
-- nothing can connect as it.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'truckkoo_monitor') then
    create role truckkoo_monitor nologin;
  end if;
end $$;

grant usage on schema private to truckkoo_monitor;
grant execute on function private.system_health() to truckkoo_monitor;
grant usage on schema supabase_migrations to truckkoo_monitor;
grant select on supabase_migrations.schema_migrations to truckkoo_monitor;

-- ═══ 4. schedule ═══════════════════════════════════════════════════════════

select cron.schedule('watch-errors',        '*/5 * * * *',
  'select private.system_watch_errors()');
select cron.schedule('sweep-client-errors', '41 3 * * *',
  'select private.system_sweep_client_errors()');

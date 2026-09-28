-- Truckkoo — tripwires: knowing when someone is probing the API by hand.
--
-- The anon key and the API URL ship inside the app, so anyone can skip the app
-- and call the API with curl. RLS and the definer functions are what stop them
-- (SECURITY.md); this is what TELLS YOU they tried.
--
-- NOT AN SQL-INJECTION DETECTOR, because there is nothing to detect: no
-- function in this schema builds SQL at runtime (no EXECUTE), and PostgREST
-- turns every request into a parameterised query. An injection payload arrives
-- as a string value and matches nothing.
--
-- HOW: decoy RPCs with the names a prober tries — list the users, export the
-- loads, change a role. The app never calls them and nothing links to them, so
-- a call is by definition someone exploring the API outside the app: zero
-- false positives. Each one returns the same boring nothing a real, empty
-- endpoint would, records who called, and raises one alert through the
-- webhook 0034 already delivers to.
--
-- AUTHENTICATED ONLY, per 0004: no anonymous endpoint until there are per-IP
-- limits. That still covers the realistic prober — anon can reach almost
-- nothing in this schema, so anyone probing in earnest signs up first — and it
-- means every alert names an account that can be banned.
--
-- WHAT CAN AND CANNOT BE SEEN. A call that fails (permission denied, a raised
-- ownership check) rolls back its own transaction, including any row it wrote,
-- so those attempts are only in Supabase's Postgres logs. Tripwires work
-- because they SUCCEED.

-- ═══ 1. events ════════════════════════════════════════════════════════════

create table if not exists private.security_events (
  id          bigint generated always as identity primary key,
  kind        text        not null,
  actor_id    uuid        references auth.users (id) on delete set null,
  -- Attacker-controlled, so stored truncated and never forwarded to the
  -- webhook: a chat message is a rendering surface (links, mentions).
  user_agent  text,
  ip          text,
  alerted     boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists security_events_actor_time_idx
  on private.security_events (actor_id, created_at desc);
create index if not exists security_events_time_idx
  on private.security_events (created_at desc);

alter table private.security_events enable row level security;
alter table private.security_events force row level security;
revoke all on table private.security_events from anon, authenticated;

insert into private.app_settings (key, value) values
  ('tripwire_events_per_hour',  '20'::jsonb),
  ('tripwire_alerts_per_hour',  '10'::jsonb),
  ('security_event_days',       '90'::jsonb)
on conflict (key) do nothing;

-- ═══ 2. the trip ══════════════════════════════════════════════════════════

create or replace function private.trip(p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_headers  json;
  v_ip       text;
  v_ua       text;
  v_id       bigint;
  v_alert    boolean;
begin
  -- A flood from one account writes a bounded number of rows and then goes
  -- quiet. Silently: an error here would tell the prober which calls are traps.
  if (select count(*) from private.security_events e
       where e.actor_id is not distinct from v_actor
         and e.created_at > now() - interval '1 hour')
     >= private.setting_int('tripwire_events_per_hour', 20) then
    return;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  v_ip := left(coalesce(v_headers->>'cf-connecting-ip',
                        v_headers->>'x-real-ip',
                        split_part(v_headers->>'x-forwarded-for', ',', 1)), 64);
  v_ua := left(v_headers->>'user-agent', 200);

  -- One alert per account per hour, and a global ceiling, so a hundred
  -- throwaway accounts cannot turn the webhook into a spam channel.
  v_alert := not exists (
      select 1 from private.security_events e
       where e.actor_id is not distinct from v_actor
         and e.alerted
         and e.created_at > now() - interval '1 hour')
    and (select count(*) from private.security_events e
          where e.alerted and e.created_at > now() - interval '1 hour')
        < private.setting_int('tripwire_alerts_per_hour', 10);

  insert into private.security_events (kind, actor_id, user_agent, ip, alerted)
  values (p_kind, v_actor, v_ua, v_ip, v_alert)
  returning id into v_id;

  if v_alert then
    -- Only values this migration controls reach the message: the kind is a
    -- constant from the decoy below, the actor a uuid.
    perform private.system_raise_alert(
      'tripwire',
      format('Security: tripwire "%s" was called by account %s. Someone is using the API outside the app. See private.security_events id %s.',
             p_kind, coalesce(v_actor::text, 'unknown'), v_id),
      jsonb_build_object('kind', p_kind, 'actor_id', v_actor, 'event_id', v_id));
  end if;
end;
$$;

revoke all on function private.trip(text) from public, anon, authenticated;

-- ═══ 3. the decoys ════════════════════════════════════════════════════════
-- Each looks like an endpoint that exists and has nothing to say.

create or replace function public.admin_list_users()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.trip('admin_list_users');
  return '[]'::jsonb;
end;
$$;

create or replace function public.export_all_loads()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.trip('export_all_loads');
  return '[]'::jsonb;
end;
$$;

create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.trip('set_user_role');
end;
$$;

revoke all on function public.admin_list_users()          from public, anon, authenticated;
revoke all on function public.export_all_loads()          from public, anon, authenticated;
revoke all on function public.set_user_role(uuid, text)   from public, anon, authenticated;
grant execute on function public.admin_list_users()        to authenticated;
grant execute on function public.export_all_loads()        to authenticated;
grant execute on function public.set_user_role(uuid, text) to authenticated;

-- ═══ 4. retention ═════════════════════════════════════════════════════════
-- An IP is personal data (SECURITY.md); keep it only as long as it is useful.

create or replace function private.system_sweep_security_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from private.security_events
   where created_at < now() - make_interval(days => private.setting_int('security_event_days', 90));
  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform private.log_system(
      'system_sweep_security_events', 'system', 'security_events',
      jsonb_build_object('deleted', v_count));
  end if;

  return v_count;
end;
$$;

revoke all on function private.system_sweep_security_events()
  from public, anon, authenticated;

select cron.schedule('sweep-security-events', '41 3 * * *',
  'select private.system_sweep_security_events()');

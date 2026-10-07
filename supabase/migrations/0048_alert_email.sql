-- 0048 · Alerts by email.
--
-- 0034 raises every alert through `private.system_raise_alert`, which POSTs
-- `{"text": …}` to `alert_webhook_url` — a chat webhook. Production never set
-- one, so every alert since 0034 was recorded in `private.ops_alerts` and sent
-- nowhere. The founder reads email on their phone, so this adds email as a
-- second destination, beside the webhook rather than instead of it.
--
-- HOW: Resend's HTTP API (https://api.resend.com/emails), through pg_net like
-- the webhook and like push (0046). Asynchronous: a dead provider cannot fail
-- or slow the job that raised the alert.
--
-- SETTINGS (all by hand, none in this file):
--   private.app_settings 'alert_email_to'    — recipients, comma-separated
--   private.app_settings 'alert_email_from'  — optional; default is Resend's
--       shared sender, which only delivers to the Resend account's own address.
--       Sending to anyone else needs a verified domain in Resend.
--   vault secret 'resend_api_key'            — the API key. In Vault, not in
--       app_settings: it is a credential, and app_settings is plain text.
--
-- WHAT LEAVES: the alert's text, unchanged — counts and short load ids. Every
-- caller of system_raise_alert already keeps names, phones and cargo out of it
-- (0034, 0035), and an email is no different from the webhook in that.

alter table private.ops_alerts add column if not exists email_request_id bigint;

create or replace function private.system_raise_alert(p_kind text, p_text text, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url        text := private.setting_text('alert_webhook_url');
  v_to         text := private.setting_text('alert_email_to');
  v_from       text := coalesce(private.setting_text('alert_email_from'),
                                'Truckkoo alerts <onboarding@resend.dev>');
  v_key        text;
  v_request_id bigint;
  v_email_id   bigint;
begin
  if v_url is not null then
    select net.http_post(
      url     := v_url,
      body    := jsonb_build_object('text', p_text),
      headers := '{"Content-Type": "application/json"}'::jsonb
    ) into v_request_id;
  end if;

  if v_to is not null then
    select s.decrypted_secret into v_key
      from vault.decrypted_secrets s
     where s.name = 'resend_api_key';
  end if;

  if v_to is not null and v_key is not null then
    select net.http_post(
      url     := 'https://api.resend.com/emails',
      body    := jsonb_build_object(
                   'from',    v_from,
                   'to',      (select coalesce(jsonb_agg(btrim(a)), '[]'::jsonb)
                                 from unnest(string_to_array(v_to, ',')) a
                                where btrim(a) <> ''),
                   -- The first line is the headline every caller writes; a
                   -- phone's inbox shows the subject and little else.
                   'subject', '[Truckkoo] ' || left(split_part(p_text, E'\n', 1), 120),
                   'text',    p_text),
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || v_key)
    ) into v_email_id;
  end if;

  insert into private.ops_alerts (kind, detail, request_id, email_request_id)
  values (p_kind, p_detail, v_request_id, v_email_id);
end;
$$;

revoke all on function private.system_raise_alert(text, text, jsonb)
  from public, anon, authenticated;

-- Health: "nowhere to go" now means neither destination, and a failed email
-- counts as a failed delivery. Otherwise unchanged from 0035.
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

  if exists (
    select 1 from private.ops_alerts a
      join net._http_response h on h.id in (a.request_id, a.email_request_id)
     where a.created_at > now() - interval '6 hours'
       and (h.timed_out or h.error_msg is not null
            or h.status_code is null or h.status_code >= 300)
  ) then
    v_problems := v_problems || 'alert delivery failed in the last 6 hours'::text;
  end if;

  if private.setting_text('alert_webhook_url') is null
     and (private.setting_text('alert_email_to') is null
          or not exists (select 1 from vault.secrets s where s.name = 'resend_api_key')) then
    v_problems := v_problems || 'no alert destination is set — alerts are recorded but not sent'::text;
  end if;

  return jsonb_build_object(
    'ok',         cardinality(v_problems) = 0,
    'problems',   to_jsonb(v_problems),
    'checked_at', now());
end;
$$;

revoke all on function private.system_health() from public, anon, authenticated;
grant execute on function private.system_health() to truckkoo_monitor;

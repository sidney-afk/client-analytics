-- ============================================================
-- 2026-11-02 -- A new client's Slack channels can no longer stall silently
-- (OPEN_REPAIRS 673, session Chanfix; owner request 2 Nov 2026).
--
-- SOURCE-ONLY. Not applied. Lighthouse applies it in the SQL editor after the
-- owner's go. APPLY ORDER: after 2026-10-10-create-client-email-optional.sql
-- (applied, live). Nothing here edits an earlier file or an n8n workflow.
--
-- WHY. The Slack Creative Channel Finalizer (n8n) matches the queued
-- onboarding form to the client's SyncView profile by name AND email. On
-- 2 Nov 2026 the form arrived while the profile had no email (Create client
-- allows that since 2026-10-10), so the finalizer parked the queue row as
-- status "manual", error "client_email_mismatch". Its 15 minute and daily
-- retries only ever read status "pending", so when the email was added later
-- that day nothing looked again, and the channels were made by hand at night.
--
-- WHAT THIS FILE DOES (three small pieces, each safe on its own):
--   1. The form fills the profile email. When an onboarding form row lands
--      (client_onboarding or ai_client_onboarding) and exactly one real,
--      active client without Slack channels has the form's name and no email,
--      the form's email is written to that profile through Roster's own
--      client_profile_service_write (history row, Sheet copy queued), with
--      "email is still empty" as its expectation, so a typed email is never
--      overwritten. The same happens when a profile is created after the form
--      (a deferred trigger, so it runs once Create client has finished its own
--      write, before the commit). Either way the email the finalizer compares
--      is the form's own, so client_email_mismatch cannot happen for a missing
--      email any more.
--   2. Adding an email nudges the finalizer. When a real client's profile
--      email goes from empty to set (any writer: the form, the Clients tab, a
--      backfill), slack_finalizer_nudge() asks the finalizer to look now. Not
--      for a profile created in the same transaction: Create client already
--      nudges once, after the commit.
--   3. A stall is never silent again. View client_slack_channel_stalls_v1
--      lists every real, active client (created, or with a form, in the last
--      30 days) that still has no creative or private Slack channel id, how
--      long it has waited, and what the finalizer is still waiting for. An
--      empty waiting_for means every piece is in place and the channels should
--      exist: the finalizer parked or failed it (read its queue). The
--      supervisor's hourly onboarding watcher reads it, as the database owner.
--
-- SAFETY. Every trigger body runs inside an exception handler: a form insert,
-- a profile create and a profile edit can never fail because of this file.
-- Nothing here calls Slack; the only web call is the existing nudge, which
-- only asks the finalizer to look, and which the finalizer already receives
-- on every create. A test client (kind 'test', a "zzthrowaway" slug or a
-- "ZZ THROWAWAY" name) is never touched, filled or nudged.
--
-- ACCESS. Every function and the view are revoked from all four roles
-- (public, anon, authenticated, service_role) and granted to nobody: only the
-- triggers run the functions (as their owner) and only the owner reads the
-- view.
--
-- Idempotent: safe to run twice. Rollback:
--   drop view if exists public.client_slack_channel_stalls_v1;
--   drop trigger if exists client_onboarding_fill_profile_email on public.client_onboarding;
--   drop trigger if exists ai_client_onboarding_fill_profile_email on public.ai_client_onboarding;
--   drop trigger if exists client_profiles_email_from_form on public.client_profiles;
--   drop trigger if exists client_profiles_email_slack_nudge on public.client_profiles;
--   drop function if exists public.onboarding_form_fill_profile_email();
--   drop function if exists public.client_profiles_email_from_form();
--   drop function if exists public.client_profiles_email_slack_nudge();
--   drop function if exists public.client_profile_email_from_form(text, text);
--   drop function if exists public.onboarding_form_client_name(text, text);
--   drop function if exists public.onboarding_form_at(text);
-- ============================================================
begin;

-- The client name the onboarding provisioning queues for a form: first and
-- last name, each trimmed, joined by one space (n8n "Build Onboarding Brief").
create or replace function public.onboarding_form_client_name(p_first text, p_last text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fn$
  select nullif(btrim(btrim(coalesce(p_first, '')) || ' ' || btrim(coalesce(p_last, ''))), '');
$fn$;

-- The form tables keep created_at as text (ISO 8601, as the form wrote it).
-- Read it as a time, or null when it is not one (never an error).
create or replace function public.onboarding_form_at(p_text text)
returns timestamptz
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $fn$
begin
  return nullif(btrim(coalesce(p_text, '')), '')::timestamptz;
exception when others then
  return null;
end;
$fn$;

-- Copy the newest matching form's email onto one client's profile, if that
-- profile is a real, active client with no email and no Slack channel yet.
-- Returns true when an email was written.
create or replace function public.client_profile_email_from_form(p_slug text, p_request_id text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_name  text;
  v_email text;
begin
  select pr.display_name into v_name
    from public.clients c
    join public.client_profiles pr on pr.slug = c.slug and pr.archived_at is null
   where c.slug = p_slug and c.kind = 'client' and c.active
     and c.slug !~ '^zzthrowaway' and pr.display_name !~* '^zz throwaway'
     and coalesce(btrim(pr.email), '') = ''
     and coalesce(btrim(pr.creative_channel_id), '') = '' and coalesce(btrim(pr.slack_channel_id), '') = '';
  if v_name is null then return false; end if;

  select btrim(f.email) into v_email
    from (select first_name, last_name, email, public.onboarding_form_at(created_at::text) as created_at from public.client_onboarding
          union all
          select first_name, last_name, email, public.onboarding_form_at(created_at::text) from public.ai_client_onboarding) f
   where lower(public.onboarding_form_client_name(f.first_name, f.last_name)) = lower(btrim(v_name))
     and coalesce(btrim(f.email), '') <> ''
   order by f.created_at desc nulls last
   limit 1;
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return false; end if;

  perform public.client_profile_service_write(p_slug, null, jsonb_build_object('email', v_email), '{}'::jsonb,
    jsonb_build_object('email', ''), 'Onboarding form (automatic)', 'n8n', p_request_id);
  return true;
exception when others then
  -- Filling the email is a convenience: whatever goes wrong (an email typed
  -- in the meantime, the roster switch, a lookup), the write it rides on stands.
  return false;
end;
$fn$;

-- 1a. A form lands: fill the matching profile's email.
create or replace function public.onboarding_form_fill_profile_email()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_name  text;
  v_slugs text[];
begin
  begin
    v_name := public.onboarding_form_client_name(new.first_name, new.last_name);
    if v_name is not null and coalesce(btrim(new.email), '') <> '' then
      select array_agg(pr.slug) into v_slugs
        from public.client_profiles pr
        join public.clients c on c.slug = pr.slug and c.kind = 'client' and c.active
       where pr.archived_at is null and lower(btrim(pr.display_name)) = lower(v_name);
      -- Exactly one candidate, or nothing: never guess between two clients.
      if coalesce(array_length(v_slugs, 1), 0) = 1 then
        perform public.client_profile_email_from_form(v_slugs[1], 'onboarding-form:' || tg_table_name || ':' || coalesce(new.id::text, ''));
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$fn$;

drop trigger if exists client_onboarding_fill_profile_email on public.client_onboarding;
create trigger client_onboarding_fill_profile_email
  after insert on public.client_onboarding
  for each row execute function public.onboarding_form_fill_profile_email();
drop trigger if exists ai_client_onboarding_fill_profile_email on public.ai_client_onboarding;
create trigger ai_client_onboarding_fill_profile_email
  after insert on public.ai_client_onboarding
  for each row execute function public.onboarding_form_fill_profile_email();

-- 1b. A profile is created after its form: fill it at the end of the
-- transaction, once the creating write (Create client) has finished.
create or replace function public.client_profiles_email_from_form()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  begin
    perform public.client_profile_email_from_form(new.slug, 'profile-created:' || new.slug);
  exception when others then
    null;
  end;
  return null;
end;
$fn$;

drop trigger if exists client_profiles_email_from_form on public.client_profiles;
create constraint trigger client_profiles_email_from_form
  after insert on public.client_profiles
  deferrable initially deferred
  for each row execute function public.client_profiles_email_from_form();

-- 2. An email arrives on a real client's profile: ask the finalizer to look now.
create or replace function public.client_profiles_email_slack_nudge()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  begin
    if coalesce(btrim(old.email), '') = '' and coalesce(btrim(new.email), '') <> ''
       and old.created_at < transaction_timestamp() then
      perform public.slack_finalizer_nudge(new.slug);
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$fn$;

drop trigger if exists client_profiles_email_slack_nudge on public.client_profiles;
create trigger client_profiles_email_slack_nudge
  after update of email on public.client_profiles
  for each row execute function public.client_profiles_email_slack_nudge();

-- 3. Every real client whose Slack channels have not appeared, and why.
create or replace view public.client_slack_channel_stalls_v1 as
with forms as (
  select public.onboarding_form_client_name(first_name, last_name) as name, btrim(email) as email,
         public.onboarding_form_at(created_at::text) as created_at
    from public.client_onboarding
  union all
  select public.onboarding_form_client_name(first_name, last_name), btrim(email), public.onboarding_form_at(created_at::text)
    from public.ai_client_onboarding
), real_clients as (
  select c.slug, pr.display_name, c.created_at, btrim(coalesce(pr.email, '')) as email,
         coalesce(btrim(pr.creative_channel_id), '') <> '' as has_creative,
         coalesce(btrim(pr.slack_channel_id), '') <> '' as has_private
    from public.clients c
    join public.client_profiles pr on pr.slug = c.slug and pr.archived_at is null
   where c.kind = 'client' and c.active
     and c.slug !~ '^zzthrowaway' and pr.display_name !~* '^zz throwaway'
), joined as (
  select r.*, f.name as form_name, f.email as form_email, f.created_at as form_received_at,
         exists (select 1 from public.social_media_managers m, jsonb_array_elements_text(m.source_clients) x
                  where m.active and lower(btrim(x)) = lower(btrim(r.display_name))
                    and btrim(coalesce(m.slack_profile_url, '')) ~* '^U[A-Z0-9]{6,}$') as manager_slack_id,
         exists (select 1 from public.filming_plans fp
                  where fp.client_slug = r.slug and coalesce(btrim(fp.doc_url), '') <> '' and coalesce(btrim(fp.doc_id), '') <> '') as filming_plan
    from real_clients r
    left join lateral (
      select fo.* from forms fo where lower(fo.name) = lower(btrim(r.display_name))
       order by fo.created_at desc nulls last limit 1) f on true
   where not (r.has_creative and r.has_private)
)
select slug,
       created_at as client_created_at,
       form_received_at,
       greatest(created_at, coalesce(form_received_at, created_at)) as waiting_since,
       round((extract(epoch from now() - greatest(created_at, coalesce(form_received_at, created_at))) / 3600)::numeric, 1) as hours_waiting,
       has_creative, has_private,
       array_remove(array[
         case when form_received_at is null then 'onboarding_form' end,
         case when form_received_at is not null and form_name is distinct from btrim(display_name) then 'name_differs_from_form' end,
         case when email = '' then 'client_email' end,
         case when email <> '' and form_received_at is not null and lower(email) <> lower(coalesce(form_email, '')) then 'email_differs_from_form' end,
         case when not manager_slack_id then 'manager_slack_id' end,
         case when not filming_plan then 'filming_plan' end
       ], null) as waiting_for
  from joined
 where greatest(created_at, coalesce(form_received_at, created_at)) > now() - interval '30 days';

revoke all on function public.onboarding_form_client_name(text, text) from public, anon, authenticated, service_role;
revoke all on function public.onboarding_form_at(text) from public, anon, authenticated, service_role;
revoke all on function public.client_profile_email_from_form(text, text) from public, anon, authenticated, service_role;
revoke all on function public.onboarding_form_fill_profile_email() from public, anon, authenticated, service_role;
revoke all on function public.client_profiles_email_from_form() from public, anon, authenticated, service_role;
revoke all on function public.client_profiles_email_slack_nudge() from public, anon, authenticated, service_role;
revoke all on public.client_slack_channel_stalls_v1 from public, anon, authenticated, service_role;

commit;

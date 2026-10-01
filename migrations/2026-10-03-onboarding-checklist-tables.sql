-- ============================================================
-- 2026-10-03 -- Onboarding checklist, client resources, sales state and backfill
-- proposals: the tables (Stage 2, step 2.1 of
-- docs/plans/2026-10-01-onboarding-checklist-and-profile.md).
--
-- SOURCE-ONLY. Not applied. Lighthouse applies it by hand in the SQL editor,
-- and only after the owner's go at that moment. It creates new tables, one
-- catalog seed, two read views and two functions; it changes no existing table
-- and no runtime flag, and nothing in the app calls any of it yet (the Edge
-- Function is step 2.2). APPLY ORDER: after Roster's 2026-10-02-roster-native.sql
-- (it only references client_profiles(slug), as agreed with Roster).
--
-- WHAT IT ADDS (all additive):
--   onboarding_steps               the checklist catalog, seeded below
--   client_onboarding_progress     one row per client per step
--   client_onboarding_events       append-only history of every change
--   client_resources               facts that have no home today (Drive folder id ...)
--   client_sales_state             HubSpot deal, contract and payment state
--   client_backfill_proposals      Stage 3 proposals, nothing applies until approved
--   client_resource_status_v1      one honest list per client, booleans only
--                                  (includes the facts stored in client_resources)
--   client_onboarding_summary_v1   required steps done and still todo, per client;
--                                  a step with no progress row counts as todo
--   client_onboarding_ensure()     creates the missing todo rows for a client
--   client_onboarding_set_step()   admin only, version checked, writes the event
--
-- WHO MAY DO WHAT. Admin only (owner decision 2026-10-01): the functions refuse
-- any p_role other than 'admin'; the Edge Function (step 2.2) checks the admin
-- key for reads as well. RLS is on with no policies; every privilege on every
-- object is revoked from all four roles (public, anon, authenticated,
-- service_role), then service_role alone gets SELECT on the tables and views and
-- EXECUTE on the two functions. Nobody can write a table directly, history
-- included: the functions are SECURITY DEFINER with a pinned search_path.
-- Views show present or missing, never a token, a credential or a client value.
--
-- ONBOARDED means no required step is still 'todo' (a missing progress row is todo). 'unknown' (backfill could
-- not tell) and 'skipped' (an admin decision, note required) are explicit and do
-- not count as todo. The one optional step never blocks.
--
-- DELETING A TEST CLIENT. Progress, resources, sales state and proposals cascade
-- with the client_profiles row. The event history has no foreign key on purpose
-- and cannot be deleted, so it stays.
--
-- Idempotent: safe to run twice. Rollback: nothing existing was changed; drop the
-- objects named above (children first) if the owner asks.
-- ============================================================
begin;

-- ---------- catalog ----------
create table if not exists public.onboarding_steps (
  step_key    text primary key check (step_key ~ '^[a-z][a-z0-9_]{2,47}$'),
  position    integer not null unique check (position > 0),
  label       text not null check (btrim(label) <> ''),
  kind        text not null check (kind in ('client','auto','claude','owner')),
  required    boolean not null default true,
  detectable  boolean not null default false,
  proof       text not null default '',
  default_owner text not null default 'owner'
);

-- ---------- per client ----------
create table if not exists public.client_onboarding_progress (
  client_slug text not null references public.client_profiles (slug) on delete cascade,
  step_key    text not null references public.onboarding_steps (step_key),
  status      text not null default 'todo' check (status in ('todo','done','skipped','unknown')),
  responsible text not null default 'owner',
  evidence    text,
  note        text,
  source      text not null default 'manual' check (source in ('manual','detected','backfill')),
  done_by     text,
  done_at     timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (client_slug, step_key),
  constraint onboarding_done_has_time check (status <> 'done' or done_at is not null),
  constraint onboarding_skipped_has_note check (status <> 'skipped' or btrim(coalesce(note, '')) <> '')
);

create table if not exists public.client_onboarding_events (
  id          bigint generated always as identity primary key,
  client_slug text not null,
  step_key    text not null,
  action      text not null,
  before_row  jsonb,
  after_row   jsonb,
  actor       text not null,
  role        text not null,
  request_id  text,
  at          timestamptz not null default now()
);
create index if not exists client_onboarding_events_client_idx
  on public.client_onboarding_events (client_slug, at desc);

create or replace function public.client_onboarding_events_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fn$
begin
  raise exception 'client_onboarding_events_append_only';
end;
$fn$;
drop trigger if exists client_onboarding_events_no_change on public.client_onboarding_events;
create trigger client_onboarding_events_no_change
  before update or delete on public.client_onboarding_events
  for each row execute function public.client_onboarding_events_append_only();
drop trigger if exists client_onboarding_events_no_truncate on public.client_onboarding_events;
create trigger client_onboarding_events_no_truncate
  before truncate on public.client_onboarding_events
  for each statement execute function public.client_onboarding_events_append_only();

create table if not exists public.client_resources (
  client_slug  text not null references public.client_profiles (slug) on delete cascade,
  resource_key text not null check (resource_key in (
    'drive_client_folder','drive_filming_plan_folder','hubspot_contact','brain_folder',
    'sandcastles_project','postforme_instagram_account','kickoff_notes')),
  value        text,
  status       text not null default 'unknown' check (status in ('found','missing','unknown','not_applicable')),
  source       text not null default 'manual' check (source in ('manual','brain','hubspot','drive','slack','backfill')),
  confirmed_by text,
  confirmed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (client_slug, resource_key)
);

create table if not exists public.client_sales_state (
  client_slug      text primary key references public.client_profiles (slug) on delete cascade,
  hubspot_deal_id    text,
  hubspot_contact_id text,
  hubspot_stage      text,
  contract_state   text not null default 'unknown' check (contract_state in ('signed','unsigned','unknown')),
  payment_state    text not null default 'unknown' check (payment_state in ('paid','unpaid','unknown')),
  imported_unknown boolean not null default false,
  synced_at        timestamptz,
  updated_at       timestamptz not null default now(),
  constraint sales_imports_stay_unknown check (
    not imported_unknown or (contract_state = 'unknown' and payment_state = 'unknown'))
);

create table if not exists public.client_backfill_proposals (
  id             uuid primary key default gen_random_uuid(),
  client_slug    text not null references public.client_profiles (slug) on delete cascade,
  resource_key   text not null,
  proposed_value text not null,
  source         text not null check (source in ('brain','hubspot','drive','slack')),
  confidence     text not null check (confidence in ('high','medium','low')),
  evidence       text not null default '',
  status         text not null default 'pending' check (status in ('pending','approved','rejected','applied')),
  decided_by     text,
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists client_backfill_proposals_client_idx
  on public.client_backfill_proposals (client_slug, status);

-- ---------- views (booleans and counts only) ----------
create or replace view public.client_resource_status_v1 with (security_invoker = false) as
select
  p.slug as client_slug,
  coalesce(c.active, false) as roster_active,
  exists (select 1 from public.client_access a
           where a.slug = p.slug and btrim(coalesce(a.review_token, '')) <> '') as token_present,
  (select count(*)::int from public.syncview_runtime_flags f
    where f.key in ('sample_review_ef_clients','calendar_upsert_ef_clients',
                    'settings_ef_clients','write_ui_reroute_clients')
      and (f.value->'clients') ? p.slug) as routing_lists_enrolled,
  btrim(coalesce(p.email, '')) <> ''               as email_present,
  btrim(coalesce(p.instagram_handle, '')) <> ''    as instagram_present,
  btrim(coalesce(p.tiktok_handle, '')) <> ''       as tiktok_present,
  btrim(coalesce(p.youtube_channel_id, '')) <> ''  as youtube_present,
  btrim(coalesce(p.slack_channel_id, '')) <> ''    as client_channel_present,
  btrim(coalesce(p.creative_channel_id, '')) <> '' as creative_channel_present,
  btrim(coalesce(p.postforme_account_id, '')) <> '' as postforme_tiktok_present,
  btrim(coalesce(p.competitors, '')) <> ''         as competitors_present,
  btrim(coalesce(p.keywords, '')) <> ''            as keywords_present,
  btrim(coalesce(p.content_description, '')) <> '' as description_present,
  exists (select 1 from public.filming_plans fp
           where fp.client_slug = p.slug and btrim(coalesce(fp.doc_url, '')) <> '') as filming_plan_linked,
  exists (select 1 from public.templates t where t.client_slug = p.slug) as templates_row_present,
  exists (select 1 from public.templates t
           where t.client_slug = p.slug
             and coalesce(t.data->>'thumbnails_canva_link', '') ilike '%canva.com%') as canva_link_present,
  exists (select 1 from public.client_credentials cc where cc.client_slug = p.slug) as credentials_present,
  exists (select 1 from public.client_onboarding o where o.slug = p.slug)
    or exists (select 1 from public.ai_client_onboarding o where o.slug = p.slug) as onboarding_form_present,
  exists (select 1 from public.calendar_posts cp where cp.client = p.slug)   as cards_present,
  exists (select 1 from public.sample_reviews sr where sr.client = p.slug)   as samples_present,
  exists (select 1 from public.analytics_metrics am where am.client_slug = p.slug) as metrics_present,
  -- facts stored in client_resources (found only, never the value)
  exists (select 1 from public.client_resources r where r.client_slug = p.slug and r.resource_key = 'drive_client_folder'
           and r.status = 'found' and btrim(coalesce(r.value, '')) <> '')         as drive_client_folder_found,
  exists (select 1 from public.client_resources r where r.client_slug = p.slug and r.resource_key = 'drive_filming_plan_folder'
           and r.status = 'found' and btrim(coalesce(r.value, '')) <> '')         as drive_filming_plan_folder_found,
  exists (select 1 from public.client_resources r where r.client_slug = p.slug and r.resource_key = 'hubspot_contact'
           and r.status = 'found' and btrim(coalesce(r.value, '')) <> '')         as hubspot_contact_found,
  exists (select 1 from public.client_resources r where r.client_slug = p.slug and r.resource_key = 'brain_folder'
           and r.status = 'found' and btrim(coalesce(r.value, '')) <> '')         as brain_folder_found,
  exists (select 1 from public.client_resources r where r.client_slug = p.slug and r.resource_key = 'sandcastles_project'
           and r.status = 'found' and btrim(coalesce(r.value, '')) <> '')         as sandcastles_project_found,
  exists (select 1 from public.client_resources r where r.client_slug = p.slug and r.resource_key = 'postforme_instagram_account'
           and r.status = 'found' and btrim(coalesce(r.value, '')) <> '')         as postforme_instagram_found,
  exists (select 1 from public.client_sales_state s where s.client_slug = p.slug
           and btrim(coalesce(s.hubspot_deal_id, '')) <> '')                      as hubspot_deal_found
from public.client_profiles p
left join public.clients c on c.slug = p.slug
where p.archived_at is null;

create or replace view public.client_onboarding_summary_v1 with (security_invoker = false) as
-- Every live profile crossed with the catalog; a step with no progress row yet
-- counts as todo, so completeness never depends on client_onboarding_ensure()
-- having run, and a step added to the catalog later reopens "onboarded".
select
  p.slug as client_slug,
  count(*) filter (where s.required)::int                                                   as required_steps,
  count(*) filter (where s.required and g.status = 'done')::int                             as required_done,
  count(*) filter (where s.required and coalesce(g.status, 'todo') = 'todo')::int           as required_todo,
  count(*) filter (where s.required and g.status in ('unknown','skipped'))::int             as required_decided_other,
  (count(*) filter (where s.required and coalesce(g.status, 'todo') = 'todo') = 0)          as onboarded
from public.client_profiles p
cross join public.onboarding_steps s
left join public.client_onboarding_progress g
       on g.client_slug = p.slug and g.step_key = s.step_key
where p.archived_at is null
group by p.slug;

-- ---------- functions ----------
create or replace function public.client_onboarding_ensure(p_slug text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare n integer;
begin
  if not exists (select 1 from public.client_profiles where slug = p_slug and archived_at is null) then
    raise exception 'client_onboarding_client_missing';
  end if;
  insert into public.client_onboarding_progress (client_slug, step_key, responsible)
  select p_slug, s.step_key, s.default_owner
    from public.onboarding_steps s
  on conflict (client_slug, step_key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

create or replace function public.client_onboarding_set_step(
  p_slug text,
  p_step_key text,
  p_status text,
  p_evidence text,
  p_note text,
  p_actor text,
  p_role text,
  p_expected_updated_at timestamptz,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  cur public.client_onboarding_progress;
  nxt public.client_onboarding_progress;
begin
  if p_role is distinct from 'admin' then raise exception 'client_onboarding_admin_only'; end if;
  if btrim(coalesce(p_actor, '')) = '' then raise exception 'client_onboarding_actor_required'; end if;
  if p_status not in ('todo','done','skipped','unknown') then raise exception 'client_onboarding_bad_status'; end if;
  if p_status = 'skipped' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'client_onboarding_skip_needs_note';
  end if;
  if not exists (select 1 from public.onboarding_steps where step_key = p_step_key) then
    raise exception 'client_onboarding_unknown_step';
  end if;
  perform public.client_onboarding_ensure(p_slug);

  select * into cur from public.client_onboarding_progress
   where client_slug = p_slug and step_key = p_step_key for update;
  if cur.updated_at is distinct from p_expected_updated_at then
    raise exception 'client_onboarding_version_conflict';
  end if;

  update public.client_onboarding_progress
     set status = p_status,
         evidence = p_evidence,
         note = p_note,
         source = 'manual',
         done_by = case when p_status = 'done' then p_actor else null end,
         done_at = case when p_status = 'done' then now() else null end,
         updated_at = now()
   where client_slug = p_slug and step_key = p_step_key
  returning * into nxt;

  insert into public.client_onboarding_events
    (client_slug, step_key, action, before_row, after_row, actor, role, request_id)
  values
    (p_slug, p_step_key, 'set_' || p_status, to_jsonb(cur), to_jsonb(nxt), p_actor, p_role, p_request_id);

  return jsonb_build_object('client_slug', p_slug, 'step_key', p_step_key,
                            'status', nxt.status, 'updated_at', nxt.updated_at);
end;
$fn$;

-- ---------- access: all four roles revoked, then service_role alone ----------
alter table public.onboarding_steps            enable row level security;
alter table public.client_onboarding_progress  enable row level security;
alter table public.client_onboarding_events    enable row level security;
alter table public.client_resources            enable row level security;
alter table public.client_sales_state          enable row level security;
alter table public.client_backfill_proposals   enable row level security;

revoke all on table public.onboarding_steps, public.client_onboarding_progress,
  public.client_onboarding_events, public.client_resources, public.client_sales_state,
  public.client_backfill_proposals, public.client_resource_status_v1,
  public.client_onboarding_summary_v1
  from public, anon, authenticated, service_role;
revoke all on sequence public.client_onboarding_events_id_seq from public, anon, authenticated, service_role;
revoke all on function public.client_onboarding_events_append_only() from public, anon, authenticated, service_role;
revoke all on function public.client_onboarding_ensure(text) from public, anon, authenticated, service_role;
revoke all on function public.client_onboarding_set_step(text, text, text, text, text, text, text, timestamptz, text)
  from public, anon, authenticated, service_role;

grant select on public.onboarding_steps, public.client_onboarding_progress,
  public.client_onboarding_events, public.client_resources, public.client_sales_state,
  public.client_backfill_proposals, public.client_resource_status_v1,
  public.client_onboarding_summary_v1 to service_role;
grant execute on function public.client_onboarding_ensure(text) to service_role;
grant execute on function public.client_onboarding_set_step(text, text, text, text, text, text, text, timestamptz, text)
  to service_role;

-- ---------- catalog seed (list 1 of the 2026-10-01 audit, minus the kickoff call) ----------
insert into public.onboarding_steps (step_key, position, label, kind, required, detectable, proof, default_owner) values
  ('intro_call_booked',        1, 'Intro call booked',                         'auto',   true,  true,  'HubSpot deal reached Call Scheduled', 'owner'),
  ('sales_intake_submitted',   2, 'Sales intake submitted, contract and payment link sent', 'owner', true, false, 'Sales intake row', 'owner'),
  ('contract_signed',          3, 'Client signed the contract',                'client', true,  true,  'HubSpot contract flag', 'owner'),
  ('first_payment_received',   4, 'Client paid the first invoice',             'client', true,  true,  'HubSpot payment flag', 'owner'),
  ('onboarding_email_sent',    5, 'Onboarding email sent',                     'auto',   true,  true,  'HubSpot onboarding_sent flag', 'owner'),
  ('expectations_video_seen',  6, 'Client watched the what-to-expect video',   'client', true,  false, 'Owner confirms', 'owner'),
  ('onboarding_form_received', 7, 'Onboarding form received',                  'client', true,  true,  'Row in the onboarding tables', 'owner'),
  ('provisioning_ran',         8, 'Provisioning ran (Drive folder, HubSpot end state, Slack job queued)', 'auto', true, false, 'Drive folder id saved', 'owner'),
  ('research_done',            9, 'Keywords, competitors and description written', 'claude', true, true, 'Profile fields filled', 'owner'),
  ('roster_row_created',      10, 'Client exists on the roster and has a profile', 'owner', true, true, 'clients and client_profiles rows', 'owner'),
  ('routing_enrolled',        11, 'Client enrolled in all four routing lists', 'auto',   true,  true,  'Four routing lists name the client', 'owner'),
  ('review_token_present',    12, 'Review token exists',                       'auto',   true,  true,  'client_access row', 'owner'),
  ('smm_assigned',           13, 'Social media manager assigned',             'owner',  true,  false, 'SMM assignment', 'owner'),
  ('client_channel_created', 14, 'Private client Slack channel created',      'auto',   true,  true,  'slack_channel_id filled by the finalizer', 'owner'),
  ('creative_channel_created',15,'Creative Slack channel created',            'auto',   true,  true,  'creative_channel_id filled by the finalizer', 'owner'),
  ('kickoff_message_filled', 16, 'Kickoff message placeholders filled',       'owner',  true,  false, 'Owner confirms', 'owner'),
  ('filming_plan_linked',    17, 'Filming plan Doc created and linked',       'claude', true,  true,  'filming_plans link', 'owner'),
  ('templates_and_canva',    18, 'Templates saved with the thumbnail Canva link', 'owner', true, true, 'templates row with a Canva link', 'owner'),
  ('brain_folder_and_brief', 19, 'Brain folder and Editor brief created',     'claude', true,  false, 'Brain folder exists', 'owner'),
  ('ideas_pipeline_setup',   20, 'Ideas pipeline set up (ideas Sheet, Sandcastles project)', 'claude', true, false, 'Pipeline config exists', 'owner'),
  ('first_card_created',     21, 'First real card created',                   'owner',  true,  true,  'A calendar card exists', 'owner'),
  ('samples_started',        22, 'Samples started',                           'owner',  true,  true,  'A sample review exists', 'owner'),
  ('metrics_appearing',      23, 'Metrics appear the next morning',           'auto',   true,  true,  'analytics_metrics rows', 'owner'),
  ('social_posting_ids',     24, 'Social posting account ids connected',      'owner',  true,  true,  'postforme ids filled (skip with a note if not used)', 'owner'),
  ('sandcastles_watchlist',  25, 'Client and competitors on the Sandcastles watchlist', 'owner', true, false, 'Owner confirms (skip with a note if not used)', 'owner'),
  ('monthly_checkin_optin',  26, 'Monthly check-in opt-in decided',           'owner',  true,  false, 'Owner confirms (skip with a note to opt out)', 'owner'),
  ('syncview_link_sent',     27, 'SyncView link sent to the client (optional, never blocks)', 'owner', false, false, 'Owner confirms', 'owner')
on conflict (step_key) do nothing;

commit;

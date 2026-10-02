-- Disposable-cluster proof for migrations/2026-10-04-client-hubspot-sync.sql.
-- Run on a THROWAWAY PostgreSQL (never a real project), as a superuser, from the repository root:
--   psql -v ON_ERROR_STOP=1 -d <empty database> -f scripts/client-hubspot-sync-proof.sql
-- (it \i-includes the checklist migration and the sync migration). Fictional data only.
-- Ends with the line: CLIENT_HUBSPOT_SYNC_PROOF_OK
\set ON_ERROR_STOP on
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;

create table public.clients (slug text primary key, active boolean not null default true, kind text not null default 'client');
create table public.client_profiles (slug text primary key, email text, instagram_handle text, tiktok_handle text,
  youtube_channel_id text, slack_channel_id text, creative_channel_id text, postforme_account_id text,
  competitors text, keywords text, content_description text, archived_at timestamptz);
create table public.client_access (slug text primary key, review_token text);
create table public.syncview_runtime_flags (key text primary key, value jsonb not null);
create table public.filming_plans (client_slug text primary key, doc_url text);
create table public.templates (client_slug text primary key, data jsonb);
create table public.client_credentials (id bigserial primary key, client_slug text);
create table public.client_onboarding (id bigserial primary key, slug text);
create table public.ai_client_onboarding (id bigserial primary key, slug text);
create table public.calendar_posts (client text, id text, primary key (client, id));
create table public.sample_reviews (client text, id text, primary key (client, id));
create table public.analytics_metrics (client_slug text, date date);

insert into public.clients values ('alpha', true, 'client'), ('beta', true, 'client'), ('gamma', true, 'client'),
  ('delta', true, 'client'), ('retired', false, 'client'), ('tester', true, 'test');
insert into public.client_profiles (slug, email) values ('alpha', 'a@example.test'), ('beta', 'b@example.test'),
  ('gamma', null), ('delta', 'd@example.test'), ('retired', 'r@example.test'), ('tester', 't@example.test');
update public.client_profiles set archived_at = now() where slug = 'delta';

\i migrations/2026-10-03-onboarding-checklist-tables.sql
\i migrations/2026-10-04-client-hubspot-sync.sql
\i migrations/2026-10-04-client-hubspot-sync.sql

do $proof$
declare r jsonb; n int; ev int; v record;
begin
  -- targets: active, non-archived clients of kind 'client' only; never-synced first; the limit holds
  if (select array_agg(client_slug order by client_slug) from public.client_hubspot_sync_targets(null, 6, 1380)) is distinct from array['alpha','beta','gamma'] then
    raise exception 'targets: %', (select array_agg(client_slug) from public.client_hubspot_sync_targets(null, 6, 1380));
  end if;
  if (select count(*) from public.client_hubspot_sync_targets(null, 2, 1380)) <> 2 then raise exception 'targets limit'; end if;
  if (select email from public.client_hubspot_sync_targets('gamma')) <> '' then raise exception 'blank email comes back blank'; end if;
  if (select count(*) from public.client_hubspot_sync_targets('tester')) <> 1 then raise exception 'the test client can be named'; end if;
  if (select count(*) from public.client_hubspot_sync_targets('retired')) <> 0 or (select count(*) from public.client_hubspot_sync_targets('delta')) <> 0 then
    raise exception 'inactive and archived clients are never targets';
  end if;

  -- a unique match saves the ids and states, records the contact resource, writes one history row
  r := public.client_sales_state_apply('alpha', 'matched', 'D1', 'C1', 'stage_x', 'signed', 'paid', 'system', 'req-1');
  if (r->>'changed')::boolean is not true or r->>'contract_state' <> 'signed' or r->>'payment_state' <> 'paid' then raise exception 'matched: %', r; end if;
  if not exists (select 1 from public.client_sales_state where client_slug = 'alpha' and hubspot_deal_id = 'D1' and hubspot_contact_id = 'C1' and hubspot_stage = 'stage_x' and hubspot_match = 'matched' and synced_at is not null) then raise exception 'row'; end if;
  if not exists (select 1 from public.client_resources where client_slug = 'alpha' and resource_key = 'hubspot_contact' and value = 'C1' and status = 'found' and source = 'hubspot') then raise exception 'resource'; end if;
  select count(*) into ev from public.client_onboarding_events where client_slug = 'alpha' and step_key = 'sales_state';
  if ev <> 1 then raise exception 'one event for the first match, got %', ev; end if;

  -- the same answer again: nothing changed, no new history row, but the sync time moves
  update public.client_sales_state set synced_at = now() - interval '2 days' where client_slug = 'alpha';
  r := public.client_sales_state_apply('alpha', 'matched', 'D1', 'C1', 'stage_x', 'signed', 'paid', 'system', 'req-2');
  if (r->>'changed')::boolean is not false then raise exception 'unchanged refresh must say changed false: %', r; end if;
  select count(*) into ev from public.client_onboarding_events where client_slug = 'alpha' and step_key = 'sales_state';
  if ev <> 1 then raise exception 'a daily refresh must not write history, got %', ev; end if;
  if (select synced_at from public.client_sales_state where client_slug = 'alpha') < now() - interval '1 minute' then raise exception 'synced_at must move'; end if;
  if exists (select 1 from public.client_hubspot_sync_targets(null, 6, 1380) where client_slug = 'alpha') then raise exception 'a fresh client is not a target'; end if;
  update public.client_sales_state set synced_at = now() - interval '2 days' where client_slug = 'alpha';
  if not exists (select 1 from public.client_hubspot_sync_targets(null, 6, 1380) where client_slug = 'alpha') then raise exception 'a stale client is a target'; end if;

  -- a later failed match keeps the earlier ids and states and only records why
  r := public.client_sales_state_apply('alpha', 'ambiguous_deal', null, null, null, 'unsigned', 'unpaid', 'system', 'req-3');
  if not exists (select 1 from public.client_sales_state where client_slug = 'alpha' and hubspot_deal_id = 'D1' and hubspot_contact_id = 'C1'
                   and contract_state = 'signed' and payment_state = 'paid' and hubspot_match = 'ambiguous_deal') then raise exception 'ambiguity must not wipe earlier data'; end if;
  select count(*) into ev from public.client_onboarding_events where client_slug = 'alpha' and step_key = 'sales_state';
  if ev <> 2 then raise exception 'a changed reason is one history row, got %', ev; end if;

  -- no contact: the resource is recorded as missing, and never overwrites a found one
  perform public.client_sales_state_apply('beta', 'no_contact', null, null, null, null, null, 'system', 'req-4');
  if (select status from public.client_resources where client_slug = 'beta' and resource_key = 'hubspot_contact') <> 'missing' then raise exception 'missing contact'; end if;
  perform public.client_sales_state_apply('alpha', 'no_contact', null, null, null, null, null, 'system', 'req-5');
  if (select status from public.client_resources where client_slug = 'alpha' and resource_key = 'hubspot_contact') <> 'found' then raise exception 'found must survive a later no_contact'; end if;
  if (select contract_state from public.client_sales_state where client_slug = 'beta') <> 'unknown' then raise exception 'no match means unknown, never unpaid'; end if;

  -- a hand-imported customer stays unknown whatever HubSpot says
  insert into public.client_sales_state (client_slug, imported_unknown) values ('gamma', true);
  r := public.client_sales_state_apply('gamma', 'matched', 'D3', 'C3', 'closedwon', 'signed', 'paid', 'system', 'req-6');
  if r->>'contract_state' <> 'unknown' or r->>'payment_state' <> 'unknown' then raise exception 'imports stay unknown: %', r; end if;
  if not exists (select 1 from public.client_sales_state where client_slug = 'gamma' and hubspot_deal_id = 'D3' and imported_unknown) then raise exception 'import keeps its deal id'; end if;

  -- refusals
  for v in select * from (values
    ('client_sales_state_bad_match',        $q$select public.client_sales_state_apply('alpha','maybe',null,null,null,null,null,'system',null)$q$),
    ('client_sales_state_bad_state',        $q$select public.client_sales_state_apply('alpha','matched','D','C','s','signed','late','system',null)$q$),
    ('client_sales_state_actor_required',   $q$select public.client_sales_state_apply('alpha','no_deal',null,null,null,null,null,' ',null)$q$),
    ('client_sales_state_client_missing',   $q$select public.client_sales_state_apply('nobody','no_deal',null,null,null,null,null,'system',null)$q$),
    ('client_sales_state_client_missing',   $q$select public.client_sales_state_apply('delta','no_deal',null,null,null,null,null,'system',null)$q$),
    ('client_sales_state_match_needs_ids',  $q$select public.client_sales_state_apply('alpha','matched',' ','C','s','signed','paid','system',null)$q$)
  ) as t(want, stmt) loop
    begin execute v.stmt; raise exception 'expected % to refuse', v.want;
    exception when others then if sqlerrm <> v.want then raise; end if; end;
  end loop;

  -- access: service_role EXECUTE only; nobody else, and nobody writes the table directly
  for v in select p.proname, p.oid from pg_proc p where p.proname in ('client_hubspot_sync_targets', 'client_sales_state_apply') loop
    if not has_function_privilege('service_role', v.oid, 'execute') then raise exception 'service_role lacks execute on %', v.proname; end if;
    if has_function_privilege('anon', v.oid, 'execute') or has_function_privilege('authenticated', v.oid, 'execute') or has_function_privilege('public', v.oid, 'execute') then
      raise exception 'only service_role may execute %', v.proname;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.client_sales_state', 'insert') or has_table_privilege('service_role', 'public.client_sales_state', 'update') then
    raise exception 'nobody writes client_sales_state directly';
  end if;
end
$proof$;
\echo CLIENT_HUBSPOT_SYNC_PROOF_OK

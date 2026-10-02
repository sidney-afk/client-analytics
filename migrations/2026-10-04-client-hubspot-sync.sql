-- STATE: BUILT, NOT APPLIED. Lighthouse applies it by hand in the SQL editor, after the
-- owner's go at that moment, and only AFTER 2026-10-03-onboarding-checklist-tables.sql.
--
-- Step 2.3b of docs/plans/2026-10-01-onboarding-checklist-and-profile.md: the two database
-- functions the client-hubspot-sync Edge Function needs. Nothing here reaches HubSpot and
-- nothing runs by itself; applying it changes no behaviour until the function is deployed,
-- its secrets are set and the switch (syncview_runtime_flags row client_hubspot_sync) is on.
--
--   client_hubspot_sync_targets()  which clients to look up next (an id, an email, when last synced).
--   client_sales_state_apply()     the ONLY writer of client_sales_state: one HubSpot match result
--                                  for one client, with a history row when something changed.
--
-- Rules the writer enforces (so the function cannot get them wrong):
--   * A hand-imported customer (client_sales_state.imported_unknown) keeps contract and payment
--     "unknown", whatever HubSpot says. "Unknown" is never turned into "unpaid".
--   * Only a unique match saves ids and states. No contact, two contacts, no deal or several
--     deals only record WHY (hubspot_match) and when; earlier ids are left alone.
--   * One history row per real change, never one per daily refresh.
--
-- Access: all four roles (public, anon, authenticated, service_role) are revoked on both
-- functions, then service_role alone gets EXECUTE.
-- Rollback (one statement each, nothing else depends on them):
--   drop function public.client_hubspot_sync_targets(text, integer, integer);
--   drop function public.client_sales_state_apply(text, text, text, text, text, text, text, text, text);
--   alter table public.client_sales_state drop column hubspot_match;
begin;

do $guard$
begin
  if to_regclass('public.client_sales_state') is null or to_regclass('public.client_resources') is null
     or to_regclass('public.client_onboarding_events') is null then
    raise exception 'apply 2026-10-03-onboarding-checklist-tables.sql first';
  end if;
end
$guard$;

alter table public.client_sales_state add column if not exists hubspot_match text;
do $con$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_sales_state_hubspot_match_check'
                   and conrelid = 'public.client_sales_state'::regclass) then
    alter table public.client_sales_state add constraint client_sales_state_hubspot_match_check
      check (hubspot_match is null or hubspot_match in
        ('matched','no_email','no_contact','ambiguous_contact','no_deal','ambiguous_deal'));
  end if;
end
$con$;

-- Which clients to look up. With p_slug: that one client (the test kind is allowed, so the first
-- live run can be the test client). Without: active clients of kind 'client' not synced within
-- p_stale_minutes, never-synced first, at most p_limit of them.
create or replace function public.client_hubspot_sync_targets(
  p_slug text default null,
  p_limit integer default 6,
  p_stale_minutes integer default 1380
) returns table (client_slug text, email text, synced_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
  select p.slug, btrim(coalesce(p.email, '')), s.synced_at
    from public.client_profiles p
    join public.clients c on c.slug = p.slug
    left join public.client_sales_state s on s.client_slug = p.slug
   where p.archived_at is null
     and c.active
     and ((p_slug is null and c.kind = 'client')
          or (p_slug is not null and p.slug = p_slug and c.kind in ('client', 'test')))
     and (p_slug is not null
          or s.synced_at is null
          or s.synced_at < now() - make_interval(mins => greatest(p_stale_minutes, 1)))
   order by s.synced_at asc nulls first, p.slug
   limit least(greatest(coalesce(p_limit, 6), 1), 50)
$fn$;

create or replace function public.client_sales_state_apply(
  p_slug text,
  p_match text,
  p_deal_id text,
  p_contact_id text,
  p_stage text,
  p_contract_state text,
  p_payment_state text,
  p_actor text,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  cur public.client_sales_state;
  nxt public.client_sales_state;
  contract_v text := coalesce(p_contract_state, 'unknown');
  payment_v text := coalesce(p_payment_state, 'unknown');
  changed boolean;
begin
  if p_match not in ('matched','no_email','no_contact','ambiguous_contact','no_deal','ambiguous_deal') then
    raise exception 'client_sales_state_bad_match';
  end if;
  if contract_v not in ('signed','unsigned','unknown') or payment_v not in ('paid','unpaid','unknown') then
    raise exception 'client_sales_state_bad_state';
  end if;
  if btrim(coalesce(p_actor, '')) = '' then raise exception 'client_sales_state_actor_required'; end if;
  if not exists (select 1 from public.client_profiles where slug = p_slug and archived_at is null) then
    raise exception 'client_sales_state_client_missing';
  end if;
  if p_match = 'matched' and (btrim(coalesce(p_deal_id, '')) = '' or btrim(coalesce(p_contact_id, '')) = '') then
    raise exception 'client_sales_state_match_needs_ids';
  end if;

  select * into cur from public.client_sales_state where client_slug = p_slug for update;

  if cur.client_slug is null then
    insert into public.client_sales_state (client_slug) values (p_slug) returning * into cur;
  end if;

  if cur.imported_unknown then contract_v := 'unknown'; payment_v := 'unknown'; end if;

  if p_match = 'matched' then
    update public.client_sales_state
       set hubspot_deal_id = btrim(p_deal_id), hubspot_contact_id = btrim(p_contact_id),
           hubspot_stage = nullif(btrim(coalesce(p_stage, '')), ''),
           contract_state = contract_v, payment_state = payment_v,
           hubspot_match = 'matched', synced_at = now(), updated_at = now()
     where client_slug = p_slug returning * into nxt;
    insert into public.client_resources (client_slug, resource_key, value, status, source, confirmed_by, confirmed_at)
    values (p_slug, 'hubspot_contact', btrim(p_contact_id), 'found', 'hubspot', p_actor, now())
    on conflict (client_slug, resource_key) do update
      set value = excluded.value, status = 'found', source = 'hubspot',
          confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at, updated_at = now();
  else
    update public.client_sales_state
       set hubspot_match = p_match, synced_at = now(), updated_at = now()
     where client_slug = p_slug returning * into nxt;
    if p_match in ('no_contact', 'no_email') then
      insert into public.client_resources (client_slug, resource_key, status, source, confirmed_by, confirmed_at)
      values (p_slug, 'hubspot_contact', 'missing', 'hubspot', p_actor, now())
      on conflict (client_slug, resource_key) do nothing;
    end if;
  end if;

  changed := (cur.hubspot_deal_id, cur.hubspot_contact_id, cur.hubspot_stage, cur.contract_state, cur.payment_state, cur.hubspot_match)
             is distinct from
             (nxt.hubspot_deal_id, nxt.hubspot_contact_id, nxt.hubspot_stage, nxt.contract_state, nxt.payment_state, nxt.hubspot_match);
  if changed then
    insert into public.client_onboarding_events
      (client_slug, step_key, action, before_row, after_row, actor, role, request_id)
    values
      (p_slug, 'sales_state', 'hubspot_sync_' || p_match, to_jsonb(cur), to_jsonb(nxt), p_actor, 'system', p_request_id);
  end if;

  return jsonb_build_object('client_slug', p_slug, 'match', nxt.hubspot_match, 'changed', changed,
                            'contract_state', nxt.contract_state, 'payment_state', nxt.payment_state,
                            'synced_at', nxt.synced_at);
end;
$fn$;

revoke all on function public.client_hubspot_sync_targets(text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.client_sales_state_apply(text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.client_hubspot_sync_targets(text, integer, integer) to service_role;
grant execute on function public.client_sales_state_apply(text, text, text, text, text, text, text, text, text) to service_role;

commit;

-- VERIFY (read only):
--   select p.proname, has_function_privilege('service_role', p.oid, 'execute') as service_role,
--          has_function_privilege('anon', p.oid, 'execute') as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated
--     from pg_proc p where p.proname in ('client_hubspot_sync_targets','client_sales_state_apply');
--   (two rows: service_role true, anon false, authenticated false)

-- MANUAL ONLY. No automatic migration or scheduling activation.
-- Run with psql ON_ERROR_STOP and variables mode=backup|scratch,
-- existing_role=<already provisioned dedicated role>, and
-- confirmation=HISTORY_BACKUP_GRANTS_ONLY|DISPOSABLE_SCRATCH_ONLY.
-- For scratch ALSO pass scratch_project_ref=<independently verified target ref>.
-- Never put connection credentials or actual role names in this public file.
-- Prerequisites: reviewed journal schema + PR #1293 manifest schema at 5418ab56;
-- this artifact does not install either schema, create roles or set passwords.
\set ON_ERROR_STOP on
begin;
select set_config('track_b.setup_mode', :'mode', true);
select set_config('track_b.setup_role', :'existing_role', true);
select set_config('track_b.setup_confirmation', :'confirmation', true);
select :'mode' = 'scratch' as is_scratch \gset
\if :is_scratch
select set_config('track_b.setup_scratch_ref', :'scratch_project_ref', true);
\endif

do $prerequisites$
declare
  mode text := current_setting('track_b.setup_mode');
  role_name text := current_setting('track_b.setup_role');
  relation_name text;
  sequence_name text;
  role_record record;
  expected_keys text[];
  actual_keys text[];
  relations constant text[] := array[
    'team_members','clients','client_access','client_access_events',
    'syncview_auth_events','syncview_runtime_flags','flag_flips','settings_events',
    'batches','deliverables','production_comments','deliverable_events',
    'mirror_outbox','linear_archive','calendar_posts','sample_reviews',
    'calendar_post_events','sample_review_events','workload_plan',
    'card_change_journal','production_intake_manifests'];
begin
  if mode not in ('backup','scratch') then raise exception 'Unsupported prerequisite mode'; end if;
  if current_setting('track_b.setup_confirmation') <> (case when mode='backup'
    then 'HISTORY_BACKUP_GRANTS_ONLY' else 'DISPOSABLE_SCRATCH_ONLY' end) then
    raise exception 'Explicit prerequisite confirmation required';
  end if;
  if mode='scratch' and (coalesce(current_setting('track_b.setup_scratch_ref',true),'') !~ '^[a-z0-9]{20}$'
    or current_setting('track_b.setup_scratch_ref')='uzltbbrjidmjwwfakwve') then
    raise exception 'Independent non-production scratch ref required';
  end if;
  if mode='scratch' and to_regprocedure('public.track_b_restore_set_history_user_triggers(boolean)') is not null then
    raise exception 'Existing history helper requires independent owner and ACL review before replacement';
  end if;
  select * into role_record from pg_roles where rolname=role_name;
  if not found or role_name in ('anon','authenticated','service_role','postgres')
    or role_record.rolsuper or role_record.rolcreaterole or role_record.rolcreatedb
    or role_name=current_user then raise exception 'Existing dedicated restricted role required'; end if;
  if mode='backup' and not role_record.rolbypassrls then raise exception 'Backup BYPASSRLS prerequisite missing'; end if;
  -- Complete validation precedes every GRANT. Missing objects abort everything.
  foreach relation_name in array relations loop
    if to_regclass('public.' || relation_name) is null then raise exception 'History corpus relation missing'; end if;
    expected_keys := case relation_name
      when 'clients' then array['slug'] when 'client_access' then array['slug']
      when 'syncview_runtime_flags' then array['key'] when 'linear_archive' then array['linear_uuid']
      when 'calendar_posts' then array['client','id'] when 'sample_reviews' then array['client','id']
      when 'workload_plan' then array['issue_id'] when 'production_intake_manifests' then array['request_id']
      else array['id'] end;
    select array_agg(a.attname::text order by k.ordinality) into actual_keys
      from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum,ordinality)
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
      where i.indrelid=to_regclass('public.' || relation_name) and i.indisprimary;
    if actual_keys is distinct from expected_keys then raise exception 'History corpus primary key mismatch'; end if;
    if has_table_privilege(role_name,'public.' || relation_name,'UPDATE')
      or has_table_privilege(role_name,'public.' || relation_name,'DELETE')
      or (mode='backup' and (has_table_privilege(role_name,'public.' || relation_name,'INSERT')
        or has_table_privilege(role_name,'public.' || relation_name,'TRUNCATE'))) then
      raise exception 'Dedicated role has forbidden inherited or direct write privileges';
    end if;
    if relation_name = any(array['client_access_events','syncview_auth_events','flag_flips','settings_events',
      'deliverable_events','mirror_outbox','calendar_post_events','sample_review_events','card_change_journal'])
      and pg_get_serial_sequence('public.' || relation_name,'id') is null then
      raise exception 'History identity sequence missing';
    end if;
  end loop;
  execute format('grant usage on schema public to %I',role_name);
  foreach relation_name in array relations loop
    execute format('grant %s on table public.%I to %I',
      case when mode='backup' then 'select' else 'select, insert, truncate' end,relation_name,role_name);
    sequence_name := case when relation_name = any(array['client_access_events','syncview_auth_events','flag_flips','settings_events',
      'deliverable_events','mirror_outbox','calendar_post_events','sample_review_events','card_change_journal'])
      then pg_get_serial_sequence('public.' || relation_name,'id') else null end;
    if sequence_name is not null then
      execute format('grant %s on sequence %s to %I',
        case when mode='backup' then 'select' else 'select, usage, update' end,sequence_name,role_name);
    end if;
  end loop;
end $prerequisites$;

\if :is_scratch
-- This boolean helper has a distinct name; the installed legacy helper is untouched.
-- Invoke only inside the restore transaction. A failed COPY rolls back trigger state.
create or replace function public.track_b_restore_set_history_user_triggers(enabled boolean)
returns void language plpgsql security definer set search_path=pg_catalog as $helper$
declare
  relation_name text;
  relations constant text[] := array[
    'team_members','clients','client_access','client_access_events',
    'syncview_auth_events','syncview_runtime_flags','flag_flips','settings_events',
    'batches','deliverables','production_comments','deliverable_events',
    'mirror_outbox','linear_archive','calendar_posts','sample_reviews',
    'calendar_post_events','sample_review_events','workload_plan',
    'card_change_journal','production_intake_manifests'];
begin
  if enabled is null then raise exception 'Trigger state must be explicit'; end if;
  foreach relation_name in array relations loop
    if to_regclass('public.' || relation_name) is null then raise exception 'History corpus relation missing'; end if;
    if not enabled and exists(select 1 from pg_trigger where tgrelid=to_regclass('public.' || relation_name)
      and not tgisinternal and tgenabled<>'O') then
      raise exception 'Scratch user triggers must start enabled normally';
    end if;
    execute format('alter table public.%I %s trigger user',relation_name,case when enabled then 'enable' else 'disable' end);
  end loop;
end $helper$;
revoke all on function public.track_b_restore_set_history_user_triggers(boolean) from public;
revoke all on function public.track_b_restore_set_history_user_triggers(boolean) from anon, authenticated, service_role;
grant execute on function public.track_b_restore_set_history_user_triggers(boolean) to :"existing_role";
\endif
commit;

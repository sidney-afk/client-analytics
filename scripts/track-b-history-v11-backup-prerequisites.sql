-- v11: exact52 tables; adds ordinary native receipts plus notification/reconciliation durable owners after v10.
-- RELEASE BLOCKER: this grants artifact does not install or reconstruct schema.
-- MANUAL ONLY. Run with psql ON_ERROR_STOP and variables
-- mode=backup|scratch, existing_role=<restricted existing role>, and
-- confirmation=HISTORY_V11_BACKUP_GRANTS_ONLY|DISPOSABLE_SCRATCH_ONLY.
-- Scratch additionally requires scratch_project_ref=<independently verified ref>.
-- Never place credentials or actual role names in this public artifact.
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
  protected_role text;
  validator text;
  expected_keys text[];
  actual_keys text[];
  validators constant text[] := array[
    'public._linear_intake_is_string_array(jsonb)',
    'public._linear_intake_canonical_json(jsonb)',
    'public._linear_intake_sha256_hex(text)',
    'public._linear_intake_payload_is_canonical(text)',
    'public._linear_intake_expected_child_count(jsonb)',
    'public._linear_intake_replay_note_is_valid(text,text,text,text,integer,text,jsonb)'];
  relations constant text[] := array[
    'team_members','clients','client_access','client_access_events',
    'syncview_auth_events','syncview_runtime_flags','flag_flips','settings_events',
    'batches','deliverables','production_comments','deliverable_events','mirror_outbox',
    'linear_archive','calendar_posts','sample_reviews','calendar_post_events',
    'sample_review_events','workload_plan','card_change_journal','production_intake_manifests',
    'pto_members','pto_requests','pto_adjustments','linear_project_ids_shape_migration_20260728',
    'production_asset_access_checks','linear_archive_asset_refs','production_comment_card_links',
    'production_comment_mutation_receipts','track_b_team_rollbacks','track_b_team_rollback_intents',
    'track_b_f27_team_fences','linear_intake_receipts','production_card_provenance',
    'calendar_feedback_materializations','production_card_materialization_receipts',
    'production_card_materialization_ingress','production_label_catalog_versions','linear_outbound_cutoff_control','public_intake_log','legacy_intake_native_triage','native_brief_media_occurrences','production_native_client_provisions','syncview_retirement_admission','production_native_identifier_mint','production_native_identifier_grants','description_images','production_native_ordinary_receipt_admissions','production_notification_config','production_notification_intents','production_notification_delivery_receipts','production_notification_reconciliations'];
begin
  if mode not in ('backup','scratch') then raise exception 'Unsupported prerequisite mode'; end if;
  if current_setting('track_b.setup_confirmation') <> (case when mode='backup'
    then 'HISTORY_V11_BACKUP_GRANTS_ONLY' else 'DISPOSABLE_SCRATCH_ONLY' end) then
    raise exception 'Explicit prerequisite confirmation required';
  end if;
  if mode='scratch' and (coalesce(current_setting('track_b.setup_scratch_ref',true),'') !~ '^[a-z0-9]{20}$'
    or current_setting('track_b.setup_scratch_ref')='uzltbbrjidmjwwfakwve') then
    raise exception 'Independent non-production scratch ref required';
  end if;
  if mode='scratch' and to_regprocedure('public.track_b_restore_set_history_v10_user_triggers(boolean)') is not null then
    raise exception 'Existing history helper requires independent owner and ACL review before replacement';
  end if;
  select * into role_record from pg_roles where rolname=role_name;
  if not found or role_name in ('anon','authenticated','service_role','postgres')
    or role_record.rolsuper or role_record.rolcreaterole or role_record.rolcreatedb
    or role_name=current_user then raise exception 'Existing dedicated restricted role required'; end if;
  if (mode='backup' or mode='scratch') and not role_record.rolbypassrls then
    raise exception 'Complete private corpus requires an existing BYPASSRLS role';
  end if;
  foreach relation_name in array relations loop
    if to_regclass('public.' || relation_name) is null then raise exception 'History corpus relation missing'; end if;
    expected_keys := case relation_name
      when 'clients' then array['slug'] when 'client_access' then array['slug']
      when 'syncview_runtime_flags' then array['key'] when 'linear_archive' then array['linear_uuid']
      when 'calendar_posts' then array['client','id'] when 'sample_reviews' then array['client','id']
      when 'workload_plan' then array['issue_id'] when 'production_intake_manifests' then array['request_id']
      when 'pto_members' then array['member_id']
      when 'linear_project_ids_shape_migration_20260728' then array['slug']
      when 'production_asset_access_checks' then array['deliverable_id','slot','url_sha256']
      when 'linear_archive_asset_refs' then array['ref_id']
      when 'production_comment_card_links' then array['source_surface','card_id','component','native_comment_id']
      when 'production_comment_mutation_receipts' then array['dedup_key']
      when 'track_b_team_rollback_intents' then array['rollback_id','outbox_id']
      when 'track_b_f27_team_fences' then array['team']
      when 'linear_intake_receipts' then array['receipt_key']
      when 'legacy_intake_native_triage' then array['payload_hash']
      when 'production_label_catalog_versions' then array['version_id']
      when 'linear_outbound_cutoff_control' then array['lane']
      when 'production_native_client_provisions' then array['request_id']
      when 'syncview_retirement_admission' then array['singleton']
      when 'production_native_identifier_mint' then array['team']
      when 'production_native_identifier_grants' then array['identifier']
      when 'description_images' then array['id']
      when 'production_native_ordinary_receipt_admissions' then array['token']
      when 'production_notification_config' then array['key']
      when 'production_notification_intents' then array['id']
      when 'production_notification_delivery_receipts' then array['id']
      when 'production_notification_reconciliations' then array['id']
      when 'calendar_feedback_materializations' then array['attempt_key']
      else array['id'] end;
    select array_agg(a.attname::text order by k.ordinality) into actual_keys
      from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum,ordinality)
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
      where i.indrelid=to_regclass('public.' || relation_name) and i.indisprimary;
    if actual_keys is distinct from expected_keys then raise exception 'History corpus primary key mismatch'; end if;
    if relation_name = any(array['production_card_materialization_receipts','production_card_materialization_ingress','native_brief_media_occurrences'])
      and not exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.' || relation_name)
        and a.attname='id' and not a.attisdropped and format_type(a.atttypid,a.atttypmod)='uuid') then
      raise exception 'Materialization owner requires UUID id primary key';
    end if;
    if relation_name='production_label_catalog_versions' and not exists(
      select 1 from pg_attribute a where a.attrelid=to_regclass('public.' || relation_name)
        and a.attname='version_id' and not a.attisdropped and format_type(a.atttypid,a.atttypmod)='uuid') then
      raise exception 'Catalog owner requires UUID version_id primary key';
    end if;
    if relation_name='linear_outbound_cutoff_control' and not exists(
      select 1 from pg_attribute a where a.attrelid=to_regclass('public.' || relation_name)
        and a.attname='lane' and not a.attisdropped and format_type(a.atttypid,a.atttypmod)='text') then
      raise exception 'Cutoff owner requires text lane primary key';
    end if;
    if relation_name='production_native_client_provisions' and not exists(select 1 from pg_attribute where attrelid='public.production_native_client_provisions'::regclass and attname='request_id' and atttypid='text'::regtype and attidentity='') then raise exception 'Native client provision receipt requires text request_id without identity'; end if;
    if relation_name='syncview_retirement_admission' and not exists(select 1 from pg_attribute where attrelid='public.syncview_retirement_admission'::regclass and attname='singleton' and atttypid='boolean'::regtype and attidentity='') then raise exception 'Retirement admission requires Boolean singleton without identity'; end if;
    if relation_name='production_native_identifier_mint' and not exists(select 1 from pg_attribute where attrelid='public.production_native_identifier_mint'::regclass and attname='team' and atttypid='text'::regtype and attidentity='') then raise exception 'Native identifier mint requires text team without identity'; end if;
    if relation_name='production_native_identifier_grants' and not exists(select 1 from pg_attribute where attrelid='public.production_native_identifier_grants'::regclass and attname='identifier' and atttypid='text'::regtype and attidentity='') then raise exception 'Native identifier grant requires text identifier without identity'; end if;
    if relation_name='description_images' and not exists(select 1 from pg_attribute where attrelid='public.description_images'::regclass and attname='id' and atttypid='uuid'::regtype and attidentity='') then raise exception 'Description image ledger requires UUID id without identity'; end if;
    if relation_name='production_native_ordinary_receipt_admissions' and not exists(select 1 from pg_attribute where attrelid='public.production_native_ordinary_receipt_admissions'::regclass and attname='token' and atttypid='uuid'::regtype and attidentity='') then raise exception 'Ordinary native admission requires UUID token without identity'; end if;
    if relation_name='production_notification_config' and not exists(select 1 from pg_attribute where attrelid='public.production_notification_config'::regclass and attname='key' and atttypid='text'::regtype and attidentity='') then raise exception 'Notification config requires text key without identity'; end if;
    if relation_name='production_notification_intents' and not exists(select 1 from pg_attribute where attrelid='public.production_notification_intents'::regclass and attname='id' and atttypid='uuid'::regtype and attidentity='') then raise exception 'Notification intent requires UUID id without identity'; end if;
    if relation_name='production_notification_delivery_receipts' and not exists(select 1 from pg_attribute where attrelid='public.production_notification_delivery_receipts'::regclass and attname='id' and atttypid='bigint'::regtype and attidentity='a') then raise exception 'Notification delivery receipt requires generated always bigint identity'; end if;
    if relation_name='production_notification_reconciliations' and not exists(select 1 from pg_attribute where attrelid='public.production_notification_reconciliations'::regclass and attname='id' and atttypid='bigint'::regtype and attidentity='a') then raise exception 'Notification reconciliation requires generated always bigint identity'; end if;
    if relation_name='legacy_intake_native_triage' and not exists(select 1 from pg_attribute where attrelid='public.legacy_intake_native_triage'::regclass and attname='payload_hash' and atttypid='text'::regtype) then raise exception 'Triage owner requires text payload_hash'; end if;
    if relation_name='public_intake_log' and not exists(select 1 from pg_attribute where attrelid='public.public_intake_log'::regclass and attname='id' and atttypid='bigint'::regtype and attidentity='a') then raise exception 'Public intake requires generated always bigint identity'; end if;
    if relation_name=any(array['public_intake_log','legacy_intake_native_triage','native_brief_media_occurrences','production_native_client_provisions','syncview_retirement_admission','production_native_identifier_mint','production_native_identifier_grants','description_images','production_native_ordinary_receipt_admissions','production_notification_config','production_notification_intents','production_notification_delivery_receipts','production_notification_reconciliations']) then
      foreach protected_role in array array['anon','authenticated'] loop
        if has_table_privilege(protected_role,'public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'Private continuity runtime privilege exposed'; end if;
      end loop;
    end if;
    if relation_name='native_brief_media_occurrences' and has_table_privilege('service_role','public.'||relation_name,'UPDATE,DELETE,TRUNCATE') then raise exception 'Media ledger service role must remain append-only'; end if;
    if has_table_privilege(role_name,'public.' || relation_name,'UPDATE')
      or has_table_privilege(role_name,'public.' || relation_name,'DELETE')
      or (mode='backup' and (has_table_privilege(role_name,'public.' || relation_name,'INSERT')
        or has_table_privilege(role_name,'public.' || relation_name,'TRUNCATE'))) then
      raise exception 'Dedicated role has forbidden inherited or direct write privileges';
    end if;
    if relation_name = any(array['production_card_materialization_receipts','production_card_materialization_ingress','production_label_catalog_versions','linear_outbound_cutoff_control','legacy_intake_native_triage','production_native_client_provisions','syncview_retirement_admission','production_native_identifier_mint','production_native_identifier_grants','production_native_ordinary_receipt_admissions','production_notification_intents','production_notification_delivery_receipts','production_notification_reconciliations']) then
      foreach protected_role in array array['anon','authenticated','service_role'] loop
        if has_table_privilege(protected_role,'public.' || relation_name,'INSERT')
          or has_table_privilege(protected_role,'public.' || relation_name,'UPDATE')
          or has_table_privilege(protected_role,'public.' || relation_name,'DELETE')
          or has_table_privilege(protected_role,'public.' || relation_name,'TRUNCATE') then
          raise exception 'Protected runtime role has forbidden materialization history write privilege';
        end if;
      end loop;
    end if;
    if relation_name = any(array['client_access_events','syncview_auth_events','flag_flips','settings_events',
      'deliverable_events','mirror_outbox','calendar_post_events','sample_review_events','card_change_journal','production_card_provenance','public_intake_log','production_notification_delivery_receipts','production_notification_reconciliations'])
      and pg_get_serial_sequence('public.' || relation_name,'id') is null then
      raise exception 'History identity sequence missing';
    end if;
    if relation_name = any(array['production_card_materialization_receipts','production_card_materialization_ingress','production_label_catalog_versions','native_brief_media_occurrences','production_native_client_provisions','syncview_retirement_admission','production_native_identifier_mint','production_native_identifier_grants','description_images','production_native_ordinary_receipt_admissions','production_notification_config','production_notification_intents','production_notification_delivery_receipts','production_notification_reconciliations'])
      and pg_get_serial_sequence('public.' || relation_name,case relation_name
      when 'production_label_catalog_versions' then 'version_id'
      when 'production_native_client_provisions' then 'request_id'
      when 'syncview_retirement_admission' then 'singleton'
      when 'production_native_identifier_mint' then 'team'
      when 'production_native_identifier_grants' then 'identifier'
      else 'id' end) is not null then
      raise exception 'Materialization owner must not use an identity sequence';
    end if;
  end loop;
  if not exists(select 1 from pg_attribute where attrelid='public.clients'::regclass and attname='native_project_ids' and not attisdropped and atttypid='jsonb'::regtype) then
    raise exception 'Client native project mapping requires jsonb native_project_ids';
  end if;
  if not exists(select 1 from pg_attribute where attrelid='public.production_native_ordinary_receipt_admissions'::regclass and attname='receipt_id' and atttypid='bigint'::regtype)
    or not exists(select 1 from pg_attribute where attrelid='public.production_notification_config'::regclass and attname='value' and atttypid='jsonb'::regtype)
    or not exists(select 1 from pg_attribute where attrelid='public.production_notification_intents'::regclass and attname='message' and atttypid='jsonb'::regtype)
    or not exists(select 1 from pg_attribute where attrelid='public.production_notification_delivery_receipts'::regclass and attname='intent_id' and atttypid='uuid'::regtype)
    or not exists(select 1 from pg_attribute where attrelid='public.production_notification_reconciliations'::regclass and attname='intent_id' and atttypid='uuid'::regtype) then
    raise exception 'v11 ordinary or notification durable schema is incomplete';
  end if;
  -- v11 restores mirror rows before their immutable admission receipt, so the
  -- admission FK must be DEFERRABLE INITIALLY DEFERRED and COPY stays atomic.
  if not exists(select 1 from pg_constraint c where c.contype='f'
    and c.conrelid='public.production_native_ordinary_receipt_admissions'::regclass
    and c.confrelid='public.mirror_outbox'::regclass and c.condeferrable and c.condeferred) then
    raise exception 'Ordinary native admission requires deferred mirror outbox foreign key';
  end if;
  if not exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where t.tgrelid='public.mirror_outbox'::regclass and t.tgname='zzz_native_ordinary_receipt_guard'
      and t.tgenabled='O' and p.oid='public.production_native_ordinary_receipt_guard()'::regprocedure
      and p.prosecdef) then raise exception 'Ordinary native receipt guard trigger/function required'; end if;
  if not exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where t.tgrelid='public.production_notification_intents'::regclass and t.tgname='production_notification_intent_guard_before'
      and t.tgenabled='O' and p.oid='public.production_notification_intent_guard()'::regprocedure
      and p.prosecdef) then raise exception 'Notification immutable intent guard trigger/function required'; end if;
  if (select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      where ((t.tgrelid='public.deliverable_events'::regclass and t.tgname in ('production_notification_status_intent_after','production_notification_client_comment_event_after'))
          or (t.tgrelid='public.production_comments'::regclass and t.tgname='production_notification_comment_intent_after'))
        and t.tgenabled='O' and p.prosecdef) <> 3 then
    raise exception 'Notification source observer trigger/functions required';
  end if;
  foreach relation_name in array array['production_native_ordinary_receipt_admissions','production_notification_config','production_notification_intents','production_notification_delivery_receipts','production_notification_reconciliations'] loop
    if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||relation_name)) then
      raise exception 'v11 durable owner requires row level security';
    end if;
    foreach protected_role in array array['anon','authenticated'] loop
      if has_table_privilege(protected_role,'public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
        raise exception 'v11 durable owner public runtime privilege exposed';
      end if;
    end loop;
  end loop;
  if has_table_privilege('service_role','public.production_native_ordinary_receipt_admissions','INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('service_role','public.production_notification_intents','INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('service_role','public.production_notification_delivery_receipts','INSERT,UPDATE,DELETE,TRUNCATE')
    or has_table_privilege('service_role','public.production_notification_reconciliations','INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception 'v11 immutable receipt direct service write privilege exposed';
  end if;
  if not has_table_privilege('service_role','public.production_notification_config','SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Notification config service-only writer privilege required';
  end if;
  if pg_get_serial_sequence('public.production_notification_delivery_receipts','id') is null
    or pg_get_serial_sequence('public.production_notification_reconciliations','id') is null then
    raise exception 'Notification durable identity sequence missing';
  end if;
  if exists(select 1 from pg_catalog.pg_constraint c where c.contype='f' and (
    (c.confrelid in (select to_regclass('public.'||r) from unnest(relations) r)
      and c.conrelid not in (select to_regclass('public.'||r) from unnest(relations) r))
    or (c.conrelid in (select to_regclass('public.'||r) from unnest(relations) r)
      and c.confrelid not in (select to_regclass('public.'||r) from unnest(relations) r))
  )) then raise exception 'History v11 corpus foreign-key boundary is incomplete'; end if;
  -- F44 triage and the retained v6
  -- rows still carry these immutable invoker CHECK dependencies during COPY.
  if mode='scratch' then
    foreach validator in array validators loop
      if not exists(select 1 from pg_proc where oid=to_regprocedure(validator)
        and provolatile='i' and not prosecdef) then
        raise exception 'Reviewed immutable invoker receipt validator required';
      end if;
    end loop;
    if to_regprocedure('extensions.digest(bytea,text)') is null then
      raise exception 'Reviewed pgcrypto receipt dependency required';
    end if;
  end if;
  execute format('grant usage on schema public to %I',role_name);
  if mode='scratch' then
    execute format('grant usage on schema extensions to %I',role_name);
    foreach validator in array validators loop
      execute format('grant execute on function %s to %I',validator,role_name);
    end loop;
    execute format('grant execute on function extensions.digest(bytea,text) to %I',role_name);
  end if;
  foreach relation_name in array relations loop
    execute format('grant %s on table public.%I to %I',
      case when mode='backup' then 'select' else 'select, insert, truncate' end,relation_name,role_name);
    sequence_name := case when relation_name = any(array['client_access_events','syncview_auth_events','flag_flips','settings_events',
      'deliverable_events','mirror_outbox','calendar_post_events','sample_review_events','card_change_journal','production_card_provenance','public_intake_log','production_notification_delivery_receipts','production_notification_reconciliations'])
      then pg_get_serial_sequence('public.' || relation_name,'id') else null end;
    if sequence_name is not null then
      execute format('grant %s on sequence %s to %I',case when mode='backup' then 'select' else 'select, usage, update' end,sequence_name,role_name);
    end if;
  end loop;
end $prerequisites$;

\if :is_scratch
-- Distinct helper; it is called only inside the restore transaction. A COPY
-- failure rolls its trigger-state change back with the data transaction.
create or replace function public.track_b_restore_set_history_v10_user_triggers(enabled boolean)
returns void language plpgsql security definer set search_path=pg_catalog as $helper$
declare relation_name text;
relations constant text[] := array[
  'team_members','clients','client_access','client_access_events','syncview_auth_events','syncview_runtime_flags','flag_flips','settings_events',
  'batches','deliverables','production_comments','deliverable_events','mirror_outbox','linear_archive','calendar_posts','sample_reviews',
  'calendar_post_events','sample_review_events','workload_plan','card_change_journal','production_intake_manifests','pto_members','pto_requests',
  'pto_adjustments','linear_project_ids_shape_migration_20260728','production_asset_access_checks','linear_archive_asset_refs',
  'production_comment_card_links','production_comment_mutation_receipts','track_b_team_rollbacks','track_b_team_rollback_intents',
  'track_b_f27_team_fences','linear_intake_receipts','production_card_provenance','calendar_feedback_materializations',
  'production_card_materialization_receipts','production_card_materialization_ingress','production_label_catalog_versions','linear_outbound_cutoff_control','public_intake_log','legacy_intake_native_triage','native_brief_media_occurrences','production_native_client_provisions','syncview_retirement_admission','production_native_identifier_mint','production_native_identifier_grants','description_images','production_native_ordinary_receipt_admissions','production_notification_config','production_notification_intents','production_notification_delivery_receipts','production_notification_reconciliations'];
begin
  if enabled is null then raise exception 'Trigger state must be explicit'; end if;
  foreach relation_name in array relations loop
    if to_regclass('public.' || relation_name) is null then raise exception 'History corpus relation missing'; end if;
    if not enabled and exists(select 1 from pg_trigger where tgrelid=to_regclass('public.' || relation_name)
      and not tgisinternal and tgenabled<>'O') then raise exception 'Scratch user triggers must start enabled normally'; end if;
    execute format('alter table public.%I %s trigger user',relation_name,case when enabled then 'enable' else 'disable' end);
  end loop;
end $helper$;
revoke all on function public.track_b_restore_set_history_v10_user_triggers(boolean) from public;
revoke all on function public.track_b_restore_set_history_v10_user_triggers(boolean) from anon, authenticated, service_role;
grant execute on function public.track_b_restore_set_history_v10_user_triggers(boolean) to :"existing_role";
\endif
commit;

\set ON_ERROR_STOP on
\set QUIET 1
\pset format unaligned
\pset tuples_only on
\pset pager off

-- Public-safe, read-only catalog assertion for the exact B3 accelerator
-- migration. The installer runs these exact bytes twice in one session: phase
-- `pre` requires a pristine zero-index state; phase `post` requires both exact
-- indexes valid/ready/live. Project identity is bound outside SQL by the
-- reviewed session-endpoint URL plus the service-role JWT ref. This query
-- returns only counts, booleans, and catalog digests.
begin;
set transaction read only;
set local search_path = pg_catalog, public;
set local statement_timeout = '2min';
set local lock_timeout = '5s';
select set_config(
  'syncview.b3_accelerator_phase', :'b3_accelerator_phase', true
) as b3_accelerator_phase_configured \gset

do $b3_accelerator_precheck$
declare
  v_deliverables_owner oid;
  v_current_role oid;
  v_current_super boolean;
  v_auth_timeout text;
  v_phase text := current_setting('syncview.b3_accelerator_phase');
  v_named_indexes integer;
  v_exact_indexes integer;
  v_equivalent_other integer;
  v_invalid_indexes integer;
  v_ready_indexes integer;
  v_live_indexes integer;
  v_dependency_count integer;
begin
  if v_phase not in ('pre', 'post') then
    raise exception 'B3ACC_PHASE_PREREQUISITE';
  end if;
  if current_setting('search_path') <> 'pg_catalog, public' then
    raise exception 'B3ACC_SEARCH_PATH_PREREQUISITE';
  end if;
  select c.relowner
    into v_deliverables_owner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'deliverables'
    and c.relkind = 'r';
  if not found then
    raise exception 'B3ACC_TARGET_RELATION_PREREQUISITE';
  end if;

  select r.oid, r.rolsuper
    into strict v_current_role, v_current_super
  from pg_catalog.pg_roles r
  where r.rolname = current_user;
  if not v_current_super
     and v_current_role <> v_deliverables_owner
     and not pg_catalog.pg_has_role(current_user, v_deliverables_owner, 'USAGE') then
    raise exception 'B3ACC_OPERATOR_ROLE_PREREQUISITE';
  end if;
  if current_setting('server_version_num')::integer not between 160000 and 179999
     or to_regprocedure('extensions.digest(bytea,text)') is null
     or not pg_catalog.has_function_privilege(
       current_user, 'extensions.digest(bytea,text)', 'EXECUTE'
     ) then
    raise exception 'B3ACC_PLATFORM_PREREQUISITE';
  end if;

  if exists (
    with expected(signature, lang, vol, secdef, parallel_mode, config,
                  return_type, arg_types, arg_names, source_sha) as (
      values
        ('public.b3_scoped_linear_url_projection(text)', 'plpgsql', 'i', false, 's',
         array['search_path=pg_catalog']::text[], 'text', '25', '{p_value}',
         '78428edebe1cae761bdff3322a02c68e1a57cb7774240c08806f9e9aebfdc818'),
        ('public.b3_scoped_comment_count(text)', 'plpgsql', 'i', false, 's',
         array['search_path=pg_catalog']::text[], 'integer', '25', '{p_value}',
         '2b43f1aa224ec9f6a958dc6ed5735520be925dd8ee48c58de903ecbbb827487a'),
        ('public.b3_scoped_raw_is_archived(jsonb)', 'plpgsql', 'i', false, 's',
         array['search_path=pg_catalog']::text[], 'boolean', '3802', '{p_raw}',
         '9ef6e977578fc4849ad61b6a140e48cfc898100afcad59a2ee34f70d1ec69917'),
        ('public.b3_scoped_global_failure_state()', 'sql', 's', true, 'u',
         array['search_path=public']::text[], 'jsonb', '', null::text,
         '34b902aaf96f992a895973e758f5d5a5605c2f56455e0d1c1dd69b677c577406'),
        ('public.b3_scoped_cohort_population_state(jsonb,jsonb)', 'sql', 's', true, 'u',
         array['search_path=public']::text[], 'jsonb', '3802 3802',
         '{p_scope_clients,p_entries}',
         '62f851171d5561184ae9bd021096ff1f4190b42dacfb8bc88325b2f1ac3ee016'),
        ('public.b3_scoped_card_linkage_preflight()', 'plpgsql', 's', true, 'u',
         array['search_path=public']::text[], 'jsonb', '', null::text,
         '67f122c76c54ebf5ffcd57f5b9e311691473511a950433d6e21a282b6a16d12c'),
        ('public.b3_scoped_calendar_event_digest(jsonb)', 'sql', 's', true, 'u',
         array['search_path=public']::text[], 'text', '3802', '{p_entries}',
         '7a65f82ac63970c4f4938ff67f7f7e5abd268e8d4cfda4721a697a240851ef07'),
        ('public.b3_scoped_card_linkage_assert_plan(jsonb,integer,text,text,integer,text,text)',
         'plpgsql', 'v', true, 'u', array['search_path=public','lock_timeout=5s']::text[],
         'void', '3802 23 25 25 23 25 25',
         '{p_plan,p_expected_count,p_expected_scope_digest,p_expected_plan_digest,p_expected_global_failures,p_expected_global_digest,p_pointer_phase}',
         'ae26508efca4eb245d8ab8ab124f8a94eec981bbfde466305d9047f43f1c6a76'),
        ('public.b3_scoped_card_linkage_apply(jsonb,integer,text,text,integer,text)',
         'plpgsql', 'v', true, 'u', array['search_path=public']::text[], 'jsonb',
         '3802 23 25 25 23 25',
         '{p_plan,p_expected_count,p_expected_scope_digest,p_expected_plan_digest,p_expected_global_failures,p_expected_global_digest}',
         'eac52b37a163154bb73c8c9efbe563fe42d979bbd897279406b62532efabb767'),
        ('public.b3_scoped_card_linkage_rollback(jsonb,integer,text,text,integer,text,text)',
         'plpgsql', 'v', true, 'u', array['search_path=public']::text[], 'jsonb',
         '3802 23 25 25 23 25 25',
         '{p_plan,p_expected_count,p_expected_scope_digest,p_expected_plan_digest,p_expected_global_failures,p_expected_global_digest,p_expected_rollback_digest}',
         '5239fe6deec6616b845e648ec16a82ca787ed1acded1875cd9416cca3b05e6b4')
    )
    select 1
    from expected e
    left join pg_catalog.pg_proc p on p.oid = to_regprocedure(e.signature)
    left join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid is null
       or p.proowner <> v_deliverables_owner
       or l.lanname <> e.lang
       or p.provolatile <> e.vol::"char"
       or p.prosecdef is distinct from e.secdef
       or p.proparallel <> e.parallel_mode::"char"
       or p.proconfig is distinct from e.config
       or pg_catalog.format_type(p.prorettype, null) <> e.return_type
       or p.prokind <> 'f'
       or p.proisstrict
       or p.proleakproof
       or p.proretset
       or p.pronargdefaults <> 0
       or p.provariadic <> 0
       or p.proargtypes::text <> e.arg_types
       or p.proargnames::text is distinct from e.arg_names
       or p.proallargtypes is not null
       or p.proargmodes is not null
       or p.proargdefaults is not null
       or p.protrftypes is not null
       or p.procost <> 100
       or p.prorows <> 0
       or p.prosupport <> 0
       or p.probin is not null
       or p.prosqlbody is not null
       or encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
            <> e.source_sha
  ) or (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'b3\_scoped\_%' escape '\'
  ) <> 10 then
    if v_phase = 'pre' then
      raise exception 'B3ACC_SOURCE_PREREQUISITE';
    else
      raise exception 'B3ACC_SOURCE_POST_CLOSURE';
    end if;
  end if;

  if exists (
    with expected(signature, service_execute) as (
      values
        ('public.b3_scoped_linear_url_projection(text)', false),
        ('public.b3_scoped_comment_count(text)', false),
        ('public.b3_scoped_raw_is_archived(jsonb)', false),
        ('public.b3_scoped_global_failure_state()', false),
        ('public.b3_scoped_cohort_population_state(jsonb,jsonb)', false),
        ('public.b3_scoped_card_linkage_preflight()', true),
        ('public.b3_scoped_calendar_event_digest(jsonb)', false),
        ('public.b3_scoped_card_linkage_assert_plan(jsonb,integer,text,text,integer,text,text)', false),
        ('public.b3_scoped_card_linkage_apply(jsonb,integer,text,text,integer,text)', true),
        ('public.b3_scoped_card_linkage_rollback(jsonb,integer,text,text,integer,text,text)', true)
    )
    select 1
    from expected e
    left join pg_catalog.pg_proc p on p.oid = to_regprocedure(e.signature)
    where p.oid is null
       or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
            is distinct from e.service_execute
       or (
         select count(*)
         from pg_catalog.aclexplode(coalesce(
           p.proacl, pg_catalog.acldefault('f', p.proowner)
         )) direct_acl
         where direct_acl.privilege_type = 'EXECUTE'
           and direct_acl.grantee = to_regrole('service_role')
           and direct_acl.grantor = p.proowner
           and not direct_acl.is_grantable
       ) <> case when e.service_execute then 1 else 0 end
       or exists (
         select 1
         from pg_catalog.aclexplode(coalesce(
           p.proacl, pg_catalog.acldefault('f', p.proowner)
         )) acl
         where acl.privilege_type = 'EXECUTE'
           and (
             acl.grantee = 0
             or (
               acl.grantee <> p.proowner
               and not (
               e.service_execute
               and acl.grantee = to_regrole('service_role')
               and acl.grantor = p.proowner
               and not acl.is_grantable
             )
             )
           )
       )
  ) then
    if v_phase = 'pre' then
      raise exception 'B3ACC_ACL_PREREQUISITE';
    else
      raise exception 'B3ACC_ACL_POST_CLOSURE';
    end if;
  end if;

  if exists (
    with expected(trigger_name, event_name, tags, signature, source_sha) as (
      values
        ('issue_graphql_placeholder', 'sql_drop', array['DROP EXTENSION']::text[],
         'extensions.set_graphql_placeholder()',
         '19e858a99cf5698c4730343fb43cdad4ab2f0717a8ded8a691a0e2786b859708'),
        ('issue_pg_cron_access', 'ddl_command_end', array['CREATE EXTENSION']::text[],
         'extensions.grant_pg_cron_access()',
         'da790d5f185c54fb41cfc6038beacc24ce7a7387aca4249ad77a47ea22a99e33'),
        ('issue_pg_graphql_access', 'ddl_command_end', array['CREATE EXTENSION']::text[],
         'extensions.grant_pg_graphql_access()',
         'fb5a80e6d30734718db960270a5f0eac0d655e238e8128ba56803b74a052bc1e'),
        ('issue_pg_net_access', 'ddl_command_end', array['CREATE EXTENSION']::text[],
         'extensions.grant_pg_net_access()',
         '55abda380efd46b37b26d3c6e4f3b514e28b7c7c1df44f5ae0315ece4052370d'),
        ('pgrst_ddl_watch', 'ddl_command_end', array[]::text[],
         'extensions.pgrst_ddl_watch()',
         'de987df746eb39647098459e7993bd8595e592969b0cd647828a3d13d37cffe0'),
        ('pgrst_drop_watch', 'sql_drop', array[]::text[],
         'extensions.pgrst_drop_watch()',
         '791b41f0632fc86e0fc86a303ec0fd710c4e2ecf947a23422dae2b7a2c122f1d')
    )
    select 1
    from expected e
    left join pg_catalog.pg_event_trigger t on t.evtname = e.trigger_name
    left join pg_catalog.pg_proc p on p.oid = t.evtfoid
    left join pg_catalog.pg_language l on l.oid = p.prolang
    where t.oid is null
       or t.evtevent <> e.event_name
       or t.evtenabled <> 'O'
       or array(
            select tag
            from unnest(coalesce(t.evttags, array[]::text[])) tag
            order by tag collate "C"
          ) is distinct from e.tags
       or p.oid <> to_regprocedure(e.signature)
       or t.evtowner <> to_regrole('supabase_admin')
       or p.proowner <> to_regrole('supabase_admin')
       or l.lanname <> 'plpgsql'
       or p.provolatile <> 'v'
       or p.prosecdef
       or p.proparallel <> 'u'
       or p.proconfig is not null
       or p.pronargs <> 0
       or p.prorettype <> 'event_trigger'::regtype
       or p.prokind <> 'f'
       or p.proisstrict
       or p.proleakproof
       or p.proretset
       or p.pronargdefaults <> 0
       or p.provariadic <> 0
       or p.proargtypes::text <> ''
       or p.proargnames is not null
       or p.proallargtypes is not null
       or p.proargmodes is not null
       or p.proargdefaults is not null
       or p.protrftypes is not null
       or p.procost <> 100
       or p.prorows <> 0
       or p.prosupport <> 0
       or p.probin is not null
       or p.prosqlbody is not null
       or encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
            <> e.source_sha
       or p.prosrc ~* '\m(insert|update|delete|merge|truncate|copy)\M'
  ) or (
    select count(*) from pg_catalog.pg_event_trigger where evtenabled <> 'D'
  ) <> 6 then
    if v_phase = 'pre' then
      raise exception 'B3ACC_EVENT_TRIGGER_PREREQUISITE';
    else
      raise exception 'B3ACC_EVENT_TRIGGER_POST_CLOSURE';
    end if;
  end if;

  select count(*) into v_named_indexes
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'deliverables_b3_trimmed_id_lookup_idx',
      'deliverables_b3_exact_url_lookup_idx'
    );

  with idx as (
    select i.indexrelid, idx.relname, am.amname, i.indisvalid,
      i.indisready, i.indislive, i.indisunique, i.indpred,
      i.indnkeyatts, i.indnatts, idx.relowner,
      idx.reloptions, tab.relowner table_owner,
      pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) k1,
      case when i.indnkeyatts >= 2
        then pg_catalog.pg_get_indexdef(i.indexrelid, 2, true) end k2,
      case when i.indnkeyatts >= 3
        then pg_catalog.pg_get_indexdef(i.indexrelid, 3, true) end k3
    from pg_catalog.pg_index i
    join pg_catalog.pg_class idx on idx.oid = i.indexrelid
    join pg_catalog.pg_class tab on tab.oid = i.indrelid
    join pg_catalog.pg_am am on am.oid = idx.relam
    where i.indrelid = to_regclass('public.deliverables')
  ), judged as (
    select *, case
      when amname = 'btree' and indisvalid and indisready and indislive
       and not indisunique and indpred is null
       and relowner = table_owner and reloptions is null
       and relname = 'deliverables_b3_trimmed_id_lookup_idx'
       and indnkeyatts = 1 and indnatts = 1
       and k1 = 'btrim(COALESCE(id, ''''::text))' then 'id'
      when amname = 'btree' and indisvalid and indisready and indislive
       and not indisunique and indpred is null
       and relowner = table_owner and reloptions is null
       and relname = 'deliverables_b3_exact_url_lookup_idx'
       and indnkeyatts = 3 and indnatts = 3
       and k1 = 'lower(btrim(COALESCE(client_slug, ''''::text)))'
       and k2 = 'lower(btrim(COALESCE(kind, ''''::text)))'
       and k3 = 'b3_scoped_linear_url_projection(linear_issue_url)' then 'url'
      end exact_slot,
      case
      when amname = 'btree' and indpred is null
       and indnkeyatts = 1 and indnatts = 1
       and k1 = 'btrim(COALESCE(id, ''''::text))' then 'id'
      when amname = 'btree' and indpred is null
       and indnkeyatts = 3 and indnatts = 3
       and k1 = 'lower(btrim(COALESCE(client_slug, ''''::text)))'
       and k2 = 'lower(btrim(COALESCE(kind, ''''::text)))'
       and k3 = 'b3_scoped_linear_url_projection(linear_issue_url)' then 'url'
      end equivalent_slot
    from idx
  ), dependency as (
    select count(*) dependency_count
    from judged j
    join pg_catalog.pg_depend d
      on d.classid = 'pg_catalog.pg_class'::regclass
     and d.objid = j.indexrelid
     and d.objsubid = 0
    where j.exact_slot = 'url'
      and d.refclassid = 'pg_catalog.pg_proc'::regclass
      and d.refobjid = to_regprocedure(
        'public.b3_scoped_linear_url_projection(text)'
      )
      and d.refobjsubid = 0
      and d.deptype = 'n'
  )
  select
    count(*) filter (where exact_slot is not null),
    count(*) filter (
      where equivalent_slot is not null
        and relname not in (
          'deliverables_b3_trimmed_id_lookup_idx',
          'deliverables_b3_exact_url_lookup_idx'
        )
    ),
    count(*) filter (
      where relname in (
        'deliverables_b3_trimmed_id_lookup_idx',
        'deliverables_b3_exact_url_lookup_idx'
      ) and not indisvalid
    ),
    count(*) filter (
      where relname in (
        'deliverables_b3_trimmed_id_lookup_idx',
        'deliverables_b3_exact_url_lookup_idx'
      ) and indisready
    ),
    count(*) filter (
      where relname in (
        'deliverables_b3_trimmed_id_lookup_idx',
        'deliverables_b3_exact_url_lookup_idx'
      ) and indislive
    ),
    (select dependency_count from dependency)
  into v_exact_indexes, v_equivalent_other, v_invalid_indexes,
       v_ready_indexes, v_live_indexes, v_dependency_count
  from judged;

  if v_phase = 'pre' and (
    v_named_indexes <> 0
    or v_exact_indexes <> 0
    or v_equivalent_other <> 0
    or v_dependency_count <> 0
  ) then
    raise exception 'B3ACC_NON_PRISTINE_INDEX_STATE';
  elsif v_phase = 'post' and (
    v_named_indexes <> 2
    or v_exact_indexes <> 2
    or v_equivalent_other <> 0
    or v_invalid_indexes <> 0
    or v_ready_indexes <> 2
    or v_live_indexes <> 2
    or v_dependency_count <> 1
  ) then
    raise exception 'B3ACC_INDEX_POST_CLOSURE';
  end if;

  if exists (
    select 1 from pg_catalog.pg_stat_progress_create_index p
    where p.relid = to_regclass('public.deliverables')
  ) or exists (
    select 1 from pg_catalog.pg_prepared_xacts x
    where x.database = current_database()
  ) or exists (
    select 1 from pg_catalog.pg_stat_activity a
    where a.datname = current_database()
      and a.pid <> pg_backend_pid()
      and a.backend_type = 'client backend'
      and a.xact_start is not null
      and a.xact_start < clock_timestamp() - interval '60 seconds'
  ) then
    raise exception 'B3ACC_CONCURRENT_ACTIVITY_PREREQUISITE';
  end if;

  with candidates as (
    select u.config_value,
      case
        when s.setdatabase = (select oid from pg_catalog.pg_database where datname=current_database())
         and s.setrole = to_regrole('authenticator') then 4
        when s.setdatabase = 0 and s.setrole = to_regrole('authenticator') then 3
        when s.setdatabase = (select oid from pg_catalog.pg_database where datname=current_database())
         and s.setrole = 0 then 2
        else 1
      end priority
    from pg_catalog.pg_db_role_setting s
    cross join lateral unnest(s.setconfig) u(config_value)
    where s.setdatabase in (0, (select oid from pg_catalog.pg_database where datname=current_database()))
      and s.setrole in (0, to_regrole('authenticator'))
      and split_part(u.config_value, '=', 1) = 'statement_timeout'
    order by priority desc
    limit 1
  )
  select config_value into v_auth_timeout from candidates;
  if v_auth_timeout is distinct from 'statement_timeout=8s' then
    raise exception 'B3ACC_AUTH_TIMEOUT_PREREQUISITE';
  end if;

  if (
    select count(*) from public.syncview_runtime_flags f
    where f.key = 'prod_authority'
      and lower(coalesce(f.value->>'graphics', '')) = 'linear'
  ) <> 1 then
    raise exception 'B3ACC_AUTHORITY_PREREQUISITE';
  end if;

  if exists (
    select 1 from public.deliverable_events e
    where e.action in ('b3_scoped_card_linkage_apply','b3_scoped_card_linkage_rollback')
       or e.event_key like 'b3-scoped-card-linkage:%'
       or e.event_key like 'b3-scoped-card-linkage-rollback:%'
  ) then
    raise exception 'B3ACC_RECEIPT_PREREQUISITE';
  end if;
end;
$b3_accelerator_precheck$;

with function_rows as (
  select p.oid, p.proowner, p.prolang, p.provolatile, p.prosecdef,
         p.proparallel, p.proconfig, p.prorettype, p.prokind, p.proisstrict,
         p.proleakproof, p.proretset, p.pronargs, p.pronargdefaults,
         p.provariadic, p.proargtypes, p.proargnames, p.proallargtypes,
         p.proargmodes, p.proargdefaults, p.protrftypes, p.procost, p.prorows,
         p.prosupport, p.probin, p.prosqlbody, p.prosrc, p.proacl,
         p.xmin::text tuple_xmin, p.ctid::text tuple_ctid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname like 'b3\_scoped\_%' escape '\'
), function_tokens as (
  select encode(convert_to(
    oid::text || '|' || proowner::text || '|' || prolang::text || '|' ||
    provolatile::text || '|' || prosecdef::text || '|' || proparallel::text || '|' ||
    coalesce(array_to_string(proconfig, E'\x1f'), 'NULL') || '|' || prorettype::text || '|' ||
    prokind::text || '|' || proisstrict::text || '|' || proleakproof::text || '|' ||
    proretset::text || '|' || pronargs::text || '|' || pronargdefaults::text || '|' ||
    provariadic::text || '|' || proargtypes::text || '|' ||
    coalesce(proargnames::text, 'NULL') || '|' ||
    coalesce(proallargtypes::text, 'NULL') || '|' ||
    coalesce(proargmodes::text, 'NULL') || '|' ||
    coalesce(proargdefaults::text, 'NULL') || '|' ||
    coalesce(protrftypes::text, 'NULL') || '|' || procost::text || '|' ||
    prorows::text || '|' || prosupport::text || '|' || coalesce(probin, 'NULL') || '|' ||
    coalesce(prosqlbody::text, 'NULL') || '|' || tuple_xmin || '|' || tuple_ctid || '|' ||
    encode(extensions.digest(convert_to(prosrc, 'UTF8'), 'sha256'), 'hex'),
    'UTF8'), 'hex') token
  from function_rows
), acl_tokens as (
  select encode(convert_to(
    p.oid::text || '|' || a.grantor::text || '|' || a.grantee::text || '|' ||
    a.privilege_type || '|' || a.is_grantable::text,
    'UTF8'), 'hex') token
  from function_rows p
  cross join lateral pg_catalog.aclexplode(coalesce(
    p.proacl, pg_catalog.acldefault('f', p.proowner)
  )) a
), default_acl_tokens as (
  select encode(convert_to(
    d.defaclrole::text || '|' || d.defaclnamespace::text || '|' || d.defaclobjtype::text || '|' ||
    coalesce(a.grantor::text, '') || '|' || coalesce(a.grantee::text, '') || '|' ||
    coalesce(a.privilege_type, '') || '|' || coalesce(a.is_grantable::text, ''),
    'UTF8'), 'hex') token
  from pg_catalog.pg_default_acl d
  join (select distinct proowner from function_rows) o on o.proowner = d.defaclrole
  left join lateral pg_catalog.aclexplode(d.defaclacl) a on true
), trigger_tokens as (
  select encode(convert_to(
    t.evtname || '|' || t.evtevent || '|' || t.evtenabled::text || '|' ||
    coalesce(array_to_string(array(
      select tag from unnest(coalesce(t.evttags, array[]::text[])) tag
      order by tag collate "C"
    ), E'\x1f'), '') || '|' || t.evtowner::text || '|' || p.oid::text || '|' ||
    t.xmin::text || '|' || t.ctid::text || '|' || p.xmin::text || '|' || p.ctid::text || '|' ||
    p.procost::text || '|' || p.prorows::text || '|' || p.prosupport::text || '|' ||
    encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex'),
    'UTF8'), 'hex') token
  from pg_catalog.pg_event_trigger t
  join pg_catalog.pg_proc p on p.oid = t.evtfoid
  where t.evtenabled <> 'D'
), guc_tokens as (
  select encode(convert_to(
    s.setdatabase::text || '|' || s.setrole::text || '|' || u.config_value,
    'UTF8'), 'hex') token
  from pg_catalog.pg_db_role_setting s
  cross join lateral unnest(s.setconfig) u(config_value)
), named_indexes as (
  select i.indexrelid, idx.relname, am.amname, i.indisvalid,
    i.indisready, i.indislive, i.indisunique, i.indpred,
    i.indnkeyatts, i.indnatts, idx.relowner,
    idx.reloptions, tab.relowner table_owner,
    pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) k1,
    case when i.indnkeyatts >= 2
      then pg_catalog.pg_get_indexdef(i.indexrelid, 2, true) end k2,
    case when i.indnkeyatts >= 3
      then pg_catalog.pg_get_indexdef(i.indexrelid, 3, true) end k3
  from pg_catalog.pg_index i
  join pg_catalog.pg_class idx on idx.oid = i.indexrelid
  join pg_catalog.pg_class tab on tab.oid = i.indrelid
  join pg_catalog.pg_am am on am.oid = idx.relam
  where i.indrelid = to_regclass('public.deliverables')
    and idx.relname in (
      'deliverables_b3_trimmed_id_lookup_idx',
      'deliverables_b3_exact_url_lookup_idx'
    )
), exact_indexes as (
  select n.*, case
    when amname = 'btree' and indisvalid and indisready and indislive
     and not indisunique and indpred is null
     and relowner = table_owner and reloptions is null
     and relname = 'deliverables_b3_trimmed_id_lookup_idx'
     and indnkeyatts = 1 and indnatts = 1
     and k1 = 'btrim(COALESCE(id, ''''::text))' then 'id'
    when amname = 'btree' and indisvalid and indisready and indislive
     and not indisunique and indpred is null
     and relowner = table_owner and reloptions is null
     and relname = 'deliverables_b3_exact_url_lookup_idx'
     and indnkeyatts = 3 and indnatts = 3
     and k1 = 'lower(btrim(COALESCE(client_slug, ''''::text)))'
     and k2 = 'lower(btrim(COALESCE(kind, ''''::text)))'
     and k3 = 'b3_scoped_linear_url_projection(linear_issue_url)' then 'url'
    end exact_slot
  from named_indexes n
), index_dependency as (
  select count(*) dependency_count
  from exact_indexes e
  join pg_catalog.pg_depend d
    on d.classid = 'pg_catalog.pg_class'::regclass
   and d.objid = e.indexrelid
   and d.objsubid = 0
  where e.exact_slot = 'url'
    and d.refclassid = 'pg_catalog.pg_proc'::regclass
    and d.refobjid = to_regprocedure(
      'public.b3_scoped_linear_url_projection(text)'
    )
    and d.refobjsubid = 0
    and d.deptype = 'n'
), receipt_rows as (
  select e.* from public.deliverable_events e
  where e.action in ('b3_scoped_card_linkage_apply','b3_scoped_card_linkage_rollback')
     or e.event_key like 'b3-scoped-card-linkage:%'
     or e.event_key like 'b3-scoped-card-linkage-rollback:%'
), receipt_tokens as (
  select encode(extensions.digest(convert_to(to_jsonb(r)::text, 'UTF8'), 'sha256'), 'hex') token
  from receipt_rows r
)
select jsonb_build_object(
  'contract', case current_setting('syncview.b3_accelerator_phase')
    when 'pre' then 'syncview-b3-accelerator-precheck-v1'
    else 'syncview-b3-accelerator-postcheck-v1' end,
  'status', 'PASS',
  'index_state', case current_setting('syncview.b3_accelerator_phase')
    when 'pre' then 'FRESH' else 'EXACT_COMPLETE' end,
  'named_index_count', (
    select count(*) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'deliverables_b3_trimmed_id_lookup_idx',
        'deliverables_b3_exact_url_lookup_idx'
      )
  ),
  'exact_index_count', (select count(*) from exact_indexes where exact_slot is not null),
  'invalid_index_count', (select count(*) from named_indexes where not indisvalid),
  'ready_index_count', (select count(*) from named_indexes where indisready),
  'live_index_count', (select count(*) from named_indexes where indislive),
  'url_projector_dependency_count', (select dependency_count from index_dependency),
  'source_exact_count', (select count(*) from function_rows),
  'source_digest', encode(extensions.digest(convert_to(
    coalesce((select string_agg(token, E'\n' order by token collate "C") from function_tokens), ''),
    'UTF8'), 'sha256'), 'hex'),
  'acl_digest', encode(extensions.digest(convert_to(
    coalesce((select string_agg(scope || ':' || token, E'\n' order by scope collate "C", token collate "C")
      from (
        select 'function'::text scope, token from acl_tokens
        union all
        select 'default'::text scope, token from default_acl_tokens
      ) all_acl), ''),
    'UTF8'), 'sha256'), 'hex'),
  'event_trigger_exact_count', (select count(*) from trigger_tokens),
  'event_trigger_digest', encode(extensions.digest(convert_to(
    coalesce((select string_agg(token, E'\n' order by token collate "C") from trigger_tokens), ''),
    'UTF8'), 'sha256'), 'hex'),
  'active_build_count', (select count(*) from pg_catalog.pg_stat_progress_create_index p
    where p.relid = to_regclass('public.deliverables')),
  'prepared_transaction_count', (select count(*) from pg_catalog.pg_prepared_xacts x
    where x.database = current_database()),
  'long_transaction_count', (select count(*) from pg_catalog.pg_stat_activity a
    where a.datname = current_database()
      and a.pid <> pg_backend_pid()
      and a.backend_type = 'client backend'
      and a.xact_start is not null
      and a.xact_start < clock_timestamp() - interval '60 seconds'),
  'settings_digest', encode(extensions.digest(convert_to(
    coalesce((select string_agg(token, E'\n' order by token collate "C") from guc_tokens), ''),
    'UTF8'), 'sha256'), 'hex'),
  'b3_receipt_count', (select count(*) from receipt_rows),
  'b3_receipt_digest', encode(extensions.digest(convert_to(
    coalesce((select string_agg(token, E'\n' order by token collate "C") from receipt_tokens), ''),
    'UTF8'), 'sha256'), 'hex'),
  'row_write_source_contract', 'NO_APPLICATION_ROW_DML_REACHABLE',
  'search_path_pinned', current_setting('search_path') = 'pg_catalog, public',
  'transaction_read_only', current_setting('transaction_read_only') = 'on',
  'current_xact_id_assigned', pg_current_xact_id_if_assigned() is not null
) as b3_accelerator_precheck;

commit;

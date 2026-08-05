-- B3 exact-scope global-failure predicate runtime accelerators.
--
-- SOURCE ONLY / NOT INSTALLED. Installation is a separate owner-approved
-- operation. Run this file with psql autocommit enabled: both indexes use
-- CREATE INDEX CONCURRENTLY and therefore must not run inside BEGIN/COMMIT.
--
-- This delta changes no predicate, function body, RPC timeout, ACL, table row,
-- runtime flag, authority setting, or repair scope. It gives the byte-exact v2
-- global predicate indexes for its existing normalized ID and exact-URL
-- probes. The global 266-failure gate remains BLOCKED and visible.

-- The reviewed operator also requires an owner-declared window with no
-- privileged DDL, database restart, or compute resize for its full 80-minute
-- workflow ceiling. PostgreSQL cannot make CREATE INDEX CONCURRENTLY share a
-- transaction with the catalog assertions, so that operational exclusion is
-- part of this artifact's literal install contract.
set search_path = pg_catalog, public;
set lock_timeout = '5s';
set statement_timeout = '10min';

-- Fail closed unless the exact reviewed/installed v2 predicate closure is
-- present. In particular, a changed URL projector would make previously
-- stored expression-index keys stale and must be handled by a new reviewed
-- rebuild, never silently accepted here.
do $prerequisite$
declare
  v_named_indexes integer;
  v_exact_indexes integer;
  v_equivalent_other integer;
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.oid = to_regprocedure('public.b3_scoped_global_failure_state()')
      and l.lanname = 'sql'
      and p.provolatile = 's'
      and p.prosecdef
      and p.proparallel = 'u'
      and p.proconfig = array['search_path=public']::text[]
      and p.prokind = 'f'
      and not p.proisstrict
      and not p.proleakproof
      and not p.proretset
      and p.pronargdefaults = 0
      and p.provariadic = 0
      and p.proargtypes::text = ''
      and p.proargnames is null
      and p.proallargtypes is null
      and p.proargmodes is null
      and p.proargdefaults is null
      and p.protrftypes is null
      and p.procost = 100
      and p.prorows = 0
      and p.prosupport = 0
      and p.probin is null
      and p.prosqlbody is null
      and encode(extensions.digest(
        convert_to(p.prosrc, 'UTF8'), 'sha256'
      ), 'hex') =
        '34b902aaf96f992a895973e758f5d5a5605c2f56455e0d1c1dd69b677c577406'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.oid = to_regprocedure(
        'public.b3_scoped_linear_url_projection(text)'
      )
      and l.lanname = 'plpgsql'
      and p.provolatile = 'i'
      and not p.prosecdef
      and p.proparallel = 's'
      and p.proconfig = array['search_path=pg_catalog']::text[]
      and p.prokind = 'f'
      and not p.proisstrict
      and not p.proleakproof
      and not p.proretset
      and p.pronargdefaults = 0
      and p.provariadic = 0
      and p.proargtypes::text = '25'
      and p.proargnames::text = '{p_value}'
      and p.proallargtypes is null
      and p.proargmodes is null
      and p.proargdefaults is null
      and p.protrftypes is null
      and p.procost = 100
      and p.prorows = 0
      and p.prosupport = 0
      and p.probin is null
      and p.prosqlbody is null
      and encode(extensions.digest(
        convert_to(p.prosrc, 'UTF8'), 'sha256'
      ), 'hex') =
        '78428edebe1cae761bdff3322a02c68e1a57cb7774240c08806f9e9aebfdc818'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.oid = to_regprocedure('public.b3_scoped_raw_is_archived(jsonb)')
      and l.lanname = 'plpgsql'
      and p.provolatile = 'i'
      and not p.prosecdef
      and p.proparallel = 's'
      and p.proconfig = array['search_path=pg_catalog']::text[]
      and p.prokind = 'f'
      and not p.proisstrict
      and not p.proleakproof
      and not p.proretset
      and p.pronargdefaults = 0
      and p.provariadic = 0
      and p.proargtypes::text = '3802'
      and p.proargnames::text = '{p_raw}'
      and p.proallargtypes is null
      and p.proargmodes is null
      and p.proargdefaults is null
      and p.protrftypes is null
      and p.procost = 100
      and p.prorows = 0
      and p.prosupport = 0
      and p.probin is null
      and p.prosqlbody is null
      and encode(extensions.digest(
        convert_to(p.prosrc, 'UTF8'), 'sha256'
      ), 'hex') =
        '9ef6e977578fc4849ad61b6a140e48cfc898100afcad59a2ee34f70d1ec69917'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.oid = to_regprocedure(
        'public.b3_scoped_card_linkage_preflight()'
      )
      and l.lanname = 'plpgsql'
      and p.provolatile = 's'
      and p.prosecdef
      and p.proparallel = 'u'
      and p.proconfig = array['search_path=public']::text[]
      and p.prokind = 'f'
      and not p.proisstrict
      and not p.proleakproof
      and not p.proretset
      and p.pronargdefaults = 0
      and p.provariadic = 0
      and p.proargtypes::text = ''
      and p.proargnames is null
      and p.proallargtypes is null
      and p.proargmodes is null
      and p.proargdefaults is null
      and p.protrftypes is null
      and p.procost = 100
      and p.prorows = 0
      and p.prosupport = 0
      and p.probin is null
      and p.prosqlbody is null
      and encode(extensions.digest(
        convert_to(p.prosrc, 'UTF8'), 'sha256'
      ), 'hex') =
        '67f122c76c54ebf5ffcd57f5b9e311691473511a950433d6e21a282b6a16d12c'
  ) then
    raise exception 'b3_scoped_accelerator_source_prerequisite_failed';
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
    left join pg_catalog.pg_proc p
      on p.oid = to_regprocedure(e.signature)
    where p.oid is null
       or has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute')
            is distinct from e.service_execute
       or (
         select count(*)
         from aclexplode(coalesce(
           p.proacl, acldefault('f', p.proowner)
         )) direct_acl
         where direct_acl.privilege_type = 'EXECUTE'
           and direct_acl.grantee = to_regrole('service_role')
           and direct_acl.grantor = p.proowner
           and not direct_acl.is_grantable
       ) <> case when e.service_execute then 1 else 0 end
       or exists (
         select 1
         from aclexplode(coalesce(
           p.proacl, acldefault('f', p.proowner)
         )) acl
         where acl.privilege_type = 'EXECUTE'
           and (
             acl.grantee = 0 -- PUBLIC
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
    raise exception 'b3_scoped_accelerator_acl_prerequisite_failed';
  end if;

  -- CREATE INDEX is DDL, so pin every enabled event-trigger route before the
  -- first concurrent build. The exact reviewed closure contains no
  -- application-row DML token and no seventh enabled trigger.
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
       or encode(extensions.digest(
            convert_to(p.prosrc, 'UTF8'), 'sha256'
          ), 'hex') <> e.source_sha
       or p.prosrc ~* '\m(insert|update|delete|merge|truncate|copy)\M'
  ) or (
    select count(*) from pg_catalog.pg_event_trigger where evtenabled <> 'D'
  ) <> 6 then
    raise exception 'b3_scoped_accelerator_event_trigger_prerequisite_failed';
  end if;

  select count(*) into v_named_indexes
  from pg_catalog.pg_class idx
  join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
  where n.nspname = 'public'
    and idx.relname in (
      'deliverables_b3_trimmed_id_lookup_idx',
      'deliverables_b3_exact_url_lookup_idx'
    );

  select count(*) into v_exact_indexes
  from pg_catalog.pg_index i
  join pg_catalog.pg_class idx on idx.oid = i.indexrelid
  join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
  join pg_catalog.pg_am am on am.oid = idx.relam
  where n.nspname = 'public'
    and i.indrelid = to_regclass('public.deliverables')
    and am.amname = 'btree'
    and i.indisvalid
    and i.indisready
    and i.indislive
    and not i.indisunique
    and i.indpred is null
    and idx.reloptions is null
    and (
      (
        idx.relname = 'deliverables_b3_trimmed_id_lookup_idx'
        and i.indnkeyatts = 1
        and i.indnatts = 1
        and pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) =
          'btrim(COALESCE(id, ''''::text))'
      )
      or
      (
        idx.relname = 'deliverables_b3_exact_url_lookup_idx'
        and i.indnkeyatts = 3
        and i.indnatts = 3
        and pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) =
          'lower(btrim(COALESCE(client_slug, ''''::text)))'
        and pg_catalog.pg_get_indexdef(i.indexrelid, 2, true) =
          'lower(btrim(COALESCE(kind, ''''::text)))'
        and pg_catalog.pg_get_indexdef(i.indexrelid, 3, true) =
          'b3_scoped_linear_url_projection(linear_issue_url)'
      )
    );

  select count(*) into v_equivalent_other
  from pg_catalog.pg_index i
  join pg_catalog.pg_class idx on idx.oid = i.indexrelid
  join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
  join pg_catalog.pg_am am on am.oid = idx.relam
  where n.nspname = 'public'
    and i.indrelid = to_regclass('public.deliverables')
    and idx.relname not in (
      'deliverables_b3_trimmed_id_lookup_idx',
      'deliverables_b3_exact_url_lookup_idx'
    )
    and am.amname = 'btree'
    and i.indpred is null
    and (
      (
        i.indnkeyatts = 1
        and i.indnatts = 1
        and pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) =
          'btrim(COALESCE(id, ''''::text))'
      )
      or
      (
        i.indnkeyatts = 3
        and i.indnatts = 3
        and pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) =
          'lower(btrim(COALESCE(client_slug, ''''::text)))'
        and pg_catalog.pg_get_indexdef(i.indexrelid, 2, true) =
          'lower(btrim(COALESCE(kind, ''''::text)))'
        and pg_catalog.pg_get_indexdef(i.indexrelid, 3, true) =
          'b3_scoped_linear_url_projection(linear_issue_url)'
      )
    );

  -- This artifact is one-shot from a pristine state. Any exact, partial,
  -- invalid, equivalent, or differently defined remnant requires owner review;
  -- it is never resumed or skipped by the migration itself.
  if v_named_indexes <> 0
     or v_exact_indexes <> 0
     or v_equivalent_other <> 0 then
    raise exception 'b3_scoped_accelerator_index_prerequisite_failed';
  end if;
end;
$prerequisite$;

create index concurrently deliverables_b3_trimmed_id_lookup_idx
  on public.deliverables ((pg_catalog.btrim(coalesce(id, ''))));

create index concurrently deliverables_b3_exact_url_lookup_idx
  on public.deliverables (
    (pg_catalog.lower(pg_catalog.btrim(coalesce(client_slug, '')))),
    (pg_catalog.lower(pg_catalog.btrim(coalesce(kind, '')))),
    (public.b3_scoped_linear_url_projection(linear_issue_url))
  );

-- Refresh only planner statistics. This performs no application-row DML.
analyze public.deliverables;

do $closure$
declare
  v_exact_indexes integer;
  v_equivalent_other integer;
begin
  select count(*) into v_exact_indexes
  from pg_catalog.pg_index i
  join pg_catalog.pg_class idx on idx.oid = i.indexrelid
  join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
  join pg_catalog.pg_am am on am.oid = idx.relam
  where n.nspname = 'public'
    and i.indrelid = to_regclass('public.deliverables')
    and am.amname = 'btree'
    and i.indisvalid
    and i.indisready
    and i.indislive
    and not i.indisunique
    and i.indpred is null
    and idx.reloptions is null
    and (
      (
        idx.relname = 'deliverables_b3_trimmed_id_lookup_idx'
        and i.indnkeyatts = 1
        and i.indnatts = 1
        and pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) =
          'btrim(COALESCE(id, ''''::text))'
      )
      or
      (
        idx.relname = 'deliverables_b3_exact_url_lookup_idx'
        and i.indnkeyatts = 3
        and i.indnatts = 3
        and pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) =
          'lower(btrim(COALESCE(client_slug, ''''::text)))'
        and pg_catalog.pg_get_indexdef(i.indexrelid, 2, true) =
          'lower(btrim(COALESCE(kind, ''''::text)))'
        and pg_catalog.pg_get_indexdef(i.indexrelid, 3, true) =
          'b3_scoped_linear_url_projection(linear_issue_url)'
      )
    );

  select count(*) into v_equivalent_other
  from pg_catalog.pg_index i
  join pg_catalog.pg_class idx on idx.oid = i.indexrelid
  join pg_catalog.pg_namespace n on n.oid = idx.relnamespace
  join pg_catalog.pg_am am on am.oid = idx.relam
  where n.nspname = 'public'
    and i.indrelid = to_regclass('public.deliverables')
    and idx.relname not in (
      'deliverables_b3_trimmed_id_lookup_idx',
      'deliverables_b3_exact_url_lookup_idx'
    )
    and am.amname = 'btree'
    and i.indpred is null
    and (
      (
        i.indnkeyatts = 1
        and i.indnatts = 1
        and pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) =
          'btrim(COALESCE(id, ''''::text))'
      )
      or
      (
        i.indnkeyatts = 3
        and i.indnatts = 3
        and pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) =
          'lower(btrim(COALESCE(client_slug, ''''::text)))'
        and pg_catalog.pg_get_indexdef(i.indexrelid, 2, true) =
          'lower(btrim(COALESCE(kind, ''''::text)))'
        and pg_catalog.pg_get_indexdef(i.indexrelid, 3, true) =
          'b3_scoped_linear_url_projection(linear_issue_url)'
      )
    );

  if v_exact_indexes <> 2 or v_equivalent_other <> 0 then
    raise exception 'b3_scoped_accelerator_closure_failed';
  end if;

  -- The two concurrent builds are separate autocommit statements. Re-pin the
  -- complete reviewed source/metadata bundle afterward so a definition drift
  -- during that interval cannot be reported as a successful installation.
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.oid = to_regprocedure('public.b3_scoped_global_failure_state()')
      and l.lanname = 'sql'
      and p.provolatile = 's'
      and p.prosecdef
      and p.proparallel = 'u'
      and p.proconfig = array['search_path=public']::text[]
      and p.prokind = 'f'
      and not p.proisstrict
      and not p.proleakproof
      and not p.proretset
      and p.pronargdefaults = 0
      and p.provariadic = 0
      and p.proargtypes::text = ''
      and p.proargnames is null
      and p.proallargtypes is null
      and p.proargmodes is null
      and p.proargdefaults is null
      and p.protrftypes is null
      and p.procost = 100
      and p.prorows = 0
      and p.prosupport = 0
      and p.probin is null
      and p.prosqlbody is null
      and encode(extensions.digest(
        convert_to(p.prosrc, 'UTF8'), 'sha256'
      ), 'hex') =
        '34b902aaf96f992a895973e758f5d5a5605c2f56455e0d1c1dd69b677c577406'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.oid = to_regprocedure(
        'public.b3_scoped_linear_url_projection(text)'
      )
      and l.lanname = 'plpgsql'
      and p.provolatile = 'i'
      and not p.prosecdef
      and p.proparallel = 's'
      and p.proconfig = array['search_path=pg_catalog']::text[]
      and p.prokind = 'f'
      and not p.proisstrict
      and not p.proleakproof
      and not p.proretset
      and p.pronargdefaults = 0
      and p.provariadic = 0
      and p.proargtypes::text = '25'
      and p.proargnames::text = '{p_value}'
      and p.proallargtypes is null
      and p.proargmodes is null
      and p.proargdefaults is null
      and p.protrftypes is null
      and p.procost = 100
      and p.prorows = 0
      and p.prosupport = 0
      and p.probin is null
      and p.prosqlbody is null
      and encode(extensions.digest(
        convert_to(p.prosrc, 'UTF8'), 'sha256'
      ), 'hex') =
        '78428edebe1cae761bdff3322a02c68e1a57cb7774240c08806f9e9aebfdc818'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.oid = to_regprocedure('public.b3_scoped_raw_is_archived(jsonb)')
      and l.lanname = 'plpgsql'
      and p.provolatile = 'i'
      and not p.prosecdef
      and p.proparallel = 's'
      and p.proconfig = array['search_path=pg_catalog']::text[]
      and p.prokind = 'f'
      and not p.proisstrict
      and not p.proleakproof
      and not p.proretset
      and p.pronargdefaults = 0
      and p.provariadic = 0
      and p.proargtypes::text = '3802'
      and p.proargnames::text = '{p_raw}'
      and p.proallargtypes is null
      and p.proargmodes is null
      and p.proargdefaults is null
      and p.protrftypes is null
      and p.procost = 100
      and p.prorows = 0
      and p.prosupport = 0
      and p.probin is null
      and p.prosqlbody is null
      and encode(extensions.digest(
        convert_to(p.prosrc, 'UTF8'), 'sha256'
      ), 'hex') =
        '9ef6e977578fc4849ad61b6a140e48cfc898100afcad59a2ee34f70d1ec69917'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.oid = to_regprocedure(
        'public.b3_scoped_card_linkage_preflight()'
      )
      and l.lanname = 'plpgsql'
      and p.provolatile = 's'
      and p.prosecdef
      and p.proparallel = 'u'
      and p.proconfig = array['search_path=public']::text[]
      and p.prokind = 'f'
      and not p.proisstrict
      and not p.proleakproof
      and not p.proretset
      and p.pronargdefaults = 0
      and p.provariadic = 0
      and p.proargtypes::text = ''
      and p.proargnames is null
      and p.proallargtypes is null
      and p.proargmodes is null
      and p.proargdefaults is null
      and p.protrftypes is null
      and p.procost = 100
      and p.prorows = 0
      and p.prosupport = 0
      and p.probin is null
      and p.prosqlbody is null
      and encode(extensions.digest(
        convert_to(p.prosrc, 'UTF8'), 'sha256'
      ), 'hex') =
        '67f122c76c54ebf5ffcd57f5b9e311691473511a950433d6e21a282b6a16d12c'
  ) then
    raise exception 'b3_scoped_accelerator_source_closure_failed';
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
    left join pg_catalog.pg_proc p
      on p.oid = to_regprocedure(e.signature)
    where p.oid is null
       or has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute')
            is distinct from e.service_execute
       or (
         select count(*)
         from aclexplode(coalesce(
           p.proacl, acldefault('f', p.proowner)
         )) direct_acl
         where direct_acl.privilege_type = 'EXECUTE'
           and direct_acl.grantee = to_regrole('service_role')
           and direct_acl.grantor = p.proowner
           and not direct_acl.is_grantable
       ) <> case when e.service_execute then 1 else 0 end
       or exists (
         select 1
         from aclexplode(coalesce(
           p.proacl, acldefault('f', p.proowner)
         )) acl
         where acl.privilege_type = 'EXECUTE'
           and (
             acl.grantee = 0 -- PUBLIC
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
    raise exception 'b3_scoped_accelerator_acl_closure_failed';
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
       or encode(extensions.digest(
            convert_to(p.prosrc, 'UTF8'), 'sha256'
          ), 'hex') <> e.source_sha
       or p.prosrc ~* '\m(insert|update|delete|merge|truncate|copy)\M'
  ) or (
    select count(*) from pg_catalog.pg_event_trigger where evtenabled <> 'D'
  ) <> 6 then
    raise exception 'b3_scoped_accelerator_event_trigger_closure_failed';
  end if;
end;
$closure$;

-- OWNER-ONLY ROLLBACK (run separately with psql autocommit enabled). This
-- restores the exact pre-delta schema; it does not alter the predicate or any
-- application row. Gate 3/4 must remain stopped until both indexes are rebuilt.
-- set lock_timeout = '5s';
-- set statement_timeout = '10min';
-- drop index concurrently if exists public.deliverables_b3_exact_url_lookup_idx;
-- drop index concurrently if exists public.deliverables_b3_trimmed_id_lookup_idx;
-- analyze public.deliverables;

-- F27: guarded, per-team Track-B rollback accounting.
--
-- This is additive source only. Applying it does not flip a flag, change
-- authority, deploy an Edge Function, or touch n8n. The final authority
-- reversal remains owner-executed and is refused unless the affected team is
-- held, every captured intent is classified, approved replays are terminal,
-- and the team's active outbox count is exactly zero.

begin;

-- F27_PREINSTALL_EXACT_SUBSET_GATE_BEGIN
--
-- The owner-approved entry state is one of two exact boundaries: (a) the
-- two-object F27 write-authorization subset applied on 2026-07-28 plus the
-- pre-existing 2026-07-12 gateways, or (b) the exact additive state retained
-- by Section 7 after rollback. Refuse before the first persistent mutation if
-- either reviewed boundary, the dormant later-window flags, the preserved
-- generation/audit chain, or any other F27/outbox catalog boundary has drifted.
--
-- These locks are transaction-scoped and make no persistent change.  They
-- prevent queue, flag, fence, and audit-ledger changes between this predicate
-- and the DDL below.  The advisory lock serializes cooperating F27 operators.
set local lock_timeout = '10s';
set local search_path = pg_catalog;

do $f27_preinstall_gate$
declare
  -- F27_RETAINED_DIAGNOSTIC_CONTEXT_DECLARE_BEGIN
  v_fence_oid oid;
  v_fence_rowtype oid;
  v_mirror_enqueue_oid oid;
  v_write_authorization_oid oid;
  v_production_authority_oid oid;
  v_rollbacks_oid oid;
  v_intents_oid oid;
  v_entry_state text;
  v_hold_guard_acl_variant text;
  v_object_pattern constant text :=
    'f27|track_b_team_rollback|production_assert_authority|authority_generation';
  -- Existing pre-F27 writer RPCs legitimately retain calls to the live
  -- production_assert_authority gateway. Its one reviewed identity is allowed
  -- below, but other names/overloads and unrelated F27 body references fail.
  v_function_body_pattern constant text :=
    'track_b_f27_|track_b_team_rollback|authority_generation|f27_drill_rollback_id|_f27_';
  -- F27_RETAINED_DIAGNOSTIC_CONTEXT_DECLARE_END
begin
  -- F27_RETAINED_DIAGNOSTIC_CONTEXT_SETUP_BEGIN
  select c.oid, c.reltype
    into v_fence_oid, v_fence_rowtype
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'track_b_f27_team_fences'
    and c.relkind = 'r';

  v_write_authorization_oid :=
    to_regprocedure('public.track_b_f27_write_authorization(text)');
  v_mirror_enqueue_oid := to_regprocedure(
    'public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)'
  );
  v_production_authority_oid := to_regprocedure(
    'public.production_assert_authority(text,text,boolean,boolean)'
  );
  v_rollbacks_oid := to_regclass('public.track_b_team_rollbacks');
  v_intents_oid := to_regclass('public.track_b_team_rollback_intents');
  -- F27_RETAINED_DIAGNOSTIC_CONTEXT_SETUP_END

  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN required_boundary_objects
  if v_fence_oid is null
     or v_write_authorization_oid is null
     or v_production_authority_oid is null
     or not exists (
       select 1
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'mirror_outbox'
         and c.relkind = 'r'
     )
     or not exists (
       select 1
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'syncview_runtime_flags'
         and c.relkind = 'r'
     )
     or not exists (
       select 1
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'flag_flips'
         and c.relkind = 'r'
     )
     or v_mirror_enqueue_oid is null then
    raise exception 'F27_PREINSTALL_GATE_REQUIRED_BOUNDARY_MISSING';
  end if;
  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END required_boundary_objects

  -- There are exactly two reviewed entry states.  The pristine state has no
  -- rollback ledgers.  The post-section-7 state has both retained ledgers and
  -- is validated in full below.  A partial/mixed state is never adopted.
  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN closed_entry_state_union
  if (v_rollbacks_oid is null) is distinct from (v_intents_oid is null) then
    raise exception 'F27_PREINSTALL_GATE_UNEXPECTED_F27_OBJECT';
  end if;
  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END closed_entry_state_union
  -- F27_RETAINED_DIAGNOSTIC_CONTEXT_ENTRY_STATE_BEGIN
  v_entry_state := case
    when v_rollbacks_oid is null then 'pristine'
    else 'retained_post_rollback'
  end;
  -- F27_RETAINED_DIAGNOSTIC_CONTEXT_ENTRY_STATE_END

  perform pg_advisory_xact_lock(
    hashtextextended('syncview:f27-install', 0)
  );
  lock table public.mirror_outbox in access exclusive mode;
  lock table public.syncview_runtime_flags in share mode;
  lock table public.flag_flips in share mode;
  lock table public.track_b_f27_team_fences in share mode;
  if v_entry_state = 'retained_post_rollback' then
    execute 'lock table public.track_b_team_rollbacks in share mode';
    execute 'lock table public.track_b_team_rollback_intents in share mode';
  end if;

  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN runtime_flags
  if (select count(*)
      from public.syncview_runtime_flags
      where key in (
        'prod_authority',
        'linear_outbound_enabled',
        'linear_legacy_parity_enabled'
      )) <> 3
     or (select value
         from public.syncview_runtime_flags
         where key = 'prod_authority')
        is distinct from '{"video":"linear","graphics":"linear"}'::jsonb
     or (select value
         from public.syncview_runtime_flags
         where key = 'linear_outbound_enabled')
        is distinct from '{"mode":"off"}'::jsonb
     or (select value
         from public.syncview_runtime_flags
         where key = 'linear_legacy_parity_enabled')
        is distinct from '{"enabled":false}'::jsonb then
    raise exception 'F27_PREINSTALL_GATE_RUNTIME_FLAGS_REQUIRED';
  end if;
  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END runtime_flags

  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN fence_contract
  if exists (
       select 1
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_am am on am.oid = c.relam
       where c.oid = v_fence_oid
         and (
           n.nspname is distinct from 'public'
           or c.relname is distinct from 'track_b_f27_team_fences'
           or c.relkind is distinct from 'r'
           or c.relpersistence is distinct from 'p'
           or am.amname is distinct from 'heap'
           or pg_get_userbyid(c.relowner) is distinct from 'postgres'
           or c.relrowsecurity is distinct from false
           or c.relforcerowsecurity is distinct from false
           or c.relreplident is distinct from 'd'
           or c.relispartition is distinct from false
           or c.relpartbound is not null
           or c.relhasrules is distinct from false
           or c.relhastriggers is distinct from false
           or c.relhassubclass is distinct from false
           or c.relchecks is distinct from 2
           or c.relnatts is distinct from 4
           or c.reltablespace is distinct from 0::oid
           or c.reloptions is not null
            or (
              select count(*)
              from aclexplode(
                coalesce(c.relacl, acldefault('r', c.relowner))
              ) granted
              where granted.grantee is distinct from c.relowner
            ) is distinct from 1
            or exists (
              select 1
              from aclexplode(
                coalesce(c.relacl, acldefault('r', c.relowner))
              ) granted
              where granted.grantee is distinct from c.relowner
                and (
                  granted.grantee is distinct from (
                    select oid from pg_roles where rolname = 'service_role'
                  )
                  or granted.grantor is distinct from c.relowner
                  or granted.privilege_type is distinct from 'SELECT'
                  or granted.is_grantable
                )
            )
            or (
              select count(*)
              from pg_roles
              where rolname in ('anon', 'authenticated', 'service_role')
            ) is distinct from 3
            or exists (
              select 1
              from pg_roles checked_role
              cross join lateral (
                select distinct granted.privilege_type
                from aclexplode(acldefault('r', c.relowner)) granted
                where granted.grantee = c.relowner
              ) supported_privilege
              where checked_role.rolname in (
                'anon',
                'authenticated',
                'service_role'
              )
                and has_table_privilege(
                  checked_role.oid,
                  c.oid,
                  supported_privilege.privilege_type
                )
                and (
                  checked_role.rolname in ('anon', 'authenticated')
                  or supported_privilege.privilege_type is distinct from 'SELECT'
                )
            )
            or not has_table_privilege(
              (select oid from pg_roles where rolname = 'service_role'),
              c.oid,
              'SELECT'
            )
            or has_table_privilege(
              (select oid from pg_roles where rolname = 'service_role'),
              c.oid,
              'SELECT WITH GRANT OPTION'
            )
         )
     )
     or (
       select count(*)
       from pg_attribute
       where attrelid = v_fence_oid
         and attnum > 0
         and not attisdropped
     ) <> 4
     or exists (
       select 1
       from pg_attribute a
       left join pg_attrdef d
         on d.adrelid = a.attrelid
        and d.adnum = a.attnum
       where a.attrelid = v_fence_oid
         and a.attnum > 0
         and (
           a.attisdropped
           or a.attidentity is distinct from ''
           or a.attgenerated is distinct from ''
           or a.attacl is not null
           or a.attinhcount is distinct from 0
           or a.attislocal is distinct from true
           or a.atthasmissing is distinct from false
           or a.attcompression is distinct from ''::"char"
           or a.attoptions is not null
           or a.attfdwoptions is not null
           or not (
             a.attname = 'team'
               and a.attnum = 1
               and a.atttypid = 'text'::regtype
               and a.atttypmod = -1
               and a.attnotnull
               and not a.atthasdef
               and d.oid is null
               and a.attcollation = 'pg_catalog.default'::regcollation
               and a.attstorage = 'x'
             or a.attname = 'generation'
               and a.attnum = 2
               and a.atttypid = 'bigint'::regtype
               and a.atttypmod = -1
               and a.attnotnull
               and a.atthasdef
               and a.attcollation = 0
               and a.attstorage = 'p'
               and replace(
                 regexp_replace(
                   lower(coalesce(pg_get_expr(d.adbin, d.adrelid, true), '')),
                   '[[:space:]()]',
                   '',
                   'g'
                 ),
                 '::bigint',
                 ''
               ) = '0'
             or a.attname = 'updated_at'
               and a.attnum = 3
               and a.atttypid = 'timestamp with time zone'::regtype
               and a.atttypmod = -1
               and a.attnotnull
               and a.atthasdef
               and a.attcollation = 0
               and a.attstorage = 'p'
               and regexp_replace(
                 lower(coalesce(pg_get_expr(d.adbin, d.adrelid, true), '')),
                 '[[:space:]()]',
                 '',
                 'g'
               ) = 'now'
             or a.attname = 'updated_by'
               and a.attnum = 4
               and a.atttypid = 'text'::regtype
               and a.atttypmod = -1
               and a.attnotnull
               and not a.atthasdef
               and d.oid is null
               and a.attcollation = 'pg_catalog.default'::regcollation
               and a.attstorage = 'x'
           )
         )
     )
     or (
       select count(*)
       from pg_constraint
       where conrelid = v_fence_oid
     ) <> 3
     or exists (
       select 1
       from pg_constraint c
       where c.conrelid = v_fence_oid
         and (
           c.connamespace is distinct from 'public'::regnamespace
           or not c.convalidated
           or c.condeferrable
           or c.condeferred
           or not c.conislocal
           or c.coninhcount <> 0
           or c.conparentid <> 0
           or not (
             c.conname = 'track_b_f27_team_fences_pkey'
               and c.contype = 'p'
               and c.connoinherit
               and c.conkey is not distinct from array[(
                 select attnum
                 from pg_attribute
                 where attrelid = v_fence_oid
                   and attname = 'team'
                   and not attisdropped
               )]::smallint[]
             or c.conname = 'track_b_f27_team_fences_team_check'
               and c.contype = 'c'
               and not c.connoinherit
               and regexp_replace(
                 lower(pg_get_expr(c.conbin, c.conrelid, true)),
                 '[[:space:]()]',
                 '',
                 'g'
               ) = 'team=anyarray[''video''::text,''graphics''::text]'
             or c.conname = 'track_b_f27_team_fences_generation_check'
               and c.contype = 'c'
               and not c.connoinherit
               and regexp_replace(
                 lower(pg_get_expr(c.conbin, c.conrelid, true)),
                 '[[:space:]()]',
                 '',
                 'g'
               ) = 'generation>=0'
           )
         )
     )
     or (
       select count(*)
       from pg_index
       where indrelid = v_fence_oid
     ) <> 1
     or exists (
       select 1
       from pg_index i
       join pg_class ci on ci.oid = i.indexrelid
       join pg_namespace ni on ni.oid = ci.relnamespace
       join pg_am am on am.oid = ci.relam
       where i.indrelid = v_fence_oid
         and (
           ni.nspname is distinct from 'public'
           or ci.relname is distinct from 'track_b_f27_team_fences_pkey'
           or ci.relkind is distinct from 'i'
           or ci.relpersistence is distinct from 'p'
           or pg_get_userbyid(ci.relowner) is distinct from 'postgres'
           or ci.reltablespace is distinct from 0::oid
           or ci.reloptions is not null
           or ci.relacl is not null
           or am.amname is distinct from 'btree'
           or not i.indisunique
           or i.indnullsnotdistinct
           or not i.indisprimary
           or i.indisexclusion
           or not i.indimmediate
           or i.indisclustered
           or not i.indisvalid
           or not i.indisready
           or not i.indislive
           or i.indisreplident
           or i.indcheckxmin
           or i.indnkeyatts <> 1
           or i.indnatts <> 1
           or i.indpred is not null
           or i.indexprs is not null
           or i.indkey::text is distinct from (
             select attnum::text
             from pg_attribute
             where attrelid = v_fence_oid
               and attname = 'team'
               and not attisdropped
           )
           or i.indclass::text is distinct from (
             select opc.oid::text
             from pg_opclass opc
             join pg_namespace no on no.oid = opc.opcnamespace
             join pg_am oa on oa.oid = opc.opcmethod
             where no.nspname = 'pg_catalog'
               and oa.amname = 'btree'
               and opc.opcname = 'text_ops'
           )
           or i.indcollation::text is distinct from (
             select attcollation::text
             from pg_attribute
             where attrelid = v_fence_oid
               and attname = 'team'
               and not attisdropped
           )
           or i.indoption::text is distinct from '0'
         )
     )
     or exists (
       select 1
       from pg_trigger
       where tgrelid = v_fence_oid
         and not tgisinternal
     )
     or exists (
       select 1
       from pg_policy
       where polrelid = v_fence_oid
     )
     or exists (
       select 1
       from pg_rewrite
       where ev_class = v_fence_oid
     )
     or exists (
       select 1
       from pg_inherits
       where inhrelid = v_fence_oid
          or inhparent = v_fence_oid
     )
     or (
       select count(*)
       from public.track_b_f27_team_fences
     ) <> 2
     or exists (
       select 1
        from public.track_b_f27_team_fences
        where team not in ('video', 'graphics')
           or generation < 0
           or (
             v_entry_state = 'pristine'
             and (
               generation is distinct from 0
               or updated_by is distinct from 'f27-migration'
             )
           )
     )
     or not exists (
       select 1
       from public.track_b_f27_team_fences
       where team = 'video'
     )
     or not exists (
       select 1
       from public.track_b_f27_team_fences
       where team = 'graphics'
  ) then
    raise exception 'F27_PREINSTALL_GATE_FENCE_SUBSET_DRIFT';
  end if;
  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END fence_contract

  if v_entry_state = 'retained_post_rollback' then
    -- Section 7 deliberately retains the additive ledgers, columns, checks,
    -- index, disabled guard trigger, and exact F27 function closure.  Reinstall
    -- adopts that boundary only when every retained object is byte-logically
    -- equivalent to this reviewed migration.  This block is read-only and is
    -- evaluated while the queue and both audit ledgers are locked.
    -- Production 2026-08-01 cross-check (public-safe receipts): restored
    -- boundary sha256 c4fa6e8e34feb187980a616a076d2aa1f5b7580a4c76204d2661ba3e208296d9;
    -- section-7 transcript sha256 e884b7d369389388ed5e55c376f3518f4fdc4379e64c683596adf4cb9ab2772c.
    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN retained_table_boundaries
    if (select count(*) from pg_roles
        where rolname in ('anon', 'authenticated', 'service_role')) <> 3
       or exists (
         select 1
         from (values
           (v_rollbacks_oid, 15, 4),
           (v_intents_oid, 10, 1)
         ) expected(relation_oid, expected_columns, expected_checks)
         left join pg_class c on c.oid = expected.relation_oid
         left join pg_namespace n on n.oid = c.relnamespace
         left join pg_am am on am.oid = c.relam
         where c.oid is null
            or n.nspname is distinct from 'public'
            or c.relkind is distinct from 'r'
            or c.relpersistence is distinct from 'p'
            or am.amname is distinct from 'heap'
            or pg_get_userbyid(c.relowner) is distinct from 'postgres'
            or c.relrowsecurity
            or c.relforcerowsecurity
            or c.relreplident is distinct from 'd'
            or c.relispartition
            or c.relpartbound is not null
            or c.relhasrules
            or c.relhassubclass
            or c.relchecks is distinct from expected.expected_checks
            or c.relnatts is distinct from expected.expected_columns
            or c.reltablespace is distinct from 0::oid
            or c.reloptions is not null
            or exists (
              (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
               from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
               where a.grantee = c.relowner)
              except
              (select d.grantor, d.grantee, d.privilege_type, d.is_grantable
               from aclexplode(acldefault('r', c.relowner)) d
               where d.grantee = c.relowner)
            )
            or exists (
              (select d.grantor, d.grantee, d.privilege_type, d.is_grantable
               from aclexplode(acldefault('r', c.relowner)) d
               where d.grantee = c.relowner)
              except
              (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
               from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
               where a.grantee = c.relowner)
            )
            or (select count(*)
                from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                where a.grantee is distinct from c.relowner) <> 1
            or exists (
              select 1
              from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
              where a.grantee is distinct from c.relowner
                and (
                  a.grantee is distinct from to_regrole('service_role')
                  or a.grantor is distinct from c.relowner
                  or a.privilege_type is distinct from 'SELECT'
                  or a.is_grantable
                )
            )
            or exists (
              select 1 from pg_attribute a
              where a.attrelid = c.oid and a.attnum > 0 and a.attacl is not null
            )
            or exists (
              select 1 from pg_trigger t
              where t.tgrelid = c.oid and not t.tgisinternal
            )
            or exists (select 1 from pg_policy p where p.polrelid = c.oid)
            or exists (select 1 from pg_rewrite r where r.ev_class = c.oid)
            or exists (
              select 1 from pg_inherits i
              where i.inhrelid = c.oid or i.inhparent = c.oid
            )
       ) then
      raise exception 'F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT';
    end if;
    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END retained_table_boundaries

    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN retained_columns
    if exists (
      with expected(relation_oid, attnum, attname, type_name, not_null, default_text) as (
        values
          (v_rollbacks_oid, 1, 'id', 'uuid', true, 'gen_random_uuid'),
          (v_rollbacks_oid, 2, 'correlation_id', 'uuid', true, 'gen_random_uuid'),
          (v_rollbacks_oid, 3, 'team', 'text', true, null::text),
          (v_rollbacks_oid, 4, 'is_drill', 'boolean', true, 'false'),
          (v_rollbacks_oid, 5, 'state', 'text', true, '''open''::text'),
          (v_rollbacks_oid, 6, 'expected_authority', 'jsonb', true, null::text),
          (v_rollbacks_oid, 7, 'prior_outbound', 'jsonb', true, null::text),
          (v_rollbacks_oid, 8, 'prior_parity', 'jsonb', true, null::text),
          (v_rollbacks_oid, 9, 'fence_generation', 'bigint', false, null::text),
          (v_rollbacks_oid, 10, 'snapshot_count', 'integer', true, '0'),
          (v_rollbacks_oid, 11, 'snapshot_sha256', 'text', false, null::text),
          (v_rollbacks_oid, 12, 'terminal_receipt', 'jsonb', false, null::text),
          (v_rollbacks_oid, 13, 'actor', 'text', true, null::text),
          (v_rollbacks_oid, 14, 'opened_at', 'timestamp with time zone', true, 'now'),
          (v_rollbacks_oid, 15, 'completed_at', 'timestamp with time zone', false, null::text),
          (v_intents_oid, 1, 'rollback_id', 'uuid', true, null::text),
          (v_intents_oid, 2, 'outbox_id', 'bigint', true, null::text),
          (v_intents_oid, 3, 'row_snapshot', 'jsonb', true, null::text),
          (v_intents_oid, 4, 'row_sha256', 'text', true, null::text),
          (v_intents_oid, 5, 'classification', 'text', false, null::text),
          (v_intents_oid, 6, 'classification_history', 'jsonb', true, '''[]''::jsonb'),
          (v_intents_oid, 7, 'reason', 'text', false, null::text),
          (v_intents_oid, 8, 'classified_by', 'text', false, null::text),
          (v_intents_oid, 9, 'classified_at', 'timestamp with time zone', false, null::text),
          (v_intents_oid, 10, 'terminal_receipt', 'jsonb', false, null::text)
      )
      select 1
      from expected e
      left join pg_attribute a
        on a.attrelid = e.relation_oid and a.attnum = e.attnum
      left join pg_attrdef d
        on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid is null
         or a.attisdropped
         or a.attname is distinct from e.attname
         or format_type(a.atttypid, a.atttypmod) is distinct from e.type_name
         or a.attnotnull is distinct from e.not_null
         or a.attidentity is distinct from ''
         or a.attgenerated is distinct from ''
         or a.attacl is not null
         or a.attinhcount is distinct from 0
         or not a.attislocal
         or a.atthasmissing
         or a.attmissingval is not null
         or a.attstattarget is not null
         or a.attndims is distinct from 0
         or a.attcompression is distinct from ''::"char"
         or a.attoptions is not null
         or a.attfdwoptions is not null
         or a.attcollation is distinct from case
              when e.type_name = 'text' then 'pg_catalog.default'::regcollation
              else 0::oid
            end
         or a.attstorage is distinct from case
              when e.type_name in ('text', 'jsonb') then 'x'::"char"
              else 'p'::"char"
            end
         or (
           case when d.oid is null then null::text else
             replace(
               regexp_replace(
                 lower(pg_get_expr(d.adbin, d.adrelid, true)),
                 '[[:space:]()]', '', 'g'
               ),
               '::bigint', ''
             )
           end
         ) is distinct from e.default_text
    ) or exists (
      with expected(
        attname, type_name, not_null, default_text, has_missing, missing_value
      ) as (
        values
          ('authority_generation', 'bigint', true, '0', true, '{0}'),
          ('f27_drill_rollback_id', 'uuid', false, null::text, false, null::text)
      )
      select 1
      from expected e
      left join pg_attribute a
        on a.attrelid = 'public.mirror_outbox'::regclass
       and a.attname = e.attname
       and a.attnum > 0
      left join pg_attrdef d
        on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid is null
         or a.attisdropped
         or format_type(a.atttypid, a.atttypmod) is distinct from e.type_name
         or a.attnotnull is distinct from e.not_null
         or a.attidentity is distinct from ''
         or a.attgenerated is distinct from ''
         or a.attacl is not null
         or a.attinhcount is distinct from 0
         or not a.attislocal
         or a.atthasmissing is distinct from e.has_missing
         or a.attmissingval::text is distinct from e.missing_value
         or a.attstattarget is not null
         or a.attndims is distinct from 0
         or a.attcompression is distinct from ''::"char"
         or a.attoptions is not null
         or a.attfdwoptions is not null
         or a.attcollation is distinct from 0::oid
         or a.attstorage is distinct from 'p'::"char"
         or (
           case when d.oid is null then null::text else
             replace(
               regexp_replace(
                 lower(pg_get_expr(d.adbin, d.adrelid, true)),
                 '[[:space:]()]', '', 'g'
               ),
               '::bigint', ''
             )
           end
         ) is distinct from e.default_text
    ) then
      raise exception 'F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT';
    end if;
    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END retained_columns

    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN retained_constraint_metadata
    if (select count(*) from pg_constraint where conrelid = v_rollbacks_oid) <> 6
       or (select count(*) from pg_constraint where conrelid = v_intents_oid) <> 4
       or (select count(*) from pg_constraint
           where conrelid = 'public.mirror_outbox'::regclass
             and conname in (
               'mirror_outbox_f27_drill_rollback_id_fkey',
               'mirror_outbox_f27_generation_check',
               'mirror_outbox_f27_drill_scope_check'
             )) <> 3
       or exists (
         select 1
         from pg_constraint c
         where c.conrelid in (v_rollbacks_oid, v_intents_oid)
           and (
             c.connamespace is distinct from 'public'::regnamespace
             or not c.convalidated
             or c.condeferrable
             or c.condeferred
             or not c.conislocal
             or c.coninhcount <> 0
             or c.conparentid <> 0
             or c.connoinherit is distinct from (c.contype <> 'c')
             or c.conname not in (
               'track_b_team_rollbacks_pkey',
               'track_b_team_rollbacks_correlation_id_key',
               'track_b_team_rollbacks_state_check',
               'track_b_team_rollbacks_fence_generation_check',
               'track_b_team_rollbacks_snapshot_count_check',
               'track_b_team_rollbacks_scope_check',
               'track_b_team_rollback_intents_pkey',
               'track_b_team_rollback_intents_rollback_id_fkey',
               'track_b_team_rollback_intents_outbox_id_fkey',
               'track_b_team_rollback_intents_classification_check'
             )
           )
       )
       or not exists (
         select 1 from pg_constraint c
         where c.conrelid = v_rollbacks_oid
           and c.conname = 'track_b_team_rollbacks_pkey'
           and c.contype = 'p'
           and c.conkey = array[1]::smallint[]
       )
       or not exists (
         select 1 from pg_constraint c
         where c.conrelid = v_rollbacks_oid
           and c.conname = 'track_b_team_rollbacks_correlation_id_key'
           and c.contype = 'u'
           and c.conkey = array[2]::smallint[]
       )
       or not exists (
         select 1 from pg_constraint c
         where c.conrelid = v_intents_oid
           and c.conname = 'track_b_team_rollback_intents_pkey'
           and c.contype = 'p'
           and c.conkey = array[1,2]::smallint[]
       )
       or not exists (
         select 1 from pg_constraint c
         where c.conrelid = v_intents_oid
           and c.conname = 'track_b_team_rollback_intents_rollback_id_fkey'
           and c.contype = 'f'
           and c.conkey = array[1]::smallint[]
           and c.confrelid = v_rollbacks_oid
           and c.confkey = array[1]::smallint[]
           and c.confupdtype = 'a' and c.confdeltype = 'a' and c.confmatchtype = 's'
       )
       or not exists (
         select 1 from pg_constraint c
         where c.conrelid = v_intents_oid
           and c.conname = 'track_b_team_rollback_intents_outbox_id_fkey'
           and c.contype = 'f'
           and c.conkey = array[2]::smallint[]
           and c.confrelid = 'public.mirror_outbox'::regclass
           and c.confkey = array[(select attnum from pg_attribute
             where attrelid = 'public.mirror_outbox'::regclass
               and attname = 'id' and not attisdropped)]::smallint[]
           and c.confupdtype = 'a' and c.confdeltype = 'a' and c.confmatchtype = 's'
       )
       or not exists (
         select 1 from pg_constraint c
         where c.conrelid = 'public.mirror_outbox'::regclass
           and c.conname = 'mirror_outbox_f27_drill_rollback_id_fkey'
           and c.connamespace = 'public'::regnamespace
           and c.contype = 'f'
           and c.convalidated
           and not c.condeferrable
           and not c.condeferred
           and c.conislocal
           and c.coninhcount = 0
           and c.conparentid = 0
           and c.connoinherit
           and c.conkey = array[(select attnum from pg_attribute
             where attrelid = 'public.mirror_outbox'::regclass
               and attname = 'f27_drill_rollback_id' and not attisdropped)]::smallint[]
           and c.confrelid = v_rollbacks_oid
           and c.confkey = array[1]::smallint[]
           and c.confupdtype = 'a' and c.confdeltype = 'a' and c.confmatchtype = 's'
       ) then
      raise exception 'F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT';
    end if;
    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END retained_constraint_metadata

    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN retained_check_constraints
    if exists (
      with expected(name, relation_oid, expression_text) as (
        values
          ('track_b_team_rollbacks_state_check', v_rollbacks_oid,
            'state=anyarray[''open''::text,''complete''::text,''cancelled''::text]'),
          ('track_b_team_rollbacks_fence_generation_check', v_rollbacks_oid,
            'fence_generation>=0'),
          ('track_b_team_rollbacks_snapshot_count_check', v_rollbacks_oid,
            'snapshot_count>=0'),
          ('track_b_team_rollbacks_scope_check', v_rollbacks_oid,
            'is_drill=falseandteam=anyarray[''video''::text,''graphics''::text]andfence_generationisnotnulloris_drill=trueandteam=''__f27_drill__''::textandfence_generationisnull'),
          ('track_b_team_rollback_intents_classification_check', v_intents_oid,
            'classification=anyarray[''replay''::text,''quarantine''::text,''discard''::text,''already_reflected''::text]'),
          ('mirror_outbox_f27_generation_check', 'public.mirror_outbox'::regclass,
            'authority_generation>=0'),
          ('mirror_outbox_f27_drill_scope_check', 'public.mirror_outbox'::regclass,
            'team<>''__f27_drill__''::textandf27_drill_rollback_idisnullorteam=''__f27_drill__''::textandclient_slug=''__f27_drill__''::textandentity=''deliverable''::textandoperation=''status''::textandtest_only=trueandlegacy_parity=falseanddepends_on_idisnullandauthority_generation=0andf27_drill_rollback_idisnotnullandpayload->>''f27_drill''::text=''true''::text')
      )
      select 1
      from expected e
      left join pg_constraint c
        on c.conrelid = e.relation_oid and c.conname = e.name
      where c.oid is null
         or c.connamespace is distinct from 'public'::regnamespace
         or c.contype is distinct from 'c'
         or not c.convalidated
         or c.condeferrable
         or c.condeferred
         or not c.conislocal
         or c.coninhcount <> 0
         or c.conparentid <> 0
         or c.connoinherit
         or regexp_replace(
              lower(pg_get_expr(c.conbin, c.conrelid, true)),
              '[[:space:]()]', '', 'g'
            ) is distinct from e.expression_text
    ) then
      raise exception 'F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT';
    end if;
    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END retained_check_constraints

    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN retained_indexes
    if (select count(*) from pg_index where indrelid = v_rollbacks_oid) <> 3
       or (select count(*) from pg_index where indrelid = v_intents_oid) <> 1
       or exists (
         select 1
         from (values
           ('track_b_team_rollbacks_pkey', v_rollbacks_oid, true, true, '1'),
           ('track_b_team_rollbacks_correlation_id_key', v_rollbacks_oid, true, false, '2'),
           ('track_b_team_rollback_intents_pkey', v_intents_oid, true, true, '1 2')
         ) expected(index_name, relation_oid, is_unique, is_primary, key_attnums)
         left join pg_class ci
           on ci.relnamespace = 'public'::regnamespace
          and ci.relname = expected.index_name
         left join pg_index i
           on i.indexrelid = ci.oid and i.indrelid = expected.relation_oid
         left join pg_am am on am.oid = ci.relam
         where i.indexrelid is null
            or ci.relkind is distinct from 'i'
            or ci.relpersistence is distinct from 'p'
            or pg_get_userbyid(ci.relowner) is distinct from 'postgres'
            or ci.reltablespace is distinct from 0::oid
            or ci.reloptions is not null
            or ci.relacl is not null
            or am.amname is distinct from 'btree'
            or i.indisunique is distinct from expected.is_unique
            or i.indnullsnotdistinct
            or i.indisprimary is distinct from expected.is_primary
            or i.indisexclusion
            or not i.indimmediate
            or i.indisclustered
            or not i.indisvalid
            or not i.indisready
            or not i.indislive
            or i.indisreplident
            or i.indcheckxmin
            or i.indkey::text is distinct from expected.key_attnums
            or i.indnkeyatts is distinct from cardinality(string_to_array(expected.key_attnums, ' '))
            or i.indnatts is distinct from cardinality(string_to_array(expected.key_attnums, ' '))
            or i.indclass::text is distinct from case expected.index_name
              when 'track_b_team_rollback_intents_pkey' then
                (select uuid_ops.oid::text || ' ' || int8_ops.oid::text
                 from pg_opclass uuid_ops, pg_opclass int8_ops
                 join pg_am am2 on am2.oid = int8_ops.opcmethod
                 where uuid_ops.opcmethod = am2.oid
                   and uuid_ops.opcnamespace = 'pg_catalog'::regnamespace
                   and int8_ops.opcnamespace = 'pg_catalog'::regnamespace
                   and uuid_ops.opcname = 'uuid_ops'
                   and int8_ops.opcname = 'int8_ops'
                   and am2.amname = 'btree')
              else
                (select opc.oid::text
                 from pg_opclass opc
                 join pg_am am2 on am2.oid = opc.opcmethod
                 where opc.opcnamespace = 'pg_catalog'::regnamespace
                   and opc.opcname = 'uuid_ops'
                   and am2.amname = 'btree')
            end
            or i.indcollation::text is distinct from case
              when expected.index_name = 'track_b_team_rollback_intents_pkey' then '0 0'
              else '0'
            end
            or i.indoption::text is distinct from case
              when expected.index_name = 'track_b_team_rollback_intents_pkey' then '0 0'
              else '0'
            end
            or i.indpred is not null
            or i.indexprs is not null
       )
       or not exists (
         select 1
         from pg_index i
         join pg_class ci on ci.oid = i.indexrelid
         join pg_am am on am.oid = ci.relam
         where i.indrelid = v_rollbacks_oid
           and ci.relnamespace = 'public'::regnamespace
           and ci.relname = 'track_b_team_rollbacks_one_open_team_idx'
           and ci.relkind = 'i' and ci.relpersistence = 'p'
           and pg_get_userbyid(ci.relowner) = 'postgres'
           and ci.reltablespace = 0 and ci.reloptions is null and ci.relacl is null
           and am.amname = 'btree'
           and i.indisunique and not i.indnullsnotdistinct
           and not i.indisprimary and not i.indisexclusion
           and i.indimmediate and not i.indisclustered
           and i.indisvalid and i.indisready and i.indislive
           and not i.indisreplident and not i.indcheckxmin
           and i.indnkeyatts = 1 and i.indnatts = 1
           and i.indexprs is null
           and i.indkey::text = (select attnum::text from pg_attribute
             where attrelid = v_rollbacks_oid and attname = 'team' and not attisdropped)
           and i.indclass::text = (select opc.oid::text
             from pg_opclass opc join pg_am am2 on am2.oid = opc.opcmethod
             where opc.opcnamespace = 'pg_catalog'::regnamespace
               and opc.opcname = 'text_ops' and am2.amname = 'btree')
           and i.indcollation::text = 'pg_catalog.default'::regcollation::oid::text
           and i.indoption::text = '0'
           and regexp_replace(
                 lower(pg_get_expr(i.indpred, i.indrelid, true)),
                 '[[:space:]()]', '', 'g'
               ) = 'state=''open''::text'
       )
       or not exists (
         select 1
         from pg_index i
         join pg_class ci on ci.oid = i.indexrelid
         join pg_am am on am.oid = ci.relam
         where i.indrelid = 'public.mirror_outbox'::regclass
           and ci.relnamespace = 'public'::regnamespace
           and ci.relname = 'mirror_outbox_one_f27_drill_row_idx'
           and ci.relkind = 'i' and ci.relpersistence = 'p'
           and pg_get_userbyid(ci.relowner) = 'postgres'
           and ci.reltablespace = 0 and ci.reloptions is null and ci.relacl is null
           and am.amname = 'btree'
           and i.indisunique and not i.indnullsnotdistinct
           and not i.indisprimary and not i.indisexclusion
           and i.indimmediate and not i.indisclustered
           and i.indisvalid and i.indisready and i.indislive
           and not i.indisreplident and not i.indcheckxmin
           and i.indnkeyatts = 1 and i.indnatts = 1
           and i.indexprs is null
           and i.indkey::text = (select attnum::text from pg_attribute
             where attrelid = 'public.mirror_outbox'::regclass
               and attname = 'f27_drill_rollback_id' and not attisdropped)
           and i.indclass::text = (select opc.oid::text
             from pg_opclass opc join pg_am am2 on am2.oid = opc.opcmethod
             where opc.opcnamespace = 'pg_catalog'::regnamespace
               and opc.opcname = 'uuid_ops' and am2.amname = 'btree')
           and i.indcollation::text = '0'
           and i.indoption::text = '0'
           and regexp_replace(
                 lower(pg_get_expr(i.indpred, i.indrelid, true)),
                 '[[:space:]()]', '', 'g'
               ) = 'f27_drill_rollback_idisnotnull'
       ) then
      raise exception 'F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT';
    end if;
    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END retained_indexes

    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN retained_hold_trigger
    if (select count(*) from pg_trigger t
        where t.tgrelid = 'public.mirror_outbox'::regclass
          and not t.tgisinternal and t.tgname = 'track_b_f27_hold_guard') <> 1
       or not exists (
         select 1
         from pg_trigger t
         where t.tgrelid = 'public.mirror_outbox'::regclass
           and not t.tgisinternal
           and t.tgname = 'track_b_f27_hold_guard'
           and t.tgfoid = to_regprocedure('public.track_b_f27_hold_guard()')
           and t.tgenabled = 'D'
           and t.tgtype = 23
           and t.tgnargs = 0
           and t.tgargs = ''::bytea
           and t.tgqual is null
           and t.tgoldtable is null
           and t.tgnewtable is null
           and (
             select array_agg(a.attname::text order by trigger_column.ordinality)
             from unnest(t.tgattr::smallint[]) with ordinality
               as trigger_column(attnum, ordinality)
             join pg_attribute a
               on a.attrelid = t.tgrelid and a.attnum = trigger_column.attnum
           ) = array[
             'status', 'team', 'authority_generation',
             'legacy_parity', 'test_only', 'f27_drill_rollback_id'
           ]::text[]
    ) then
      raise exception 'F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT';
    end if;
    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END retained_hold_trigger

    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN retained_functions
    if exists (
      with expected(
        identity, result_type, argument_names, argument_defaults,
        volatility, source_sha256
      ) as (
        values
          ('public.track_b_f27_requeue(bigint,bigint)', 'boolean',
            array['p_id','p_authority_generation']::text[], 0, 'v',
            '338f81384297ef8f8a36ba0cf2728badfc431a5d5dffff06a1bd7bb6bc37f37e'),
          ('public.track_b_f27_hold_guard()', 'trigger',
            null::text[], 0, 'v',
            'c4bbdb066759e1eba586323d2b71ce3ceceb5041942aca1c14b1c404456c71c4'),
          ('public.track_b_f27_begin(text,jsonb,text)', 'jsonb',
            array['p_team','p_expected_authority','p_actor']::text[], 0, 'v',
            'c5952a0bba903a2c7176eed67c6e54c8374f062a3d06d5c6b3b422d047a3f70b'),
          ('public.track_b_f27_begin_drill(jsonb,text)', 'jsonb',
            array['p_expected_authority','p_actor']::text[], 0, 'v',
            '88f2205fcae13dd0dd5b95d85f01b2a2c53dc34e5676feca221116a022134802'),
          ('public.track_b_f27_classify(uuid,bigint,text,text,text,jsonb)', 'jsonb',
            array['p_rollback_id','p_outbox_id','p_classification','p_reason','p_actor','p_reflected_receipt']::text[], 1, 'v',
            '456b94514bb590ef71280f421360772b21d43c6d0a77892c1f45d43f351dbe78'),
          ('public.track_b_f27_execute_drill_replay(uuid,bigint,uuid)', 'jsonb',
            array['p_rollback_id','p_outbox_id','p_lock_token']::text[], 0, 'v',
            '02f94eebb08137f1450ca2a35ace81d78984c59028d30e05a042f650490d4f80'),
          ('public.track_b_f27_record_terminal(uuid,bigint,jsonb)', 'jsonb',
            array['p_rollback_id','p_outbox_id','p_receipt']::text[], 0, 'v',
            '6ac629af0a9609d62a864199b0b2f5994354052d3a2ba00ba13480741ade6010'),
          ('public.track_b_f27_finalize(uuid,jsonb,text)', 'jsonb',
            array['p_rollback_id','p_expected_authority','p_actor']::text[], 0, 'v',
            '4a32ce511aea7b294b9d78c91a229cd77adbabd7a997505489a4b5f6d8767940'),
          ('public.track_b_f27_finalize_drill(uuid,jsonb,text)', 'jsonb',
            array['p_rollback_id','p_expected_authority','p_actor']::text[], 0, 'v',
            '99709ffcbb987d51851998e7f2b799400cb53765d643a180e456adda2f08c839')
      )
      select 1
      from expected e
      left join pg_proc p on p.oid = to_regprocedure(e.identity)
      left join pg_namespace n on n.oid = p.pronamespace
      left join pg_language l on l.oid = p.prolang
      where p.oid is null
         or n.nspname is distinct from 'public'
         or p.prokind is distinct from 'f'
         or p.prorettype::regtype::text is distinct from e.result_type
         or p.proretset
         or p.proargnames is distinct from e.argument_names
         or p.pronargdefaults is distinct from e.argument_defaults
         or (e.argument_defaults = 0 and p.proargdefaults is not null)
         or (e.argument_defaults = 1 and
             regexp_replace(
               lower(pg_get_expr(p.proargdefaults, 0, true)),
               '[[:space:]()]', '', 'g'
             ) is distinct from 'null::jsonb')
         or p.proallargtypes is not null
         or p.proargmodes is not null
         or p.protrftypes is not null
         or p.provariadic <> 0
         or p.prosupport <> 0
         or p.procost is distinct from 100::real
         or p.prorows is distinct from 0::real
         or p.probin is not null
         or p.prosqlbody is not null
         or l.lanname is distinct from 'plpgsql'
         or not p.prosecdef
         or p.proleakproof
         or p.provolatile is distinct from e.volatility
         or p.proparallel is distinct from 'u'
         or p.proisstrict
         or pg_get_userbyid(p.proowner) is distinct from 'postgres'
         or p.proconfig is distinct from array['search_path=public']::text[]
         or encode(
              extensions.digest(
                convert_to(
                  replace(replace(p.prosrc, E'\r\n', E'\n'), E'\r', E'\n'),
                  'UTF8'
                ),
                'sha256'
              ),
              'hex'
            ) is distinct from e.source_sha256
    ) then
      raise exception 'F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT';
    end if;
    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END retained_functions

    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN retained_hold_guard_acl
    -- The 2026-08-01 production rollback retained the historical hold-guard
    -- ACL exactly as NULL/acldefault (owner + PUBLIC EXECUTE).  Current source
    -- explicitly revokes it to owner-only.  Those are two named, exact
    -- variants; an explicit PUBLIC ACL or any other grant is a third state.
    select case
      when p.proacl is null
       and not exists (
         (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
          from aclexplode(acldefault('f', p.proowner)) a
          where a.grantee = p.proowner)
         except
         (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = p.proowner)
       )
       and (select count(*)
            from aclexplode(acldefault('f', p.proowner)) a
            where a.grantee is distinct from p.proowner) = 1
       and not exists (
         select 1
         from aclexplode(acldefault('f', p.proowner)) a
         where a.grantee is distinct from p.proowner
           and (
             a.grantee <> 0
             or a.grantor is distinct from p.proowner
             or a.privilege_type is distinct from 'EXECUTE'
             or a.is_grantable
           )
       ) then 'legacy_2026_08_01_acldefault_public_execute'
      when p.proacl is not null
       and not exists (
         (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = p.proowner)
         except
         (select d.grantor, d.grantee, d.privilege_type, d.is_grantable
          from aclexplode(acldefault('f', p.proowner)) d
          where d.grantee = p.proowner)
       )
       and not exists (
         (select d.grantor, d.grantee, d.privilege_type, d.is_grantable
          from aclexplode(acldefault('f', p.proowner)) d
          where d.grantee = p.proowner)
         except
         (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = p.proowner)
       )
       and not exists (
         select 1
         from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where a.grantee is distinct from p.proowner
       ) then 'current_owner_only'
      else null
    end
    into v_hold_guard_acl_variant
    from pg_proc p
    where p.oid = to_regprocedure('public.track_b_f27_hold_guard()');
    if v_hold_guard_acl_variant is null then
      raise exception 'F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT';
    end if;
    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END retained_hold_guard_acl

    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN retained_mutating_acl
    -- F27_RETAINED_MUTATING_ACL_OWNER_ONLY_BEGIN
    if exists (
      select 1
      from (values
        ('public.track_b_f27_requeue(bigint,bigint)'),
        ('public.track_b_f27_begin(text,jsonb,text)'),
        ('public.track_b_f27_begin_drill(jsonb,text)'),
        ('public.track_b_f27_classify(uuid,bigint,text,text,text,jsonb)'),
        ('public.track_b_f27_execute_drill_replay(uuid,bigint,uuid)'),
        ('public.track_b_f27_record_terminal(uuid,bigint,jsonb)'),
        ('public.track_b_f27_finalize(uuid,jsonb,text)'),
        ('public.track_b_f27_finalize_drill(uuid,jsonb,text)')
      ) expected(identity)
      left join pg_proc p on p.oid = to_regprocedure(expected.identity)
      where p.oid is null
         or p.proacl is null
         or exists (
           (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where a.grantee = p.proowner)
           except
           (select d.grantor, d.grantee, d.privilege_type, d.is_grantable
            from aclexplode(acldefault('f', p.proowner)) d
            where d.grantee = p.proowner)
         )
         or exists (
           (select d.grantor, d.grantee, d.privilege_type, d.is_grantable
            from aclexplode(acldefault('f', p.proowner)) d
            where d.grantee = p.proowner)
           except
           (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where a.grantee = p.proowner)
         )
         or exists (
           select 1
           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where a.grantee is distinct from p.proowner
         )
    ) then
      raise exception 'F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT';
    end if;
    -- F27_RETAINED_MUTATING_ACL_OWNER_ONLY_END
    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END retained_mutating_acl

    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN retained_no_open_work
    if exists (
         select 1 from public.track_b_team_rollbacks
         where state = 'open'
       )
       or exists (
         select 1 from public.track_b_team_rollback_intents
         where classification is null
            or (classification = 'replay' and terminal_receipt is null)
       ) then
      raise exception 'F27_PREINSTALL_GATE_RETAINED_LEDGER_OPEN';
    end if;
    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END retained_no_open_work

    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN retained_intent_history
    if exists (
      select 1
      from public.track_b_team_rollback_intents i
      left join public.track_b_team_rollbacks r on r.id = i.rollback_id
      left join public.mirror_outbox o on o.id = i.outbox_id
      where r.id is null
         or o.id is null
         or jsonb_typeof(i.row_snapshot) is distinct from 'object'
         or i.row_snapshot->>'id' is distinct from i.outbox_id::text
         or i.row_sha256 is distinct from encode(
              extensions.digest(convert_to(i.row_snapshot::text, 'UTF8'), 'sha256'),
              'hex'
            )
         or jsonb_typeof(i.classification_history) is distinct from 'array'
         or jsonb_array_length(i.classification_history) = 0
         or i.reason is null
         or i.classified_by is null
         or i.classified_at is null
         or i.classification_history->-1->>'to' is distinct from i.classification
         or i.classification_history->-1->>'reason' is distinct from i.reason
         or i.classification_history->-1->>'actor' is distinct from i.classified_by
         or i.classification_history->-1->'at' is distinct from to_jsonb(i.classified_at)
         or (
           i.classification in ('replay', 'already_reflected')
           and jsonb_typeof(i.terminal_receipt) is distinct from 'object'
         )
         or lower(i.row_snapshot->>'team') is distinct from r.team
         or coalesce(i.row_snapshot->>'status', '') not in ('pending', 'failed', 'shadow_ok')
         or (not r.is_drill and (
           i.row_snapshot->>'authority_generation' is distinct from r.fence_generation::text
           or i.row_snapshot->>'f27_drill_rollback_id' is not null
         ))
         or (r.is_drill and (
           i.row_snapshot->>'team' is distinct from '__f27_drill__'
           or i.row_snapshot->>'client_slug' is distinct from '__f27_drill__'
           or i.row_snapshot->>'test_only' is distinct from 'true'
           or i.row_snapshot->>'legacy_parity' is distinct from 'false'
           or i.row_snapshot->>'authority_generation' is distinct from '0'
           or i.row_snapshot->>'f27_drill_rollback_id' is distinct from r.id::text
         ))
         or (
           i.classification in ('quarantine', 'discard')
           and (i.terminal_receipt is not null or o.status is distinct from 'skipped')
         )
         or (
           i.classification = 'already_reflected'
           and (
             i.terminal_receipt->>'ok' is distinct from 'true'
             or i.terminal_receipt->>'type' is distinct from 'f27_already_reflected_terminal'
             or i.terminal_receipt->>'rollback_id' is distinct from i.rollback_id::text
             or i.terminal_receipt->>'outbox_id' is distinct from i.outbox_id::text
             or i.terminal_receipt->>'correlation_id' is distinct from r.correlation_id::text
             or i.terminal_receipt->>'intent_snapshot_sha256' is distinct from i.row_sha256
             or i.terminal_receipt->>'dedup_key' is distinct from o.dedup_key
             or i.terminal_receipt->>'operation' is distinct from o.operation
             or coalesce(i.terminal_receipt->>'issue_id', '') = ''
             or o.status is distinct from 'written'
             or o.linear_result is distinct from i.terminal_receipt
             or jsonb_typeof(i.terminal_receipt->'observed_result') is distinct from 'object'
             or i.terminal_receipt->>'observed_result_sha256' is distinct from encode(
                  extensions.digest(
                    convert_to((i.terminal_receipt->'observed_result')::text, 'UTF8'),
                    'sha256'
                  ),
                  'hex'
                )
           )
         )
         or (
           i.classification = 'replay'
           and (
             i.terminal_receipt->>'ok' is distinct from 'true'
             or i.terminal_receipt->>'type' is distinct from case
                  when r.is_drill then 'f27_drill_replay_terminal'
                  else 'linear_write_terminal'
                end
             or i.terminal_receipt->>'rollback_id' is distinct from i.rollback_id::text
             or i.terminal_receipt->>'outbox_id' is distinct from i.outbox_id::text
             or i.terminal_receipt->>'correlation_id' is distinct from r.correlation_id::text
             or i.terminal_receipt->>'intent_snapshot_sha256' is distinct from i.row_sha256
             or i.terminal_receipt->>'dedup_key' is distinct from o.dedup_key
             or i.terminal_receipt->>'operation' is distinct from o.operation
             or o.status is distinct from 'written'
             or o.linear_result is null
             or i.terminal_receipt->>'linear_result_sha256' is distinct from encode(
                  extensions.digest(convert_to(o.linear_result::text, 'UTF8'), 'sha256'),
                  'hex'
                )
             or (r.is_drill and (
               o.f27_drill_rollback_id is distinct from r.id
               or o.team is distinct from '__f27_drill__'
               or o.client_slug is distinct from '__f27_drill__'
               or not o.test_only
               or o.legacy_parity
               or o.authority_generation <> 0
               or o.linear_result->>'type' is distinct from 'f27_drill_replay_terminal'
               or o.linear_result->>'no_external_call' is distinct from 'true'
             ))
           )
         )
    ) then
      raise exception 'F27_PREINSTALL_GATE_GENERATION_HISTORY_DRIFT';
    end if;
    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END retained_intent_history

    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN retained_rollback_history
    if exists (
      select 1
      from public.track_b_team_rollbacks r
      left join lateral (
        select count(*)::integer intent_count,
               encode(
                 extensions.digest(
                   convert_to(coalesce(string_agg(i.row_sha256, '' order by i.outbox_id), ''), 'UTF8'),
                   'sha256'
                 ),
                 'hex'
               ) intent_sha256
        from public.track_b_team_rollback_intents i
        where i.rollback_id = r.id
      ) audit on true
      where r.state is distinct from 'complete'
         or r.completed_at is null
         or jsonb_typeof(r.expected_authority) is distinct from 'object'
         or jsonb_typeof(r.prior_outbound) is distinct from 'object'
         or jsonb_typeof(r.prior_parity) is distinct from 'object'
         or jsonb_typeof(r.terminal_receipt) is distinct from 'object'
         or r.snapshot_count is distinct from audit.intent_count
         or r.snapshot_sha256 is distinct from audit.intent_sha256
         or r.terminal_receipt->>'ok' is distinct from 'true'
         or r.terminal_receipt->>'rollback_id' is distinct from r.id::text
         or r.terminal_receipt->>'correlation_id' is distinct from r.correlation_id::text
         or r.terminal_receipt->>'team' is distinct from r.team
         or r.terminal_receipt->'snapshot_count' is distinct from to_jsonb(r.snapshot_count)
         or r.terminal_receipt->>'snapshot_sha256' is distinct from r.snapshot_sha256
         or r.terminal_receipt->'normal_outbound' is distinct from r.prior_outbound
         or r.terminal_receipt->'legacy_parity' is distinct from r.prior_parity
         or r.terminal_receipt->'authority_before' is distinct from r.expected_authority
         or (
           not r.is_drill and (
             r.terminal_receipt->>'type' is distinct from 'f27_rollback_terminal'
             or r.terminal_receipt ? 'is_drill'
             or r.fence_generation is null
             or r.terminal_receipt->'fence_generation_before'
                is distinct from to_jsonb(r.fence_generation)
             or r.terminal_receipt->'fence_generation_after'
                is distinct from to_jsonb(r.fence_generation + 1)
             or r.terminal_receipt->>'unclassified' is distinct from '0'
             or r.terminal_receipt->>'unreceipted_replays' is distinct from '0'
             or r.terminal_receipt->>'active_team_rows' is distinct from '0'
             or r.terminal_receipt->'authority_after' is distinct from jsonb_set(
                  r.expected_authority, array[r.team], '"linear"'::jsonb, false
                )
           )
         )
         or (
           r.is_drill and (
             r.team is distinct from '__f27_drill__'
             or r.fence_generation is not null
             or r.terminal_receipt->>'type' is distinct from 'f27_drill_terminal'
             or r.terminal_receipt->>'is_drill' is distinct from 'true'
             or r.terminal_receipt->>'authority_cas' is distinct from 'refused'
             or r.terminal_receipt->>'authority_cas_reason'
                is distinct from 'f27_drill_authority_cas_refused'
             or r.terminal_receipt->>'audit_history_retained' is distinct from 'true'
             or r.terminal_receipt->'authority_after' is distinct from r.expected_authority
             or r.snapshot_count is distinct from 1
             or r.terminal_receipt->>'unclassified' is distinct from '0'
             or r.terminal_receipt->>'unreceipted_replays' is distinct from '0'
             or r.terminal_receipt->'replay_intents' is distinct from to_jsonb(r.snapshot_count)
             or r.terminal_receipt->'exact_terminal_replays' is distinct from to_jsonb(r.snapshot_count)
             or r.terminal_receipt->>'active_drill_rows' is distinct from '0'
           )
         )
    ) then
      raise exception 'F27_PREINSTALL_GATE_GENERATION_HISTORY_DRIFT';
    end if;
    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END retained_rollback_history

    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN retained_generation_history
    if exists (
      select 1
      from public.track_b_f27_team_fences f
      left join lateral (
        select count(*)::bigint completed_count,
               count(distinct r.fence_generation)::bigint distinct_generation_count,
               min(r.fence_generation) min_generation,
               max(r.fence_generation) max_generation
        from public.track_b_team_rollbacks r
        where not r.is_drill and r.state = 'complete' and r.team = f.team
      ) history on true
      where f.generation is distinct from history.completed_count
         or (f.generation = 0 and f.updated_by is distinct from 'f27-migration')
         or (f.generation > 0 and f.updated_by is distinct from (
           select max(r.actor)
           from public.track_b_team_rollbacks r
           where not r.is_drill and r.state = 'complete' and r.team = f.team
             and r.fence_generation = f.generation - 1
         ))
         or history.distinct_generation_count is distinct from history.completed_count
         or (history.completed_count = 0 and (
           history.min_generation is not null or history.max_generation is not null
         ))
         or (history.completed_count > 0 and (
           history.min_generation is distinct from 0
           or history.max_generation is distinct from history.completed_count - 1
         ))
    ) then
      raise exception 'F27_PREINSTALL_GATE_GENERATION_HISTORY_DRIFT';
    end if;
    -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END retained_generation_history
  end if;

  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN mirror_enqueue_acl
  if exists (
    select 1
    from pg_proc p
    where p.oid = v_mirror_enqueue_oid
      and (
        pg_get_userbyid(p.proowner) is distinct from 'postgres'
        or exists (
          (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where a.grantee = p.proowner)
          except
          (select d.grantor, d.grantee, d.privilege_type, d.is_grantable
           from aclexplode(acldefault('f', p.proowner)) d
           where d.grantee = p.proowner)
        )
        or exists (
          (select d.grantor, d.grantee, d.privilege_type, d.is_grantable
           from aclexplode(acldefault('f', p.proowner)) d
           where d.grantee = p.proowner)
          except
          (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where a.grantee = p.proowner)
        )
        or (
          select count(*)
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee is distinct from p.proowner
        ) is distinct from 1
        or exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee is distinct from p.proowner
            and (
              a.grantee is distinct from (
                select oid from pg_roles where rolname = 'service_role'
              )
              or a.grantor is distinct from p.proowner
              or a.privilege_type is distinct from 'EXECUTE'
              or a.is_grantable
            )
        )
      )
  ) then
    raise exception 'F27_PREINSTALL_GATE_MIRROR_ENQUEUE_ACL_DRIFT';
  end if;
  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END mirror_enqueue_acl

  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN write_authorization
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where p.oid = v_write_authorization_oid
      and (
        n.nspname is distinct from 'public'
        or p.proname is distinct from 'track_b_f27_write_authorization'
        or p.prokind is distinct from 'f'
        or p.prorettype is distinct from 'jsonb'::regtype
        or p.proretset
        or p.pronargs is distinct from 1
        or p.pronargdefaults is distinct from 0
        or p.proargnames is distinct from array['p_team']::text[]
        or p.proallargtypes is not null
        or p.proargmodes is not null
        or p.protrftypes is not null
        or p.provariadic <> 0
        or p.prosupport <> 0
        or p.procost is distinct from 100::real
        or p.prorows is distinct from 0::real
        or p.probin is not null
        or p.prosqlbody is not null
        or l.lanname is distinct from 'plpgsql'
        or not p.prosecdef
        or p.proleakproof
        or p.provolatile is distinct from 's'
        or p.proparallel is distinct from 'u'
        or p.proisstrict
        or pg_get_userbyid(p.proowner) is distinct from 'postgres'
        or p.proconfig is distinct from array['search_path=public']::text[]
        or replace(replace(p.prosrc, E'\r\n', E'\n'), E'\r', E'\n')
          is distinct from replace(replace(
            $f27_write_authorization_source$
declare
  v_team text := lower(nullif(btrim(coalesce(p_team, '')), ''));
  v_generation bigint;
  v_authority jsonb;
begin
  if v_team not in ('video', 'graphics') then
    raise exception 'f27_invalid_write_team';
  end if;
  select generation into v_generation
  from public.track_b_f27_team_fences where team = v_team;
  select value into v_authority
  from public.syncview_runtime_flags where key = 'prod_authority';
  if v_generation is null or jsonb_typeof(v_authority) is distinct from 'object'
     or lower(coalesce(v_authority->>v_team, '')) not in ('linear', 'syncview') then
    raise exception 'f27_write_authorization_unavailable';
  end if;
  return jsonb_build_object(
    'ok', true,
    'type', 'f27_write_authorization',
    'team', v_team,
    'authority', lower(v_authority->>v_team),
    'generation', v_generation
  );
end;
$f27_write_authorization_source$,
            E'\r\n',
            E'\n'
          ), E'\r', E'\n')
        or exists (
          (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where a.grantee = p.proowner)
          except
          (select d.grantor, d.grantee, d.privilege_type, d.is_grantable
           from aclexplode(acldefault('f', p.proowner)) d
           where d.grantee = p.proowner)
        )
        or exists (
          (select d.grantor, d.grantee, d.privilege_type, d.is_grantable
           from aclexplode(acldefault('f', p.proowner)) d
           where d.grantee = p.proowner)
          except
          (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where a.grantee = p.proowner)
        )
        or (
          select count(*)
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee is distinct from p.proowner
        ) is distinct from 1
        or exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee is distinct from p.proowner
            and (
              a.grantee is distinct from (
                select oid from pg_roles where rolname = 'service_role'
              )
              or a.grantor is distinct from p.proowner
              or a.privilege_type is distinct from 'EXECUTE'
              or a.is_grantable
            )
        )
      )
  ) then
    raise exception 'F27_PREINSTALL_GATE_WRITE_AUTHORIZATION_DRIFT';
  end if;
  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END write_authorization

  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN production_authority
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where p.oid = v_production_authority_oid
      and (
        n.nspname is distinct from 'public'
        or p.proname is distinct from 'production_assert_authority'
        or p.prokind is distinct from 'f'
        or p.prorettype is distinct from 'void'::regtype
        or p.proretset
        or p.pronargs is distinct from 4
        or p.pronargdefaults is distinct from 0
        or p.proargnames is distinct from array[
          'p_client_slug',
          'p_team',
          'p_test_only',
          'p_legacy_parity'
        ]::text[]
        or p.proallargtypes is not null
        or p.proargmodes is not null
        or p.protrftypes is not null
        or p.provariadic <> 0
        or p.prosupport <> 0
        or p.procost is distinct from 100::real
        or p.prorows is distinct from 0::real
        or p.probin is not null
        or p.prosqlbody is not null
        or l.lanname is distinct from 'plpgsql'
        or not p.prosecdef
        or p.proleakproof
        or p.provolatile is distinct from 'v'
        or p.proparallel is distinct from 'u'
        or p.proisstrict
        or pg_get_userbyid(p.proowner) is distinct from 'postgres'
        or p.proconfig is distinct from array['search_path=public']::text[]
        or replace(replace(p.prosrc, E'\r\n', E'\n'), E'\r', E'\n')
          is distinct from replace(replace(
            $f27_production_authority_source$
declare
  v_value jsonb;
  v_parity_value jsonb;
  v_authority text;
  v_test_ok boolean;
begin
  if p_test_only then
    select exists(
      select 1 from public.clients c
      where c.slug = p_client_slug and c.active = true and c.kind = 'test'
    ) into v_test_ok;
    if not v_test_ok then raise exception 'test_client_scope_required'; end if;
    return;
  end if;
  if p_team is null or p_team not in ('video', 'graphics') then
    raise exception 'authority_unavailable';
  end if;
  if p_legacy_parity then
    select f.value into v_parity_value
    from public.syncview_runtime_flags f
    where f.key = 'linear_legacy_parity_enabled'
    for share;
    if not found
       or jsonb_typeof(v_parity_value) <> 'object'
       or v_parity_value->'enabled' is distinct from 'true'::jsonb then
      raise exception 'legacy_parity_gate_unavailable';
    end if;
  end if;
  select f.value into v_value
  from public.syncview_runtime_flags f
  where f.key = 'prod_authority'
  for share;
  if not found or jsonb_typeof(v_value) <> 'object' then
    raise exception 'authority_unavailable';
  end if;
  v_authority := lower(nullif(v_value->>p_team, ''));
  if p_legacy_parity and v_authority is distinct from 'linear' then
    raise exception 'legacy_parity_not_allowed';
  elsif not p_legacy_parity and v_authority is distinct from 'syncview' then
    raise exception 'team_is_linear_authoritative';
  end if;
end;
$f27_production_authority_source$,
            E'\r\n',
            E'\n'
          ), E'\r', E'\n')
        or exists (
          (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where a.grantee = p.proowner)
          except
          (select d.grantor, d.grantee, d.privilege_type, d.is_grantable
           from aclexplode(acldefault('f', p.proowner)) d
           where d.grantee = p.proowner)
        )
        or exists (
          (select d.grantor, d.grantee, d.privilege_type, d.is_grantable
           from aclexplode(acldefault('f', p.proowner)) d
           where d.grantee = p.proowner)
          except
          (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where a.grantee = p.proowner)
        )
        or (
          select count(*)
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee is distinct from p.proowner
        ) is distinct from 1
        or exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee is distinct from p.proowner
            and (
              a.grantee is distinct from (
                select oid from pg_roles where rolname = 'service_role'
              )
              or a.grantor is distinct from p.proowner
              or a.privilege_type is distinct from 'EXECUTE'
              or a.is_grantable
            )
        )
      )
  ) then
    raise exception 'F27_PREINSTALL_GATE_PRODUCTION_AUTHORITY_DRIFT';
  end if;
  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END production_authority

  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN unexpected_f27_objects
  if exists (
       select 1
       from pg_namespace
       where nspname ~* v_object_pattern
     )
     or exists (
       select 1
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
         and (
           n.nspname ~* v_object_pattern
           or c.relname ~* v_object_pattern
         )
         and not (
           c.oid in (
             v_fence_oid,
             'public.track_b_f27_team_fences_pkey'::regclass
           )
           or (
             v_entry_state = 'retained_post_rollback'
             and c.oid in (
               v_rollbacks_oid,
               v_intents_oid,
               to_regclass('public.track_b_team_rollbacks_pkey'),
               to_regclass('public.track_b_team_rollbacks_correlation_id_key'),
               to_regclass('public.track_b_team_rollbacks_one_open_team_idx'),
               to_regclass('public.track_b_team_rollback_intents_pkey'),
               to_regclass('public.mirror_outbox_one_f27_drill_row_idx')
             )
           )
         )
     )
     or exists (
       select 1
       from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
       where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
         and (
           n.nspname ~* v_object_pattern
           or t.typname ~* v_object_pattern
         )
         and not (
           n.nspname = 'public'
           and (
             t.oid = v_fence_rowtype
               and t.typname = 'track_b_f27_team_fences'
               and t.typtype = 'c'
               and t.typrelid = v_fence_oid
               and t.typelem = 0
               and t.typbasetype = 0
               and not t.typnotnull
               and t.typdefault is null
               and t.typcollation = 0
               and pg_get_userbyid(t.typowner) = 'postgres'
               and t.typacl is null
               and t.typarray = (
                 select allowed_array.oid
                 from pg_type allowed_array
                 join pg_namespace allowed_array_n
                   on allowed_array_n.oid = allowed_array.typnamespace
                 where allowed_array_n.nspname = 'public'
                   and allowed_array.typname = '_track_b_f27_team_fences'
               )
              or t.typname = '_track_b_f27_team_fences'
               and t.typtype = 'b'
               and t.typrelid = 0
               and t.typelem = v_fence_rowtype
               and t.typarray = 0
               and t.typbasetype = 0
               and not t.typnotnull
               and t.typdefault is null
               and t.typcollation = 0
               and pg_get_userbyid(t.typowner) = 'postgres'
                and t.typacl is null
              or v_entry_state = 'retained_post_rollback'
                and t.typtype = 'c'
                and t.typrelid in (v_rollbacks_oid, v_intents_oid)
                and t.oid in (
                  (select reltype from pg_class where oid = v_rollbacks_oid),
                  (select reltype from pg_class where oid = v_intents_oid)
                )
                and t.typname in (
                  'track_b_team_rollbacks',
                  'track_b_team_rollback_intents'
                )
                and t.typelem = 0
                and t.typbasetype = 0
                and not t.typnotnull
                and t.typdefault is null
                and t.typcollation = 0
                and pg_get_userbyid(t.typowner) = 'postgres'
                and t.typacl is null
              or v_entry_state = 'retained_post_rollback'
                and t.typtype = 'b'
                and t.typrelid = 0
                and t.typelem in (
                  (select reltype from pg_class where oid = v_rollbacks_oid),
                  (select reltype from pg_class where oid = v_intents_oid)
                )
                and t.typname in (
                  '_track_b_team_rollbacks',
                  '_track_b_team_rollback_intents'
                )
                and t.typarray = 0
                and t.typbasetype = 0
                and not t.typnotnull
                and t.typdefault is null
                and t.typcollation = 0
                and pg_get_userbyid(t.typowner) = 'postgres'
                and t.typacl is null
            )
          )
     )
     or exists (
       select 1
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname not in ('pg_catalog', 'information_schema')
         and (
           n.nspname ~* v_object_pattern
           or p.proname ~* v_object_pattern
           or (
             p.prokind in ('f', 'p')
             and pg_get_functiondef(p.oid) ~* v_function_body_pattern
           )
         )
           and p.oid <> v_write_authorization_oid
           and p.oid <> v_production_authority_oid
           and not (
             v_entry_state = 'retained_post_rollback'
             and p.oid in (
               to_regprocedure('public.track_b_f27_requeue(bigint,bigint)'),
               to_regprocedure('public.track_b_f27_hold_guard()'),
               to_regprocedure('public.track_b_f27_begin(text,jsonb,text)'),
               to_regprocedure('public.track_b_f27_begin_drill(jsonb,text)'),
               to_regprocedure('public.track_b_f27_classify(uuid,bigint,text,text,text,jsonb)'),
               to_regprocedure('public.track_b_f27_execute_drill_replay(uuid,bigint,uuid)'),
               to_regprocedure('public.track_b_f27_record_terminal(uuid,bigint,jsonb)'),
               to_regprocedure('public.track_b_f27_finalize(uuid,jsonb,text)'),
               to_regprocedure('public.track_b_f27_finalize_drill(uuid,jsonb,text)')
             )
           )
     )
     or exists (
       select 1
       from pg_constraint c
       left join pg_namespace n on n.oid = c.connamespace
       where (
           coalesce(n.nspname, '') ~* v_object_pattern
           or c.conname ~* v_object_pattern
           or pg_get_constraintdef(c.oid, true) ~* v_object_pattern
         )
          and not (
            c.conrelid = v_fence_oid
           and c.conname in (
             'track_b_f27_team_fences_pkey',
             'track_b_f27_team_fences_team_check',
              'track_b_f27_team_fences_generation_check'
            )
            or v_entry_state = 'retained_post_rollback'
              and (
                c.conrelid = v_rollbacks_oid
                  and c.conname in (
                    'track_b_team_rollbacks_pkey',
                    'track_b_team_rollbacks_correlation_id_key',
                    'track_b_team_rollbacks_state_check',
                    'track_b_team_rollbacks_fence_generation_check',
                    'track_b_team_rollbacks_snapshot_count_check',
                    'track_b_team_rollbacks_scope_check'
                  )
                or c.conrelid = v_intents_oid
                  and c.conname in (
                    'track_b_team_rollback_intents_pkey',
                    'track_b_team_rollback_intents_rollback_id_fkey',
                    'track_b_team_rollback_intents_outbox_id_fkey',
                    'track_b_team_rollback_intents_classification_check'
                  )
                or c.conrelid = 'public.mirror_outbox'::regclass
                  and c.conname in (
                    'mirror_outbox_f27_drill_rollback_id_fkey',
                    'mirror_outbox_f27_generation_check',
                    'mirror_outbox_f27_drill_scope_check'
                  )
              )
          )
     )
     or exists (
       select 1
       from pg_index i
       join pg_class ci on ci.oid = i.indexrelid
       join pg_namespace n on n.oid = ci.relnamespace
       where (
           n.nspname ~* v_object_pattern
           or ci.relname ~* v_object_pattern
           or pg_get_indexdef(i.indexrelid) ~* v_object_pattern
         )
          and not (
            i.indexrelid = 'public.track_b_f27_team_fences_pkey'::regclass
            or v_entry_state = 'retained_post_rollback'
              and i.indexrelid in (
                to_regclass('public.track_b_team_rollbacks_pkey'),
                to_regclass('public.track_b_team_rollbacks_correlation_id_key'),
                to_regclass('public.track_b_team_rollbacks_one_open_team_idx'),
                to_regclass('public.track_b_team_rollback_intents_pkey'),
                to_regclass('public.mirror_outbox_one_f27_drill_row_idx')
              )
          )
     )
     or exists (
       select 1
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where not t.tgisinternal
          and (
            n.nspname ~* v_object_pattern
            or t.tgname ~* v_object_pattern
            or pg_get_triggerdef(t.oid, true) ~* v_object_pattern
          )
          and not (
            v_entry_state = 'retained_post_rollback'
            and t.tgrelid = 'public.mirror_outbox'::regclass
            and t.tgname = 'track_b_f27_hold_guard'
          )
     )
     or exists (
       select 1
       from pg_rewrite r
       join pg_class c on c.oid = r.ev_class
       join pg_namespace n on n.oid = c.relnamespace
       where (
         n.nspname ~* v_object_pattern
         or r.rulename ~* v_object_pattern
         or pg_get_ruledef(r.oid, true) ~* v_object_pattern
       )
     )
     or exists (
       select 1
       from pg_policy p
       join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname ~* v_object_pattern
          or p.polname ~* v_object_pattern
          or coalesce(pg_get_expr(p.polqual, p.polrelid, true), '')
             ~* v_object_pattern
          or coalesce(pg_get_expr(p.polwithcheck, p.polrelid, true), '')
             ~* v_object_pattern
     )
     or exists (
       select 1
       from pg_inherits i
       join pg_class child on child.oid = i.inhrelid
       join pg_namespace child_n on child_n.oid = child.relnamespace
       join pg_class parent on parent.oid = i.inhparent
       join pg_namespace parent_n on parent_n.oid = parent.relnamespace
       where i.inhrelid = v_fence_oid
          or i.inhparent = v_fence_oid
          or child_n.nspname ~* v_object_pattern
          or child.relname ~* v_object_pattern
          or parent_n.nspname ~* v_object_pattern
          or parent.relname ~* v_object_pattern
     )
     or exists (
       select 1
       from pg_collation c
       join pg_namespace n on n.oid = c.collnamespace
       where n.nspname ~* v_object_pattern
          or c.collname ~* v_object_pattern
     )
     or exists (
       select 1
       from pg_opclass o
       join pg_namespace n on n.oid = o.opcnamespace
       where n.nspname ~* v_object_pattern
          or o.opcname ~* v_object_pattern
          or o.opcintype in (
            v_fence_rowtype,
            (select typarray
             from pg_type
             where oid = v_fence_rowtype)
          )
     )
     or exists (
       select 1
       from pg_opfamily o
       join pg_namespace n on n.oid = o.opfnamespace
       where n.nspname ~* v_object_pattern
          or o.opfname ~* v_object_pattern
     )
     or exists (
       select 1
       from pg_attribute a
       where a.attrelid = 'public.mirror_outbox'::regclass
         and a.attnum > 0
         and not a.attisdropped
          and (
            a.attname ~* v_object_pattern
            or a.attname in ('authority_generation', 'f27_drill_rollback_id')
          )
          and not (
            v_entry_state = 'retained_post_rollback'
            and a.attname in ('authority_generation', 'f27_drill_rollback_id')
          )
     )
     or exists (
       select 1
       from pg_constraint c
       where c.conrelid = 'public.mirror_outbox'::regclass
          and (
            c.conname ~* v_object_pattern
            or pg_get_constraintdef(c.oid, true) ~* v_object_pattern
          )
          and not (
            v_entry_state = 'retained_post_rollback'
            and c.conname in (
              'mirror_outbox_f27_drill_rollback_id_fkey',
              'mirror_outbox_f27_generation_check',
              'mirror_outbox_f27_drill_scope_check'
            )
          )
     )
     or exists (
       select 1
        from pg_index i
        where i.indrelid = 'public.mirror_outbox'::regclass
          and pg_get_indexdef(i.indexrelid) ~* v_object_pattern
          and not (
            v_entry_state = 'retained_post_rollback'
            and i.indexrelid = to_regclass('public.mirror_outbox_one_f27_drill_row_idx')
          )
     )
     or exists (
       select 1
       from pg_trigger t
       where t.tgrelid = 'public.mirror_outbox'::regclass
         and not t.tgisinternal
          and (
            t.tgname ~* v_object_pattern
            or pg_get_triggerdef(t.oid, true) ~* v_object_pattern
          )
          and not (
            v_entry_state = 'retained_post_rollback'
            and t.tgname = 'track_b_f27_hold_guard'
          )
     )
     or exists (
       select 1
       from pg_rewrite r
       where r.ev_class = 'public.mirror_outbox'::regclass
         and (
           r.rulename ~* v_object_pattern
           or pg_get_ruledef(r.oid, true) ~* v_object_pattern
         )
     )
     or exists (
       select 1
       from pg_policy p
       where p.polrelid = 'public.mirror_outbox'::regclass
         and (
           p.polname ~* v_object_pattern
           or coalesce(pg_get_expr(p.polqual, p.polrelid, true), '')
              ~* v_object_pattern
           or coalesce(pg_get_expr(p.polwithcheck, p.polrelid, true), '')
              ~* v_object_pattern
         )
     ) then
    raise exception 'F27_PREINSTALL_GATE_UNEXPECTED_F27_OBJECT';
  end if;
  -- F27_RETAINED_DIAGNOSTIC_PREDICATE_END unexpected_f27_objects

  raise notice 'F27_PREINSTALL_EXACT_SUBSET_GATE_PASS';
end
$f27_preinstall_gate$;
-- F27_PREINSTALL_EXACT_SUBSET_GATE_END

create table if not exists public.track_b_f27_team_fences (
  team text primary key check (team in ('video', 'graphics')),
  generation bigint not null default 0 check (generation >= 0),
  updated_at timestamptz not null default now(),
  updated_by text not null
);

insert into public.track_b_f27_team_fences (team, generation, updated_by)
values ('video', 0, 'f27-migration'), ('graphics', 0, 'f27-migration')
on conflict (team) do nothing;

create table if not exists public.track_b_team_rollbacks (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null unique default gen_random_uuid(),
  team text not null,
  is_drill boolean not null default false,
  state text not null default 'open' check (state in ('open', 'complete', 'cancelled')),
  expected_authority jsonb not null,
  prior_outbound jsonb not null,
  prior_parity jsonb not null,
  fence_generation bigint check (fence_generation >= 0),
  snapshot_count integer not null default 0 check (snapshot_count >= 0),
  snapshot_sha256 text,
  terminal_receipt jsonb,
  actor text not null,
  opened_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint track_b_team_rollbacks_scope_check check (
    (is_drill = false and team in ('video', 'graphics') and fence_generation is not null)
    or (is_drill = true and team = '__f27_drill__' and fence_generation is null)
  )
);

create unique index if not exists track_b_team_rollbacks_one_open_team_idx
  on public.track_b_team_rollbacks (team)
  where state = 'open';

create table if not exists public.track_b_team_rollback_intents (
  rollback_id uuid not null references public.track_b_team_rollbacks(id),
  outbox_id bigint not null references public.mirror_outbox(id),
  row_snapshot jsonb not null,
  row_sha256 text not null,
  classification text check (classification in (
    'replay', 'quarantine', 'discard', 'already_reflected'
  )),
  classification_history jsonb not null default '[]'::jsonb,
  reason text,
  classified_by text,
  classified_at timestamptz,
  terminal_receipt jsonb,
  primary key (rollback_id, outbox_id)
);

alter table public.mirror_outbox
  add column if not exists authority_generation bigint not null default 0,
  add column if not exists f27_drill_rollback_id uuid
    references public.track_b_team_rollbacks(id);

do $block$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mirror_outbox'::regclass
      and conname = 'mirror_outbox_f27_generation_check'
  ) then
    alter table public.mirror_outbox
      add constraint mirror_outbox_f27_generation_check
      check (authority_generation >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mirror_outbox'::regclass
      and conname = 'mirror_outbox_f27_drill_scope_check'
  ) then
    alter table public.mirror_outbox
      add constraint mirror_outbox_f27_drill_scope_check
      check (
        (team <> '__f27_drill__' and f27_drill_rollback_id is null)
        or (
          team = '__f27_drill__'
          and client_slug = '__f27_drill__'
          and entity = 'deliverable'
          and operation = 'status'
          and test_only = true
          and legacy_parity = false
          and depends_on_id is null
          and authority_generation = 0
          and f27_drill_rollback_id is not null
          and payload->>'f27_drill' = 'true'
        )
      );
  end if;
end
$block$;

create unique index if not exists mirror_outbox_one_f27_drill_row_idx
  on public.mirror_outbox (f27_drill_rollback_id)
  where f27_drill_rollback_id is not null;

-- Keep the public enqueue signature stable. Exact-source writers carry the
-- generation/lane binder inside two reserved payload keys; this helper strips
-- those keys before persistence and writes the trusted columns atomically so
-- the BEFORE INSERT fence never mistakes parity for a native write.
create or replace function public.mirror_outbox_enqueue(
  p_entity text,
  p_entity_id text,
  p_operation text,
  p_payload jsonb,
  p_dedup_key text,
  p_source_edited_at timestamptz,
  p_client_slug text,
  p_team text,
  p_actor text default null,
  p_role text default null,
  p_deliverable_id text default null,
  p_batch_id text default null,
  p_comment_id text default null,
  p_depends_on_id bigint default null,
  p_test_only boolean default false
) returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id bigint;
  v_legacy_op text;
  v_raw_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_payload jsonb;
  v_generation bigint;
  v_legacy_parity boolean;
begin
  if coalesce(p_entity, '') not in ('deliverable', 'batch', 'comment') then
    raise exception 'invalid outbound entity';
  end if;
  if coalesce(p_operation, '') not in (
    'create', 'status', 'comment', 'due', 'assignee', 'title',
    'priority', 'parent', 'archive', 'restore', 'labels', 'description', 'attachment'
  ) then
    raise exception 'invalid outbound operation';
  end if;
  if nullif(btrim(coalesce(p_entity_id, '')), '') is null
     or nullif(btrim(coalesce(p_dedup_key, '')), '') is null
     or nullif(btrim(coalesce(p_client_slug, '')), '') is null
     or nullif(btrim(coalesce(p_team, '')), '') is null
     or p_source_edited_at is null then
    raise exception 'incomplete outbound intent';
  end if;

  begin
    v_generation := nullif(v_raw_payload->>'_f27_authority_generation', '')::bigint;
    v_legacy_parity := coalesce((v_raw_payload->>'_f27_legacy_parity')::boolean, false);
  exception when others then
    raise exception 'invalid f27 authority binder';
  end;
  v_payload := v_raw_payload
    - '_f27_authority_generation'
    - '_f27_legacy_parity';

  v_legacy_op := case p_operation
    when 'create' then 'create'
    when 'status' then 'update_state'
    when 'comment' then 'comment'
    when 'archive' then 'archive'
    else 'update_fields'
  end;

  -- Preserve the old idempotent return contract without firing a stale
  -- generation trigger for an intent that already exists.
  perform pg_advisory_xact_lock(hashtextextended(p_dedup_key, 0));
  select id into v_id from public.mirror_outbox where dedup_key = p_dedup_key;
  if found then return v_id; end if;

  insert into public.mirror_outbox (
    deliverable_id, op, payload, attempts, created_at, next_retry_at,
    entity, entity_id, batch_id, comment_id, operation, client_slug, team,
    dedup_key, source_edited_at, status, actor, role, depends_on_id,
    updated_at, test_only, authority_generation, legacy_parity
  ) values (
    p_deliverable_id, v_legacy_op, v_payload, 0, now(), now(),
    p_entity, p_entity_id, p_batch_id, p_comment_id, p_operation,
    p_client_slug, p_team, p_dedup_key, p_source_edited_at, 'pending',
    nullif(btrim(coalesce(p_actor, '')), ''),
    nullif(btrim(coalesce(p_role, '')), ''),
    p_depends_on_id, now(), coalesce(p_test_only, false),
    coalesce(v_generation, -1), v_legacy_parity
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

do $f27_adopt_write_authorization$
begin
  if to_regprocedure('public.track_b_f27_write_authorization(text)') is null then
    execute $f27_create_write_authorization$
create or replace function public.track_b_f27_write_authorization(p_team text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare
  v_team text := lower(nullif(btrim(coalesce(p_team, '')), ''));
  v_generation bigint;
  v_authority jsonb;
begin
  if v_team not in ('video', 'graphics') then
    raise exception 'f27_invalid_write_team';
  end if;
  select generation into v_generation
  from public.track_b_f27_team_fences where team = v_team;
  select value into v_authority
  from public.syncview_runtime_flags where key = 'prod_authority';
  if v_generation is null or jsonb_typeof(v_authority) is distinct from 'object'
     or lower(coalesce(v_authority->>v_team, '')) not in ('linear', 'syncview') then
    raise exception 'f27_write_authorization_unavailable';
  end if;
  return jsonb_build_object(
    'ok', true,
    'type', 'f27_write_authorization',
    'team', v_team,
    'authority', lower(v_authority->>v_team),
    'generation', v_generation
  );
end;
$fn$;
$f27_create_write_authorization$;
  end if;
end
$f27_adopt_write_authorization$;

-- Reconciler reactivation is a new authorization event, not permission to
-- reuse the generation captured by the old intent. Update the generation and
-- status in one statement so the BEFORE trigger validates the fresh binder.
do $f27_adopt_requeue$
begin
  if to_regprocedure('public.track_b_f27_requeue(bigint,bigint)') is null then
    execute $f27_create_requeue$
create or replace function public.track_b_f27_requeue(
  p_id bigint,
  p_authority_generation bigint
) returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer;
begin
  if p_authority_generation is null or p_authority_generation < 0 then
    raise exception 'f27_requeue_authorization_required';
  end if;
  update public.mirror_outbox
  set status = 'pending',
      attempts = 0,
      last_error = null,
      processed_at = null,
      next_retry_at = now(),
      lock_token = null,
      locked_at = null,
      updated_at = now(),
      authority_generation = p_authority_generation,
      legacy_parity = false
  where id = p_id
    and team in ('video', 'graphics')
    and operation = 'comment'
    and f27_drill_rollback_id is null
    and status in ('written', 'skipped', 'failed', 'stale');
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$fn$;
$f27_create_requeue$;
  end if;
end
$f27_adopt_requeue$;

do $f27_adopt_hold_guard$
begin
  if to_regprocedure('public.track_b_f27_hold_guard()') is null then
    execute $f27_create_hold_guard$
create or replace function public.track_b_f27_hold_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_team text := lower(coalesce(new.team, ''));
  v_generation bigint;
  v_authority jsonb;
  v_parity jsonb;
begin
  if current_setting('app.f27_rollback_bypass', true) = '1' then
    return new;
  end if;

  if v_team = '__f27_drill__' and tg_op = 'INSERT' then
    raise exception 'f27_drill_insert_forbidden';
  end if;

  if new.status in ('pending', 'failed', 'shadow_ok')
     and exists (
       select 1 from public.track_b_team_rollbacks r
       where r.team = v_team and r.state = 'open'
     ) then
    raise exception 'team_rollback_hold:%', v_team;
  end if;

  if new.status in ('pending', 'failed', 'shadow_ok')
     and v_team in ('video', 'graphics') then
    select value into v_authority
    from public.syncview_runtime_flags
    where key = 'prod_authority'
    for share;
    select value into v_parity
    from public.syncview_runtime_flags
    where key = 'linear_legacy_parity_enabled'
    for share;
    select generation into v_generation
    from public.track_b_f27_team_fences
    where team = v_team
    for share;

    if new.authority_generation is distinct from v_generation then
      raise exception 'f27_authority_generation_stale:%', v_team;
    end if;
    if new.test_only = true then
      return new;
    elsif new.legacy_parity = true then
      if lower(coalesce(v_authority->>v_team, '')) <> 'linear'
         or v_parity is distinct from '{"enabled":true}'::jsonb then
        raise exception 'legacy_parity_gate_unavailable';
      end if;
    elsif lower(coalesce(v_authority->>v_team, '')) <> 'syncview' then
      raise exception 'team_is_linear_authoritative';
    end if;
  end if;
  return new;
end;
$fn$;
$f27_create_hold_guard$;
  end if;
end
$f27_adopt_hold_guard$;

do $f27_adopt_hold_trigger$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.mirror_outbox'::regclass
      and tgname = 'track_b_f27_hold_guard'
      and not tgisinternal
  ) then
    execute $f27_create_hold_trigger$
create trigger track_b_f27_hold_guard
  before insert or update of status, team, authority_generation,
    legacy_parity, test_only, f27_drill_rollback_id
  on public.mirror_outbox
  for each row execute function public.track_b_f27_hold_guard();
$f27_create_hold_trigger$;
  else
    alter table public.mirror_outbox enable trigger track_b_f27_hold_guard;
  end if;
end
$f27_adopt_hold_trigger$;

-- Existing production RPCs take an authority row lock before their event
-- trigger reaches mirror_outbox. F27 finalization takes the outbox table first;
-- align the writer order to table -> flags -> fence so neither side can hold
-- one resource while waiting on the other.
create or replace function public.production_assert_authority(
  p_client_slug text,
  p_team text,
  p_test_only boolean,
  p_legacy_parity boolean
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_value jsonb;
  v_parity_value jsonb;
  v_authority text;
  v_test_ok boolean;
begin
  lock table public.mirror_outbox in row exclusive mode;
  if p_test_only then
    select exists(
      select 1 from public.clients c
      where c.slug = p_client_slug and c.active = true and c.kind = 'test'
    ) into v_test_ok;
    if not v_test_ok then raise exception 'test_client_scope_required'; end if;
    return;
  end if;
  if p_team is null or p_team not in ('video', 'graphics') then
    raise exception 'authority_unavailable';
  end if;
  if p_legacy_parity then
    select f.value into v_parity_value
    from public.syncview_runtime_flags f
    where f.key = 'linear_legacy_parity_enabled'
    for share;
    if not found
       or jsonb_typeof(v_parity_value) <> 'object'
       or v_parity_value->'enabled' is distinct from 'true'::jsonb then
      raise exception 'legacy_parity_gate_unavailable';
    end if;
  end if;
  select f.value into v_value
  from public.syncview_runtime_flags f
  where f.key = 'prod_authority'
  for share;
  if not found or jsonb_typeof(v_value) <> 'object' then
    raise exception 'authority_unavailable';
  end if;
  v_authority := lower(nullif(v_value->>p_team, ''));
  if p_legacy_parity and v_authority is distinct from 'linear' then
    raise exception 'legacy_parity_not_allowed';
  elsif not p_legacy_parity and v_authority is distinct from 'syncview' then
    raise exception 'team_is_linear_authoritative';
  end if;
end;
$fn$;

do $f27_adopt_begin$
begin
  if to_regprocedure('public.track_b_f27_begin(text,jsonb,text)') is null then
    execute $f27_create_begin$
create or replace function public.track_b_f27_begin(
  p_team text,
  p_expected_authority jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_team text := lower(nullif(btrim(coalesce(p_team, '')), ''));
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_authority jsonb;
  v_outbound jsonb;
  v_parity jsonb;
  v_rollback public.track_b_team_rollbacks%rowtype;
  v_count integer;
  v_inflight integer;
  v_hash text;
  v_fence_generation bigint;
begin
  if v_team not in ('video', 'graphics') or v_actor is null then
    raise exception 'f27_invalid_scope';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('track-b-f27:' || v_team, 0));
  lock table public.mirror_outbox in share row exclusive mode;

  select value into v_authority from public.syncview_runtime_flags
    where key = 'prod_authority' for update;
  select value into v_outbound from public.syncview_runtime_flags
    where key = 'linear_outbound_enabled' for update;
  select value into v_parity from public.syncview_runtime_flags
    where key = 'linear_legacy_parity_enabled' for update;
  select generation into v_fence_generation
  from public.track_b_f27_team_fences
  where team = v_team
  for update;

  if v_authority is distinct from p_expected_authority
     or v_authority->>v_team is distinct from 'syncview' then
    raise exception 'f27_authority_cas_refused';
  end if;
  if v_outbound is distinct from '{"mode":"off"}'::jsonb
     or v_parity is distinct from '{"enabled":false}'::jsonb then
    raise exception 'f27_emergency_stops_required';
  end if;
  if v_fence_generation is null then
    raise exception 'f27_team_fence_required';
  end if;

  -- F2/F4 stop new scans, but a stateless drainer may already hold a row and
  -- have passed its control read. Never clear that lease: wait for the worker
  -- to checkpoint/release, or investigate an expired lease, then begin again.
  select count(*) into v_inflight
  from public.mirror_outbox o
  where lower(o.team) = v_team
    and o.status in ('pending', 'failed', 'shadow_ok')
    and (o.lock_token is not null or o.locked_at is not null);
  if v_inflight <> 0 then
    raise exception 'f27_inflight_rows:%', v_inflight;
  end if;

  insert into public.track_b_team_rollbacks (
    team, is_drill, expected_authority, prior_outbound, prior_parity,
    fence_generation, actor
  ) values (
    v_team, false, v_authority, v_outbound, v_parity,
    v_fence_generation, v_actor
  )
  returning * into v_rollback;

  insert into public.track_b_team_rollback_intents (
    rollback_id, outbox_id, row_snapshot, row_sha256
  )
  select
    v_rollback.id,
    o.id,
    to_jsonb(o),
    encode(extensions.digest(convert_to(to_jsonb(o)::text, 'UTF8'), 'sha256'), 'hex')
  from public.mirror_outbox o
  where lower(o.team) = v_team
    and o.status in ('pending', 'failed', 'shadow_ok')
  order by o.id;
  get diagnostics v_count = row_count;

  select encode(
    extensions.digest(convert_to(coalesce(string_agg(i.row_sha256, '' order by i.outbox_id), ''), 'UTF8'), 'sha256'),
    'hex'
  ) into v_hash
  from public.track_b_team_rollback_intents i
  where i.rollback_id = v_rollback.id;

  perform set_config('app.f27_rollback_bypass', '1', true);
  update public.mirror_outbox o
  set status = 'skipped',
      last_error = 'F27 hold ' || v_rollback.correlation_id::text,
      next_retry_at = null,
      updated_at = now()
  where lower(o.team) = v_team
    and o.status in ('pending', 'failed', 'shadow_ok');

  update public.track_b_team_rollbacks
  set snapshot_count = v_count, snapshot_sha256 = v_hash
  where id = v_rollback.id;

  return jsonb_build_object(
    'ok', true,
    'type', 'f27_snapshot_terminal',
    'rollback_id', v_rollback.id,
    'correlation_id', v_rollback.correlation_id,
    'team', v_team,
    'fence_generation', v_fence_generation,
    'snapshot_count', v_count,
    'snapshot_sha256', v_hash,
    'normal_outbound', v_outbound,
    'legacy_parity', v_parity
  );
end;
$fn$;
$f27_create_begin$;
  end if;
end
$f27_adopt_begin$;

do $f27_adopt_begin_drill$
begin
  if to_regprocedure('public.track_b_f27_begin_drill(jsonb,text)') is null then
    execute $f27_create_begin_drill$
create or replace function public.track_b_f27_begin_drill(
  p_expected_authority jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_authority jsonb;
  v_outbound jsonb;
  v_parity jsonb;
  v_rollback public.track_b_team_rollbacks%rowtype;
  v_outbox_id bigint;
  v_row_hash text;
  v_hash text;
begin
  if v_actor is null then raise exception 'f27_actor_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('track-b-f27:__f27_drill__', 0));

  -- One statement snapshot, no real-team row/table lock. A drill is available
  -- only in the dormant live posture and cannot manufacture SyncView authority.
  select
    (select value from public.syncview_runtime_flags where key = 'prod_authority'),
    (select value from public.syncview_runtime_flags where key = 'linear_outbound_enabled'),
    (select value from public.syncview_runtime_flags where key = 'linear_legacy_parity_enabled')
  into v_authority, v_outbound, v_parity;

  if v_authority is distinct from p_expected_authority
     or v_authority is distinct from '{"video":"linear","graphics":"linear"}'::jsonb then
    raise exception 'f27_drill_authority_cas_refused';
  end if;
  if v_outbound is distinct from '{"mode":"off"}'::jsonb
     or v_parity is distinct from '{"enabled":false}'::jsonb then
    raise exception 'f27_emergency_stops_required';
  end if;

  insert into public.track_b_team_rollbacks (
    team, is_drill, expected_authority, prior_outbound, prior_parity,
    fence_generation, actor
  ) values (
    '__f27_drill__', true, v_authority, v_outbound, v_parity,
    null, v_actor
  ) returning * into v_rollback;

  perform set_config('app.f27_rollback_bypass', '1', true);
  insert into public.mirror_outbox (
    deliverable_id, op, payload, attempts, created_at, next_retry_at,
    entity, entity_id, operation, client_slug, team, dedup_key,
    source_edited_at, status, actor, role, updated_at, test_only,
    legacy_parity, authority_generation, f27_drill_rollback_id
  ) values (
    null, 'update_state', '{"f27_drill":true,"value":"noop"}'::jsonb,
    0, now(), now(), 'deliverable', 'f27-drill:' || v_rollback.id::text,
    'status', '__f27_drill__', '__f27_drill__',
    'f27-drill:' || v_rollback.id::text, now(), 'pending',
    'F27 drill', 'system', now(), true, false, 0, v_rollback.id
  ) returning id into v_outbox_id;

  insert into public.track_b_team_rollback_intents (
    rollback_id, outbox_id, row_snapshot, row_sha256
  )
  select
    v_rollback.id,
    o.id,
    to_jsonb(o),
    encode(extensions.digest(convert_to(to_jsonb(o)::text, 'UTF8'), 'sha256'), 'hex')
  from public.mirror_outbox o
  where o.id = v_outbox_id
    and o.f27_drill_rollback_id = v_rollback.id
  returning row_sha256 into v_row_hash;

  -- Exercise the exact real-rollback aggregate algorithm even though the
  -- reserved drill has one row: hash the ordered row-hash stream separately
  -- from the immutable row hash itself.
  select encode(
    extensions.digest(convert_to(coalesce(string_agg(i.row_sha256, '' order by i.outbox_id), ''), 'UTF8'), 'sha256'),
    'hex'
  ) into v_hash
  from public.track_b_team_rollback_intents i
  where i.rollback_id = v_rollback.id;

  update public.mirror_outbox
  set status = 'skipped',
      last_error = 'F27 drill hold ' || v_rollback.correlation_id::text,
      next_retry_at = null,
      updated_at = now()
  where id = v_outbox_id and f27_drill_rollback_id = v_rollback.id;

  update public.track_b_team_rollbacks
  set snapshot_count = 1, snapshot_sha256 = v_hash
  where id = v_rollback.id and is_drill = true;

  return jsonb_build_object(
    'ok', true,
    'type', 'f27_drill_snapshot_terminal',
    'rollback_id', v_rollback.id,
    'correlation_id', v_rollback.correlation_id,
    'team', '__f27_drill__',
    'is_drill', true,
    'outbox_id', v_outbox_id,
    'snapshot_count', 1,
    'row_sha256', v_row_hash,
    'snapshot_sha256', v_hash,
    'normal_outbound', v_outbound,
    'legacy_parity', v_parity,
    'authority', v_authority
  );
end;
$fn$;
$f27_create_begin_drill$;
  end if;
end
$f27_adopt_begin_drill$;

do $f27_adopt_classify$
begin
  if to_regprocedure('public.track_b_f27_classify(uuid,bigint,text,text,text,jsonb)') is null then
    execute $f27_create_classify$
create or replace function public.track_b_f27_classify(
  p_rollback_id uuid,
  p_outbox_id bigint,
  p_classification text,
  p_reason text,
  p_actor text,
  p_reflected_receipt jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_kind text := lower(nullif(btrim(coalesce(p_classification, '')), ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_team text;
  v_correlation_id uuid;
  v_row_sha256 text;
  v_dedup_key text;
  v_operation text;
  v_is_drill boolean;
  v_count integer;
begin
  if v_kind not in ('replay', 'quarantine', 'discard', 'already_reflected')
     or v_reason is null or v_actor is null then
    raise exception 'f27_classification_incomplete';
  end if;
  -- Match finalization's table -> rollback-row order. Without this explicit
  -- table lock, classify could hold the rollback row while finalize held the
  -- outbox table and each would wait for the other.
  lock table public.mirror_outbox in row exclusive mode;
  select r.team, r.correlation_id, i.row_sha256, o.dedup_key, o.operation, r.is_drill
  into v_team, v_correlation_id, v_row_sha256, v_dedup_key, v_operation, v_is_drill
  from public.track_b_team_rollbacks r
  join public.track_b_team_rollback_intents i
    on i.rollback_id = r.id and i.outbox_id = p_outbox_id
  join public.mirror_outbox o on o.id = i.outbox_id
  where r.id = p_rollback_id and r.state = 'open'
  for update of r;
  if not found then raise exception 'f27_open_rollback_required'; end if;
  if v_is_drill and v_kind <> 'replay' then
    raise exception 'f27_drill_replay_classification_required';
  end if;
  if v_kind = 'already_reflected'
     and (
       p_reflected_receipt->>'ok' is distinct from 'true'
       or p_reflected_receipt->>'type' is distinct from 'f27_already_reflected_terminal'
       or p_reflected_receipt->>'rollback_id' is distinct from p_rollback_id::text
       or p_reflected_receipt->>'outbox_id' is distinct from p_outbox_id::text
       or p_reflected_receipt->>'correlation_id' is distinct from v_correlation_id::text
       or p_reflected_receipt->>'intent_snapshot_sha256' is distinct from v_row_sha256
       or p_reflected_receipt->>'dedup_key' is distinct from v_dedup_key
       or p_reflected_receipt->>'operation' is distinct from v_operation
       or coalesce(p_reflected_receipt->>'issue_id', '') = ''
       or jsonb_typeof(p_reflected_receipt->'observed_result') is distinct from 'object'
       or p_reflected_receipt->>'observed_result_sha256' is distinct from encode(
         extensions.digest(
           convert_to((p_reflected_receipt->'observed_result')::text, 'UTF8'),
           'sha256'
         ),
         'hex'
       )
     ) then
    raise exception 'f27_reflected_receipt_required';
  end if;

  update public.track_b_team_rollback_intents i
  set classification = v_kind, reason = v_reason,
      classified_by = v_actor, classified_at = now(),
      terminal_receipt = case
        when v_kind = 'already_reflected' then p_reflected_receipt
        else i.terminal_receipt
      end,
      classification_history = i.classification_history || jsonb_build_array(
        jsonb_build_object(
          'from', i.classification,
          'to', v_kind,
          'reason', v_reason,
          'actor', v_actor,
          'at', now()
        )
      )
  where i.rollback_id = p_rollback_id and i.outbox_id = p_outbox_id
    and (
      i.classification is null
      or (
        i.classification = 'replay'
        and v_kind in ('quarantine', 'discard', 'already_reflected')
        and i.terminal_receipt is null
        and exists (
          select 1 from public.mirror_outbox o
          where o.id = i.outbox_id
            and lower(o.team) = v_team
            and o.status = 'skipped'
            and o.lock_token is null
            and o.locked_at is null
        )
      )
    );
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'f27_intent_classification_cas_refused'; end if;

  perform set_config('app.f27_rollback_bypass', '1', true);
  if v_kind = 'replay' then
    update public.mirror_outbox
    set attempts = 0, last_error = 'F27 approved replay pending',
        processed_at = null, next_retry_at = now(),
        lock_token = null, locked_at = null, updated_at = now()
    where id = p_outbox_id and lower(team) = v_team and status = 'skipped';
  elsif v_kind = 'already_reflected' then
    update public.mirror_outbox
    set status = 'written', processed_at = now(), next_retry_at = null,
        linear_result = p_reflected_receipt,
        last_error = 'F27 already_reflected: ' || v_reason,
        lock_token = null, locked_at = null, updated_at = now()
    where id = p_outbox_id and lower(team) = v_team and status = 'skipped';
  elsif v_kind = 'discard' then
    update public.mirror_outbox
    set status = 'skipped', processed_at = now(), next_retry_at = null,
        last_error = 'F27 ' || v_kind || ': ' || v_reason,
        lock_token = null, locked_at = null, updated_at = now()
    where id = p_outbox_id and lower(team) = v_team and status = 'skipped';
  end if;

  return jsonb_build_object(
    'ok', true, 'type', 'f27_classification_terminal',
    'rollback_id', p_rollback_id, 'outbox_id', p_outbox_id,
    'classification', v_kind
  );
end;
$fn$;
$f27_create_classify$;
  end if;
end
$f27_adopt_classify$;

do $f27_adopt_execute_drill_replay$
begin
  if to_regprocedure('public.track_b_f27_execute_drill_replay(uuid,bigint,uuid)') is null then
    execute $f27_create_execute_drill_replay$
create or replace function public.track_b_f27_execute_drill_replay(
  p_rollback_id uuid,
  p_outbox_id bigint,
  p_lock_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_authority jsonb;
  v_outbound jsonb;
  v_parity jsonb;
  v_correlation_id uuid;
  v_dedup_key text;
  v_operation text;
  v_row_sha256 text;
  v_result jsonb;
  v_receipt jsonb;
  v_updated integer;
begin
  if p_lock_token is null then raise exception 'f27_drill_claim_required'; end if;

  select r.correlation_id, o.dedup_key, o.operation, i.row_sha256
  into v_correlation_id, v_dedup_key, v_operation, v_row_sha256
  from public.track_b_team_rollbacks r
  join public.track_b_team_rollback_intents i
    on i.rollback_id = r.id and i.outbox_id = p_outbox_id
  join public.mirror_outbox o
    on o.id = i.outbox_id and o.f27_drill_rollback_id = r.id
  where r.id = p_rollback_id
    and r.state = 'open'
    and r.is_drill = true
    and r.team = '__f27_drill__'
    and i.classification = 'replay'
    and i.terminal_receipt is null
    and o.team = '__f27_drill__'
    and o.client_slug = '__f27_drill__'
    and o.test_only = true
    and o.legacy_parity = false
    and o.authority_generation = 0
    and o.status = 'skipped'
    and o.lock_token = p_lock_token
    and o.dedup_key = 'f27-drill:' || p_rollback_id::text
  for update of r, i, o;
  if not found then raise exception 'f27_drill_replay_refused'; end if;

  select
    (select value from public.syncview_runtime_flags where key = 'prod_authority'),
    (select value from public.syncview_runtime_flags where key = 'linear_outbound_enabled'),
    (select value from public.syncview_runtime_flags where key = 'linear_legacy_parity_enabled')
  into v_authority, v_outbound, v_parity;
  if v_authority is distinct from '{"video":"linear","graphics":"linear"}'::jsonb then
    raise exception 'f27_drill_authority_cas_refused';
  end if;
  if v_outbound is distinct from '{"mode":"off"}'::jsonb
     or v_parity is distinct from '{"enabled":false}'::jsonb then
    raise exception 'f27_emergency_stops_required';
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'type', 'f27_drill_replay_terminal',
    'f27_drill', true,
    'f27_preflight', true,
    'no_external_call', true,
    'mutation', 'f27DrillNoop',
    'issue_id', '__f27_drill__:' || p_rollback_id::text,
    'expected', jsonb_build_object(
      'input', jsonb_build_object('stateId', '__f27_drill__')
    ),
    'rollback_id', p_rollback_id,
    'correlation_id', v_correlation_id,
    'outbox_id', p_outbox_id,
    'dedup_key', v_dedup_key,
    'operation', v_operation,
    'intent_snapshot_sha256', v_row_sha256
  );

  update public.mirror_outbox
  set status = 'written',
      linear_result = v_result,
      processed_at = now(),
      next_retry_at = null,
      last_error = null,
      lock_token = null,
      locked_at = null,
      updated_at = now()
  where id = p_outbox_id
    and f27_drill_rollback_id = p_rollback_id
    and status = 'skipped'
    and lock_token = p_lock_token;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'f27_drill_replay_cas_refused'; end if;
  -- Return the exact recordable replay receipt. `linear_result` deliberately
  -- remains the unhashed mutation result so its stable hash is not recursive.
  v_receipt := v_result || jsonb_build_object(
    'linear_result_sha256', encode(
      extensions.digest(convert_to(v_result::text, 'UTF8'), 'sha256'), 'hex'
    )
  );
  update public.track_b_team_rollback_intents
  set terminal_receipt = v_receipt
  where rollback_id = p_rollback_id
    and outbox_id = p_outbox_id
    and classification = 'replay'
    and terminal_receipt is null;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'f27_drill_terminal_receipt_cas_refused'; end if;
  return v_receipt;
end;
$fn$;
$f27_create_execute_drill_replay$;
  end if;
end
$f27_adopt_execute_drill_replay$;

do $f27_adopt_record_terminal$
begin
  if to_regprocedure('public.track_b_f27_record_terminal(uuid,bigint,jsonb)') is null then
    execute $f27_create_record_terminal$
create or replace function public.track_b_f27_record_terminal(
  p_rollback_id uuid,
  p_outbox_id bigint,
  p_receipt jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer;
begin
  if coalesce(p_receipt->>'correlation_id', '') = ''
     or p_receipt->>'ok' is distinct from 'true'
     or p_receipt->>'rollback_id' is distinct from p_rollback_id::text
     or p_receipt->>'outbox_id' is distinct from p_outbox_id::text then
    raise exception 'f27_correlated_terminal_receipt_required';
  end if;
  -- Drill execution records its server-built hash receipt atomically with the
  -- synthetic outbox terminal. Re-presenting that exact receipt is an
  -- idempotent readback, so a lost HTTP response can never strand the drill.
  if exists (
    select 1
    from public.track_b_team_rollback_intents i
    join public.track_b_team_rollbacks r on r.id = i.rollback_id
    where i.rollback_id = p_rollback_id
      and i.outbox_id = p_outbox_id
      and r.is_drill = true
      and i.terminal_receipt = p_receipt
  ) then
    return jsonb_build_object(
      'ok', true, 'type', 'f27_replay_terminal',
      'rollback_id', p_rollback_id, 'outbox_id', p_outbox_id,
      'correlation_id', p_receipt->>'correlation_id',
      'is_drill', true, 'idempotent', true
    );
  end if;
  update public.track_b_team_rollback_intents i
  set terminal_receipt = p_receipt
  from public.track_b_team_rollbacks r, public.mirror_outbox o
  where i.rollback_id = p_rollback_id and i.outbox_id = p_outbox_id
    and r.id = i.rollback_id and r.state = 'open'
    and o.id = i.outbox_id
    and p_receipt->>'type' is not distinct from case
      when r.is_drill then 'f27_drill_replay_terminal'
      else 'linear_write_terminal'
    end
    and (r.is_drill = false or o.f27_drill_rollback_id = r.id)
    and (r.is_drill = false or o.linear_result->>'type' = 'f27_drill_replay_terminal')
    and i.classification = 'replay'
    and i.terminal_receipt is null
    and o.status = 'written'
    and o.linear_result is not null
    and p_receipt->>'dedup_key' is not distinct from o.dedup_key
    and p_receipt->>'operation' is not distinct from o.operation
    and p_receipt->>'correlation_id' is not distinct from o.linear_result->>'correlation_id'
    and p_receipt->>'linear_result_sha256' is not distinct from encode(
      extensions.digest(convert_to(o.linear_result::text, 'UTF8'), 'sha256'), 'hex'
    )
    and p_receipt->>'intent_snapshot_sha256' is not distinct from i.row_sha256;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'f27_terminal_receipt_refused'; end if;
  return jsonb_build_object(
    'ok', true, 'type', 'f27_replay_terminal',
    'rollback_id', p_rollback_id, 'outbox_id', p_outbox_id,
    'correlation_id', p_receipt->>'correlation_id',
    'is_drill', p_receipt->>'type' = 'f27_drill_replay_terminal'
  );
end;
$fn$;
$f27_create_record_terminal$;
  end if;
end
$f27_adopt_record_terminal$;

do $f27_adopt_finalize$
begin
  if to_regprocedure('public.track_b_f27_finalize(uuid,jsonb,text)') is null then
    execute $f27_create_finalize$
create or replace function public.track_b_f27_finalize(
  p_rollback_id uuid,
  p_expected_authority jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_case public.track_b_team_rollbacks%rowtype;
  v_is_drill boolean;
  v_authority jsonb;
  v_new_authority jsonb;
  v_outbound jsonb;
  v_parity jsonb;
  v_fence_generation bigint;
  v_unclassified integer;
  v_unreceipted integer;
  v_active integer;
  v_receipt jsonb;
  v_updated integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('track-b-f27-finalize:' || p_rollback_id::text, 0));
  select is_drill into v_is_drill
  from public.track_b_team_rollbacks
  where id = p_rollback_id and state = 'open';
  if not found then raise exception 'f27_open_rollback_required'; end if;
  -- A drill must prove that the real authority CAS refuses without taking the
  -- real-team table/flag/fence lock chain or attempting any authority write.
  if v_is_drill then raise exception 'f27_drill_authority_cas_refused'; end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'f27_actor_required';
  end if;

  -- Global lock order for native writers, begin, and finalize is always:
  -- mirror_outbox table -> runtime flags -> team fence. A writer that passed
  -- Edge authorization either commits before this lock or reaches the trigger
  -- after the generation advances and fails closed.
  lock table public.mirror_outbox in share row exclusive mode;
  select * into v_case from public.track_b_team_rollbacks
    where id = p_rollback_id and state = 'open' and is_drill = false for update;
  if not found then raise exception 'f27_open_rollback_required'; end if;

  select value into v_authority from public.syncview_runtime_flags
    where key = 'prod_authority' for update;
  select value into v_outbound from public.syncview_runtime_flags
    where key = 'linear_outbound_enabled' for update;
  select value into v_parity from public.syncview_runtime_flags
    where key = 'linear_legacy_parity_enabled' for update;
  select generation into v_fence_generation
  from public.track_b_f27_team_fences
  where team = v_case.team
  for update;
  if v_authority is distinct from p_expected_authority
     or v_authority is distinct from v_case.expected_authority then
    raise exception 'f27_authority_cas_refused';
  end if;
  if v_outbound is distinct from '{"mode":"off"}'::jsonb
     or v_parity is distinct from '{"enabled":false}'::jsonb then
    raise exception 'f27_emergency_stops_required';
  end if;
  if v_fence_generation is distinct from v_case.fence_generation then
    raise exception 'f27_authority_generation_cas_refused';
  end if;

  select count(*) into v_unclassified
  from public.track_b_team_rollback_intents
  where rollback_id = p_rollback_id and classification is null;
  select count(*) into v_unreceipted
  from public.track_b_team_rollback_intents
  where rollback_id = p_rollback_id
    and classification = 'replay' and terminal_receipt is null;
  select count(*) into v_active
  from public.mirror_outbox
  where lower(team) = v_case.team
    and status in ('pending', 'failed', 'shadow_ok');
  if v_unclassified <> 0 or v_unreceipted <> 0 or v_active <> 0 then
    raise exception 'f27_team_not_zero: unclassified=%, unreceipted=%, active=%',
      v_unclassified, v_unreceipted, v_active;
  end if;

  v_new_authority := jsonb_set(v_authority, array[v_case.team], '"linear"'::jsonb, false);
  update public.syncview_runtime_flags
  set value = v_new_authority, updated_by = p_actor
  where key = 'prod_authority' and value = p_expected_authority;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'f27_authority_update_refused'; end if;

  update public.track_b_f27_team_fences
  set generation = generation + 1,
      updated_at = now(),
      updated_by = p_actor
  where team = v_case.team and generation = v_case.fence_generation;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'f27_authority_generation_update_refused'; end if;

  v_receipt := jsonb_build_object(
    'ok', true,
    'type', 'f27_rollback_terminal',
    'rollback_id', v_case.id,
    'correlation_id', v_case.correlation_id,
    'team', v_case.team,
    'snapshot_count', v_case.snapshot_count,
    'snapshot_sha256', v_case.snapshot_sha256,
    'unclassified', v_unclassified,
    'unreceipted_replays', v_unreceipted,
    'active_team_rows', v_active,
    'authority_before', v_authority,
    'authority_after', v_new_authority,
    'fence_generation_before', v_case.fence_generation,
    'fence_generation_after', v_case.fence_generation + 1,
    'normal_outbound', v_outbound,
    'legacy_parity', v_parity
  );
  update public.track_b_team_rollbacks
  set state = 'complete', terminal_receipt = v_receipt, completed_at = now()
  where id = p_rollback_id and state = 'open';
  return v_receipt;
end;
$fn$;
$f27_create_finalize$;
  end if;
end
$f27_adopt_finalize$;

do $f27_adopt_finalize_drill$
begin
  if to_regprocedure('public.track_b_f27_finalize_drill(uuid,jsonb,text)') is null then
    execute $f27_create_finalize_drill$
create or replace function public.track_b_f27_finalize_drill(
  p_rollback_id uuid,
  p_expected_authority jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_case public.track_b_team_rollbacks%rowtype;
  v_authority jsonb;
  v_outbound jsonb;
  v_parity jsonb;
  v_unclassified integer;
  v_unreceipted integer;
  v_intent_count integer;
  v_replay_count integer;
  v_exact_terminal integer;
  v_active integer;
  v_receipt jsonb;
  v_updated integer;
begin
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'f27_actor_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('track-b-f27-finalize:' || p_rollback_id::text, 0));
  select * into v_case
  from public.track_b_team_rollbacks
  where id = p_rollback_id
    and state = 'open'
    and is_drill = true
    and team = '__f27_drill__'
  for update;
  if not found then raise exception 'f27_open_drill_required'; end if;

  select
    (select value from public.syncview_runtime_flags where key = 'prod_authority'),
    (select value from public.syncview_runtime_flags where key = 'linear_outbound_enabled'),
    (select value from public.syncview_runtime_flags where key = 'linear_legacy_parity_enabled')
  into v_authority, v_outbound, v_parity;
  if v_authority is distinct from p_expected_authority
     or v_authority is distinct from v_case.expected_authority
     or v_authority is distinct from '{"video":"linear","graphics":"linear"}'::jsonb then
    raise exception 'f27_drill_authority_cas_refused';
  end if;
  if v_outbound is distinct from '{"mode":"off"}'::jsonb
     or v_parity is distinct from '{"enabled":false}'::jsonb then
    raise exception 'f27_emergency_stops_required';
  end if;

  -- Exercise the real finalizer inside this transaction. Its drill guard must
  -- be the reason no authority CAS is attempted; a string in the receipt is
  -- never accepted as proof by itself.
  begin
    perform public.track_b_f27_finalize(
      p_rollback_id,
      p_expected_authority,
      p_actor
    );
    raise exception 'f27_drill_authority_cas_unexpectedly_succeeded';
  exception when others then
    if sqlerrm <> 'f27_drill_authority_cas_refused' then raise; end if;
  end;

  select count(*) into v_intent_count
  from public.track_b_team_rollback_intents
  where rollback_id = p_rollback_id;
  select count(*) into v_unclassified
  from public.track_b_team_rollback_intents
  where rollback_id = p_rollback_id and classification is null;
  select count(*) into v_unreceipted
  from public.track_b_team_rollback_intents
  where rollback_id = p_rollback_id
    and classification = 'replay' and terminal_receipt is null;
  select count(*) into v_replay_count
  from public.track_b_team_rollback_intents
  where rollback_id = p_rollback_id and classification = 'replay';
  select count(*) into v_exact_terminal
  from public.track_b_team_rollback_intents i
  join public.mirror_outbox o on o.id = i.outbox_id
  where i.rollback_id = p_rollback_id
    and i.classification = 'replay'
    and i.terminal_receipt->>'ok' = 'true'
    and i.terminal_receipt->>'type' = 'f27_drill_replay_terminal'
    and i.terminal_receipt->>'rollback_id' = p_rollback_id::text
    and i.terminal_receipt->>'outbox_id' = i.outbox_id::text
    and i.terminal_receipt->>'correlation_id' = v_case.correlation_id::text
    and i.terminal_receipt->>'dedup_key' = o.dedup_key
    and i.terminal_receipt->>'operation' = o.operation
    and i.terminal_receipt->>'intent_snapshot_sha256' = i.row_sha256
    and i.terminal_receipt->>'linear_result_sha256' = encode(
      extensions.digest(convert_to(o.linear_result::text, 'UTF8'), 'sha256'), 'hex'
    )
    and o.f27_drill_rollback_id = p_rollback_id
    and o.team = '__f27_drill__'
    and o.client_slug = '__f27_drill__'
    and o.test_only = true
    and o.legacy_parity = false
    and o.status = 'written'
    and o.linear_result->>'ok' = 'true'
    and o.linear_result->>'type' = 'f27_drill_replay_terminal'
    and o.linear_result->>'f27_drill' = 'true'
    and o.linear_result->>'no_external_call' = 'true'
    and o.linear_result->>'rollback_id' = p_rollback_id::text
    and o.linear_result->>'outbox_id' = i.outbox_id::text
    and o.linear_result->>'correlation_id' = v_case.correlation_id::text
    and o.linear_result->>'intent_snapshot_sha256' = i.row_sha256;
  select count(*) into v_active
  from public.mirror_outbox
  where f27_drill_rollback_id = p_rollback_id
    and team = '__f27_drill__'
    and status in ('pending', 'failed', 'shadow_ok');
  if v_case.snapshot_count <> 1
     or coalesce(v_case.snapshot_sha256, '') = ''
     or v_intent_count <> 1
     or v_replay_count <> 1
     or v_exact_terminal <> 1
     or v_unclassified <> 0
     or v_unreceipted <> 0
     or v_active <> 0 then
    raise exception 'f27_drill_not_zero: unclassified=%, unreceipted=%, active=%',
      v_unclassified, v_unreceipted, v_active;
  end if;

  v_receipt := jsonb_build_object(
    'ok', true,
    'type', 'f27_drill_terminal',
    'rollback_id', v_case.id,
    'correlation_id', v_case.correlation_id,
    'team', v_case.team,
    'is_drill', true,
    'snapshot_count', v_case.snapshot_count,
    'snapshot_sha256', v_case.snapshot_sha256,
    'unclassified', v_unclassified,
    'unreceipted_replays', v_unreceipted,
    'replay_intents', v_replay_count,
    'exact_terminal_replays', v_exact_terminal,
    'active_drill_rows', v_active,
    'authority_before', v_authority,
    'authority_after', v_authority,
    'authority_cas', 'refused',
    'authority_cas_reason', 'f27_drill_authority_cas_refused',
    'normal_outbound', v_outbound,
    'legacy_parity', v_parity,
    'audit_history_retained', true
  );
  update public.track_b_team_rollbacks
  set state = 'complete', terminal_receipt = v_receipt, completed_at = now()
  where id = p_rollback_id and state = 'open' and is_drill = true;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'f27_drill_finalize_cas_refused'; end if;
  return v_receipt;
end;
$fn$;
$f27_create_finalize_drill$;
  end if;
end
$f27_adopt_finalize_drill$;

revoke all on table public.track_b_f27_team_fences from public, anon, authenticated, service_role;
revoke all on table public.track_b_team_rollbacks from public, anon, authenticated, service_role;
revoke all on table public.track_b_team_rollback_intents from public, anon, authenticated, service_role;
grant select on table public.track_b_f27_team_fences to service_role;
grant select on table public.track_b_team_rollbacks to service_role;
grant select on table public.track_b_team_rollback_intents to service_role;
revoke all on function public.track_b_f27_hold_guard()
  from public, anon, authenticated, service_role;
revoke all on function public.track_b_f27_write_authorization(text)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_requeue(bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_begin(text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_begin_drill(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_classify(uuid, bigint, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_execute_drill_replay(uuid, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_record_terminal(uuid, bigint, jsonb)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_finalize(uuid, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_finalize_drill(uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.track_b_f27_write_authorization(text) to service_role;
grant execute on function public.track_b_f27_requeue(bigint, bigint) to service_role;
grant execute on function public.track_b_f27_begin(text, jsonb, text) to service_role;
grant execute on function public.track_b_f27_begin_drill(jsonb, text) to service_role;
grant execute on function public.track_b_f27_classify(uuid, bigint, text, text, text, jsonb) to service_role;
grant execute on function public.track_b_f27_execute_drill_replay(uuid, bigint, uuid) to service_role;
grant execute on function public.track_b_f27_record_terminal(uuid, bigint, jsonb) to service_role;
grant execute on function public.track_b_f27_finalize(uuid, jsonb, text) to service_role;
grant execute on function public.track_b_f27_finalize_drill(uuid, jsonb, text) to service_role;

-- Exact-source install smoke: exercise the new enqueue function and trigger in
-- this migration transaction, then erase only the synthetic TEST row. Any
-- constraint/trigger regression aborts the entire migration before COMMIT.
savepoint f27_enqueue_probe;
select public.mirror_outbox_enqueue(
  'deliverable',
  'f27-migration-test',
  'status',
  jsonb_build_object(
    'status', 'F27 migration TEST',
    '_f27_authority_generation', (
      select generation from public.track_b_f27_team_fences where team = 'video'
    ),
    '_f27_legacy_parity', false
  ),
  'f27-migration-test:' || gen_random_uuid()::text,
  clock_timestamp(),
  'f27-migration-test',
  'video',
  'F27 migration TEST',
  'system',
  null,
  null,
  null,
  null,
  true
);
rollback to savepoint f27_enqueue_probe;
release savepoint f27_enqueue_probe;

commit;

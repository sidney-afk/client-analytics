'use strict';

/*
 * Read-only explainer for the exact post-Section-7 F27 entry contract.
 *
 * The executable predicates are never restated here. They are extracted from
 * the reviewed migration's preinstall gate and executed verbatim inside one
 * REPEATABLE READ, READ ONLY transaction. Only bounded catalog metadata and
 * normalized function-source SHA-256 values may reach the public receipt.
 */

const crypto = require('crypto');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const {
  RETAINED_DIAGNOSTIC_PREDICATE_IDS,
  RETAINED_STATE_FAILURE_ARRAY_CATEGORIES,
  SnapshotCaptureError,
  parseDatabaseUrl,
  publicFailure: snapshotPublicFailure,
  reviewedPreinstallGateSql,
  reviewedPreF27SubsetContract,
  reviewedPostSection7Contract,
  reviewedRetainedDiagnosticContext,
  reviewedRetainedDiagnosticPredicates,
  safePsqlEnvironment,
} = require('./f27-mirror-outbox-snapshot');

const OPERATION = 'retained-state-diagnose';
const SCOPE = 'READ_ONLY_DIAGNOSTIC_ONLY';
const HASH_RE = /^[a-f0-9]{64}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const MAX_PUBLIC_RECEIPT_BYTES = 32 * 1024;

class RetainedStateDiagnosisError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RetainedStateDiagnosisError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new RetainedStateDiagnosisError(code, message);
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((output, key) => {
      output[key] = stableValue(value[key]);
      return output;
    }, {});
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function predicateFailureCode(predicate) {
  const matches = [...predicate.sql.matchAll(/raise exception '(F27_PREINSTALL_GATE_[A-Z0-9_]+)';/g)];
  if (matches.length !== 1) {
    fail('MIGRATION_CONTRACT_INVALID', 'A retained diagnostic predicate did not have one gate terminal.');
  }
  return matches[0][1];
}

function predicateDoSql(predicate, index) {
  const ordinal = String(index + 1).padStart(2, '0');
  const setting = `syncview.f27_retained_diag_${ordinal}`;
  const delimiter = `$f27_retained_diag_${ordinal}$`;
  const context = reviewedRetainedDiagnosticContext();
  const expectedTerminal = predicateFailureCode(predicate);
  return String.raw`DO ${delimiter}
DECLARE
${context.declarations}
  v_diagnostic_error_message text;
BEGIN
${context.setup}
${context.entryState}
  BEGIN
${predicate.sql}
    PERFORM set_config('${setting}', 'PASS', true);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_diagnostic_error_message = MESSAGE_TEXT;
    IF v_diagnostic_error_message IS DISTINCT FROM '${expectedTerminal}' THEN
      RAISE;
    END IF;
    PERFORM set_config('${setting}', 'FAIL', true);
  END;
END
${delimiter};`;
}

function inventorySql() {
  return String.raw`DO $f27_retained_inventory$
DECLARE
  v_state jsonb;
  v_runtime jsonb;
BEGIN
  IF to_regclass('public.track_b_f27_team_fences') IS NOT NULL
     AND to_regclass('public.track_b_team_rollbacks') IS NOT NULL
     AND to_regclass('public.track_b_team_rollback_intents') IS NOT NULL
     AND to_regclass('public.mirror_outbox') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM (VALUES
         (to_regclass('public.track_b_f27_team_fences')),
         (to_regclass('public.track_b_team_rollbacks')),
         (to_regclass('public.track_b_team_rollback_intents')),
         (to_regclass('public.mirror_outbox'))
       ) expected(oid)
       JOIN pg_class c ON c.oid=expected.oid
       WHERE c.relkind IS DISTINCT FROM 'r'
     ) THEN
    BEGIN
      EXECUTE $inventory$
      SELECT jsonb_build_object(
        'state_capture_status', 'exact_columns',
        'fences', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'team', team,
            'generation', generation,
            'updated_by', updated_by
          ) ORDER BY team)
          FROM public.track_b_f27_team_fences
        ), '[]'::jsonb),
        'rollback_count', (SELECT count(*) FROM public.track_b_team_rollbacks),
        'open_rollback_count', (
          SELECT count(*) FROM public.track_b_team_rollbacks WHERE state = 'open'
        ),
        'completed_real_by_team', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'team', team,
              'completed_count', completed_count,
              'distinct_generation_count', distinct_generation_count,
              'min_generation', min_generation,
              'max_generation', max_generation,
              'last_actor', last_actor
            ) ORDER BY team)
            FROM (
              SELECT team, count(*)::bigint completed_count,
                     count(distinct fence_generation)::bigint distinct_generation_count,
                     min(fence_generation) min_generation,
                     max(fence_generation) max_generation,
                     (array_agg(actor ORDER BY fence_generation DESC))[1] last_actor
              FROM public.track_b_team_rollbacks
              WHERE NOT is_drill AND state = 'complete'
              GROUP BY team
            ) history
          ), '[]'::jsonb),
        'intent_count', (SELECT count(*) FROM public.track_b_team_rollback_intents),
        'unresolved_intent_count', (
          SELECT count(*) FROM public.track_b_team_rollback_intents
          WHERE classification IS NULL
             OR (classification = 'replay' AND terminal_receipt IS NULL)
        )
      )
      $inventory$ INTO v_state;
    EXCEPTION WHEN OTHERS THEN
      v_state := jsonb_build_object(
        'state_capture_status', 'catalog_shape_unavailable',
        'fences', '[]'::jsonb,
        'rollback_count', NULL,
        'open_rollback_count', NULL,
        'completed_real_by_team', '[]'::jsonb,
        'intent_count', NULL,
        'unresolved_intent_count', NULL
      );
    END;
  ELSE
    v_state := jsonb_build_object(
      'state_capture_status', 'ledger_tables_unavailable',
      'fences', '[]'::jsonb,
      'rollback_count', NULL,
      'open_rollback_count', NULL,
      'completed_real_by_team', '[]'::jsonb,
      'intent_count', NULL,
      'unresolved_intent_count', NULL
    );
  END IF;
  BEGIN
    IF to_regclass('public.syncview_runtime_flags') IS NULL THEN
      v_runtime := jsonb_build_object(
        'capture_status', 'runtime_tables_unavailable',
        'flags', '[]'::jsonb
      );
    ELSE
      EXECUTE $runtime$
        SELECT jsonb_build_object(
          'capture_status', 'exact_columns',
          'flags', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('key',key,'value',value) ORDER BY key)
            FROM public.syncview_runtime_flags
            WHERE key IN (
              'prod_authority','linear_outbound_enabled','linear_legacy_parity_enabled'
            )
          ), '[]'::jsonb)
        )
      $runtime$ INTO v_runtime;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_runtime := jsonb_build_object(
      'capture_status', 'catalog_shape_unavailable',
      'flags', '[]'::jsonb
    );
  END;
  PERFORM set_config('syncview.f27_retained_diag_state', v_state::text, true);
  PERFORM set_config('syncview.f27_retained_diag_runtime', v_runtime::text, true);
END
$f27_retained_inventory$;

SELECT jsonb_build_object(
  'entry_state', CASE
    WHEN to_regclass('public.track_b_team_rollbacks') IS NOT NULL
     AND to_regclass('public.track_b_team_rollback_intents') IS NOT NULL
      THEN 'exact_post_section7'
    WHEN to_regclass('public.track_b_team_rollbacks') IS NULL
     AND to_regclass('public.track_b_team_rollback_intents') IS NULL
      THEN 'pristine_pre_f27'
    ELSE 'hybrid'
  END,
  'metadata', jsonb_build_object(
    'current_database', current_database(),
    'transaction_isolation', current_setting('transaction_isolation'),
    'transaction_read_only', current_setting('transaction_read_only'),
    'server_version_num', current_setting('server_version_num')
  ),
  'predicates', jsonb_build_array(
${reviewedRetainedDiagnosticPredicates().map((predicate, index) => {
    const ordinal = String(index + 1).padStart(2, '0');
    return `    jsonb_build_object('id',${sqlLiteral(predicate.id)},'status',current_setting('syncview.f27_retained_diag_${ordinal}'),'sql_sha256',${sqlLiteral(predicate.sql_sha256)})`;
  }).join(',\n')}
  ),
  'inventory', jsonb_build_object(
    'roles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'identity', rolname,
        'superuser', rolsuper,
        'inherit', rolinherit,
        'can_login', rolcanlogin
      ) ORDER BY rolname)
      FROM pg_roles
      WHERE rolname IN ('postgres','anon','authenticated','service_role')
    ), '[]'::jsonb),
    'runtime_capture_status', current_setting('syncview.f27_retained_diag_runtime')::jsonb->>'capture_status',
    'runtime_flags', current_setting('syncview.f27_retained_diag_runtime')::jsonb->'flags',
    'namespaces', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'identity', nspname,
        'owner', pg_get_userbyid(nspowner),
        'raw_acl', nspacl::text
      ) ORDER BY nspname)
      FROM pg_namespace
      WHERE nspname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
    ), '[]'::jsonb),
    'relations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'identity', quote_ident(n.nspname) || '.' || quote_ident(c.relname),
        'kind', c.relkind,
        'persistence', c.relpersistence,
        'access_method', am.amname,
        'owner', pg_get_userbyid(c.relowner),
        'row_security', c.relrowsecurity,
        'force_row_security', c.relforcerowsecurity,
        'replica_identity', c.relreplident,
        'is_partition', c.relispartition,
        'has_rules', c.relhasrules,
        'has_triggers', c.relhastriggers,
        'has_subclass', c.relhassubclass,
        'check_count', c.relchecks,
        'column_count', c.relnatts,
        'tablespace_oid', c.reltablespace::text,
        'options', c.reloptions,
        'raw_acl', c.relacl::text
      ) ORDER BY n.nspname, c.relname)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_am am ON am.oid = c.relam
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_toast'
        AND (
          n.nspname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
          OR c.relname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
          OR (n.nspname = 'public' AND c.relname IN (
            'mirror_outbox','syncview_runtime_flags','flag_flips'
          ))
        )
    ), '[]'::jsonb),
    'types', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'identity', quote_ident(n.nspname) || '.' || quote_ident(t.typname),
        'kind', t.typtype,
        'category', t.typcategory,
        'defined', t.typisdefined,
        'relation_identity', CASE WHEN t.typrelid = 0 THEN NULL ELSE t.typrelid::regclass::text END,
        'element_type', CASE WHEN t.typelem = 0 THEN NULL ELSE t.typelem::regtype::text END,
        'array_type', CASE WHEN t.typarray = 0 THEN NULL ELSE t.typarray::regtype::text END,
        'owner', pg_get_userbyid(t.typowner),
        'raw_acl', t.typacl::text
      ) ORDER BY n.nspname, t.typname)
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_toast'
        AND (n.nspname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
             OR t.typname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
             OR t.typrelid IN (
               to_regclass('public.track_b_f27_team_fences'),
               to_regclass('public.track_b_team_rollbacks'),
               to_regclass('public.track_b_team_rollback_intents')
             ))
    ), '[]'::jsonb),
    'columns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'identity', quote_ident(n.nspname) || '.' || quote_ident(c.relname) || '.' || quote_ident(a.attname),
        'ordinal', a.attnum,
        'type', format_type(a.atttypid, a.atttypmod),
        'not_null', a.attnotnull,
        'has_default', a.atthasdef,
        'default', pg_get_expr(d.adbin, d.adrelid, true),
        'identity_kind', a.attidentity,
        'generated_kind', a.attgenerated,
        'has_missing', a.atthasmissing,
        'missing_value', a.attmissingval::text,
        'statistics_target', a.attstattarget,
        'storage', a.attstorage,
        'compression', a.attcompression,
        'collation_oid', a.attcollation::text,
        'inheritance_count', a.attinhcount,
        'is_local', a.attislocal,
        'raw_acl', a.attacl::text,
        'options', a.attoptions,
        'fdw_options', a.attfdwoptions
      ) ORDER BY n.nspname, c.relname, a.attnum)
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attnum > 0 AND NOT a.attisdropped
        AND (
          c.relname IN ('track_b_f27_team_fences','track_b_team_rollbacks','track_b_team_rollback_intents')
          OR (c.relname = 'mirror_outbox' AND (
            a.attname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
            OR a.attname IN ('authority_generation','f27_drill_rollback_id')
          ))
        )
    ), '[]'::jsonb),
    'constraints', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'identity', quote_ident(n.nspname) || '.' || quote_ident(c.conname),
        'relation_identity', quote_ident(nr.nspname) || '.' || quote_ident(r.relname),
        'type', c.contype,
        'validated', c.convalidated,
        'deferrable', c.condeferrable,
        'deferred', c.condeferred,
        'is_local', c.conislocal,
        'inheritance_count', c.coninhcount,
        'parent_oid', c.conparentid::text,
        'no_inherit', c.connoinherit,
        'key_attnums', c.conkey::text,
        'foreign_relation', CASE WHEN c.confrelid = 0 THEN NULL ELSE c.confrelid::regclass::text END,
        'foreign_key_attnums', c.confkey::text,
        'update_action', c.confupdtype,
        'delete_action', c.confdeltype,
        'match_type', c.confmatchtype,
        'definition', pg_get_constraintdef(c.oid, true)
      ) ORDER BY n.nspname, c.conname)
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace nr ON nr.oid = r.relnamespace
      WHERE COALESCE(n.nspname,'') ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR c.conname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR pg_get_constraintdef(c.oid,true) ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR r.relname IN ('track_b_f27_team_fences','track_b_team_rollbacks','track_b_team_rollback_intents')
    ), '[]'::jsonb),
    'indexes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'identity', quote_ident(n.nspname) || '.' || quote_ident(ci.relname),
        'relation_identity', i.indrelid::regclass::text,
        'access_method', am.amname,
        'unique', i.indisunique,
        'primary', i.indisprimary,
        'valid', i.indisvalid,
        'ready', i.indisready,
        'live', i.indislive,
        'key_attnums', i.indkey::text,
        'key_count', i.indnkeyatts,
        'attribute_count', i.indnatts,
        'predicate', pg_get_expr(i.indpred, i.indrelid, true),
        'definition', pg_get_indexdef(i.indexrelid)
      ) ORDER BY n.nspname, ci.relname)
      FROM pg_index i
      JOIN pg_class ci ON ci.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = ci.relnamespace
      JOIN pg_am am ON am.oid = ci.relam
      JOIN pg_class cr ON cr.oid = i.indrelid
      WHERE n.nspname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR ci.relname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR pg_get_indexdef(i.indexrelid) ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR cr.relname IN ('track_b_f27_team_fences','track_b_team_rollbacks','track_b_team_rollback_intents')
    ), '[]'::jsonb),
    'triggers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'identity', quote_ident(n.nspname) || '.' || quote_ident(t.tgname),
        'relation_identity', t.tgrelid::regclass::text,
        'function_identity', t.tgfoid::regprocedure::text,
        'enabled', t.tgenabled,
        'type', t.tgtype,
        'argument_count', t.tgnargs,
        'arguments_hex', encode(t.tgargs, 'hex'),
        'column_attnums', t.tgattr::text,
        'definition', pg_get_triggerdef(t.oid, true)
      ) ORDER BY n.nspname, t.tgname)
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal
        AND (n.nspname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
             OR t.tgname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
             OR pg_get_triggerdef(t.oid,true) ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
             OR c.relname IN ('track_b_f27_team_fences','track_b_team_rollbacks','track_b_team_rollback_intents'))
    ), '[]'::jsonb),
    'rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'identity', quote_ident(n.nspname) || '.' || quote_ident(r.rulename),
        'relation_identity', r.ev_class::regclass::text,
        'event', r.ev_type,
        'instead', r.is_instead
      ) ORDER BY n.nspname, r.rulename)
      FROM pg_rewrite r
      JOIN pg_class c ON c.oid = r.ev_class
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR r.rulename ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR pg_get_ruledef(r.oid,true) ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR c.relname IN (
           'track_b_f27_team_fences','track_b_team_rollbacks','track_b_team_rollback_intents'
         )
    ), '[]'::jsonb),
    'policies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'identity', quote_ident(n.nspname) || '.' || quote_ident(p.polname),
        'relation_identity', p.polrelid::regclass::text,
        'command', p.polcmd,
        'permissive', p.polpermissive,
        'roles', p.polroles::text
      ) ORDER BY n.nspname, p.polname)
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR p.polname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR COALESCE(pg_get_expr(p.polqual,p.polrelid,true),'') ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR COALESCE(pg_get_expr(p.polwithcheck,p.polrelid,true),'') ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR c.relname IN (
           'track_b_f27_team_fences','track_b_team_rollbacks','track_b_team_rollback_intents'
         )
    ), '[]'::jsonb),
    'inheritance', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'child_identity', i.inhrelid::regclass::text,
        'parent_identity', i.inhparent::regclass::text,
        'sequence', i.inhseqno,
        'detach_pending', i.inhdetachpending
      ) ORDER BY i.inhrelid::regclass::text, i.inhseqno)
      FROM pg_inherits i
      JOIN pg_class child ON child.oid = i.inhrelid
      JOIN pg_namespace child_n ON child_n.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = i.inhparent
      JOIN pg_namespace parent_n ON parent_n.oid = parent.relnamespace
      WHERE child_n.nspname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR child.relname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR parent_n.nspname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR parent.relname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR i.inhrelid IN (
              to_regclass('public.track_b_f27_team_fences'),
              to_regclass('public.track_b_team_rollbacks'),
              to_regclass('public.track_b_team_rollback_intents')
            )
         OR i.inhparent IN (
              to_regclass('public.track_b_f27_team_fences'),
              to_regclass('public.track_b_team_rollbacks'),
              to_regclass('public.track_b_team_rollback_intents')
            )
    ), '[]'::jsonb),
    'collations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'identity', quote_ident(n.nspname) || '.' || quote_ident(c.collname),
        'provider', c.collprovider,
        'deterministic', c.collisdeterministic,
        'encoding', c.collencoding,
        'locale', c.colllocale,
        'version', c.collversion
      ) ORDER BY n.nspname, c.collname)
      FROM pg_collation c
      JOIN pg_namespace n ON n.oid = c.collnamespace
      WHERE n.nspname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR c.collname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
    ), '[]'::jsonb),
    'operator_classes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'identity', quote_ident(n.nspname) || '.' || quote_ident(o.opcname),
        'method', am.amname,
        'default', o.opcdefault,
        'input_type', o.opcintype::regtype::text,
        'family_identity', quote_ident(fn.nspname) || '.' || quote_ident(f.opfname)
      ) ORDER BY n.nspname, o.opcname)
      FROM pg_opclass o
      JOIN pg_namespace n ON n.oid = o.opcnamespace
      JOIN pg_am am ON am.oid = o.opcmethod
      JOIN pg_opfamily f ON f.oid = o.opcfamily
      JOIN pg_namespace fn ON fn.oid = f.opfnamespace
      WHERE n.nspname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR o.opcname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR o.opcintype IN (
           (SELECT reltype FROM pg_class WHERE oid=to_regclass('public.track_b_f27_team_fences')),
           (SELECT typarray FROM pg_type WHERE oid=(
             SELECT reltype FROM pg_class WHERE oid=to_regclass('public.track_b_f27_team_fences')
           ))
         )
    ), '[]'::jsonb),
    'operator_families', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'identity', quote_ident(n.nspname) || '.' || quote_ident(f.opfname),
        'method', am.amname
      ) ORDER BY n.nspname, f.opfname)
      FROM pg_opfamily f
      JOIN pg_namespace n ON n.oid = f.opfnamespace
      JOIN pg_am am ON am.oid = f.opfmethod
      WHERE n.nspname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
         OR f.opfname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
    ), '[]'::jsonb),
    'functions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'identity', p.oid::regprocedure::text,
        'schema', n.nspname,
        'name', p.proname,
        'result_type', p.prorettype::regtype::text,
        'returns_set', p.proretset,
        'argument_names', p.proargnames,
        'argument_defaults', p.pronargdefaults,
        'kind', p.prokind,
        'language', l.lanname,
        'security_definer', p.prosecdef,
        'leakproof', p.proleakproof,
        'volatility', p.provolatile,
        'parallel', p.proparallel,
        'strict', p.proisstrict,
        'owner', pg_get_userbyid(p.proowner),
        'config', p.proconfig,
        'cost', p.procost,
        'rows', p.prorows,
        'raw_acl', p.proacl::text,
        'source_sha256', encode(extensions.digest(convert_to(
          replace(replace(p.prosrc, E'\\r\\n', E'\\n'), E'\\r', E'\\n'), 'UTF8'
        ), 'sha256'), 'hex')
      ) ORDER BY n.nspname, p.proname, p.oid::regprocedure::text)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND (n.nspname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
             OR p.proname ~* 'f27|track_b_team_rollback|production_assert_authority|authority_generation'
             OR (p.prokind IN ('f','p') AND pg_get_functiondef(p.oid)
               ~* 'track_b_f27_|track_b_team_rollback|authority_generation|f27_drill_rollback_id|_f27_'))
    ), '[]'::jsonb),
    'table_grants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'object_identity', c.oid::regclass::text,
        'grantor', grantor.rolname,
        'grantee', COALESCE(grantee.rolname, 'PUBLIC'),
        'privilege', a.privilege_type,
        'grantable', a.is_grantable
      ) ORDER BY c.oid::regclass::text, grantor.rolname,
        COALESCE(grantee.rolname, 'PUBLIC'), a.privilege_type)
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
      LEFT JOIN pg_roles grantor ON grantor.oid = a.grantor
      LEFT JOIN pg_roles grantee ON grantee.oid = a.grantee
      WHERE c.oid IN (
        to_regclass('public.track_b_f27_team_fences'),
        to_regclass('public.track_b_team_rollbacks'),
        to_regclass('public.track_b_team_rollback_intents')
      )
    ), '[]'::jsonb),
    'function_execute_grants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'object_identity', p.oid::regprocedure::text,
        'grantor', grantor.rolname,
        'grantee', COALESCE(grantee.rolname, 'PUBLIC'),
        'privilege', a.privilege_type,
        'grantable', a.is_grantable
      ) ORDER BY p.oid::regprocedure::text, grantor.rolname,
        COALESCE(grantee.rolname, 'PUBLIC'))
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      LEFT JOIN pg_roles grantor ON grantor.oid = a.grantor
      LEFT JOIN pg_roles grantee ON grantee.oid = a.grantee
      WHERE p.proname ~* 'f27|production_assert_authority'
         OR p.oid = to_regprocedure(
           'public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)'
         )
    ), '[]'::jsonb),
    'state', current_setting('syncview.f27_retained_diag_state')::jsonb
  )
)::text;`;
}

function diagnosticSql() {
  const predicates = reviewedRetainedDiagnosticPredicates();
  return String.raw`\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;

${predicates.map(predicateDoSql).join('\n\n')}

${inventorySql()}

COMMIT;
`;
}

function defaultPsqlAdapter(psqlPath) {
  return {
    version() {
      let output;
      try {
        output = execFileSync(psqlPath, ['--version'], {
          encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
          env: safePsqlEnvironment(),
        });
      } catch (_) {
        fail('PSQL_VERSION_FAILED', 'The psql client version could not be read.');
      }
      const value = clean(output);
      if (!/^psql \(PostgreSQL\) \d+(?:\.\d+)+/.test(value)) {
        fail('PSQL_VERSION_FAILED', 'The psql version response was malformed.');
      }
      return value;
    },
    capture(sql, connectionEnv) {
      const result = spawnSync(psqlPath, [
        '-X', '--quiet', '--no-align', '--tuples-only',
        '--set', 'ON_ERROR_STOP=1', '--file', '-',
      ], {
        input: sql,
        encoding: 'utf8',
        windowsHide: true,
        env: safePsqlEnvironment(connectionEnv),
        maxBuffer: 1024 * 1024 * 1024,
      });
      if (result.error || result.status !== 0 || result.signal || clean(result.stderr)) {
        fail('PSQL_DIAGNOSIS_FAILED', 'The retained-state read-only transaction failed closed.');
      }
      return result.stdout;
    },
  };
}

function assertRelease(options) {
  const expected = clean(options.releaseSha);
  if (!SHA_RE.test(expected)) fail('RELEASE_SHA_REQUIRED', 'The exact reviewed release SHA is required.');
  let head;
  let originMain;
  let dirty;
  try {
    const runGit = options.execGit || ((args) => execFileSync('git', args, {
      cwd: options.repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }));
    head = clean(runGit(['rev-parse', 'HEAD']));
    originMain = clean(runGit(['rev-parse', 'origin/main']));
    dirty = clean(runGit(['status', '--porcelain=v1', '--untracked-files=all']));
  } catch (_) {
    fail('RELEASE_PROOF_FAILED', 'The reviewed release could not be proven locally.');
  }
  if (head !== expected || originMain !== expected || dirty) {
    fail('RELEASE_SHA_MISMATCH', 'The diagnosis requires clean HEAD and origin/main at the reviewed release.');
  }
  return expected;
}

function parseTranscript(stdout, confirmedDatabase) {
  const lines = String(stdout == null ? '' : stdout).split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) fail('DIAGNOSIS_TRANSCRIPT_INVALID', 'The retained-state transcript was not exactly one record.');
  let value;
  try { value = JSON.parse(lines[0]); } catch (_) {
    fail('DIAGNOSIS_TRANSCRIPT_INVALID', 'The retained-state transcript was malformed.');
  }
  const canonicalPredicates = reviewedRetainedDiagnosticPredicates();
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !['pristine_pre_f27', 'exact_post_section7', 'hybrid'].includes(value.entry_state)
      || !value.metadata || !value.inventory
      || value.metadata.current_database !== confirmedDatabase
      || value.metadata.transaction_isolation !== 'repeatable read'
      || value.metadata.transaction_read_only !== 'on'
      || !/^\d+$/.test(clean(value.metadata.server_version_num))
      || !Array.isArray(value.predicates)
      || value.predicates.length !== RETAINED_DIAGNOSTIC_PREDICATE_IDS.length) {
    fail('DIAGNOSIS_TRANSCRIPT_INVALID', 'The retained-state transaction proof or inventory was incomplete.');
  }
  value.predicates.forEach((predicate, index) => {
    if (!predicate || predicate.id !== RETAINED_DIAGNOSTIC_PREDICATE_IDS[index]
        || !['PASS', 'FAIL'].includes(predicate.status)
        || predicate.sql_sha256 !== canonicalPredicates[index].sql_sha256) {
      fail('DIAGNOSIS_TRANSCRIPT_INVALID', 'The retained-state predicate vector was malformed.');
    }
  });
  if (!['exact_columns', 'catalog_shape_unavailable', 'runtime_tables_unavailable']
    .includes(value.inventory.runtime_capture_status)
      || !value.inventory.state || typeof value.inventory.state !== 'object'
      || Array.isArray(value.inventory.state)
      || !['exact_columns', 'catalog_shape_unavailable', 'ledger_tables_unavailable']
        .includes(value.inventory.state.state_capture_status)) {
    fail('DIAGNOSIS_TRANSCRIPT_INVALID', 'The retained-state capture status was malformed.');
  }
  for (const category of RETAINED_STATE_FAILURE_ARRAY_CATEGORIES) {
    if (!Array.isArray(value.inventory[category])) {
      fail('DIAGNOSIS_TRANSCRIPT_INVALID', 'The retained-state catalog inventory was malformed.');
    }
  }
  return value;
}

function fieldDescriptor(identity, field, expected, observed) {
  let safeObserved;
  if (typeof observed === 'string' && !/sha256$/i.test(field)) {
    const bytes = Buffer.from(observed, 'utf8');
    safeObserved = {
      field,
      value_sha256: sha256(bytes),
      value_byte_length: bytes.length,
      value_type: 'string',
    };
  } else {
    safeObserved = { field, value: observed };
  }
  return {
    kind: 'catalog_metadata',
    object_identity: identity,
    expected: { field, value: expected },
    observed: safeObserved,
  };
}

function descriptorExpectations() {
  const byId = new Map(reviewedRetainedDiagnosticPredicates().map(predicate => [predicate.id, predicate.sql]));
  const tableSql = byId.get('retained_table_boundaries') || '';
  const columnSql = byId.get('retained_columns') || '';
  const constraintSql = byId.get('retained_constraint_metadata') || '';
  const functionSql = byId.get('retained_functions') || '';
  const openSql = byId.get('retained_no_open_work') || '';
  const runtimeSql = byId.get('runtime_flags') || '';
  const boundarySql = byId.get('required_boundary_objects') || '';
  const rollbackTable = /\(v_rollbacks_oid,\s*(\d+),\s*(\d+)\)/.exec(tableSql);
  const intentTable = /\(v_intents_oid,\s*(\d+),\s*(\d+)\)/.exec(tableSql);
  const authorityColumn = /\('authority_generation',\s*'bigint',\s*true,\s*'0',\s*(true|false),\s*'([^']+)'\)/
    .exec(columnSql);
  const functionCost = /p\.procost is distinct from (\d+)::real/.exec(functionSql);
  if (!rollbackTable || !intentTable || !authorityColumn || !functionCost
      || !columnSql.includes("a.attcompression is distinct from ''::\"char\"")
      || !columnSql.includes('a.attstattarget is not null')
      || !constraintSql.includes('and not c.condeferrable')
      || !constraintSql.includes('and not c.condeferred')
      || !openSql.includes("where state = 'open'")) {
    fail('MIGRATION_CONTRACT_INVALID', 'Public diagnostic descriptors lost their source-exact predicate binders.');
  }
  const runtimeFlags = new Map();
  for (const key of [
    'prod_authority', 'linear_outbound_enabled', 'linear_legacy_parity_enabled',
  ]) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(
      `where key = '${escaped}'\\)[\\s\\S]{0,120}?is distinct from '([^']+)'::jsonb`,
      'i',
    ).exec(runtimeSql);
    if (!match) {
      fail('MIGRATION_CONTRACT_INVALID', 'A runtime-flag diagnostic descriptor lost its predicate binder.');
    }
    runtimeFlags.set(key, JSON.parse(match[1]));
  }
  const boundaryRelations = [...boundarySql.matchAll(/c\.relname = '([^']+)'/g)]
    .map(match => `public.${match[1]}`);
  if (boundaryRelations.length !== 3) {
    fail('MIGRATION_CONTRACT_INVALID', 'Required-boundary relation descriptors lost their predicate binders.');
  }
  const preinstall = reviewedPreF27SubsetContract();
  const functionCosts = new Map();
  for (const id of ['write_authorization', 'production_authority']) {
    const match = /p\.procost is distinct from (\d+)::real/.exec(byId.get(id) || '');
    if (!match) {
      fail('MIGRATION_CONTRACT_INVALID', 'A boundary-function cost descriptor lost its predicate binder.');
    }
    functionCosts.set(id, Number(match[1]));
  }
  return {
    tables: new Map([
      ['public.track_b_team_rollbacks', {
        column_count: Number(rollbackTable[1]), check_count: Number(rollbackTable[2]),
      }],
      ['public.track_b_team_rollback_intents', {
        column_count: Number(intentTable[1]), check_count: Number(intentTable[2]),
      }],
    ]),
    column: {
      compression: '',
      statistics_target: null,
      authority_has_missing: authorityColumn[1] === 'true',
      authority_missing_value: authorityColumn[2],
    },
    constraint: { deferrable: false, deferred: false },
    function_cost: Number(functionCost[1]),
    functionCosts,
    no_open_count: 0,
    runtimeFlags,
    boundaryRelations: [preinstall.fence_table.identity, ...boundaryRelations],
    boundaryFunctions: [
      preinstall.mirror_outbox_enqueue.identity,
      preinstall.write_authorization.identity,
      preinstall.production_authority.identity,
    ],
  };
}

function retainedColumnDifference(inventory, expectations) {
  const columns = new Map(inventory.columns.map(record => [record.identity, record]));
  const checks = [
    ['public.track_b_team_rollbacks.actor', 'compression', expectations.column.compression],
    ['public.track_b_team_rollbacks.actor', 'statistics_target', expectations.column.statistics_target],
    ['public.mirror_outbox.authority_generation', 'has_missing', expectations.column.authority_has_missing],
    ['public.mirror_outbox.authority_generation', 'missing_value', expectations.column.authority_missing_value],
  ];
  for (const [identity, field, expected] of checks) {
    const record = columns.get(identity);
    if (!record) return fieldDescriptor(identity, 'presence', true, false);
    if (record[field] !== expected) return fieldDescriptor(identity, field, expected, record[field]);
  }
  return null;
}

function findFunctionRecord(inventory, identity) {
  const normalized = String(identity).replace(/^public\./, '');
  return inventory.functions.find(record =>
    String(record.identity).replace(/^public\./, '') === normalized);
}

function functionDifference(inventory, expected, expectedCost = null) {
  const observed = findFunctionRecord(inventory, expected.identity);
  if (!observed) return fieldDescriptor(expected.identity, 'presence', true, false);
  const volatility = { volatile: 'v', stable: 's', immutable: 'i' }[expected.volatility]
    || expected.volatility;
  const parallel = { unsafe: 'u', restricted: 'r', safe: 's' }[expected.parallel]
    || expected.parallel;
  const checks = [
    ['owner', expected.owner || 'postgres'],
    ['result_type', expected.result],
    ['language', expected.language],
    ['security_definer', expected.security_definer],
    ['volatility', volatility],
    ['parallel', parallel],
    ['config', expected.config],
    ['source_sha256', expected.source_sha256],
  ];
  if (expectedCost !== null) checks.push(['cost', expectedCost]);
  for (const [field, expectedValue] of checks) {
    const observedValue = field === 'cost' ? Number(observed[field]) : observed[field];
    if (stableJson(observedValue) !== stableJson(expectedValue)) {
      if (field === 'config') {
        const observedBytes = Buffer.from(stableJson(observedValue), 'utf8');
        return {
          kind: 'catalog_metadata',
          object_identity: expected.identity,
          expected: { field, value: expectedValue },
          observed: {
            field,
            value_sha256: sha256(observedBytes),
            value_byte_length: observedBytes.length,
            value_count: Array.isArray(observedValue) ? observedValue.length : null,
          },
        };
      }
      return fieldDescriptor(expected.identity, field, expectedValue, observedValue);
    }
  }
  return null;
}

function knownDescriptor(id, inventory) {
  const expectations = descriptorExpectations();
  if (id === 'required_boundary_objects') {
    for (const identity of expectations.boundaryRelations) {
      if (!inventory.relations.some(record => record.identity === identity)) {
        return fieldDescriptor(identity, 'presence', true, false);
      }
    }
    for (const identity of expectations.boundaryFunctions) {
      if (!findFunctionRecord(inventory, identity)) {
        return fieldDescriptor(identity, 'presence', true, false);
      }
    }
  }
  if (id === 'closed_entry_state_union') {
    const rollbacksPresent = inventory.relations.some(record =>
      record.identity === 'public.track_b_team_rollbacks');
    const intentsPresent = inventory.relations.some(record =>
      record.identity === 'public.track_b_team_rollback_intents');
    if (rollbacksPresent !== intentsPresent) {
      return fieldDescriptor(
        'public.track_b_team_rollbacks+public.track_b_team_rollback_intents',
        'presence_pair',
        'both_present_or_both_absent',
        `${rollbacksPresent ? 'present' : 'absent'}+${intentsPresent ? 'present' : 'absent'}`,
      );
    }
  }
  if (id === 'runtime_flags') {
    const observed = new Map(inventory.runtime_flags.map(record => [record.key, record.value]));
    for (const [key, expected] of expectations.runtimeFlags) {
      if (!observed.has(key)) {
        return fieldDescriptor(`public.syncview_runtime_flags[key=${key}]`, 'presence', true, false);
      }
      if (stableJson(observed.get(key)) !== stableJson(expected)) {
        const observedBytes = Buffer.from(stableJson(observed.get(key)), 'utf8');
        return {
          kind: 'catalog_metadata',
          object_identity: `public.syncview_runtime_flags[key=${key}]`,
          expected: { field: 'value', value: expected },
          observed: {
            field: 'value',
            value_sha256: sha256(observedBytes),
            value_byte_length: observedBytes.length,
            value_json_type: Array.isArray(observed.get(key))
              ? 'array'
              : (observed.get(key) === null ? 'null' : typeof observed.get(key)),
          },
        };
      }
    }
  }
  if (id === 'retained_table_boundaries') {
    for (const [identity, expected] of expectations.tables) {
      const observed = inventory.relations.find(record => record.identity === identity);
      if (!observed) return fieldDescriptor(identity, 'presence', true, false);
      for (const field of ['column_count', 'check_count']) {
        if (observed[field] !== expected[field]) {
          return fieldDescriptor(identity, field, expected[field], observed[field]);
        }
      }
    }
  }
  if (id === 'retained_columns') return retainedColumnDifference(inventory, expectations);
  if (id === 'retained_constraint_metadata') {
    const identity = 'public.mirror_outbox_f27_drill_rollback_id_fkey';
    const observed = inventory.constraints.find(record => record.identity === identity);
    if (!observed) return fieldDescriptor(identity, 'presence', true, false);
    for (const [field, expected] of Object.entries(expectations.constraint)) {
      if (observed[field] !== expected) return fieldDescriptor(identity, field, expected, observed[field]);
    }
  }
  if (id === 'retained_functions') {
    for (const expected of reviewedPostSection7Contract().retained_functions) {
      const difference = functionDifference(inventory, expected, expectations.function_cost);
      if (difference) return difference;
    }
  }
  if (id === 'write_authorization' || id === 'production_authority') {
    const expected = reviewedPreF27SubsetContract()[id];
    const difference = functionDifference(
      inventory, expected, expectations.functionCosts.get(id),
    );
    if (difference) return difference;
  }
  if (id === 'retained_no_open_work') {
    const state = inventory.state || {};
    if (Number(state.open_rollback_count) !== expectations.no_open_count) {
      return fieldDescriptor(
        'public.track_b_team_rollbacks',
        'open_row_count',
        expectations.no_open_count,
        Number(state.open_rollback_count));
    }
    if (Number(state.unresolved_intent_count) !== expectations.no_open_count) {
      return fieldDescriptor(
        'public.track_b_team_rollback_intents',
        'unresolved_row_count',
        expectations.no_open_count,
        Number(state.unresolved_intent_count));
    }
  }
  if (id === 'retained_generation_history') {
    const state = inventory.state || {};
    for (const fence of state.fences || []) {
      const history = (state.completed_real_by_team || []).find(row => row.team === fence.team)
        || { completed_count: 0, distinct_generation_count: 0, min_generation: null, max_generation: null };
      if (Number(fence.generation) !== Number(history.completed_count)) {
        const team = ['video', 'graphics'].includes(String(fence.team))
          ? String(fence.team)
          : 'other';
        const descriptor = fieldDescriptor(
          `public.track_b_f27_team_fences[team=${team}]`,
          'generation',
          Number(history.completed_count),
          Number(fence.generation),
        );
        if (team === 'other') {
          descriptor.observed.object_identity_sha256 = sha256(Buffer.from(String(fence.team), 'utf8'));
          descriptor.observed.unexpected_identity_count = 1;
        }
        return descriptor;
      }
    }
  }
  return null;
}

function reviewedPublicObjectIdentities() {
  const preinstall = reviewedPreF27SubsetContract();
  const retained = reviewedPostSection7Contract();
  const values = new Set([
    preinstall.fence_table.identity,
    preinstall.mirror_outbox_enqueue.identity,
    preinstall.write_authorization.identity,
    preinstall.production_authority.identity,
    'public.mirror_outbox',
    'public.syncview_runtime_flags',
    'public.flag_flips',
    ...preinstall.fence_table.constraints.map(name => `public.${name}`),
    ...retained.retained_inventory.tables.map(name => `public.${name}`),
    ...retained.retained_inventory.outbox_constraints.map(name => `public.${name}`),
    `public.${retained.retained_inventory.outbox_index}`,
    `public.${retained.retained_inventory.hold_trigger.name}`,
    ...retained.retained_functions.flatMap(record => [
      record.identity,
      record.identity.replace(/^public\./, ''),
    ]),
  ]);
  return values;
}

function publicObjectIdentity(identity) {
  const value = clean(identity);
  if (reviewedPublicObjectIdentities().has(value)) return { object_identity: value };
  return {
    object_identity_class: 'unexpected_or_unreviewed_catalog_identity',
    object_identity_sha256: sha256(Buffer.from(value, 'utf8')),
  };
}

function normalizedPublicIdentity(identity) {
  const value = clean(identity).replace(/"/g, '');
  if (!value || value.startsWith('public.')) return value;
  return `public.${value}`;
}

function retainedCatalogAllowlist() {
  const preinstall = reviewedPreF27SubsetContract();
  const retained = reviewedPostSection7Contract();
  const predicates = new Map(reviewedRetainedDiagnosticPredicates()
    .map(predicate => [predicate.id, predicate.sql]));
  const tableNames = retained.retained_inventory.tables;
  const relations = new Set([
    'public.mirror_outbox', 'public.syncview_runtime_flags', 'public.flag_flips',
    ...tableNames.map(name => `public.${name}`),
  ]);
  const types = new Set(tableNames.flatMap(name => [
    `public.${name}`, `public._${name}`,
  ]));
  const columns = new Set([
    ...preinstall.fence_table.columns.map(column =>
      `public.track_b_f27_team_fences.${column[0]}`),
    ...retained.retained_inventory.outbox_columns.map(column =>
      `public.mirror_outbox.${column}`),
  ]);
  const columnSql = predicates.get('retained_columns') || '';
  for (const match of columnSql.matchAll(/\((v_rollbacks_oid|v_intents_oid),\s*\d+,\s*'([^']+)'/g)) {
    const table = match[1] === 'v_rollbacks_oid'
      ? 'track_b_team_rollbacks' : 'track_b_team_rollback_intents';
    columns.add(`public.${table}.${match[2]}`);
  }
  const constraints = new Set(preinstall.fence_table.constraints.map(name =>
    `public.${name}|public.track_b_f27_team_fences`));
  const constraintSql = predicates.get('retained_constraint_metadata') || '';
  for (const match of constraintSql.matchAll(/'(track_b_team_(?:rollbacks|rollback_intents)_[a-z0-9_]+|mirror_outbox_f27_[a-z0-9_]+)'/g)) {
    const name = match[1];
    const relation = name.startsWith('track_b_team_rollbacks_')
      ? 'public.track_b_team_rollbacks'
      : (name.startsWith('track_b_team_rollback_intents_')
        ? 'public.track_b_team_rollback_intents'
        : 'public.mirror_outbox');
    constraints.add(`public.${name}|${relation}`);
    relations.add(`public.${name}`);
  }
  const indexes = new Set([
    'public.track_b_f27_team_fences_pkey|public.track_b_f27_team_fences',
  ]);
  const indexSql = predicates.get('retained_indexes') || '';
  for (const match of indexSql.matchAll(/'(track_b_team_(?:rollbacks|rollback_intents)_[a-z0-9_]+|mirror_outbox_one_f27_drill_row_idx)'/g)) {
    const name = match[1];
    const relation = name.startsWith('track_b_team_rollbacks_')
      ? 'public.track_b_team_rollbacks'
      : (name.startsWith('track_b_team_rollback_intents_')
        ? 'public.track_b_team_rollback_intents'
        : 'public.mirror_outbox');
    indexes.add(`public.${name}|${relation}`);
    relations.add(`public.${name}`);
  }
  relations.add('public.track_b_f27_team_fences_pkey');
  const functions = new Set([
    preinstall.mirror_outbox_enqueue.identity,
    preinstall.write_authorization.identity,
    preinstall.production_authority.identity,
    ...retained.retained_functions.map(record => record.identity),
  ].map(normalizedPublicIdentity));
  return {
    columns,
    constraints,
    functions,
    indexes,
    relations,
    triggers: new Set([
      'public.track_b_f27_hold_guard|public.mirror_outbox|public.track_b_f27_hold_guard()',
    ]),
    types,
  };
}

function unexpectedRecordIsReviewed(category, record) {
  const allowlist = retainedCatalogAllowlist();
  const identity = normalizedPublicIdentity(record && (
    record.identity || record.object_identity || record.relation_identity
    || record.child_identity
  ));
  if (!identity) return false;
  if (category === 'relations' || category === 'types' || category === 'columns'
      || category === 'functions') {
    return allowlist[category].has(identity);
  }
  if (category === 'constraints' || category === 'indexes') {
    return allowlist[category].has(
      `${identity}|${normalizedPublicIdentity(record.relation_identity)}`,
    );
  }
  if (category === 'triggers') {
    return allowlist.triggers.has([
      identity,
      normalizedPublicIdentity(record.relation_identity),
      normalizedPublicIdentity(record.function_identity),
    ].join('|'));
  }
  return false;
}

function genericDescriptor(predicate, inventory) {
  const categoryMap = {
    required_boundary_objects: ['roles', 'relations', 'functions'],
    closed_entry_state_union: ['relations'],
    runtime_flags: ['runtime_flags'],
    fence_contract: ['roles', 'relations', 'columns', 'constraints', 'indexes', 'triggers', 'table_grants'],
    retained_table_boundaries: ['roles', 'relations', 'table_grants'],
    retained_columns: ['columns'],
    retained_constraint_metadata: ['constraints'],
    retained_check_constraints: ['constraints'],
    retained_indexes: ['indexes'],
    retained_hold_trigger: ['triggers'],
    retained_functions: ['functions'],
    retained_hold_guard_acl: ['functions', 'function_execute_grants'],
    retained_mutating_acl: ['functions', 'function_execute_grants'],
    retained_no_open_work: ['state'],
    retained_intent_history: ['state'],
    retained_rollback_history: ['state'],
    retained_generation_history: ['state'],
    mirror_enqueue_acl: ['functions', 'function_execute_grants'],
    write_authorization: ['functions', 'function_execute_grants'],
    production_authority: ['functions', 'function_execute_grants'],
    unexpected_f27_objects: [
      'namespaces', 'relations', 'types', 'columns', 'constraints', 'indexes',
      'triggers', 'rules', 'policies', 'inheritance', 'collations',
      'operator_classes', 'operator_families', 'functions',
    ],
  };
  const categories = categoryMap[predicate.id] || [];
  const categoryValues = Object.fromEntries(categories.map(category => {
    const values = inventory[category];
    if (predicate.id !== 'unexpected_f27_objects' || !Array.isArray(values)) {
      return [category, values];
    }
    return [category, values.filter(record => !unexpectedRecordIsReviewed(category, record))];
  }));
  const observed = categoryValues;
  const records = categories.flatMap(category => {
    const values = Array.isArray(categoryValues[category])
      ? categoryValues[category]
      : [categoryValues[category]];
    return values.map(record => ({ category, record })).filter(item => item.record != null);
  });
  const boundedRecords = records.slice(0, 12).map(({ category, record }) => {
    const identity = record.identity || record.object_identity || record.relation_identity
      || record.child_identity || (record.key ? `public.syncview_runtime_flags[key=${record.key}]` : category);
    const descriptor = {
      category,
      ...publicObjectIdentity(identity),
      metadata_sha256: sha256(Buffer.from(stableJson(record), 'utf8')),
    };
    if (category === 'functions' && HASH_RE.test(clean(record.source_sha256))) {
      descriptor.normalized_source_sha256 = clean(record.source_sha256);
    }
    return descriptor;
  });
  const differenceIsolated = predicate.id === 'unexpected_f27_objects'
    && boundedRecords.length === 1 && records.length === 1;
  return {
    kind: differenceIsolated ? 'catalog_metadata' : 'source_exact_predicate_failure',
    difference_isolated: differenceIsolated,
    predicate_scope: predicate.id,
    object_scope: boundedRecords,
    expected: {
      status: 'PASS',
      predicate_sql_sha256: predicate.sql_sha256,
    },
    observed: {
      status: 'FAIL',
      inventory_sha256: sha256(Buffer.from(stableJson(observed), 'utf8')),
      record_count: records.length,
      records_truncated: records.length > boundedRecords.length,
      records: boundedRecords,
    },
    operator_action: differenceIsolated
      ? 'review_bounded_descriptor'
      : 'inspect_private_same_transaction_inventory',
  };
}

function sanitizeFunctionDescriptor(descriptor) {
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (/^(?:prosrc|definition|source)$/i.test(key)
          || (/source/i.test(key)
            && !['source_sha256', 'normalized_source_sha256'].includes(key))) {
        fail('PUBLIC_RECEIPT_UNSAFE', 'A raw definition or function source escaped the hash-only boundary.');
      }
      visit(nested);
    }
  };
  visit(descriptor);
  return descriptor;
}

function buildReceipt(parsed) {
  const canonical = reviewedRetainedDiagnosticPredicates();
  const failures = parsed.predicates.filter(predicate => predicate.status === 'FAIL');
  const firstFailure = failures[0] || null;
  const predicates = parsed.predicates.map((predicate, index) => {
    const output = { id: predicate.id, status: predicate.status };
    if (predicate.status === 'FAIL') {
      output.causal_role = predicate === firstFailure
        ? 'first_gate_failure'
        : 'downstream_or_additional';
      if (predicate !== firstFailure) output.preceded_by = firstFailure.id;
      output.descriptor = sanitizeFunctionDescriptor(
        knownDescriptor(predicate.id, parsed.inventory)
        || genericDescriptor(canonical[index], parsed.inventory),
      );
    }
    return output;
  });
  const gateSql = reviewedPreinstallGateSql();
  const receipt = {
    status: failures.length === 0 && parsed.entry_state === 'exact_post_section7' ? 'PASS' : 'FAIL',
    operation: OPERATION,
    scope: SCOPE,
    entry_state: parsed.entry_state,
    transaction: 'repeatable_read_read_only',
    evaluation: 'source_exact_ordered_predicates',
    predicate_count: predicates.length,
    failed_predicate_count: failures.length,
    first_gate_failure: firstFailure ? firstFailure.id : null,
    first_gate_failure_terminal: firstFailure
      ? predicateFailureCode(canonical.find(predicate => predicate.id === firstFailure.id))
      : null,
    predicates,
    reviewed_gate_sha256: sha256(Buffer.from(gateSql, 'utf8')),
  };
  if (parsed.entry_state !== 'exact_post_section7' && failures.length === 0) {
    receipt.code = 'EXACT_POST_SECTION7_REQUIRED';
  }
  const bytes = Buffer.from(stableJson(receipt), 'utf8');
  if (bytes.length > MAX_PUBLIC_RECEIPT_BYTES) {
    fail('PUBLIC_RECEIPT_TOO_LARGE', 'The bounded retained-state receipt exceeded its public limit.');
  }
  return receipt;
}

function diagnose(options) {
  if (!options || options.confirmed !== true) {
    fail('CONFIRMATION_REQUIRED', 'Explicit retained-state diagnosis confirmation is required.');
  }
  const database = clean(options.database);
  const projectRef = clean(options.projectRef);
  const connectionEnv = options.connectionEnv
    || parseDatabaseUrl(options.databaseUrl, projectRef, database);
  if (!options.skipReleaseProof) assertRelease(options);
  const adapter = options.psqlAdapter || defaultPsqlAdapter(options.psqlPath || 'psql');
  const version = clean(adapter.version());
  if (!/^psql \(PostgreSQL\) \d+(?:\.\d+)+/.test(version)) {
    fail('PSQL_VERSION_FAILED', 'The psql version response was malformed.');
  }
  let stdout;
  try { stdout = adapter.capture(diagnosticSql(), connectionEnv); }
  catch (error) {
    if (error instanceof RetainedStateDiagnosisError) throw error;
    if (error instanceof SnapshotCaptureError) {
      fail(error.code, error.message);
    }
    fail('PSQL_DIAGNOSIS_FAILED', 'The retained-state read-only transaction failed closed.');
  }
  return buildReceipt(parseTranscript(stdout, database));
}

function parseArgs(argv) {
  const accepted = new Set([
    '--confirm-project-ref', '--confirm-database', '--release-sha',
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!accepted.has(name) || Object.prototype.hasOwnProperty.call(values, name)) {
      fail('ARGUMENT_REJECTED', 'Only unique documented diagnosis options are accepted.');
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      fail('ARGUMENT_REJECTED', 'Every diagnosis option requires one value.');
    }
    values[name] = value;
    index += 1;
  }
  for (const required of ['--confirm-project-ref', '--confirm-database', '--release-sha']) {
    if (!values[required]) fail('ARGUMENT_REJECTED', 'All required diagnosis options must be explicit.');
  }
  return {
    projectRef: values['--confirm-project-ref'],
    database: values['--confirm-database'],
    releaseSha: values['--release-sha'],
  };
}

function publicFailure(error) {
  if (error instanceof RetainedStateDiagnosisError) {
    return {
      status: 'FAIL',
      operation: OPERATION,
      scope: SCOPE,
      code: error.code,
      message: error.message,
    };
  }
  const fallback = snapshotPublicFailure(error);
  return {
    status: 'FAIL', operation: OPERATION, scope: SCOPE,
    code: fallback.code, message: fallback.message,
  };
}

function runFromEnvironment(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  return diagnose({
    ...args,
    databaseUrl: env.F27_DATABASE_URL,
    repoRoot: process.cwd(),
    confirmed: clean(env.F27_CONFIRM_RETAINED_STATE_DIAGNOSE) === '1',
  });
}

if (require.main === module) {
  try {
    const receipt = runFromEnvironment();
    process.stdout.write(`${JSON.stringify(receipt)}${os.EOL}`);
    if (receipt.status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify(publicFailure(error))}${os.EOL}`);
    process.exitCode = 1;
  }
}

module.exports = {
  MAX_PUBLIC_RECEIPT_BYTES,
  OPERATION,
  RetainedStateDiagnosisError,
  SCOPE,
  buildReceipt,
  diagnosticSql,
  diagnose,
  parseArgs,
  parseTranscript,
  predicateFailureCode,
  publicFailure,
  runFromEnvironment,
  sanitizeFunctionDescriptor,
};

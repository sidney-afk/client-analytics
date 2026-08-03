#!/usr/bin/env node
'use strict';

// Mechanical, read-only gate for the full F133 inverse. The restore workflow
// runs this before it receives any deploy credential. Only public-safe
// predicate names and counts are emitted; function source never leaves the
// process.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = 'f133_post_inverse_exact';
const BOOLEAN_PREDICATES = Object.freeze([
  'transaction_exact',
  'flag_off',
  'zero_open_title_intents',
  'canonical_functions_absent',
  'canonical_triggers_absent',
  'temporary_function_names_absent',
  'restored_functions_present',
  'restored_function_metadata_exact',
  'retained_title_revision_exact',
  'retained_title_outbox_check',
]);
const SOURCE_PREDICATES = Object.freeze({
  intake_append_source_sha256: 'intake_append_source_exact',
  issue_linkage_source_sha256: 'issue_linkage_source_exact',
});

function sha256(value) {
  return crypto.createHash('sha256').update(String(value).replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

function functionBody(file, functionName) {
  const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${escaped}\\s*\\([\\s\\S]*?\\bas\\s+\\$fn\\$([\\s\\S]*?)\\$fn\\$;`,
    'i',
  ));
  if (!match) throw new Error(`SOURCE_CONTRACT_MISSING:${functionName}`);
  return match[1];
}

const SQL = String.raw`
begin isolation level repeatable read read only;
select jsonb_build_object(
  'transaction_exact', current_setting('transaction_isolation') = 'repeatable read'
    and current_setting('transaction_read_only') = 'on',
  'flag_off', exists (
    select 1 from public.syncview_runtime_flags
    where key = 'f133_canonical_title_enabled' and value = '{"enabled":false}'::jsonb
  ),
  'zero_open_title_intents', not exists (
    select 1 from public.mirror_outbox
    where operation = 'title' and status in ('pending','failed','shadow_ok')
  ),
  'canonical_functions_absent', not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array[
      'production_intake_v3_card_contract',
      'production_canonical_title_card_guard',
      'production_canonical_title_dependency_valid',
      'production_canonical_title_dependency_resolve',
      'production_canonical_title_deliverable_guard',
      'production_canonical_title_cas_guard',
      'production_canonical_title_acknowledge',
      'production_canonical_title_binder_adopt',
      'production_deliverable_linear_link_projection',
      'production_intake_commit',
      'production_intake_card_adopt',
      'production_canonical_title_from_linear',
      'production_canonical_title_write'
    ]::text[])
  ),
  'canonical_triggers_absent', not exists (
    select 1 from pg_trigger t
    where not t.tgisinternal and t.tgname = any(array[
      'production_canonical_title_guard_before',
      'production_canonical_title_deliverable_guard_before',
      'zz_production_canonical_title_cas_before',
      'production_deliverable_linear_link_projection_after'
    ]::text[])
  ),
  'temporary_function_names_absent', not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'production_intake_append_v3', 'production_issue_create_linkage_pre_f133'
    )
  ),
  'restored_functions_present',
    to_regprocedure('public.production_intake_append(text,timestamp with time zone,jsonb,jsonb)') is not null
    and to_regprocedure('public.production_issue_create_linkage(text,bigint,jsonb,jsonb)') is not null
    and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='production_intake_append') = 1
    and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='production_issue_create_linkage') = 1,
  'restored_function_metadata_exact', not exists (
    select 1
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where p.oid in (
      to_regprocedure('public.production_intake_append(text,timestamp with time zone,jsonb,jsonb)'),
      to_regprocedure('public.production_issue_create_linkage(text,bigint,jsonb,jsonb)')
    ) and (
      n.nspname <> 'public' or l.lanname <> 'plpgsql' or p.prosecdef is not true
      or p.proconfig is distinct from array['search_path=public']::text[]
      or p.prokind is distinct from 'f' or p.provolatile is distinct from 'v'
      or p.proparallel is distinct from 'u' or p.proleakproof or p.proisstrict
      or p.proretset
      or (p.proname='production_intake_append' and p.prorettype is distinct from 'jsonb'::regtype)
      or (p.proname='production_issue_create_linkage'
          and p.prorettype is distinct from 'public.deliverables'::regtype)
      or exists (
        (select a.grantor,a.grantee,a.privilege_type,a.is_grantable
         from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
         where a.grantee=p.proowner)
        except
        (select d.grantor,d.grantee,d.privilege_type,d.is_grantable
         from aclexplode(acldefault('f',p.proowner)) d
         where d.grantee=p.proowner)
      )
      or exists (
        (select d.grantor,d.grantee,d.privilege_type,d.is_grantable
         from aclexplode(acldefault('f',p.proowner)) d
         where d.grantee=p.proowner)
        except
        (select a.grantor,a.grantee,a.privilege_type,a.is_grantable
         from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
         where a.grantee=p.proowner)
      )
      or (select count(*)
          from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          where a.grantee is distinct from p.proowner) is distinct from 1
      or exists (
        select 1
        from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        left join pg_roles r on r.oid=a.grantee
        where a.grantee is distinct from p.proowner and (
          r.rolname is distinct from 'service_role'
          or a.grantor is distinct from p.proowner
          or a.privilege_type is distinct from 'EXECUTE'
          or a.is_grantable
        )
      )
    )
  ),
  'intake_append_source_sha256', (
    select encode(digest(replace(p.prosrc,E'\r\n',E'\n'),'sha256'),'hex')
    from pg_proc p where p.oid = to_regprocedure(
      'public.production_intake_append(text,timestamp with time zone,jsonb,jsonb)'
    )
  ),
  'issue_linkage_source_sha256', (
    select encode(digest(replace(p.prosrc,E'\r\n',E'\n'),'sha256'),'hex')
    from pg_proc p where p.oid = to_regprocedure(
      'public.production_issue_create_linkage(text,bigint,jsonb,jsonb)'
    )
  ),
  'retained_title_revision_exact', (
    select count(*) = 2 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('calendar_posts','sample_reviews')
      and c.column_name = 'title_revision' and c.data_type = 'bigint'
      and c.is_nullable = 'NO' and c.column_default = '0'
  ) and not exists (
    select 1
    from (values
      ('calendar_posts'::text, 'calendar_posts_title_revision_nonnegative'::text),
      ('sample_reviews'::text, 'sample_reviews_title_revision_nonnegative'::text)
    ) expected(table_name, constraint_name)
    left join pg_constraint con
      on con.conrelid = case expected.table_name
        when 'calendar_posts' then 'public.calendar_posts'::regclass
        when 'sample_reviews' then 'public.sample_reviews'::regclass
      end
      and con.conname = expected.constraint_name
    where con.oid is null
      or con.connamespace is distinct from 'public'::regnamespace
      or con.contype is distinct from 'c'
      or not con.convalidated or con.condeferrable or con.condeferred
      or not con.conislocal or con.coninhcount <> 0 or con.conparentid <> 0
      or con.connoinherit
      or regexp_replace(
        lower(pg_get_expr(con.conbin,con.conrelid,true)),
        '[[:space:]()]','','g'
      ) is distinct from 'title_revision>=0'
  ),
  'retained_title_outbox_check', (
    select count(*) = 1 from pg_constraint con
    where con.conrelid = 'public.mirror_outbox'::regclass
      and con.conname = 'mirror_outbox_legacy_parity_operation_check'
      and con.connamespace = 'public'::regnamespace
      and con.contype = 'c' and con.convalidated
      and not con.condeferrable and not con.condeferred
      and con.conislocal and con.coninhcount = 0 and con.conparentid = 0
      and not con.connoinherit
      and regexp_replace(
        lower(pg_get_expr(con.conbin,con.conrelid,true)),
        '[[:space:]()]','','g'
      ) = 'legacy_parity=falseoroperation=anyarray[''create''::text,''status''::text,''comment''::text,''title''::text]'
  )
);
commit;`;

function main(env = process.env, deps = {}) {
  const databaseUrl = String(env.F133_DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('F133_DATABASE_URL_REQUIRED');
  const exec = deps.spawnSync || spawnSync;
  const command = env.PSQL_BIN || (process.platform === 'win32' ? 'psql.exe' : 'psql');
  const result = exec(command, [
    '--no-psqlrc', '--quiet', '--tuples-only', '--no-align',
    '--set=ON_ERROR_STOP=1', databaseUrl, '--command', SQL,
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (!result || result.status !== 0) throw new Error('F133_POST_INVERSE_DATABASE_CHECK_FAILED');
  const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  let observed;
  try { observed = JSON.parse(lines[lines.length - 1] || '{}'); }
  catch (_) { throw new Error('F133_POST_INVERSE_RECEIPT_INVALID'); }

  const repo = path.resolve(__dirname, '..');
  const expected = {
    intake_append_source_sha256: sha256(functionBody(
      path.join(repo, 'migrations', '2026-07-13-production-intake-append.sql'),
      'production_intake_append',
    )),
    issue_linkage_source_sha256: sha256(functionBody(
      path.join(repo, 'migrations', '2026-07-23-f203-production-issue-create.sql'),
      'production_issue_create_linkage',
    )),
  };
  const failed = BOOLEAN_PREDICATES.filter(key => observed[key] !== true);
  for (const [key, value] of Object.entries(expected)) {
    if (observed[key] !== value) failed.push(SOURCE_PREDICATES[key]);
  }
  const expectedKeys = new Set([...BOOLEAN_PREDICATES, ...Object.keys(SOURCE_PREDICATES)]);
  if (Object.keys(observed).some(key => !expectedKeys.has(key))) {
    failed.push('receipt_shape_exact');
  }
  const receipt = {
    status: failed.length ? 'FAIL' : 'PASS',
    gate: GATE,
    predicate_count: BOOLEAN_PREDICATES.length + Object.keys(SOURCE_PREDICATES).length,
    failed_predicates: [...new Set(failed)].sort(),
  };
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (failed.length) process.exitCode = 1;
  return receipt;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stdout.write(`${JSON.stringify({
      status: 'FAIL', gate: GATE, code: String(error && error.message || 'F133_POST_INVERSE_FAILED'),
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { BOOLEAN_PREDICATES, GATE, SOURCE_PREDICATES, SQL, functionBody, main, sha256 };

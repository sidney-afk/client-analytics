#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const proofPath = path.join(root, 'scripts', 'f133-canonical-title-proof.sql');
const migrationPath = path.join(root, 'migrations', '2026-08-02-f133-canonical-title.sql');
const marker = '\\ir ../migrations/2026-08-02-f133-canonical-title.sql';
const proof = fs.readFileSync(proofPath, 'utf8');
const parts = proof.split(marker);
if (parts.length !== 3) throw new Error('F133_GATE_PROOF_MARKER_INVALID');
const fixture = parts[0];
const serviceContainerId = String(
  process.env.F133_POSTGRES_SERVICE_CONTAINER_ID || '',
).trim();
if (serviceContainerId && !/^[a-f0-9]{12,64}$/.test(serviceContainerId)) {
  throw new Error('F133_GATE_PROOF_CONTAINER_ID_INVALID');
}

function run(database, sql, expectSuccess = true) {
  const result = spawnSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-d', database,
  ], { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if ((result.status === 0) !== expectSuccess) {
    throw new Error(expectSuccess ? 'F133_GATE_PROOF_COMMAND_FAILED' : 'F133_GATE_PROOF_DID_NOT_FAIL');
  }
  return result;
}

function stateDigest(database) {
  const dump = serviceContainerId
    ? spawnSync('docker', [
      'exec', serviceContainerId,
      'pg_dump', '--username=postgres', '--dbname', database,
      '--schema-only', '--no-owner',
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    : spawnSync('pg_dump', [
      '--schema-only', '--no-owner', '-d', database,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (dump.status !== 0) throw new Error('F133_GATE_PROOF_DUMP_FAILED');
  const normalizedDump = dump.stdout
    .split(/\r?\n/)
    .filter(line => !/^\\(?:un)?restrict /.test(line))
    .join('\n');
  const data = run(database, `select jsonb_build_object(
    'flag', coalesce((select jsonb_agg(to_jsonb(f) order by f.key)
      from public.syncview_runtime_flags f
      where f.key = 'f133_canonical_title_enabled'), '[]'::jsonb),
    'open_title', (select count(*) from public.mirror_outbox
      where operation = 'title' and status in ('pending','failed','shadow_ok'))
  )::text;`).stdout;
  return crypto.createHash('sha256').update(normalizedDump).update('\0').update(data).digest('hex');
}

const retained = `
insert into public.syncview_runtime_flags(key,value,updated_by)
values ('f133_canonical_title_enabled','{"enabled":false}'::jsonb,'proof');
alter table public.calendar_posts add column title_revision bigint not null default 0;
alter table public.sample_reviews add column title_revision bigint not null default 0;
alter table public.calendar_posts add constraint calendar_posts_title_revision_nonnegative
  check (title_revision >= 0);
alter table public.sample_reviews add constraint sample_reviews_title_revision_nonnegative
  check (title_revision >= 0);
alter table public.mirror_outbox drop constraint mirror_outbox_legacy_parity_operation_check;
alter table public.mirror_outbox add constraint mirror_outbox_legacy_parity_operation_check
  check (legacy_parity = false or operation in ('create','status','comment','title'));
`;

const cases = [
  ['partial_revision_boundary', `alter table public.calendar_posts
    add column title_revision bigint not null default 0;`],
  ['dependency_owner_acl_drift', `revoke execute on function
    public.production_assert_authority(text,text,boolean,boolean) from current_user;`],
  ['dependency_foreign_grant', `grant execute on function
    public.production_assert_authority(text,text,boolean,boolean) to authenticated;`],
  ['open_title_intent', `insert into public.mirror_outbox(
      op,payload,entity,entity_id,operation,client_slug,team,dedup_key,
      source_edited_at,status,legacy_parity,authority_generation
    ) values ('update_fields','{}','deliverable','proof-open','title',
      'f133-client','video','proof-open-title',now(),'pending',false,7);`],
  ['foreign_f133_function', `create function public.production_canonical_title_decoy()
    returns void language sql as 'select';`],
  ['retained_not_valid_revision_check', `${retained}
    alter table public.calendar_posts drop constraint calendar_posts_title_revision_nonnegative;
    alter table public.calendar_posts add constraint calendar_posts_title_revision_nonnegative
      check (title_revision >= 0) not valid;`],
  ['retained_wrong_table_revision_check', `${retained}
    alter table public.sample_reviews drop constraint sample_reviews_title_revision_nonnegative;
    alter table public.batches add column title_revision bigint not null default 0;
    alter table public.batches add constraint sample_reviews_title_revision_nonnegative
      check (title_revision >= 0);`],
  ['retained_widened_outbox_check', `${retained}
    alter table public.mirror_outbox drop constraint mirror_outbox_legacy_parity_operation_check;
    alter table public.mirror_outbox add constraint mirror_outbox_legacy_parity_operation_check
      check (legacy_parity = false or operation in ('create','status','comment','title','archive'));`],
];

for (let index = 0; index < cases.length; index += 1) {
  const [name, sabotage] = cases[index];
  const database = `f133_gate_${process.pid}_${index}`;
  if (!/^f133_gate_[0-9]+_[0-9]+$/.test(database)) throw new Error('F133_GATE_PROOF_DB_INVALID');
  run('postgres', `create database ${database};`);
  try {
    run(database, fixture);
    run(database, sabotage);
    const before = stateDigest(database);
    const failed = spawnSync('psql', [
      '-X', '-v', 'ON_ERROR_STOP=1', '-d', database, '-f', migrationPath,
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (failed.status === 0
        || !/f133_preinstall_(entry_state_required|dependency_acl_drift)/.test(failed.stderr)) {
      throw new Error(`F133_GATE_PROOF_${name.toUpperCase()}_DID_NOT_FAIL`);
    }
    if (stateDigest(database) !== before) {
      throw new Error(`F133_GATE_PROOF_${name.toUpperCase()}_LEFT_DDL`);
    }
  } finally {
    run('postgres', `drop database ${database} with (force);`);
  }
}

process.stdout.write(`${JSON.stringify({
  status: 'PASS', gate: 'f133_preinstall_fail_closed', red_cases: cases.length,
})}\n`);

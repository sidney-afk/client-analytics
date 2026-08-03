'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { compactLinearRaw } = require('../scripts/linear-deliverables-reconcile');

if (process.env.F63_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP: bounded reconciler PostgreSQL proof uses the disposable CI database');
  process.exit(0);
}

const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
const pgHost = String(process.env.PGHOST || '').trim().toLowerCase();
assert.ok(allowedHosts.has(pgHost), 'bounded reconciler proof refuses non-loopback PostgreSQL');
assert.strictEqual(String(process.env.PGDATABASE || ''), 'postgres');
assert.ok(/^\d+$/.test(String(process.env.PGPORT || '')));
assert.ok(String(process.env.PGUSER || '').trim());

const root = path.resolve(__dirname, '..');
const database = `reconcile_bounded_${process.pid}_${Date.now()}`;
assert.match(database, /^reconcile_bounded_[a-z0-9_]+$/);
const psqlEnv = {};
for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'LANG', 'LC_ALL']) {
  if (process.env[name] !== undefined) psqlEnv[name] = process.env[name];
}
Object.assign(psqlEnv, {
  PGHOST: pgHost,
  PGPORT: String(process.env.PGPORT),
  PGUSER: String(process.env.PGUSER),
  PGPASSWORD: String(process.env.PGPASSWORD || ''),
  PGDATABASE: 'postgres',
  PGSSLMODE: 'disable',
});

function runPsql(targetDatabase, sql, expectSuccess = true) {
  const result = spawnSync(
    'psql',
    ['-X', '--quiet', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--dbname', targetDatabase, '--file', '-'],
    {
      cwd: root,
      env: psqlEnv,
      input: sql,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30000,
    },
  );
  if (result.error) throw result.error;
  if (expectSuccess && result.status !== 0) {
    throw new Error(`psql failed (${result.status}): ${(result.stderr || result.stdout || '').trim()}`);
  }
  if (!expectSuccess && result.status === 0) throw new Error('psql unexpectedly succeeded');
  return result;
}

function scalar(targetDatabase, sql) {
  const result = runPsql(targetDatabase, `${sql.replace(/;\s*$/, '')};\n`);
  const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  assert.strictEqual(lines.length, 1, `expected one scalar row for ${sql}`);
  return lines[0];
}

const fixtureRaw = {
  issue: {
    id: 'l1',
    identifier: 'VID-1',
    url: 'https://linear/VID-1',
    parent: { id: 'p1', ignored: true },
    createdAt: '2026-07-01T00:00:00Z',
    completedAt: null,
    description: 'large-source-only-value',
  },
  attribution: {
    schema: 'syncview_attribution_v1',
    state: 'resolved',
    client_slug: 'client',
    reason: null,
    provisional_client_slug: null,
  },
  parent: { id: 'legacy-parent' },
  nested: { deleted: false, unmapped_state: 0 },
};
const quotedRaw = JSON.stringify(fixtureRaw).replace(/'/g, "''");
const schemaSql = `
create schema extensions;
create extension pgcrypto with schema extensions;
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end;
$roles$;
alter role service_role bypassrls;
create table public.deliverables (
  id text primary key,
  identifier text,
  batch_id text not null,
  client_slug text not null,
  team text not null,
  kind text not null,
  title text not null,
  status text not null,
  status_at timestamptz,
  assignee_id uuid,
  due_date date,
  priority smallint,
  origin text not null,
  card_id text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linear_issue_uuid text,
  linear_identifier text,
  linear_issue_url text,
  linear_raw jsonb
);
create table public.deliverable_events (
  id bigint generated always as identity primary key,
  deliverable_id text,
  action text not null,
  source text not null,
  payload jsonb,
  ts timestamptz not null default now()
);
insert into public.deliverables (
  id, identifier, batch_id, client_slug, team, kind, title, status, origin,
  linear_issue_uuid, linear_raw
) values
  ('d1', 'VID-1', 'b1', 'client', 'video', 'video', 'One', 'in_progress', 'manual', 'l1', '${quotedRaw}'::jsonb),
  ('d2', 'VID-2', 'b1', 'client', 'video', 'video', 'Two', 'archived', 'manual', 'l2',
   '{"issue":{"id":"l2"},"nested":[{"removed":{"reason":"legacy"}}]}'::jsonb);
insert into public.deliverable_events(deliverable_id, action, source, payload) values
  ('d1', 'COMMENT_A', 'ui', '{"linear_comment_id":"c1"}'),
  ('d1', 'comment_b', 'mirror', '{"comment_id":"c2"}'),
  ('d1', 'comment_c', 'outbound', '{"comment":{"linear_comment_id":"c3"}}'),
  ('d1', 'comment_d', 'mirror', '{"comment":{"native_comment_id":"c4"}}'),
  ('d1', 'comment_e', 'mirror', '{"comment":{"id":"c5"}}'),
  ('d1', 'comment_f', 'mirror', '{"linear_comment":{"id":"c6"}}'),
  ('d1', 'comment_dup', 'mirror', '{"linear_comment_id":"c1"}'),
  ('d1', 'status', 'mirror', '{"linear_comment_id":"ignored"}');
`;
const migration = fs.readFileSync(
  path.join(root, 'migrations', '2026-08-03-linear-reconciler-bounded-inputs.sql'),
  'utf8',
);

let created = false;
try {
  assert.match(scalar('postgres', 'show server_version_num'), /^16\d{4}$/);
  runPsql('postgres', `create database "${database}" template template0;`);
  created = true;
  runPsql(database, schemaSql);
  runPsql(database, migration);

  assert.strictEqual(scalar(database, 'select count(*) from public.linear_deliverables_reconcile_input_v1'), '2');
  assert.strictEqual(scalar(database, 'select ready::text from public.linear_reconcile_projection_status_v1'), 'true');
  assert.strictEqual(scalar(database, "select count(*) from public.linear_deliverable_comment_ids_v1 where deliverable_id='d1'"), '6');
  assert.strictEqual(
    scalar(database, "select string_agg(linear_comment_id, ',' order by latest_ts desc, latest_event_id desc) from public.linear_deliverable_comment_ids_v1 where deliverable_id='d1'"),
    'c1,c6,c5,c4,c3,c2',
  );
  assert.strictEqual(
    scalar(database, `select count(*) from pg_trigger
      where not tgisinternal
        and tgname in ('linear_reconcile_deliverable_cache_after','linear_reconcile_comment_event_after')`),
    '0',
    'compute-on-read must install no source-table trigger',
  );
  assert.strictEqual(
    scalar(database, `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public'
        and c.relname in ('linear_reconcile_deliverable_cache','linear_reconcile_comment_event_map')`),
    '0',
    'compute-on-read must install no writable sidecar relation',
  );
  assert.strictEqual(scalar(database, "select linear_raw->>'archived' from public.linear_deliverables_reconcile_input_v1 where id='d2'"), 'true');
  assert.strictEqual(scalar(database, "select (linear_raw ? 'unmapped_state')::text from public.linear_deliverables_reconcile_input_v1 where id='d1'"), 'false');
  assert.deepStrictEqual(
    JSON.parse(scalar(database, "select linear_raw::text from public.linear_deliverables_reconcile_input_v1 where id='d1'")),
    compactLinearRaw(fixtureRaw),
    'PostgreSQL and JavaScript compact projections must match exactly',
  );
  assert.strictEqual(scalar(database, `select (linear_raw::text like '%large-source-only-value%')::text from public.linear_deliverables_reconcile_input_v1 where id='d1'`), 'false');
  assert.strictEqual(scalar(database, `select (linear_raw::text like '%large-source-only-value%')::text from public.linear_deliverables_reconcile_hydrate(array['d1'])`), 'true');

  runPsql(database, `
update public.deliverables
set title='One updated', linear_raw=linear_raw || '{"stale_linear_regress":true}'::jsonb
where id='d1';
insert into public.deliverable_events(deliverable_id,action,source,payload)
values ('d1','comment_new','mirror','{"linear_comment_id":"c7"}');
update public.deliverable_events
set action='status'
where payload->>'comment_id'='c2';
`);
  assert.strictEqual(scalar(database, "select title from public.linear_deliverables_reconcile_input_v1 where id='d1'"), 'One updated');
  assert.strictEqual(scalar(database, "select linear_raw->>'refused_stale_regress' from public.linear_deliverables_reconcile_input_v1 where id='d1'"), 'true');
  assert.strictEqual(scalar(database, "select count(*) from public.linear_deliverable_comment_ids_v1 where deliverable_id='d1' and linear_comment_id='c7'"), '1');
  assert.strictEqual(scalar(database, "select count(*) from public.linear_deliverable_comment_ids_v1 where deliverable_id='d1' and linear_comment_id='c2'"), '0');

  runPsql(database, `
insert into public.deliverable_events(deliverable_id,action,source,payload) values
  ('d1','comment_false_fallback','mirror','{"linear_comment_id":false,"comment_id":"c8"}'),
  ('d1','comment_blank_stops','mirror','{"linear_comment_id":"   ","comment_id":"must-not-fallback"}');
`);
  assert.strictEqual(scalar(database, "select count(*) from public.linear_deliverable_comment_ids_v1 where linear_comment_id='c8'"), '1');
  assert.strictEqual(scalar(database, "select count(*) from public.linear_deliverable_comment_ids_v1 where linear_comment_id='must-not-fallback'"), '0');

  assert.strictEqual(scalar(database, "select has_table_privilege('service_role','public.linear_deliverables_reconcile_input_v1','select')::text"), 'true');
  assert.strictEqual(scalar(database, "select has_table_privilege('service_role','public.deliverables','select')::text"), 'false');
  assert.strictEqual(scalar(database, "select has_column_privilege('service_role','public.deliverables','linear_raw','select')::text"), 'true');
  assert.strictEqual(scalar(database, "select has_column_privilege('service_role','public.deliverable_events','payload','select')::text"), 'true');
  assert.strictEqual(
    scalar(database, `select (
      has_table_privilege('service_role','public.deliverables','insert') or
      has_table_privilege('service_role','public.deliverables','update') or
      has_table_privilege('service_role','public.deliverables','delete') or
      has_table_privilege('service_role','public.deliverables','truncate') or
      has_table_privilege('service_role','public.deliverables','references') or
      has_table_privilege('service_role','public.deliverables','trigger')
    )::text`),
    'false',
  );
  assert.strictEqual(
    scalar(database, `select (
      has_table_privilege('service_role','public.deliverable_events','insert') or
      has_table_privilege('service_role','public.deliverable_events','update') or
      has_table_privilege('service_role','public.deliverable_events','delete') or
      has_table_privilege('service_role','public.deliverable_events','truncate') or
      has_table_privilege('service_role','public.deliverable_events','references') or
      has_table_privilege('service_role','public.deliverable_events','trigger')
    )::text`),
    'false',
  );
  assert.strictEqual(scalar(database, "select has_function_privilege('anon','public.linear_reconcile_compact_raw(jsonb)','execute')::text"), 'false');
  assert.strictEqual(scalar(database, "select has_function_privilege('service_role','public.linear_reconcile_compact_raw(jsonb)','execute')::text"), 'true');
  assert.strictEqual(
    scalar(database, 'set role service_role; select count(*) from public.linear_deliverables_reconcile_input_v1; reset role'),
    '2',
  );
  assert.strictEqual(
    scalar(database, 'set role service_role; select count(*) from public.linear_deliverable_comment_ids_v1; reset role'),
    '7',
  );
  runPsql(database, 'set role anon; select count(*) from public.linear_deliverables_reconcile_input_v1;', false);

  const tooManyIds = Array.from({ length: 101 }, (_, index) => `'id-${index}'`).join(',');
  const capped = runPsql(
    database,
    `select * from public.linear_deliverables_reconcile_hydrate(array[${tooManyIds}]);`,
    false,
  );
  assert.match(`${capped.stderr}\n${capped.stdout}`, /requires 1\.\.100 unique nonempty ids/);
  console.log('linear-deliverables-reconcile PostgreSQL bounded-read checks passed');
} finally {
  if (created) {
    runPsql('postgres', `
select pg_terminate_backend(pid)
from pg_stat_activity
where datname='${database}' and pid <> pg_backend_pid();
drop database "${database}";
`);
  }
}

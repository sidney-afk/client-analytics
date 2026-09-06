'use strict';
/*
 * Native-intake reliability proof: shared harness.
 *
 * Stands up the SAME disposable PostgreSQL 16 the F42 and component-fill
 * rehearsals use (scripts/f42-apply-rehearsal.js exports the Cluster and its
 * FOUNDATION_SQL), applies the REAL migration chain behind Submit root intake,
 * append and component fill, and seeds a synthetic fixture. Every lane in this
 * directory runs against that database; nothing here reaches a live backend.
 *
 * Reused rather than forked on purpose: a second copy of the schema bootstrap
 * is how a proof drifts from the thing it proves.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Cluster, FOUNDATION_SQL } = require('../f42-apply-rehearsal.js');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');

/* The live order. Everything the intake/append/fill RPCs and the gateway's
   pre-write reads touch: data model, outbound intent trigger, comment ledger,
   write-UI parity RPCs (assert_authority / outbox_replay / *_write), the F27
   write-authorization fence the gateway reads before every create, batch
   purpose, the public-intake rate ledger, then the two subject RPCs. */
const CHAIN = [
  '2026-07-06-b1-linear-data-model.sql',
  '2026-07-11-b4-linear-outbound.sql',
  '2026-07-12-production-comments.sql',
  '2026-07-12-write-ui-outbox-parity.sql',
  '2026-07-28-f27-write-authorization-only.sql',
  '2026-08-19-samples-batch-purpose.sql',
  '2026-08-19-samples-batch-write-purpose.sql',
  '2026-08-24-public-intake-log.sql',
];
/* Compiled with check_function_bodies = on, like the fill rehearsal does. */
const SUBJECTS = [
  '2026-08-26-production-intake-append-v7.sql',
  '2026-08-31-production-component-fill.sql',
];

function have(bin) {
  if (fs.existsSync('/usr/lib/postgresql/16/bin/' + bin)) return true;
  const r = require('child_process').spawnSync('bash', ['-lc', 'command -v ' + bin], { encoding: 'utf8' });
  return r.status === 0;
}

/* Synthetic only. Slugs, names and ids below are invented for this proof and
   name no real client, colleague, project or issue.
   The F42 foundation stubs both card tables as id-only; the fill RPC and the
   orphan-card inventory read four more columns, added below with the names and
   types the fill rehearsal checked against the REST schema on 2026-08-31. */
const FIXTURE_SQL = `
set time zone 'UTC';
alter table public.clients add column if not exists linear_project_ids jsonb;
insert into public.clients(slug, display_name, active, kind, linear_project_ids)
values ('fixture-client', 'Fixture Client', true, 'client',
        '{"video":"proj_fixture_shared","graphics":"proj_fixture_shared"}'::jsonb),
       ('fixture-split', 'Fixture Split', true, 'client',
        '{"video":"proj_fixture_video","graphics":"proj_fixture_graphics"}'::jsonb),
       ('fixture-unmapped', 'Fixture Unmapped', true, 'client', null),
       ('fixture-inactive', 'Fixture Inactive', false, 'client',
        '{"video":"proj_fixture_video","graphics":"proj_fixture_graphics"}'::jsonb)
on conflict (slug) do nothing;

insert into public.team_members(id, name, role, team, linear_user_id, default_for_team, active) values
  ('11111111-1111-4111-8111-111111111111', 'Fixture Admin', 'admin', null, null, false, true),
  ('22222222-2222-4222-8222-222222222222', 'Fixture Manager', 'smm', null, null, false, true),
  ('33333333-3333-4333-8333-333333333331', 'Fixture Editor One', 'editor', 'video', 'lin_user_editor_one', false, true),
  ('33333333-3333-4333-8333-333333333332', 'Fixture Editor Two', 'editor', 'video', 'lin_user_editor_two', false, true),
  ('44444444-4444-4444-8444-444444444441', 'Fixture Designer', 'designer', 'graphics', 'lin_user_designer', true, true)
on conflict (id) do nothing;

insert into public.syncview_runtime_flags(key, value) values
  ('prod_authority', '{"video":"syncview","graphics":"syncview"}'::jsonb),
  ('linear_legacy_parity_enabled', '{"enabled":true}'::jsonb),
  ('linear_outbound_enabled', '{"mode":"off"}'::jsonb)
on conflict (key) do update set value = excluded.value;
update public.syncview_runtime_flags set value = '{"enabled": true}'::jsonb where key = 'public_intake_enabled';

alter table public.calendar_posts add column if not exists client text;
alter table public.calendar_posts add column if not exists status text;
alter table public.calendar_posts add column if not exists video_deliverable_id text;
alter table public.calendar_posts add column if not exists graphic_deliverable_id text;
alter table public.sample_reviews add column if not exists client text;
alter table public.sample_reviews add column if not exists status text;
alter table public.sample_reviews add column if not exists video_deliverable_id text;
alter table public.sample_reviews add column if not exists graphic_deliverable_id text;
create unique index if not exists calendar_posts_client_id_nir on public.calendar_posts (client, id);
create unique index if not exists sample_reviews_client_id_nir on public.sample_reviews (client, id);
`;

function bootCluster() {
  const cluster = new Cluster();
  cluster.start();
  cluster.exec(FOUNDATION_SQL);
  for (const file of CHAIN) cluster.runFile(path.join(MIGRATIONS, file));
  cluster.exec('alter database ' + cluster.db + ' set check_function_bodies = on;');
  for (const file of SUBJECTS) cluster.runFile(path.join(MIGRATIONS, file));
  cluster.exec(FIXTURE_SQL);
  return cluster;
}

function connectionEnv(cluster) {
  return {
    NIR_PGHOST: cluster.host,
    NIR_PGPORT: String(cluster.port),
    NIR_PGUSER: cluster.user,
    NIR_PGDATABASE: cluster.db,
    NIR_PSQL: cluster.psql,
  };
}

/* Asynchronous psql, so two sessions can genuinely overlap in the database.
   Returns {status, stdout, stderr}; never throws on a SQL error. */
function psqlAsync(env, sql) {
  return new Promise(resolve => {
    const args = ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A',
      '-h', env.NIR_PGHOST, '-p', env.NIR_PGPORT, '-U', env.NIR_PGUSER, '-d', env.NIR_PGDATABASE];
    const child = spawn(env.NIR_PSQL || 'psql', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
    child.stdin.end('\\set VERBOSITY verbose\nset time zone \'UTC\';\n' + sql + '\n');
  });
}

function scalar(cluster, sql) {
  return cluster.run('', null, { sql, tuplesOnly: true }).trim();
}
function jsonRows(cluster, sql) {
  const out = scalar(cluster, `select coalesce(json_agg(t), '[]'::json) from (${sql}) t;`);
  return out ? JSON.parse(out) : [];
}
function count(cluster, sql) {
  return Number(scalar(cluster, `select count(*) from (${sql}) t;`));
}

module.exports = {
  ROOT, MIGRATIONS, CHAIN, SUBJECTS, FIXTURE_SQL, have,
  bootCluster, connectionEnv, psqlAsync, scalar, jsonRows, count,
};

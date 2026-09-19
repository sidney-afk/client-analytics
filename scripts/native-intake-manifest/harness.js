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
  // Added by the 2026-09-15 catch-up. The gateway's roster read now names
  // team_members.auto_assign_opt_out, so a fixture built without this additive
  // column makes every assignee lookup fail 503 assignee_lookup_unavailable.
  // This list binds to the live schema, so a new migration on main has to land
  // here too, exactly as the migration's own note warns: apply it before the
  // code that selects the column.
  '2026-09-14-team-members-auto-assign-opt-out.sql',
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
-- Current gateway selects this prerequisite even for provider-mapped clients.
-- The complete provisioning migration is exercised by its dedicated SQL lane.
alter table public.clients add column if not exists native_project_ids jsonb not null default '{}'::jsonb;
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

/*
 * THE OPEN-WORK COUNT LIVES IN THE DATABASE (2026-09-19).
 *
 * `production_native_intake_open_load` replaced the two full reads the gateway
 * used to count open video work with in TypeScript, because the parent half had
 * reached 3,232 rows against PostgREST's 1,000-row cap and the Create Post
 * editor picker -- correctly -- refused the truncated answer. Every lane on this
 * harness runs intake or the picker, so a fixture without the routine makes the
 * gateway refuse, which is exactly what it does against a database the migration
 * has not been applied to. Same rule as the CHAIN note above: a new migration
 * the gateway depends on has to land here too.
 *
 * Two objects, both taken VERBATIM from the repository rather than modelled:
 *
 *  - the browser projection's real `raw_issue_parent_id` CASE. The intake chain
 *    omits that view, and a `language sql` function is parsed and validated at
 *    CREATE time, so the view has to exist first. Only the six columns these
 *    lanes consume are projected; artifact, label and attribution columns stay
 *    outside the fixture. This block was inline in
 *    test/native-intake-editor-projection.js, which is the only lane that had
 *    needed it before the count moved into SQL.
 *
 *  - the migration's own function body, located by its declaration and closing
 *    dollar tag. Its `revoke`/`grant` lines are deliberately NOT applied: they
 *    name hosted roles a disposable cluster does not have, and the ACL is what
 *    the deploy preflight proves against the real database.
 *
 * Both seams throw on drift rather than quietly installing something else.
 */
function installIntakeOpenLoad(cluster) {
  const view = fs.readFileSync(path.join(MIGRATIONS, '2026-08-23-attribution-slug-guard-widening.sql'), 'utf8');
  const parentEnd = view.indexOf('END AS raw_issue_parent_id');
  const parentStart = view.lastIndexOf('CASE', parentEnd);
  if (parentStart < 0 || parentEnd < parentStart) throw new Error('browser-view parent expression drift');
  cluster.exec(`create view public.production_deliverables_browser_v1 as
    select d.id,d.assignee_id,d.linear_issue_uuid,d.team,d.status,${view.slice(parentStart, parentEnd + 'END AS raw_issue_parent_id'.length)}
    from public.deliverables d cross join lateral jsonb_to_record(
      case when jsonb_typeof(d.linear_raw)='object' then d.linear_raw else '{}'::jsonb end) root(issue jsonb);`);
  const migration = fs.readFileSync(path.join(MIGRATIONS, '2026-09-19-native-intake-open-load.sql'), 'utf8');
  const start = migration.indexOf('create function public.production_native_intake_open_load(');
  const end = migration.indexOf('$fn$;', start);
  if (start < 0 || end < start) throw new Error('open-load function seam drift');
  cluster.exec(migration.slice(start, end + '$fn$;'.length));
}

function bootCluster() {
  const cluster = new Cluster();
  cluster.start();
  cluster.exec(FOUNDATION_SQL);
  for (const file of CHAIN) cluster.runFile(path.join(MIGRATIONS, file));
  cluster.exec('alter database ' + cluster.db + ' set check_function_bodies = on;');
  for (const file of SUBJECTS) cluster.runFile(path.join(MIGRATIONS, file));
  installIntakeOpenLoad(cluster);
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

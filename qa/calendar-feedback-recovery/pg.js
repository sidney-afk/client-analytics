'use strict';
// Disposable PostgreSQL 16 for the Calendar feedback recovery lane.
//
// Starts (or reuses via CALENDAR_RECOVERY_PG=host:port:user) a throwaway
// cluster, loads the live schema baseline plus the production-comment deltas
// and the candidate migration, and exposes psql-backed helpers. Nothing here
// knows a real project ref, key or hostname; the only credentials are the
// synthetic ones the fixture mints. No network is used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS = [
  'live-schema-baseline-2026-07-03.sql',
  '2026-06-18-atomic-comment-merge.sql',
  '2026-07-03-a1-calendar-upsert.sql',
  '2026-07-04-a2-writer-edge-functions.sql',
  '2026-07-05-b0-linear-auth-scaffold.sql',
  '2026-07-06-b1-linear-data-model.sql',
  '2026-07-06-b1-deliverable-kind-other.sql',
  '2026-07-10-urgent-tweak-pings.sql',
  '2026-07-11-b4-linear-outbound.sql',
  '2026-07-11-b4-write-attribution.sql',
  '2026-07-12-production-comments.sql',
  '2026-07-12-write-ui-outbox-parity.sql',
  '2026-07-13-write-ui-fix-pack-flags.sql',
  '2026-07-13-write-ui-reroute-allowlist.sql',
  '2026-07-23-production-comment-thread-lifecycle.sql',
  '2026-07-28-f27-write-authorization-only.sql',
  '2026-07-28-linear-project-ids-team-shape.sql',
  '2026-08-04-client-access-auto-provision.sql',
];
const CANDIDATE_MIGRATION = '2026-09-05-calendar-feedback-recovery.sql';
// The baseline dump creates two triggers before their functions. Its function
// bodies also end without a statement terminator, which psql would otherwise
// merge into the following statement; the loader adds the terminators to a
// private copy. Every other statement must succeed.
const BASELINE_KNOWN_ERRORS = [
  /function calendar_posts_stamp_status_at\(\) does not exist/,
  /function sample_reviews_stamp_status_at\(\) does not exist/,
];

function pgBin(name) {
  const candidates = [];
  for (const dir of ['/usr/lib/postgresql'].filter(d => fs.existsSync(d))) {
    for (const version of fs.readdirSync(dir).sort().reverse()) candidates.push(path.join(dir, version, 'bin', name));
  }
  candidates.push(name);
  return candidates.find(c => c === name || fs.existsSync(c));
}

function lit(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return lit(JSON.stringify(value)) + '::jsonb';
  const tag = '$q' + crypto.randomBytes(4).toString('hex') + '$';
  return tag + String(value) + tag;
}
function ident(name) {
  assert.match(String(name), /^[a-z_][a-z0-9_]*$/, 'identifier');
  return '"' + name + '"';
}

class Db {
  constructor(conn, database) { this.conn = conn; this.database = database; }
  psql(sql, { stopOnError = true, quiet = true } = {}) {
    const args = ['-X', '-v', `ON_ERROR_STOP=${stopOnError ? 1 : 0}`, '-At', '-h', this.conn.host, '-p', String(this.conn.port),
      '-U', this.conn.user, '-d', this.database, '-c', sql];
    if (quiet) args.unshift('-q');
    const result = spawnSync(pgBin('psql'), args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
    if (result.status !== 0) {
      const error = new Error((result.stderr || result.stdout || 'psql failed').trim());
      error.stderr = result.stderr; throw error;
    }
    return result.stdout;
  }
  file(file, { stopOnError = true } = {}) {
    const args = ['-X', '-v', `ON_ERROR_STOP=${stopOnError ? 1 : 0}`, '-q', '-h', this.conn.host, '-p', String(this.conn.port),
      '-U', this.conn.user, '-d', this.database, '-f', file];
    const result = spawnSync(pgBin('psql'), args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
    const errors = (result.stderr || '').split('\n').filter(line => /ERROR:/.test(line));
    if (stopOnError && result.status !== 0) throw new Error(result.stderr);
    return { errors, status: result.status };
  }
  run(sql) { return this.psql(sql); }
  rows(sql) {
    const out = this.psql(`select coalesce(json_agg(row_to_json(t)), '[]')::text from (${sql}) t`);
    return JSON.parse(out.trim() || '[]');
  }
  one(sql) { const rows = this.rows(sql); assert.ok(rows.length <= 1, 'one row'); return rows[0] || null; }
  scalar(sql) { const row = this.one(`select (${sql}) as value`); return row ? row.value : null; }
  count(table, where = 'true') { return Number(this.scalar(`select count(*) from ${ident(table)} where ${where}`)); }
}

class Cluster {
  static fromEnv() {
    // CI provides a disposable postgres:16 service through the standard PG*
    // variables (calendar-unit-tests.yml); CALENDAR_RECOVERY_PG=host:port:user
    // names one explicitly. Either way psql inherits PGPASSWORD from the env.
    const spec = process.env.CALENDAR_RECOVERY_PG;
    if (spec) { const [host, port, user] = spec.split(':'); return { host, port: Number(port), user: user || 'postgres', external: true, stop() {} }; }
    if (process.env.PGHOST) return { host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || 'postgres', external: true, stop() {} };
    return null;
  }
  static available() {
    return !!Cluster.fromEnv() || !!(pgBin('initdb') !== 'initdb' || spawnSync('bash', ['-lc', 'command -v initdb'], { encoding: 'utf8' }).status === 0);
  }
  static start() {
    const existing = Cluster.fromEnv();
    if (existing) return existing;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncview-cfr-pg-'));
    fs.chmodSync(dir, 0o777);
    const port = 54400 + Math.floor(Math.random() * 400);
    const data = path.join(dir, 'data');
    const shell = `${pgBin('initdb')} -D ${data} -U postgres --auth=trust -E UTF8 >${dir}/initdb.log 2>&1 && ${pgBin('pg_ctl')} -D ${data} -o '-k ${dir} -p ${port} -c listen_addresses= -c fsync=off -c synchronous_commit=off' -l ${dir}/server.log start >${dir}/start.log 2>&1`;
    const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    const result = asRoot
      ? spawnSync('su', ['postgres', '-s', '/bin/bash', '-c', shell], { encoding: 'utf8' })
      : spawnSync('/bin/bash', ['-c', shell], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error('disposable PostgreSQL could not start: ' + (result.stderr || result.stdout) + fs.readFileSync(path.join(dir, 'initdb.log'), 'utf8'));
    }
    const cluster = { host: dir, port, user: 'postgres', dir, external: false,
      stop() {
        const stop = `${pgBin('pg_ctl')} -D ${data} -m immediate stop >/dev/null 2>&1`;
        if (asRoot) spawnSync('su', ['postgres', '-s', '/bin/bash', '-c', stop]); else spawnSync('/bin/bash', ['-c', stop]);
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
      } };
    for (let attempt = 0; attempt < 50; attempt++) {
      const probe = spawnSync(pgBin('psql'), ['-X', '-At', '-h', dir, '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-c', 'select 1'], { encoding: 'utf8' });
      if (probe.status === 0) return cluster;
      execFileSync('sleep', ['0.2']);
    }
    throw new Error('disposable PostgreSQL did not accept connections');
  }
}

function createDatabase(cluster, name) {
  const admin = new Db(cluster, 'postgres');
  for (const role of ['anon', 'authenticated', 'service_role', 'supabase_admin']) {
    admin.run(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`);
  }
  admin.run(`drop database if exists ${ident(name)}`);
  admin.run(`create database ${ident(name)}`);
  const db = new Db(cluster, name);
  db.run(`create schema if not exists extensions; create extension if not exists pgcrypto; create publication supabase_realtime`);
  return db;
}

function loadSchema(db, { candidate = true } = {}) {
  const report = { applied: [], baseline_errors: [] };
  for (const file of MIGRATIONS) {
    let full = path.join(ROOT, 'migrations', file);
    const isBaseline = file.startsWith('live-schema-baseline');
    if (isBaseline) {
      const text = fs.readFileSync(full, 'utf8').replace(/^\$function\$[ \t]*$/gm, '$function$;');
      full = path.join(os.tmpdir(), 'syncview-cfr-baseline-' + process.pid + '.sql');
      fs.writeFileSync(full, text);
    }
    const result = db.file(full, { stopOnError: !isBaseline });
    if (isBaseline) fs.unlinkSync(full);
    if (isBaseline) {
      report.baseline_errors = result.errors;
      for (const line of result.errors) assert.ok(BASELINE_KNOWN_ERRORS.some(re => re.test(line)), 'unexpected baseline error: ' + line);
      assert.equal(result.errors.length, BASELINE_KNOWN_ERRORS.length, 'baseline error set changed');
      db.run(`create trigger trg_calendar_posts_stamp_status_at before insert or update on calendar_posts for each row execute function calendar_posts_stamp_status_at();
        create trigger trg_sample_reviews_stamp_status_at before insert or update on sample_reviews for each row execute function sample_reviews_stamp_status_at()`);
    }
    report.applied.push(file);
  }
  if (candidate) {
    db.file(path.join(ROOT, 'migrations', CANDIDATE_MIGRATION));
    report.applied.push(CANDIDATE_MIGRATION);
  }
  return report;
}

// One fictional client, one card with linked video and graphic deliverables,
// authority SyncView for both teams, gateway and EF flags on for the client.
const FIXTURE = Object.freeze({
  client: { slug: 'lifecyclealpha', display_name: 'Lifecycle Alpha', token: 'fictional-client-token' },
  other: { slug: 'lifecyclebeta', display_name: 'Lifecycle Beta', token: 'fictional-other-token' },
  card: 'fixture-card-alpha',
  video: '00000000-0000-4000-8000-000000000201',
  graphic: '00000000-0000-4000-8000-000000000202',
  clock: '2026-01-10T12:00:00.000Z',
});

function seedFixture(db, options = {}) {
  const f = FIXTURE;
  const status = options.status || 'Client Approval';
  db.run(`truncate table public.calendar_posts, public.calendar_post_events, public.production_comments, public.production_comment_mutation_receipts,
    public.mirror_outbox, public.deliverable_events, public.deliverables, public.batches, public.clients, public.client_access, public.team_members,
    public.syncview_runtime_flags, public.track_b_f27_team_fences, public.calendar_feedback_materializations restart identity cascade`);
  db.run(`insert into public.clients (slug, display_name, active, kind, linear_project_ids) values
    (${lit(f.client.slug)}, ${lit(f.client.display_name)}, true, 'client', ${lit([{ id: 'fixture-project-alpha' }])}),
    (${lit(f.other.slug)}, ${lit(f.other.display_name)}, true, 'client', ${lit([{ id: 'fixture-project-beta' }])})`);
  db.run(`insert into public.client_access (slug, review_token) values (${lit(f.client.slug)}, ${lit(f.client.token)}), (${lit(f.other.slug)}, ${lit(f.other.token)}) on conflict (slug) do update set review_token = excluded.review_token`);
  db.run(`insert into public.team_members (id, name, role, team, active) values
    ('00000000-0000-4000-8000-000000000100', 'Fixture smm', 'smm', null, true),
    ('00000000-0000-4000-8000-000000000101', 'Fixture admin', 'admin', null, true),
    ('00000000-0000-4000-8000-000000000102', 'Fixture editor', 'editor', 'video', true),
    ('00000000-0000-4000-8000-000000000103', 'Fixture designer', 'designer', 'graphics', true)`);
  const clients = { clients: [f.client.slug, f.other.slug] };
  db.run(`insert into public.syncview_runtime_flags (key, value) values
    ('prod_authority', ${lit({ video: 'syncview', graphics: 'syncview' })}),
    ('linear_outbound_enabled', ${lit({ mode: 'off' })}),
    ('client_comment_gateway_enabled', ${lit({ enabled: true })}),
    ('calendar_upsert_ef_clients', ${lit(clients)}),
    ('sample_review_ef_clients', ${lit(clients)}),
    ('settings_ef_clients', ${lit(clients)}),
    ('write_ui_reroute_clients', ${lit(clients)})
    on conflict (key) do update set value = excluded.value`);
  db.run(`insert into public.track_b_f27_team_fences (team, generation, updated_by) values ('video', 7, 'fixture'), ('graphics', 7, 'fixture') on conflict (team) do update set generation = excluded.generation`);
  const nativeStatus = { 'Client Approval': 'client_approval', 'Tweaks Needed': 'tweak', Approved: 'approved', 'In Progress': 'in_progress' }[status];
  db.run(`insert into public.batches (id, client_slug, team, name, status) values
    ('fixture-batch-video', ${lit(f.client.slug)}, 'video', 'Fictional video batch', 'active'),
    ('fixture-batch-graphics', ${lit(f.client.slug)}, 'graphics', 'Fictional graphics batch', 'active')`);
  db.run(`insert into public.deliverables (id, batch_id, client_slug, team, kind, title, status, status_at, origin, card_id, sync_state, created_at, updated_at) values
    (${lit(f.video)}, 'fixture-batch-video', ${lit(f.client.slug)}, 'video', 'video', 'Fictional lifecycle card', ${lit(nativeStatus)}, ${lit(f.clock)}, 'calendar', ${lit(f.card)}, 'clean', ${lit(f.clock)}, ${lit(f.clock)}),
    (${lit(f.graphic)}, 'fixture-batch-graphics', ${lit(f.client.slug)}, 'graphics', 'thumbnail', 'Fictional lifecycle card', ${lit(nativeStatus)}, ${lit(f.clock)}, 'calendar', ${lit(f.card)}, 'clean', ${lit(f.clock)}, ${lit(f.clock)})`);
  const row = Object.assign({
    id: f.card, client: f.client.slug, name: 'Fictional lifecycle card', status, video_status: status, graphic_status: status,
    caption_status: 'N/A', title_status: 'N/A', asset_url: 'https://media.invalid/fixture.mp4', thumbnail_url: 'https://media.invalid/fixture.svg',
    caption: '', platforms: 'instagram', order_index: '1', scheduled_date: '2030-04-12', updated_at: f.clock, kasper_seen: '', kasper_approved_at: '',
    video_tweaks: '', graphic_tweaks: '', caption_tweaks: '', title_tweaks: '', tweaks: '', video_deliverable_id: f.video, graphic_deliverable_id: f.graphic,
    client_video_approved_at: '', client_graphic_approved_at: '', client_caption_approved_at: '', client_title_approved_at: '',
  }, options.row || {});
  const keys = Object.keys(row);
  db.run(`insert into public.calendar_posts (${keys.map(ident).join(', ')}) values (${keys.map(k => lit(row[k])).join(', ')})`);
  return { ...f, status, row };
}

function snapshot(db) {
  return {
    comments: db.count('production_comments'),
    receipts: db.count('production_comment_mutation_receipts'),
    outbox: db.count('mirror_outbox'),
    outbox_status: db.count('mirror_outbox', "operation = 'status'"),
    outbox_comment: db.count('mirror_outbox', "operation = 'comment'"),
    deliverable_events: db.count('deliverable_events'),
    status_events: db.count('deliverable_events', "action = 'status_change'"),
    calendar_events: db.count('calendar_post_events'),
    materializations: db.count('calendar_feedback_materializations'),
    card: db.one(`select id, client, updated_at, status, video_status, graphic_status, video_tweaks, graphic_tweaks, tweaks,
      client_video_approved_at, client_graphic_approved_at, kasper_approved_at, caption, name from public.calendar_posts`),
  };
}

module.exports = { ROOT, MIGRATIONS, CANDIDATE_MIGRATION, FIXTURE, Db, Cluster, createDatabase, loadSchema, seedFixture, snapshot, lit, ident, pgBin };

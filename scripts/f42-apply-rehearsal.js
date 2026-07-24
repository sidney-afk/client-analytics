#!/usr/bin/env node
'use strict';

// F42 apply rehearsal — a repeatable, disposable-PostgreSQL gate for the future
// live comment-import window. It stands up a throwaway PostgreSQL 16 cluster,
// applies every pending Slice-4 migration in the exact live order
// (f201 → f202 → f203 → comment-lifecycle → attachments) on top of a minimal
// pre-Slice-4 prerequisite schema, then drives the REAL planner and the REAL
// apply runner against public-safe fixture cards and asserts:
//
//   * the migrations apply cleanly and in order;
//   * the planner certifies a complete, conflict-free plan;
//   * the apply runner imports every canonical comment through the service-only
//     production_comment_card_import RPC in parents-before-children order;
//   * the applied receipts, distinct canonical ids, and the independent
//     production_comment_card_import_counts readback all equal the planned count;
//   * a second apply of the same plan is a byte-identical idempotent no-op.
//
// It leaves no residue. A green rehearsal on the exact merged SHA is a
// precondition of the coordinated apply; it is NOT itself authority to apply
// live. Requires local `initdb`/`pg_ctl`/`psql` (PostgreSQL 16) with the
// `pgcrypto` extension available.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  planCardCommentImport,
  SNAPSHOT_CONTRACT,
  sourceCoverage,
} = require('./f42-card-comment-import');
const applyRunner = require('./f42-card-comment-apply');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'migrations');

// Prerequisite migrations that build the pre-Slice-4 live objects the pending
// migrations and the F42 runtime path depend on (mirror_outbox in its B4 shape,
// deliverables/batches/deliverable_events, production_comments + upsert).
const PREREQ_MIGRATIONS = [
  '2026-07-06-b1-linear-data-model.sql',
  '2026-07-11-b4-linear-outbound.sql',
  '2026-07-12-production-comments.sql',
];

// The pending Slice-4 migrations, applied in the exact live-window order.
const PENDING_MIGRATIONS = [
  '2026-07-23-f201-production-labels.sql',
  '2026-07-23-f202-production-descriptions.sql',
  '2026-07-23-f203-production-issue-create.sql',
  '2026-07-23-production-comment-thread-lifecycle.sql',
  '2026-07-23-f34-f53-production-attachments.sql',
];

// Minimal pre-Slice-4 foundation. These are the truly-foundational objects the
// prerequisite migrations assume already exist on the live database (created by
// even earlier migrations that also carry Supabase-only realtime/publication
// wiring). Real column shapes are used so every grant, view, constraint, and FK
// in the pending migrations applies exactly as it will live.
const FOUNDATION_SQL = `
set check_function_bodies = off;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text);
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null, email text, role text, team text,
  slack_user_id text, linear_user_id text, avatar_color text,
  default_for_team boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.clients (
  slug text primary key, display_name text not null default '',
  active boolean not null default true, kind text not null default 'client',
  source text not null default 'sheet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.syncview_runtime_flags (
  key text primary key, value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(), updated_by text
);
create table if not exists public.calendar_posts (id text primary key);
create table if not exists public.sample_reviews (id text primary key);
`;

// Public-safe fixture: one Calendar card and one Samples/SXR card, each with a
// video thread (root → reply, exercising parent ordering) and a graphic note,
// plus the matching deliverables the card-import crosswalk revalidates.
const FIXTURE_DELIVERABLES = [
  { id: 'dlv-cal-vid', team: 'video', kind: 'video', origin: 'calendar', card_id: 'cal-card-1' },
  { id: 'dlv-cal-gra', team: 'graphics', kind: 'thumbnail', origin: 'calendar', card_id: 'cal-card-1' },
  { id: 'dlv-sxr-vid', team: 'video', kind: 'video', origin: 'samples', card_id: 'sxr-card-1' },
  { id: 'dlv-sxr-gra', team: 'graphics', kind: 'thumbnail', origin: 'samples', card_id: 'sxr-card-1' },
];

function calendarCards() {
  return [{
    id: 'cal-card-1', client_slug: 'test-client',
    video_deliverable_id: 'dlv-cal-vid', graphic_deliverable_id: 'dlv-cal-gra',
    comments: [
      { id: 'cal-root', author: 'SMM', role: 'smm', body: 'Calendar root note',
        created_at: '2026-07-23T10:00:00Z', updated_at: '2026-07-23T10:00:00Z' },
      { id: 'cal-reply', parent_id: 'cal-root', author: 'Client', role: 'client', body: 'Calendar reply',
        created_at: '2026-07-23T10:01:00Z', updated_at: '2026-07-23T10:01:00Z' },
    ],
    graphic_comments: [
      { id: 'cal-graphic', author: 'Designer', role: 'designer', body: 'Calendar graphic note',
        created_at: '2026-07-23T11:00:00Z' },
    ],
  }];
}

function sxrCards() {
  return [{
    id: 'sxr-card-1', client_slug: 'test-client',
    video_deliverable_id: 'dlv-sxr-vid', graphic_deliverable_id: 'dlv-sxr-gra',
    comments: [
      { id: 'sxr-root', author: 'SMM', role: 'smm', body: 'Samples root note',
        created_at: '2026-07-23T12:00:00Z', updated_at: '2026-07-23T12:00:00Z' },
    ],
    graphic_comments: [
      { id: 'sxr-graphic', author: 'Designer', role: 'designer', body: 'Samples graphic note',
        created_at: '2026-07-23T12:30:00Z' },
    ],
  }];
}

function fixtureSnapshot() {
  const calendar = calendarCards();
  const sxr = sxrCards();
  return {
    contract: SNAPSHOT_CONTRACT,
    surfaces: { calendar, sxr },
    manifest: {
      surfaces: {
        calendar: sourceCoverage(calendar, 'calendar'),
        sxr: sourceCoverage(sxr, 'sxr'),
      },
    },
  };
}

// ---- disposable cluster + psql plumbing -------------------------------------

function which(bin) {
  const r = spawnSync('bash', ['-lc', `command -v ${bin} || ls /usr/lib/postgresql/16/bin/${bin} 2>/dev/null`], { encoding: 'utf8' });
  return (r.stdout || '').trim().split('\n').filter(Boolean)[0] || '';
}

function log(message) {
  const line = `[f42-rehearsal] ${message}\n`;
  process.stdout.write(line);
  // Optional synchronous trace so progress survives output buffering and any
  // abrupt teardown (e.g. CI log truncation).
  if (process.env.F42_REHEARSAL_LOG) {
    try { fs.appendFileSync(process.env.F42_REHEARSAL_LOG, line); } catch (_error) { /* best effort */ }
  }
}

// Cluster wraps a disposable database on a PostgreSQL 16 server. Two modes:
//
//   * external (CI default): a server is already running — a GitHub Actions
//     `postgres:16` service, or a locally pre-started cluster — reachable via
//     F42_REHEARSAL_SOCKET/PGHOST + PGPORT. The rehearsal only creates and drops
//     a uniquely-named throwaway DATABASE on it, so it never manages a daemon.
//   * self-managed: no server env is provided, so the rehearsal initdb's and
//     starts its own throwaway cluster (running the server as an unprivileged
//     user when invoked as root, since PostgreSQL refuses to run as root).
//
// The disposable database name is always unique, so the rehearsal is safe to run
// repeatedly and concurrently against a shared server.
class Cluster {
  constructor() {
    const pid = process.pid;
    this.db = `f42_rehearsal_${pid}`;
    this.host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
    this.port = String(process.env.F42_REHEARSAL_PGPORT || process.env.PGPORT || 55432);
    this.user = process.env.F42_REHEARSAL_PGUSER || process.env.PGUSER || 'postgres';
    this.external = !!this.host;
    this.psql = which('psql') || 'psql';
    this.pgbin = process.env.F42_REHEARSAL_PGBIN
      || (fs.existsSync('/usr/lib/postgresql/16/bin/initdb') ? '/usr/lib/postgresql/16/bin' : path.dirname(which('initdb')));
    this.runUser = process.env.F42_REHEARSAL_PG_USER
      || (typeof process.getuid === 'function' && process.getuid() === 0 ? 'postgres' : '');
    this.base = process.env.F42_REHEARSAL_PGBASE
      || (this.runUser === 'postgres' ? `/var/lib/postgresql/f42-rehearsal-${pid}` : path.join(os.tmpdir(), `f42-rehearsal-${pid}`));
    this.data = path.join(this.base, 'data');
    this.selfSock = path.join(this.base, 'sock');
    this.started = false;
  }

  serverCmd(command) {
    if (this.runUser) return spawnSync('su', [this.runUser, '-s', '/bin/bash', '-c', command], { encoding: 'utf8' });
    return spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  }

  start() {
    if (this.external) {
      log(`using external PostgreSQL at ${this.host}:${this.port} (db ${this.db})`);
    } else {
      fs.mkdirSync(this.base, { recursive: true });
      if (this.runUser) spawnSync('chown', ['-R', `${this.runUser}:${this.runUser}`, this.base]);
      const init = this.serverCmd(`${this.pgbin}/initdb -D ${this.data} -U postgres --auth=trust`);
      if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr || init.stdout}`);
      fs.mkdirSync(this.selfSock, { recursive: true });
      if (this.runUser) spawnSync('chown', ['-R', `${this.runUser}:${this.runUser}`, this.selfSock]);
      // -l redirects the server log to a file; without it the daemonized
      // postmaster keeps pg_ctl's stdout pipe open and the synchronous spawn
      // never sees EOF.
      const startCmd = `${this.pgbin}/pg_ctl -D ${this.data} -l ${path.join(this.base, 'server.log')} -o "-k ${this.selfSock} -p ${this.port} -c listen_addresses=''" -w start`;
      const started = this.serverCmd(startCmd);
      if (started.status !== 0) throw new Error(`pg_ctl start failed: ${started.stderr || started.stdout}`);
      this.host = this.selfSock;
      this.started = true;
      log(`self-managed disposable PostgreSQL up at ${this.host}:${this.port}`);
    }
    this.run('', 'postgres', { sql: `drop database if exists ${this.db};` });
    this.run('', 'postgres', { sql: `create database ${this.db};` });
    this.run('', this.db, { sql: 'alter database ' + this.db + ' set check_function_bodies = off;' });
  }

  stop() {
    try { this.run('', 'postgres', { sql: `drop database if exists ${this.db};` }); } catch (_error) { /* best effort */ }
    if (this.started) {
      this.serverCmd(`${this.pgbin}/pg_ctl -D ${this.data} -m immediate -w stop`);
      this.started = false;
      try { fs.rmSync(this.base, { recursive: true, force: true }); } catch (_error) { /* best effort */ }
    }
  }

  run(_ignored, db, opts = {}) {
    const database = db || this.db;
    const args = ['-v', 'ON_ERROR_STOP=1', '-h', this.host, '-p', this.port, '-U', this.user, '-d', database, '-X', '-q'];
    if (opts.tuplesOnly) args.push('-t', '-A');
    if (opts.file) args.push('-f', opts.file);
    else args.push('-c', opts.sql != null ? opts.sql : '');
    const r = spawnSync(this.psql, args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`psql failed: ${(r.stderr || r.stdout || '').trim()}`);
    return (r.stdout || '').trim();
  }

  exec(sql, db) { return this.run('', db, { sql }); }

  runFile(file, db) { return this.run('', db, { file }); }

  scalarJson(sql, db) {
    const out = this.run('', db, { sql, tuplesOnly: true });
    return out ? JSON.parse(out) : null;
  }
}

// A psql-backed database layer for the real apply runner: importOne calls the
// service-only card-import RPC and returns the persisted row; readback calls the
// independent count function.
function psqlDeps(cluster) {
  return {
    async importOne(link, comment, event) {
      const sql = `select row_to_json(t) from public.production_comment_card_import(`
        + `$F42L$${JSON.stringify(link)}$F42L$::jsonb, `
        + `$F42C$${JSON.stringify(comment)}$F42C$::jsonb, `
        + `$F42E$${JSON.stringify(event || {})}$F42E$::jsonb) t;`;
      return cluster.scalarJson(sql);
    },
    async readback() {
      const row = cluster.scalarJson(
        `select row_to_json(t) from public.production_comment_card_import_counts('${applyRunner.BACKFILL_TAG}') t;`,
      );
      return {
        card_link_count: Number(row && row.card_link_count),
        comment_count: Number(row && row.comment_count),
      };
    },
  };
}

function seedFixtures(cluster) {
  cluster.exec(`insert into public.clients(slug, display_name, active, kind)
    values ('test-client', 'Test Client', true, 'test');`);
  cluster.exec(`insert into public.batches(id, client_slug, team, name)
    values ('rehearsal-batch', 'test-client', 'video', 'Rehearsal batch');`);
  const values = FIXTURE_DELIVERABLES.map(d =>
    `('${d.id}', 'rehearsal-batch', 'test-client', '${d.team}', '${d.kind}', 'Fixture ${d.id}', '${d.origin}', '${d.card_id}')`,
  ).join(',\n');
  cluster.exec(`insert into public.deliverables
    (id, batch_id, client_slug, team, kind, title, origin, card_id)
    values ${values};`);
}

// ---- rehearsal --------------------------------------------------------------

async function rehearse() {
  const results = { steps: [], checks: [] };
  const check = (name, condition, detail) => {
    results.checks.push({ name, ok: !!condition, detail: detail || null });
    log(`${condition ? 'ok  ' : 'FAIL'} ${name}`);
    if (!condition) throw new Error(`rehearsal_check_failed: ${name}`);
  };

  if (!which('initdb') && !fs.existsSync('/usr/lib/postgresql/16/bin/initdb')) {
    throw new Error('initdb_unavailable: PostgreSQL 16 server binaries are required for the rehearsal');
  }

  const cluster = new Cluster();
  cluster.start();
  try {
    // 1. Foundation + prerequisite + pending migrations, in exact order.
    cluster.exec(FOUNDATION_SQL);
    results.steps.push('foundation');
    for (const migration of [...PREREQ_MIGRATIONS, ...PENDING_MIGRATIONS]) {
      cluster.runFile(path.join(MIGRATIONS, migration));
      results.steps.push(migration);
    }
    check('every prerequisite and pending migration applied in order', true, results.steps);
    check('pending migrations applied f201 -> f202 -> f203 -> comment-lifecycle -> attachments',
      JSON.stringify(results.steps.slice(-5)) === JSON.stringify(PENDING_MIGRATIONS));

    // The card-import RPC and its independent count readback both exist.
    const rpcExists = cluster.scalarJson(
      "select to_json(count(*)) from pg_proc where proname in ('production_comment_card_import','production_comment_card_import_counts');",
    );
    check('card-import RPC and count readback are installed', Number(rpcExists) === 2);

    // 2. Seed public-safe fixtures.
    seedFixtures(cluster);
    results.steps.push('seed');

    // 3. Plan with the real planner; it must certify complete and conflict-free.
    const snapshot = fixtureSnapshot();
    const plan = applyRunner.derivePlan(snapshot, { importRunId: 'f42-apply-rehearsal' });
    check('planner certifies a complete, conflict-free plan',
      plan.complete === true && plan.conflicts.length === 0);
    const expected = plan.imports.length;
    // Calendar: 2 video (root+reply) + 1 graphic; Samples: 1 video + 1 graphic.
    check('planner produced the expected canonical import count', expected === 5, { expected });

    // 4. Apply with the real apply runner against the disposable database.
    const deps = psqlDeps(cluster);
    const applied = await applyRunner.applyPlan(plan, deps);
    check('apply runner reports APPLIED', applied.status === 'APPLIED', applied.verification);
    check('applied count equals planned count', applied.applied_count === expected);
    check('DB readback (card links + comments) equals planned count',
      applied.verification.checks.card_link_count === expected
      && applied.verification.checks.comment_count === expected,
      applied.verification.checks);

    // Parents materialize before children (root's canonical id precedes reply's).
    const order = applied.receipts.map(r => r.identity);
    check('a reply is imported after its root',
      order.indexOf('calendar|cal-card-1|video|cal-root') < order.indexOf('calendar|cal-card-1|video|cal-reply'));

    // Independent DB truth: every planned deliverable/component crosswalk landed.
    const dbCounts = cluster.scalarJson(
      "select json_build_object('links', (select count(*) from public.production_comment_card_links), "
      + "'comments', (select count(*) from public.production_comments where backfill_tag = 'f42-card-thread')) ;",
    );
    check('the database holds exactly the planned links and comments',
      Number(dbCounts.links) === expected && Number(dbCounts.comments) === expected, dbCounts);

    // 5. Idempotent re-apply: the same plan is a no-op; counts do not grow.
    const reapplied = await applyRunner.applyPlan(plan, deps);
    check('a second apply of the same plan stays APPLIED and idempotent',
      reapplied.status === 'APPLIED'
      && reapplied.verification.checks.card_link_count === expected
      && reapplied.verification.checks.comment_count === expected);
    check('the re-apply digest is identical to the first apply',
      reapplied.apply_digest === applied.apply_digest);

    log('REHEARSAL PASS');
    return { status: 'PASS', import_run_id: plan.import_run_id, planned_imports: expected, checks: results.checks.length };
  } finally {
    cluster.stop();
  }
}

if (require.main === module) {
  rehearse().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    process.stderr.write(`[f42-rehearsal] FAIL ${error && error.message ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  FOUNDATION_SQL,
  PENDING_MIGRATIONS,
  PREREQ_MIGRATIONS,
  fixtureSnapshot,
  rehearse,
};

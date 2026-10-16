'use strict';
/*
 * ef-auto-deploy-plan.js -- decides which Edge Functions a merge to main
 * deploys automatically, which wait, why, and in what order. Used by
 * .github/workflows/deploy-edge-functions-on-merge.yml; runbook
 * docs/ops/EF_AUTO_DEPLOY.md.
 *
 *   node scripts/ef-auto-deploy-plan.js plan --base=<sha> --head=<sha> [--root=<checkout of head>]
 *        [--functions=a,b] [--migrations-applied] [--out=plan.json] [--format=json|markdown]
 *   node scripts/ef-auto-deploy-plan.js gate --plan=plan.json --out=final.json      (needs SUPABASE_ACCESS_TOKEN)
 *   node scripts/ef-auto-deploy-plan.js units --plan=final.json                       (one unit per line, in order)
 *   node scripts/ef-auto-deploy-plan.js summary --plan=final.json [--results=results.json]
 *
 * PLAN (no network, no secret). A function is CHANGED by a merge when its
 * folder or any file it imports changed between base and head: the transitive
 * relative imports of scripts/ef-deploy-manifest.js, and, independently, the
 * source fingerprint scripts/ef-fingerprint.js attests (either one is enough).
 * Each changed function then gets one decision:
 *   deploy     deployed by this lane, in order, then attested;
 *   f27-lane   production-write, deliverable-write, batch-write: released by
 *              dispatching the Section 4 lane, which seals the live source
 *              into its rollback bundle itself, then deploys and attests;
 *   manual     never deployed automatically (frozen, retired, deliberate);
 *   held       not deployed this time, with the reason and the way to release
 *              it (a migration not yet applied, a predecessor that is held, a
 *              config that asks for platform JWT checks, stale Section 4 pins).
 * GATE (read-only live checks, token in that one step). For every function
 * still to deploy: its live source must be a version that was on main (drift
 * guard: the lane never overwrites something deployed from elsewhere), its
 * existing safeguards must pass (the same database readbacks and checks the
 * manual lanes run), and a migration that says how to tell it is applied is
 * asked. A function already live at head is skipped. Anything that fails is
 * held, and so is every function ordered after it.
 *
 * Exit code 0 always for plan/units/summary unless the input is invalid; the
 * workflow decides red or green from the decisions.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SHA = /^[0-9a-f]{40}$/;
const PROJECT_REF = 'uzltbbrjidmjwwfakwve';

// ---- policy (the one place it is written down) ------------------------------

const F27_LANE = Object.freeze(['production-write', 'deliverable-write', 'batch-write']);
const F27_PIN_ENV = Object.freeze({
  'production-write': 'PRODUCTION_WRITE_SOURCE_SHA256',
  'deliverable-write': 'DELIVERABLE_WRITE_SOURCE_SHA256',
  'batch-write': 'BATCH_WRITE_SOURCE_SHA256',
});
const F27_LANE_FILE = '.github/workflows/deploy-f27-section4-closures.yml';

const MANUAL_ONLY = Object.freeze({
  'calendar-upsert': 'FROZEN: its repository source is never deployed (it re-gates client links); only calendar-upsert-live-delta.yml changes it.',
  'sample-review-upsert': 'FROZEN by owner directive (AGENTS.md): its repository source re-applies the client write gate.',
  'linear-inbound': 'RETIRED 2026-09-24: deleted live, no deploy path.',
  'linear-outbound': 'RETIRED 2026-09-24: deleted live, no deploy path.',
  'client-token-verify': 'DELIBERATE-MANUAL: deployed and read back by hand before its matching browser caller is served (docs/ops/EF_DEPLOY_MANIFEST.md).',
});

// [before, after]: `before` must be live before `after` deploys. From the
// Track-B write/read set (deploy-onboarding-edge-functions.yml): the sender
// before the gateway whose wake calls it, the gateway before the comment and
// archive readers (a new reader against the old gateway mis-handles an edit as
// a create). The Section 4 lane itself refuses unless notify is live first.
const ORDER = Object.freeze([
  ['notify', 'production-write'],
  ['production-write', 'production-comments'],
  ['production-write', 'production-archive'],
]);

// Safeguards the manual lanes run before these functions deploy; the gate runs
// the same ones (see gateChecks below).
const PRECONDITIONS = Object.freeze({
  'client-onboarding': ['onboarding-schema'],
  'client-hubspot-sync': ['hubspot-schema'],
  'frameio-token': ['frameio-table'],
  pto: ['pto-schema-contract'],
  'hiring-applications': ['hiring-delivery-disabled'],
  'hiring-automation': ['hiring-automation-contract'],
  notify: ['linear-exit-sql-preflight'],
  'production-comments': ['linear-exit-sql-preflight'],
  'production-archive': ['linear-exit-sql-preflight'],
});

const MIGRATION_DIRS = Object.freeze(['migrations/', 'supabase/migrations/']);
const COPE_MARKER = /^--\s*ef-auto-deploy:\s*functions-cope-without-this\s*$/m;
const PROBE_MARKER = /^--\s*ef-auto-deploy-applied-when:\s*(.+?)\s*$/m;

// ---- helpers ----------------------------------------------------------------

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', root, ...args], { encoding, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
function gitOk(root, args) {
  return spawnSync('git', ['-C', root, ...args], { stdio: 'ignore' }).status === 0;
}
function arg(name, argv) {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** sha -> Map(slug -> expected fingerprint), from git objects only. */
function expectedFingerprints(root, sha) {
  if (!gitOk(root, ['cat-file', '-e', `${sha}:supabase/functions`])) return new Map();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ef-fingerprint.js'), sha, '--expected-only', '--format=json'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ef-fingerprint --expected-only failed at ${sha.slice(0, 12)}: ${(r.stderr || '').trim().split('\n').pop()}`);
  return new Map(JSON.parse(r.stdout).results.map(row => [row.slug, row.expected_fingerprint]));
}

function changedFiles(root, base, head) {
  return git(root, ['diff', '--name-status', '--no-renames', base, head]).split('\n').filter(Boolean).map(line => {
    const [status, ...rest] = line.split('\t');
    return { status: status[0], path: rest.join('\t') };
  });
}

function slugsAt(root) {
  const dir = path.join(root, 'supabase', 'functions');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== '_shared' && fs.existsSync(path.join(dir, e.name, 'index.ts')))
    .map(e => e.name).sort();
}

function closureFiles(root, slug) {
  const { functionDependencies } = require('./ef-deploy-manifest');
  const deps = functionDependencies(slug, path.join(root, 'supabase', 'functions'));
  return [...deps.shared, ...deps.local].map(rel => `supabase/functions/${rel}`);
}

function configVerifyJwt(root, slug) {
  const file = path.join(root, 'supabase', 'config.toml');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf(`[functions.${slug}]`);
  if (start < 0) return null;
  const rest = text.slice(start + 1);
  const next = rest.search(/^\[/m);
  const block = next < 0 ? rest : rest.slice(0, next);
  const m = block.match(/^verify_jwt\s*=\s*(true|false)\s*$/m);
  return m ? m[1] === 'true' : null;
}

function f27PinsAt(root) {
  const file = path.join(root, F27_LANE_FILE);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const pins = {};
  for (const [slug, name] of Object.entries(F27_PIN_ENV)) {
    const m = text.match(new RegExp(`^\\s+${name}:\\s*([0-9a-f]{64})\\s*$`, 'm'));
    pins[slug] = m ? m[1] : null;
  }
  return pins;
}

function migrationsAdded(root, files, head) {
  return files
    .filter(f => f.status === 'A' && MIGRATION_DIRS.some(d => f.path.startsWith(d)) && /\.sql$/i.test(f.path))
    .map(f => {
      let head40 = '';
      try { head40 = git(root, ['show', `${head}:${f.path}`]).split('\n').slice(0, 40).join('\n'); } catch (e) { /* unreadable: treated as unmarked */ }
      const probe = head40.match(PROBE_MARKER);
      const marker = COPE_MARKER.test(head40) ? 'cope' : probe ? 'probe' : null;
      return { path: f.path, marker, probe_sql: probe ? probe[1] : null };
    });
}

/** Order the slugs: ORDER edges first, then by name. */
function ordered(slugs) {
  const set = new Set(slugs);
  const out = [];
  const visiting = new Set();
  const visit = s => {
    if (out.includes(s)) return;
    if (visiting.has(s)) throw new Error('ORDER has a cycle at ' + s);
    visiting.add(s);
    for (const [before, after] of ORDER) if (after === s && set.has(before)) visit(before);
    visiting.delete(s);
    out.push(s);
  };
  for (const s of [...slugs].sort()) visit(s);
  return out;
}

/** Hold every function ordered after one that will not deploy. */
function cascadeHolds(rows) {
  let changed = true;
  while (changed) {
    changed = false;
    // The Section 4 lane deploys all three together. If one of the three is held
    // (its own migration, drift guard, pin, safeguard), the whole group is held:
    // dispatching the lane would deploy the held one too.
    const group = rows.filter(r => F27_LANE.includes(r.slug));
    const blocker = group.find(r => r.decision === 'held');
    if (blocker) {
      for (const r of group) {
        if (r.decision !== 'f27-lane') continue;
        r.decision = 'held';
        r.reason = `waits for ${blocker.slug}: the Section 4 lane deploys production-write, deliverable-write and batch-write together, and ${blocker.slug} is held (${blocker.reason})`;
        r.release = `release ${blocker.slug} first (${blocker.release}); this one is released with it`;
        changed = true;
      }
    }
    for (const [before, after] of ORDER) {
      const b = rows.find(r => r.slug === before);
      const a = rows.find(r => r.slug === after);
      if (!b || !a) continue;
      const bWillGo = b.decision === 'deploy' || b.decision === 'f27-lane' || b.decision === 'already-live';
      if (!bWillGo && (a.decision === 'deploy' || a.decision === 'f27-lane')) {
        a.decision = 'held';
        a.reason = `waits for ${before}, which must be live first and is ${b.decision} this time (${b.reason})`;
        a.release = `release ${before} first, then run this lane by hand for ${after}`;
        changed = true;
      }
    }
  }
  return rows;
}

// ---- plan -------------------------------------------------------------------

/**
 * Which migration files each first-parent commit of base..head added, with the
 * paths that commit changed. A run can span several merges (it starts from the
 * last fully successful run), and a migration blocks only the functions its OWN
 * merge changed: a later, unrelated merge must not be held by it.
 */
function commitsInRange(root, base, head) {
  const out = [];
  for (const c of git(root, ['rev-list', '--first-parent', '--reverse', `${base}..${head}`]).split('\n').filter(Boolean)) {
    if (!gitOk(root, ['rev-parse', '--verify', '-q', `${c}^1`])) continue;
    const files = changedFiles(root, `${c}^1`, c);
    out.push({ commit: c, paths: new Set(files.map(f => f.path)), migrations: migrationsAdded(root, files, c) });
  }
  return out;
}

function plan({ root = ROOT, base, head, functions = null, migrationsApplied = false }) {
  if (!SHA.test(base) || !SHA.test(head)) throw new Error('--base and --head must be 40-character SHAs');
  const files = changedFiles(root, base, head);
  const changedPaths = new Set(files.map(f => f.path));
  const before = expectedFingerprints(root, base);
  const after = expectedFingerprints(root, head);
  const slugs = slugsAt(root);
  let changed;
  if (functions) {
    changed = functions.filter(s => slugs.includes(s));
    const unknown = functions.filter(s => !slugs.includes(s));
    if (unknown.length) throw new Error('unknown function(s): ' + unknown.join(','));
  } else {
    changed = slugs.filter(slug => {
      if (before.get(slug) !== after.get(slug)) return true;
      const own = `supabase/functions/${slug}/`;
      if ([...changedPaths].some(p => p.startsWith(own))) return true;
      return closureFiles(root, slug).some(p => changedPaths.has(p));
    });
  }
  const removed = [...before.keys()].filter(s => !after.has(s));
  const commits = commitsInRange(root, base, head);
  const migrations = commits.length ? commits.flatMap(c => c.migrations) : migrationsAdded(root, files, head);
  // Chosen functions (a manual run) are held by any migration in the range, as before.
  // Otherwise a function is held only by the migrations of the merges that changed it.
  const blockingFor = slug => {
    if (functions || !commits.length) return migrations.filter(m => m.marker !== 'cope');
    const own = `supabase/functions/${slug}/`;
    const closure = new Set(closureFiles(root, slug));
    return commits.filter(c => [...c.paths].some(pth => pth.startsWith(own) || closure.has(pth)))
      .flatMap(c => c.migrations).filter(m => m.marker !== 'cope');
  };
  const ptoSql = files.some(f => /^migrations\/.*pto.*\.sql$/i.test(f.path));
  const pins = f27PinsAt(root);

  const rows = changed.map(slug => {
    const row = { slug, new_function: !before.has(slug), decision: 'deploy', reason: '', release: '', preconditions: PRECONDITIONS[slug] || [] };
    if (MANUAL_ONLY[slug]) {
      Object.assign(row, { decision: 'manual', reason: MANUAL_ONLY[slug], release: 'its own manual path only' });
      return row;
    }
    if (F27_LANE.includes(slug)) {
      row.decision = 'f27-lane';
      if (pins[slug] !== after.get(slug)) {
        Object.assign(row, {
          decision: 'held',
          reason: `the Section 4 lane's pin for ${slug} does not match this commit's source, so that lane would refuse`,
          release: `re-pin ${F27_PIN_ENV[slug]} in ${F27_LANE_FILE} with node scripts/ef-fingerprint.js <sha> --slugs=${slug} --expected-only, merge, and this lane releases it`,
        });
        return row;
      }
    }
    if (configVerifyJwt(root, slug) === true) {
      Object.assign(row, { decision: 'held', reason: 'supabase/config.toml asks for verify_jwt = true; this lane only deploys JWT-off functions (every attested function is verify_jwt=false)', release: 'deploy by hand after review' });
      return row;
    }
    const blocking = blockingFor(slug);
    if (!migrationsApplied && blocking.length) {
      Object.assign(row, {
        decision: 'held',
        reason: `this merge adds ${blocking.length} migration file(s) not yet known to be applied (${blocking.map(m => m.path).join(', ')})`,
        release: 'apply the migration(s), then run this lane by hand with commit_sha and migrations_applied=true (docs/ops/EF_AUTO_DEPLOY.md)',
        pending_probes: blocking.filter(m => m.marker === 'probe').map(m => m.path),
        pending_unmarked: blocking.filter(m => m.marker === null).length,
      });
      return row;
    }
    if (slug === 'pto' && ptoSql && !migrationsApplied) {
      Object.assign(row, { decision: 'held', reason: 'PTO SQL changed in this merge (the PTO lane rule: migration first)', release: 'apply and read back the PTO migration, set PTO_SCHEMA_CONTRACT, then run this lane by hand with migrations_applied=true' });
      return row;
    }
    return row;
  });
  cascadeHolds(rows);
  const order = ordered(rows.map(r => r.slug));
  rows.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
  return {
    schema: 'ef-auto-deploy-plan-v1',
    base, head,
    mode: functions ? 'chosen-functions' : 'changed-since-base',
    migrations_applied_confirmed: migrationsApplied,
    changed_file_count: files.length,
    migrations_added: migrations,
    removed_functions: removed,
    functions: rows,
    f27_pins: pins,
    expected_at_head: Object.fromEntries(changed.map(s => [s, after.get(s) || null])),
  };
}

/** Deploy units in order: each function, with the three Section 4 functions as ONE unit at production-write's place. */
function units(p) {
  const out = [];
  for (const row of p.functions) {
    if (row.decision === 'deploy') out.push(row.slug);
    else if (row.decision === 'f27-lane' && !out.includes('@f27-section4')) out.push('@f27-section4');
  }
  return out;
}

// ---- gate (live, read-only) --------------------------------------------------

async function sqlRead(query) {
  const token = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: true }),
  });
  if (!response.ok) throw new Error(`database read HTTP ${response.status}`);
  return response.json();
}

const GATE_CHECKS = {
  // The same readbacks deploy-single-function.yml runs before these deploy.
  'onboarding-schema': async () => {
    const t = await sqlRead("select count(*) filter (where to_regclass('public.'||n) is not null) as present, count(*) as wanted from unnest(array['onboarding_steps','client_onboarding_progress','client_onboarding_events','client_resources','client_sales_state','client_resource_status_v1','client_onboarding_summary_v1']) n");
    const f = await sqlRead("select (to_regprocedure('public.client_onboarding_ensure(text)') is not null and to_regprocedure('public.client_onboarding_set_step(text,text,text,text,text,text,text,timestamptz,text)') is not null) as fns_ok");
    return Number(t[0].present) === Number(t[0].wanted) && f[0].fns_ok === true ? null : 'the onboarding checklist tables, views or functions are missing; apply the checklist migration first';
  },
  'hubspot-schema': async () => {
    const r = await sqlRead("select (to_regprocedure('public.client_hubspot_sync_targets(text,integer,integer)') is not null and to_regprocedure('public.client_sales_state_apply(text,text,text,text,text,text,text,text,text)') is not null and to_regclass('public.client_sales_state') is not null) as ready");
    return r[0].ready === true ? null : 'the HubSpot sync database functions are missing; apply the checklist tables migration and then the HubSpot sync migration first';
  },
  'frameio-table': async () => {
    const r = await sqlRead("select (to_regclass('public.frameio_token_keeper') is not null) as ready");
    return r[0].ready === true ? null : 'the frameio_token_keeper table is missing; apply migrations/2026-10-13-frameio-token-keeper.sql first';
  },
  // deploy-pto-edge-functions.yml: the repository variable must name the contract the function needs.
  'pto-schema-contract': async ({ root }) => {
    const lane = fs.readFileSync(path.join(root, '.github/workflows/deploy-pto-edge-functions.yml'), 'utf8');
    const m = lane.match(/REQUIRED_SCHEMA_CONTRACT:\s*([A-Za-z0-9_.-]+)/);
    if (!m) return 'could not read the required PTO schema contract from the PTO lane';
    return process.env.PTO_SCHEMA_CONTRACT === m[1] ? null : `PTO_SCHEMA_CONTRACT must equal ${m[1]} after the migration readback`;
  },
  // deploy-hiring-applications.yml: the source must still start delivery-disabled.
  'hiring-delivery-disabled': async ({ root }) => {
    const sql = fs.readFileSync(path.join(root, 'migrations/2026-08-24-hiring-applications.sql'), 'utf8');
    const src = fs.readFileSync(path.join(root, 'supabase/functions/hiring-applications/index.ts'), 'utf8');
    return sql.includes("'hiring_invites_enabled', '{\"enabled\": false}'") && src.includes('HIRING_INTERVIEW_EVENT_URL') ? null : 'the hiring source no longer starts delivery-disabled';
  },
  // deploy-hiring-automation.yml: the contract test and the server-to-server markers.
  'hiring-automation-contract': async ({ root }) => {
    const t = spawnSync(process.execPath, [path.join(root, 'test/hiring-automation-contract.js')], { cwd: root, encoding: 'utf8' });
    if (t.status !== 0) return 'test/hiring-automation-contract.js failed';
    const src = fs.readFileSync(path.join(root, 'supabase/functions/hiring-automation/index.ts'), 'utf8');
    return ['HIRING_AUTOMATION_KEY', 'hiring_capture_application_v1', 'hiring_record_invite_result_v1'].every(s => src.includes(s)) ? null : 'hiring-automation is no longer server-to-server only';
  },
  // deploy-onboarding-edge-functions.yml runs this before the Track-B set.
  'linear-exit-sql-preflight': async ({ root }) => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/linear-exit-deploy-preflight.js')], { cwd: root, encoding: 'utf8', env: { ...process.env, PROJECT_REF } });
    try { const j = JSON.parse(r.stdout); if (r.status === 0 && j.status === 'PASS' && j.read_only === true) return null; } catch (e) { /* fall through */ }
    return `the Linear-exit native SQL preflight did not pass (${(r.stderr || '').trim().split('\n').pop() || 'no detail'})`;
  },
};

function liveReport(root, sha, slugs) {
  if (!slugs.length) return new Map();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ef-fingerprint.js'), sha, `--slugs=${slugs.join(',')}`, '--format=json'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PROJECT_REF } });
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch (e) { throw new Error(`ef-fingerprint live read failed: ${(r.stderr || '').trim().split('\n').pop()}`); }
  return new Map(parsed.results.map(row => [row.slug, row]));
}

/**
 * The fingerprints each function had on main recently: at the base of this
 * run and at the 40 newest first-parent commits that touched any function.
 * One ef-fingerprint call per commit, shared by every function.
 */
const versionCache = new Map();
function recentMainVersions(root, p) {
  const key = p.base + p.head;
  if (versionCache.has(key)) return versionCache.get(key);
  const shas = new Set([p.base, ...git(root, ['rev-list', '--first-parent', '-n40', p.head, '--', 'supabase/functions']).split('\n').filter(Boolean)]);
  const bySlug = new Map();
  for (const sha of shas) {
    for (const [slug, fp] of expectedFingerprints(root, sha)) {
      if (!bySlug.has(slug)) bySlug.set(slug, new Set());
      bySlug.get(slug).add(fp);
    }
  }
  versionCache.set(key, bySlug);
  return bySlug;
}

// readLive and checks are injectable so the test can feed it live states without a network.
async function gate({ root = ROOT, p, dispatch = false, readLive = liveReport, checks = GATE_CHECKS }) {
  p.drift_guard = dispatch ? 'skipped (manual run): nothing is held for drift; each function row says whether live was a recent main version' : 'applied';
  // 1. Migrations that say how to tell they are applied: ask, and release the
  //    hold of a function whose every blocking migration answers yes.
  const probes = p.migrations_added.filter(m => m.marker === 'probe');
  if (probes.length) {
    const { assertReadOnlyProbe } = require('./repo-vs-live');
    for (const m of probes) {
      try {
        const rows = await sqlRead(`select * from (${assertReadOnlyProbe(m.probe_sql)}) as probe`);
        m.applied = Object.values(rows[0] || {})[0] === true;
      } catch (e) { m.applied = false; m.probe_error = e.message; }
    }
    for (const row of p.functions) {
      if (row.decision !== 'held' || !row.pending_probes || row.pending_unmarked) continue;
      if (row.pending_probes.every(path_ => (probes.find(m => m.path === path_) || {}).applied)) {
        Object.assign(row, { decision: F27_LANE.includes(row.slug) ? 'f27-lane' : 'deploy', reason: 'its migration(s) answer applied', release: '' });
        delete row.pending_probes;
      }
    }
  }

  // 2. One live read for everything that could go: a function whose live source
  //    already equals this commit's has nothing to deploy, whatever held it.
  const candidates = p.functions.filter(r => r.decision === 'deploy' || r.decision === 'f27-lane' || (r.decision === 'held' && !/verify_jwt = true/.test(r.reason)));
  const live = readLive(root, p.head, candidates.map(r => r.slug));
  for (const row of candidates) {
    const rep = live.get(row.slug) || {};
    row.live_version = rep.version ?? null;
    if (rep.result === 'PASS' && rep.verify_jwt === false) {
      Object.assign(row, { decision: 'already-live', reason: 'live already runs this commit\'s source (verify_jwt=false)', release: '' });
      continue;
    }
    if (row.decision === 'held') continue;
    const liveFp = rep.live_fingerprint || null;
    if (!row.new_function) {
      const recent = recentMainVersions(root, p).get(row.slug) || new Set();
      const isRecent = !!liveFp && recent.has(liveFp);
      if (!dispatch && !isRecent) {
        Object.assign(row, {
          decision: 'held',
          reason: liveFp ? 'drift guard: the live source is not any recent version of main, so something deployed from elsewhere would be overwritten' : 'drift guard: the live source could not be read',
          release: 'check what is live, then run this lane by hand with functions=' + row.slug + ' (a manual run skips the drift guard and reports the drift in its table)',
        });
        continue;
      }
      row.drift = !liveFp ? 'not live yet' : isRecent ? 'live is a recent main version' : 'DRIFT: live was not a recent main version (manual run, deployed anyway)';
    } else {
      row.drift = liveFp ? 'new function' : 'not live yet';
    }
    for (const key of row.preconditions) {
      let problem;
      try { problem = await checks[key]({ root }); } catch (e) { problem = `${key} could not be checked (${e.message})`; }
      if (problem) { Object.assign(row, { decision: 'held', reason: problem, release: 'fix that, then run this lane by hand with commit_sha' }); break; }
    }
  }

  // 3. Order across runs. A function that must follow another is deployed only
  //    when that other one is live at this commit's source: either it is in this
  //    plan (ordered, and held if it will not go: cascadeHolds) or, when it is not,
  //    its live source is read here. A later merge touching only production-comments
  //    must not land on an older live production-write.
  const inPlan = new Set(p.functions.map(r => r.slug));
  const preds = [...new Set(p.functions
    .filter(r => r.decision === 'deploy' || r.decision === 'f27-lane')
    .flatMap(r => ORDER.filter(([, after]) => after === r.slug).map(([before]) => before))
    .filter(b => !inPlan.has(b) && fs.existsSync(path.join(root, 'supabase', 'functions', b, 'index.ts'))))];
  if (preds.length) {
    const predLive = readLive(root, p.head, preds);
    for (const row of p.functions) {
      if (row.decision !== 'deploy' && row.decision !== 'f27-lane') continue;
      for (const [before, after] of ORDER) {
        if (after !== row.slug || inPlan.has(before) || !predLive.has(before)) continue;
        const rep = predLive.get(before);
        if (rep.result === 'PASS' && rep.verify_jwt === false) continue;
        Object.assign(row, {
          decision: 'held',
          reason: `waits for ${before}: the live ${before} is not this commit's source, and it must be live first (a new reader against the old gateway would mis-handle an edit as a create)`,
          release: `deploy ${before} first (run this lane by hand with functions=${before}), then run it by hand for ${row.slug}`,
        });
        break;
      }
    }
  }
  cascadeHolds(p.functions);
  return p;
}

// ---- report -----------------------------------------------------------------

function summary(p, results = {}) {
  const lines = [
    `## Edge Functions on merge: ${p.head.slice(0, 12)}`,
    '',
    `Changes since \`${p.base.slice(0, 12)}\` (${p.mode}); ${p.changed_file_count} file(s) changed; ${p.migrations_added.length} migration file(s) added${p.migrations_applied_confirmed ? ' (confirmed applied by the dispatcher)' : ''}.`,
    '',
  ];
  if (p.drift_guard && p.drift_guard !== 'applied') lines.push(`Drift guard: ${p.drift_guard}.`, '');
  if (!p.functions.length) { lines.push('No Edge Function changed, so nothing was deployed.'); return lines.join('\n') + '\n'; }
  lines.push('| Order | Function | Decision | Result | Why / how to release |', '| ---: | --- | --- | --- | --- |');
  p.functions.forEach((r, i) => {
    const res = results[r.slug] || results[F27_LANE.includes(r.slug) ? '@f27-section4' : ''] || (r.decision === 'deploy' || r.decision === 'f27-lane' ? 'not run' : '-');
    lines.push(`| ${i + 1} | \`${r.slug}\` | ${r.decision} | ${res} | ${[r.reason, /^DRIFT/.test(r.drift || '') ? r.drift : '', r.release].filter(Boolean).join('. ') || '-'} |`);
  });
  for (const s of p.removed_functions) lines.push('', `- \`${s}\` was removed from the repository; it is NOT deleted live (do that by hand).`);
  return lines.join('\n') + '\n';
}

/**
 * True when a run should go red: a deploy failed, or a changed function is
 * held and waits on a person. A `manual` function (frozen, retired) is a
 * warning in the run, not red: it has its own path and nothing is broken.
 */
function needsAction(p, results = {}) {
  const failed = Object.values(results).some(v => v !== 'deployed' && v !== 'released');
  return failed || p.functions.some(r => r.decision === 'held');
}

// ---- cli --------------------------------------------------------------------

async function main(argv) {
  const cmd = argv[0];
  const fmt = arg('format', argv) || 'json';
  const write = (obj, out) => { const text = JSON.stringify(obj, null, 2) + '\n'; if (out) fs.writeFileSync(out, text); else process.stdout.write(text); };
  if (cmd === 'plan') {
    const p = plan({
      root: path.resolve(arg('root', argv) || ROOT), base: arg('base', argv), head: arg('head', argv),
      functions: arg('functions', argv) ? arg('functions', argv).split(',').map(s => s.trim()).filter(Boolean) : null,
      migrationsApplied: argv.includes('--migrations-applied'),
    });
    if (fmt === 'markdown') process.stdout.write(summary(p)); else write(p, arg('out', argv));
    return;
  }
  const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
  if (cmd === 'gate') { write(await gate({ root: path.resolve(arg('root', argv) || ROOT), p: read(arg('plan', argv)), dispatch: argv.includes('--dispatch') }), arg('out', argv)); return; }
  if (cmd === 'units') { process.stdout.write(units(read(arg('plan', argv))).join('\n') + '\n'); return; }
  if (cmd === 'summary') {
    const p = read(arg('plan', argv));
    const results = arg('results', argv) && fs.existsSync(arg('results', argv)) ? read(arg('results', argv)) : {};
    process.stdout.write(summary(p, results));
    if (argv.includes('--exit-code')) process.exitCode = needsAction(p, results) ? 1 : 0;
    return;
  }
  throw new Error('usage: plan | gate | units | summary (see the header)');
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(e => { console.error('ef-auto-deploy-plan: ' + e.message); process.exit(2); });
}

module.exports = { F27_LANE, MANUAL_ONLY, ORDER, PRECONDITIONS, plan, units, gate, summary, needsAction, ordered, cascadeHolds };

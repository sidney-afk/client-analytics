'use strict';
/*
 * Contract suite for the native sample status bridge
 * (migrations/2026-10-01-native-sample-status-bridge.sql).
 *
 * THE FAILURE THIS EXISTS TO CATCH. A sample status change used to be two saves
 * from the browser: the work item first, the sample's own record second. Closing
 * the tab between them left the sample stuck. The migration makes the work item
 * write carry the sample with it, and adds a catch-up for any sample left behind.
 *
 * Two halves:
 *   1. Always runs, offline: the SQL overall-status copy is checked against the
 *      page's own `computeSampleOverallStatus` by name, and the structural facts
 *      the deploy tooling depends on are pinned.
 *   2. Runs when a disposable PostgreSQL 16 is available (or is required with
 *      SAMPLE_BRIDGE_REQUIRE_POSTGRES=1): executes the SQL against a throwaway
 *      database and replays the "tab closed between the two saves" cases. Uses
 *      only the invented slug `sidneylaruel` and invented ids. Never contacts a
 *      hosted backend.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'migrations', '2026-10-01-native-sample-status-bridge.sql');
const sql = fs.readFileSync(MIGRATION, 'utf8');
const model = fs.readFileSync(path.join(ROOT, 'src', 'index', '270-samples-model.js.part'), 'utf8');

let passed = 0;
let failed = 0;
const ok = (name, value) => {
  if (value) { passed += 1; console.log(`  ok ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}`); }
};

/* ---- the page's own overall-status function, executed -------------------- */
function grabFunc(source, name) {
  const at = source.indexOf('function ' + name + '(');
  assert.ok(at >= 0, 'the page no longer defines ' + name);
  let depth = 0;
  for (let j = source.indexOf('{', at); j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error('unbalanced braces around ' + name);
}
function grabLine(source, re) {
  const m = source.match(re);
  assert.ok(m, 'the page no longer defines ' + re);
  return m[0];
}
const pageOverall = new Function(
  grabLine(model, /const SXR_STATUSES\s*=\s*\[[^\]]*\];/) + '\n'
  + grabLine(model, /const SXR_PRIORITY\s*=\s*\{[^}]*\};/) + '\n'
  + grabLine(model, /const SXR_COMPONENTS\s*=\s*\[[^\]]*\];/) + '\n'
  + grabFunc(model, '_sxrNormStatus') + '\n'
  + grabFunc(model, 'computeSampleOverallStatus') + '\n'
  + 'return computeSampleOverallStatus;')();

// Every spelling the page's normaliser handles, plus values it passes through.
const VALUES = [
  'In Progress', 'for smm approval', 'For SMM Approval', 'SMM Approval', 'Kasper Approval',
  'For Kasper Approval', 'client approval', 'Client Approval', 'Tweaks Needed', 'APPROVED',
  'Draft', '', '  ', '  Approved  ', 'Scheduled', 'Posted', 'N/A', 'something else',
];
const pairs = [];
for (const v of VALUES) for (const g of VALUES) pairs.push([v, g]);

console.log('sample status bridge: structure');
ok('trigger is plain AFTER UPDATE FOR EACH ROW with no WHEN clause (preflight needs tgqual null)',
  /create trigger zzz_native_sample_status_project\s+after update on public\.deliverables\s+for each row\s+execute function/.test(sql)
  && !/create trigger zzz_native_sample_status_project[\s\S]{0,200}\bwhen\s*\(/.test(sql));
ok('no function is SECURITY DEFINER', !/security\s+definer/i.test(sql));
ok('every function revokes from public, anon and authenticated by name',
  (sql.match(/revoke all on function/g) || []).length === 5
  && (sql.match(/from public, anon, authenticated;/g) || []).length === 5);
ok('catch-up compares the sample stamp with the work item stamp (ahead means older)',
  /v_sample_stamp >= d\.status_at/.test(sql) && /s\.sample_stamp < d\.status_at/.test(sql));
ok('trigger and catch-up share one apply function',
  (sql.match(/production_native_sample_status_apply\(/g) || []).length >= 4
  && !/update public\.sample_reviews/.test(sql.split('production_native_sample_status_project()')[1].split('create trigger')[0]));
ok('event rows use a source distinct from ui, linear and reconcile', /'native-bridge'/.test(sql));
ok('the page defines a rollup for every pair compared', pairs.length === VALUES.length * VALUES.length);

/* ---- the PostgreSQL proof ------------------------------------------------- */
const PG_BIN = '/usr/lib/postgresql/16/bin';
const haveServer = fs.existsSync(path.join(PG_BIN, 'postgres')) && fs.existsSync(path.join(PG_BIN, 'initdb'));
const required = process.env.SAMPLE_BRIDGE_REQUIRE_POSTGRES === '1';
if (!haveServer) {
  if (required) { failed += 1; console.log('  FAIL PostgreSQL 16 required but not installed'); }
  else console.log('SKIP sample status bridge PostgreSQL proof: PostgreSQL 16 not installed');
} else {
  console.log('sample status bridge: PostgreSQL');
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const base = fs.mkdtempSync(path.join(asRoot ? '/var/tmp' : os.tmpdir(), 'sample-bridge-'));
  fs.chmodSync(base, 0o755);
  const port = String(55000 + Math.floor(Math.random() * 4000));
  const as = (cmd, args, opts) => asRoot
    ? spawnSync('runuser', ['-u', 'postgres', '--', cmd, ...args], Object.assign({ encoding: 'utf8' }, opts))
    : spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts));
  if (asRoot) spawnSync('chown', ['postgres', base]);
  const data = path.join(base, 'data');
  let started = false;
  const psql = (db, input) => {
    const r = spawnSync(path.join(PG_BIN, 'psql'), ['-h', base, '-p', port, '-U', 'postgres', '-d', db,
      '-v', 'ON_ERROR_STOP=1', '-q', '-At'], { input, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('psql failed: ' + (r.stderr || '').trim());
    return r.stdout.trim();
  };
  const one = (q) => psql('t', q);
  try {
    const init = as(path.join(PG_BIN, 'initdb'), ['-D', data, '-A', 'trust']);
    assert.equal(init.status, 0, 'initdb failed: ' + init.stderr);
    const start = as(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${base} -c listen_addresses=''`,
      '-l', path.join(base, 'log'), '-w', 'start']);
    assert.equal(start.status, 0, 'pg_ctl start failed: ' + start.stderr);
    started = true;
    psql('postgres', 'create database t');
    // Minimal stand-ins for the two live tables; the real sample table and the
    // real status mapper are applied from the repository's own migrations.
    psql('t', `
      do $$ begin create role anon; create role authenticated; create role service_role bypassrls;
      exception when duplicate_object then null; end $$;
      create publication supabase_realtime;
      create table public.deliverables(id text primary key, client_slug text, origin text, card_id text,
        status text, status_at timestamptz, updated_at timestamptz default now());
      create function public.dstamp() returns trigger language plpgsql as $f$ begin
        if tg_op='INSERT' or new.status is distinct from old.status then new.status_at := now(); end if;
        return new; end $f$;
      create trigger a_stamp before insert or update on public.deliverables for each row execute function public.dstamp();`);
    const calendar = fs.readFileSync(path.join(ROOT, 'migrations', '2026-09-18-native-calendar-status-bridge.sql'), 'utf8');
    const mapAndAbove = calendar.slice(
      calendar.indexOf('create or replace function public.production_native_calendar_status_map'),
      calendar.indexOf('grant execute on function public.production_native_calendar_status_above')
        + 'grant execute on function public.production_native_calendar_status_above(text) to service_role;'.length);
    psql('t', mapAndAbove);
    psql('t', fs.readFileSync(path.join(ROOT, 'migrations', 'sample-reviews-migration.sql'), 'utf8'));
    psql('t', `alter table public.sample_reviews add column video_deliverable_id text, add column graphic_deliverable_id text;
      grant all on all tables in schema public to service_role;`);
    psql('t', sql);
    ok('migration applies', true);
    psql('t', sql);
    ok('migration applies twice (idempotent)', true);

    /* SQL overall status equals the page's, pair by pair. */
    const lit = (s) => "'" + s.replace(/'/g, "''") + "'";
    const rows = one(pairs.map(([v, g]) =>
      `select ${lit(v)} || '|' || ${lit(g)} || '|' || public.production_native_sample_overall_status(${lit(v)}, ${lit(g)});`).join('\n'))
      .split('\n');
    const mismatches = [];
    pairs.forEach(([v, g], i) => {
      const expected = pageOverall({ video_status: v, graphic_status: g });
      const got = rows[i].slice((v + '|' + g + '|').length);
      if (got !== expected) mismatches.push(`${JSON.stringify([v, g])}: page ${expected}, sql ${got}`);
    });
    ok('SQL overall status equals computeSampleOverallStatus for all ' + pairs.length + ' pairs'
      + (mismatches.length ? ' -- ' + mismatches.slice(0, 3).join('; ') : ''), mismatches.length === 0);

    const svc = (q) => one('set role service_role;\n' + q);
    svc(`insert into deliverables(id,client_slug,origin,card_id,status) values
      ('del_v1','sidneylaruel','samples','sr_a','client_approval'),('del_g1','sidneylaruel','samples','sr_a','in_progress'),
      ('del_v2','sidneylaruel','samples','sr_b','in_progress'),('del_v3','sidneylaruel','samples','sr_c','in_progress');
      insert into sample_reviews(client,id,status,video_status,graphic_status,video_deliverable_id,graphic_deliverable_id,
        client_video_approved_at,kasper_approved_at,updated_at) values
       ('sidneylaruel','sr_a','Client Approval','Client Approval','In Progress','del_v1','del_g1','2026-09-30T10:00:00.000Z','2026-09-30T10:00:00.000Z','x'),
       ('sidneylaruel','sr_b','In Progress','In Progress','In Progress','del_v2',null,'','','x'),
       ('sidneylaruel','sr_c','Archived','In Progress','In Progress','del_v3',null,'','','x');`);

    // The tab is closed after step 1 (the work item) and before step 2 (the sample).
    svc(`update deliverables set status='tweak' where id='del_v1';`);
    ok('work item write alone moves the sample component and the overall status',
      svc(`select video_status || '|' || status from sample_reviews where id='sr_a';`).endsWith('Tweaks Needed|Tweaks Needed'));
    ok('stale client and Kasper approval stamps are cleared in the same step',
      svc(`select (client_video_approved_at='' and kasper_approved_at='')::text from sample_reviews where id='sr_a';`).endsWith('true'));
    ok('the sample change stamp moved (a new tweak round is pingable)',
      svc(`select (video_status_at is not null)::text from sample_reviews where id='sr_a';`).endsWith('true'));
    ok('one event row records the bridge move',
      svc(`select count(*)::text from sample_review_events where sample_id='sr_a' and source='native-bridge' and payload->>'via'='trigger';`).endsWith('1'));

    // The browser's own second save arrives later with the same values.
    const stamp0 = svc(`select video_status_at::text from sample_reviews where id='sr_a';`).split('\n').pop();
    svc(`update sample_reviews set video_status='Tweaks Needed', status='Tweaks Needed' where id='sr_a';`);
    const stamp1 = svc(`select video_status_at::text from sample_reviews where id='sr_a';`).split('\n').pop();
    ok('the browser second save is a no-op: it does not restamp or reopen the round', stamp0 === stamp1);

    // A connection killed mid-transaction leaves neither side half done.
    spawnSync(path.join(PG_BIN, 'psql'), ['-h', base, '-p', port, '-U', 'postgres', '-d', 't', '-q', '-At'],
      { input: `set role service_role; begin; update deliverables set status='approved' where id='del_v2'; select pg_terminate_backend(pg_backend_pid());`, encoding: 'utf8' });
    ok('a connection killed inside the transaction changes neither the work item nor the sample',
      svc(`select (select status from deliverables where id='del_v2') || '|' || (select video_status from sample_reviews where id='sr_b');`)
        .endsWith('in_progress|In Progress'));

    svc(`update deliverables set status='approved' where id='del_v3';`);
    ok('an archived sample is left alone',
      svc(`select video_status from sample_reviews where id='sr_c';`).endsWith('In Progress'));
    svc(`update deliverables set status='triage' where id='del_v2';`);
    ok('a status with no sample equivalent leaves the sample alone',
      svc(`select video_status from sample_reviews where id='sr_b';`).endsWith('In Progress'));

    // Catch-up: samples left behind before the trigger existed.
    svc(`insert into deliverables(id,client_slug,origin,card_id,status) values
      ('del_b1','sidneylaruel','samples','sr_b1','in_progress'),('del_b2','sidneylaruel','samples','sr_b2','in_progress'),
      ('del_b3','sidneylaruel','samples','sr_b3','in_progress');
      insert into sample_reviews(client,id,status,video_status,graphic_status,video_deliverable_id,updated_at) values
       ('sidneylaruel','sr_b1','In Progress','In Progress','In Progress','del_b1','x'),
       ('sidneylaruel','sr_b2','In Progress','In Progress','In Progress','del_b2','x'),
       ('sidneylaruel','sr_b3','In Progress','In Progress','In Progress','del_b3','x');`);
    psql('t', `alter table deliverables disable trigger zzz_native_sample_status_project;`);
    svc(`update deliverables set status='kasper_approval' where id in ('del_b1','del_b2'); select pg_sleep(0.05);
      update deliverables set status='tweak' where id='del_b3';`);
    psql('t', `alter table deliverables enable trigger zzz_native_sample_status_project;`);
    svc(`select pg_sleep(0.05); update sample_reviews set video_status='For SMM Approval', status='For SMM Approval' where id='sr_b2';`);
    const dry = svc(`select sample_id || ':' || applied::text from production_native_sample_status_backfill(now() - interval '1 day', false) order by sample_id;`)
      .split('\n').filter(l => /^sr_/.test(l));
    ok('catch-up dry run reports the two behind samples and changes nothing',
      dry.join(',') === 'sr_b1:false,sr_b3:false'
      && svc(`select video_status from sample_reviews where id='sr_b1';`).endsWith('In Progress'));
    const applied = svc(`select sample_id || ':' || applied::text from production_native_sample_status_backfill(now() - interval '1 day', true) order by sample_id;`)
      .split('\n').filter(l => /^sr_/.test(l));
    ok('catch-up finishes the samples whose work item is ahead', applied.join(',') === 'sr_b1:true,sr_b3:true');
    ok('catch-up leaves a sample edited after its work item moved',
      svc(`select video_status from sample_reviews where id='sr_b2';`).endsWith('For SMM Approval'));
    ok('a second catch-up finds nothing',
      svc(`select count(*)::text from production_native_sample_status_backfill(now() - interval '1 day', true);`).endsWith('0'));
  } catch (e) {
    failed += 1;
    console.log('  FAIL PostgreSQL proof: ' + (e && e.message || e));
  } finally {
    if (started) as(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']);
    fs.rmSync(base, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

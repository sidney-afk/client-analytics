'use strict';
/*
 * Contract suite for the Calendar OVERALL status bridge
 * (migrations/2026-10-01-calendar-overall-status-bridge.sql).
 *
 * THE FAILURE THIS EXISTS TO CATCH. The native status bridge moved a card's
 * COMPONENT status when an editor changed a work item on Production and left the
 * card's overall `status` alone, so a card whose video had just gone to For SMM
 * Approval kept reading Tweaks Needed until someone saved it in the Calendar.
 *
 * Two halves:
 *   1. Always runs, offline: the structural facts the deploy tooling depends on.
 *   2. Runs when a disposable PostgreSQL 16 is available (or is required with
 *      CAL_OVERALL_REQUIRE_POSTGRES=1): executes the REAL migrations (the
 *      Calendar table, its change-stamp trigger, the event table, the 09-18
 *      bridge and the subject migration) in a throwaway cluster and proves:
 *        - the SQL overall equals the page's own computeOverallStatus over every
 *          triple of a long value list;
 *        - a Production-side change moves the component AND the overall in one
 *          step, and that this is the migration's doing (same scenario run
 *          BEFORE it is applied leaves the overall stale);
 *        - the no-op guards, stale approval stamps, archived cards;
 *        - the repair: dry run lists exactly the mismatched cards, apply fixes
 *          them, a rerun finds none, a card edited concurrently is not clobbered.
 *      Uses only the invented slug `sidneylaruel` and invented ids. Never
 *      contacts a hosted backend.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const MIG = (n) => path.join(ROOT, 'migrations', n);
const MIGRATION = MIG('2026-10-01-calendar-overall-status-bridge.sql');
const sql = fs.readFileSync(MIGRATION, 'utf8');
const oldBridge = fs.readFileSync(MIG('2026-09-18-native-calendar-status-bridge.sql'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'src', 'index', '120-calendar-flags-write-repair.js.part'), 'utf8');

let passed = 0;
let failed = 0;
const ok = (name, value) => {
  if (value) { passed += 1; console.log(`  ok ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}`); }
};

/* ---- the page's own functions, executed ----------------------------------- */
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
  grabLine(page, /const CAL_STATUSES\s*=\s*\[[^\]]*\];/) + '\n'
  + grabLine(page, /const CAL_PRIORITY\s*=\s*\{[^}]*\};/) + '\n'
  + grabLine(page, /const CAL_COMPONENTS\s*=\s*\[[^\]]*\];/) + '\n'
  + grabFunc(page, '_calNormStatus') + '\n'
  + grabFunc(page, 'computeOverallStatus') + '\n'
  + 'return { computeOverallStatus, CAL_STATUSES };')();
const CAL_STATUSES = pageOverall.CAL_STATUSES;

const VALUES = [
  ...CAL_STATUSES,
  'Draft', 'draft', 'DRAFT', 'SMM Approval', 'smm approval', 'For Kasper Approval', 'for kasper approval',
  'FOR KASPER APPROVAL', 'Kasper Approval', 'for smm approval', 'TWEAKS NEEDED', 'approved', 'n/a',
  '', '   ', null, '\tIn Progress\n', '  tweaks needed ', ' Posted ', '﻿Approved',
  'For  SMM Approval', 'Banana', 'archived',
];
const triples = VALUES.length ** 3;

/* ---- always on: structure -------------------------------------------------- */
console.log('calendar overall status bridge: structure');
ok('the page defines the roll-up pieces this suite executes',
  typeof pageOverall.computeOverallStatus === 'function' && CAL_STATUSES.includes('N/A'));
ok('value list includes every CAL_STATUSES entry, N/A, empty, null, legacy spellings and an unknown',
  CAL_STATUSES.every(s => VALUES.includes(s)) && VALUES.includes('') && VALUES.includes(null)
  && VALUES.includes('Draft') && VALUES.includes('SMM Approval') && VALUES.includes('for kasper approval')
  && VALUES.includes('Banana'));
ok('the trigger function keeps its name, takes no arguments, returns trigger and is not SECURITY DEFINER',
  /create or replace function public\.production_native_calendar_status_project\(\)\s+returns trigger/.test(sql)
  && !/security\s+definer/i.test(sql));
ok('the migration does not recreate the trigger (the pinned trigger, tgtype and null tgqual stay exactly as they are)',
  !/create\s+trigger/i.test(sql) && !/drop\s+trigger/i.test(sql));
ok('the old migration still defines the trigger as plain AFTER UPDATE FOR EACH ROW with no WHEN',
  /create trigger zzz_native_calendar_status_project\s+after update on public\.deliverables\s+for each row\s+execute function/.test(oldBridge));
ok('every new function revokes from public, anon and authenticated by name and grants service_role explicitly',
  (sql.match(/revoke all on function/g) || []).length === 4
  && (sql.match(/from public, anon, authenticated;/g) || []).length + (sql.match(/\n  from public, anon, authenticated;/g) || []).length >= 4
  && (sql.match(/grant execute on function/g) || []).length === 4
  && (sql.match(/to service_role;/g) || []).length === 4);
ok('both writing branches set status in the same UPDATE and keep the is-distinct-from guards',
  (sql.match(/status = public\.production_native_calendar_overall_status\(/g) || []).length === 2
  && /and p\.video_status is distinct from v_target/.test(sql)
  && /and p\.graphic_status is distinct from v_target/.test(sql));
ok('the event row keeps source native-bridge and gains the overall in its payload',
  /'native-bridge'/.test(sql) && /overall_from_status/.test(sql) && /overall_to_status/.test(sql));
ok('the repair uses a distinct action so the Kasper sent-to history (status_change rows) never sees it',
  /'overall_status_change'/.test(sql) && /for update;/.test(sql));
const pf = require('../scripts/linear-exit-deploy-preflight.js');
const pin = pf.ROUTINES.find(r => r[2] === 'production_native_calendar_status_project');
ok('the preflight still pins the trigger function by the same name and search path',
  !!pin && pin[3] === 'public, pg_temp' && pin[4] === false);
ok('the preflight pins none of the three new routines yet (they are not live; a pin would refuse a deploy)',
  !pf.ROUTINES.some(r => /calendar_overall_status|calendar_status_norm/.test(r[0])));
{
  const re = new RegExp('create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.production_native_calendar_status_project\\s*\\([\\s\\S]*?\\)'
    + '[\\s\\S]*?\\bas\\s+(\\$[A-Za-z0-9_]*\\$)([\\s\\S]*?)\\1\\s*;', 'i');
  const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
  const oldBody = oldBridge.match(re)[2];
  const newBody = sql.match(re)[2];
  console.log(`  info trigger body md5 pinned today ${md5(oldBody)}, after this migration ${md5(newBody)}`);
  ok('the body really changes (so the pin must be re-pointed when the migration is applied)', md5(oldBody) !== md5(newBody));
}

/* ---- the PostgreSQL proof -------------------------------------------------- */
const PG_BIN = '/usr/lib/postgresql/16/bin';
const haveServer = fs.existsSync(path.join(PG_BIN, 'postgres')) && fs.existsSync(path.join(PG_BIN, 'initdb'));
const required = process.env.CAL_OVERALL_REQUIRE_POSTGRES === '1';
if (!haveServer) {
  if (required) { failed += 1; console.log('  FAIL PostgreSQL 16 required but not installed'); }
  else console.log('SKIP calendar overall status bridge PostgreSQL proof: PostgreSQL 16 not installed');
} else {
  console.log('calendar overall status bridge: PostgreSQL');
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const base = fs.mkdtempSync(path.join(asRoot ? '/var/tmp' : os.tmpdir(), 'cal-overall-'));
  fs.chmodSync(base, 0o755);
  const port = String(55000 + Math.floor(Math.random() * 4000));
  const as = (cmd, args, opts) => asRoot
    ? spawnSync('runuser', ['-u', 'postgres', '--', cmd, ...args], Object.assign({ encoding: 'utf8' }, opts))
    : spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts));
  if (asRoot) spawnSync('chown', ['postgres', base]);
  const data = path.join(base, 'data');
  let started = false;
  const PSQL_ARGS = ['-h', base, '-p', port, '-U', 'postgres', '-d', 't', '-v', 'ON_ERROR_STOP=1', '-q', '-At'];
  const psql = (db, input) => {
    const args = PSQL_ARGS.slice(); args[args.indexOf('-d') + 1] = db;
    const r = spawnSync(path.join(PG_BIN, 'psql'), args, { input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0) throw new Error('psql failed: ' + (r.stderr || '').trim());
    return r.stdout.trim();
  };
  const one = (q) => psql('t', q);
  const svc = (q) => { const o = one('set role service_role;\n' + q); return o.replace(/^SET\n?/, ''); };
  const last = (q) => svc(q).split('\n').pop();
  try {
    const init = as(path.join(PG_BIN, 'initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale']);
    assert.equal(init.status, 0, 'initdb failed: ' + init.stderr);
    const start = as(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${base} -c listen_addresses=''`,
      '-l', path.join(base, 'log'), '-w', 'start']);
    assert.equal(start.status, 0, 'pg_ctl start failed: ' + start.stderr);
    started = true;
    psql('postgres', 'create database t');

    // Roles and the one stand-in: the work item table (only the columns the
    // bridge reads). Everything else is the repository's own SQL.
    psql('t', `
      do $$ begin create role anon; create role authenticated; create role service_role bypassrls;
      exception when duplicate_object then null; end $$;
      create publication supabase_realtime;
      create table public.deliverables(id text primary key, client_slug text, origin text, card_id text,
        team text, kind text, status text, status_at timestamptz, updated_at timestamptz default now());`);
    // The real calendar_posts definition (from the live-schema baseline), plus the
    // two slot columns the data-model migration adds and its primary key.
    const baseline = fs.readFileSync(MIG('live-schema-baseline-2026-07-03.sql'), 'utf8');
    const t0 = baseline.indexOf('create table if not exists public.calendar_posts (');
    assert.ok(t0 >= 0, 'baseline no longer defines calendar_posts');
    psql('t', baseline.slice(t0, baseline.indexOf(');', t0) + 2)
      + `\nalter table public.calendar_posts add column video_deliverable_id text, add column graphic_deliverable_id text;
         alter table only public.calendar_posts add constraint calendar_posts_pkey primary key (client, id);`);
    psql('t', fs.readFileSync(MIG('2026-07-03-a1-calendar-upsert.sql'), 'utf8'));
    psql('t', fs.readFileSync(MIG('calendar-status-at-migration.sql'), 'utf8'));
    // A work item's own change stamp, as the live table has it.
    psql('t', `create function public.dstamp() returns trigger language plpgsql as $f$ begin
        if tg_op='INSERT' or new.status is distinct from old.status then new.status_at := now(); end if;
        return new; end $f$;
      create trigger a_stamp before insert or update on public.deliverables for each row execute function public.dstamp();`);
    psql('t', oldBridge);
    psql('t', `grant all on all tables in schema public to service_role;
      grant all on all sequences in schema public to service_role;`);
    ok('the real 09-18 bridge applies on the real calendar table', true);

    const seed = (suffix, post, vid, gid) => `
      insert into deliverables(id,client_slug,origin,card_id,team,kind,status) values
        ${vid ? `('dv_${suffix}','sidneylaruel','calendar','${post}','video','video','${vid}')` : ''}${vid && gid ? ',' : ''}
        ${gid ? `('dg_${suffix}','sidneylaruel','calendar','${post}','graphics','thumbnail','${gid}')` : ''};`;
    const card = (id, status, v, g, c, extra = {}) => `insert into calendar_posts
      (client,id,status,video_status,graphic_status,caption_status,video_deliverable_id,graphic_deliverable_id,
       client_video_approved_at,client_graphic_approved_at,kasper_approved_at,updated_at) values
      ('sidneylaruel','${id}','${status}','${v}','${g}','${c}',${extra.vid ? `'${extra.vid}'` : 'null'},${extra.gid ? `'${extra.gid}'` : 'null'},
       '${extra.cva || ''}','${extra.cga || ''}','${extra.ka || ''}','2026-10-01T10:00:00.000Z');`;
    const get = (id, cols) => last(`select ${cols} from calendar_posts where id='${id}';`);

    /* PARTNER: the scenario BEFORE the migration. Same card, same write. */
    svc(seed('before', 'pre1', 'tweak', 'in_progress') + card('pre1', 'Tweaks Needed', 'Tweaks Needed', 'In Progress', 'In Progress', { vid: 'dv_before', gid: 'dg_before' }));
    svc(`update deliverables set status='smm_approval' where id='dv_before';`);
    ok('BEFORE the migration: the bridge moves the component and leaves the overall stale (the defect)',
      get('pre1', "video_status||'|'||status") === 'For SMM Approval|Tweaks Needed');

    psql('t', sql);
    ok('migration applies', true);
    psql('t', sql);
    ok('migration applies twice (idempotent)', true);
    ok('the old trigger is still the one trigger on deliverables, still tgtype 17 with no WHEN',
      one(`select count(*)||'|'||min(tgtype)||'|'||bool_and(tgqual is null)::text||'|'||bool_and(tgenabled='O')::text
           from pg_trigger where tgrelid='public.deliverables'::regclass and tgname='zzz_native_calendar_status_project';`) === '1|17|true|true');
    ok('trigger function: not SECURITY DEFINER, search_path pinned, executable by service_role only',
      one(`select (not prosecdef)::text||'|'||array_to_string(proconfig,',')||'|'||has_function_privilege('service_role',oid,'EXECUTE')::text
           ||'|'||has_function_privilege('anon',oid,'EXECUTE')::text||'|'||has_function_privilege('authenticated',oid,'EXECUTE')::text
           from pg_proc where proname='production_native_calendar_status_project';`) === 'true|search_path=public, pg_temp|true|false|false');
    ok('all new routines: no EXECUTE for public, anon or authenticated; service_role has it',
      one(`select string_agg(has_function_privilege('service_role',p.oid,'EXECUTE')::text||has_function_privilege('anon',p.oid,'EXECUTE')::text
             ||has_function_privilege('authenticated',p.oid,'EXECUTE')::text||(not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a where a.grantee=0))::text, ',' order by p.proname)
           from pg_proc p where p.proname in ('production_native_calendar_overall_status','production_native_calendar_status_norm','production_native_calendar_overall_status_repair');`)
        === 'truefalsefalsetrue,truefalsefalsetrue,truefalsefalsetrue');

    /* SQL overall status equals the page's, triple by triple. */
    const out = one(`with v as (select val, ord from jsonb_array_elements_text($j$${JSON.stringify(VALUES)}$j$::jsonb) with ordinality t(val, ord))
      select a.ord||','||b.ord||','||c.ord||'|'||coalesce(public.production_native_calendar_overall_status(a.val,b.val,c.val),'<<null>>')
      from v a, v b, v c;`).split('\n');
    const mismatches = [];
    let n = 0;
    for (const line of out) {
      n += 1;
      const [a, b, c] = line.slice(0, line.indexOf('|')).split(',').map(x => Number(x) - 1);
      const got = line.slice(line.indexOf('|') + 1);
      const exp = pageOverall.computeOverallStatus({ video_status: VALUES[a], graphic_status: VALUES[b], caption_status: VALUES[c] });
      if (got !== exp) mismatches.push(`${JSON.stringify([VALUES[a], VALUES[b], VALUES[c]])}: page ${exp}, sql ${got}`);
    }
    ok(`SQL overall equals computeOverallStatus for all ${triples} triples of ${VALUES.length} values`
      + (mismatches.length ? ' -- ' + mismatches.slice(0, 3).join('; ') : ''), n === triples && out.length === triples && mismatches.length === 0);
    ok('the page and SQL agree that all-N/A returns N/A and that an empty lane counts as In Progress',
      pageOverall.computeOverallStatus({ video_status: 'N/A', graphic_status: 'N/A', caption_status: 'N/A' }) === 'N/A'
      && one(`select public.production_native_calendar_overall_status('N/A','N/A','N/A')||'|'||public.production_native_calendar_overall_status('Posted','','Posted');`) === 'N/A|In Progress');

    /* THE LIVE SCENARIO: video to For SMM Approval while graphic and caption are In Progress. */
    svc(seed('live', 'live1', 'tweak', 'in_progress') + card('live1', 'Tweaks Needed', 'Tweaks Needed', 'In Progress', 'In Progress', { vid: 'dv_live', gid: 'dg_live' }));
    svc(`update deliverables set status='smm_approval' where id='dv_live';`);
    ok('AFTER the migration: one Production-side change moves the component AND the overall (In Progress, not Tweaks Needed)',
      get('live1', "video_status||'|'||status") === 'For SMM Approval|In Progress');
    ok('the event row carries the component move and the overall move',
      last(`select to_status||'|'||(payload->>'overall_from_status')||'|'||(payload->>'overall_to_status')||'|'||source||'|'||(payload->>'via')
            from calendar_post_events where post_id='live1' and source='native-bridge';`) === 'For SMM Approval|Tweaks Needed|In Progress|native-bridge|trigger'
      && last(`select count(*) from calendar_post_events where post_id='live1';`) === '1');
    // Graphic branch, and the overall rising when the worst lane clears.
    svc(`update deliverables set status='approved' where id='dg_live';`);
    ok('graphic branch: component moves and the overall is still the worst of the other lanes (caption In Progress)',
      get('live1', "graphic_status||'|'||status") === 'Approved|In Progress');
    svc(seed('rise', 'rise1', 'smm_approval', 'approved') + card('rise1', 'In Progress', 'In Progress', 'Approved', 'Approved', { vid: 'dv_rise', gid: 'dg_rise' }));
    svc(`update deliverables set status='client_approval' where id='dv_rise';`);
    ok('the overall rises when the worst lane improves (In Progress -> Client Approval, Approved lanes above it)',
      get('rise1', "video_status||'|'||status") === 'Client Approval|Client Approval');
    svc(seed('posted', 'post1', 'approved', null) + card('post1', 'Approved', 'Approved', 'N/A', 'Posted', { vid: 'dv_posted' }));
    svc(`update deliverables set status='posted' where id='dv_posted';`);
    ok('N/A never drags: Posted + N/A + Posted rolls up to Posted',
      get('post1', "video_status||'|'||status") === 'Posted|Posted');

    /* Stale approval stamps are still cleared, now alongside the overall. */
    svc(seed('stamp', 'stamp1', 'approved', null) + card('stamp1', 'Approved', 'Approved', 'Approved', 'Approved',
      { vid: 'dv_stamp', cva: '2026-09-30T10:00:00.000Z', ka: '2026-09-30T10:00:00.000Z' }));
    svc(`update calendar_posts set client_graphic_approved_at='2026-09-30T10:00:00.000Z' where id='stamp1';`);
    svc(`update deliverables set status='tweak' where id='dv_stamp';`);
    ok('stale client approval stamp cleared and overall follows (Tweaks Needed)',
      get('stamp1', "status||'|'||client_video_approved_at||'|'||(kasper_approved_at<>'')::text") === 'Tweaks Needed||true');

    /* No-op guards: no restamp, no event, no write. */
    svc(seed('noop', 'noop1', 'todo', null) + card('noop1', 'In Progress', 'In Progress', 'In Progress', 'In Progress', { vid: 'dv_noop' }));
    const before = get('noop1', "video_status_at::text||'|'||updated_at||'|'||status");
    svc(`select pg_sleep(0.05); update deliverables set status='in_progress' where id='dv_noop';`);
    svc(`update deliverables set status='backlog' where id='dv_noop';`);
    ok('moving between statuses that map to the same calendar value restamps nothing and writes no event',
      get('noop1', "video_status_at::text||'|'||updated_at||'|'||status") === before
      && last(`select count(*) from calendar_post_events where post_id='noop1';`) === '0');
    svc(seed('stale', 'stale1', 'in_progress', null) + card('stale1', 'Tweaks Needed', 'In Progress', 'In Progress', 'In Progress', { vid: 'dv_stale' }));
    svc(`update deliverables set status='todo' where id='dv_stale';`);
    ok('a component that already holds the mapped value is not rewritten, even when the overall is stale (the repair heals that, not a no-op firing)',
      get('stale1', 'status') === 'Tweaks Needed');
    svc(seed('triage', 'triage1', 'in_progress', null) + card('triage1', 'In Progress', 'In Progress', 'In Progress', 'In Progress', { vid: 'dv_triage' }));
    svc(`update deliverables set status='triage' where id='dv_triage';`);
    ok('a status with no calendar equivalent leaves the card alone', get('triage1', "video_status||'|'||status") === 'In Progress|In Progress');

    /* Archived cards are untouched. */
    svc(seed('arch', 'arch1', 'in_progress', null) + card('arch1', 'Archived', 'In Progress', 'In Progress', 'In Progress', { vid: 'dv_arch' }));
    const archBefore = get('arch1', "video_status||'|'||status||'|'||updated_at");
    svc(`update deliverables set status='approved' where id='dv_arch';`);
    ok('an archived card is untouched (component, overall and updated_at)', get('arch1', "video_status||'|'||status||'|'||updated_at") === archBefore);

    /* ------------------------------ repair ------------------------------ */
    // Clean slate for an exact list: every earlier card is consistent or out of scope.
    svc(`delete from calendar_post_events; delete from calendar_posts where id like 'stale1';`);
    const mismatch = (id, st, v, g, c, link = true) => card(id, st, v, g, c, link ? { vid: 'dv_' + id } : {});
    svc(seed('m1', 'm1', 'in_progress', null) + mismatch('m1', 'Tweaks Needed', 'For SMM Approval', 'In Progress', 'In Progress')
      + seed('m2', 'm2', 'posted', null) + mismatch('m2', 'Approved', 'Posted', 'Posted', 'Posted')
      + seed('okc', 'okc', 'in_progress', null) + mismatch('okc', 'In Progress', 'In Progress', 'Approved', 'Approved')
      + seed('mar', 'mar', 'in_progress', null) + mismatch('mar', 'Archived', 'Tweaks Needed', 'Posted', 'Posted')
      + mismatch('mun', 'Approved', 'Tweaks Needed', 'Tweaks Needed', 'Tweaks Needed', false));
    const snap = () => last(`select md5(string_agg(id||status||video_status||graphic_status||caption_status||updated_at||coalesce(video_status_at::text,''),'|' order by id)) from calendar_posts;`);
    const snap0 = snap();
    const dry = svc(`select post_id||':'||from_status||'>'||to_status||':'||applied::text from production_native_calendar_overall_status_repair() order by post_id;`);
    ok('dry run (the default) lists exactly the mismatched, linked, non-archived cards (the two seeded ones plus the card left stale by the BEFORE scenario)',
      dry === 'm1:Tweaks Needed>In Progress:false\nm2:Approved>Posted:false\npre1:Tweaks Needed>In Progress:false');
    ok('dry run changes nothing and writes no event', snap() === snap0 && last(`select count(*) from calendar_post_events;`) === '0');
    const applied = svc(`select post_id||':'||applied::text from production_native_calendar_overall_status_repair(true) order by post_id;`);
    ok('apply fixes exactly those cards and reports each as applied', applied === 'm1:true\nm2:true\npre1:true');
    ok('the all-Posted card now reads Posted, the stale pair reads In Progress',
      get('m1', 'status') === 'In Progress' && get('m2', 'status') === 'Posted');
    ok('apply bumped updated_at, left components and the change stamp alone, and touched no out-of-scope card',
      get('m1', "(updated_at<>'2026-10-01T10:00:00.000Z')::text||'|'||video_status") === 'true|For SMM Approval'
      && get('okc', 'updated_at') === '2026-10-01T10:00:00.000Z' && get('mar', 'status') === 'Archived' && get('mun', 'status') === 'Approved');
    ok('one overall_status_change event per fixed card, source native-bridge, via repair',
      last(`select count(*)||'|'||min(source)||'|'||min(action)||'|'||min(payload->>'via') from calendar_post_events;`) === '3|native-bridge|overall_status_change|repair'
      && last(`select from_status||'>'||to_status from calendar_post_events where post_id='m2';`) === 'Approved>Posted');
    ok('the urgent-ping dedupe stamp did not move for the repaired card',
      get('m1', "(video_status_at is not null and video_status_at < now() - interval '0 seconds')::text") === 'true'
      && last(`select (p.video_status_at = (select min(video_status_at) from calendar_posts where id='m1'))::text from calendar_posts p where id='m1';`) === 'true');
    const stampM1 = get('m1', 'video_status_at::text');
    const evBefore = last(`select count(*) from calendar_post_events;`);
    ok('a rerun finds none (dry and apply) and writes nothing',
      svc(`select count(*) from production_native_calendar_overall_status_repair();`).endsWith('0')
      && last(`select count(*) from production_native_calendar_overall_status_repair(true);`) === '0'
      && last(`select count(*) from calendar_post_events;`) === evBefore && get('m1', 'video_status_at::text') === stampM1);

    /* Concurrent edit: the card is saved from the Calendar between the scan and the lock. */
    svc(seed('c3', 'c3', 'approved', null) + mismatch('c3', 'Posted', 'Approved', 'Approved', 'Approved')
      + seed('c4', 'c4', 'approved', null) + mismatch('c4', 'Posted', 'Approved', 'Approved', 'Approved'));
    // The editing session is a separate process reading a script FILE: a piped
    // stdin would never flush while this process sits in synchronous calls.
    const holderScript = path.join(base, 'holder.sql');
    fs.writeFileSync(holderScript, `set role service_role; begin;
      update calendar_posts set caption_status='In Progress', status='In Progress', updated_at='2026-10-01T11:11:11.111Z' where id='c3';
      update calendar_posts set caption_status='Tweaks Needed' where id='c4';
      select pg_sleep(1.5); commit;`);
    fs.chmodSync(holderScript, 0o644);
    const holderLog = path.join(base, 'holder.log');
    fs.chmodSync(base, 0o777);
    const holder = spawn(path.join(PG_BIN, 'psql'), [...PSQL_ARGS, '-f', holderScript],
      { stdio: ['ignore', 'ignore', fs.openSync(holderLog, 'w')] });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    const racing = svc(`select post_id||':'||applied::text from production_native_calendar_overall_status_repair(true) order by post_id;`);
    ok('a card the Calendar saved meanwhile (overall already right) is not rewritten or reported', !/c3/.test(racing)
      && get('c3', "status||'|'||updated_at") === 'In Progress|2026-10-01T11:11:11.111Z'
      && last(`select count(*) from calendar_post_events where post_id='c3';`) === '0');
    ok('a card whose components moved meanwhile is fixed from its CURRENT components, not the scan snapshot (Tweaks Needed, not Approved)',
      racing === 'c4:true' && get('c4', 'status') === 'Tweaks Needed'
      && last(`select to_status from calendar_post_events where post_id='c4';`) === 'Tweaks Needed');
    ok('the concurrent editing session itself had no error', fs.readFileSync(holderLog, 'utf8').trim() === '');
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

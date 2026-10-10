'use strict';
/*
 * calendar-auto-posted (OPEN_REPAIRS 395): a Scheduled Calendar post turns Posted by itself once
 * its scheduled day has ended in US Eastern time, through the same server calls a click makes.
 *
 *   1. Offline: the overall-status rule equals the page's own functions over every triple of a
 *      value list; Eastern dates across both daylight-saving changes; the per-card decision; a whole
 *      run against fakes (work item first, then the card with a conflict base, a refusal stops
 *      the card, a dry run writes nothing, a "ui" source stops the run); static wiring (the
 *      function writes no table itself, the switch defaults off, the four roles are revoked, the
 *      migration writes no status); the calendar-upsert live delta script.
 *   2. With PostgreSQL 16 (required with CAL_AUTO_POSTED_REQUIRE_POSTGRES=1): runs the migration in
 *      a throwaway cluster with stand-ins for the tables it reads and for vault/cron, and proves
 *      what the due list returns and refuses, the grants, the refusal without the Vault key and
 *      the timer row. Only invented slugs and ids. Never contacts a backend.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0;
let failed = 0;
const ok = (name, value) => {
  if (value) { passed += 1; console.log(`  ok ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}`); }
};

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
  assert.ok(m, 'the page no longer has ' + re);
  return m[0];
}

(async () => {
  const L = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/calendar-auto-posted/logic.mjs')).href);
  console.log('calendar-auto-posted: offline');

  /* ---- 1. the page's overall status, executed ---- */
  const page = read('src/index/120-calendar-flags-write-repair.js.part');
  const pageSrc = [
    grabLine(page, /const CAL_STATUSES\s*=\s*\[[^\]]*\];/),
    grabLine(page, /const CAL_PRIORITY\s*=\s*\{[^}]*\};/),
    grabLine(page, /const CAL_COMPONENTS\s*=\s*\[[^\]]*\];/),
    grabFunc(page, '_calNormStatus'),
    grabFunc(page, 'computeOverallStatus'),
    'module.exports = { computeOverallStatus };',
  ].join('\n');
  const m = { exports: {} };
  new Function('module', pageSrc)(m);
  const values = ['', 'Scheduled', 'Posted', 'N/A', 'Approved', 'Tweaks Needed', 'In Progress', 'draft', 'scheduled', 'POSTED', 'Kasper Approval', 'smm approval', 'Client Approval', 'weird'];
  let same = true;
  for (const v of values) for (const g of values) for (const c of values) {
    const p = { video_status: v, graphic_status: g, caption_status: c };
    if (m.exports.computeOverallStatus(p) !== L.overallStatus(p)) same = false;
  }
  ok('overall status equals the page computeOverallStatus over ' + values.length ** 3 + ' triples', same);

  /* ---- Eastern dates ---- */
  const d = (iso) => new Date(iso);
  ok('23:59 EDT is still the 9th', L.easternToday(d('2026-10-10T03:59:00Z')) === '2026-10-09');
  ok('00:00 EDT is the 10th', L.easternToday(d('2026-10-10T04:00:00Z')) === '2026-10-10');
  ok('winter: 23:59 EST is still the 15th', L.easternToday(d('2026-01-16T04:59:00Z')) === '2026-01-15');
  ok('winter: 00:00 EST is the 16th', L.easternToday(d('2026-01-16T05:00:00Z')) === '2026-01-16');
  ok('spring-forward night', L.easternToday(d('2026-03-08T07:30:00Z')) === '2026-03-08');
  ok('fall-back night', L.easternToday(d('2026-11-01T04:30:00Z')) === '2026-11-01');
  ok('day ends at Eastern midnight, not UTC midnight',
    !L.dayHasEnded('2026-10-09', d('2026-10-10T01:00:00Z')) && L.dayHasEnded('2026-10-09', d('2026-10-10T04:00:01Z')));
  ok('today is never due', !L.dayHasEnded('2026-10-10', d('2026-10-10T20:00:00Z')));
  ok('a non-date is never due', !L.dayHasEnded('TBD', d('2026-10-10T20:00:00Z')) && !L.dayHasEnded('', d('2026-10-10T20:00:00Z')));

  /* ---- the per-card decision ---- */
  const NOW = d('2026-10-10T15:00:00Z');
  const OLD = '2026-10-08T12:00:00.000Z';
  const card = (over = {}) => Object.assign({
    client: 'test-client-a', id: 'p_test_1', status: 'Scheduled', scheduled_date: '2026-10-09', updated_at: OLD,
    video_status: 'Scheduled', graphic_status: 'Scheduled', caption_status: 'Scheduled',
    linear_issue_id: '', graphic_linear_issue_id: '',
    video_deliverable_id: 'd_v', video_deliverable_status: 'scheduled', video_deliverable_updated_at: OLD,
    graphic_deliverable_id: 'd_g', graphic_deliverable_status: 'scheduled', graphic_deliverable_updated_at: OLD,
  }, over);
  const p1 = L.planCard(card(), NOW);
  ok('linked card: both work items pushed, all three parts end Posted',
    p1.pushes.map(p => p.component).join() === 'video,graphic' && p1.lanes.join() === 'video,graphic,caption'
    && p1.pushes.every(p => p.expected_status === 'scheduled' && p.expected_updated_at === OLD));
  const p2 = L.planCard(card({ video_deliverable_id: '', graphic_deliverable_id: '', graphic_status: 'N/A' }), NOW);
  ok('unlinked card: no push, N/A part untouched', p2.pushes.length === 0 && p2.lanes.join() === 'video,caption');
  ok('a part already Posted is left alone', L.planCard(card({ caption_status: 'Posted' }), NOW).lanes.join() === 'video,graphic');
  for (const [name, over, reason] of [
    ['Approved overall', { status: 'Approved' }, 'not_scheduled'],
    ['Posted overall', { status: 'Posted' }, 'not_scheduled'],
    ['lower-case scheduled is not exactly Scheduled', { status: 'scheduled' }, 'not_scheduled'],
    ['scheduled today', { scheduled_date: '2026-10-10' }, 'not_due'],
    ['changed 20 minutes ago', { updated_at: '2026-10-10T14:40:00Z' }, 'changed_recently'],
    ['unreadable change stamp', { updated_at: 'yesterday' }, 'changed_recently'],
    ['parts disagree with overall', { caption_status: 'Tweaks Needed' }, 'parts_disagree'],
    ['work item already posted', { video_deliverable_status: 'posted' }, 'work_item_disagrees'],
    ['work item elsewhere', { graphic_deliverable_status: 'approved' }, 'work_item_disagrees'],
    ['work item row missing', { video_deliverable_status: null }, 'work_item_missing'],
    ['work item changed 5 minutes ago', { graphic_deliverable_updated_at: '2026-10-10T14:55:00Z' }, 'changed_recently'],
    ['old-style link with no work item', { video_deliverable_id: '', linear_issue_id: 'https://linear.app/x/issue/ABC-1' }, 'linked_without_work_item'],
  ]) ok('skip: ' + name, L.planCard(card(over), NOW).skip === reason);

  /* ---- the card save after the pushes ---- */
  const BIND = { scheduled_date: '2026-10-09', video_deliverable_id: 'd_v', graphic_deliverable_id: 'd_g', linear_issue_id: '', graphic_linear_issue_id: '' };
  ok('bridge moved video+graphic: only caption and overall left', JSON.stringify(L.calendarPatch(p1,
    { ...BIND, status: 'Scheduled', video_status: 'Posted', graphic_status: 'Posted', caption_status: 'Scheduled' }))
    === JSON.stringify({ caption_status: 'Posted', status: 'Posted' }));
  ok('bridge finished everything: nothing left to save', JSON.stringify(L.calendarPatch(L.planCard(card({ caption_status: 'N/A' }), NOW),
    { ...BIND, status: 'Posted', video_status: 'Posted', graphic_status: 'Posted', caption_status: 'N/A' })) === '{}');
  ok('a person moved the caption meanwhile: leave the card', L.calendarPatch(p1,
    { status: 'Tweaks Needed', video_status: 'Posted', graphic_status: 'Posted', caption_status: 'Tweaks Needed' }) === null);
  ok('a person moved an unplanned part: leave the card', L.calendarPatch(L.planCard(card({ caption_status: 'Posted' }), NOW),
    { status: 'Tweaks Needed', video_status: 'Posted', graphic_status: 'Posted', caption_status: 'Tweaks Needed' }) === null);
  ok('archived meanwhile: leave the card', L.calendarPatch(p1, { status: 'Archived', video_status: 'Posted', graphic_status: 'Posted', caption_status: 'Scheduled' }) === null);

  /* ---- a whole run, against fakes ---- */
  function fakes(rows, opts = {}) {
    const calls = [];
    const cards = new Map(rows.map(r => [r.id, { ...r }]));
    let clock = NOW.getTime();
    return {
      calls, cards,
      now: () => new Date(clock),
      sleep: async (ms) => { clock += ms; },
      due: async () => rows,
      pushWorkItem: async (push, ctx) => {
        calls.push(['push', ctx.id, push.component, push.expected_status]);
        if (opts.refusePush) return { ok: false, error: 'write_conflict' };
        const c = cards.get(ctx.id);           // the bridge, in the same step
        c[push.component + '_status'] = 'Posted';
        c.updated_at = new Date(clock).toISOString();
        return { ok: true };
      },
      readCard: async (_client, id) => {
        calls.push(['read', id]);
        if (opts.beforePushEdit && !calls.some(c => c[0] === 'push')) Object.assign(cards.get(id), opts.beforePushEdit);
        return { ...cards.get(id) };
      },
      saveCard: async (_client, id, patch, baseAt) => {
        calls.push(['save', id, JSON.stringify(patch), baseAt]);
        if (opts.conflict) return { ok: false, conflict: true };
        Object.assign(cards.get(id), patch);
        return { ok: true };
      },
      sourceOf: async () => opts.source || 'auto-posted',
      movedBefore: async (_client, id) => (opts.movedBefore || []).includes(id),
      halt: async (reason) => { calls.push(['halt', reason]); return { ok: !opts.haltFails }; },
    };
  }
  {
    const f = fakes([card()]);
    const r = await L.runTick(f, {});
    const order = f.calls.map(c => c[0]).join();
    ok('run: card re-checked, work items moved, card re-read, then saved', order === 'read,push,push,read,save');
    ok('run: the card save uses the card change time read AFTER the pushes',
      f.calls[4][3] === f.cards.get('p_test_1').updated_at && f.calls[4][3] !== OLD);
    ok('run: card ends Posted with every part Posted', f.cards.get('p_test_1').status === 'Posted'
      && ['video', 'graphic', 'caption'].every(c => f.cards.get('p_test_1')[c + '_status'] === 'Posted'));
    ok('run: counted, ids only', r.ok && r.flipped === 1 && r.flipped_ids.join() === 'p_test_1' && !JSON.stringify(r).includes('test-client-a'));
  }
  {
    const f = fakes([card()], { refusePush: true });
    const r = await L.runTick(f, {});
    ok('run: a refused work item stops that card before the card save', !f.calls.some(c => c[0] === 'save') && r.failed['work_item:write_conflict'] === 1 && r.flipped === 0);
  }
  {
    const f = fakes([card()], { conflict: true });
    const r = await L.runTick(f, {});
    ok('run: a person saving in between wins (conflict counted, not flipped)', r.failed.card_conflict === 1 && r.flipped === 0);
  }
  {
    const f = fakes([card(), card({ id: 'p_test_2', status: 'Approved' })]);
    const r = await L.runTick(f, { dryRun: true });
    ok('dry run: writes nothing, says what it would do', f.calls.length === 0 && r.would_flip === 1 && r.skipped.not_scheduled === 1);
  }
  for (const [name, edit] of [
    ['rescheduled to a later day', { scheduled_date: '2026-10-20', updated_at: '2026-10-10T14:59:00Z' }],
    ['relinked to another work item', { video_deliverable_id: 'd_other' }],
    ['a part changed', { caption_status: 'Tweaks Needed', status: 'Tweaks Needed' }],
  ]) {
    const f = fakes([card()], { beforePushEdit: edit });
    const r = await L.runTick(f, {});
    ok('run: card ' + name + ' after the due list: no work item moved, nothing saved',
      !f.calls.some(c => c[0] === 'push' || c[0] === 'save') && r.skipped.changed_while_running === 1);
  }
  ok('the card save refuses a card whose day or link moved after the pushes',
    L.calendarPatch(p1, { status: 'Scheduled', video_status: 'Posted', graphic_status: 'Posted', caption_status: 'Scheduled', scheduled_date: '2026-10-20', video_deliverable_id: 'd_v', graphic_deliverable_id: 'd_g', linear_issue_id: '', graphic_linear_issue_id: '' }) === null);
  {
    const f = fakes([card(), card({ id: 'p_test_2' })], { source: 'none' });
    const r = await L.runTick(f, {});
    ok('run: stops when the history receipt cannot be confirmed', r.ok === false && r.error === 'calendar_history_unconfirmed' && !f.calls.some(c => c[1] === 'p_test_2'));
    ok('run: an unconfirmed receipt stops it FOR GOOD (halt called, reported)', r.halted === true
      && f.calls.some(c => c[0] === 'halt' && c[1] === 'calendar_history_unconfirmed'));
  }
  {
    const f = fakes([card()], { source: 'other', haltFails: true });
    const r = await L.runTick(f, {});
    ok('run: a failed halt write is reported, never hidden', r.ok === false && r.halted === false && r.halt_failed === true);
  }
  {
    const f = fakes([card(), card({ id: 'p_test_2' })], { movedBefore: ['p_test_1'] });
    const r = await L.runTick(f, {});
    ok('run: a card the job moved once is never moved again (a person\'s undo wins)',
      r.skipped.already_auto_posted === 1 && !f.calls.some(c => c[1] === 'p_test_1' && (c[0] === 'push' || c[0] === 'save'))
      && r.flipped_ids.join() === 'p_test_2');
  }
  {
    const P = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/production-write/policy.mjs')).href);
    const rid = L.requestIdFor('p_native_6e0a_2', 'graphic', '2026-10-07 14:48:32.795+00');
    ok('request id is accepted by the gateway rule and stays deterministic', P.validRequestId(rid) === rid
      && rid === L.requestIdFor('p_native_6e0a_2', 'graphic', '2026-10-07 14:48:32.795+00')
      && rid !== L.requestIdFor('p_native_6e0a_2', 'video', '2026-10-07 14:48:32.795+00'));
  }
  {
    const f = fakes([card(), card({ id: 'p_test_2' })], { source: 'other' });
    const r = await L.runTick(f, {});
    ok('run: stops after one card if calendar-upsert records "ui" (delta not deployed)',
      r.ok === false && r.error === 'calendar_upsert_source_not_deployed' && r.flipped === 1
      && !f.calls.some(c => c[1] === 'p_test_2'));
    ok('run: a "ui" receipt stops it FOR GOOD (halt called, reported)', r.halted === true
      && f.calls.some(c => c[0] === 'halt' && c[1] === 'calendar_upsert_source_not_deployed'));
  }

  /* ---- static wiring ---- */
  const fn = read('supabase/functions/calendar-auto-posted/index.ts');
  const logic = read('supabase/functions/calendar-auto-posted/logic.mjs');
  ok('function writes no table itself (no insert/update/upsert/delete)', !/\.(insert|update|upsert|delete)\(/.test(fn + logic));
  ok('function moves work items through production-write and cards through calendar-upsert',
    fn.includes('/functions/v1/production-write') && fn.includes('/functions/v1/calendar-upsert'));
  ok('production-write body is the Calendar status pick with a compare-and-set',
    /operation: "status",\s*surface: "calendar",\s*entity: "deliverable"/.test(fn) && fn.includes('expected_status: push.expected_status') && fn.includes('expected_updated_at: push.expected_updated_at'));
  ok('calendar-upsert gets the conflict base', fn.includes('comments_base_at: baseAt'));
  ok('source header is auto-posted', L.SOURCE === 'auto-posted' && fn.includes('"x-syncview-source": SOURCE'));
  ok('auth is the Vault key checked by the database', fn.includes('calendar_auto_posted_key_ok') && fn.includes('x-calendar-auto-posted-key'));
  const mig = read('migrations/2026-10-10-calendar-auto-posted.sql');
  const migCode = mig.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  ok('switch defaults off', migCode.includes(`('calendar_auto_posted', '{"clients": []}'::jsonb`) && migCode.includes('on conflict (key) do nothing'));
  ok('migration writes no Calendar or work-item row', !/(update|insert\s+into|delete\s+from)\s+public\.(calendar_posts|deliverables|calendar_post_events)/i.test(migCode));
  ok('every function revoked from all four roles', (migCode.match(/from public, anon, authenticated, service_role;/g) || []).length === 9);
  ok('the timer and due list both honour the stop', migCode.includes('and (select not public.calendar_auto_posted_stopped())')
    && migCode.includes('where (select not public.calendar_auto_posted_stopped())'));
  ok('the only flag write turns the job OFF (empty client list)', /set value = jsonb_build_object\(\s*'clients', '\[\]'::jsonb/.test(migCode));
  ok('rollback note: a person\'s undo is never overruled', mig.includes('never overruled') && !mig.includes('a person can set them back like any other post'));
  ok('timer every 15 minutes, only when needed', migCode.includes(`'calendar-auto-posted-tick', '*/15 * * * *'`) && migCode.includes('where public.calendar_auto_posted_tick_needed()'));
  ok('due list is exactly Scheduled and Eastern time', migCode.includes(`p.status = 'Scheduled'`) && migCode.includes(`now() at time zone 'America/New_York'`));

  /* ---- the calendar-upsert live delta ---- */
  const D = require(path.join(ROOT, 'scripts/calendar-upsert-live-delta.js'));
  const liveLike = 'function actorFrom() {\n  const rawSource = "x";\n' + D.ANCHOR + '\n  return 1;\n}\n';
  const once = D.applyDelta(liveLike);
  ok('delta: one line changed, a note added', once.changed && once.text.includes(D.PATCHED) && !once.text.includes(D.ANCHOR)
    && once.text.split('\n').length === liveLike.split('\n').length + 1);
  ok('delta: idempotent', D.applyDelta(once.text).changed === false && D.applyDelta(once.text).text === once.text);
  let refused = false;
  try { D.applyDelta('no anchor here'); } catch (_e) { refused = true; }
  ok('delta: refuses a source without the anchor', refused);
  refused = false;
  try { D.applyDelta(D.ANCHOR + '\n' + D.ANCHOR); } catch (_e) { refused = true; }
  ok('delta: refuses two anchors', refused);
  const script = read('scripts/calendar-upsert-live-delta.js');
  ok('delta script: no supabase CLI deploy route, verify_jwt false stated', !/--no-verify-jwt/.test(script)
    && script.includes('there is deliberately no `supabase functions deploy` route') && script.includes('verify_jwt: false'));
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-delta-'));
    const crypto = require('node:crypto');
    const liveSrc = 'export const x = 1;\n' + D.ANCHOR + '\n';
    const write = (name, files, extra = {}) => {
      const f = path.join(tmp, name);
      fs.writeFileSync(f, JSON.stringify({ version: 83, verify_jwt: false, files, ...extra }));
      return f;
    };
    const live = write('live.json', [{ name: 'functions/calendar-upsert/index.ts', content: liveSrc }]);
    const before = crypto.createHash('sha256').update(liveSrc).digest('hex');
    const attempt = (args) => { const log = console.log; const err = console.error; console.log = () => {}; console.error = () => {}; try { return D.main(args); } catch (e) { return 'refused: ' + e.message; } finally { console.log = log; console.error = err; } };
    ok('delta script: refuses without --expect-sha', attempt([live, path.join(tmp, 'o1')]) === 2);
    ok('delta script: refuses a hash mismatch', /is not the expected/.test(String(attempt([live, path.join(tmp, 'o2'), '--expect-sha=' + 'a'.repeat(64)]))));
    ok('delta script: refuses an out-dir inside the repository', /inside the repository/.test(String(attempt([live, path.join(ROOT, 'tmp-delta-out'), '--expect-sha=' + before])))
      && !fs.existsSync(path.join(ROOT, 'tmp-delta-out')));
    const gated = write('gated.json', [{ name: 'functions/calendar-upsert/index.ts', content: 'authorizeBrowserWrite();\n' + D.ANCHOR + '\n' }]);
    ok('delta script: refuses input carrying authorizeBrowserWrite', /authorizeBrowserWrite/.test(String(attempt([gated, path.join(tmp, 'o3'), '--expect-sha=' + before]))));
    ok('delta script: writes the patched files on the measured hash', attempt([live, path.join(tmp, 'o4'), '--expect-sha=' + before]) === 0);
    const patched = fs.readFileSync(path.join(tmp, 'o4/functions/calendar-upsert/index.ts'), 'utf8');
    const after = crypto.createHash('sha256').update(patched).digest('hex');
    const liveAfter = write('after.json', [{ name: 'functions/calendar-upsert/index.ts', content: patched }]);
    ok('delta script: post-deploy check passes on the after-hash', attempt(['--check', liveAfter, '--expect-sha=' + after]) === 0);
    ok('delta script: post-deploy check fails on the old source', /not the expected after-hash/.test(String(attempt(['--check', live, '--expect-sha=' + after]))));
    const jwtOn = write('jwt.json', [{ name: 'functions/calendar-upsert/index.ts', content: patched }], { verify_jwt: true });
    ok('delta script: post-deploy check fails when verify_jwt is not false', /must be false/.test(String(attempt(['--check', jwtOn, '--expect-sha=' + after]))));
    ok('delta script: documents the measured v83 hashes', script.includes('67511f6763a2e3b7edd951ce473e5b3fa878c53cbf4d25e2efd564d3f2e91185')
      && script.includes('959a4fb3ce44082496976f839cd1b0614f8fd04e96fe7a3e582ac6be07672fad'));
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* ---- 2. PostgreSQL ---- */
  const PG_BIN = '/usr/lib/postgresql/16/bin';
  const haveServer = fs.existsSync(path.join(PG_BIN, 'postgres')) && fs.existsSync(path.join(PG_BIN, 'initdb'));
  if (!haveServer) {
    if (process.env.CAL_AUTO_POSTED_REQUIRE_POSTGRES === '1') { failed += 1; console.log('  FAIL PostgreSQL 16 required but not installed'); }
    else console.log('SKIP calendar-auto-posted PostgreSQL proof: PostgreSQL 16 not installed');
  } else {
    console.log('calendar-auto-posted: PostgreSQL');
    const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    const base = fs.mkdtempSync(path.join(asRoot ? '/var/tmp' : os.tmpdir(), 'cal-auto-posted-'));
    fs.chmodSync(base, 0o755);
    const port = String(55000 + Math.floor(Math.random() * 4000));
    const as = (cmd, args) => asRoot
      ? spawnSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { encoding: 'utf8' })
      : spawnSync(cmd, args, { encoding: 'utf8' });
    if (asRoot) spawnSync('chown', ['postgres', base]);
    const data = path.join(base, 'data');
    let started = false;
    const run = (db, input, allowFail) => {
      const r = spawnSync(path.join(PG_BIN, 'psql'), ['-h', base, '-p', port, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-At'],
        { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (r.status !== 0 && !allowFail) throw new Error('psql failed: ' + (r.stderr || '').trim());
      return allowFail ? r : r.stdout.trim();
    };
    const q = (s) => run('t', s);
    const migration = mig.replace(/^create extension if not exists pg_(cron|net);$/gm, '-- (extension stand-in)');
    try {
      assert.equal(as(path.join(PG_BIN, 'initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale']).status, 0);
      assert.equal(as(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -k ${base} -c listen_addresses=''`, '-l', path.join(base, 'log'), '-w', 'start']).status, 0);
      started = true;
      run('postgres', 'create database t');
      q(`
        do $$ begin create role anon; create role authenticated; create role service_role bypassrls;
        exception when duplicate_object then null; end $$;
        create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text);
        create schema cron; create table cron.job(jobid bigserial primary key, jobname text, schedule text, command text, active boolean default true);
        create function cron.schedule(n text, s text, c text) returns bigint language sql as
          $f$ insert into cron.job(jobname, schedule, command) values (n, s, c) returning jobid $f$;
        create function cron.unschedule(id bigint) returns boolean language sql as $f$ delete from cron.job where jobid = id returning true $f$;
        create table public.syncview_runtime_flags(key text primary key, value jsonb, updated_by text, updated_at timestamptz default now());
        create table public.calendar_posts(client text, id text, status text, scheduled_date text, updated_at text,
          video_status text, graphic_status text, caption_status text, linear_issue_id text, graphic_linear_issue_id text,
          video_deliverable_id text, graphic_deliverable_id text, primary key (client, id));
        create table public.deliverables(id text primary key, status text, updated_at timestamptz);
        create table public.calendar_post_events(id bigserial, client text, post_id text, ts timestamptz, source text, action text, actor text);
        grant usage on schema public to anon, authenticated, service_role;
        grant select on all tables in schema public to service_role;`);
      const noKey = run('t', migration, true);
      ok('refuses to run without the Vault key', noKey.status !== 0 && /calendar_auto_posted_key is missing/.test(noKey.stderr)
        && q(`select count(*) from cron.job`) === '0');
      q(`insert into vault.decrypted_secrets values ('calendar_auto_posted_key', repeat('k', 64));`);
      q(migration);
      q(migration);
      const timer = q(`select count(*) || ' ' || max(schedule) from cron.job where jobname = 'calendar-auto-posted-tick'`);
      ok('idempotent: one timer row, every 15 minutes (' + timer + ')', timer === '1 */15 * * * *');
      ok('switch row is off', q(`select value::text from syncview_runtime_flags where key = 'calendar_auto_posted'`) === '{"clients": []}');

      const ET = `(now() at time zone 'America/New_York')::date`;
      q(`
        insert into deliverables values ('d_ok', 'scheduled', now() - interval '2 days'), ('d_fresh', 'scheduled', now() - interval '5 minutes');
        insert into calendar_posts values
          ('test-client-a', 'due',        'Scheduled', to_char(${ET} - 1, 'YYYY-MM-DD'), to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'Scheduled','Scheduled','Scheduled', '', '', 'd_ok', null),
          ('test-client-a', 'today',      'Scheduled', to_char(${ET}, 'YYYY-MM-DD'),     to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'Scheduled','Scheduled','Scheduled', '', '', null, null),
          ('test-client-a', 'recent',     'Scheduled', to_char(${ET} - 3, 'YYYY-MM-DD'), to_char(now() - interval '10 minutes', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'Scheduled','Scheduled','Scheduled', '', '', null, null),
          ('test-client-a', 'event',      'Scheduled', to_char(${ET} - 3, 'YYYY-MM-DD'), to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'Scheduled','Scheduled','Scheduled', '', '', null, null),
          ('test-client-a', 'own_event',  'Scheduled', to_char(${ET} - 3, 'YYYY-MM-DD'), to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'Scheduled','Scheduled','Scheduled', '', '', null, null),
          ('test-client-a', 'item_fresh', 'Scheduled', to_char(${ET} - 3, 'YYYY-MM-DD'), to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'Scheduled','Scheduled','Scheduled', '', '', null, 'd_fresh'),
          ('test-client-a', 'approved',   'Approved',  to_char(${ET} - 3, 'YYYY-MM-DD'), to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'Approved','Approved','Approved', '', '', null, null),
          ('test-client-a', 'nodate',     'Scheduled', 'TBD',                            to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'Scheduled','Scheduled','Scheduled', '', '', null, null),
          ('test-client-a', 'badstamp',   'Scheduled', to_char(${ET} - 3, 'YYYY-MM-DD'), 'not a time', 'Scheduled','Scheduled','Scheduled', '', '', null, null),
          ('other-client', 'elsewhere',  'Scheduled', to_char(${ET} - 3, 'YYYY-MM-DD'), to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'Scheduled','Scheduled','Scheduled', '', '', null, null);
        insert into calendar_post_events(client, post_id, ts, source, action) values
          ('test-client-a', 'event', now() - interval '30 minutes', 'ui', 'status_change'),
          ('test-client-a', 'own_event', now() - interval '30 minutes', 'auto-posted', 'status_change');`);
      const due = () => q(`set role service_role; select string_agg(id, ',' order by id) from public.calendar_auto_posted_due(50);`).split('\n').pop();
      ok('switch off: nothing is due', due() === '');
      ok('switch off: the timer does not call the function', q(`select public.calendar_auto_posted_tick_needed()`) === 'f');
      q(`update syncview_runtime_flags set value = '{"clients": ["test-client-a"]}' where key = 'calendar_auto_posted'`);
      ok('test client on: only the ended, quiet, exactly-Scheduled cards, never one the job moved before', due() === 'due');
      ok('test client on: the timer calls the function', q(`select public.calendar_auto_posted_tick_needed()`) === 't');
      ok('due row carries the work item status and time', q(`set role service_role; select video_deliverable_status from public.calendar_auto_posted_due(50) where id = 'due';`).split('\n').pop() === 'scheduled');
      q(`update syncview_runtime_flags set value = '{"clients": ["*"]}' where key = 'calendar_auto_posted'`);
      ok('"*": every client', due() === 'due,elsewhere');

      // The SQL parts rule equals the page's rule over every triple of the usual vocabulary.
      const vocab = ['Scheduled', 'Posted', 'N/A', 'Approved', 'Tweaks Needed', '', ' scheduled ', 'POSTED', 'In Progress', 'Client Approval'];
      const triples = [];
      for (const a of vocab) for (const b of vocab) for (const c of vocab) triples.push([a, b, c]);
      const lit = (v) => "'" + v.replace(/'/g, "''") + "'";
      const sqlParts = q('select string_agg(public.calendar_auto_posted_parts_ok(v, g, c)::text, \',\' order by n) from (values '
        + triples.map((t, i) => `(${i}, ${lit(t[0])}, ${lit(t[1])}, ${lit(t[2])})`).join(',') + ') x(n, v, g, c);').split(',');
      const jsParts = triples.map(t => String(L.overallStatus({ video_status: t[0], graphic_status: t[1], caption_status: t[2] }) === 'Scheduled'));
      ok('SQL parts rule equals the page rule over ' + triples.length + ' triples', sqlParts.join() === jsParts.join());

      // 25 old cards that can never flip, then one good newer card: the good one must still come back.
      const old = `to_char(${ET} - 30, 'YYYY-MM-DD')`;
      const stamp = `to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
      const bad = [];
      for (let i = 0; i < 25; i++) {
        const kind = i % 5;
        const id = 'stuck_' + String(i).padStart(2, '0');
        if (kind === 0) bad.push(`('test-client-b', '${id}', 'Scheduled', ${old}, ${stamp}, 'Scheduled','Scheduled','Tweaks Needed', '', '', null, null)`);
        if (kind === 1) bad.push(`('test-client-b', '${id}', 'Scheduled', ${old}, ${stamp}, 'Scheduled','Scheduled','Scheduled', 'https://linear.app/x/issue/A-${i}', '', null, null)`);
        if (kind === 2) bad.push(`('test-client-b', '${id}', 'Scheduled', ${old}, ${stamp}, 'Scheduled','Scheduled','Scheduled', '', '', 'd_missing_${i}', null)`);
        if (kind === 3) bad.push(`('test-client-b', '${id}', 'Scheduled', ${old}, ${stamp}, 'Scheduled','Scheduled','Scheduled', '', '', null, 'd_posted')`);
        if (kind === 4) bad.push(`('test-client-b', '${id}', 'Scheduled', ${old}, ${stamp}, 'Scheduled','Scheduled','Scheduled', '', '', null, null)`);
      }
      q(`insert into deliverables values ('d_posted', 'posted', now() - interval '2 days'), ('d_good', 'scheduled', now() - interval '2 days');
         insert into calendar_posts values ${bad.join(',\n')},
           ('test-client-b', 'newer_good', 'Scheduled', to_char(${ET} - 1, 'YYYY-MM-DD'), ${stamp}, 'Scheduled','Scheduled','N/A', '', '', 'd_good', null);
         insert into calendar_post_events(client, post_id, ts, source, action, actor)
           select 'test-client-b', id, now() - interval '3 days', 'auto-posted', 'status_change', 'SyncView auto-post'
             from calendar_posts where client = 'test-client-b' and id in ('stuck_04','stuck_09','stuck_14','stuck_19','stuck_24');`);
      const page20 = q(`set role service_role; select string_agg(id, ',' order by id) from public.calendar_auto_posted_due(20) where client = 'test-client-b';`).split('\n').pop();
      ok('25 never-flippable old cards do not starve a newer good one (page of 20 returns it)', page20 === 'newer_good');
      ok('item rule: a Posted part ignores its work item; a Scheduled one needs it scheduled',
        q(`select public.calendar_auto_posted_item_ok('Posted', 'd_x', '', false, null)::text || public.calendar_auto_posted_item_ok('Scheduled', '', '', false, null)::text
             || public.calendar_auto_posted_item_ok('Scheduled', '', 'https://x', false, null)::text || public.calendar_auto_posted_item_ok('scheduled', 'd', '', true, 'Scheduled')::text`) === 'truetruefalsetrue');

      // Fail closed. (a) A halt empties the list and keeps the old one; nothing is due afterwards.
      q(`set role service_role; select public.calendar_auto_posted_halt('calendar_history_unconfirmed');`);
      const halted = JSON.parse(q(`select value::text from syncview_runtime_flags where key = 'calendar_auto_posted'`));
      ok('halt: client list emptied, reason and previous list kept', JSON.stringify(halted.clients) === '[]'
        && halted.halted.reason === 'calendar_history_unconfirmed' && JSON.stringify(halted.halted.previous_clients) === '["*"]');
      q(`update syncview_runtime_flags set value = '{"clients": ["*"], "halted": {"reason": "x"}}' where key = 'calendar_auto_posted'`);
      ok('halt: even with clients listed, a halted switch returns nothing and the timer stays quiet', due() === '' && q(`select public.calendar_auto_posted_tick_needed()`) === 'f');
      // (b) No write at all: a mislabelled row by the job's actor after the switch last changed stops it.
      q(`update syncview_runtime_flags set value = '{"clients": ["*"]}', updated_at = now() - interval '1 minute' where key = 'calendar_auto_posted'`);
      ok('turned on again: due again', due() === 'due,elsewhere,newer_good');
      q(`insert into calendar_post_events(client, post_id, ts, source, action, actor) values ('other-client', 'x', now(), 'ui', 'status_change', 'SyncView auto-post');`);
      ok('a "ui" row by the job stops it with no write (due list empty, timer quiet)', due() === '' && q(`select public.calendar_auto_posted_tick_needed()`) === 'f');
      q(`update syncview_runtime_flags set value = '{"clients": ["*"]}', updated_at = now() + interval '1 second' where key = 'calendar_auto_posted'`);
      ok('a deliberate new switch write retires the old marker', due() === 'due,elsewhere,newer_good');
      const anon = run('t', `set role anon; select * from public.calendar_auto_posted_due(5);`, true);
      const auth = run('t', `set role authenticated; select public.calendar_auto_posted_key_ok(repeat('k', 64));`, true);
      ok('browser roles cannot call it', anon.status !== 0 && /permission denied/.test(anon.stderr) && auth.status !== 0);
      const svcTick = run('t', `set role service_role; select public.calendar_auto_posted_tick_needed();`, true);
      ok('tick_needed is owner only', svcTick.status !== 0);
      ok('key check: right key yes, wrong or short key no',
        q(`set role service_role; select public.calendar_auto_posted_key_ok(repeat('k', 64))::text || public.calendar_auto_posted_key_ok(repeat('j', 64))::text || public.calendar_auto_posted_key_ok('k');`).split('\n').pop() === 'truefalsefalse');
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
})().catch(e => { console.error(e); process.exit(1); });

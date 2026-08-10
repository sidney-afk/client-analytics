'use strict';
/*
 * F50 part 2: the status reconcilers must PULL-ONLY a SyncView-authoritative
 * team — and must actually EXECUTE in that world.
 *
 * WHAT THIS PROVES. The 15-minute reconcilers are the flip's status
 * projection: post-F1 a designer's change lands in `deliverables`, the
 * outbound mirror carries it to Linear (F2 stays "live"), and the reconciler
 * pulls Linear→card exactly as it always has. Before this change both
 * reconcilers froze the whole team the moment authority read `syncview` —
 * the F50 hole. After it, per component:
 *
 *   linear                        -> bidirectional, byte-identical behaviour
 *   syncview + outbound "live"    -> Linear→card pulls run; card→Linear
 *      pushes are SUPPRESSED (mirror-owned) — the outbound mirror owns that
 *      direction, and pushing through the legacy set-status webhook would
 *      make the reconciler a second, unaudited Linear writer racing the outbox
 *   syncview + outbound off/shadow-> detect-only (emergency-stop state: Linear
 *      may be stale, and pulling stale Linear onto a card reverts
 *      authoritative work)
 *
 * WHY EXECUTION, NOT SOURCE-GREP. This session shipped a change whose
 * companion suite asserted, by regex over source text, that a function "merges
 * BEFORE building write candidates" — while the function threw a
 * ReferenceError on its first statement and a fully green 214-suite run said
 * nothing. These worlds run the REAL scripts as child processes with the
 * network stubbed, so a crash, a wrong classification, or a forbidden write
 * fails here instead of in the 15-minute production lane.
 *
 * THE LINE THAT MUST NOT MOVE: in a syncview world the legacy
 * linear-set-status webhook is never called. Not once, for any reason.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f50-recon-'));

/* The stub replaces global.fetch inside the child before the script runs.
 * Routing is by URL substring; every write is recorded to CALLS_PATH so the
 * parent can assert what was (and was not) called. Unknown URLs throw. */
const stubPath = path.join(tmp, 'stub-fetch.js');
fs.writeFileSync(stubPath, `
const fs = require('fs');
const fixture = JSON.parse(fs.readFileSync(process.env.FIXTURE_PATH, 'utf8'));
const callsPath = process.env.CALLS_PATH;
const record = (kind, body) => fs.appendFileSync(callsPath, JSON.stringify({ kind, body }) + '\\n');
const respond = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
global.fetch = async (url, options) => {
  const href = String(url);
  const payload = options && options.body ? JSON.parse(options.body) : null;
  if (href.includes('key=eq.prod_authority')) return respond([{ value: fixture.authority }]);
  if (href.includes('key=eq.linear_outbound_enabled')) return respond([{ value: { mode: fixture.outbound } }]);
  if (href.includes('syncview_runtime_flags')) return respond([]);
  if (href.includes('/rest/v1/calendar_posts')) return respond(fixture.cards || []);
  if (href.includes('/rest/v1/sample_reviews')) return respond(fixture.cards || []);
  if (href.includes('webhook/linear-issue-statuses')) return respond({ ok: true, statuses: fixture.statuses || {} });
  if (href.includes('calendar-upsert')) { record('upsert', payload); return respond({ ok: true }); }
  if (href.includes('sample-review-upsert')) { record('upsert', payload); return respond({ ok: true }); }
  if (href.includes('webhook/linear-set-status')) { record('set-status', payload); return respond({ ok: true }); }
  throw new Error('f50 stub: unrouted URL ' + href);
};
`);

const OLD = '2026-01-01T00:00:00.000Z'; // far beyond the 120s tie window -> Linear side wins
function runWorld(name, script, fixture, apply) {
  const dir = fs.mkdtempSync(path.join(tmp, name + '-'));
  const fixturePath = path.join(dir, 'fixture.json');
  const callsPath = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  fs.writeFileSync(callsPath, '');
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script)].concat(apply ? ['--apply'] : []), {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      NODE_OPTIONS: `--require ${stubPath}`,
      FIXTURE_PATH: fixturePath,
      CALLS_PATH: callsPath,
      LEDGER_PATH: path.join(dir, 'ledger.json'),
      PROD_AUTHORITY_CACHE_PATH: path.join(dir, 'authority.json'),
      APPLY: '',
      GITHUB_STEP_SUMMARY: '',
    },
  });
  const calls = fs.readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  return { out: `${run.stdout}\n${run.stderr}`, status: run.status, calls };
}

const gPull = {
  id: 'c1', client: 'clienta', status: 'In Progress',
  graphic_status: 'For SMM Approval', graphic_status_at: OLD,
  graphic_linear_issue_id: 'https://linear.app/x/issue/GRA-11/a', updated_at: OLD,
};
const gMirror = {
  id: 'c2', client: 'clienta', status: 'In Progress',
  graphic_status: 'Tweaks Needed', graphic_status_at: new Date().toISOString(), // in the tie window; tweak never loses -> card wins
  graphic_linear_issue_id: 'https://linear.app/x/issue/GRA-12/b', updated_at: OLD,
};
const vPull = {
  id: 'c3', client: 'clienta', status: 'In Progress',
  video_status: 'In Progress', video_status_at: OLD,
  linear_issue_id: 'https://linear.app/x/issue/VID-21/c', updated_at: OLD,
};
const STATUSES = { 'GRA-11': 'For Kasper approval', 'GRA-12': 'Approved', 'VID-21': 'For Kasper approval' };

// --- World A: pre-flip (linear/linear) — behaviour unchanged ---------------
{
  const w = runWorld('a', 'linear-sync-reconcile.js',
    { authority: { video: 'linear', graphics: 'linear' }, outbound: 'off', cards: [gPull], statuses: STATUSES }, false);
  ok(w.status === 0, 'A: pre-flip dry-run exits 0 (the script executes end to end)');
  ok(/corrections 1 · authority-gated 0 · mirror-owned 0/.test(w.out),
    'A: a linear-team difference is a plain bidirectional correction, exactly as before');
  ok(/← card c1/.test(w.out), 'A: the pull is planned toward the card');
  ok(w.calls.length === 0, 'A: dry-run performs zero writes');
}

// --- World B: post-flip (graphics=syncview, outbound live), APPLY ----------
{
  const w = runWorld('b', 'linear-sync-reconcile.js',
    { authority: { video: 'linear', graphics: 'syncview' }, outbound: 'live', cards: [gPull, gMirror, vPull], statuses: STATUSES }, true);
  ok(w.status === 0, 'B: post-flip APPLY exits 0 — the run does NOT freeze on a syncview component');
  ok(/authority-gated 0 · mirror-owned 1/.test(w.out),
    'B: the card-side win is mirror-owned, not gated and not actionable');
  ok(/⏭ mirror-owned GRA-12 graphic/.test(w.out),
    'B: the suppression is logged visibly, so a stalled mirror keeps reappearing instead of vanishing');
  ok(/applied ok=2 fail=0/.test(w.out),
    'B: the graphics pull AND the video correction both apply — mixed authority does not freeze the loop');
  const upserts = w.calls.filter(c => c.kind === 'upsert');
  ok(upserts.some(c => c.body && c.body.post && c.body.post.graphic_status === 'Kasper Approval' && c.body.post.id === 'c1'),
    'B: the graphics card was repaired to the Linear (mirror-carried) status — F50, working');
  ok(upserts.some(c => c.body && c.body.post && c.body.post.video_status === 'Kasper Approval' && c.body.post.id === 'c3'),
    'B: the linear-authoritative video component still repairs as before');
  ok(w.calls.filter(c => c.kind === 'set-status').length === 0,
    'B: the legacy linear-set-status webhook was NEVER called — the outbound mirror owns card→Linear');
}

// --- World C: syncview but outbound NOT live — emergency-stop state --------
{
  const w = runWorld('c', 'linear-sync-reconcile.js',
    { authority: { video: 'linear', graphics: 'syncview' }, outbound: 'off', cards: [gPull], statuses: STATUSES }, false);
  ok(w.status === 0, 'C: exits 0');
  ok(/⛔ detect-only GRA-11 graphic/.test(w.out),
    'C: with the mirror stopped, a syncview team goes back to detect-only — stale Linear is never pulled onto a card');
  ok(/corrections 1 · authority-gated 1 · mirror-owned 0/.test(w.out),
    'C: the difference is gated, not actionable');
}

// --- World D: the samples twin, post-flip APPLY ----------------------------
{
  const sPull = {
    id: 's1', client: 'clienta', status: 'In Progress',
    graphic_status: 'For SMM Approval', graphic_status_at: OLD,
    graphic_linear_issue_id: 'https://linear.app/x/issue/GRA-31/x', updated_at: OLD,
  };
  const w = runWorld('d', 'sample-linear-reconcile.js',
    { authority: { video: 'linear', graphics: 'syncview' }, outbound: 'live', cards: [sPull], statuses: { 'GRA-31': 'For Kasper approval' } }, true);
  ok(w.status === 0, 'D: the samples reconciler executes and exits 0 post-flip');
  ok(/applied ok=1 fail=0/.test(w.out), 'D: the samples graphics pull applies');
  ok(w.calls.some(c => c.kind === 'upsert' && c.body && (c.body.sample || c.body.post || {}).graphic_status === 'Kasper Approval'),
    'D: the sample row was repaired to the mirror-carried status');
  ok(w.calls.filter(c => c.kind === 'set-status').length === 0,
    'D: samples never calls the legacy set-status webhook in a syncview world either');
}

fs.rmSync(tmp, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} F50 reconcile pull-only check(s) failed`);
  process.exit(1);
}
console.log('\nF50 reconcile pull-only checks passed');

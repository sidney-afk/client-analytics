'use strict';
/*
 * N/A PARKS the pair — both status reconcilers, executed for real.
 *
 * WHAT HAPPENED. N/A shipped 2026-08-19 as a manual, SyncView-only SMM status
 * (owner ruling: default stays In Progress; N/A is a deliberate choice). The
 * browser's legacy push guard refuses to send it to Linear — but the
 * reconcilers were never taught. The same afternoon, 21 freshly parked
 * components generated 13 push-"N/A"-to-Linear corrections (a state Linear
 * does not have) plus 9 pull-backs that would have reverted the SMM's parking
 * minutes after they chose it. Together they blew the 15-correction safety
 * cap, and the 15-minute lane ABORTED EVERY RUN for over an hour — during
 * which nothing reconciled, including legitimate corrections queued behind
 * the cap.
 *
 * THE RULE. While a card component reads N/A, the reconciler neither pushes
 * nor pulls that pair. It logs a visible ⏸ line every run and resumes normal
 * reconciliation the moment the card leaves N/A in SyncView. Everything else
 * — most-recent-wins, the tweak tie-break, authority gating, the
 * mirror-owned latch — is untouched for non-N/A statuses.
 *
 * These worlds run the REAL scripts as child processes with fetch stubbed,
 * exactly like the F50 suite: a crash, a forbidden webhook call, or a parked
 * pair leaking into the correction count fails here, not in production.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'na-park-'));

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
  throw new Error('na-park stub: unrouted URL ' + href);
};
`);

const OLD = '2026-01-01T00:00:00.000Z';
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

const AUTH = { video: 'linear', graphics: 'syncview' };

// A video card freshly parked N/A (card stamp newer than Linear — the push
// direction that tried to write "N/A" into Linear).
const parkedFresh = {
  id: 'p1', client: 'clienta', status: 'In Progress',
  video_status: 'N/A', video_status_at: new Date().toISOString(),
  linear_issue_id: 'https://linear.app/x/issue/VID-91/a', updated_at: OLD,
};
// A video card parked long ago (Linear side "newer" — the pull direction that
// reverted the SMM's parking).
const parkedStale = {
  id: 'p2', client: 'clienta', status: 'In Progress',
  video_status: 'N/A', video_status_at: OLD,
  linear_issue_id: 'https://linear.app/x/issue/VID-92/b', updated_at: OLD,
};
// Control: an ordinary divergence that must still reconcile normally.
const normal = {
  id: 'p3', client: 'clienta', status: 'In Progress',
  video_status: 'In Progress', video_status_at: OLD,
  linear_issue_id: 'https://linear.app/x/issue/VID-93/c', updated_at: OLD,
};
const STATUSES = { 'VID-91': 'In Progress', 'VID-92': 'In Progress', 'VID-93': 'For Kasper approval' };

// --- World A: APPLY — parked pairs move nothing, the control still repairs --
{
  const w = runWorld('a', 'linear-sync-reconcile.js',
    { authority: AUTH, outbound: 'live', cards: [parkedFresh, parkedStale, normal], statuses: STATUSES }, true);
  ok(w.status === 0, 'A: reconciler executes end to end and exits 0');
  ok(/n\/a-parked 2/.test(w.out), 'A: both N/A pairs are counted as parked, visibly');
  ok(/⏸ n\/a-parked VID-91 video/.test(w.out) && /⏸ n\/a-parked VID-92 video/.test(w.out),
    'A: each parked pair logs its own ⏸ line every run');
  ok(w.calls.filter(c => c.kind === 'set-status').length === 0,
    'A: "N/A" is NEVER pushed through the legacy set-status webhook — Linear has no such state');
  const upserts = w.calls.filter(c => c.kind === 'upsert');
  ok(!upserts.some(c => c.body && c.body.post && (c.body.post.id === 'p1' || c.body.post.id === 'p2')),
    "A: neither parked card is pulled back to Linear's status — the SMM's parking sticks");
  ok(upserts.some(c => c.body && c.body.post && c.body.post.id === 'p3' && c.body.post.video_status === 'Kasper Approval'),
    'A: the ordinary divergence beside them still repairs — parking is exactly N/A-wide');
  ok(/corrections 1 /.test(w.out),
    'A: parked pairs never enter the correction count, so they cannot blow the safety cap');
}

// --- World B: the 2026-08-19 shape — a parked fleet stays under the cap ----
{
  const cards = []; const statuses = {};
  for (let i = 0; i < 21; i++) {
    cards.push({
      id: 'w' + i, client: 'clienta', status: 'In Progress',
      video_status: 'N/A', video_status_at: new Date().toISOString(),
      linear_issue_id: `https://linear.app/x/issue/VID-6${String(i).padStart(2, '0')}/x`, updated_at: OLD,
    });
    statuses['VID-6' + String(i).padStart(2, '0')] = 'In Progress';
  }
  cards.push(normal); statuses['VID-93'] = 'For Kasper approval';
  const w = runWorld('b', 'linear-sync-reconcile.js',
    { authority: AUTH, outbound: 'live', cards, statuses }, true);
  ok(w.status === 0 && !/⛔ ABORT/.test(w.out),
    'B: 21 parked components no longer trip the safety cap — the lane runs instead of aborting');
  ok(/n\/a-parked 21/.test(w.out), 'B: all 21 are parked and reported');
  ok(w.calls.some(c => c.kind === 'upsert' && c.body && c.body.post && c.body.post.id === 'p3'),
    'B: the legitimate correction queued behind the cap now applies');
}

// --- World C: leaving N/A resumes normal reconciliation --------------------
{
  // Tweaks Needed wins the fresh-ledger tie-break (never silently drop a
  // tweak request), so leaving N/A for it must push — the card-win direction.
  const unparked = { ...parkedFresh, video_status: 'Tweaks Needed', video_status_at: new Date().toISOString() };
  const w = runWorld('c', 'linear-sync-reconcile.js',
    { authority: AUTH, outbound: 'live', cards: [unparked], statuses: { 'VID-91': 'For Kasper approval' } }, true);
  ok(w.status === 0 && /n\/a-parked 0/.test(w.out),
    'C: a card that left N/A is no longer parked');
  ok(w.calls.filter(c => c.kind === 'set-status').length === 1,
    'C: its fresh non-N/A card status pushes to Linear exactly as before the parking rule');
}

// --- World D: the samples twin parks identically ---------------------------
{
  const sParked = {
    id: 's1', client: 'clienta', status: 'In Progress',
    video_status: 'N/A', video_status_at: new Date().toISOString(),
    linear_issue_id: 'https://linear.app/x/issue/VID-95/y', updated_at: OLD,
  };
  const w = runWorld('d', 'sample-linear-reconcile.js',
    { authority: AUTH, outbound: 'live', cards: [sParked], statuses: { 'VID-95': 'In Progress' } }, true);
  ok(w.status === 0 && /n\/a-parked 1/.test(w.out) && /⏸ n\/a-parked VID-95/.test(w.out),
    'D: the samples reconciler parks N/A pairs identically');
  ok(w.calls.length === 0, 'D: the parked samples pair performs zero writes in either direction');
}

if (failures) {
  console.error(`\n${failures} N/A parking check(s) failed.`);
  process.exit(1);
}
console.log('\nN/A parking checks passed.');

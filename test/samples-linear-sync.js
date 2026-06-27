'use strict';
/*
 * Samples (Review) — LINEAR STALE-REGRESS / RECONCILE (M4) unit suite.
 *
 * Run:  node test/samples-linear-sync.js   (exit 0 = all good)
 *
 * Brace-extracts the REAL shipping M4 stale-regress functions from
 * ../index.html (by NAME — robust to line shifts) and exercises the guard that
 * stops a STALE Linear status-sync round-trip from clobbering a fresh approval
 * on a samples card, while still adopting a genuine cross-actor change:
 *   _sxrIsStaleLinearRegress, _sxrReconcileHasGenuineTweak, _sxrRecentSaveReconcile.
 * These mirror the calendar's _calIsStaleLinearRegress/_calRecentSaveReconcile
 * 1:1 over EXACTLY video+graphic, with the samples ABOVE set { Client Approval,
 * Approved } (no Scheduled/Posted). A regression here = a production data-loss
 * bug (the "video reverts after the client approves it" class), so this asserts
 * the ACTUAL code, not a paraphrase.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
function grabConst(name) {
  const re = new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm');
  const m = INDEX.match(re);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

const REAL = [
  grabConst('CAL_STATUSES'), grabConst('CAL_PRIORITY'),
  grabConst('SXR_COMPONENTS'),
  grabFunc('_calNormStatus'),
  grabFunc('computeSampleOverallStatus'),
  grabFunc('_sxrParseComments'),
  grabFunc('_sxrCommentsFor'),
  grabFunc('_sxrMsgIsTweak'),
  grabFunc('_sxrReconcileHasGenuineTweak'),
  grabFunc('_sxrIsStaleLinearRegress'),
  grabFunc('_sxrRecentSaveReconcile'),
].join('\n\n');

// _sxrV2Log is a debug sink in the shipped code — a no-op here.
const STUBS = `function _sxrV2Log(){}`;

const mod = new Function(STUBS + '\n' + REAL + `
;return { SXR_COMPONENTS, _calNormStatus, computeSampleOverallStatus,
  _sxrReconcileHasGenuineTweak, _sxrIsStaleLinearRegress, _sxrRecentSaveReconcile };`)();

const {
  SXR_COMPONENTS, _sxrIsStaleLinearRegress, _sxrReconcileHasGenuineTweak, _sxrRecentSaveReconcile,
} = mod;

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('✓  ' + msg); }
  else { fail++; console.log('✗  ' + msg + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

// ---- fixtures --------------------------------------------------------------
const ISO = (s) => new Date(s).toISOString();
function tweakComment(id, opts) {
  opts = opts || {};
  return {
    id, parent_id: null, role: opts.role || 'client', is_tweak: opts.is_tweak !== false,
    audience: opts.role === 'client' ? 'client' : 'internal',
    body: opts.body || 'please fix', created_at: ISO('2026-06-01T00:00:00Z'), updated_at: ISO('2026-06-01T00:00:00Z'),
    done: !!opts.done, deleted: !!opts.deleted,
  };
}
// A row with video_tweaks = the JSON of `comments`.
function row(id, fields, comments) {
  const r = Object.assign({ id, video_status: 'In Progress', graphic_status: 'In Progress' }, fields || {});
  if (comments) r.video_tweaks = JSON.stringify(comments);
  return r;
}

// frozen 2-component set
ok(Array.isArray(SXR_COMPONENTS) && SXR_COMPONENTS.length === 2 && SXR_COMPONENTS[0] === 'video' && SXR_COMPONENTS[1] === 'graphic',
  'SXR_COMPONENTS is exactly [video, graphic]', SXR_COMPONENTS);

// ---- _sxrIsStaleLinearRegress ----------------------------------------------
console.log('\n[_sxrIsStaleLinearRegress]');
{
  const rsf = { wrote: { video_status: 'Client Approval' }, base: { video_status: 'Kasper Approval' } };
  const lp = row('a', { video_status: 'Client Approval' });
  const fp = row('a', { video_status: 'In Progress', updated_at: ISO('2026-06-02') });
  ok(_sxrIsStaleLinearRegress(lp, fp, 'video', rsf) === true,
    'wrote Client Approval, server regressed to In Progress, no new tweak → STALE (keep local)');
}
{
  const rsf = { wrote: { video_status: 'Approved' }, base: { video_status: 'Client Approval' } };
  ok(_sxrIsStaleLinearRegress(row('a', { video_status: 'Approved' }), row('a', { video_status: 'Kasper Approval' }), 'video', rsf) === true,
    'wrote Approved, server regressed to Kasper Approval → STALE');
}
{
  // wrote was below Client Approval — NOT a fresh-approval regress.
  const rsf = { wrote: { video_status: 'Kasper Approval' }, base: { video_status: 'For SMM Approval' } };
  ok(_sxrIsStaleLinearRegress(row('a', { video_status: 'Kasper Approval' }), row('a', { video_status: 'In Progress' }), 'video', rsf) === false,
    'wrote only Kasper Approval (below Client) → NOT stale (adoptable)');
}
{
  // server moved FORWARD (above) — never stale.
  const rsf = { wrote: { video_status: 'Client Approval' }, base: { video_status: 'Kasper Approval' } };
  ok(_sxrIsStaleLinearRegress(row('a', { video_status: 'Client Approval' }), row('a', { video_status: 'Approved' }), 'video', rsf) === false,
    'server moved to Approved (forward) → NOT stale');
}
{
  // server == what we wrote → our own echo, not stale.
  const rsf = { wrote: { video_status: 'Client Approval' }, base: { video_status: 'Kasper Approval' } };
  ok(_sxrIsStaleLinearRegress(row('a', { video_status: 'Client Approval' }), row('a', { video_status: 'Client Approval' }), 'video', rsf) === false,
    'server == wrote (echo) → NOT stale');
}
{
  // a GENUINE new tweak comment justifies the regress → not stale.
  const rsf = { wrote: { video_status: 'Client Approval' }, base: { video_status: 'Kasper Approval' } };
  const lp = row('a', { video_status: 'Client Approval' }, []);
  const fp = row('a', { video_status: 'Tweaks Needed', updated_at: ISO('2026-06-02') }, [tweakComment('t1', { role: 'kasper' })]);
  ok(_sxrIsStaleLinearRegress(lp, fp, 'video', rsf) === false,
    'server regress carries a NEW open tweak comment → GENUINE (adoptable)');
}

// ---- _sxrReconcileHasGenuineTweak ------------------------------------------
console.log('\n[_sxrReconcileHasGenuineTweak]');
{
  const lp = row('a', {}, []);
  const fp = row('a', {}, [tweakComment('t1')]);
  ok(_sxrReconcileHasGenuineTweak(fp, lp, 'video') === true, 'new open is_tweak not in local → genuine');
}
{
  const lp = row('a', {}, [tweakComment('t1')]);
  const fp = row('a', {}, [tweakComment('t1')]);
  ok(_sxrReconcileHasGenuineTweak(fp, lp, 'video') === false, 'tweak already present locally (same id) → not new');
}
{
  const fp = row('a', {}, [tweakComment('t1', { done: true })]);
  ok(_sxrReconcileHasGenuineTweak(fp, row('a', {}, []), 'video') === false, 'a DONE tweak → not a live request');
}
{
  const fp = row('a', {}, [tweakComment('t1', { deleted: true })]);
  ok(_sxrReconcileHasGenuineTweak(fp, row('a', {}, []), 'video') === false, 'a DELETED tweak → ignored');
}
{
  const fp = row('a', {}, [tweakComment('t1', { is_tweak: false })]);
  ok(_sxrReconcileHasGenuineTweak(fp, row('a', {}, []), 'video') === false, 'a plain (non-tweak) comment → not a request');
}

// ---- _sxrRecentSaveReconcile -----------------------------------------------
console.log('\n[_sxrRecentSaveReconcile]');
{
  // Genuine cross-actor adopt: we routed video to Kasper (wrote Kasper Approval),
  // Kasper approved → server Client Approval, server strictly newer.
  const rsf = { wrote: { video_status: 'Kasper Approval', graphic_status: 'In Progress' }, base: { video_status: 'For SMM Approval', graphic_status: 'In Progress' } };
  const lp = row('a', { video_status: 'Kasper Approval', graphic_status: 'In Progress', updated_at: ISO('2026-06-01T00:00:00Z') });
  const fp = row('a', { video_status: 'Client Approval', graphic_status: 'In Progress', updated_at: ISO('2026-06-01T00:01:00Z') });
  const merged = _sxrRecentSaveReconcile(lp, fp, rsf);
  ok(merged && merged.video_status === 'Client Approval', 'adopts a genuine forward move (Kasper approved) when server is newer', merged && merged.video_status);
}
{
  // Stale Linear regress: wrote Client Approval, server reverts to In Progress
  // (newer ts, no tweak) → KEEP local (merged null).
  const rsf = { wrote: { video_status: 'Client Approval', graphic_status: 'Kasper Approval' }, base: { video_status: 'Kasper Approval', graphic_status: 'Kasper Approval' } };
  const lp = row('a', { video_status: 'Client Approval', graphic_status: 'Kasper Approval', updated_at: ISO('2026-06-01T00:00:00Z') });
  const fp = row('a', { video_status: 'In Progress', graphic_status: 'Kasper Approval', updated_at: ISO('2026-06-01T00:01:00Z') });
  const merged = _sxrRecentSaveReconcile(lp, fp, rsf);
  ok(merged === null, 'a stale Linear regress is NOT adopted (returns null → keep local)', merged);
}
{
  // Server NOT newer → never adopt.
  const rsf = { wrote: { video_status: 'Kasper Approval' }, base: { video_status: 'For SMM Approval' } };
  const lp = row('a', { video_status: 'Kasper Approval', updated_at: ISO('2026-06-01T00:02:00Z') });
  const fp = row('a', { video_status: 'Client Approval', updated_at: ISO('2026-06-01T00:01:00Z') });
  ok(_sxrRecentSaveReconcile(lp, fp, rsf) === null, 'server older-or-equal → null (no adopt)');
}
{
  // Mixed: video stale-regress kept, graphic genuine adopt — merged carries
  // graphic only; video stays local.
  const rsf = { wrote: { video_status: 'Client Approval', graphic_status: 'Kasper Approval' }, base: { video_status: 'Kasper Approval', graphic_status: 'For SMM Approval' } };
  const lp = row('a', { video_status: 'Client Approval', graphic_status: 'Kasper Approval', updated_at: ISO('2026-06-01T00:00:00Z') });
  const fp = row('a', { video_status: 'In Progress', graphic_status: 'Client Approval', updated_at: ISO('2026-06-01T00:01:00Z') });
  const merged = _sxrRecentSaveReconcile(lp, fp, rsf);
  ok(merged && merged.video_status === 'Client Approval' && merged.graphic_status === 'Client Approval',
    'mixed: keep stale video, adopt genuine graphic', merged && { v: merged.video_status, g: merged.graphic_status });
}

console.log(`\n============================================================`);
console.log(`SUMMARY: ${pass} passed, ${fail} failed`);
console.log('OVERALL: ' + (fail ? 'FAIL ❌' : 'PASS ✅'));
process.exit(fail ? 1 : 0);

'use strict';
/*
 * Regression guard for scripts/sample-linear-reconcile.js.
 *
 * The reconciler extracts a FIXED list of consts/functions out of index.html
 * (grabConst/grabFunc) and evals them in one sandbox. If any extracted function
 * calls a helper that is NOT in the grab list, it throws `X is not defined` at
 * RUNTIME — but only on the apply path when a real correction is present, so the
 * static source tests never see it. That exact gap took the samples reconciler
 * down in prod (`_sxrNormStatus is not defined`, plus a latent `SXR_PRIORITY`).
 *
 * This test rebuilds the sandbox from the script's OWN declared grab list and
 * exercises the apply-path functions, so drift between the list and the
 * functions' real dependencies fails here instead of in a scheduled run.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const RECON = fs.readFileSync(path.join(ROOT, 'scripts', 'sample-linear-reconcile.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('OK  ' + msg); } else { fail++; console.log('FAIL ' + msg); } };

// Same grab helpers the reconciler uses.
const grabFunc = (name) => {
  const at = SRC.indexOf('function ' + name + '('); if (at < 0) throw new Error('fn ' + name);
  let depth = 0; for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++; else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, j + 1);
  } throw new Error('braces ' + name);
};
const grabConst = (name) => SRC.match(new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm'))[0];

// Pull the reconciler's ACTUAL grab list so this test tracks the real script,
// not a hand-copied duplicate that could drift.
const names = { const: [], func: [] };
for (const m of RECON.matchAll(/grabConst\('([^']+)'\)/g)) names.const.push(m[1]);
for (const m of RECON.matchAll(/grabFunc\('([^']+)'\)/g)) names.func.push(m[1]);
ok(names.func.includes('computeSampleOverallStatus') && names.func.includes('_sxrClearStaleApprovals'),
  'reconciler grab list includes the apply-path functions');

// Build the sandbox exactly as the reconciler does, from its own list.
let mod;
try {
  const body = [...names.const.map(grabConst), ...names.func.map(grabFunc)].join('\n')
    + ';return { computeSampleOverallStatus, _sxrClearStaleApprovals };';
  mod = new Function(body)();
  ok(true, 'sandbox builds from the reconciler grab list without a missing symbol');
} catch (e) {
  ok(false, 'sandbox build threw: ' + e.message);
}

if (mod) {
  const cases = [
    // The exact prod crash case: a graphic flips Tweaks Needed -> Kasper Approval.
    [{ video_status: 'Approved', graphic_status: 'Kasper Approval' }, 'Kasper Approval'],
    [{ video_status: 'Approved', graphic_status: 'Tweaks Needed' }, 'Tweaks Needed'],
    [{ video_status: 'Approved', graphic_status: 'Approved' }, 'Approved'],
    [{}, 'In Progress'],
  ];
  for (const [post, expected] of cases) {
    let got, threw = null;
    try { got = mod.computeSampleOverallStatus(post); } catch (e) { threw = e.message; }
    ok(!threw && got === expected,
      `computeSampleOverallStatus(${JSON.stringify(post)}) = ${expected}` + (threw ? ` (threw: ${threw})` : ` (got ${got})`));
  }
  // Apply path also runs _sxrClearStaleApprovals; prove it does not throw.
  let clearThrew = null;
  try {
    const p = { video_status: 'In Progress', graphic_status: 'Tweaks Needed', kasper_approved_at: '2026-07-15T00:00:00Z', client_graphic_approved_at: '2026-07-15T00:00:00Z' };
    mod._sxrClearStaleApprovals(p, {});
  } catch (e) { clearThrew = e.message; }
  ok(!clearThrew, '_sxrClearStaleApprovals runs without a missing symbol' + (clearThrew ? ` (threw: ${clearThrew})` : ''));
}

console.log(fail ? `\nsample-reconcile-extraction: ${fail} failed ❌` : `\nsample-reconcile-extraction: ${pass} passed ✅`);
process.exit(fail ? 1 : 0);

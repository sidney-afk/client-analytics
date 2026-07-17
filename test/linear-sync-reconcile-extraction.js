'use strict';
/*
 * Regression guard for scripts/linear-sync-reconcile.js.
 *
 * The calendar reconciler extracts a FIXED list of consts/functions out of
 * index.html (grabConst/grabFunc) and evals them in one sandbox — the same
 * technique as scripts/sample-linear-reconcile.js. If an extracted function
 * gains a call to a helper that is NOT in the grab list, it throws
 * `X is not defined` at RUNTIME, on the apply path only, so static source
 * tests never see it. That exact gap took the samples reconciler down in
 * prod (`_sxrNormStatus is not defined`); the samples twin got
 * test/sample-reconcile-extraction.js, but this reconciler had no guard.
 *
 * This test rebuilds the sandbox from the script's OWN declared grab list and
 * exercises the apply-path functions, so drift between the list and the
 * functions' real dependencies fails here instead of in a scheduled run.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const RECON = fs.readFileSync(path.join(ROOT, 'scripts', 'linear-sync-reconcile.js'), 'utf8');

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
ok(names.func.includes('computeOverallStatus') && names.func.includes('_calClearStaleApprovals')
  && names.func.includes('_calMapLinearStatusStrict') && names.func.includes('_calIdentFromUrl'),
  'reconciler grab list includes the apply-path functions');

// Build the sandbox exactly as the reconciler does, from its own list.
let mod;
try {
  const body = [...names.const.map(grabConst), ...names.func.map(grabFunc)].join('\n')
    + ';return { ' + names.func.join(', ') + ' };';
  mod = new Function(body)();
  ok(true, 'sandbox builds from the reconciler grab list without a missing symbol');
} catch (e) {
  ok(false, 'sandbox build threw: ' + e.message);
}

if (mod) {
  // Exercise every apply-path function with representative rows so a helper
  // referenced only inside a branch still resolves.
  const rows = [
    { video_status: 'Approved', graphic_status: 'Kasper Approval', caption_status: 'Approved' },
    { video_status: 'Tweaks Needed', graphic_status: 'Approved' },
    { video_status: 'Client Approval', graphic_status: 'In Progress', caption_status: 'Tweaks Needed' },
    {},
  ];
  try {
    for (const row of rows) {
      const overall = mod.computeOverallStatus(row);
      ok(typeof overall === 'string' && overall.length > 0,
        'computeOverallStatus runs (' + (row.video_status || 'empty') + ' -> ' + overall + ')');
      mod._calClearStaleApprovals(Object.assign({}, row), overall);
    }
    ok(true, '_calClearStaleApprovals runs on every representative row');
    const mapped = mod._calMapLinearStatusStrict('In Progress');
    ok(mapped === 'In Progress', '_calMapLinearStatusStrict maps a known Linear state');
    ok(mod._calMapLinearStatusStrict('Some Unknown State') === null,
      '_calMapLinearStatusStrict returns null for unknown states (strict)');
    ok(mod._calIdentFromUrl('https://linear.app/team/issue/GRA-123/slug') === 'GRA-123',
      '_calIdentFromUrl extracts the issue identifier');
  } catch (e) {
    ok(false, 'apply-path function threw: ' + e.message);
  }
}

console.log(fail === 0
  ? 'linear-sync-reconcile extraction checks passed (' + pass + ')'
  : 'linear-sync-reconcile extraction checks FAILED (' + fail + ')');
process.exit(fail === 0 ? 0 : 1);

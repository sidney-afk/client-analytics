'use strict';
/*
 * Collaborative-mode settings reconcile — regression test.
 *
 * Run:  node test/collab-settings-reconcile.js   (exit 0 = all good)
 *
 * Extracts the REAL _calReconcileSettings + its two consts from ../index.html
 * (by name, brace-balanced — robust to line shifts) so we test the ACTUAL
 * shipping rule, not a paraphrase.
 *
 * Behaviour under test: the backend sentinel row is the SHARED source of truth
 * for collab mode. A local (per-device) value may outrank it ONLY while it is
 * both newer than the backend AND still inside CAL_SETTINGS_LOCAL_TRUST_MS — an
 * optimistic toggle the user just made that hasn't propagated yet. Past that
 * window the backend always wins, so a local toggle whose best-effort backend
 * sync silently failed can no longer mask the shared state forever. (The bug:
 * one SMM's switch was stuck showing collab OFF while the client view — and
 * every other device — correctly had it ON.)
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

// Extract a top-level `function NAME(...) { ... }` by brace-balancing.
function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
// Extract a single-line `const NAME = ...;` declaration.
function grabConst(name) {
  const m = INDEX.match(new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm'));
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

const REAL = [
  grabConst('CAL_SETTINGS_DEFAULTS'),
  grabConst('CAL_SETTINGS_LOCAL_TRUST_MS'),
  grabFunc('_calReconcileSettings'),
].join('\n');

const { _calReconcileSettings, CAL_SETTINGS_LOCAL_TRUST_MS } = new Function(
  REAL + ';return { _calReconcileSettings, CAL_SETTINGS_LOCAL_TRUST_MS };')();

const NOW = 1781000000000;
const SEC = 1000;
const MIN = 60 * SEC;
const DAY = 24 * 60 * MIN;

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}

console.log('— The stuck-switch bug (the fix) —');
// A days-old local OFF must yield to the backend ON, even though the backend's
// _ts is OLDER. Before the fix the strict `_ts` compare kept local forever;
// now the stale local value is outside the trust window so the backend wins.
{
  const local   = { collab_mode: false, _ts: NOW - 7 * DAY };   // a week-old stuck OFF
  const backend = { collab_mode: true,  _ts: NOW - 12 * DAY };  // older, but it's the shared truth
  const d = _calReconcileSettings(local, backend, NOW);
  check('stale local OFF + backend ON → adopt backend', d.source, 'backend');
  check('  …adopted value is ON',                       d.settings.collab_mode, true);
}

console.log('\n— Optimism preserved for a just-made local toggle —');
// A toggle made seconds ago stays on screen even though the snapshot we just
// fetched predates it (the write is still propagating through n8n/Supabase).
{
  const local   = { collab_mode: true,  _ts: NOW - 3 * SEC };
  const backend = { collab_mode: false, _ts: NOW - 5 * MIN };
  const d = _calReconcileSettings(local, backend, NOW);
  check('fresh local ON + older backend → keep local', d.source, 'local');
  check('  …showing the just-made ON',                 d.settings.collab_mode, true);
}

console.log('\n— Backend always wins otherwise —');
// A teammate's newer toggle (backend _ts strictly newer) is adopted.
{
  const local   = { collab_mode: false, _ts: NOW - 10 * SEC };
  const backend = { collab_mode: true,  _ts: NOW - 1 * SEC };
  check('backend newer than local → adopt backend',
    _calReconcileSettings(local, backend, NOW).source, 'backend');
}
// No local record at all → adopt backend.
{
  const d = _calReconcileSettings(null, { collab_mode: true, _ts: NOW - MIN }, NOW);
  check('no local record → adopt backend', d.source, 'backend');
  check('  …value ON',                     d.settings.collab_mode, true);
}
// Just past the trust window: a local value that is newer than the backend but
// older than the window still loses — the exact guard that heals a stuck switch.
{
  const local   = { collab_mode: false, _ts: NOW - (CAL_SETTINGS_LOCAL_TRUST_MS + SEC) };
  const backend = { collab_mode: true,  _ts: NOW - (CAL_SETTINGS_LOCAL_TRUST_MS + 5 * SEC) };
  check('local newer-but-just-stale → adopt backend',
    _calReconcileSettings(local, backend, NOW).source, 'backend');
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll collab-settings-reconcile checks passed.');

// realtime_parity.js — STATIC realtime + action-immediacy parity guard. No browser.
//
// Asserts that every CALENDAR realtime / immediacy hook has a wired SAMPLES twin:
//   (1) the twin FUNCTION is DEFINED, and
//   (2) it's CALLED from the matching lifecycle site (mount / teardown / load),
//   (3) the Kasper-queue channel is CROSS-CLIENT (no client filter), like the cal.
//
// WHY this lane exists: the realtime WebSocket can't be tunneled headless — the
// egress proxy refuses WS upgrades (/root/.ccr/README.md "Not supported"). So no
// headless test can observe a real push. But "is the samples twin wired the same
// as the calendar?" is a PURE SOURCE invariant — cheap, deterministic, always-on.
// This is the guardrail that would have FAILED THE BUILD when the samples Kasper
// sub-tab shipped with no realtime subscription, or when loadSxrCards lacked the
// dataChanged repaint-suppression gate (the two divergences a user had to report
// by hand). The handler BEHAVIOUR given a push is covered by p88_realtime_handler.js.
//
// Run: node qa/probes/realtime_parity.js   (exit 0 = parity, 1 = a twin missing/unwired)
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const esc = (s) => s.replace(/[$]/g, '\\$');

function isDefined(name) {
  return new RegExp('(?:async\\s+)?function\\s+' + esc(name) + '\\s*\\(').test(SRC)
      || new RegExp('(?:const|let|var)\\s+' + esc(name) + '\\s*=').test(SRC);
}
// The text of a top-level function's body (header → the next 4-space-indented
// sibling declaration). Avoids brace-matching (the file is full of template
// literals); the file indents siblings at 4 spaces and bodies at 8+, so a
// 4-space `function/const/let` cleanly bounds the body.
function bodyWindow(name) {
  const m = SRC.match(new RegExp('(?:async\\s+)?function\\s+' + esc(name) + '\\s*\\('));
  if (!m) return null;
  const start = m.index;
  const rest = SRC.slice(start + m[0].length);
  const nm = rest.match(/\n {4}(?:async function|function|const|let|var)\s/);
  const end = nm ? start + m[0].length + nm.index : Math.min(SRC.length, start + 12000);
  return SRC.slice(start, end);
}
function calls(callerName, calleeName) {
  const body = bodyWindow(callerName);
  return !!body && body.includes(calleeName);
}

// ── the contract ──────────────────────────────────────────────────────────
// Each calendar realtime/immediacy hook → its required samples twin.
const TWINS = [
  ['_calV2EnsureSubscribed',     '_sxrV2EnsureSubscribed',        'SMM-sheet realtime subscription'],
  ['_calV2Teardown',             '_sxrV2Teardown',                'SMM-sheet realtime teardown'],
  ['_calV2OnRealtimeChange',     '_sxrV2OnRealtimeChange',        'SMM-sheet realtime → background reload'],
  ['_kasperV2EnsureSubscribed',  '_sxrKasperV2EnsureSubscribed',  'Kasper-queue realtime subscription'],
  ['_kasperV2Teardown',          '_sxrKasperV2Teardown',          'Kasper-queue realtime teardown'],
  ['_calPostsEqualForRender',    '_sxrPostsEqualForRender',       'dataChanged repaint-suppression gate'],
];
// Each samples twin must be CALLED from the matching lifecycle site.
const WIRING = [
  ['_sxrV2EnsureSubscribed',       'loadSxrCards',            'SMM-sheet subscription opened on load'],
  ['_sxrPostsEqualForRender',      'loadSxrCards',            'dataChanged gate applied in the background reload'],
  ['_sxrKasperV2EnsureSubscribed', '_kasperEnsureAutoRefresh','Kasper-queue subscription opened on Kasper-page mount'],
  ['_sxrKasperV2Teardown',         '_kasperTeardown',         'Kasper-queue subscription torn down on leave'],
];

const fails = [], passes = [];
const pass = (m) => passes.push(m);
const fail = (m) => fails.push(m);

// 1) twin functions defined (and the calendar source still defines the original)
for (const [cal, sxr, why] of TWINS) {
  if (!isDefined(cal)) { fail(`calendar hook ${cal} not found — contract drift (${why}); update this guard`); continue; }
  if (isDefined(sxr)) pass(`twin defined: ${cal} → ${sxr}  (${why})`);
  else fail(`MISSING samples twin for ${cal}: expected ${sxr}  (${why})`);
}

// 2) twins wired into the right lifecycle site
for (const [callee, caller, why] of WIRING) {
  if (!isDefined(callee)) { fail(`cannot check wiring — ${callee} is not defined`); continue; }
  if (calls(caller, callee)) pass(`wired: ${caller}() calls ${callee}()  (${why})`);
  else fail(`UNWIRED: ${callee} is defined but not called from ${caller}()  (${why})`);
}

// 3) the Kasper-queue channel must be CROSS-CLIENT (no client filter) — same as the
//    calendar's kasper-cal. A stray `filter:` would silently scope it to one client
//    and the cross-client review queue would stop updating for other clients.
{
  const calBody = bodyWindow('_kasperV2EnsureSubscribed') || '';
  const sxrBody = bodyWindow('_sxrKasperV2EnsureSubscribed') || '';
  const calHasFilter = /postgres_changes[\s\S]{0,200}filter:/.test(calBody);
  const sxrHasFilter = /postgres_changes[\s\S]{0,200}filter:/.test(sxrBody);
  if (!sxrBody) fail('cannot inspect _sxrKasperV2EnsureSubscribed body');
  else if (!/kasper-sxr/.test(sxrBody)) fail("samples Kasper channel name 'kasper-sxr' not found");
  else if (!/SXR_TABLE/.test(sxrBody)) fail('samples Kasper channel does not subscribe to SXR_TABLE');
  else if (sxrHasFilter !== calHasFilter) fail(`Kasper channel client-filter mismatch: cal filter=${calHasFilter} sxr filter=${sxrHasFilter} (samples must be cross-client like the calendar)`);
  else pass(`Kasper channel parity: cross-client (no client filter), on SXR_TABLE — matches kasper-cal`);
}

// ── report ──
console.log('═══ PARITY (realtime + immediacy) — samples (_sxr) vs calendar (_cal) ═══\n');
for (const p of passes) console.log('  ✓ ' + p);
if (fails.length) { console.log(''); for (const f of fails) console.log('  ✗ ' + f); }
console.log('\n' + '─'.repeat(64));
console.log('RESULT: ' + (fails.length ? fails.length + ' PARITY BREAK(S) — a samples realtime twin is missing or unwired' : `NO BREAKS (${passes.length} invariants hold)`));
process.exit(fails.length ? 1 : 0);

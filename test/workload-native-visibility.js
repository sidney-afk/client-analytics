'use strict';
/*
 * The standing check `OPEN_REPAIRS.md` item 72 asked for, pinned offline.
 *
 * Item 72: the flip moved only the due date and the workload weight to the
 * native store, so a RETIRED system still decides what counts as live work on
 * the page an editor opens to see what they owe. It ended by naming the check
 * that should become standing. `scripts/workload-native-visibility-check.js` is
 * that check; this file proves its classification rules without a network, so
 * the suite never depends on a service being up.
 *
 * THE NARROWING IS THE POINT and is what this mostly guards. Measured
 * 2026-09-02, 86 native live-work rows look dropped by Workload and 81 of them
 * are dropped CORRECTLY -- they have no native parent, so they are batch
 * parents (posts), not assignable deliverables. Zero of the 81 carry a parent.
 * A check that counted them would report a defect eighty-one times bigger than
 * the real one, and the real one would be ignored. That is the alarm-fatigue
 * failure `PRE_FLIP_HEALTH_CHECK.md` exists to prevent, reproduced inside a
 * different tool.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'workload-native-visibility-check.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(source, name) {
  const at = source.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = source.indexOf('{', at); j < source.length; j++) {
    const c = source[j], next = source[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

/* The real classifier, lifted from the script. */
const parked = /const PARKED_TYPES = new Set\(\[([^\]]*)\]\);/.exec(SRC);
const hides = new Function(
  'const PARKED_TYPES = new Set([' + (parked ? parked[1] : '') + ']);\n'
  + grabFunc(SRC, 'workloadHides') + '\nreturn workloadHides;')();

/* ---- 1. The parked set matches the page's own rule ---------------------- */

const wlActive = grabFunc(INDEX, 'wlIsActiveStatus');
['completed', 'canceled', 'duplicate', 'triage'].forEach(t => {
  ok(new RegExp("'" + t + "'").test(wlActive) && new RegExp("'" + t + "'").test(SRC),
    `\`${t}\` is parked in BOTH the page and the check — a check with its own idea of "live" measures nothing`);
});
ok(/backlog/i.test(wlActive) && /'backlog'/.test(SRC),
  'and Backlog too, per the 2026-08-23 owner ruling that it is not work anyone is holding');

/* ---- 2. Every way the mirror hides a live row -------------------------- */

const live = { active: true, is_sub_issue: true, status: 'Todo', status_type: 'unstarted' };
ok(hides(live) === '',
  'a row that is active, a sub-issue and unstarted is VISIBLE — the check does not cry wolf on healthy work');
ok(hides(null) === 'no workload row at all',
  'NEVER IMPORTED: no mirror row at all is its own class — measured at 7 real rows aged 17-150h against a mirror synced 20 minutes prior, so it is not sync lag');
ok(hides({ ...live, active: false }) === 'active=false',
  'MIRROR SAYS INACTIVE: item 72\'s class — the row exists and the retired system calls it dead');
ok(hides({ ...live, is_sub_issue: false }) === 'is_sub_issue=false',
  'and a row the mirror denies is a sub-issue is hidden too');
ok(/parked/.test(hides({ ...live, status_type: 'backlog' })),
  'a Backlog-TYPE row is parked whatever its column is called');
ok(/parked/.test(hides({ ...live, status: 'Backlog', status_type: 'unstarted' })),
  'and a column literally named Backlog is caught even when its type is not');
ok(hides({ ...live, active: false, is_sub_issue: false }) === 'active=false + is_sub_issue=false',
  'two reasons are reported together rather than the first one found — the cause matters for the repair');

/* ---- 3. The narrowing that keeps the number honest --------------------- */

ok(/if \(!String\(row\.raw_issue_parent_id \|\| ''\)\.trim\(\)\) \{ batchParents\+\+; continue; \}/.test(SRC),
  'A ROW WITH NO NATIVE PARENT IS A POST, not assignable work, and is excluded — 81 of the 86 apparent drops are exactly this, and counting them would bury the real 5');
ok(/if \(row\.raw_issue_archived_at \|\| row\.raw_issue_canceled_at\)/.test(SRC),
  'archived and canceled rows are excluded — nothing reconciles their native status, so they are stale natively rather than hidden');
ok(/const TEST_CLIENT/.test(SRC) && /h\.client !== TEST_CLIENT/.test(SRC),
  'the test client is reported but never gated — it is mutated by drills on purpose, and gating on it would ring for work nobody is owed');
ok(/process\.exit\(failed \? 1 : 0\)/.test(SRC),
  'and it exits non-zero above the baseline, so it can gate rather than only inform');
ok(/--json/.test(SRC) && /no writes/i.test(SRC),
  'read-only, with a --json mode for a caller that wants the rows');

console.log(failures === 0
  ? '\nworkload native visibility checks passed'
  : '\n' + failures + ' workload native visibility check(s) failed');
process.exit(failures === 0 ? 0 : 1);

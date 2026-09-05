#!/usr/bin/env node
'use strict';
/**
 * THE FRESHNESS GUARD, RUN AGAINST THE REAL FILES.
 *
 * test/rollback-row-freshness.js proves scripts/rollback-row-freshness-check.js
 * goes red for each way a fixture pair can be wrong. Nothing ran the script
 * against the repository's own ROLLBACK.md and EXECUTION_LOG.md, so on
 * 2026-09-05 the Live State row named `production-write` v66 and bundle
 * `3010578b…` (v65) as the one-step restore while v67 and then v68 were live:
 * both deploy entries had been written in a shape the parser does not read, the
 * guard compared against the 2026-09-02 receipt, and reported agreement. Codex
 * P1 on #1306. A restore by that row would have stepped back three releases.
 *
 * This runs the guard for real. It fails the unit lane when the row and the
 * newest readable receipt disagree, when the newest deploy entry is written in
 * a shape the guard cannot read, or when a receipt carries no run id. The
 * message it prints is the guard's own, which names what to fix.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'rollback-row-freshness-check.js');

let out, code = 0;
try {
  out = execFileSync(process.execPath, [SCRIPT, '--root=' + ROOT, '--json'], { encoding: 'utf8' });
} catch (e) {
  out = String(e.stdout || '');
  code = e.status === undefined ? -1 : e.status;
}
let verdict = null;
try { verdict = JSON.parse(out); } catch (_) { /* fall through */ }

if (!verdict) {
  console.error('FAIL  the freshness guard did not produce a verdict (exit ' + code + ')');
  process.exit(1);
}
const live = verdict.live || {};
const pw = live.functions && live.functions['production-write'];
console.log('  newest receipt   run ' + (live.run || '?') + ' from ' + (live.commit || '?') + '  (' + (live.source || '?') + ')');
console.log('  production-write ' + (pw ? 'v' + pw.version + ' / ' + String(pw.closure).slice(0, 8) + '…' : 'not in receipt'));
(verdict.notes || []).forEach(n => console.log('  note  ' + n));
if (verdict.ok && code === 0) {
  console.log('  ok  ROLLBACK.md\'s Live State row agrees with the newest deploy receipt in EXECUTION_LOG.md');
  console.log('\nrollback-row freshness (live): passed');
  process.exit(0);
}
(verdict.failures || []).forEach(f => console.error('FAIL  ' + f));
console.error('\nrollback-row freshness (live): the Live State row and EXECUTION_LOG.md disagree, or the newest deploy entry is unreadable');
process.exit(1);

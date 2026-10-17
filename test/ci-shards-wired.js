'use strict';
/*
 * The Calendar unit tests workflow runs its slow jobs as parallel parts
 * (2026-10-17, session Turbo). Splitting a job must never drop a suite or run
 * one twice. This checks, from the workflow text:
 *   1. every test step of a split job runs in exactly one part that exists,
 *      or in every part when the step splits itself (--shard / UNIT_SHARD);
 *   2. every part runs at least one test step;
 *   3. a self-splitting step's denominator equals the number of parts;
 *   4. test/run-all.js and qa/staff-phone-final-pass.js partition their lists
 *      exactly once across the parts (the same rule, run here on numbers);
 *   5. every split or skippable job feeds calendar-ci-result, the one check
 *      that sums the run up, and that job runs always().
 * Offline: reads files only.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WF = fs.readFileSync(path.join(ROOT, '.github/workflows/calendar-unit-tests.yml'), 'utf8');
const { jobBlock } = require('../scripts/ci-changes');
let checks = 0;

function steps(block) {
  const body = block.slice(block.indexOf('\n    steps:\n') + '\n    steps:\n'.length);
  return body.split(/\n(?=      - )/).filter(s => /^\s*- /.test(s)).map(s => ({
    text: s,
    name: (s.match(/- name: (.*)/) || [])[1] || (s.match(/- uses: (.*)/) || [])[1] || '',
    if: (s.match(/\n        if: (.*)/) || [])[1] || '',
    runs: /\n        run:|^      - name:[\s\S]*\n        run:/.test(s) && /node /.test(s),
  }));
}
function matrixList(block, key) {
  const m = block.match(new RegExp('\\n        ' + key + ': \\[([^\\]]*)\\]'));
  assert(m, 'no matrix ' + key);
  return m[1].split(',').map(x => Number(x.trim()));
}

const SPLIT = {
  'entry-links-boot': { key: 'part' },
  'staff-phone-rules': { key: 'part', self: /--shard=\$\{\{ matrix\.part \}\}\/(\d+)/ },
  'split-preview': { key: 'part' },
  'unit': { key: 'shard', self: /UNIT_SHARD: \$\{\{ matrix\.shard \}\}\/(\d+)/ },
};
for (const [job, spec] of Object.entries(SPLIT)) {
  const block = jobBlock(WF, job);
  const parts = matrixList(block, spec.key);
  assert.deepEqual(parts, parts.map((_, i) => i + 1), `${job}: parts must be 1..n`);
  const used = new Set();
  for (const st of steps(block)) {
    if (!st.runs) continue;
    const self = spec.self && st.text.match(spec.self);
    const pick = st.if.match(new RegExp('matrix\\.' + spec.key + ' == (\\d+)'));
    if (self) {
      assert.equal(Number(self[1]), parts.length, `${job}: "${st.name}" splits itself into ${self[1]} but the job has ${parts.length} parts`);
      assert(!pick, `${job}: "${st.name}" splits itself, so it must run in every part`);
      parts.forEach(p => used.add(p));
    } else if (pick) {
      assert(parts.includes(Number(pick[1])), `${job}: "${st.name}" runs in part ${pick[1]}, which does not exist`);
      used.add(Number(pick[1]));
    } else {
      assert.fail(`${job}: test step "${st.name}" has no part: it would run in every part (twice or more) or be dropped`);
    }
    checks++;
  }
  for (const p of parts) assert(used.has(p), `${job}: part ${p} runs no test step`);
}

// The same partition rule the two self-splitting runners use, on numbers.
function partition(count, n) {
  const seen = new Array(count).fill(0);
  for (let k = 1; k <= n; k++) for (let i = 0; i < count; i++) if (i % n === k - 1) seen[i]++;
  return seen.every(x => x === 1);
}
for (const n of [1, 2, 3, 4, 5]) for (const count of [0, 1, 7, 161, 744]) assert(partition(count, n), `partition ${count}/${n}`);
const runAll = fs.readFileSync(path.join(ROOT, 'test/run-all.js'), 'utf8');
assert(/plan\.files\.filter\(\(f, i\) => i % shard\.n === shard\.k - 1\)/.test(runAll), 'test/run-all.js no longer splits by i % n === k - 1');
const finalPass = fs.readFileSync(path.join(ROOT, 'qa/staff-phone-final-pass.js'), 'utf8');
assert(/\(\+\+renderSlot\) % shard\[1\] === shard\[0\] - 1/.test(finalPass), 'staff-phone-final-pass no longer splits by slot % n === k - 1');
assert.equal((finalPass.match(/if \(!inShard\(\)\) continue;/g) || []).length, 2, 'both render loops of staff-phone-final-pass must count every render');
checks += 3;

// One summing check: every job feeds it, and it runs even when one is skipped or red.
const result = jobBlock(WF, 'calendar-ci-result');
assert(/\n    if: always\(\)\n/.test(result), 'calendar-ci-result must run always()');
const jobs = [...WF.slice(WF.indexOf('\njobs:\n')).matchAll(/\n  ([A-Za-z0-9_-]+):\n/g)].map(m => m[1]).filter(j => j !== 'calendar-ci-result');
const needs = (result.match(/\n    needs: \[([^\]]*)\]/) || [])[1].split(',').map(s => s.trim());
assert.deepEqual([...needs].sort(), [...jobs].sort(), 'calendar-ci-result must need every other job');
assert(/result == "failure" or \.value\.result == "cancelled"/.test(result), 'calendar-ci-result must fail on a failed or cancelled job');
checks += 3;

console.log(`ci-shards-wired: ${checks} checks passed`);

'use strict';
/*
 * The Calendar unit tests workflow runs its slow jobs as parallel parts
 * (2026-10-17, session Turbo). Splitting a job must never drop a suite or run
 * one twice. This checks, from the workflow text:
 *   1. every test command of a split job (a line of its lane step, see
 *      scripts/ci-lanes.js) runs in exactly one part that exists; the phone
 *      state inventory's four quarters each run once per width;
 *   2. every part runs at least one test command;
 *   3. the unit job's UNIT_SHARD denominator equals its number of parts;
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

// A split job now runs its checks inside lane steps (scripts/ci-lanes.js): one
// step per part, its commands listed `name|command` between <<'LANES' and LANES.
function laneSteps(block) {
  const body = block.slice(block.indexOf('\n    steps:\n') + '\n    steps:\n'.length);
  return body.split(/\n(?=      - )/).filter(s => /ci-lanes\.js/.test(s)).map(s => {
    const lanes = Number((s.match(/--lanes=(\d+)/) || [])[1]);
    const text = (s.match(/<<'LANES'\n([\s\S]*?)\n\s*LANES/) || [])[1] || '';
    return {
      name: (s.match(/- name: (.*)/) || [])[1] || '',
      if: (s.match(/\n        if: (.*)/) || [])[1] || '',
      lanes,
      cmds: text.split('\n').map(l => l.trim()).filter(Boolean).map(l => ({ name: l.slice(0, l.indexOf('|')), cmd: l.slice(l.indexOf('|') + 1) })),
    };
  });
}
function matrixList(block, key) {
  const m = block.match(new RegExp('\\n        ' + key + ': \\[([^\\]]*)\\]'));
  assert(m, 'no matrix ' + key);
  return m[1].split(',').map(x => Number(x.trim()));
}

// job -> the matrix key that names its parts. Every part is one lane step.
const SPLIT = {
  'entry-links-boot': { key: 'part' },
  'browser-guards': { key: 'part' },
  'staff-phone-rules': { key: 'part', quarters: 4 },
  // The two parts run the same gates against two different builds of the page, on purpose.
  'split-preview': { key: 'part', sameInEveryPart: true },
};
for (const [job, spec] of Object.entries(SPLIT)) {
  const block = jobBlock(WF, job);
  const parts = matrixList(block, spec.key);
  assert.deepEqual(parts, parts.map((_, i) => i + 1), `${job}: parts must be 1..n`);
  const seenCmd = new Map();
  const used = new Set();
  const quarters = [];
  for (const st of laneSteps(block)) {
    const pick = st.if.match(new RegExp('matrix\\.' + spec.key + ' == (\\d+)'));
    assert(pick, `${job}: lane step "${st.name}" has no part: it would run in every part (twice or more)`);
    const part = Number(pick[1]);
    assert(parts.includes(part), `${job}: "${st.name}" runs in part ${part}, which does not exist`);
    assert(!used.has(part), `${job}: part ${part} has two lane steps`);
    used.add(part);
    assert(st.lanes >= 1 && st.lanes <= 4, `${job}: "${st.name}" runs ${st.lanes} lanes; 4 is the most a 4-CPU runner is measured to hold`);
    assert(st.cmds.length > 0, `${job}: part ${part} runs no test`);
    for (const c of st.cmds) {
      assert(c.name && /\bnode\s/.test(c.cmd), `${job}: lane line "${c.name}" needs a name and a node command`);
      assert(spec.sameInEveryPart || !seenCmd.has(c.cmd), `${job}: "${c.cmd}" runs in part ${seenCmd.get(c.cmd)} and part ${part}`);
      seenCmd.set(c.cmd, part);
      const q = c.cmd.match(/--shard=(\d+)\/(\d+)/);
      if (q) { assert.equal(Number(q[2]), spec.quarters, `${job}: "${c.name}" splits into ${q[2]} but the job expects ${spec.quarters}`); quarters.push(Number(q[1])); }
      checks++;
    }
  }
  for (const p of parts) assert(used.has(p), `${job}: part ${p} has no lane step`);
  if (spec.quarters) assert.deepEqual(quarters.sort(), Array.from({ length: spec.quarters }, (_, i) => i + 1), `${job}: the ${spec.quarters} quarters of the state inventory must each run exactly once per width`);
}
// unit splits itself: test/run-all.js runs every third suite per part (UNIT_SHARD).
{
  const block = jobBlock(WF, 'unit');
  const parts = matrixList(block, 'shard');
  assert.deepEqual(parts, parts.map((_, i) => i + 1), 'unit: parts must be 1..n');
  const m = block.match(/UNIT_SHARD: \$\{\{ matrix\.shard \}\}\/(\d+)/);
  assert(m && Number(m[1]) === parts.length, `unit: UNIT_SHARD denominator must equal the ${parts.length} parts`);
  checks++;
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

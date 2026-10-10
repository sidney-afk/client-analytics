'use strict';
// A workflow step that holds the SMM robot key must never also hold the admin
// roster name. Sign-in (key-verify) and description-image-upload both require
// the roster member's role to match the key's role, so that pairing fails every
// run (401 role_mismatch, 403 roster_actor_not_unique). It shipped twice on
// 2026-10-09/10: the Calendar nightly's p96 and the morning check's Samples
// approve. Each step's effective env (workflow + job + step) is checked.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const ROOT = path.resolve(__dirname, '..');
const WF = path.join(ROOT, '.github', 'workflows');
const ACTOR = /\$\{\{\s*secrets\.(?:SYNCVIEW_STAFF_ACTOR|SYNCVIEW_ACTOR)\s*\}\}|^\s*SYNCVIEW_(?:STAFF_)?ACTOR\s*:/;
const SMM = /secrets\.ROBOT_ROLE_KEY_SMM\b/;

const indentOf = (l) => l.match(/^ */)[0].length;

// Returns [{ job, step, env: [lines] }] with workflow + job env folded in.
function stepEnvs(yaml) {
  const lines = yaml.split(/\r?\n/);
  const out = [];
  let wfEnv = [], jobEnv = [], job = null, stepIndent = null, cur = null;
  const collect = (i) => {
    const base = indentOf(lines[i]);
    const got = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if (indentOf(lines[j]) <= base) break;
      got.push(lines[j]);
    }
    return got;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*#/.test(l) || !l.trim()) continue;
    const ind = indentOf(l);
    if (/^env:\s*$/.test(l)) { wfEnv = collect(i); continue; }
    if (/^  [\w-]+:\s*$/.test(l) && /^jobs:/m.test(lines.slice(0, i).join('\n'))) {
      if (cur) out.push(cur);
      cur = null; job = l.trim().slice(0, -1); jobEnv = []; stepIndent = null; continue;
    }
    if (job && ind === 4 && /^\s*env:\s*$/.test(l)) { jobEnv = collect(i); continue; }
    if (job && /^\s*- /.test(l) && (stepIndent === null || ind === stepIndent) && ind >= 4) {
      stepIndent = ind;
      if (cur) out.push(cur);
      cur = { job, step: l.trim(), env: [...wfEnv, ...jobEnv] };
      const name = l.match(/name:\s*(.*)$/);
      if (name) cur.step = name[1];
      continue;
    }
    if (cur && /^\s*name:\s*/.test(l) && ind === stepIndent + 2) cur.step = l.replace(/^\s*name:\s*/, '');
    if (cur && /^\s*env:\s*$/.test(l) && ind === stepIndent + 2) cur.env.push(...collect(i));
  }
  if (cur) out.push(cur);
  return out;
}

function pairings(yaml) {
  return stepEnvs(yaml).filter(s => {
    const live = s.env.filter(l => !/^\s*#/.test(l));
    return live.some(l => SMM.test(l)) && live.some(l => ACTOR.test(l));
  });
}

// The scanner itself: a pairing is caught at step, job and workflow level, and
// the split shape is clean.
const bad = `jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - name: probes
        env:
          SYNCVIEW_STAFF_KEY: \${{ secrets.ROBOT_ROLE_KEY_SMM }}
          SYNCVIEW_STAFF_ACTOR: \${{ secrets.SYNCVIEW_STAFF_ACTOR }}
        run: node x.js
`;
assert.equal(pairings(bad).length, 1, 'a step pairing the SMM key with the admin actor is caught');
const jobLevel = `jobs:
  e2e:
    runs-on: ubuntu-latest
    env:
      SYNCVIEW_ACTOR: \${{ secrets.SYNCVIEW_STAFF_ACTOR }}
    steps:
      - name: probes
        env:
          SYNCVIEW_ROLE_KEY: \${{ secrets.ROBOT_ROLE_KEY_SMM }}
        run: node x.js
`;
assert.equal(pairings(jobLevel).length, 1, 'an actor set at job level still pairs with a step SMM key');
const wfLevel = `env:
  SYNCVIEW_ACTOR: \${{ secrets.SYNCVIEW_STAFF_ACTOR }}
jobs:
  e2e:
    steps:
      - uses: actions/checkout@v4
        env:
          K: \${{ secrets.ROBOT_ROLE_KEY_SMM }}
`;
assert.equal(pairings(wfLevel).length, 1, 'an actor set at workflow level still pairs');
const split = `jobs:
  e2e:
    steps:
      - name: main
        env:
          SYNCVIEW_STAFF_KEY: \${{ secrets.ROBOT_ROLE_KEY_SMM }}
        run: node x.js
      - name: admin
        env:
          SYNCVIEW_STAFF_KEY: \${{ secrets.SYNCVIEW_STAFF_KEY }}
          SYNCVIEW_STAFF_ACTOR: \${{ secrets.SYNCVIEW_STAFF_ACTOR }}
        run: node x.js
`;
assert.equal(pairings(split).length, 0, 'the SMM step and the admin step, kept apart, pass');
assert.equal(stepEnvs(split).length, 2, 'both steps are seen');

// Every real workflow.
let checked = 0, smmSteps = 0;
for (const f of fs.readdirSync(WF).filter(f => /\.ya?ml$/.test(f)).sort()) {
  const yaml = fs.readFileSync(path.join(WF, f), 'utf8');
  for (const s of pairings(yaml)) assert.fail(`${f} step "${s.step}" pairs ROBOT_ROLE_KEY_SMM with the admin roster name`);
  smmSteps += stepEnvs(yaml).filter(s => s.env.some(l => SMM.test(l))).length;
  checked++;
}
// The scanner must actually see the robots' SMM steps, or it proves nothing.
assert.ok(smmSteps >= 3, 'the scanner finds the SMM-key steps (Calendar, Samples, dawn check)');

// The two exceptions keep their admin key and actor, in steps of their own.
for (const [f, stepName] of [['calendar-e2e-nightly.yml', 'Run p96 description image upload (admin key)'],
  ['dawn-check.yml', 'Samples approve (admin key, scoped to sidneylaruel)']]) {
  const s = stepEnvs(fs.readFileSync(path.join(WF, f), 'utf8')).find(x => x.step === stepName);
  assert.ok(s, `${f} has its admin-key step`);
  assert.ok(s.env.some(l => /secrets\.SYNCVIEW_STAFF_KEY\b/.test(l)) && s.env.some(l => ACTOR.test(l)), `${f}: that step pairs the admin key with the admin actor`);
}
console.log(`robot-key-actor-pairing: ${checked} workflows, ${smmSteps} SMM-key steps, no admin actor beside the SMM key ✅`);

'use strict';

/*
 * Workload tweak-bucket exclusivity regression.
 *
 * A Linear tweak sub-issue can retain the due date from its original plan.
 * Exercise the real workload classifier and wlApplyData implementation to
 * prove that either canonical tweak-status spelling appears in the tweaks
 * strip only, never on the planned calendar or another status strip.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let i = INDEX.indexOf('{', at); i < INDEX.length; i++) {
    if (INDEX[i] === '{') depth++;
    else if (INDEX[i] === '}') {
      depth--;
      if (depth === 0) return INDEX.slice(at, i + 1);
    }
  }
  throw new Error('unbalanced function: ' + name);
}

function compile(name, deps = {}) {
  const names = Object.keys(deps);
  const values = names.map(key => deps[key]);
  return new Function(...names, 'return (' + grabFunc(name) + ');')(...values);
}

let pass = 0;
let fail = 0;
function check(condition, label) {
  if (condition) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}

const wlNormStatus = compile('wlNormStatus');
const wlIsInProgress = compile('wlIsInProgress', { wlNormStatus });
const wlIsTweaksNeeded = compile('wlIsTweaksNeeded', { wlNormStatus });
const wlIsToDo = compile('wlIsToDo', { wlNormStatus });
const wlState = {};
let scheduledInput = [];

const wlApplyData = compile('wlApplyData', {
  wlState,
  wlIsActiveStatus: () => true,
  wlIsAllowedClient: () => true,
  wlCanonicalClient: name => name,
  wlTeamBucket: () => 'video',
  wlDisplayName: name => name,
  wlIsAllowedEditor: () => true,
  wlTodayISO: () => '2026-07-15',
  wlIsInProgress,
  wlIsTweaksNeeded,
  wlIsToDo,
  scheduleAll: planned => {
    scheduledInput = planned.slice();
    return new Map();
  },
});

function issue(status, id, dueDate) {
  return {
    id,
    identifier: id.toUpperCase(),
    title: 'Due-date tweak fixture',
    isSubIssue: true,
    parentId: 'parent-1',
    clientName: 'Test Client',
    assigneeId: 'editor-1',
    assigneeName: 'Test Editor',
    teamKey: 'VID',
    teamName: 'Video Editors',
    status,
    statusType: 'started',
    dueDate,
  };
}

function applyOne(status, id, dueDate) {
  scheduledInput = [];
  wlApplyData([issue(status, id, dueDate)], '2026-07-15T12:00:00Z');
  return {
    tweaks: wlState.tweaksNeeded.map(row => row.id),
    planned: wlState.planned.map(row => row.id),
    nowWorking: wlState.nowWorking.map(row => row.id),
    overdue: wlState.overdue.map(row => row.id),
    scheduled: scheduledInput.map(row => row.id),
  };
}

console.log('\nWorkload tweak bucket exclusivity');
for (const [status, label, id] of [
  ['Tweak Needed ', 'Tweak Needed (live trailing-space form)', 'tweak-singular'],
  ['Tweaks Needed', 'Tweaks Needed', 'tweak-plural'],
]) {
  check(wlIsTweaksNeeded({ status }), label + ' is in the canonical tweak family');
  const result = applyOne(status, id, '2026-07-15');
  const bucketCount = result.tweaks.length + result.planned.length
    + result.nowWorking.length + result.overdue.length;

  check(result.tweaks.length === 1 && result.tweaks[0] === id,
    label + ' appears in the tweaks section');
  check(result.planned.length === 0 && result.scheduled.length === 0,
    label + ' keeps its due date out of the planned calendar');
  check(result.nowWorking.length === 0 && result.overdue.length === 0,
    label + ' stays out of the other status strips');
  check(bucketCount === 1,
    label + ' is counted exactly once across workload buckets');

  const pastId = id + '-past-due';
  const past = applyOne(status, pastId, '2026-07-14');
  check(past.tweaks.length === 1 && past.tweaks[0] === pastId
      && past.planned.length === 0 && past.nowWorking.length === 0
      && past.overdue.length === 0 && past.scheduled.length === 0,
    label + ' stays tweaks-only when its retained due date is overdue');
}

console.log('\n' + (fail === 0 ? 'OVERALL: PASS' : `OVERALL: FAIL (${fail} failed)`));
process.exit(fail === 0 ? 0 : 1);

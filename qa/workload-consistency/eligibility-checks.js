'use strict';
const assert = require('node:assert/strict');
const { snapshot } = require('./fixtures');
const { compare } = require('./compare');
function eligibilitySnapshot() {
  const s = snapshot();
  s.workload = [];
  s.workloadRoster = { complete: true, clientNames: ['Synthetic Client'],
    videoEditors: ['Synthetic Video'], graphicsEditors: ['Synthetic Graphics'],
    inactiveEditors: ['Synthetic Inactive'] };
  Object.assign(s.native[0], { workloadClientName: 'Synthetic Client',
    workloadAssigneeName: 'Synthetic Video', workloadPlanDate: null });
  return s;
}
function runEligibilityChecks(compareFn = compare) {
  const results = [];
  const count = (result, code) => result.counts[code] || 0;
  function check(id, patch, expected) {
    const s = eligibilitySnapshot(); patch(s);
    const result = compareFn(s);
    const actual = Object.fromEntries(Object.keys(expected).map(code => [code, count(result, code)]));
    try { assert.deepEqual(actual, expected); results.push({ id, verdict: 'PASS', expected, actual }); }
    catch (_) { results.push({ id, verdict: 'FAIL', expected, actual }); }
  }
  const missing = { native_missing_from_workload: 1, legitimate_workload_exclusion: 0, workload_eligibility_unproven: 0 };
  const excluded = { native_missing_from_workload: 0, legitimate_workload_exclusion: 1, workload_eligibility_unproven: 0 };
  const unknown = { native_missing_from_workload: 0, legitimate_workload_exclusion: 0, workload_eligibility_unproven: 1, workload_absence_unproven: 1 };
  check('E01-eligible-assigned-missing', () => {}, missing);
  check('E02-unassigned-undated-todo-excluded', s => Object.assign(s.native[0], { ownerId: null, dueDate: null }), excluded);
  check('E03-unassigned-due-date-is-eligible', s => { s.native[0].ownerId = null; }, missing);
  check('E04-unassigned-plan-only-is-eligible', s => Object.assign(s.native[0], { ownerId: null, dueDate: null, workloadPlanDate: '2026-09-09' }), missing);
  check('E05-unassigned-in-progress-without-dates-is-eligible', s => Object.assign(s.native[0], { ownerId: null, dueDate: null, status: 'in_progress' }), missing);
  check('E06-off-team-name-excluded', s => { s.native[0].workloadAssigneeName = 'Synthetic Graphics'; }, excluded);
  check('E07-graphics-on-graphics-is-eligible', s => Object.assign(s.native[0], { workloadAssigneeName: 'Synthetic Graphics', team: 'graphics', kind: 'graphic' }), missing);
  check('E08-missing-roster-is-unknown', s => { delete s.workloadRoster; }, unknown);
  check('E09-incomplete-roster-is-unknown', s => { s.workloadRoster.complete = false; }, unknown);
  check('E10-unknown-plan-is-not-undated-proof', s => { Object.assign(s.native[0], { ownerId: null, dueDate: null }); delete s.native[0].workloadPlanDate; }, unknown);
  check('E11-unknown-owner-is-not-unassigned', s => { delete s.native[0].ownerId; }, unknown);
  check('E12-incomplete-workload-cannot-prove-eligible-absence', s => { s.coverage.workload.complete = false; },
    { native_missing_from_workload: 0, legitimate_workload_exclusion: 0, workload_eligibility_unproven: 0, workload_absence_unproven: 1 });
  check('E13-unknown-client-name-is-not-exclusion-proof', s => { delete s.native[0].workloadClientName; }, unknown);
  check('E14-complete-roster-client-exclusion', s => { s.native[0].workloadClientName = 'Synthetic Outside Client'; }, excluded);
  check('E15-filtered-row-legitimately-excluded-is-not-missing-defect', s => {
    Object.assign(s.native[0], { ownerId: null, dueDate: null });
    s.workload = [{ ...snapshot().workload[0], visible: false }];
  }, { native_stored_but_filtered: 0, legitimate_workload_exclusion: 1, native_missing_from_workload: 0 });
  check('E16-filtered-eligible-work-still-detected', s => {
    s.workload = [{ ...snapshot().workload[0], visible: false }];
  }, { native_stored_but_filtered: 1, legitimate_workload_exclusion: 0, native_missing_from_workload: 0 });
  return results;
}
if (require.main === module) {
  const results = runEligibilityChecks();
  console.log(JSON.stringify({ evidence: 'OFFLINE_TEST', results }, null, 2));
  process.exitCode = results.some(r => r.verdict !== 'PASS') ? 1 : 0;
}
module.exports = { runEligibilityChecks, eligibilitySnapshot };

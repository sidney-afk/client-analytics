'use strict';

/*
 * A Linear issue marked Duplicate is not live work.
 *
 * `duplicate` is terminal everywhere else in the app -- `_prodIsDone` lists it
 * beside `completed` and `canceled` -- but Workload's own active filter omitted
 * it. So an issue somebody had closed as a duplicate kept its assignee, kept
 * its due date, and consumed that designer's capacity for work that by
 * definition is not going to be done. The F40 readiness gate found it on
 * 2026-08-22: GRA-7101, Duplicate, due 2026-08-17, assigned, counted as a row
 * that would lose its deadline at the flip -- a deadline nobody wanted.
 *
 * This executes the real filter out of the shipped file rather than asserting
 * on its text, so a future edit that drops the case fails here.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('PASS:', message);
  else { failures++; console.error('FAIL workload-duplicate-not-active:', message); }
}

function extract(pattern, label) {
  const found = APP.match(pattern);
  if (!found) throw new Error('missing ' + label);
  return found[0];
}

const context = {};
vm.createContext(context);
vm.runInContext(extract(/const WL_PARKED_STATUSES = new Set\(\[[\s\S]*?\]\);/, 'WL_PARKED_STATUSES'), context);
vm.runInContext(extract(/function wlNormStatus\([\s\S]*?\n {4}\}/, 'wlNormStatus'), context);
vm.runInContext(extract(/function wlIsActiveStatus\([\s\S]*?\n {4}\}/, 'wlIsActiveStatus'), context);
const { wlIsActiveStatus } = context;

const issue = (statusType, status) => ({ statusType, status });

// --- the case that was live work and should not have been -------------------
ok(wlIsActiveStatus(issue('duplicate', 'Duplicate')) === false,
  'an issue closed as a duplicate is not active work');
ok(wlIsActiveStatus(issue('Duplicate', 'Duplicate')) === false,
  'the status type is matched case-insensitively');

// --- the terminal set this now agrees with ----------------------------------
ok(wlIsActiveStatus(issue('completed', 'Approved')) === false, 'completed is not active');
ok(wlIsActiveStatus(issue('canceled', 'Canceled')) === false, 'canceled is not active');
ok(wlIsActiveStatus(issue('triage', 'Triage')) === false, 'triage is not active');
ok(/\['completed','canceled','duplicate'\]/.test(APP),
  'the Production surface still treats duplicate as terminal — this filter agrees with it');

// --- and the work that IS live stays live -----------------------------------
ok(wlIsActiveStatus(issue('unstarted', 'Todo')) === true, 'Todo is active work');
ok(wlIsActiveStatus(issue('started', 'In Progress')) === true, 'In Progress is active work');
// Backlog left this filter on 2026-08-23 by owner ruling: it is not work
// anyone is holding, and it was carrying 681 of the 1,073 rows the page drew --
// 273 of them assigned, each eating a slice of somebody's daily capacity.
ok(wlIsActiveStatus(issue('backlog', 'Backlog')) === false,
  'Backlog is not work anyone is holding');
ok(wlIsActiveStatus(issue('started', 'Tweak Needed')) === true, 'a tweak that still needs doing is active work');

// --- the parked list is untouched by this change ----------------------------
ok(wlIsActiveStatus(issue('started', 'For SMM approval')) === false,
  'a status parked awaiting somebody else is still not the assignee\'s active work');
ok(wlIsActiveStatus(issue('started', 'Tweaks Applied')) === false,
  'an applied tweak stays parked');

// --- the TYPE decides, not the column's name --------------------------------
// Keying on the name would break the day somebody renames the column in Linear,
// and would wrongly park a `unstarted` column that happens to be called
// Backlog. Both directions are asserted so a future edit cannot quietly swap
// the test for a name match.
ok(wlIsActiveStatus(issue('backlog', 'Icebox')) === false,
  'a backlog-type column renamed to anything else is still parked');
ok(wlIsActiveStatus(issue('unstarted', 'Backlog')) === true,
  'a column merely NAMED Backlog, typed unstarted, is still live work');
ok(wlIsActiveStatus(issue('Backlog', 'Backlog')) === false,
  'the backlog type is matched case-insensitively too');

process.exit(failures ? 1 : 0);

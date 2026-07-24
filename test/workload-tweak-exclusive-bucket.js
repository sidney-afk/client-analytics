'use strict';

/*
 * Workload hybrid plan-calendar and tweak-bucket regression.
 *
 * A Linear tweak sub-issue can retain the due date from its original plan.
 * Exercise the real workload classifier and wlApplyData implementation to
 * prove that either canonical tweak-status spelling appears in the tweaks
 * strip only, never on the planned calendar or another status strip.
 *
 * With an authoritative plan snapshot, an ordinary dated row is auto-planned
 * one working day before its deadline (floored to today). An explicit
 * plan_date wins literally; capacity never spills or hides work.
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
const wlTeamBucket = compile('wlTeamBucket');
const wlEditorCapacity = compile('wlEditorCapacity', { wlTeamBucket });
const wlISO = compile('wlISO');
const wlParseISO = compile('wlParseISO');
const wlWeekMondayISO = compile('wlWeekMondayISO', { wlParseISO, wlISO });
const wlSubWorkingDays = compile('wlSubWorkingDays', { wlParseISO, wlISO });
const wlWorkloadTodayISO = compile('wlWorkloadTodayISO', {
  WL_WORKLOAD_TIME_ZONE: 'America/Guatemala',
});
const wlState = {
  calendarByDate: new Map(),
  planByIssueId: new Map(),
  workloadByIssueId: new Map(),
  issueSnapshot: [],
  planHasSnapshot: true,
};
const wlPlanDate = compile('wlPlanDate', { wlState });
const wlAutoPlanDate = compile('wlAutoPlanDate', {
  wlSubWorkingDays,
  wlWorkloadTodayISO: () => '2026-07-15',
});
const wlDisplayDate = compile('wlDisplayDate', {
  wlState,
  wlPlanDate,
  wlAutoPlanDate,
});
const wlPlacementMode = compile('wlPlacementMode', { wlState, wlPlanDate });
const wlFormatShort = compile('wlFormatShort', { wlParseISO });
const wlCalendarDayDiff = compile('wlCalendarDayDiff');
const wlPlacementLabel = compile('wlPlacementLabel');
const wlPlanOriginHtml = compile('wlPlanOriginHtml', {
  wlPlacementLabel,
  wlEscape: value => String(value),
});
const wlGroupPlacementMode = compile('wlGroupPlacementMode', { wlPlacementMode });
const wlGroupPlanOriginHtml = compile('wlGroupPlanOriginHtml', { wlPlacementMode, wlPlanOriginHtml });
const wlWorkingDayDiff = compile('wlWorkingDayDiff', { wlParseISO, wlISO });
const wlDeadlineMeta = compile('wlDeadlineMeta', {
  wlWorkingDayDiff,
  wlFormatShort,
});
const wlDeadlineTagHtml = compile('wlDeadlineTagHtml', {
  wlDeadlineMeta,
  wlEscape: value => String(value),
});
const wlDeadlineDotHtml = compile('wlDeadlineDotHtml');
const wlGroupDeadlineSummary = compile('wlGroupDeadlineSummary', { wlDeadlineMeta, wlDisplayDate });
const wlGroupDeadlineHtml = compile('wlGroupDeadlineHtml', {
  wlGroupDeadlineSummary,
  wlDeadlineDotHtml,
  wlEscape: value => String(value),
});
const wlWorkloadMeta = compile('wlWorkloadMeta', { wlState, wlTeamBucket });
const wlWorkloadWeight = compile('wlWorkloadWeight', { wlWorkloadMeta });
const wlWorkloadUnits = compile('wlWorkloadUnits', { wlWorkloadWeight });
const wlWorkloadBadgeHtml = compile('wlWorkloadBadgeHtml', {
  wlWorkloadMeta,
  wlEscape: value => String(value),
});
const wlGroupWorkloadHtml = compile('wlGroupWorkloadHtml', {
  wlWorkloadWeight,
  wlEscape: value => String(value),
});
const wlGroupProximityDays = compile('wlGroupProximityDays', {
  wlWorkingDayDiff,
  wlDisplayDate,
});
const wlCompareClientGroups = compile('wlCompareClientGroups', { wlGroupProximityDays });
const wlDayOverCapacity = compile('wlDayOverCapacity', {
  wlTeamBucket,
  wlEditorCapacity,
  wlWorkloadWeight,
});
const wlDragGripSvg = compile('wlDragGripSvg');
const wlIssueDragHandleHtml = compile('wlIssueDragHandleHtml', {
  wlEscape: value => String(value),
  wlDragGripSvg,
});
const wlGroupDragHandleHtml = compile('wlGroupDragHandleHtml', {
  wlEscape: value => String(value),
  wlDragGripSvg,
});
const wlBucketByDisplayDate = compile('wlBucketByDisplayDate', { wlDisplayDate });

const wlApplyData = compile('wlApplyData', {
  wlState,
  wlIsActiveStatus: () => true,
  wlIsAllowedClient: () => true,
  wlCanonicalClient: name => name,
  wlTeamBucket: () => 'video',
  wlDisplayName: name => name,
  wlIsAllowedEditor: () => true,
  wlWorkloadTodayISO: () => '2026-07-15',
  wlIsInProgress,
  wlIsTweaksNeeded,
  wlIsToDo,
  wlPlanDate,
  wlDisplayDate,
  wlBucketByDisplayDate,
});
const wlApplyDueLocal = compile('wlApplyDueLocal', { wlState, wlApplyData });

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
  wlApplyData([issue(status, id, dueDate)], '2026-07-15T12:00:00Z');
  return {
    tweaks: wlState.tweaksNeeded.map(row => row.id),
    planned: wlState.planned.map(row => row.id),
    nowWorking: wlState.nowWorking.map(row => row.id),
    overdue: wlState.overdue.map(row => row.id),
    undated: wlState.undated.map(row => row.id),
    calendar: [...wlState.calendarByDate.values()].flat().map(row => row.id),
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
  check(result.planned.length === 0 && result.calendar.length === 0,
    label + ' keeps its due date out of the planned calendar');
  check(result.nowWorking.length === 0 && result.overdue.length === 0,
    label + ' stays out of the other status strips');
  check(bucketCount === 1,
    label + ' is counted exactly once across workload buckets');

  const pastId = id + '-past-due';
  const past = applyOne(status, pastId, '2026-07-14');
  check(past.tweaks.length === 1 && past.tweaks[0] === pastId
      && past.planned.length === 0 && past.nowWorking.length === 0
      && past.overdue.length === 0 && past.calendar.length === 0,
    label + ' stays tweaks-only when its retained due date is overdue');
}

console.log('\nWorkload hybrid auto/manual plan-date mode');
check(wlWorkloadTodayISO(new Date('2026-07-22T05:59:59.000Z')) === '2026-07-21'
    && wlWorkloadTodayISO(new Date('2026-07-22T06:00:00.000Z')) === '2026-07-22',
  'automatic placement uses one Guatemala policy day across viewer time zones');
const dueDate = '2026-07-20';
const autoDate = '2026-07-17';
const videoRows = Array.from({ length: 6 }, (_, i) => issue('To Do', 'video-' + i, dueDate));
wlApplyData(videoRows, '2026-07-15T12:00:00Z');
const autoBucket = wlState.calendarByDate.get(autoDate) || [];
check(wlAutoPlanDate(videoRows[0], '2026-07-15') === autoDate
    && wlState.calendarByDate.size === 1
    && autoBucket.length === videoRows.length
    && !wlState.calendarByDate.has(dueDate),
  'without an override, dated rows are auto-planned one working day before their deadline');
check(wlPlacementMode(videoRows[0]) === 'auto',
  'an authoritative deadline-derived placement is visibly classified as auto');
check(autoBucket.every(row => row.dueDate === dueDate
    && !Object.prototype.hasOwnProperty.call(row, 'scheduledDate')
    && !Object.prototype.hasOwnProperty.call(row, 'effectiveWorkDate')),
  'auto bucketing stays item-local and does not mutate scheduler state onto issue rows');
check(wlEditorCapacity('VID', 'Video Editors') === 4
    && !wlDayOverCapacity(autoBucket.slice(0, 4))
    && wlDayOverCapacity(autoBucket.slice(0, 5))
    && autoBucket.length === 6,
  'video capacity is 4/day and overload keeps every planned item visible without spilling');

const pastDue = issue('To Do', 'ordinary-overdue', '2026-07-14');
wlApplyData([pastDue], '2026-07-15T12:00:00Z');
check(wlState.overdue.map(row => row.id).includes('ordinary-overdue')
    && !wlState.planned.map(row => row.id).includes('ordinary-overdue')
    && ![...wlState.calendarByDate.values()].flat().map(row => row.id).includes('ordinary-overdue'),
  'past-due work leaves the work-day calendar and appears in Overdue');

const pastDueInProgress = issue('In Progress', 'in-progress-overdue', '2026-07-14');
wlApplyData([pastDueInProgress], '2026-07-15T12:00:00Z');
check(wlState.overdue.map(row => row.id).includes('in-progress-overdue')
    && wlState.nowWorking.map(row => row.id).includes('in-progress-overdue')
    && !wlState.planned.map(row => row.id).includes('in-progress-overdue')
    && ![...wlState.calendarByDate.values()].flat().map(row => row.id).includes('in-progress-overdue'),
  'past-due In Progress work appears in both exception strips but not on the calendar');

const manuallyPlannedPastDue = issue('To Do', 'manual-overdue', '2026-07-14');
wlState.planByIssueId.set(manuallyPlannedPastDue.id, '2026-07-18');
wlApplyData([manuallyPlannedPastDue], '2026-07-15T12:00:00Z');
check(wlState.overdue.map(row => row.id).includes('manual-overdue')
    && wlState.planned.map(row => row.id).includes('manual-overdue')
    && (wlState.calendarByDate.get('2026-07-18') || []).map(row => row.id).includes('manual-overdue'),
  'a past-due manual pin stays on its exact work day and also appears in Overdue');
wlState.planByIssueId.delete(manuallyPlannedPastDue.id);

const graphicRows = Array.from({ length: 16 }, (_, i) => ({
  ...issue('To Do', 'graphic-' + i, dueDate),
  teamKey: 'GRA',
  teamName: 'Graphics',
}));
check(!wlDayOverCapacity(graphicRows.slice(0, 15)) && wlDayOverCapacity(graphicRows),
  'graphics capacity stays 15/day and the sixteenth row marks overload');

const undated = issue('To Do', 'undated', null);
wlApplyData([undated], '2026-07-15T12:00:00Z');
check(wlState.calendarByDate.size === 0 && wlState.undated.map(row => row.id).includes('undated'),
  'assigned undated work stays visible in its explicit lane and is never auto-placed');

const planned = issue('To Do', 'explicit-plan', '2026-07-20');
wlState.planByIssueId.set(planned.id, '2026-07-23');
wlApplyData([planned], '2026-07-15T12:00:00Z');
check((wlState.calendarByDate.get('2026-07-23') || []).map(row => row.id).includes(planned.id)
    && !wlState.calendarByDate.has('2026-07-20')
    && wlPlacementMode(planned) === 'manual',
  'an explicit plan_date displays on that exact work day instead of changing the deadline');

const pinnedDueEdit = issue('To Do', 'pinned-due-edit', '2026-07-24');
wlState.planByIssueId.set(pinnedDueEdit.id, '2026-07-21');
wlApplyData([pinnedDueEdit], '2026-07-15T12:00:00Z');
wlApplyDueLocal(pinnedDueEdit.id, '2026-07-14');
check(wlDisplayDate(pinnedDueEdit) === '2026-07-21'
    && wlState.planByIssueId.get(pinnedDueEdit.id) === '2026-07-21'
    && (wlState.calendarByDate.get('2026-07-21') || []).some(row => row.id === pinnedDueEdit.id)
    && wlState.overdue.some(row => row.id === pinnedDueEdit.id),
  'changing a Linear due date to the past keeps the exact pin and also shows Overdue');
wlState.planByIssueId.delete(pinnedDueEdit.id);

const automaticDueEdit = issue('To Do', 'automatic-due-edit', '2026-07-24');
wlApplyData([automaticDueEdit], '2026-07-15T12:00:00Z');
const automaticBeforeEdit = wlDisplayDate(automaticDueEdit);
wlApplyDueLocal(automaticDueEdit.id, '2026-07-27');
check(automaticBeforeEdit === '2026-07-23'
    && wlDisplayDate(automaticDueEdit) === '2026-07-24'
    && (wlState.calendarByDate.get('2026-07-24') || []).some(row => row.id === automaticDueEdit.id),
  'changing a Linear due date rederives only an automatically planned work day');

wlState.planByIssueId.delete(planned.id);
wlApplyData([planned], '2026-07-15T12:00:00Z');
check((wlState.calendarByDate.get(autoDate) || []).map(row => row.id).includes(planned.id),
  'clearing plan_date returns the issue to its automatic plan day');

wlState.planHasSnapshot = false;
wlApplyData([planned], '2026-07-15T12:00:00Z');
check((wlState.calendarByDate.get(dueDate) || []).map(row => row.id).includes(planned.id)
    && !wlState.calendarByDate.has(autoDate)
    && wlPlacementMode(planned) === 'fallback',
  'without an authoritative plan snapshot, the board degrades to its deadline fallback');
wlState.planHasSnapshot = true;

const plannedUndated = issue('To Do', 'planned-undated', null);
wlState.planByIssueId.set(plannedUndated.id, '2026-07-24');
wlApplyData([plannedUndated], '2026-07-15T12:00:00Z');
check((wlState.calendarByDate.get('2026-07-24') || []).map(row => row.id).includes(plannedUndated.id)
    && !wlState.undated.map(row => row.id).includes(plannedUndated.id),
  'an undated issue with an explicit plan day enters the calendar');

const plannedTweak = issue('Tweak Needed', 'planned-tweak', '2026-07-20');
wlState.planByIssueId.set(plannedTweak.id, '2026-07-24');
wlApplyData([plannedTweak], '2026-07-15T12:00:00Z');
check(wlState.tweaksNeeded.map(row => row.id).includes(plannedTweak.id)
    && ![...wlState.calendarByDate.values()].flat().map(row => row.id).includes(plannedTweak.id),
  'a saved plan override never breaks tweak-bucket exclusivity');
wlState.planByIssueId.clear();

const steady = issue('To Do', 'steady-auto', '2026-07-24');
wlApplyData([steady], '2026-07-15T12:00:00Z');
const steadyDate = wlDisplayDate(steady);
const urgent = issue('To Do', 'new-urgent', '2026-07-15');
wlApplyData([steady, urgent], '2026-07-15T12:00:00Z');
check(steadyDate === '2026-07-23'
    && wlDisplayDate(steady) === steadyDate
    && (wlState.calendarByDate.get(steadyDate) || []).some(row => row.id === steady.id)
    && (wlState.calendarByDate.get('2026-07-15') || []).some(row => row.id === urgent.id),
  'adding urgent work never reflows an existing item-local automatic placement');

console.log('\nWorkload placement, deadline, and weighted-capacity signals');
const visualAuto = issue('To Do', 'visual-auto', '2026-07-15');
// Due 2026-07-22 (Wed) is 3 WORKING days after the 2026-07-17 (Fri) rollup day
// — green — while visualAuto's past due date stays red, keeping this a mixed
// red/green group under working-day buffers.
const visualManual = issue('To Do', 'visual-manual', '2026-07-22');
wlState.planByIssueId.set(visualManual.id, '2026-07-17');
const manualOriginHtml = wlPlanOriginHtml('manual', false);
const mixedOriginHtml = wlGroupPlanOriginHtml([visualAuto, visualManual]);
check(wlPlacementLabel('auto') === 'Automatically planned'
    && wlPlacementLabel('manual') === 'Manually planned'
    && wlPlacementLabel('fallback', false) === 'Deadline fallback'
    && /aria-label="Manually planned"/.test(manualOriginHtml)
    && /data-tip="Manual plan:/.test(manualOriginHtml)
    && manualOriginHtml.replace(/<[^>]+>/g, '').trim() === ''
    && /automatically planned/.test(mixedOriginHtml)
    && /manually planned/.test(mixedOriginHtml)
    && !/>Auto planned</.test(mixedOriginHtml)
    && !/>Manual planned</.test(mixedOriginHtml),
  'placement origin uses quiet accessible sparkle/pin icons instead of text pills');
check(wlGroupPlacementMode([visualAuto]) === 'auto'
    && wlGroupPlacementMode([visualManual]) === 'manual'
    && wlGroupPlacementMode([visualAuto, visualManual]) === 'mixed',
  'collapsed client groups still derive automatic, manual, or mixed placement truthfully');

// Buffers are WORKING days from plan to due (Saturdays/Sundays skipped).
const planDay = '2026-07-13'; // Monday — Tue/Wed/Thu/Fri give 1/2/3/4 working days
const dueTomorrow = wlDeadlineMeta('2026-07-14', planDay, 'Due'); // Tue: 1
const dueInTwo = wlDeadlineMeta('2026-07-15', planDay, 'Due');    // Wed: 2
const dueInThree = wlDeadlineMeta('2026-07-16', planDay, 'Due');  // Thu: 3
const dueLater = wlDeadlineMeta('2026-07-17', planDay, 'Due');    // Fri: 4
const plannedLate = wlDeadlineMeta('2026-07-10', planDay, 'Due'); // prev Fri: 1 working day late
const sameDay = wlDeadlineMeta(planDay, planDay, 'Due');
// The weekend-skip case: a Friday plan with a Monday due date is 1 working
// day of buffer, not 3 calendar days.
const acrossWeekend = wlDeadlineMeta('2026-07-20', '2026-07-17', 'Due'); // Fri→Mon: 1
check(dueTomorrow.tone === 'orange' && dueTomorrow.days === 1 && /1d buffer/.test(dueTomorrow.label)
    && dueInTwo.tone === 'orange' && dueInTwo.days === 2 && /2d buffer/.test(dueInTwo.label)
    && dueInThree.tone === 'green' && dueInThree.days === 3 && /3d buffer/.test(dueInThree.label)
    && dueLater.tone === 'green' && dueLater.days === 4 && /4d buffer/.test(dueLater.label)
    && plannedLate.tone === 'red' && plannedLate.days === -1 && /plan 1d late/.test(plannedLate.label)
    && sameDay.tone === 'red' && sameDay.days === 0 && /same day/.test(sameDay.label)
    && acrossWeekend.days === 1 && acrossWeekend.tone === 'orange' && /1d buffer/.test(acrossWeekend.label)
    && !/wlTodayISO\(/.test(grabFunc('wlDeadlineMeta')),
  'deadline proximity counts working days from plan to due (Fri→Mon is 1d, not 3), never from today');
const redGroup = wlGroupDeadlineSummary([
  issue('To Do', 'red-a', '2026-07-15'),
  issue('To Do', 'red-b', '2026-07-14'),
]);
const mixedGroup = wlGroupDeadlineSummary([visualManual, visualAuto]);
const missingGroup = wlGroupDeadlineSummary([visualAuto, issue('To Do', 'no-deadline', null)]);
check(/wl-deadline-tag is-red/.test(wlDeadlineTagHtml('2026-07-15', '2026-07-15', 'Due'))
    && /data-tip="Red:/.test(wlDeadlineTagHtml('2026-07-15', '2026-07-15', 'Due'))
    && redGroup.tone === 'red' && redGroup.mixed === false
    && mixedGroup.tone === '' && mixedGroup.mixed === true
    && missingGroup.tone === '' && missingGroup.mixed === true
    && /is-red/.test(wlGroupDeadlineHtml(redGroup.tone ? [issue('To Do', 'red-c', '2026-07-15')] : []))
    && /wl-deadline-dot/.test(wlGroupDeadlineHtml(redGroup.tone ? [issue('To Do', 'red-d', '2026-07-15')] : []))
    && /data-tip="Red proximity:/.test(wlGroupDeadlineHtml(redGroup.tone ? [issue('To Do', 'red-tip', '2026-07-15')] : []))
    && !/<svg/.test(wlGroupDeadlineHtml(redGroup.tone ? [issue('To Do', 'red-e', '2026-07-15')] : []))
    && wlGroupDeadlineHtml([visualManual, visualAuto]) === '',
  'sub-issues own proximity color and only a homogeneous group inherits one quiet color dot');

wlState.workloadByIssueId = new Map([
  [visualAuto.id, { label: '2\u00d7 Workload', weight: 2, color: '#ff9f43' }],
  [visualManual.id, { label: '3\u00d7 Workload', weight: 3, color: '#ff5c6c' }],
  ['invalid-weight', { label: '4\u00d7 Workload', weight: 4, color: '#000000' }],
]);
const invalidWeight = issue('To Do', 'invalid-weight', '2026-07-20');
const twoBadge = wlWorkloadBadgeHtml(visualAuto, false);
const threeCompactBadge = wlWorkloadBadgeHtml(visualManual, true);
const allExtraHtml = wlGroupWorkloadHtml([visualAuto, visualManual]);
const someExtraHtml = wlGroupWorkloadHtml([visualAuto, invalidWeight]);
const groupExtraVisibleText = html => html.replace(/<[^>]+>/g, '').trim();
check(wlWorkloadWeight(visualAuto) === 2
    && wlWorkloadWeight(visualManual) === 3
    && wlWorkloadWeight(invalidWeight) === 1
    && wlWorkloadUnits([visualAuto, visualManual, invalidWeight]) === 6
    && twoBadge.includes('2\u00d7 Workload')
    && twoBadge.includes('counts as 2 videos for capacity')
    && twoBadge.includes('data-tip=')
    && threeCompactBadge.includes('>3\u00d7</span>')
    && threeCompactBadge.includes('3\u00d7 Workload; counts as 3 videos for capacity')
    && /class="wl-workload-group is-all"/.test(allExtraHtml)
    && /data-tip="All sub-issues use extra workload: 1 at 2\u00d7 Workload, 1 at 3\u00d7 Workload\./.test(allExtraHtml)
    && (allExtraHtml.match(/class="wl-workload-group/g) || []).length === 1
    && groupExtraVisibleText(allExtraHtml) === ''
    && /class="wl-workload-group is-some"/.test(someExtraHtml)
    && /Some sub-issues use extra workload/.test(someExtraHtml)
    && wlGroupWorkloadHtml([invalidWeight]) === '',
  'exact 2\u00d7 and 3\u00d7 metadata keeps item detail while groups collapse to one some/all extra-work icon');
wlState.planByIssueId.clear();

const wlAddDays = compile('wlAddDays', { wlParseISO, wlISO });
const wlIsWeekend = compile('wlIsWeekend');
const wlSortSubIssues = compile('wlSortSubIssues');
check(wlWeekMondayISO('2026-07-20') === '2026-07-20'
    && wlWeekMondayISO('2026-07-22') === '2026-07-20'
    && wlWeekMondayISO('2026-07-26') === '2026-07-20',
  'Week always normalizes Monday, a midweek day, and Sunday to the same Monday start');
wlState.weekStart = dueDate;
wlState.calendarByDate = new Map([[dueDate, videoRows]]);
const renderWeekGrid = compile('renderWeekGrid', {
  wlState,
  wlWorkloadTodayISO: () => '2026-07-19',
  wlAddDays,
  wlParseISO,
  wlEscape: value => String(value),
  wlPassesFilters: () => true,
  wlGroupRollups: subs => subs,
  wlDayOverCapacity,
  renderDayRollups: groups => groups.map(row => row.id).join('|'),
});
const weekHtml = renderWeekGrid();
check(/class="workload-day over-capacity" data-wl-day="2026-07-20"/.test(weekHtml)
    && weekHtml.includes('<span class="workload-day-count">6</span>')
    && !weekHtml.includes('workload-day-count over-capacity')
    && !weekHtml.includes('6 · over'),
  'an overloaded automatic work-day column keeps normal day styling and a neutral item count');

const renderFilteredWeekGrid = compile('renderWeekGrid', {
  wlState,
  wlWorkloadTodayISO: () => '2026-07-19',
  wlAddDays,
  wlParseISO,
  wlEscape: value => String(value),
  wlPassesFilters: row => row.id === 'video-0',
  wlGroupRollups: subs => subs,
  wlDayOverCapacity,
  renderDayRollups: groups => groups.map(row => row.id).join('|'),
});
const filteredWeekHtml = renderFilteredWeekGrid();
check(/class="workload-day" data-wl-day="2026-07-20"/.test(filteredWeekHtml)
    && filteredWeekHtml.includes('>1</span>')
    && !/class="workload-day over-capacity" data-wl-day="2026-07-20"/.test(filteredWeekHtml),
  'a filtered day is not marked over capacity because of hidden rows');

const filteredTodayRollups = compile('wlTodayRollups', {
  wlState,
  wlPassesFilters: row => row.id === 'video-0',
  wlGroupRollups: subs => subs,
  wlDayOverCapacity,
});
const filteredToday = filteredTodayRollups(dueDate);
check(filteredToday.count === 1 && filteredToday.overCapacity === false,
  'today overload also uses only the rows visible under current filters');

wlState.year = 2026;
wlState.month = 6;
const renderFilteredMonthGrid = compile('renderMonthGrid', {
  wlState,
  wlWorkloadTodayISO: () => '2026-07-19',
  wlISO,
  wlIsWeekend,
  wlTodayRollups: () => ({ groups: [], count: 0, overCapacity: false }),
  wlPassesFilters: row => row.id === 'video-0',
  wlGroupRollups: subs => subs,
  wlDayOverCapacity,
  renderDayRollups: groups => groups.map(row => row.id).join('|'),
  wlEscape: value => String(value),
});
const filteredMonthHtml = renderFilteredMonthGrid();
check(!/class="workload-day over-capacity" data-wl-day="2026-07-20"/.test(filteredMonthHtml),
  'month overload also ignores rows hidden by current filters');

const weekendDue = issue('To Do', 'weekend-due', '2026-07-25');
const weekendPlan = issue('To Do', 'weekend-plan', '2026-07-31');
wlState.planByIssueId.set(weekendPlan.id, '2026-07-26');
wlApplyData([weekendDue, weekendPlan], '2026-07-19T12:00:00Z');
wlState.weekStart = '2026-07-20';
const weekendWeekHtml = renderWeekGrid();
const wlWeekendExceptions = compile('wlWeekendExceptions', {
  wlAddDays,
  wlState,
  wlIsTweaksNeeded,
  wlPassesFilters: () => true,
  wlSortSubIssues,
});
const weekendExceptions = wlWeekendExceptions(wlState.weekStart);
check((weekendWeekHtml.match(/data-wl-day=/g) || []).length === 5
    && /class="workload-day" data-wl-day="2026-07-24"/.test(weekendWeekHtml)
    && !/data-wl-day="2026-07-2[56]"/.test(weekendWeekHtml)
    && weekendWeekHtml.includes('weekend-due')
    && !weekendWeekHtml.includes('weekend-plan')
    && weekendExceptions.dates.join(',') === '2026-07-25,2026-07-26'
    && weekendExceptions.planned.length === 1
    && weekendExceptions.planned[0].sub.id === weekendPlan.id
    && weekendExceptions.planned[0].date === '2026-07-26'
    && weekendExceptions.due.length === 1
    && weekendExceptions.due[0].sub.id === weekendDue.id
    && weekendExceptions.due[0].date === '2026-07-25'
    && weekendExceptions.rows.length === 2,
  'fixed Monday-Friday Week keeps a Saturday deadline plan on Friday and reports hidden weekend plan/due exceptions');
wlState.planByIssueId.clear();

const wlRenderPlanIssueCards = compile('wlRenderPlanIssueCards', {
  wlPlanEditingEnabled: () => true,
  _wlPlanWriteInFlight: new Map(),
  wlPlacementMode,
  wlDisplayDate,
  wlDeadlineMeta,
  wlEscape: value => String(value),
  wlWorkloadBadgeHtml,
  wlPlanOriginHtml,
  wlDeadlineTagHtml,
  wlIssueDragHandleHtml,
});
const wlRenderPlanIssueCardsReadOnly = compile('wlRenderPlanIssueCards', {
  wlPlanEditingEnabled: () => false,
  _wlPlanWriteInFlight: new Map(),
  wlPlacementMode,
  wlDisplayDate,
  wlDeadlineMeta,
  wlEscape: value => String(value),
  wlWorkloadBadgeHtml,
  wlPlanOriginHtml,
  wlDeadlineTagHtml,
  wlIssueDragHandleHtml,
});
const renderDayRollups = compile('renderDayRollups', {
  wlTeamBucket,
  wlEditorCapacity,
  wlWorkloadUnits,
  wlSortSubIssues,
  wlCompareClientGroups,
  wlDisplayName: name => name,
  wlEscape: value => String(value),
  wlPlanEditingEnabled: () => true,
  _wlPlanWriteInFlight: new Map(),
  wlGroupDeadlineSummary,
  wlRenderPlanIssueCards,
  wlGroupPlanOriginHtml,
  wlGroupWorkloadHtml,
  wlGroupDeadlineHtml,
  wlGroupDragHandleHtml,
});
const renderDayRollupsReadOnly = compile('renderDayRollups', {
  wlTeamBucket,
  wlEditorCapacity,
  wlWorkloadUnits,
  wlSortSubIssues,
  wlCompareClientGroups,
  wlDisplayName: name => name,
  wlEscape: value => String(value),
  wlPlanEditingEnabled: () => false,
  _wlPlanWriteInFlight: new Map(),
  wlGroupDeadlineSummary,
  wlRenderPlanIssueCards: wlRenderPlanIssueCardsReadOnly,
  wlGroupPlanOriginHtml,
  wlGroupWorkloadHtml,
  wlGroupDeadlineHtml,
  wlGroupDragHandleHtml,
});

const wlWeekDeadlineTracks = compile('wlWeekDeadlineTracks', {
  wlAddDays,
  wlState,
  wlPassesFilters: () => true,
  wlTeamBucket,
  wlSortSubIssues,
  wlGroupDeadlineSummary,
  wlCalendarDayDiff,
  wlDeadlineMeta,
  wlCompareClientGroups,
  wlDisplayName: name => name,
});
const wlTimelineSameDayHtml = compile('wlTimelineSameDayHtml', {
  wlDeadlineMeta,
  wlDeadlineDotHtml,
  wlEscape: value => String(value),
});
const wlRenderTimelineTrack = compile('wlRenderTimelineTrack', {
  wlPlanEditingEnabled: () => true,
  _wlPlanWriteInFlight: new Map(),
  wlDeadlineMeta,
  wlEscape: value => String(value),
  wlFormatShort,
  wlDeadlineDotHtml,
  wlGroupDeadlineHtml,
  wlGroupPlanOriginHtml,
  wlGroupWorkloadHtml,
  wlTimelineSameDayHtml,
  wlRenderPlanIssueCards,
  wlGroupDragHandleHtml,
});
const wlRenderTimelineTrackReadOnly = compile('wlRenderTimelineTrack', {
  wlPlanEditingEnabled: () => false,
  _wlPlanWriteInFlight: new Map(),
  wlDeadlineMeta,
  wlEscape: value => String(value),
  wlFormatShort,
  wlDeadlineDotHtml,
  wlGroupDeadlineHtml,
  wlGroupPlanOriginHtml,
  wlGroupWorkloadHtml,
  wlTimelineSameDayHtml,
  wlRenderPlanIssueCards: wlRenderPlanIssueCardsReadOnly,
  wlGroupDragHandleHtml,
});

console.log('\nWorkload parallel deadline tracks');
const trackStart = '2026-07-20';
const trackRows = [
  issue('To Do', 'track-same-day', '2026-07-20'),
  issue('To Do', 'track-tue-a', '2026-07-21'),
  issue('To Do', 'track-tue-b', '2026-07-21'),
  issue('To Do', 'track-fri', '2026-07-24'),
  issue('To Do', 'track-undated', null),
];
wlState.workloadByIssueId.set('track-tue-a', { label: '2\u00d7 Workload', weight: 2, color: '#ff9f43' });
wlState.calendarByDate = new Map([[trackStart, trackRows]]);
const trackEditors = wlWeekDeadlineTracks(trackStart);
const oneTrack = trackEditors[0] && trackEditors[0].tracks[0];
check(trackEditors.length === 1
    && trackEditors[0].dailySubs[0].length === 5
    && oneTrack.subs.length === 5
    && oneTrack.sameDaySubs.length === 1
    && oneTrack.endpoints.length === 2
    && oneTrack.endpoints[0].dueDate === '2026-07-21'
    && oneTrack.endpoints[0].subs.length === 2
    && oneTrack.endpoints[1].dueDate === '2026-07-24'
    && oneTrack.endpoints[1].subs.length === 1,
  'one planned client group splits truthfully into exact-date deadline subsets without inflating plan counts');
const trackHtml = wlRenderTimelineTrack(oneTrack, trackEditors[0], 1);
const readOnlyTrackHtml = wlRenderTimelineTrackReadOnly(oneTrack, trackEditors[0], 1);
const renderWeekDeadlineTimelineFixture = compile('renderWeekDeadlineTimeline', {
  wlWorkloadTodayISO: () => '2026-07-22',
  wlState,
  wlAddDays,
  wlParseISO,
  wlFormatShort,
  wlEscape: value => String(value),
  wlWeekDeadlineTracks,
  wlTeamBucket,
  wlDisplayName: name => name,
  wlEditorCapacity,
  wlWorkloadUnits,
  wlRenderTimelineTrack,
});
const weightedTimelineHtml = renderWeekDeadlineTimelineFixture();
const dueButtons = trackHtml.match(/<button type="button" class="workload-timeline-due[\s\S]*?<\/button>/g) || [];
const connectorLines = trackHtml.match(/<line\b[^>]*>/g) || [];
const connectorSvg = (trackHtml.match(/<svg class="workload-timeline-lines"[\s\S]*?<\/svg>/) || [''])[0];
const sameDayHtml = wlTimelineSameDayHtml(oneTrack);
check(connectorLines.length === oneTrack.endpoints.length
    && connectorLines.every(line => /class="workload-timeline-connector is-(?:red|orange|green)"/.test(line))
    && connectorLines.every(line => line.includes('stroke-width="1.5"'))
    && connectorLines.every(line => !/\bmarker-(?:start|mid|end)=/.test(line))
    && connectorLines.some(line => line.includes('is-orange'))
    && connectorLines.some(line => line.includes('is-green'))
    && connectorSvg
    && !/<(?:defs|marker|path|polyline)\b/.test(connectorSvg)
    && [...trackHtml.matchAll(/<line [^>]*y1="([^"]+)"/g)].every(match => match[1] === '24')
    && dueButtons.length === 2
    && dueButtons.every(button => button.includes('wl-deadline-dot')
      && !button.includes('draggable=')
      && !button.includes('data-wl-plan-drag')
      && !button.includes('data-wl-plan-group-drag'))
    && trackHtml.includes('data-wl-plan-group-drag="1"')
    && trackHtml.includes('data-wl-drag-handle="group"')
    && trackHtml.includes('2\u00d7')
    && trackHtml.includes('data-tip="Drag this entire client group to another work day."')
    && !/<summary class="workload-timeline-plan-chip[^>]*(?:draggable=|data-wl-plan-group-drag)/.test(trackHtml)
    && /also due on the planned day/.test(trackHtml)
    && !/data-wl-deadline-open="track-same-day"/.test(trackHtml),
  'toggle-on tracks use tone-aware 1.5px plain connectors and read-only due copies');
check(/class="workload-timeline-same-day is-red"/.test(sameDayHtml)
    && (sameDayHtml.match(/class="wl-deadline-dot"/g) || []).length === 1
    && /Due here/.test(sameDayHtml)
    && !/<svg\b/.test(sameDayHtml),
  'same-day due work stays on its source with the shared red proximity dot instead of a duplicate endpoint');
check(weightedTimelineHtml.includes('class="workload-grid-wrap workload-timeline-wrap"')
    && weightedTimelineHtml.includes('class="workload-timeline-header"')
    && /<div class="workload-timeline-editor-rail workload-timeline-editor-rail-head" aria-hidden="true"><\/div>/.test(weightedTimelineHtml)
    && weightedTimelineHtml.includes('class="workload-weekdays week workload-timeline-weekdays"')
    && (weightedTimelineHtml.match(/class="workload-weekday workload-timeline-weekday/g) || []).length === 5
    && /class="workload-weekday workload-timeline-weekday today"[^>]*aria-current="date"[\s\S]*?class="workload-timeline-today-marker"/.test(weightedTimelineHtml)
    && /class="workload-timeline-editor-banner workload-timeline-editor-rail"/.test(weightedTimelineHtml)
    && /<section class="workload-timeline-editor[^>]*>[\s\S]*?workload-timeline-editor-rail[\s\S]*?class="workload-timeline-day-lane"/.test(weightedTimelineHtml),
  'Plan + Due Date owns a timeline header and a sticky editor rail beside one five-day lane');
check(weightedTimelineHtml.includes('class="workload-timeline-day-total over-capacity"')
    && weightedTimelineHtml.includes('6/4 · 2 over')
    && trackRows.every(row => weightedTimelineHtml.includes(`data-wl-issue-id="${row.id}"`)),
  'Plan + Due Date uses weighted editor capacity and keeps every planned item visible');
check(/automatically planned/i.test(readOnlyTrackHtml)
    && readOnlyTrackHtml.includes('data-wl-date="2026-07-20"')
    && (readOnlyTrackHtml.match(/<line /g) || []).length === 2
    && (readOnlyTrackHtml.match(/<button type="button" class="workload-timeline-due/g) || []).length === 2
    && !readOnlyTrackHtml.includes('data-wl-drag-handle')
    && !readOnlyTrackHtml.includes('data-wl-plan-drag')
    && !readOnlyTrackHtml.includes('data-wl-plan-group-drag'),
  'Creative read-only deadline tracks keep the same plan and due relationships without drag controls');

const boundaryRow = issue('To Do', 'track-boundary', '2026-07-19');
wlState.planByIssueId.set(boundaryRow.id, trackStart);
wlState.calendarByDate = new Map([[trackStart, [boundaryRow]]]);
const boundaryTrack = wlWeekDeadlineTracks(trackStart)[0].tracks[0];
const boundaryHtml = wlRenderTimelineTrack(boundaryTrack, {
  assigneeId: boundaryRow.assigneeId,
}, 2);
check(boundaryTrack.planIndex === 0
    && boundaryTrack.endpoints[0].targetIndex === 0
    && boundaryTrack.endpoints[0].boundary === 'before'
    && /<line [^>]*y1="24"[^>]*y2="48"/.test(boundaryHtml)
    && !/\bmarker-(?:start|mid|end)=/.test(boundaryHtml)
    && /--wl-source-top:7px/.test(boundaryHtml)
    && /--wl-endpoint-top:52px/.test(boundaryHtml),
  'an out-of-week deadline at the plan edge stacks below the source and stays connected by a plain line ending before the endpoint');
check(/workload-timeline-plan-chip"[^>]*>[\s\S]*?workload-day-card-chip-main">[\s\S]*?wl-deadline-summary is-red[\s\S]*?workload-day-card-chip-name/.test(boundaryHtml)
    && !/<summary class="workload-timeline-plan-chip is-deadline-/.test(boundaryHtml),
  'Plan + Due Date puts one proximity dot before the client name without a colored source edge');
wlState.planByIssueId.delete(boundaryRow.id);

const crossTeamVideo = issue('To Do', 'track-cross-team-video', '2026-07-21');
const crossTeamGraphic = {
  ...issue('To Do', 'track-cross-team-graphic', '2026-07-22'),
  teamKey: 'GFX',
  teamName: 'Graphics',
};
wlState.calendarByDate = new Map([[trackStart, [crossTeamVideo, crossTeamGraphic]]]);
const crossTeamEditors = wlWeekDeadlineTracks(trackStart);
check(crossTeamEditors.length === 1
    && crossTeamEditors[0].tracks.length === 1
    && crossTeamEditors[0].tracks[0].subs.length === 2,
  'timeline grouping matches the existing assignee-client group-drag selector even across feed team variants');

const backward = issue('To Do', 'track-backward', '2026-07-21');
wlState.calendarByDate = new Map([['2026-07-23', [backward]]]);
const backwardTrack = wlWeekDeadlineTracks(trackStart)[0].tracks[0];
check(backwardTrack.planIndex === 3
    && backwardTrack.endpoints[0].targetIndex === 1
    && /track-backward/.test(wlRenderTimelineTrack(backwardTrack, {
      assigneeId: backward.assigneeId,
    }, 2)),
  'a manual plan after its deadline keeps the backward due relationship instead of hiding it');

wlState.planByIssueId.set(plannedTweak.id, '2026-07-22');
const timelineOrdinary = issue('To Do', 'timeline-ordinary', '2026-07-22');
wlApplyData([plannedTweak, timelineOrdinary], '2026-07-15T12:00:00Z');
const tweakSafeTracks = wlWeekDeadlineTracks(trackStart);
const trackedIds = tweakSafeTracks.flatMap(editor => editor.tracks.flatMap(track => track.subs.map(sub => sub.id)));
check(trackedIds.includes(timelineOrdinary.id) && !trackedIds.includes(plannedTweak.id),
  'deadline tracks derive only from the planned bucket and preserve tweak exclusivity');

wlState.calendarByDate = new Map([['2026-07-24', [weekendDue]]]);
const weekendBoundaryTrack = wlWeekDeadlineTracks(trackStart)[0].tracks[0];
check(weekendBoundaryTrack.planIndex === 4
    && weekendBoundaryTrack.endpoints[0].dueDate === '2026-07-25'
    && weekendBoundaryTrack.endpoints[0].targetIndex === 4
    && weekendBoundaryTrack.endpoints[0].boundary === 'after',
  'a weekend deadline remains an explicit after-Friday continuation in the five-day relationship view');

wlApplyData([pastDue, timelineOrdinary], '2026-07-15T12:00:00Z');
const overdueSafeTracks = wlWeekDeadlineTracks(trackStart);
const overdueSafeIds = overdueSafeTracks.flatMap(editor => editor.tracks.flatMap(track => track.subs.map(sub => sub.id)));
check(overdueSafeIds.includes(timelineOrdinary.id) && !overdueSafeIds.includes(pastDue.id),
  'deadline tracks inherit the calendar bucket and cannot reintroduce unpinned overdue work');
wlState.planByIssueId.clear();
const elevenEditors = Array.from({ length: 11 }, (_, i) => ({
  assigneeId: 'editor-' + i,
  assigneeName: 'Editor ' + i,
  clientName: 'Synthetic Client ' + i,
  teamKey: 'VID',
  teamName: 'Video',
  parentId: 'parent-' + i,
  anySub: { url: '#' },
  count: 1,
}));
const rollupHtml = renderDayRollups(elevenEditors, dueDate);
check((rollupHtml.match(/class="workload-day-card team-video"/g) || []).length === elevenEditors.length
    && !rollupHtml.includes('workload-day-overflow'),
  'every editor rollup remains visible instead of collapsing behind an overflow row');

const oneOverloadedEditor = [{
  assigneeId: 'editor-over',
  assigneeName: 'Editor Over',
  clientName: 'Synthetic Client',
  teamKey: 'VID',
  teamName: 'Video',
  count: 6,
  subs: Array.from({ length: 6 }, (_, i) => ({
    id: 'visible-' + i,
    identifier: 'VID-' + (i + 1),
    title: 'Synthetic work ' + (i + 1),
    clientName: 'Synthetic Client',
    parentId: 'parent-over',
    assigneeId: 'editor-over',
  })),
}];
wlState.workloadByIssueId.set('visible-0', { label: '2\u00d7 Workload', weight: 2, color: '#ff9f43' });
wlState.workloadByIssueId.set('visible-1', { label: '3\u00d7 Workload', weight: 3, color: '#ff5c6c' });
const overloadedEditorHtml = renderDayRollups(oneOverloadedEditor, dueDate);
check((overloadedEditorHtml.match(/class="workload-plan-item"/g) || []).length === 6
    && (overloadedEditorHtml.match(/class="workload-day-client-group"/g) || []).length === 1
    && !/<details class="workload-day-client-group"[^>]*\sopen(?:\s|>)/.test(overloadedEditorHtml)
    && overloadedEditorHtml.includes('class="workload-day-card-total over-capacity"')
    && overloadedEditorHtml.includes('9/4 · 5 over')
    && overloadedEditorHtml.includes('class="workload-day-card-chip"')
    && overloadedEditorHtml.includes('Synthetic Client')
    && overloadedEditorHtml.includes('· 6')
    && oneOverloadedEditor[0].subs.every(row => overloadedEditorHtml.includes(`data-wl-issue-id="${row.id}"`))
    && (overloadedEditorHtml.match(/data-wl-drag-handle="issue"/g) || []).length === 6
    && (overloadedEditorHtml.match(/data-wl-drag-handle="group"/g) || []).length === 1
    && (overloadedEditorHtml.match(/class="wl-workload-group/g) || []).length === 1
    && overloadedEditorHtml.includes('class="wl-workload-group is-some"')
    && overloadedEditorHtml.includes('2\u00d7')
    && overloadedEditorHtml.includes('3\u00d7')
    && overloadedEditorHtml.includes('data-tip="Drag this sub-issue to another work day."')
    && !/<button[^>]*class="workload-plan-item[^>]*(?:draggable=|data-wl-plan-drag)/.test(overloadedEditorHtml)
    && !/<summary[^>]*class="workload-day-card-chip[^>]*(?:draggable=|data-wl-plan-group-drag)/.test(overloadedEditorHtml)
    && !overloadedEditorHtml.includes('workload-day-overflow'),
  'one weighted overloaded client chip retains all six items and exposes drag only on dedicated handles');
check(oneOverloadedEditor[0].subs.every(row => overloadedEditorHtml.includes(`>${row.title}</span>`))
    && !overloadedEditorHtml.includes('Synthetic Client · VID-'),
  'expanded issue labels use their own titles while identifiers stay out of the visible label');
wlState.planByIssueId.set(visualManual.id, '2026-07-17');
const visualRollupHtml = renderDayRollups([{
  assigneeId: 'editor-1',
  assigneeName: 'Test Editor',
  clientName: 'Test Client',
  teamKey: 'VID',
  teamName: 'Video',
  parentId: 'parent-1',
  anySub: visualAuto,
  count: 2,
  subs: [visualAuto, visualManual],
}], '2026-07-17');
const readOnlyVisualRollupHtml = renderDayRollupsReadOnly([{
  assigneeId: 'editor-1',
  assigneeName: 'Test Editor',
  clientName: 'Test Client',
  teamKey: 'VID',
  teamName: 'Video',
  parentId: 'parent-1',
  anySub: visualAuto,
  count: 2,
  subs: [visualAuto, visualManual],
}], '2026-07-17');
check(visualRollupHtml.includes('automatically planned')
    && visualRollupHtml.includes('manually planned')
    && visualRollupHtml.includes(`data-wl-issue-id="${visualAuto.id}"`)
    && visualRollupHtml.includes(`data-wl-issue-id="${visualManual.id}"`)
    && visualRollupHtml.includes('wl-deadline-tag is-red')
    && visualRollupHtml.includes('wl-deadline-tag is-green')
    && visualRollupHtml.includes('2\u00d7')
    && visualRollupHtml.includes('3\u00d7')
    && (visualRollupHtml.match(/class="wl-workload-group/g) || []).length === 1
    && visualRollupHtml.includes('class="wl-workload-group is-all"')
    && /workload-plan-item-title-line[\s\S]*?workload-plan-item-label[\s\S]*?wl-workload-badge[\s\S]*?wl-plan-origin[\s\S]*?data-wl-drag-handle="issue"/.test(visualRollupHtml)
    && (visualRollupHtml.match(/data-wl-drag-handle="issue"/g) || []).length === 2
    && (visualRollupHtml.match(/data-wl-drag-handle="group"/g) || []).length === 1
    && !visualRollupHtml.includes('workload-plan-item-grip')
    && !/<summary class="workload-day-card-chip is-deadline-/.test(visualRollupHtml)
    && !/<button[^>]*class="workload-plan-item[^>]*is-deadline-/.test(visualRollupHtml)
    && !visualRollupHtml.includes('wl-deadline-summary')
    && !visualRollupHtml.includes('data-wl-plan-clear')
    && !visualRollupHtml.includes('workload-plan-reset')
    && !visualRollupHtml.includes('Use automatic plan'),
  'mixed client groups stay neutral while exact item tones, workload weights, and origin signals remain visible');
const visibleText = html => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
check(visibleText(readOnlyVisualRollupHtml) === visibleText(visualRollupHtml)
    && readOnlyVisualRollupHtml.includes('automatically planned')
    && readOnlyVisualRollupHtml.includes('manually planned')
    && readOnlyVisualRollupHtml.includes(`data-wl-issue-id="${visualAuto.id}"`)
    && readOnlyVisualRollupHtml.includes(`data-wl-issue-id="${visualManual.id}"`)
    && readOnlyVisualRollupHtml.includes('wl-deadline-tag is-red')
    && readOnlyVisualRollupHtml.includes('wl-deadline-tag is-green')
    && readOnlyVisualRollupHtml.includes('2\u00d7')
    && readOnlyVisualRollupHtml.includes('3\u00d7')
    && readOnlyVisualRollupHtml.includes('data-tip="Automatic plan:')
    && !readOnlyVisualRollupHtml.includes('data-wl-drag-handle')
    && !readOnlyVisualRollupHtml.includes('data-wl-plan-drag')
    && !readOnlyVisualRollupHtml.includes('data-wl-plan-group-drag'),
  'Creative sees the same calendar, workload weights, origin icons, and buffer colors while drag/edit handles stay hidden');

const homogeneousRed = issue('To Do', 'homogeneous-red', '2026-07-17');
wlState.planByIssueId.set(homogeneousRed.id, '2026-07-17');
const homogeneousRollupHtml = renderDayRollups([{
  assigneeId: 'editor-proximity',
  assigneeName: 'Test Editor',
  clientName: 'Test Client',
  teamKey: 'VID',
  teamName: 'Video',
  count: 1,
  subs: [homogeneousRed],
}], '2026-07-17');
check(/workload-day-card-chip-main">[\s\S]*?wl-deadline-summary is-red[\s\S]*?workload-day-card-chip-name">Test Client/.test(homogeneousRollupHtml)
    && (homogeneousRollupHtml.match(/wl-deadline-summary/g) || []).length === 1
    && !/<summary class="workload-day-card-chip is-deadline-/.test(homogeneousRollupHtml),
  'a homogeneous client group leads with one proximity dot and no colored chip edge');
wlState.planByIssueId.delete(homogeneousRed.id);
wlState.planByIssueId.clear();
const fallbackOrder = [
  { id: 'order-10', identifier: 'VID-10' },
  { id: 'order-2', identifier: 'VID-2' },
  { id: 'order-1', identifier: 'VID-1' },
];
const nativeRows = [
  { id: 'native-1', identifier: 'VID-1', sortOrder: 20 },
  { id: 'native-10', identifier: 'VID-10', sortOrder: 10 },
];
const partialNativeRows = [
  { id: 'partial-1', identifier: 'VID-1', sortOrder: 100 },
  { id: 'partial-2', identifier: 'VID-2' },
  { id: 'partial-3', identifier: 'VID-3', sortOrder: 1 },
];
check(wlSortSubIssues(fallbackOrder).map(row => row.identifier).join(',') === 'VID-1,VID-2,VID-10'
    && wlSortSubIssues(nativeRows).map(row => row.identifier).join(',') === 'VID-10,VID-1'
    && wlSortSubIssues(partialNativeRows).map(row => row.identifier).join(',') === 'VID-1,VID-2,VID-3',
  'client groups derive native Linear order when present, else identifier number order');
const proximityGroups = [
  { clientName: 'Later', subs: [issue('To Do', 'later-client', '2026-07-23')] },
  { clientName: 'No deadline', subs: [issue('To Do', 'undated-client', null)] },
  { clientName: 'Closest', subs: [issue('To Do', 'closest-client', '2026-07-20')] },
];
check(proximityGroups.slice().sort((a, b) => wlCompareClientGroups(a, b, '2026-07-20'))
  .map(group => group.clientName).join(',') === 'Closest,Later,No deadline',
  'client chips derive closest plan-to-due buffer first and put missing deadlines last');
const proximityRollups = proximityGroups.map(group => ({
  assigneeId: 'editor-order',
  assigneeName: 'Editor Order',
  clientName: group.clientName,
  teamKey: 'VID',
  teamName: 'Video',
  count: 1,
  subs: group.subs.map(sub => ({
    ...sub,
    assigneeId: 'editor-order',
    assigneeName: 'Editor Order',
    clientName: group.clientName,
  })),
}));
const proximityRollupHtml = renderDayRollups(proximityRollups, '2026-07-20');
check(proximityRollupHtml.indexOf('Closest') < proximityRollupHtml.indexOf('Later')
    && proximityRollupHtml.indexOf('Later') < proximityRollupHtml.indexOf('No deadline'),
  'Plan-only rendering derives client-chip proximity order instead of storing a manual order');
const wlGroupRollups = compile('wlGroupRollups', { wlDisplayName: name => name });
const mergedGroup = wlGroupRollups([
  { ...oneOverloadedEditor[0].subs[0], id: 'source-row' },
  { ...oneOverloadedEditor[0].subs[1], id: 'target-row' },
]);
check(mergedGroup.length === 1 && mergedGroup[0].count === 2 && mergedGroup[0].subs.length === 2,
  'same-editor same-client rows derive one merged client chip after a move');
const overloadedGraphicsHtml = renderDayRollups([{
  ...oneOverloadedEditor[0],
  teamKey: 'GRA',
  teamName: 'Graphics',
  count: 16,
  subs: Array.from({ length: 16 }, (_, i) => ({
    ...oneOverloadedEditor[0].subs[0],
    id: 'graphic-visible-' + i,
    identifier: 'GRA-' + (i + 1),
    title: 'Synthetic graphic ' + (i + 1),
  })),
}], dueDate);
check(overloadedGraphicsHtml.includes('class="workload-day-card-total over-capacity"')
    && overloadedGraphicsHtml.includes('16/15 · 1 over'),
  'graphics overload is shown on its editor against the 15-item threshold');

const loadingPlanStatus = { hidden: false, className: '', textContent: 'old' };
const planStatusState = { planStatus: 'loading' };
const paintPlanStatus = compile('renderWorkloadPlanStatus', {
  document: { getElementById: () => loadingPlanStatus },
  wlState: planStatusState,
});
paintPlanStatus();
planStatusState.planStatus = 'refreshing';
loadingPlanStatus.hidden = false;
loadingPlanStatus.textContent = 'old';
paintPlanStatus();
const workloadSkeletonHtml = compile('_svWorkloadSkeletonHtml', {
  wlState: { viewMode: 'week' },
  _svSkel: (classes, style) => `<span class="sv-skeleton ${classes}" style="${style}"></span>`,
})();
const workloadRenderSource = grabFunc('renderWorkloadAll');
const workloadLoadSource = grabFunc('wlLoadSnapshot');
const workloadInitSource = grabFunc('initWorkloadView');
const workloadBackgroundSource = grabFunc('wlRefetchSilent');
const workloadVisibilitySource = grabFunc('_wlOnVisibilityChange');
check(loadingPlanStatus.hidden === true
    && loadingPlanStatus.textContent === ''
    && !INDEX.includes('Loading saved work days…')
    && !INDEX.includes('Refreshing saved work days')
    && /wlState\.planStatus === 'loading' \|\| wlState\.planStatus === 'refreshing'/.test(workloadRenderSource)
    && /_svLoadingSkeletonHtml\('workload'\)/.test(workloadRenderSource)
    && /renderWorkloadAll\(\);/.test(workloadLoadSource)
    && !workloadLoadSource.includes('deferWhilePopoverOpen')
    && /await wlLoadSnapshot\(true, null\)/.test(grabFunc('wlManualRefresh'))
    && /hasWarmSnapshot[\s\S]*renderWorkloadAll\(\)[\s\S]*_wlV2CheckWatermark\(\)[\s\S]*return/.test(workloadInitSource)
    && /await wlLoadSnapshot\(false, cache\)/.test(workloadInitSource)
    && !/wlState\.(?:loading|refreshing)\s*=/.test(workloadBackgroundSource)
    && !/planStatus\s*=\s*['"](?:loading|refreshing)['"]/.test(workloadBackgroundSource)
    && /_wlV2CheckWatermark\(\)/.test(grabFunc('_wlV2OnRealtimeChange'))
    && /_wlV2CheckWatermark\(\)/.test(workloadVisibilitySource)
    && (workloadSkeletonHtml.match(/class="workload-skeleton-day"/g) || []).length === 5
    && workloadSkeletonHtml.includes('aria-label="Loading saved work days"')
    && workloadSkeletonHtml.includes('class="sv-skeleton-row"')
    && workloadSkeletonHtml.includes('sv-skeleton-line')
    && workloadSkeletonHtml.includes('sv-skeleton-pill'),
  'only cold and manual foreground loads use the five-day skeleton; warm, visibility, and realtime paths stay painted');

const watermarkFetchSource = grabFunc('_wlV2FetchLatestWatermark');
const watermarkCheckSource = grabFunc('_wlV2CheckWatermark');
const watermarkPollSource = grabFunc('_wlV2EnsureWatermarkPoll');
const workloadTeardownSource = grabFunc('_wlV2Teardown');
check(/select=synced_at&active=eq\.true&order=synced_at\.desc&limit=1/.test(watermarkFetchSource)
    && /cache: 'no-store'/.test(watermarkFetchSource)
    && /Array\.isArray\(rows\)[\s\S]*rows\[0\][\s\S]*synced_at/.test(watermarkFetchSource),
  'the foreground staleness probe reads the newest active mirror watermark without using cached HTTP state');
check(/_wlV2WatermarkBusy \|\| document\.hidden \|\| !document\.querySelector\('\.workload-view'\)/.test(watermarkCheckSource)
    && /wlState\.loading \|\| wlState\.refreshing \|\| wlState\.planStatus === 'loading' \|\| wlState\.planStatus === 'refreshing'/.test(watermarkCheckSource)
    && /const latest = await _wlV2FetchLatestWatermark\(\)/.test(watermarkCheckSource)
    && /if \(!wlState\.sourceSyncedAt\)[\s\S]*wlState\.sourceSyncedAt = latest[\s\S]*return/.test(watermarkCheckSource)
    && /Date\.parse\(latest\) > Date\.parse\(wlState\.sourceSyncedAt\)[\s\S]*await wlRefetchSilent\(\)/.test(watermarkCheckSource)
    && /refreshed === true[\s\S]*wlState\.sourceSyncedAt = latest/.test(watermarkCheckSource)
    && /_wlV2FetchIssues\(\)/.test(workloadBackgroundSource)
    && /wlFetchPlanRows\(\)/.test(workloadBackgroundSource)
    && /wlFetchLinearMetadata\(freshIssues\)/.test(workloadBackgroundSource)
    && !/loadLinearIssues|wlLoadSnapshot|LINEAR_ISSUES_WEBHOOK/.test(workloadBackgroundSource)
    && /finally[\s\S]*_wlV2WatermarkBusy = false/.test(watermarkCheckSource),
  'watermark polling consumes complete no-diff snapshots through the Supabase/Edge-only background lane');
check(/!_wlV2Ready\(\) \|\| _wlV2WatermarkTimer/.test(watermarkPollSource)
    && /setInterval\(_wlV2CheckWatermark, WL_V2_WATERMARK_POLL_MS\)/.test(watermarkPollSource)
    && /_wlV2EnsureWatermarkPoll\(\)/.test(grabFunc('initWorkloadView'))
    && /clearInterval\(_wlV2WatermarkTimer\)/.test(workloadTeardownSource)
    && /_wlV2WatermarkTimer = null/.test(workloadTeardownSource)
    && /_wlV2WatermarkBusy = false/.test(workloadTeardownSource),
  'one 60-second watermark poll starts with Workload and teardown always clears its timer and busy state');

const nativeDuePublishSource = grabFunc('wlPublishNativeDueReceipt');
const nativeDueStorageSource = grabFunc('_wlOnNativeDueReceiptStorage');
const nativeDueParseSource = grabFunc('wlParseNativeDueReceipt');
const nativeDueDispositionSource = grabFunc('wlNativeDueReceiptDisposition');
const nativeDueRetrySource = grabFunc('wlRetryPendingNativeDueReceipts');
const dueWriteSource = grabFunc('wlSetDueDate');
const planWriteSource = grabFunc('wlSetPlanDate');
const planGroupWriteSource = grabFunc('wlMovePlanGroup');
check(/schema:\s*WL_NATIVE_DUE_RECEIPT_SIGNAL_SCHEMA/.test(nativeDuePublishSource)
    && /native_committed:\s*true/.test(nativeDuePublishSource)
    && /localStorage\.setItem\(WL_NATIVE_DUE_RECEIPT_SIGNAL_KEY,\s*payload\)/.test(nativeDuePublishSource)
    && /localStorage\.removeItem\(WL_NATIVE_DUE_RECEIPT_SIGNAL_KEY\)/.test(nativeDuePublishSource)
    && /if \(exactNativeAck\)[\s\S]*wlAdoptNativeDueGatewayRow\(row\)[\s\S]*wlPublishNativeDueReceipt\(row\)/.test(dueWriteSource),
  'only an exact adopted native gateway row emits the ephemeral sibling-tab due receipt');
check(/event\.key !== WL_NATIVE_DUE_RECEIPT_SIGNAL_KEY/.test(nativeDueStorageSource)
    && /wlParseNativeDueReceipt\(event\.newValue\)/.test(nativeDueStorageSource)
    && /_wlPendingNativeDueReceiptByTarget\.set\(key,\s*receipt\)/.test(nativeDueStorageSource)
    && /wlRetryPendingNativeDueReceipts\(\)/.test(nativeDueStorageSource)
    && /receipt\.schema !== WL_NATIVE_DUE_RECEIPT_SIGNAL_SCHEMA/.test(nativeDueParseSource)
    && /receipt\.native_committed !== true \|\| receipt\.authority !== 'syncview'/.test(nativeDueParseSource)
    && /nativeDueTargetByIssueId/.test(nativeDueDispositionSource)
    && /dueAuthorityByIssueId/.test(nativeDueDispositionSource)
    && /targetUpdatedAt === row\.updated_at && currentDue === row\.due_date/.test(nativeDueDispositionSource)
    && /Date\.parse\(targetUpdatedAt\) > Date\.parse\(row\.updated_at\)/.test(nativeDueDispositionSource)
    && /_wlPlanWriteInFlight\.size \|\| _wlDueWriteInFlight\.size \|\| _wlBackgroundRefreshPromise/.test(nativeDueRetrySource)
    && /wlRefetchSilent\(\{\s*sensitiveOnly:\s*true\s*\}\)/.test(nativeDueRetrySource)
    && /disposition === 'consumed' \|\| disposition === 'discard'/.test(nativeDueRetrySource)
    && /_wlBackgroundRefreshPromise = null;[\s\S]*wlScheduleNativeDueReceiptRetry\(\)/.test(workloadBackgroundSource)
    && /_wlDueWriteInFlight\.delete\(key\);[\s\S]*wlScheduleNativeDueReceiptRetry\(\)/.test(dueWriteSource)
    && /_wlPlanWriteInFlight\.delete\(key\);[\s\S]*wlScheduleNativeDueReceiptRetry\(\)/.test(planWriteSource)
    && /_wlPlanWriteInFlight\.delete\(move\.key\);[\s\S]*wlScheduleNativeDueReceiptRetry\(\)/.test(planGroupWriteSource)
    && !/_wlV2CheckWatermark|_wlV2FetchLatestWatermark|_wlV2FetchIssues|loadLinearIssues|LINEAR_ISSUES_WEBHOOK/.test(
      nativeDueStorageSource + nativeDueRetrySource)
    && /window\.addEventListener\('storage',\s*_wlOnNativeDueReceiptStorage\)/.test(INDEX),
  'a bound sibling receipt stays pending across in-flight work and re-reads guarded native metadata without the feeder watermark or inactive bridge');

const workloadShellSource = grabFunc('renderWorkloadShell');
const overviewIndex = workloadShellSource.indexOf('id="wlOverview"');
const calendarModuleIndex = workloadShellSource.indexOf('class="workload-calendar-module"');
const undatedIndex = workloadShellSource.indexOf('id="wlUndated"');
const unassignedIndex = workloadShellSource.indexOf('id="wlUnassigned"');
const toolbarIndex = workloadShellSource.indexOf('class="workload-toolbar"');
const calendarHeadingIndex = workloadShellSource.indexOf('class="workload-calendar-heading"');
const calendarBodyIndex = workloadShellSource.indexOf('id="wlBody"');
const clientFilterIndex = workloadShellSource.indexOf('id="wlClientSearchInput"');
const deadlineModeIndex = workloadShellSource.indexOf('class="workload-pills workload-deadline-mode"');
check((workloadShellSource.match(/class="workload-toolbar"/g) || []).length === 1
    && overviewIndex < toolbarIndex
    && calendarModuleIndex < calendarHeadingIndex
    && calendarHeadingIndex < toolbarIndex
    && toolbarIndex < calendarBodyIndex
    && calendarBodyIndex < unassignedIndex
    && unassignedIndex < undatedIndex
    && clientFilterIndex < deadlineModeIndex
    && ['prev', 'today', 'next'].every(value => workloadShellSource.includes(`data-wl-nav="${value}"`))
    && ['week', 'month'].every(value => workloadShellSource.includes(`data-wl-view="${value}"`)),
  'the intact period toolbar lives inside the calendar module, with undated work at the bottom');
check(/\.workload-calendar-module \{[^}]*overflow: visible[^}]*border: 1px solid var\(--border\)/.test(INDEX)
    && /\.workload-calendar-module #wlBody > \.workload-grid-wrap \{[^}]*border: 0[^}]*padding: 0[^}]*background: transparent/.test(INDEX)
    && /class="workload-calendar-heading"[\s\S]*?<h2>Work-day calendar<\/h2>/.test(workloadShellSource)
    && !workloadShellSource.includes('id="wlFreshness"')
    && !workloadShellSource.includes('id="wlCalendarHint"')
    && !INDEX.includes('Sparkle means automatic')
    && !INDEX.includes("'As of '")
    && !INDEX.includes('CONTENT_REVISION_WEBHOOK')
    && !INDEX.includes('content-ready')
    && !INDEX.includes('openRevisionModal')
    && !INDEX.includes('Content revision email'),
  'the calendar owns one unclipped control shell and the client-email sender is absent');

const weekendNoticeSource = grabFunc('renderWorkloadWeekendNotice');
check(workloadShellSource.includes('id="wlWeekendNotice"')
    && workloadShellSource.includes('id="wlWeekendNoticePanel"')
    && /exceptions\.planned\.length[\s\S]*exceptions\.due\.length/.test(weekendNoticeSource)
    && /row\.roles\.join\(' \+ '\)/.test(weekendNoticeSource)
    && /renderWorkloadWeekendNotice\(\)/.test(workloadRenderSource),
  'the calendar exposes one compact weekend notice with exact planned/due counts and a deduplicated detail panel');

const toolbarSource = grabFunc('wlWireToolbar');
const overviewSource = grabFunc('renderWorkloadOverviewMatrix');
check(!(workloadShellSource.includes('data-wl-section-toggle=') || overviewSource.includes('data-wl-section-panel'))
    && workloadShellSource.includes('class="workload-overview-matrix empty"')
    && ['overdue', 'inprogress', 'tweaks'].every(key => overviewSource.includes(`key: '${key}'`))
    && !toolbarSource.includes('sectionToggle')
    && !toolbarSource.includes('WL_SECTION_PREF_KEY')
    && !overviewSource.includes("' hidden'")
    && /workload-overview-status-clients[^>]*>\$\{chips\}/.test(overviewSource),
  'overdue, in-progress, and tweaks stay visible in the editor matrix without collapse controls');

const deadlineStorage = new Map();
const deadlineLocalStorage = {
  getItem: key => deadlineStorage.has(key) ? deadlineStorage.get(key) : null,
};
const deadlinePrefKey = 'syncview_workloadDeadlineOverlay_v1';
const wlReadDeadlinePref = compile('wlReadDeadlinePref', {
  localStorage: deadlineLocalStorage,
  WL_DEADLINE_PREF_KEY: deadlinePrefKey,
});
check(wlReadDeadlinePref() === false
    && (deadlineStorage.set(deadlinePrefKey, '0'), wlReadDeadlinePref() === false)
    && (deadlineStorage.set(deadlinePrefKey, 'invalid'), wlReadDeadlinePref() === false)
    && (deadlineStorage.set(deadlinePrefKey, '1'), wlReadDeadlinePref() === true)
    && (workloadShellSource.match(/data-wl-deadline-mode=/g) || []).length === 2
    && /class="workload-pills workload-deadline-mode" role="tablist" aria-label="Plan and due date display"/.test(workloadShellSource)
    && /data-wl-deadline-mode="plan"[^>]*>Plan only</.test(workloadShellSource)
    && /data-wl-deadline-mode="deadlines"[^>]*>Plan \+ Due Date</.test(workloadShellSource)
    && !workloadShellSource.includes('data-wl-deadline-toggle')
    && !workloadShellSource.includes('tpl-toggle-mini workload-deadline-toggle')
    && /localStorage\.setItem\(WL_DEADLINE_PREF_KEY,\s*wlState\.showDeadlines \? '1' : '0'\)/.test(toolbarSource)
    && /mode === 'month' && wlState\.showDeadlines/.test(toolbarSource)
    && /wlState\.showDeadlines = deadlineMode\.getAttribute\('data-wl-deadline-mode'\) === 'deadlines'/.test(toolbarSource)
    && /wlState\.showDeadlines \? renderWeekDeadlineTimeline\(\) : renderWeekGrid\(\)/.test(workloadRenderSource),
  'the Plan only / Plan + Due Date segmented control sits after All clients, persists, stays Week-only, and switches views');
check(INDEX.includes("grid.querySelectorAll('.workload-timeline-due, .workload-timeline-lines [data-wl-deadline-ids]')")
    && INDEX.includes('.workload-timeline-due[data-wl-match="1"]')
    && INDEX.includes('[data-wl-deadline-ids][data-wl-match="1"]'),
  'deadline endpoint spotlight keeps the clicked due copy and its exact connector visible');

const popoverSource = grabFunc('wlOpenRollupPopover');
check(popoverSource.includes('Open Linear →')
    && !popoverSource.includes('Open parent')
    && !popoverSource.includes('workload-popover-item-due')
    && !popoverSource.includes('workload-popover-plan-arrow')
    && !popoverSource.includes('workload-popover-plan-due')
    && !popoverSource.includes('workload-popover-plan-meta')
    && !popoverSource.includes('Uses deadline')
    && /workload-popover-plan-line[\s\S]*?>Due date<[\s\S]*?_svDateHtml\(dateId, s\.dueDate \|\| ''[\s\S]*?disabled: !canEditDue[\s\S]*?explicitPlan[\s\S]*?Use automatic plan/.test(popoverSource)
    && popoverSource.includes('wlWorkloadBadgeHtml(s, false)')
    && popoverSource.includes('wlDeadlineTagHtml(s.dueDate, workDate)')
    && /const planControl = wlIsTweaksNeeded\(s\) \? ''/.test(popoverSource)
    && popoverSource.includes('wl-tweak-comments'),
  'direct pinned-item popovers show workload weight, one authority-routed due date, and the manual-plan reset');

const staffCanSource = grabFunc('_syncviewStaffCan');
check(/capability === 'workload-linear-read'[\s\S]*role === 'admin' \|\| role === 'smm' \|\| role === 'creative'/.test(staffCanSource)
    && /capability === 'workload-linear'[\s\S]*role === 'admin' \|\| role === 'smm'/.test(staffCanSource)
    && /capability === 'workload-plan'[\s\S]*role === 'admin' \|\| role === 'smm'/.test(staffCanSource)
    && /wlPlanEditingEnabled\(\)[\s\S]*wlIssueDragHandleHtml\(issueId, canDrag\)/.test(grabFunc('wlRenderPlanIssueCards')),
  'Creative reads the same plan and workload metadata but Admin/SMM alone receive due-date or drag editing controls');

check(INDEX.includes('function wlAutoPlanDate(')
    && INDEX.includes('function wlPlacementMode(')
    && INDEX.includes("const WL_WORKLOAD_TIME_ZONE = 'America/Guatemala';")
    && /wlWorkloadTodayISO\(\)/.test(grabFunc('wlAutoPlanDate'))
    && ['initWorkloadView', 'wlApplyData', 'wlWireToolbar', 'renderWeekDeadlineTimeline', 'renderWeekGrid', 'renderMonthGrid']
      .every(name => /wlWorkloadTodayISO\(\)/.test(grabFunc(name)))
    && !['wlAutoPlanDate', 'initWorkloadView', 'wlApplyData', 'wlWireToolbar', 'renderWeekDeadlineTimeline', 'renderWeekGrid', 'renderMonthGrid']
      .some(name => /wlTodayISO\(\)/.test(grabFunc(name)))
    && !INDEX.includes('function wlEffectiveWorkDate(')
    && !INDEX.includes('function scheduleAll(')
    && !INDEX.includes('effectiveWorkDate')
    && !INDEX.includes('scheduledDate'),
  'hybrid source uses one company policy day and the bounded auto-plan helper without restoring scheduler state');
check(!INDEX.includes('.workload-day.over-capacity')
    && INDEX.includes('.workload-day-card-total.over-capacity')
    && !INDEX.includes('.workload-day-count.over-capacity')
    && !INDEX.includes("'Plan ' + wlFormatShort"),
  'source guard keeps overload styling on the editor pill only');
check(INDEX.includes('<details class="workload-day-client-group">')
    && INDEX.includes('<summary class="workload-day-card-chip')
    && INDEX.includes('data-wl-plan-group-drag="1"')
    && INDEX.includes('data-wl-drag-handle="group"')
    && !/<summary class="workload-day-card-chip[^>]*(?:draggable=|data-wl-plan-group-drag)/.test(INDEX)
    && !/<button type="button" class="workload-plan-item[^>]*(?:draggable=|data-wl-plan-drag)/.test(INDEX)
    && !INDEX.includes('workload-plan-item-grip')
    && !INDEX.includes('<details class="workload-day-client-group" open>'),
  'calendar hierarchy stays collapsed while only dedicated six-dot handles own drag behavior');
check(INDEX.includes('.workload-drag-handle {')
    && /\.workload-drag-handle \{[^}]*cursor: grab/.test(INDEX)
    && /\.workload-plan-item \{[^}]*cursor: pointer/.test(INDEX)
    && /\.workload-day-card-chip \{[^}]*cursor: pointer/.test(INDEX)
    && /\.workload-timeline-plan-chip \{[^}]*cursor: pointer/.test(INDEX)
    && !INDEX.includes('.workload-plan-item[draggable="true"]')
    && !INDEX.includes('.workload-day-card-chip[draggable="true"]')
    && !INDEX.includes('.workload-timeline-plan-chip[draggable="true"]'),
  'grab and grabbing cursors belong only to the dedicated drag handle');
const weekGridSource = grabFunc('renderWeekGrid');
const deadlineTracksSource = grabFunc('wlWeekDeadlineTracks');
const resolveDropDayStart = toolbarSource.indexOf('const resolveDropDay =');
const resolveDropDayEnd = toolbarSource.indexOf('const clearDragState', resolveDropDayStart);
const resolveDropDaySource = resolveDropDayStart >= 0 && resolveDropDayEnd > resolveDropDayStart
  ? toolbarSource.slice(resolveDropDayStart, resolveDropDayEnd)
  : '';
function cssRuleBodies(selector) {
  return [...INDEX.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match => match[1].split(',').some(part => part.trim().endsWith(selector)))
    .map(match => match[2])
    .join(' ');
}
const timelineHeaderRule = cssRuleBodies('.workload-timeline-header');
const timelineWrapRule = cssRuleBodies('.workload-timeline-wrap');
const timelineEditorRule = cssRuleBodies('.workload-timeline-editor');
const timelineRailRule = cssRuleBodies('.workload-timeline-editor-rail');
const timelineWeekdaysRule = cssRuleBodies('.workload-timeline-weekdays');
const timelineDayLaneRule = cssRuleBodies('.workload-timeline-day-lane');
const timelineDayColumnsRule = cssRuleBodies('.workload-timeline-day-columns');
const timelineEditorHeadRule = cssRuleBodies('.workload-timeline-editor-head');
const timelineRelationshipRule = cssRuleBodies('.workload-timeline-relationship');
const timelineTodayRule = cssRuleBodies('.workload-timeline-day.today');
const timelineTodayMarkerRule = cssRuleBodies('.workload-timeline-today-marker');
const fiveColumnZeroGap = rule => /grid-template-columns:\s*repeat\(5,\s*(?:minmax\(0,\s*1fr\)|1fr)\)/.test(rule)
  && /(?:^|;)\s*gap:\s*0(?:px)?\s*(?:;|$)/.test(rule);
check(INDEX.includes('.workload-skeleton-grid.week { grid-template-columns: repeat(5, minmax(0, 1fr)); }')
    && INDEX.includes('.workload-weekdays.week { grid-template-columns: repeat(5, 1fr); }')
    && INDEX.includes('.workload-grid.week  { grid-template-columns: repeat(5, 1fr);')
    && fiveColumnZeroGap(timelineWeekdaysRule)
    && fiveColumnZeroGap(timelineDayColumnsRule)
    && fiveColumnZeroGap(timelineEditorHeadRule)
    && fiveColumnZeroGap(timelineRelationshipRule)
    && (weekGridSource.match(/for \(let i = 0; i < 5; i\+\+\)/g) || []).length === 2
    && /dayIndex < 5/.test(deadlineTracksSource)
    && /Array\.from\(\{ length: 5 \}/.test(deadlineTracksSource)
    && /after \? 4/.test(deadlineTracksSource)
    && /Math\.min\(4,[\s\S]*rect\.width \/ 5/.test(toolbarSource)
    && /const we = wlAddDays\(ws, 4\)/.test(workloadRenderSource)
    && INDEX.includes('wlState.weekStart = wlAddDays(wlState.weekStart, delta * 7)')
    && INDEX.includes('.workload-weekdays.month { grid-template-columns: repeat(7, 1fr); }')
    && (INDEX.match(/overCapacity = wlDayOverCapacity\(subs\);/g) || []).length === 2,
  'source guard pins zero-gap Monday-Friday lane grids, seven-day period shifts, seven-column Month, and visible-row overload calculations');
check(/--wl-editor-rail:\s*130px/.test(timelineWrapRule)
    && /scroll-padding-inline-start:\s*calc\(var\(--wl-editor-rail\) \+ 10px\)/.test(timelineWrapRule)
    && /display:\s*grid/.test(timelineHeaderRule)
    && /grid-template-columns:\s*var\(--wl-editor-rail\)\s+minmax\(var\(--wl-timeline-days-min\),\s*1fr\)/.test(timelineHeaderRule)
    && /display:\s*grid/.test(timelineEditorRule)
    && /grid-template-columns:\s*var\(--wl-editor-rail\)\s+minmax\(0,\s*1fr\)/.test(timelineEditorRule)
    && /position:\s*sticky/.test(timelineRailRule)
    && /left:\s*0/.test(timelineRailRule)
    && /min-width:\s*0/.test(timelineDayLaneRule)
    && /left:\s*var\(--wl-editor-rail\)/.test(timelineDayColumnsRule)
    && /workload-timeline-wrap \.workload-timeline-plan-chip[^}]*scroll-margin-inline-start:\s*calc\(var\(--wl-editor-rail\) \+ 10px\)/.test(INDEX),
  'timeline header and every editor swimlane reserve a focus-safe sticky 130px rail beside the five-day lane');
check(/background:/.test(timelineTodayRule)
    && !/outline\s*:/.test(timelineTodayRule)
    && /color:\s*inherit/.test(timelineTodayMarkerRule)
    && /font-weight:\s*850/.test(timelineTodayMarkerRule)
    && /letter-spacing:\s*0\.1em/.test(timelineTodayMarkerRule)
    && !/background:/.test(timelineTodayMarkerRule)
    && INDEX.includes('--wl-timeline-today-bg: rgba(108,92,231,0.05)')
    && INDEX.includes('--wl-timeline-today-bg: rgba(139,124,246,0.10)'),
  'today uses a compact header marker plus a faint timeline-only day wash without a large outline');
check(/const dayColumns = stage\.querySelector\('\.workload-timeline-day-columns'\)/.test(resolveDropDaySource)
    && /target\.closest\('\.workload-timeline-editor-rail'\)\) return null/.test(resolveDropDaySource)
    && /if \(!dayColumns\) return null/.test(resolveDropDaySource)
    && /const rect = dayColumns\.getBoundingClientRect\(\)/.test(resolveDropDaySource)
    && /clientX < rect\.left \|\| clientX > rect\.right/.test(resolveDropDaySource)
    && /rect\.width\s*\/\s*5/.test(resolveDropDaySource)
    && /return dayColumns\.querySelector\(`\[data-wl-day-index="\$\{index\}"\]`\)/.test(resolveDropDaySource)
    && !/stage\.getBoundingClientRect\(\)/.test(resolveDropDaySource),
  'timeline drag hit-testing rejects the sticky rail and measures only the zero-gap five-day columns');

const deadlineTagRule = (INDEX.match(/\.wl-deadline-tag \{([^}]*)\}/) || [])[1] || '';
const deadlineTimelineSource = grabFunc('renderWeekDeadlineTimeline');
const connectorRedRule = cssRuleBodies('.workload-timeline-connector.is-red');
const connectorOrangeRule = cssRuleBodies('.workload-timeline-connector.is-orange');
const connectorGreenRule = cssRuleBodies('.workload-timeline-connector.is-green');
const proximityColors = ['#e11d48', '#ea580c', '#0f9f50'];
const proximitySurfaces = ['#ffffff', '#f4f4f2', '#181a1f', '#101114'];
const colorLuminance = hex => {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
};
const colorContrast = (left, right) => {
  const values = [colorLuminance(left), colorLuminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
check(/\.workload-day-card-chip-count \{[^}]*color: var\(--text-primary\)[^}]*opacity: 1/.test(INDEX)
    && INDEX.includes('html[data-theme="dark"] .workload-day-card-chip-count { color: var(--sv-fg-fff); }')
    && deadlineTagRule
    && !/(?:border|background|border-radius|padding)\s*:/.test(deadlineTagRule)
    && INDEX.includes('--wl-proximity-red: #e11d48; --wl-proximity-orange: #ea580c; --wl-proximity-green: #0f9f50;')
    && (INDEX.match(/--wl-proximity-red:/g) || []).length === 1
    && (INDEX.match(/--wl-proximity-orange:/g) || []).length === 1
    && (INDEX.match(/--wl-proximity-green:/g) || []).length === 1
    && /\.wl-deadline-dot \{[^}]*width: 8px[^}]*height: 8px[^}]*background: var\(--wl-proximity-dot, currentColor\)/.test(INDEX)
    && /\.wl-deadline-tag::before \{[^}]*width: 8px[^}]*height: 8px[^}]*background: var\(--wl-proximity-dot, currentColor\)/.test(INDEX)
    && INDEX.includes('.wl-deadline-summary.is-red { color: var(--sv-fg-dc2626); --wl-proximity-dot: var(--wl-proximity-red); }')
    && INDEX.includes('.wl-deadline-summary.is-orange { color: var(--sv-fg-ea580c); --wl-proximity-dot: var(--wl-proximity-orange); }')
    && INDEX.includes('.wl-deadline-summary.is-green { color: var(--sv-fg-16a34a); --wl-proximity-dot: var(--wl-proximity-green); }')
    && /--wl-proximity-dot:\s*var\(--wl-proximity-red\)/.test(cssRuleBodies('.workload-timeline-due.is-red'))
    && /--wl-proximity-dot:\s*var\(--wl-proximity-orange\)/.test(cssRuleBodies('.workload-timeline-due.is-orange'))
    && /--wl-proximity-dot:\s*var\(--wl-proximity-green\)/.test(cssRuleBodies('.workload-timeline-due.is-green'))
    && /--wl-proximity-dot:\s*var\(--wl-proximity-red\)/.test(cssRuleBodies('.workload-timeline-same-day.is-red'))
    && /--wl-proximity-dot:\s*var\(--wl-proximity-orange\)/.test(cssRuleBodies('.workload-timeline-same-day.is-orange'))
    && /--wl-proximity-dot:\s*var\(--wl-proximity-green\)/.test(cssRuleBodies('.workload-timeline-same-day.is-green'))
    && /var\(--wl-proximity-red\)/.test(connectorRedRule)
    && /var\(--wl-proximity-orange\)/.test(connectorOrangeRule)
    && /var\(--wl-proximity-green\)/.test(connectorGreenRule)
    && proximityColors.every(color => proximitySurfaces.every(surface => colorContrast(color, surface) >= 3))
    && /\.workload-timeline-lines \{[^}]*opacity: 1/.test(INDEX)
    && !/workload-timeline-connector[^\n]*opacity="/.test(INDEX)
    && !INDEX.includes('--wl-proximity-dot: var(--cal-status-')
    && !INDEX.includes('.workload-day-card-chip.is-deadline-')
    && !INDEX.includes('.workload-plan-item.is-deadline-')
    && !INDEX.includes('.workload-timeline-plan-chip.is-deadline-')
    && !INDEX.includes('function wlDeadlineFlagSvg('),
  'Workload-local colors keep every red, orange, and green dot/connector vivid, palette-independent, and at least 3:1 on both theme surfaces');
check(INDEX.includes('.workload-day-client-group[open] > .workload-day-card-items,')
    && INDEX.includes('.workload-timeline-source[open] > .workload-timeline-items { padding-left: 14px; }')
    && /workload-plan-item-wrap::before \{[^}]*border-left: 1px solid var\(--border\)[^}]*border-bottom: 1px solid var\(--border\)[^}]*pointer-events: none/.test(INDEX)
    && /workload-plan-item-wrap:not\(:last-child\)::after \{[^}]*border-left: 1px solid var\(--border\)[^}]*pointer-events: none/.test(INDEX),
  'expanded Plan-only and due-date groups show a pointer-safe threaded branch while collapsed groups remain untouched');
check(/\.workload-timeline-editor-banner \{[^}]*grid-column: 1[^}]*border-left: 4px solid/.test(INDEX)
    && /const head = editor\.dailySubs\.map/.test(deadlineTimelineSource)
    && /workload-timeline-editor-banner workload-timeline-editor-rail" role="heading" aria-level="3"[\s\S]*?workload-timeline-editor-kicker">Editor[\s\S]*?workload-timeline-editor-name/.test(deadlineTimelineSource)
    && /\.workload-timeline-editor\.team-graphics \.workload-timeline-editor-banner \{[^}]*border-left-color: var\(--sv-border-d97706\)/.test(INDEX),
  'Plan + Due Date gives every editor a compact team-accented rail aligned with its five daily totals');

const workloadRuntimeStart = INDEX.indexOf('const LINEAR_ISSUES_WEBHOOK');
const workloadRuntimeEnd = INDEX.indexOf('function onLinearSearchInput()');
const workloadRuntime = INDEX.slice(workloadRuntimeStart, workloadRuntimeEnd);
const looseIssueSource = grabFunc('renderLooseIssueStrip');
const planOriginSource = grabFunc('wlPlanOriginHtml');
const groupDeadlineSource = grabFunc('wlGroupDeadlineHtml');
const deadlineTagSource = grabFunc('wlDeadlineTagHtml');
const workloadBadgeSource = grabFunc('wlWorkloadBadgeHtml');
const groupWorkloadSource = grabFunc('wlGroupWorkloadHtml');
const issueDragSource = grabFunc('wlIssueDragHandleHtml');
const groupDragSource = grabFunc('wlGroupDragHandleHtml');
check(workloadRuntimeStart >= 0
    && workloadRuntimeEnd > workloadRuntimeStart
    && !/(?:\stitle\s*=["']|\.title\s*=)/.test(workloadRuntime)
    && [planOriginSource, groupDeadlineSource, deadlineTagSource, workloadBadgeSource,
      groupWorkloadSource, issueDragSource, groupDragSource].every(source => /data-tip=/.test(source))
    && /data-wl-nav="prev" aria-label="Previous period"/.test(workloadRuntime)
    && /workload-popover-item-cal" aria-label="Open in the content calendar"/.test(workloadRuntime)
    && /workload-weekend-row[\s\S]*?aria-label="\$\{wlEscape\(accessible\)\}"/.test(weekendNoticeSource)
    && /workload-chip[\s\S]*?aria-label="\$\{wlEscape\(accessible\)\}"/.test(looseIssueSource)
    && /<button type="button" class="wl-now-card-total"[\s\S]*?aria-label="\$\{wlEscape\(totalLabel\)\}"/.test(workloadRuntime),
  'Workload keeps native title hovers out while meaning-bearing icons use the shared branded tooltip');
check(/workload-timeline-editor team-\$\{team\}" aria-label="\$\{wlEscape\(name\)\} editor"/.test(deadlineTimelineSource)
    && /workload-timeline-editor-banner workload-timeline-editor-rail" role="heading" aria-level="3"/.test(deadlineTimelineSource)
    && /wl-tweak-comment-body\.is-clamped:focus-visible/.test(INDEX)
    && /setAttribute\('role', 'button'\)[\s\S]*?setAttribute\('tabindex', '0'\)[\s\S]*?setAttribute\('aria-expanded', 'false'\)/.test(workloadRuntime)
    && /wlOnTweakCommentKey[\s\S]*?e\.key !== 'Enter'[\s\S]*?e\.key !== ' '/.test(workloadRuntime),
  'editor lanes and expandable tweak comments retain named keyboard semantics alongside branded icon help');

console.log('\n' + (fail === 0 ? 'OVERALL: PASS' : `OVERALL: FAIL (${fail} failed)`));
process.exit(fail === 0 ? 0 : 1);

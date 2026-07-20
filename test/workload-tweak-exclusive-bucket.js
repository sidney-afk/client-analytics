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
const wlDayOverCapacity = compile('wlDayOverCapacity', { wlTeamBucket, wlEditorCapacity });
const wlISO = compile('wlISO');
const wlParseISO = compile('wlParseISO');
const wlWeekMondayISO = compile('wlWeekMondayISO', { wlParseISO, wlISO });
const wlSubWorkingDays = compile('wlSubWorkingDays', { wlParseISO, wlISO });
const wlState = {
  calendarByDate: new Map(),
  planByIssueId: new Map(),
  issueSnapshot: [],
  planHasSnapshot: true,
};
const wlPlanDate = compile('wlPlanDate', { wlState });
const wlAutoPlanDate = compile('wlAutoPlanDate', {
  wlSubWorkingDays,
  wlTodayISO: () => '2026-07-15',
});
const wlDisplayDate = compile('wlDisplayDate', {
  wlState,
  wlPlanDate,
  wlAutoPlanDate,
  wlTodayISO: () => '2026-07-15',
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
const wlDeadlineMeta = compile('wlDeadlineMeta', {
  wlCalendarDayDiff,
  wlFormatShort,
});
const wlDeadlineTagHtml = compile('wlDeadlineTagHtml', {
  wlDeadlineMeta,
  wlEscape: value => String(value),
});
const wlDeadlineFlagSvg = compile('wlDeadlineFlagSvg');
const wlGroupDeadlineSummary = compile('wlGroupDeadlineSummary', { wlDeadlineMeta, wlDisplayDate });
const wlGroupDeadlineHtml = compile('wlGroupDeadlineHtml', {
  wlGroupDeadlineSummary,
  wlDeadlineFlagSvg,
  wlEscape: value => String(value),
});
const wlPriorityValue = compile('wlPriorityValue', { wlState });
const wlPriorityIconHtml = compile('wlPriorityIconHtml', { wlPriorityValue });
const wlGroupUrgentHtml = compile('wlGroupUrgentHtml', {
  wlPriorityValue,
  wlPriorityIconHtml,
  wlEscape: value => String(value),
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
  wlTodayISO: () => '2026-07-15',
  wlIsInProgress,
  wlIsTweaksNeeded,
  wlIsToDo,
  wlDisplayDate,
  wlBucketByDisplayDate,
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
check(!wlDayOverCapacity(autoBucket.slice(0, 5)) && wlDayOverCapacity(autoBucket),
  'video capacity is 5/day and the sixth row marks overload without spilling');

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
    && !wlState.planned.map(row => row.id).includes('manual-overdue')
    && ![...wlState.calendarByDate.values()].flat().map(row => row.id).includes('manual-overdue'),
  'a manual plan override cannot return past-due work to the work-day calendar');
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

console.log('\nWorkload placement, deadline, and Linear-priority signals');
const visualAuto = issue('To Do', 'visual-auto', '2026-07-16');
const visualManual = issue('To Do', 'visual-manual', '2026-07-20');
wlState.planByIssueId.set(visualManual.id, '2026-07-17');
const manualOriginHtml = wlPlanOriginHtml('manual', false);
const mixedOriginHtml = wlGroupPlanOriginHtml([visualAuto, visualManual]);
check(wlPlacementLabel('auto') === 'Automatically planned'
    && wlPlacementLabel('manual') === 'Manually planned'
    && wlPlacementLabel('fallback', false) === 'Deadline fallback'
    && /aria-label="Manually planned"/.test(manualOriginHtml)
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

const planDay = '2026-07-23';
const dueTomorrow = wlDeadlineMeta('2026-07-24', planDay, 'Due');
const dueInThree = wlDeadlineMeta('2026-07-26', planDay, 'Due');
const dueLater = wlDeadlineMeta('2026-07-27', planDay, 'Due');
const plannedLate = wlDeadlineMeta('2026-07-22', planDay, 'Due');
const sameDay = wlDeadlineMeta(planDay, planDay, 'Due');
check(dueTomorrow.tone === 'red' && dueTomorrow.days === 1 && /1d buffer/.test(dueTomorrow.label)
    && dueInThree.tone === 'orange' && dueInThree.days === 3 && /3d buffer/.test(dueInThree.label)
    && dueLater.tone === 'green' && dueLater.days === 4 && /4d buffer/.test(dueLater.label)
    && plannedLate.tone === 'red' && plannedLate.days === -1 && /plan 1d late/.test(plannedLate.label)
    && sameDay.tone === 'red' && sameDay.days === 0 && /same day/.test(sameDay.label)
    && !/wlTodayISO\(/.test(grabFunc('wlDeadlineMeta')),
  'deadline proximity is derived from plan day to due day, never from today');
const redGroup = wlGroupDeadlineSummary([
  issue('To Do', 'red-a', '2026-07-15'),
  issue('To Do', 'red-b', '2026-07-16'),
]);
const mixedGroup = wlGroupDeadlineSummary([visualManual, visualAuto]);
const missingGroup = wlGroupDeadlineSummary([visualAuto, issue('To Do', 'no-deadline', null)]);
check(/wl-deadline-tag is-red/.test(wlDeadlineTagHtml('2026-07-16', '2026-07-15', 'Due'))
    && redGroup.tone === 'red' && redGroup.mixed === false
    && mixedGroup.tone === '' && mixedGroup.mixed === true
    && missingGroup.tone === '' && missingGroup.mixed === true
    && /is-red/.test(wlGroupDeadlineHtml(redGroup.tone ? [issue('To Do', 'red-c', '2026-07-16')] : []))
    && /is-mixed/.test(wlGroupDeadlineHtml([visualManual, visualAuto])),
  'sub-issues own proximity color and a group inherits it only when every item shares one band');

wlState.priorityByIssueId = new Map([[visualAuto.id, 1], [visualManual.id, 4]]);
const urgentIcon = wlPriorityIconHtml(visualAuto);
const highIcon = wlPriorityIconHtml(2);
const mediumIcon = wlPriorityIconHtml(3);
const lowIcon = wlPriorityIconHtml(visualManual);
check(/is-urgent/.test(urgentIcon) && /Urgent Linear priority/.test(urgentIcon)
    && /is-high/.test(highIcon) && /High Linear priority/.test(highIcon)
    && /is-medium/.test(mediumIcon) && /Medium Linear priority/.test(mediumIcon)
    && /is-low/.test(lowIcon) && /Low Linear priority/.test(lowIcon)
    && /1 urgent sub-issue/.test(wlGroupUrgentHtml([visualManual, visualAuto]))
    && wlPriorityIconHtml(0) === '',
  'native Linear priority icons stay exact per item while collapsed groups surface only an urgent count');
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
  wlTodayISO: () => '2026-07-19',
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
  wlTodayISO: () => '2026-07-19',
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
  wlTodayISO: () => '2026-07-19',
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
  wlPriorityIconHtml,
  wlPlanOriginHtml,
  wlDeadlineTagHtml,
  wlIssueDragHandleHtml,
});
const renderDayRollups = compile('renderDayRollups', {
  wlTeamBucket,
  wlEditorCapacity,
  wlSortSubIssues,
  wlDisplayName: name => name,
  wlEscape: value => String(value),
  wlPlanEditingEnabled: () => true,
  _wlPlanWriteInFlight: new Map(),
  wlGroupDeadlineSummary,
  wlRenderPlanIssueCards,
  wlGroupPlanOriginHtml,
  wlGroupUrgentHtml,
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
  wlDisplayName: name => name,
});
const wlTimelineSameDayHtml = compile('wlTimelineSameDayHtml', {
  wlDeadlineMeta,
  wlEscape: value => String(value),
  wlDeadlineFlagSvg,
});
const wlRenderTimelineTrack = compile('wlRenderTimelineTrack', {
  wlPlanEditingEnabled: () => true,
  _wlPlanWriteInFlight: new Map(),
  wlDeadlineMeta,
  wlEscape: value => String(value),
  wlFormatShort,
  wlDeadlineFlagSvg,
  wlGroupUrgentHtml,
  wlGroupPlanOriginHtml,
  wlGroupDeadlineHtml,
  wlTimelineSameDayHtml,
  wlRenderPlanIssueCards,
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
const dueButtons = trackHtml.match(/<button type="button" class="workload-timeline-due[\s\S]*?<\/button>/g) || [];
check((trackHtml.match(/<line /g) || []).length === 2
    && [...trackHtml.matchAll(/<line [^>]*y1="([^"]+)"/g)].every(match => match[1] === '24')
    && dueButtons.length === 2
    && dueButtons.every(button => !button.includes('draggable=')
      && !button.includes('data-wl-plan-drag')
      && !button.includes('data-wl-plan-group-drag'))
    && trackHtml.includes('data-wl-plan-group-drag="1"')
    && trackHtml.includes('data-wl-drag-handle="group"')
    && !/<summary class="workload-timeline-plan-chip[^>]*(?:draggable=|data-wl-plan-group-drag)/.test(trackHtml)
    && /also due on the planned day/.test(trackHtml)
    && !/data-wl-deadline-open="track-same-day"/.test(trackHtml),
  'toggle-on tracks use straight connectors, keep due endpoints read-only, and collapse same-day due work into its source');

const boundaryRow = issue('To Do', 'track-boundary', '2026-07-19');
wlState.calendarByDate = new Map([[trackStart, [boundaryRow]]]);
const boundaryTrack = wlWeekDeadlineTracks(trackStart)[0].tracks[0];
const boundaryHtml = wlRenderTimelineTrack(boundaryTrack, {
  assigneeId: boundaryRow.assigneeId,
}, 2);
check(boundaryTrack.planIndex === 0
    && boundaryTrack.endpoints[0].targetIndex === 0
    && boundaryTrack.endpoints[0].boundary === 'before'
    && /<line [^>]*y1="24"[^>]*y2="68"/.test(boundaryHtml)
    && /--wl-source-top:7px/.test(boundaryHtml)
    && /--wl-endpoint-top:52px/.test(boundaryHtml),
  'an out-of-week deadline at the plan edge stacks below the source and remains connected');

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
  'deadline tracks inherit the calendar bucket and cannot reintroduce overdue work');
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
const overloadedEditorHtml = renderDayRollups(oneOverloadedEditor, dueDate);
check((overloadedEditorHtml.match(/class="workload-plan-item"/g) || []).length === 6
    && (overloadedEditorHtml.match(/class="workload-day-client-group"/g) || []).length === 1
    && !/<details class="workload-day-client-group"[^>]*\sopen(?:\s|>)/.test(overloadedEditorHtml)
    && overloadedEditorHtml.includes('class="workload-day-card-total over-capacity"')
    && overloadedEditorHtml.includes('6/5 · 1 over')
    && overloadedEditorHtml.includes('class="workload-day-card-chip"')
    && overloadedEditorHtml.includes('Synthetic Client')
    && overloadedEditorHtml.includes('· 6')
    && oneOverloadedEditor[0].subs.every(row => overloadedEditorHtml.includes(`data-wl-issue-id="${row.id}"`))
    && (overloadedEditorHtml.match(/data-wl-drag-handle="issue"/g) || []).length === 6
    && (overloadedEditorHtml.match(/data-wl-drag-handle="group"/g) || []).length === 1
    && !/<button[^>]*class="workload-plan-item[^>]*(?:draggable=|data-wl-plan-drag)/.test(overloadedEditorHtml)
    && !/<summary[^>]*class="workload-day-card-chip[^>]*(?:draggable=|data-wl-plan-group-drag)/.test(overloadedEditorHtml)
    && !overloadedEditorHtml.includes('workload-day-overflow'),
  'one collapsed client chip retains all six overloaded items and exposes drag only on dedicated handles');
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
check(visualRollupHtml.includes('Mixed deadline proximity')
    && visualRollupHtml.includes('Urgent Linear priority')
    && visualRollupHtml.includes('automatically planned')
    && visualRollupHtml.includes('manually planned')
    && visualRollupHtml.includes(`data-wl-issue-id="${visualAuto.id}"`)
    && visualRollupHtml.includes(`data-wl-issue-id="${visualManual.id}"`)
    && visualRollupHtml.includes('is-deadline-red')
    && visualRollupHtml.includes('is-deadline-orange')
    && /workload-plan-item-title-line[\s\S]*?wl-priority-icon[\s\S]*?workload-plan-item-label[\s\S]*?wl-plan-origin[\s\S]*?data-wl-drag-handle="issue"/.test(visualRollupHtml)
    && (visualRollupHtml.match(/data-wl-drag-handle="issue"/g) || []).length === 2
    && (visualRollupHtml.match(/data-wl-drag-handle="group"/g) || []).length === 1
    && !visualRollupHtml.includes('workload-plan-item-grip')
    && !/<summary class="workload-day-card-chip is-deadline-/.test(visualRollupHtml)
    && !visualRollupHtml.includes('data-wl-plan-clear')
    && !visualRollupHtml.includes('workload-plan-reset')
    && !visualRollupHtml.includes('Use automatic plan'),
  'mixed client groups stay neutral while exact item tones and quiet origin/priority signals remain visible');
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
check(loadingPlanStatus.hidden === true
    && loadingPlanStatus.textContent === ''
    && !INDEX.includes('Loading saved work days…')
    && !INDEX.includes('Refreshing saved work days')
    && /wlState\.planStatus === 'loading' \|\| wlState\.planStatus === 'refreshing'/.test(workloadRenderSource)
    && /_svLoadingSkeletonHtml\('workload'\)/.test(workloadRenderSource)
    && /renderWorkloadAll\(\);/.test(workloadLoadSource)
    && !workloadLoadSource.includes('deferWhilePopoverOpen')
    && /await wlLoadSnapshot\(true, null\)/.test(grabFunc('wlManualRefresh'))
    && /await wlLoadSnapshot\(true, null\)/.test(grabFunc('wlRefetchSilent'))
    && /wlRefetchSilent\(\)/.test(grabFunc('_wlV2OnRealtimeChange'))
    && (workloadSkeletonHtml.match(/class="workload-skeleton-day"/g) || []).length === 5
    && workloadSkeletonHtml.includes('aria-label="Loading saved work days"')
    && workloadSkeletonHtml.includes('class="sv-skeleton-row"')
    && workloadSkeletonHtml.includes('sv-skeleton-line')
    && workloadSkeletonHtml.includes('sv-skeleton-pill'),
  'every initial, manual, visibility, and realtime plan refresh uses the five-day Week skeleton with no text strip');

const workloadShellSource = grabFunc('renderWorkloadShell');
const tweaksIndex = workloadShellSource.indexOf('id="wlTweaks"');
const undatedIndex = workloadShellSource.indexOf('id="wlUndated"');
const unassignedIndex = workloadShellSource.indexOf('id="wlUnassigned"');
const toolbarIndex = workloadShellSource.indexOf('class="workload-toolbar"');
const calendarLabelIndex = workloadShellSource.indexOf('class="workload-section-label workload-calendar-label"');
const calendarBodyIndex = workloadShellSource.indexOf('id="wlBody"');
const clientFilterIndex = workloadShellSource.indexOf('id="wlClientSearchInput"');
const deadlineModeIndex = workloadShellSource.indexOf('class="workload-pills workload-deadline-mode"');
check((workloadShellSource.match(/class="workload-toolbar"/g) || []).length === 1
    && tweaksIndex < toolbarIndex
    && toolbarIndex < calendarLabelIndex
    && calendarLabelIndex < calendarBodyIndex
    && calendarBodyIndex < unassignedIndex
    && unassignedIndex < undatedIndex
    && clientFilterIndex < deadlineModeIndex
    && ['prev', 'today', 'next'].every(value => workloadShellSource.includes(`data-wl-nav="${value}"`))
    && ['week', 'month'].every(value => workloadShellSource.includes(`data-wl-view="${value}"`)),
  'the intact period toolbar sits below exception strips and directly before the calendar, with undated work at the bottom');

const weekendNoticeSource = grabFunc('renderWorkloadWeekendNotice');
check(workloadShellSource.includes('id="wlWeekendNotice"')
    && workloadShellSource.includes('id="wlWeekendNoticePanel"')
    && /exceptions\.planned\.length[\s\S]*exceptions\.due\.length/.test(weekendNoticeSource)
    && /row\.roles\.join\(' \+ '\)/.test(weekendNoticeSource)
    && /renderWorkloadWeekendNotice\(\)/.test(workloadRenderSource),
  'the calendar exposes one compact weekend notice with exact planned/due counts and a deduplicated detail panel');

const sectionStorage = new Map();
const sectionLocalStorage = {
  getItem: key => sectionStorage.has(key) ? sectionStorage.get(key) : null,
  setItem: (key, value) => sectionStorage.set(key, value),
};
const sectionPrefKey = 'syncview_workloadSections_v1';
const wlReadSectionPrefs = compile('wlReadSectionPrefs', {
  localStorage: sectionLocalStorage,
  WL_SECTION_PREF_KEY: sectionPrefKey,
});
const defaultSectionPrefs = wlReadSectionPrefs();
sectionStorage.set(sectionPrefKey, JSON.stringify({ overdue: true, inprogress: false, tweaks: true, ignored: true }));
const savedSectionPrefs = wlReadSectionPrefs();
const toolbarSource = grabFunc('wlWireToolbar');
check(defaultSectionPrefs.overdue === false
    && defaultSectionPrefs.inprogress === false
    && defaultSectionPrefs.tweaks === false
    && savedSectionPrefs.overdue === true
    && savedSectionPrefs.inprogress === false
    && savedSectionPrefs.tweaks === true
    && !Object.prototype.hasOwnProperty.call(savedSectionPrefs, 'ignored')
    && (workloadShellSource.match(/data-wl-section-toggle=/g) || []).length === 3
    && (workloadShellSource.match(/workload-exception-rollups/g) || []).length === 3
    && /localStorage\.setItem\(WL_SECTION_PREF_KEY,\s*JSON\.stringify\(wlState\.sectionExpanded\)\)/.test(toolbarSource)
    && /panel\.hidden = !expanded/.test(toolbarSource),
  'overdue, in-progress, and tweaks default collapsed and persist each browser expansion');

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
    && /class="workload-pills workload-deadline-mode" role="tablist" aria-label="Deadline display"/.test(workloadShellSource)
    && /data-wl-deadline-mode="plan"[^>]*>Plan only</.test(workloadShellSource)
    && /data-wl-deadline-mode="deadlines"[^>]*>Plan \+ deadlines</.test(workloadShellSource)
    && !workloadShellSource.includes('data-wl-deadline-toggle')
    && !workloadShellSource.includes('tpl-toggle-mini workload-deadline-toggle')
    && /localStorage\.setItem\(WL_DEADLINE_PREF_KEY,\s*wlState\.showDeadlines \? '1' : '0'\)/.test(toolbarSource)
    && /mode === 'month' && wlState\.showDeadlines/.test(toolbarSource)
    && /wlState\.showDeadlines = deadlineMode\.getAttribute\('data-wl-deadline-mode'\) === 'deadlines'/.test(toolbarSource)
    && /wlState\.showDeadlines \? renderWeekDeadlineTimeline\(\) : renderWeekGrid\(\)/.test(workloadRenderSource),
  'the Plan only / Plan + deadlines segmented control sits after All clients, persists, stays Week-only, and switches views');
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
    && /workload-popover-plan-line[\s\S]*?Work day[\s\S]*?_svDateHtml\(dateId, workDate[\s\S]*?issueId && explicitPlan[\s\S]*?Use automatic plan/.test(popoverSource)
    && popoverSource.includes('wlPriorityIconHtml(s)')
    && popoverSource.includes('wlDeadlineTagHtml(s.dueDate, workDate)')
    && /const planControl = wlIsTweaksNeeded\(s\) \? ''/.test(popoverSource)
    && popoverSource.includes('wl-tweak-comments'),
  'direct pinned-item popovers show priority, one deadline, and the compact Work day / automatic-reset row while group popovers do not expose reset');

check(INDEX.includes('function wlAutoPlanDate(')
    && INDEX.includes('function wlPlacementMode(')
    && !INDEX.includes('function wlEffectiveWorkDate(')
    && !INDEX.includes('function scheduleAll(')
    && !INDEX.includes('effectiveWorkDate')
    && !INDEX.includes('scheduledDate'),
  'hybrid source uses the bounded auto-plan helper without restoring scheduler state');
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
check(INDEX.includes('.workload-skeleton-grid.week { grid-template-columns: repeat(5, minmax(0, 1fr)); }')
    && INDEX.includes('.workload-weekdays.week { grid-template-columns: repeat(5, 1fr); }')
    && INDEX.includes('.workload-grid.week  { grid-template-columns: repeat(5, 1fr);')
    && INDEX.includes('.workload-timeline-day-columns { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));')
    && (weekGridSource.match(/for \(let i = 0; i < 5; i\+\+\)/g) || []).length === 2
    && /dayIndex < 5/.test(deadlineTracksSource)
    && /Array\.from\(\{ length: 5 \}/.test(deadlineTracksSource)
    && /after \? 4/.test(deadlineTracksSource)
    && /Math\.min\(4,[\s\S]*rect\.width \/ 5/.test(toolbarSource)
    && /const we = wlAddDays\(ws, 4\)/.test(workloadRenderSource)
    && INDEX.includes('wlState.weekStart = wlAddDays(wlState.weekStart, delta * 7)')
    && INDEX.includes('.workload-weekdays.month { grid-template-columns: repeat(7, 1fr); }')
    && (INDEX.match(/overCapacity = wlDayOverCapacity\(subs\);/g) || []).length === 2,
  'source guard pins Monday-Friday Week geometry, seven-day period shifts, seven-column Month, and visible-row overload calculations');

console.log('\n' + (fail === 0 ? 'OVERALL: PASS' : `OVERALL: FAIL (${fail} failed)`));
process.exit(fail === 0 ? 0 : 1);

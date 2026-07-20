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
const wlDeadlineMeta = compile('wlDeadlineMeta', {
  wlCalendarDayDiff,
  wlTodayISO: () => '2026-07-15',
  wlFormatShort,
});
const wlDeadlineTagHtml = compile('wlDeadlineTagHtml', {
  wlDeadlineMeta,
  wlEscape: value => String(value),
});
const wlGroupDeadlineHtml = compile('wlGroupDeadlineHtml', { wlDeadlineTagHtml });
const wlPriorityValue = compile('wlPriorityValue', { wlState });
const wlGroupPriorityValue = compile('wlGroupPriorityValue', { wlPriorityValue });
const wlPriorityIconHtml = compile('wlPriorityIconHtml', { wlPriorityValue });
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
    && (wlState.calendarByDate.get('2026-07-15') || []).map(row => row.id).includes('ordinary-overdue'),
  'an overdue automatic placement floors to today while its deadline remains overdue');

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
const visualManual = issue('To Do', 'visual-manual', '2026-07-18');
wlState.planByIssueId.set(visualManual.id, '2026-07-17');
check(wlPlacementLabel('auto', false) === 'Auto planned'
    && wlPlacementLabel('manual', false) === 'Manual planned'
    && wlPlacementLabel('fallback', false) === 'Deadline fallback'
    && wlPlanOriginHtml('manual', false).includes('Manual planned'),
  'placement origin uses the agreed automatic, manual, and degraded labels');
check(wlGroupPlacementMode([visualAuto]) === 'auto'
    && wlGroupPlacementMode([visualManual]) === 'manual'
    && wlGroupPlacementMode([visualAuto, visualManual]) === 'mixed',
  'collapsed client groups truthfully summarize automatic, manual, or mixed placement');

const dueTomorrow = wlDeadlineMeta('2026-07-16', 'Due');
const dueInThree = wlDeadlineMeta('2026-07-18', 'Due');
const dueLater = wlDeadlineMeta('2026-07-19', 'Due');
const overdueDeadline = wlDeadlineMeta('2026-07-14', 'Due');
check(dueTomorrow.tone === 'red' && dueTomorrow.days === 1
    && dueInThree.tone === 'orange' && dueInThree.days === 3
    && dueLater.tone === 'green' && dueLater.days === 4
    && overdueDeadline.tone === 'red' && /overdue/.test(overdueDeadline.label),
  'deadline proximity is red through one day, orange for two to three, and green after three');
check(/wl-deadline-tag is-red/.test(wlDeadlineTagHtml('2026-07-16', 'Due'))
    && /Next due/.test(wlGroupDeadlineHtml([visualManual, visualAuto])),
  'deadline tags stay visible on exact rows and use the earliest group deadline');

wlState.priorityByIssueId = new Map([[visualAuto.id, 1], [visualManual.id, 4]]);
const urgentIcon = wlPriorityIconHtml(visualAuto);
const highIcon = wlPriorityIconHtml(2);
const mediumIcon = wlPriorityIconHtml(3);
const lowIcon = wlPriorityIconHtml(visualManual);
check(/is-urgent/.test(urgentIcon) && /Urgent Linear priority/.test(urgentIcon)
    && /is-high/.test(highIcon) && /High Linear priority/.test(highIcon)
    && /is-medium/.test(mediumIcon) && /Medium Linear priority/.test(mediumIcon)
    && /is-low/.test(lowIcon) && /Low Linear priority/.test(lowIcon)
    && wlGroupPriorityValue([visualManual, visualAuto]) === 1
    && wlPriorityIconHtml(0) === '',
  'native Linear priority icons preserve Urgent, High, Medium, Low and highest-priority group rollup');
wlState.planByIssueId.clear();

const wlAddDays = compile('wlAddDays', { wlParseISO, wlISO });
const wlIsWeekend = compile('wlIsWeekend');
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
wlState.weekStart = '2026-07-24';
const weekendWeekHtml = renderWeekGrid();
check((weekendWeekHtml.match(/data-wl-day=/g) || []).length === 7
    && /class="workload-day" data-wl-day="2026-07-24"/.test(weekendWeekHtml)
    && /class="workload-day weekend" data-wl-day="2026-07-26"/.test(weekendWeekHtml)
    && weekendWeekHtml.includes('weekend-due')
    && weekendWeekHtml.includes('weekend-plan'),
  'the rolling week shows a Saturday deadline on Friday automatically and preserves a manual Sunday plan');
wlState.planByIssueId.clear();

const wlSortSubIssues = compile('wlSortSubIssues');
const renderDayRollups = compile('renderDayRollups', {
  wlTeamBucket,
  wlEditorCapacity,
  wlSortSubIssues,
  wlDisplayName: name => name,
  wlEscape: value => String(value),
  wlPlanEditingEnabled: () => true,
  _wlPlanWriteInFlight: new Map(),
  wlGroupPlacementMode,
  wlGroupPriorityValue,
  wlPlacementMode,
  wlDisplayDate,
  wlPlanDate,
  wlPriorityIconHtml,
  wlPlanOriginHtml,
  wlFormatShort,
  wlDeadlineTagHtml,
  wlGroupDeadlineHtml,
});
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
    && !overloadedEditorHtml.includes('workload-day-overflow'),
  'one collapsed client chip retains all six overloaded items for expansion');
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
check(visualRollupHtml.includes('Mixed')
    && visualRollupHtml.includes('Next due')
    && visualRollupHtml.includes('Urgent Linear priority')
    && visualRollupHtml.includes('Auto planned')
    && visualRollupHtml.includes('Manual planned')
    && visualRollupHtml.includes('Use auto plan'),
  'collapsed and expanded calendar rows expose origin, deadline, priority, and the manual reset');
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
    && (workloadSkeletonHtml.match(/class="workload-skeleton-day"/g) || []).length === 7
    && workloadSkeletonHtml.includes('aria-label="Loading saved work days"')
    && workloadSkeletonHtml.includes('class="sv-skeleton-row"')
    && workloadSkeletonHtml.includes('sv-skeleton-line')
    && workloadSkeletonHtml.includes('sv-skeleton-pill'),
  'every initial, manual, visibility, and realtime plan refresh uses the calendar skeleton with no text strip');

const workloadShellSource = grabFunc('renderWorkloadShell');
const tweaksIndex = workloadShellSource.indexOf('id="wlTweaks"');
const undatedIndex = workloadShellSource.indexOf('id="wlUndated"');
const unassignedIndex = workloadShellSource.indexOf('id="wlUnassigned"');
const toolbarIndex = workloadShellSource.indexOf('class="workload-toolbar"');
const calendarLabelIndex = workloadShellSource.indexOf('class="workload-section-label workload-calendar-label"');
const calendarBodyIndex = workloadShellSource.indexOf('id="wlBody"');
check((workloadShellSource.match(/class="workload-toolbar"/g) || []).length === 1
    && tweaksIndex < toolbarIndex
    && toolbarIndex < calendarLabelIndex
    && calendarLabelIndex < calendarBodyIndex
    && calendarBodyIndex < unassignedIndex
    && unassignedIndex < undatedIndex
    && ['prev', 'today', 'next'].every(value => workloadShellSource.includes(`data-wl-nav="${value}"`))
    && ['week', 'month'].every(value => workloadShellSource.includes(`data-wl-view="${value}"`)),
  'the intact period toolbar sits below exception strips and directly before the calendar, with undated work at the bottom');

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

const popoverSource = grabFunc('wlOpenRollupPopover');
check(popoverSource.includes('Open Linear →')
    && !popoverSource.includes('Open parent')
    && !popoverSource.includes('workload-popover-item-due')
    && !popoverSource.includes('workload-popover-plan-arrow')
    && !popoverSource.includes('workload-popover-plan-due')
    && !popoverSource.includes('workload-popover-plan-meta')
    && !popoverSource.includes('Uses deadline')
    && /workload-popover-plan-line[\s\S]*?wlPlanOriginHtml\(placementMode, false\)[\s\S]*?_svDateHtml\(dateId, workDate[\s\S]*?Use auto plan/.test(popoverSource)
    && popoverSource.includes('wlPriorityIconHtml(s)')
    && popoverSource.includes('wlDeadlineTagHtml(s.dueDate)')
    && /const planControl = wlIsTweaksNeeded\(s\) \? ''/.test(popoverSource)
    && popoverSource.includes('wl-tweak-comments'),
  'shared popovers show priority and one deadline, keep a compact origin/date/reset row, and link to Linear');

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
    && INDEX.includes('<summary class="workload-day-card-chip"')
    && INDEX.includes('data-wl-plan-group-drag="1"')
    && !INDEX.includes('<details class="workload-day-client-group" open>'),
  'calendar hierarchy renders collapsed draggable client chips inside editor blocks by default');
check(INDEX.includes('.workload-weekdays.week { grid-template-columns: repeat(7, 1fr); }')
    && INDEX.includes('wlState.weekStart = wlAddDays(wlState.weekStart, delta * 7)')
    && (INDEX.match(/overCapacity = wlDayOverCapacity\(subs\);/g) || []).length === 2,
  'source guard pins seven-calendar-day weeks and visible-row overload calculations');

console.log('\n' + (fail === 0 ? 'OVERALL: PASS' : `OVERALL: FAIL (${fail} failed)`));
process.exit(fail === 0 ? 0 : 1);

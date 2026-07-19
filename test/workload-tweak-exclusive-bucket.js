'use strict';

/*
 * Workload static-calendar and tweak-bucket regression.
 *
 * A Linear tweak sub-issue can retain the due date from its original plan.
 * Exercise the real workload classifier and wlApplyData implementation to
 * prove that either canonical tweak-status spelling appears in the tweaks
 * strip only, never on the planned calendar or another status strip.
 *
 * Static mode is literal: every ordinary dated row stays on its due date,
 * capacity never spills or hides it, and overload is visibly marked.
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
const wlBucketByDueDate = compile('wlBucketByDueDate');
const wlState = { calendarByDate: new Map() };

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
  wlBucketByDueDate,
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

console.log('\nWorkload static due-date mode');
const dueDate = '2026-07-20';
const videoRows = Array.from({ length: 6 }, (_, i) => issue('To Do', 'video-' + i, dueDate));
wlApplyData(videoRows, '2026-07-15T12:00:00Z');
const dueBucket = wlState.calendarByDate.get(dueDate) || [];
check(wlState.calendarByDate.size === 1 && dueBucket.length === videoRows.length,
  'all dated video rows stay together on their exact due date');
check(dueBucket.every(row => row.dueDate === dueDate
    && !Object.prototype.hasOwnProperty.call(row, 'scheduledDate')
    && !Object.prototype.hasOwnProperty.call(row, 'effectiveWorkDate')),
  'static bucketing does not derive or mutate a second date');
check(!wlDayOverCapacity(dueBucket.slice(0, 5)) && wlDayOverCapacity(dueBucket),
  'video capacity is 5/day and the sixth row marks overload without spilling');

const pastDue = issue('To Do', 'ordinary-overdue', '2026-07-14');
wlApplyData([pastDue], '2026-07-15T12:00:00Z');
check(wlState.overdue.map(row => row.id).includes('ordinary-overdue')
    && (wlState.calendarByDate.get('2026-07-14') || []).map(row => row.id).includes('ordinary-overdue'),
  'ordinary overdue work stays in its warning strip and on its exact historical due date');

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
  'assigned undated work stays visible in Needs a due date and is never auto-placed');

const wlISO = compile('wlISO');
const wlParseISO = compile('wlParseISO');
const wlAddWorkingDays = compile('wlAddWorkingDays', { wlParseISO, wlISO });
wlState.weekStart = dueDate;
wlState.calendarByDate = new Map([[dueDate, videoRows]]);
const renderWeekGrid = compile('renderWeekGrid', {
  wlState,
  wlTodayISO: () => '2026-07-19',
  wlAddWorkingDays,
  wlParseISO,
  wlEscape: value => String(value),
  wlPassesFilters: () => true,
  wlGroupRollups: () => [],
  wlDayOverCapacity,
  renderDayRollups: () => '',
});
const weekHtml = renderWeekGrid();
check(/class="workload-day over-capacity" data-wl-day="2026-07-20"/.test(weekHtml)
    && weekHtml.includes('6 · over'),
  'an overloaded due-date column renders red with a visible over-capacity label');

const renderFilteredWeekGrid = compile('renderWeekGrid', {
  wlState,
  wlTodayISO: () => '2026-07-19',
  wlAddWorkingDays,
  wlParseISO,
  wlEscape: value => String(value),
  wlPassesFilters: () => false,
  wlGroupRollups: () => [],
  wlDayOverCapacity,
  renderDayRollups: () => '',
});
const filteredWeekHtml = renderFilteredWeekGrid();
check(/class="workload-day over-capacity" data-wl-day="2026-07-20"/.test(filteredWeekHtml)
    && filteredWeekHtml.includes('>over</span>'),
  'filters cannot hide the overload state from the unfiltered due-date bucket');

const renderDayRollups = compile('renderDayRollups', {
  wlTeamBucket,
  wlDisplayName: name => name,
  wlParentUrl: () => '#',
  wlEscape: value => String(value),
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

check(!INDEX.includes('function wlEffectiveWorkDate(')
    && !INDEX.includes('function scheduleAll(')
    && !INDEX.includes('effectiveWorkDate')
    && !INDEX.includes('scheduledDate'),
  'static source contains no automatic date derivation or scheduler state');
check(INDEX.includes('.workload-day.over-capacity')
    && !INDEX.includes("'Plan ' + wlFormatShort"),
  'source guard pins themed overload styling and removes phantom Plan copy');

console.log('\n' + (fail === 0 ? 'OVERALL: PASS' : `OVERALL: FAIL (${fail} failed)`));
process.exit(fail === 0 ? 0 : 1);

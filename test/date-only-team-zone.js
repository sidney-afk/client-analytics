'use strict';
/*
 * REGRESSION GUARD: date-only values read in the team's time zone (UTC-6)
 * (OPEN_REPAIRS 397, Digger bug archaeology 2026-10-10). `new Date('YYYY-MM-DD')`
 * is UTC midnight, which is the evening before for the team. Two places shown
 * to people got that wrong:
 *
 *   A. Analytics "This week" views on the 1st of a month.
 *   B. The Kasper Ads panel's lead dates (booked, captured, sent, due).
 *
 * Run:  node --require ./test/helpers/single-file-index.js test/date-only-team-zone.js
 *
 * A.
 * ig_views_this_month / tiktok_plays_this_month reset on the 1st, so
 * _safeWeekViewDelta subtracts them only when the two rows are in the same
 * month, and otherwise sums the daily gains. It decided "same month" with
 * `new Date('YYYY-MM-DD').getMonth()`, which reads the date as UTC midnight:
 * in the team's zone (UTC-6) a row dated the 1st read as the last day of the
 * month before, matched last week's row, and the page showed the 1st's tiny
 * counter minus last month's total, a large negative, on every client's
 * Analytics on the 1st of every month.
 *
 * The real function is pulled out of the built page and run with the process
 * in the team's time zone. Numbers are made up.
 */
process.env.TZ = 'America/Guatemala';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) return '';
  let depth = 0, i = source.indexOf('{', source.indexOf(')', start)), quote = '';
  for (; i < source.length; i++) {
    const ch = source[i];
    if (quote) { if (ch === '\\') { i++; continue; } if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2) + 1; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

assert.strictEqual(new Date('2026-10-01').getMonth(), 8, 'precondition: this process reads a date-only 1st as the previous month (TZ honoured)');

const rows = [
  { client_name: 'Fixture', date: '2026-09-24', ig_views_this_month: 500000, ig_views_gained_today: 10000 },
  { client_name: 'Fixture', date: '2026-09-25', ig_views_this_month: 510000, ig_views_gained_today: 10000 },
  { client_name: 'Fixture', date: '2026-09-26', ig_views_this_month: 520000, ig_views_gained_today: 10000 },
  { client_name: 'Fixture', date: '2026-09-27', ig_views_this_month: 530000, ig_views_gained_today: 10000 },
  { client_name: 'Fixture', date: '2026-09-28', ig_views_this_month: 540000, ig_views_gained_today: 10000 },
  { client_name: 'Fixture', date: '2026-09-29', ig_views_this_month: 550000, ig_views_gained_today: 10000 },
  { client_name: 'Fixture', date: '2026-09-30', ig_views_this_month: 560000, ig_views_gained_today: 10000 },
  { client_name: 'Fixture', date: '2026-10-01', ig_views_this_month: 9000, ig_views_gained_today: 9000 },
  { client_name: 'Fixture', date: '2026-10-08', ig_views_this_month: 79000, ig_views_gained_today: 10000 },
];
const s = { allData: rows, Number, isNaN, String, Date, Object, wlIsAllowedClient: () => false, wlCanonicalClient: n => n, _blankAnalyticsRow: () => ({}) };
vm.createContext(s);
vm.runInContext(['function n(v){const x=Number(v);return isNaN(x)?0:x;}', extract('_analyticsRowMonth'), extract('clientHistory'), extract('_safeWeekViewDelta')].join('\n'), s);

// On the 1st the 1st is the newest row.
s.allData = rows.slice(0, 8);
const first = rows[7], weekBefore = rows[0];
const onTheFirst = s._safeWeekViewDelta(first, weekBefore, 'Fixture', 'ig_views_this_month', 'ig_views_gained_today');
assert.ok(onTheFirst !== null && onTheFirst > 0, `on the 1st, "This week" is a real count, not the reset counter minus last month's total (got ${onTheFirst})`);
assert.strictEqual(onTheFirst, 9000 + 6 * 10000, 'it sums the daily gains of the 7 days after the reference day, the same week the subtraction counts');
s.allData = rows;

const sameMonth = s._safeWeekViewDelta(rows[8], first, 'Fixture', 'ig_views_this_month', 'ig_views_gained_today');
assert.strictEqual(sameMonth, 70000, 'inside one month the monthly counters are subtracted, as before');

const lastDay = s._safeWeekViewDelta(rows[6], rows[0], 'Fixture', 'ig_views_this_month', 'ig_views_gained_today');
assert.strictEqual(lastDay, 60000, 'the last day of a month against the same month still subtracts');

// B. The Ads panel shows the calendar day it was given.
const k = { Date, isNaN };
vm.createContext(k);
vm.runInContext(extract('_kadFmtDate'), k);
assert.strictEqual(k._kadFmtDate('2026-10-08'), new Date(Date.UTC(2026, 9, 8)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }), `a lead dated 2026-10-08 shows as the 8th, not the 7th (got ${k._kadFmtDate('2026-10-08')})`);
assert.strictEqual(k._kadFmtDate(''), '—', 'no date stays a dash');

console.log('date-only-team-zone: "This week" views on the 1st and the Ads panel dates are right in the team\'s time zone ✅');

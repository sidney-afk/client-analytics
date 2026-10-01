'use strict';
// Metrics can hold more than one stored row for the same client and day (the
// Sheet itself does, and until 2026-10-01 n8n and the copy job each stored one
// for ten clients). The page must read exactly one row per client per day, so
// a day's views are never added twice. Runs the real functions from src/index/040-shared-briefs.js.part.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'src/index/040-shared-briefs.js.part'), 'utf8');

function grabFunc(name) {
  const at = source.indexOf('function ' + name + '(');
  assert.notStrictEqual(at, -1, name + ' exists');
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  throw new Error('unbalanced ' + name);
}

const row = (date, gained, month) => ({ client_name: 'Probe', date, ig_views_gained_today: gained, ig_views_this_month: month });
const sandbox = {
  allData: [
    row('2026-09-28', '100', '1000'),
    row('2026-09-29', '200', '1200'), row('2026-09-29', '200', '1200'),   // same day stored twice
    row('2026-09-30', '300', '1500'), row('2026-09-30', '300', '1500'),
  ],
  clientMap: { Probe: {} },
  wlIsAllowedClient: () => false,
};
vm.createContext(sandbox);
vm.runInContext([grabFunc('_buildHistories'), grabFunc('clientHistory'),
  'this.byName=_buildHistories(); this.hist=clientHistory("Probe");'].join('\n'), sandbox);

for (const [label, rows] of [['_buildHistories', sandbox.byName.Probe], ['clientHistory', sandbox.hist]]) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rows.map(r => r.date))), ['2026-09-28', '2026-09-29', '2026-09-30'], label + ' keeps one row per day');
  assert.strictEqual(rows.reduce((s, r) => s + Number(r.ig_views_gained_today), 0), 600,
    label + ': the three days add up to 600, not 1100');
}
console.log('Analytics same-day rows count once checks passed');

'use strict';
// Execute the real pixel comparator and prove its deliberate Project difference
// does not hide missing icons, shortcuts, menu rows or other submenu affordances.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../docs/syncview-design/tests/pixel-wired.js'), 'utf8');
const start = source.indexOf('function compareMenuInventory(');
const end = source.indexOf('async function styles(', start);
assert(start >= 0 && end > start, 'actual comparator extraction must exist');
const compare = vm.runInNewContext(source.slice(start, end) + '\ncompareContextMenuInventory;');
const labels = ['Status', 'Assignee', 'Due date', 'Project', 'Copy link', 'Move', 'Delete'];
const artifact = labels.map((label, i) => ({ label, kbd: String(i), paths: [], leadingPaths: ['icon-' + i],
  hasChevron: [0, 1, 2, 3, 5].includes(i), chevronPaths: [0, 1, 2, 3, 5].includes(i) ? ['chevron'] : [], disabled: false, action: 'action-' + i }));
function wiredRows() {
  const rows = structuredClone(artifact);
  Object.assign(rows[3], { hasChevron: false, chevronPaths: [], disabled: true, action: '' });
  return rows;
}
const good = [];
compare(good, artifact, wiredRows());
assert.equal(good.length, 0, 'supported Project difference preserves every icon and shortcut');
const corruptions = [
  rows => { rows[3].leadingPaths = ['wrong-icon']; },
  rows => { rows[0].leadingPaths = []; },
  rows => { rows[3].disabled = false; },
  rows => { rows[3].action = 'proj'; },
  rows => { rows[3].hasChevron = true; },
  rows => { rows[3].chevronPaths = ['chevron']; },
  rows => { rows[0].hasChevron = false; rows[0].chevronPaths = []; },
  rows => { rows[1].chevronPaths = ['wrong-chevron']; },
  rows => { rows[4].hasChevron = true; rows[4].chevronPaths = ['chevron']; },
  rows => { rows[3].label = 'Wrong label'; },
  rows => { rows[3].kbd = 'Wrong shortcut'; },
  rows => { rows.pop(); },
  rows => { rows.push(structuredClone(rows[0])); },
];
for (const [i, corrupt] of corruptions.entries()) {
  const rows = wiredRows(), gaps = [];
  corrupt(rows);
  compare(gaps, artifact, rows);
  assert(gaps.length > 0, 'corrupted menu contract must remain red: ' + (i + 1));
}
console.log('Production context-menu pixel contract: 14 checks passed');

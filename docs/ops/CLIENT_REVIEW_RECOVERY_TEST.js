'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Copy to test/client-review-repair-stamp.js before running.
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const begin = source.indexOf('    function _writeUiApplyJournalEdits(');
const end = source.indexOf('    function _writeUiRepairGroups(', begin);
assert.ok(begin > 0 && end > begin);
const context = vm.createContext({});
vm.runInContext(source.slice(begin, end), context);
for (const component of ['video', 'graphic']) {
  for (const status of ['Approved', 'Scheduled', 'Posted', 'Client Approval', 'Tweaks Needed', 'In Progress']) {
    const key = 'client_' + component + '_approved_at';
    const post = { [component + '_status']: status };
    const applied = context._writeUiApplyJournalEdits(post, { [key]: '2026-09-10T00:00:00.000Z' }, 'calendar');
    const expected = ['Tweaks Needed', 'In Progress'].includes(status) ? '' : '2026-09-10T00:00:00.000Z';
    assert.equal(post[key], expected, 'newer status must govern whether a captured stamp is stale');
    assert.equal(applied[key], expected, 'persist the same stamp the card carries');
  }
  const post = { [component + '_status']: 'Approved' };
  context._writeUiApplyJournalEdits(post, { status: 'Approved' }, 'calendar');
  assert.equal(post['client_' + component + '_approved_at'], undefined, 'status alone must never invent client sign-off');
}
console.log('PASS: captured stamps follow existing stale-approval rules; no stamp is fabricated');

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

/* THE CLICK-RETRY PATH OWES THE SAME RULE.
   The guard above lives in _writeUiApplyJournalEdits, which only the JOURNAL
   replay reaches. When a client approval's gateway write commits but the
   Calendar source upsert fails, the card exposes _calRetrySave; if the native
   status advanced meanwhile, _calFlushCardSave adopts it via
   _writeUiAdoptReplayStatus while retaining edits.client_<comp>_approved_at,
   and the source row is written as Tweaks Needed WITH a client sign-off on it.
   Two assertions: the rule itself behaves, and the flush is actually wired to
   it after both adoption sites. */
const flush = source.slice(source.indexOf('    async function _calFlushCardSave('),
  source.indexOf('    function _calRetrySave('));
for (const component of ['video', 'graphic']) {
  const adopt = new RegExp("_writeUiAdoptReplayStatus\\(post, '" + component
    + "'[\\s\\S]{0,1400}?_calClearStaleApprovals\\(post, edits\\)");
  assert.ok(adopt.test(flush),
    'the ' + component + ' replay adoption must clear a stale sign-off before the source write');
}

const staleBegin = source.indexOf('    function _calClearStaleApprovals(');
const staleEnd = source.indexOf('\n    function ', staleBegin + 10);
assert.ok(staleBegin > 0 && staleEnd > staleBegin);
const staleCtx = vm.createContext({
  CAL_COMPONENTS: ['video', 'graphic', 'caption'],
  _calNormStatus: value => String(value || '').trim(),
});
vm.runInContext(source.slice(staleBegin, staleEnd), staleCtx);
for (const [status, kept] of [['Tweaks Needed', false], ['In Progress', false],
  ['For SMM Approval', false], ['Kasper Approval', false],
  ['Client Approval', true], ['Approved', true], ['Scheduled', true], ['Posted', true]]) {
  const post = { video_status: status, client_video_approved_at: '2026-09-10T00:00:00.000Z' };
  const pending = { client_video_approved_at: '2026-09-10T00:00:00.000Z' };
  staleCtx._calClearStaleApprovals(post, pending);
  assert.equal(!!post.client_video_approved_at, kept, status + ': stamp retention must follow the status');
  assert.equal(!!pending.client_video_approved_at, kept, status + ': the pending write must agree with the card');
}
console.log('PASS: the click-retry path clears a stale sign-off, and the rule itself holds');

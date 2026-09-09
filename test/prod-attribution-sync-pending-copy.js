'use strict';

/*
 * A NATIVE CARD WAITING ON THE LINEAR MIRROR READS AS SYNCING, NOT AS A REPAIR.
 *
 * SyncView writes a natively created deliverable row first and mirrors it into
 * Linear after. The attribution resolver reads only the mirrored fields, so for
 * the seconds in between the row resolves to `needs_attribution` and every
 * write control is gated shut. Measured on the live row behind the 2026-09-09
 * report (GRA-7437, created 19:28:29Z, stamped `resolved`/`direct_project` at
 * 19:28:41Z), the gap was twelve seconds -- and for those twelve seconds the
 * app said "Client attribution needs repair", so a transient sync was reported
 * as a broken client.
 *
 * The change is copy only, and this suite pins both halves of that: the softer
 * wording appears for the narrow syncing shape, and NOTHING else borrows it --
 * a persisted stamp, a known project, an already-mirrored row, or a slug that
 * is not an active roster client all keep the repair banner they have always
 * had. The gate text still refuses the write in every case.
 *
 * Executes the real functions out of the shipped file; a source scan would pass
 * on a comment.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// Comment-aware: the extracted blocks carry prose with apostrophes in it.
function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing ' + name);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let comment = '';
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (comment === 'line') { if (char === '\n') comment = ''; continue; }
    if (comment === 'block') { if (char === '*' && next === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { comment = 'line'; i++; continue; }
    if (char === '/' && next === '*') { comment = 'block'; i++; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

const ACTIVE = { dougcartwright: { id: 'dougcartwright', name: 'Doug Cartwright' } };
const sandbox = {
  String, Object, Boolean,
  // Roster and escaping stand in for their real implementations; every
  // function under test below is the shipped one.
  _prodClient: slug => ACTIVE[String(slug || '')] || null,
  _prodDisplayClient: slug => (ACTIVE[String(slug || '')] || {}).name || 'Needs attribution',
  _prodProjectGlyph: () => '<i></i>',
  _calEsc: v => String(v == null ? '' : v),
  _calEscAttr: v => String(v == null ? '' : v),
  PROD_PROJECT_MOVE_UNSUPPORTED: 'unsupported'
};
vm.createContext(sandbox);
for (const name of [
  '_prodAttributionSyncPending',
  '_prodAttributionSyncClientLabel',
  '_prodAttributionGateText',
  '_prodAttributionChipOnlyHTML',
  '_prodIssueProjectChipHTML',
  '_prodAttributionNoticeHTML',
  '_prodAttributionProjectControlHTML'
]) vm.runInContext(extractFunction(name), sandbox);
vm.runInContext([
  'this.pending = _prodAttributionSyncPending;',
  'this.gate = _prodAttributionGateText;',
  'this.chip = _prodAttributionChipOnlyHTML;',
  'this.projectChip = _prodIssueProjectChipHTML;',
  'this.notice = _prodAttributionNoticeHTML;',
  'this.control = _prodAttributionProjectControlHTML;'
].join(''), sandbox);

// The shape a card carries between its own insert and the mirror's answer:
// no persisted stamp, no project from any source, no Linear issue yet, and the
// slug SyncView stored at creation.
function syncingIssue(overrides) {
  return Object.assign({
    id: 'del_1',
    project: '__needs_attribution__',
    storedClientSlug: 'dougcartwright',
    raw: { linear_issue_uuid: null },
    attribution: {
      state: 'needs_attribution',
      clientSlug: '',
      provisionalClientSlug: '',
      repairRequired: true,
      reason: 'no_mapped_project_or_explicit_classification',
      directProjectId: '',
      mappedProjectId: '',
      persistedState: ''
    }
  }, overrides || {});
}

const syncing = syncingIssue();
ok(sandbox.pending(syncing) === true, 'a native row with no stamp, no project and no Linear issue is syncing');
ok(/still syncing to Linear/.test(sandbox.gate(syncing)), 'the gate text says syncing');
ok(sandbox.gate(syncing) !== '', 'the write is STILL gated while syncing');
ok(/Syncing to Linear/.test(sandbox.chip(syncing)) && !/Needs attribution/.test(sandbox.chip(syncing)),
  'the chip says syncing, not needs attribution');
ok(/Doug Cartwright · syncing/.test(sandbox.projectChip(syncing)),
  'the project chip names the client SyncView stored');
ok(/data-prod-attribution-notice="syncing"/.test(sandbox.notice(syncing))
  && !/needs repair/.test(sandbox.notice(syncing)),
  'the notice is the syncing one, and the repair wording is gone');
ok(/Doug Cartwright/.test(sandbox.control(syncing)) && /data-prod-attribution-project="syncing"/.test(sandbox.control(syncing)),
  'the side-card project row names the client and marks itself syncing');

// Every way OUT of the syncing shape keeps the repair banner.
const notSyncing = [
  ['a persisted stamp exists (Linear invalidated it)', syncingIssue({
    attribution: Object.assign(syncingIssue().attribution, { persistedState: 'needs_attribution' })
  })],
  ['the row already carries a Linear issue', syncingIssue({ raw: { linear_issue_uuid: '752b2e7f-4a83-4148-90dd-acd032445c16' } })],
  ['a project is known but unmapped', syncingIssue({
    attribution: Object.assign(syncingIssue().attribution, { directProjectId: 'project-nobody-claims' })
  })],
  ['the stored slug is not an active roster client', syncingIssue({ storedClientSlug: 'a-former-client' })],
  ['no stored slug at all', syncingIssue({ storedClientSlug: '' })],
  ['the state is a conflict, not needs_attribution', syncingIssue({
    attribution: Object.assign(syncingIssue().attribution, { state: 'conflict' })
  })]
];
notSyncing.forEach(([label, issue]) => {
  ok(sandbox.pending(issue) === false, 'NOT syncing when ' + label);
  ok(!/Syncing to Linear/.test(sandbox.chip(issue)), 'keeps its own chip when ' + label);
  ok(!/syncing/.test(sandbox.notice(issue)), 'keeps its own notice when ' + label);
});

// A resolved row is untouched by any of this.
const resolved = syncingIssue({
  project: 'dougcartwright',
  attribution: { state: 'resolved', clientSlug: 'dougcartwright', repairRequired: false, reason: 'direct_project_mapped', directProjectId: 'p', mappedProjectId: 'p', persistedState: 'resolved' }
});
ok(sandbox.pending(resolved) === false, 'a resolved row is never syncing');
ok(sandbox.gate(resolved) === '', 'a resolved row is writable');
ok(sandbox.notice(resolved) === '', 'a resolved row shows no notice');

console.log(failures ? '\nFAILED ' + failures : '\nall ok');
process.exit(failures ? 1 : 0);

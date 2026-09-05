'use strict';
function snapshot() {
  const native = { id: 'native-1', linearId: 'provider-1', legacyIds: ['old-native-1'],
    ownerId: 'member-1', scope: 'synthetic-scope', status: 'todo',
    dueDate: '2026-09-10', kind: 'video', team: 'video', archived: false, container: false };
  const row = { id: 'workload-1', nativeId: native.id, linearId: native.linearId,
    scope: native.scope, ownerId: 'legacy-member-1', kind: 'video', status: 'Todo',
    dueDate: native.dueDate, dateSemantics: 'canonical_due', visible: true };
  return { schema: 'workload-consistency/v1',
    coverage: Object.fromEntries(['native', 'production', 'provider', 'workload', 'calendar', 'samples', 'members', 'expected']
      .map(s => [s, { complete: true }])),
    native: [native], production: [{ ...row, id: native.id, status: native.status }],
    provider: [{ ...row, id: native.linearId }], workload: [{ ...row }],
    calendar: [{ ...row, id: 'card-1', status: 'In Progress', dueDate: '2026-09-12', dateSemantics: 'publish_date' }],
    samples: [],
    members: [{ id: 'member-1', linearId: 'legacy-member-1', active: true, roles: ['creative'], teams: ['video'] }],
    expected: [{ nativeId: native.id, surface: 'calendar', cardId: 'card-1', kind: 'video', scope: native.scope }],
  };
}
function issue(overrides = {}) {
  return { id: 'provider-1', identifier: 'SYN-1', isSubIssue: true,
    clientName: 'Synthetic Client', assigneeId: 'synthetic-member', assigneeName: 'Synthetic Video',
    teamKey: 'VID', teamName: 'Video', status: 'Todo', statusType: 'unstarted',
    dueDate: '2026-09-10', parentId: 'synthetic-parent', ...overrides };
}
function discrepancySnapshot() {
  const s = snapshot();
  const nativeOnly = { ...s.native[0], id: 'native-only', linearId: null, legacyIds: [] };
  s.native.push(nativeOnly);
  s.production.push({ ...s.production[0], id: nativeOnly.id, nativeId: nativeOnly.id, linearId: null });
  Object.assign(s.workload[0], { ownerId: null, status: 'For Kasper approval', dueDate: '2026-09-11', visible: false });
  s.calendar[0].nativeId = '';
  s.provider.push({ ...s.provider[0], id: 'provider-only', nativeId: null, linearId: 'provider-only' });
  return s;
}
module.exports = { snapshot, issue, discrepancySnapshot };

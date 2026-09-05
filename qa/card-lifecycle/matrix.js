'use strict';
const journey = ['resolve-last-to-kasper', 'kasper-request', 'staff-resolve-kasper-request',
  'kasper-approve-to-client', 'client-plain-note', 'client-request-invalidates-approval',
  'staff-return-to-client', 'client-final-approve'];
module.exports = {
  'journey-video': journey, 'journey-graphic': journey,
  controls: ['status-due-assignee', 'role-and-anonymous-controls'],
  'stale-version': ['stale-status-rejected'],
  comments: ['internal-root-and-projection', 'reply-edit', 'resolve-reopen-delete', 'client-note-production-projection'],
  'rejected-save': ['rejected-save'], 'lost-response': ['lost-response'],
  'duplicate-click': ['duplicate-click'], 'undo-reopen': ['kasper-undo', 'request-resolve-reopen'],
  cache: ['retained-and-cold-kasper'], 'delayed-refresh': ['late-read-after-approval'],
  'switch-client': ['switch-client'], 'navigate-saving': ['navigate-saving'],
  'archive-race': ['archive-during-approval'], touch: ['touch'], keyboard: ['keyboard'],
  'network-guard': ['negative-controls'],
};

'use strict';
// Refusal-log triage 2026-09-25: real people clicked Edit, Reply or Mark done
// on a Calendar comment before the card's canonical thread had loaded, and the
// write path refused its own action (canonical_comment_read_required, 8 rows,
// 2 people). The buttons must be drawn disabled until the thread is ready.
// Executes the shipped _calCommentActionsHtml extracted from index.html.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// The function is full of nested template literals, so cut it at the next
// top-level declaration rather than brace-matching.
function extract(name) {
  const start = INDEX.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing ' + name);
  const end = INDEX.slice(start).search(/\n    (?:function |\/\*|const |let )/);
  assert(end > 0, 'no end for ' + name);
  return INDEX.slice(start, start + end);
}
const ctx = {
  _jsAttrArg: v => JSON.stringify(String(v)),
  _calCommentRole: () => 'smm',
  _calMsgIsTweak: () => true,
  _calCanDeleteComment: () => true,
  _calCanResolveComment: () => true,
};
vm.createContext(ctx);
vm.runInContext(extract('_calCommentActionsHtml'), ctx);

const canonicalRoot = { id: 'c1', canonical: true, can_edit: true, can_resolve: true, can_delete: true, done: false };
const buttons = html => html.match(/<button[^>]*>/g) || [];

const loading = buttons(ctx._calCommentActionsHtml(canonicalRoot, false, false));
assert.equal(loading.length, 4, 'reply, edit, mark done and delete are still drawn while loading');
for (const b of loading) {
  assert.match(b, /\sdisabled\b/, 'every action is disabled while the thread loads: ' + b);
  assert.match(b, /title="Comments are still loading"/, 'and says why');
}

const ready = buttons(ctx._calCommentActionsHtml(canonicalRoot, false, true));
assert.equal(ready.length, 4);
for (const b of ready) assert.doesNotMatch(b, /\sdisabled\b/, 'a loaded thread enables every action: ' + b);

const done = buttons(ctx._calCommentActionsHtml({ ...canonicalRoot, done: true }, false, false));
assert(done.some(b => /Comments are still loading/.test(b) && /disabled/.test(b)), 'Reopen waits too');

const legacyDefault = buttons(ctx._calCommentActionsHtml({ id: 'l1', canonical: false, done: false }, false));
assert(legacyDefault.length > 0 && legacyDefault.every(b => !/\sdisabled\b/.test(b)), 'the default (legacy comments) stays enabled');

const call = INDEX.match(/\$\{_calCommentActionsHtml\(c, isReply, ([^}]+)\)\}/);
assert(call && /!c\.canonical \|\| _prodCanonicalCommentGate\(post, comp \|\| c\.component\)\.ready/.test(call[1]),
  'the comment modal passes the canonical gate readiness for canonical comments');
console.log('cal-comment-actions-wait-for-thread: actions wait for the comment thread ✅');

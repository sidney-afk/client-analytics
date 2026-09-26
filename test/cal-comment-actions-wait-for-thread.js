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
const { extractFunction } = require('./helpers/extract-function.js');
const extract = name => extractFunction(INDEX, name);
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

const call = INDEX.match(/\$\{_calCommentActionsHtml\(c, isReply, ([^\n]+)\)\}/);
assert(call && /!c\.canonical \|\| \(!post\._calCommentActionBusy && _prodCanonicalCommentGate\(post, comp \|\| c\.component\)\.ready\)/.test(call[1]),
  'the comment modal disables canonical actions while the thread loads OR an action on the card is in flight');

// Owner repro 2026-09-25: Mark done saved but the panel only updated after the
// slower notes save, so a second click was refused. The toggle must re-read the
// thread and redraw BEFORE the notes save, and hold the card busy meanwhile.
const toggle = extract('_calToggleCommentDone');
const reread = toggle.indexOf('readCanonical(');
const persist = toggle.indexOf('_writeUiPersistCanonicalCommentProjection(');
assert(toggle.includes('if (post._calCommentActionBusy) return;'), 'a second Mark done while one is in flight is ignored');
assert(toggle.includes('post._calCommentActionBusy = true'), 'the card is marked busy before the write');
assert(reread > 0 && persist > reread, 'the thread is re-read and the panel redrawn before the notes save');

// Plain words for a stale-thread refusal, no code; other failures keep theirs.
const failureHtml = extract('_writeUiCommentActionFailureHtml');
const fctx = { _calEsc: v => String(v) };
vm.createContext(fctx);
vm.runInContext(failureHtml, fctx);
const stale = fctx._writeUiCommentActionFailureHtml({ action: 'resolve', message: 'canonical_comment_read_required' }, 'retry()');
assert.match(stale, /This note changed while you were looking at it\. It's been refreshed; try again if needed\./);
assert.doesNotMatch(stale, /canonical_comment_read_required|code:/, 'no technical code for a stale-thread refusal');
assert.match(stale, /Retry/);
const other = fctx._writeUiCommentActionFailureHtml({ action: 'resolve', message: 'comment_forbidden' }, 'retry()');
assert.match(other, /That change to the note was not saved\. \(code: comment_forbidden\)/, 'other refusals keep their code for support');
console.log('cal-comment-actions-wait-for-thread: actions wait for the comment thread ✅');

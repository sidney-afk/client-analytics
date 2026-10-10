'use strict';
/*
 * REGRESSION GUARD: Samples Notes, Mark done / Reopen on a linked sample, has
 * the Calendar twin's guard (OPEN_REPAIRS 397, Digger bug archaeology
 * 2026-10-10, the "fixed on one twin only" pattern).
 *
 * Run:  node --require ./test/helpers/single-file-index.js test/samples-notes-lifecycle-busy.js
 *
 * On the Calendar (#1642 and its busy mark) a linked note's actions stay
 * disabled until its thread is read and while a Mark done / Reopen is out, and
 * the thread is re-read and redrawn before the slower notes save. Samples sent
 * the lifecycle write with no busy mark, never re-read the thread, and drew its
 * actions live, so a second click (or an Edit, Reply or Delete before the read)
 * was refused with canonical_comment_read_required.
 *
 * The real functions are lifted from the built page and run against stand-ins.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const lift = name => extractFunction(INDEX, name);

(async () => {
  // 1. The action buttons render disabled while the thread is not ready.
  const actions = new Function(`
    const _sxrJsArg = v => JSON.stringify(String(v));
    const _sxrCanResolveComment = () => true, _sxrMsgIsTweak = () => true, _sxrCanDeleteComment = () => true;
    ${lift('_sxrCommentActionsHtml')}
    return _sxrCommentActionsHtml;`)();
  const note = { id: 'c1', canonical: true, can_edit: true, can_resolve: true, can_delete: true, done: false };
  const live = actions(note, false, true);
  const waiting = actions(note, false, false);
  assert.ok(!/disabled/.test(live), 'a ready thread draws live actions');
  const buttons = (waiting.match(/<button/g) || []).length;
  assert.ok(buttons >= 4 && (waiting.match(/ disabled aria-disabled="true"/g) || []).length === buttons,
    `while the thread is not ready every action is disabled (${(waiting.match(/ disabled/g) || []).length} of ${buttons})`);
  assert.ok(/Notes are still loading/.test(waiting), 'and says why');
  assert.ok(!/disabled/.test(actions(note, false)), 'callers that pass nothing keep live actions');

  // 2. Mark done on a linked note: one write at a time, thread re-read before the notes save.
  const env = { calls: [], renders: 0 };
  let land;
  const toggle = new Function('env', `
    const _sxrOpenCommentsPid = 'p1';
    const post = { id: 'p1' };
    const sxrState = { posts: [post] };
    const list = [{ id: 'c1', parent_id: '', done: false, is_tweak: true }, { id: 'c2', parent_id: '', done: false, is_tweak: true }];
    const _sxrFindCompForCommentId = () => 'video';
    const _sxrCommentsForAction = () => list;
    const _sxrMsgIsTweak = c => !!c.is_tweak;
    const _sxrCommentRole = () => 'smm';
    const _sxrResolveLastTweak = () => env.calls.push('chooser');
    const _prodCanonicalCommentGate = () => ({ linked: true, ready: true });
    const _sxrCaptureModalDrafts = () => {};
    const _sxrRenderCommentsModal = () => { env.renders++; env.busySeen = env.busySeen || !!post._sxrCommentActionBusy; };
    const _writeUiCommitCardCommentLifecycle = (surface, p, comp, root, action) => { env.calls.push('write:' + action); return new Promise(r => { env.land = r; }); };
    const _writeUiNativeId = () => 'del_1';
    const _prodComments = { readCanonical: async () => { env.calls.push('read'); } };
    const _prodProjectCanonicalCardComments = async () => { env.calls.push('project'); };
    const _writeUiPersistCanonicalCommentProjection = () => env.calls.push('persist');
    ${lift('_sxrToggleCommentDone')}
    env.post = post;
    return _sxrToggleCommentDone;`)(env);
  toggle('c1');
  toggle('c1');
  assert.deepStrictEqual(env.calls, ['write:resolve'], `a second click while the first is out sends nothing (sent: ${env.calls.join(', ')})`);
  assert.ok(env.busySeen, 'the panel is redrawn with its actions busy');
  env.land({ ok: true });
  await new Promise(r => setTimeout(r, 10));
  assert.deepStrictEqual(env.calls, ['write:resolve', 'read', 'project', 'persist'], `when it lands the thread is re-read and redrawn, then the notes save runs (order: ${env.calls.join(', ')})`);
  assert.strictEqual(env.post._sxrCommentActionBusy, false, 'and the actions come back');
  toggle('c1');
  assert.strictEqual(env.calls.filter(c => c.startsWith('write:')).length, 2, 'the next click goes through');

  console.log('samples-notes-lifecycle-busy: Samples Notes Mark done / Reopen waits for its write and its thread, like the Calendar ✅');
})().catch(e => { console.error(e); process.exit(1); });

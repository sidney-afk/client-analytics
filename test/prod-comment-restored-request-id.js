'use strict';
/*
 * REGRESSION GUARD: a SyncLinear comment restored after the tab closed or
 * reloaded mid-send keeps that send's request id, so pressing Comment again
 * cannot post it twice (OPEN_REPAIRS 397, Digger bug archaeology 2026-10-10).
 *
 * Run:  node --require ./test/helpers/single-file-index.js test/prod-comment-restored-request-id.js
 *
 * production-write derives a new comment's id from the request id, so the same
 * request id is the same comment. The browser's stored copy of an unsent
 * comment kept its text but not its request id; restored, it minted a new one
 * and a second press made a second comment (client-visible on a client
 * thread). The Calendar note composer already guards its twin of this.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const lift = name => extractFunction(INDEX, name);

function page(store) {
  return new Function('store', `
    const _prodState = { commentDrafts: new Map() };
    const _prodCommentDraftClient = () => 'fixture';
    const _svDraftSave = (s, c, card, f, text, meta) => { store.set(card, { text, meta: meta || {} }); return true; };
    const _svDraftRead = (s, c, card) => store.get(card) || null;
    ${lift('_prodCommentDraftFor')}
    ${lift('_prodCommentDraftKeep')}
    ${lift('_prodCommentDraftInput')}
    return { draftFor: _prodCommentDraftFor, keep: _prodCommentDraftKeep, input: _prodCommentDraftInput };`)(store);
}

const store = new Map();
const before = page(store);
before.input('del_1', 'Please swap the second clip.');
const d = before.draftFor('del_1');
d.requestId = 'req-first-send';
before.keep('del_1', d);   // what the send does before its write leaves

// The tab reloads before the answer: a fresh page restores the stored copy.
const after = page(store);
const restored = after.draftFor('del_1');
assert.strictEqual(restored.body, 'Please swap the second clip.', 'the unsent text comes back');
assert.strictEqual(restored.requestId, 'req-first-send', `and with the request id of the send already made, so a second press replays it (got ${JSON.stringify(restored.requestId)})`);

// Editing the restored text makes it a new comment: a new request id next time.
after.input('del_1', 'Please swap the second and third clips.');
assert.strictEqual(after.draftFor('del_1').requestId, '', 'edited text drops the old request id');
const third = page(store);
assert.strictEqual(third.draftFor('del_1').requestId, '', 'and the stored copy of the edited text carries none');

// Text never sent carries no request id at all.
const fresh = new Map();
const p = page(fresh);
p.input('del_2', 'Not sent yet.');
assert.strictEqual(page(fresh).draftFor('del_2').requestId, '', 'a draft that was never sent restores with no request id');

const send = lift('_prodSubmitComment');
assert.ok(/if \(!draft\.requestId\) draft\.requestId = _prodWriteRequestId\('comment'\);\s*_prodCommentDraftKeep\(id, draft\);/.test(send),
  'the send stores the request id with the text before its write leaves');

console.log('prod-comment-restored-request-id: a comment restored after a reload mid-send cannot be posted twice ✅');

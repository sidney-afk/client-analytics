'use strict';

// Execute both shipped handlers with a deferred save. A render during the save
// is insufficient: the visible controls must be rendered again after it settles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/extract-function');

async function prove(prefix, file, reject) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index', file), 'utf8');
  const key = 'fixture|caption';
  const state = { drafts: { [key]: 'A question' }, saving: {}, errors: {}, draftActionIds: {}, errorActionIds: {} };
  const post = { id: 'fixture', caption_status: 'Client Approval', caption_tweaks: '' };
  const frames = [];
  let resolveSave, rejectSave;
  const save = new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; });
  const context = {
    [prefix === 'cal' ? 'calState' : 'sxrState']: { posts: [post] },
    [`_${prefix}ReviewState`]: state,
    [`_${prefix}PendingEdits`]: {},
    [`_${prefix}CommentRole`]: () => 'client',
    [`_${prefix}CommentsFor`]: () => [],
    [`_${prefix}MintCommentId`]: () => 'fictional-comment',
    [`_${prefix}CurrentAuthor`]: () => 'Client',
    [`_${prefix}SetCommentsFor`]: (row, comp, comments) => { row[comp + '_tweaks'] = JSON.stringify(comments); },
    [`_${prefix}StringifyComments`]: JSON.stringify,
    [`_${prefix}ReviewRepaintCard`]: () => frames.push({ saving: !!state.saving[key], draft: state.drafts[key], error: state.errors[key] }),
    [`_${prefix}FlushCardSave`]: () => save,
    _calV2Log: () => {},
    _writeUiFailureSentence: () => 'Save failed',
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(source, `_${prefix}ReviewComment`), context);
  context[`_${prefix}ReviewComment`]('fixture', 'caption');
  assert.equal(frames.at(-1).saving, true, 'controls disabled while the real save is pending');
  assert.equal(post.caption_status, 'Client Approval', 'plain comment preserves status');
  if (reject) rejectSave(new Error('fixture refusal')); else resolveSave();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.saving[key], false, 'save settles');
  assert.equal(frames.at(-1).saving, false, 'settled state reaches visible controls without reload');
  assert.equal(frames.at(-1).draft, '', 'submitted comment is cleared');
  assert.equal(frames.at(-1).error, reject ? 'Save failed' : '', 'failure remains visible');
  console.log(`PASS ${prefix}: ${reject ? 'refused' : 'successful'} comment repaints released controls; status preserved`);
}

(async () => {
  for (const [prefix, file] of [['cal', '190-calendar-approval-comments.js.part'], ['sxr', '280-samples-cards-notes.js.part']]) {
    await prove(prefix, file, false);
    await prove(prefix, file, true);
  }
  console.log('Review comment controls: both surfaces, deferred success and refusal passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

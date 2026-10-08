'use strict';
/*
 * SyncLinear comments: unsent text never crosses audiences into a reply.
 *
 * PR #2000 made Reply carry an unsent comment into the reply instead of wiping
 * it. A reply takes its thread's audience and the composer shows no audience
 * switch for a reply, so an unsent INTERNAL comment carried into a reply on a
 * client-visible thread would have been posted where the client reads it. An
 * independent review found this the same day. Text is now carried only into a
 * thread of the audience it was typed for; otherwise the person is asked and
 * the text is not moved.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function begin(draftAudience, threadAudience) {
  const env = { confirms: [], draft: { body: 'staff-only words', audience: draftAudience, action: 'add', commentId: '', parentId: '' } };
  env.run = new Function('env', 'threadAudience', `
    const _prodComments = { find: () => ({ id: 'c1', body: 'thread', audience: threadAudience, version: 1, row_updated_at: 'T', parent_id: '' }) };
    const _prodCommentDraftFor = () => env.draft;
    const _prodCommentDraftKeep = () => {};
    const _prodRender = () => {};
    const showConfirm = (title, msg, onYes, yesLabel) => env.confirms.push({ msg, onYes, yesLabel });
    const setTimeout = () => 0;
    ${extractFunction(INDEX, '_prodCommentBegin')}
    return _prodCommentBegin;
  `)(env, threadAudience);
  env.run('d1', 'add', 'c1');
  return env;
}

const leak = begin('internal', 'client');
ok(leak.confirms.length === 1 && leak.draft.body === 'staff-only words' && leak.draft.parentId === '',
  'an unsent internal comment is not moved into a reply on a client-visible thread; the person is asked');
if (leak.confirms[0]) leak.confirms[0].onYes();
ok(leak.draft.parentId === 'c1' && leak.draft.body === '' && leak.draft.audience === 'client',
  'choosing to reply starts an empty reply with the thread\'s audience');
const other = begin('client', 'internal');
ok(other.confirms.length === 1 && other.draft.parentId === '' && other.draft.body === 'staff-only words',
  'the same holds the other way round');
const same = begin('internal', 'internal');
ok(same.confirms.length === 0 && same.draft.body === 'staff-only words' && same.draft.parentId === 'c1',
  'text still follows into a reply on a thread of its own audience');
const sameClient = begin('client', 'client');
ok(sameClient.confirms.length === 0 && sameClient.draft.parentId === 'c1' && sameClient.draft.audience === 'client',
  'and a client-visible draft follows into a client-visible thread');

if (failures) { console.log('\n' + failures + ' check(s) failed'); process.exit(1); }
console.log('\nprod-comment-reply-audience: all checks passed');

'use strict';
/*
 * SyncLinear comments: two things the reader could lose or misread.
 *
 * 1. One composer per card. A comment typed and not yet sent was wiped the
 *    moment Reply or Edit was clicked on another comment. Reply must carry the
 *    typed text; Edit must ask before replacing it.
 * 2. A resolved thread printed its stored timestamp as it came
 *    ("Resolved 2026-10-07T18:22:11.482+00:00"). It must read like every other
 *    comment time.
 *
 * The real functions are lifted out of the app and run against stand-ins.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction, stripNonCode } = require('./helpers/extract-function.js');

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const lift = name => extractFunction(INDEX, name);

function composer(draft) {
  const env = { draft, confirms: [], kept: [], renders: 0 };
  env.begin = new Function('env', `
    const comments = { c1: { id: 'c1', body: 'old comment text', audience: 'internal', version: 3, row_updated_at: 'T1', parent_id: '' } };
    const _prodComments = { find: (id, commentId) => comments[commentId] || null };
    const _prodCommentDraftFor = () => env.draft;
    const _prodCommentDraftKeep = (id, draft) => env.kept.push({ body: draft.body, parentId: draft.parentId });
    const _prodRender = () => { env.renders++; };
    const showConfirm = (title, msg, onYes, yesLabel) => env.confirms.push({ title, msg, onYes, yesLabel });
    const setTimeout = () => 0;
    ${lift('_prodCommentBegin')}
    return _prodCommentBegin;
  `)(env);
  return env;
}
const fresh = body => ({ body, audience: 'internal', requestId: '', action: 'add', commentId: '', parentId: '', error: '' });

// --- Reply keeps what was typed ------------------------------------------------
{
  const env = composer(fresh('half a thought I have not sent'));
  env.begin('d1', 'add', 'c1');
  ok(env.draft.body === 'half a thought I have not sent', 'Reply keeps the unsent text in the box');
  ok(env.draft.parentId === 'c1', 'and aims it at the comment being replied to');
  ok(env.kept.length === 1 && env.kept[0].parentId === 'c1', 'the stored copy follows it to that thread');
  ok(env.confirms.length === 0, 'with no question asked');
}

// --- Edit asks before replacing unsent text -----------------------------------
{
  const env = composer(fresh('half a thought I have not sent'));
  env.begin('d1', 'edit', 'c1');
  ok(env.confirms.length === 1, 'Edit asks before replacing an unsent comment');
  ok(env.draft.body === 'half a thought I have not sent' && env.draft.action === 'add',
    'and nothing changes until the reader answers');
  env.confirms[0].onYes();
  ok(env.draft.action === 'edit' && env.draft.body === 'old comment text' && env.draft.commentId === 'c1',
    'saying yes starts the edit');
}

// --- no unsent text: both behave as before --------------------------------------
{
  const env = composer(fresh(''));
  env.begin('d1', 'edit', 'c1');
  ok(env.confirms.length === 0 && env.draft.action === 'edit' && env.draft.body === 'old comment text',
    'Edit with an empty box starts at once');
  const reply = composer(fresh('   '));
  reply.begin('d1', 'add', 'c1');
  ok(reply.draft.body === '' && reply.draft.parentId === 'c1', 'Reply with an empty box starts empty');
}

// --- leaving an edit for a reply does not carry the OLD comment's text -----------
{
  const editing = Object.assign(fresh('old comment text, being edited'), { action: 'edit', commentId: 'c1' });
  const env = composer(editing);
  env.begin('d1', 'add', 'c1');
  ok(env.draft.body === '', 'text from an edit in progress is not turned into a reply');
}

// --- resolved time ---------------------------------------------------------------
{
  const when = new Function(`
    ${lift('_prodCommentTime')}
    ${lift('_prodCommentResolvedWhen')}
    return _prodCommentResolvedWhen;
  `)();
  const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
  ok(when(twoHoursAgo) === '2h ago', 'a resolved time two hours old reads "2h ago"');
  ok(!/T\d\d:\d\d/.test(when(new Date(Date.now() - 40 * 86400000).toISOString())),
    'an older one reads as a date, never a raw timestamp');
  ok(when('some time') === 'some time', 'a value that is not a date is shown as it is');
  const html = stripNonCode(lift('_prodCommentHTML'));
  ok(/_prodCommentResolvedWhen\(c\.resolved_at\)/.test(html) && !/_calEsc\(c\.resolved_at\)/.test(html),
    'the comment line prints the readable form, not the stored value');
}

if (failures) { console.log('\n' + failures + ' check(s) failed'); process.exit(1); }
console.log('\nprod-comment-unsent-and-resolved: all checks passed');

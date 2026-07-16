'use strict';
/*
 * Review-tab "Request change" audience — regression test.
 *
 * Run:  node test/review-request-change-audience.js   (exit 0 = all good)
 *
 * Extracts the REAL _calReviewRequestTweak / _calReviewComment (and the
 * audience helpers they feed into) from ../index.html by name — brace-balanced,
 * robust to line shifts — so we exercise the ACTUAL shipping code.
 *
 * Behaviour under test (the fix): a "Request change" written from the review
 * tab by the SMM (or Kasper) is a TEAM message — audience:'internal', hidden
 * from the client — exactly like a plain review comment. A client's OWN request
 * stays audience:'client' (visible). Before the fix _calReviewRequestTweak set
 * no audience at all, so an SMM tweak fell through _calMsgAudience's default to
 * 'client' and leaked to the client. The component still flips to Tweaks Needed
 * either way; only the thread text is team-only.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

// Extract a top-level `function NAME(...) { ... }` by brace-balancing.
function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

// Stubs for everything the extracted handlers touch that isn't germane to the
// audience contract (persistence, Linear push, repaint, status math). Only the
// audience/role/comment plumbing below is the REAL extracted code.
const HARNESS = `
let _isClientLink = false;
const calState = { posts: [], view: 'smmreview' };
const _calReviewState = { expanded: new Set(), drafts: Object.create(null), saving: Object.create(null), errors: Object.create(null) };
const _calPendingEdits = Object.create(null);
let _mintN = 0;
function _calMintCommentId(){ return 'c_' + (++_mintN); }
function _calCurrentAuthor(){ return _isClientLink ? 'Sidney Laruel' : 'SMM'; }
function computeOverallStatus(){ return 'Tweaks Needed'; }
function _calMarkLocalStatus(){}
function _calReviewMode(){ return (!_isClientLink && calState.view === 'smmreview') ? 'smm' : 'client'; }
function _calComponentsFor(){ return ['caption']; }
function _calReviewComponentActive(){ return true; }   // keep card → repaint path (no remove)
function _calReviewRemoveCard(){}
function _calReviewRepaintCard(){}
function _calClearStaleApprovals(){}
function _calFlushCardSave(){ return Promise.resolve(); }
function _calLinearUrlFor(){ return ''; }     // no Linear counterpart → no push
function _calPostLinearComment(){}
function _writeUiBindRepairAck(){}
function _writeUiMergeCommittedBatch(pending, committed){ Object.assign(pending, committed); }
function _writeUiReportFailure(){}
function showToast(){}
function _calV2Log(){}
function setClient(b){ _isClientLink = b; }
function addPost(p){ calState.posts.push(p); return p; }
function setDraft(pid, comp, val){ _calReviewState.drafts[pid + '|' + comp] = val; _calReviewState.saving[pid + '|' + comp] = false; }
`;

const REAL = [
  grabFunc('_calStringifyComments'),
  grabFunc('_calCommentsFor'),
  grabFunc('_calSetCommentsFor'),
  grabFunc('_calMsgIsTweak'),
  grabFunc('_calMsgAudience'),
  grabFunc('_calNextTweakRound'),
  grabFunc('_calCommentsForView'),
  grabFunc('_calCommentRole'),
  grabFunc('_calReviewComment'),
  grabFunc('_calReviewRequestTweak'),
].join('\n\n');

const mod = new Function(HARNESS + '\n' + REAL +
  ';return { _calReviewRequestTweak, _calReviewComment, _calCommentsForView, _calMsgAudience, _calCommentRole, setClient, addPost, setDraft };')();

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}
function freshPost(id) {
  return mod.addPost({ id, caption_status: 'For SMM Approval', status: 'In Progress',
    caption_comments: [], caption_tweaks: '' });
}
const lastCaption = (p) => p.caption_comments[p.caption_comments.length - 1];

console.log('— Default audience (back-compat safety net) —');
// _calMsgAudience's back-compat default protects untagged TEAM messages: a
// historical review-tab change-request saved with no audience tag still
// resolves to 'internal', so the 99 pre-fix SMM tweaks never leak to clients.
// Only an explicit audience tag — or a client-authored message — is visible.
check('untagged smm tweak defaults to internal (historical leak closed)',
  mod._calMsgAudience({ role: 'smm', is_tweak: true }), 'internal');
check('untagged kasper tweak defaults to internal',
  mod._calMsgAudience({ role: 'kasper', is_tweak: true }), 'internal');
check('untagged client message stays client-visible',
  mod._calMsgAudience({ role: 'client', is_tweak: true }), 'client');

console.log('\n— Historical untagged SMM tweak (no audience field) is hidden from the client —');
// Exactly the shape of the 99 pre-fix rows: role smm, is_tweak true, NO audience.
mod.setClient(true);
const hist = mod.addPost({ id: 'p_hist', caption_status: 'Tweaks Needed', status: 'x',
  caption_comments: [{ id: 'h1', parent_id: null, author: 'SMM', role: 'smm', is_tweak: true,
    body: 'legacy untagged smm note' }], caption_tweaks: '' });
check('legacy untagged SMM tweak is HIDDEN from the client view',
  mod._calCommentsForView(hist, 'caption').some(c => c.body === 'legacy untagged smm note'), false);

console.log('\n— SMM "Request change" from the review tab —');
mod.setClient(false);
const a = freshPost('p_smm');
mod.setDraft('p_smm', 'caption', 'Tighten the hook, please');
mod._calReviewRequestTweak('p_smm', 'caption');
const smmTweak = lastCaption(a);
check('SMM request-change role is "smm"', smmTweak.role, 'smm');
check('SMM request-change is_tweak=true', smmTweak.is_tweak, true);
check('SMM request-change tagged audience=internal', smmTweak.audience, 'internal');
check('component flips to Tweaks Needed', a.caption_status, 'Tweaks Needed');
// The client never sees it: _calCommentsForView on the client surface hides it.
mod.setClient(true);
check('client view HIDES the SMM request-change',
  mod._calCommentsForView(a, 'caption').some(c => c.body === 'Tighten the hook, please'), false);

console.log('\n— SMM plain "Comment" (parity — must also be internal) —');
mod.setClient(false);
const b = freshPost('p_smmc');
mod.setDraft('p_smmc', 'caption', 'FYI internal note');
mod._calReviewComment('p_smmc', 'caption');
check('SMM plain comment tagged audience=internal', lastCaption(b).audience, 'internal');
mod.setClient(true);
check('client view HIDES the SMM plain comment',
  mod._calCommentsForView(b, 'caption').some(c => c.body === 'FYI internal note'), false);

console.log('\n— Client\'s OWN "Request change" (must stay visible, not over-restricted) —');
mod.setClient(true);
// The client acts on a component sitting on THEIR surface (Client Approval); the
// review handlers now guard against a client acting on an off-surface status
// (For SMM / Kasper Approval), so use the realistic status here.
const c = mod.addPost({ id: 'p_cli', caption_status: 'Client Approval', status: 'In Progress',
  caption_comments: [], caption_tweaks: '' });
mod.setDraft('p_cli', 'caption', 'Can we change the thumbnail?');
mod._calReviewRequestTweak('p_cli', 'caption');
const cliTweak = lastCaption(c);
check('client request-change role is "client"', cliTweak.role, 'client');
check('client request-change stays audience=client', cliTweak.audience, 'client');
check('client view SHOWS the client\'s own request',
  mod._calCommentsForView(c, 'caption').some(x => x.body === 'Can we change the thumbnail?'), true);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll review-request-change-audience checks passed.');

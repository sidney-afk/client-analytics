'use strict';
/*
 * YouTube title review (Part A) — lifecycle + invariant regression harness.
 *
 * Run:  node test/title-review-lifecycle.js   (exit 0 = all good)
 *
 * Extracts the REAL functions from ../index.html (by name, brace-balanced — so
 * it tests the ACTUAL shipping code, robust to line shifts) and asserts the
 * core guarantees of the title-review feature:
 *
 *   1. THE INVARIANT: the title NEVER affects the overall card status.
 *      computeOverallStatus ignores title_status entirely, no matter what it is.
 *   2. Gating: the title is a review component ONLY on an engaged YouTube card
 *      (_calComponentsFor); plain / non-YouTube cards behave exactly as before.
 *   3. Migration seeds title_status by normalizing an existing value but NEVER
 *      from the legacy overall `status` (existing cards stay un-engaged).
 *   4. The title flows through the Kasper queue + client review like a no-Linear
 *      component, and never gets a Linear URL.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

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
function grabConst(name) {
  const re = new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm');
  const m = INDEX.match(re);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

// Stubs for globals the extracted code reaches outside the set we pull in.
const STUBS = `
let _isClientLink = false;
function _calIsCollabOn(){ return false; }
function _calMarkKasperSeen(){}
function _calPostPlatforms(post){
  return String((post && post.platforms) || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}
const _CAL_REVIEW_CFG = {
  smm:    { reviewStatus: 'For SMM Approval', approveTo: 'Kasper Approval' },
  client: { reviewStatus: 'Client Approval',  approveTo: 'Approved' },
};
`;

const REAL = [
  grabConst('CAL_STATUSES'), grabConst('CAL_PRIORITY'), grabConst('CAL_COMPONENTS'),
  grabConst('CAL_REVIEW_COMPONENTS'), grabConst('CAL_TITLE_STATUSES'),
  grabFunc('_calNormStatus'), grabFunc('computeOverallStatus'),
  grabFunc('_calIsYouTubeCard'), grabFunc('_calTitleEngaged'), grabFunc('_calComponentsFor'),
  grabFunc('_calLoadCommentsField'), grabFunc('_calMigratePostShape'),
  grabFunc('_calCommentsFor'), grabFunc('_calMsgIsTweak'), grabFunc('_calLinearUrlFor'),
  grabFunc('_calReviewComponentActive'),
  grabFunc('_calCompHasUnresolvedKasperTweak'), grabFunc('_calCompKasperVisible'),
  grabFunc('_calPostKasperVisible'), grabFunc('_kasperUndecidedComps'),
].join('\n\n');

const mod = new Function(STUBS + '\n' + REAL + `
;return { CAL_TITLE_STATUSES, computeOverallStatus, _calComponentsFor, _calMigratePostShape,
  _calLinearUrlFor, _calReviewComponentActive, _calPostKasperVisible, _kasperUndecidedComps };`)();
const {
  CAL_TITLE_STATUSES, computeOverallStatus, _calComponentsFor, _calMigratePostShape,
  _calLinearUrlFor, _calReviewComponentActive, _calPostKasperVisible, _kasperUndecidedComps,
} = mod;

let failures = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}
const yt = (o) => Object.assign({ platforms: 'youtube' }, o);
const ig = (o) => Object.assign({ platforms: 'instagram' }, o);

console.log('— THE INVARIANT: title never touches the overall status —');
// Every title_status value, against a fully-approved card, must leave the overall Approved.
for (const ts of CAL_TITLE_STATUSES.concat([''])) {
  check(`overall stays Approved with title_status="${ts}"`,
    computeOverallStatus(yt({ video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved', title_status: ts })),
    'Approved');
}
// And a Tweaks-Needed title can't drag a Posted card down either.
check('title Tweaks Needed does not lower a Posted card',
  computeOverallStatus(yt({ video_status: 'Posted', graphic_status: 'Posted', caption_status: 'Posted', title_status: 'Tweaks Needed' })),
  'Posted');
// The real worst-of rule still works across the THREE real components.
check('overall still worst-of across the 3 real components',
  computeOverallStatus(yt({ video_status: 'Approved', graphic_status: 'Tweaks Needed', caption_status: 'Approved', title_status: 'Approved' })),
  'Tweaks Needed');

console.log('\n— Gating: title is a review component only on an engaged YouTube card —');
check('YouTube + engaged → title included', _calComponentsFor(yt({ title_status: 'Kasper Approval' })), ['video','graphic','caption','title']);
check('YouTube + not engaged → base 3',     _calComponentsFor(yt({ title_status: '' })),               ['video','graphic','caption']);
check('non-YouTube + title_status set → base 3 (title excluded)', _calComponentsFor(ig({ title_status: 'Kasper Approval' })), ['video','graphic','caption']);
check('no platform → base 3',                _calComponentsFor({ title_status: 'Kasper Approval' }),     ['video','graphic','caption']);

console.log('\n— Migration: seed title_status, never from the legacy overall status —');
// Legacy-only row (only overall `status` set): the 3 real subs seed from it, title stays empty.
const legacy = _calMigratePostShape(yt({ status: 'Approved' }));
check('legacy YouTube card → title_status stays empty', legacy.title_status, '');
check('legacy YouTube card → overall still Approved', legacy.status, 'Approved');
// An explicit (lowercase) title_status is normalized.
check('existing title_status is normalized', _calMigratePostShape(yt({ title_status: 'kasper approval', video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved' })).title_status, 'Kasper Approval');
check('migrate parses title_comments array', Array.isArray(_calMigratePostShape(yt({})).title_comments), true);

console.log('\n— Flow: Kasper queue + client review treat title like a no-Linear component —');
const kReady = yt({ video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved', title_status: 'Kasper Approval' });
check('title at Kasper Approval surfaces the card in Kasper queue', _calPostKasperVisible(kReady), true);
check('title is an undecided component for "Finish reviewing"', _kasperUndecidedComps(kReady), ['title']);
check('same statuses on a NON-YouTube card → not in Kasper queue', _calPostKasperVisible(ig({ video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved', title_status: 'Kasper Approval' })), false);
const cReady = yt({ video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved', title_status: 'Client Approval' });
check('title at Client Approval is active on the client review surface', _calReviewComponentActive(cReady, 'title', 'client'), true);

console.log('\n— Title has no Linear counterpart —');
check('_calLinearUrlFor(title) is empty', _calLinearUrlFor({ linear_issue_id: 'VID-1', graphic_linear_issue_id: 'GRA-1' }, 'title'), '');
check('_calLinearUrlFor(video) still resolves', _calLinearUrlFor({ linear_issue_id: 'VID-1' }, 'video'), 'VID-1');

console.log('');
if (failures) { console.log(`OVERALL: FAIL (${failures})`); process.exit(1); }
console.log('OVERALL: PASS');

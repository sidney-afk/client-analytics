'use strict';
/*
 * Samples (Review) — CLIENT REVIEW SURFACE (M5b) unit suite.
 *
 * Run:  node test/samples-client-surface.js   (exit 0 = all good)
 *
 * Brace-extracts the REAL shipping render-gating + client-review-render
 * functions from ../index.html (by NAME, brace-balanced — robust to line
 * shifts) so we test the ACTUAL code, not a paraphrase. Proves the two
 * contracts the (now real-surface) probe also exercises, but which a unit test
 * pins exactly:
 *
 *   (1) The render-gating predicate _sxrClientCompActive is actionable ONLY at
 *       "Client Approval" or "Tweaks Needed" — and NEVER at "In Progress",
 *       "For SMM Approval", "Kasper Approval", or "Approved".
 *   (2) The client review surface NEVER exposes a field editor: the rendered
 *       client review body contains no field <input>/<textarea data-sxr-fld>
 *       (the SMM-only editable card markers), no _sxrOnFieldInput/_sxrOnFieldBlur
 *       /_sxrOnTextareaInput wiring, and no status-menu / drag-grip affordance.
 *       The ONE textarea present is the review COMPOSER (request-change comment),
 *       which writes a comment via the guarded handler — not a field edit.
 *   (3) The control matrix: Client Approval → Approve + Request-change render;
 *       Tweaks Needed → "Changes requested" (no Approve, follow-up composer);
 *       Approved → a terminal "approved" mini line (no controls); other statuses
 *       → a read-only "in progress" line (no controls).
 *   (4) _sxrIsClientReady (collab-less client posture): hidden while every
 *       component is In Progress; visible once any has left In Progress.
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

// Real status vocab + the real escapers (security-load-bearing — used verbatim).
const REAL = [
  grabConst('CAL_STATUSES'), grabConst('CAL_PRIORITY'),
  grabConst('SXR_COMPONENTS'),
  grabFunc('_calNormStatus'),
  grabFunc('_calEsc'), grabFunc('_calEscAttr'), grabFunc('_jsAttrArg'),
  grabFunc('_sxrParseComments'),
  grabFunc('_sxrCommentsFor'),
  grabFunc('_sxrMsgAudience'),
  grabFunc('_sxrCommentsForView'),
  grabFunc('_sxrFmtCommentTime'),
  // The functions under test (real, verbatim):
  grabFunc('_sxrClientCompActive'),
  grabFunc('_sxrIsClientReady'),
  grabFunc('_sxrClientReviewPreview'),
  grabFunc('_sxrClientReviewPanelHtml'),
  grabFunc('_sxrClientReadonlyLineHtml'),
  grabFunc('_sxrClientReviewBodyHtml'),
].join('\n\n');

// Leaf helpers the render touches but which are not what we're asserting (the
// media preview): stubbed so the test stays network-free + focused. They emit a
// recognizable, EDITOR-FREE preview marker so the "no field editor" assertion is
// meaningful (any field input would have to come from the render itself).
const STUBS = `
const SXR_COMP_LABELS = { video: 'Video', graphic: 'Thumbnail' };
const _SXR_CLIENT_COLLAB = false;
function _sxrDeriveThumb(s){ return String((s && (s.thumbnail_url || s.asset_url)) || ''); }
function _calIsFrameLink(){ return false; }
function _calIsFolderLink(){ return false; }
function _calFolderOpenUrl(u){ return u; }
function _calFrameOpenUrl(u){ return u; }
function _calReviewFrameHtml(u){ return '<a class="cal-review-frame" href="'+u+'">open</a>'; }
const _sxrClientReviewState = { drafts: Object.create(null), saving: Object.create(null), errors: Object.create(null) };
`;

const api = new Function(STUBS + '\n' + REAL + `
;return { _calNormStatus, _sxrClientCompActive, _sxrIsClientReady,
  _sxrClientReviewPanelHtml, _sxrClientReadonlyLineHtml, _sxrClientReviewBodyHtml };`)();

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('✓  ' + m); } else { fail++; console.log('✗  ' + m + (x !== undefined ? '  -> ' + x : '')); } };
const eq = (got, want, msg) => ok(JSON.stringify(got) === JSON.stringify(want), msg + '  (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');

const sample = (vstatus, gstatus, extra) => Object.assign({
  id: 'sr_test_1', name: 'Test', asset_url: 'https://example.com/v.mp4',
  thumbnail_url: 'https://example.com/t.png',
  video_status: vstatus, graphic_status: gstatus,
}, extra || {});

console.log('\n— (1) Render-gating predicate: actionable ONLY at Client Approval / Tweaks Needed —');
const STATUSES = ['In Progress', 'For SMM Approval', 'Kasper Approval', 'Client Approval', 'Tweaks Needed', 'Approved'];
const ACTIONABLE = new Set(['Client Approval', 'Tweaks Needed']);
for (const st of STATUSES) {
  const s = sample(st, 'In Progress');
  eq(api._sxrClientCompActive(s, 'video'), ACTIONABLE.has(st), `video @ "${st}" actionable = ${ACTIONABLE.has(st)}`);
}
// Per-component independence: graphic gate is decided by graphic_status alone.
eq(api._sxrClientCompActive(sample('Approved', 'Client Approval'), 'graphic'), true, 'graphic @ Client Approval actionable even when video is Approved');
eq(api._sxrClientCompActive(sample('Client Approval', 'Kasper Approval'), 'graphic'), false, 'graphic @ Kasper Approval NOT actionable');
// Explicit negatives the suite name calls out.
ok(api._sxrClientCompActive(sample('In Progress', 'In Progress'), 'video') === false, 'NOT actionable at In Progress');
ok(api._sxrClientCompActive(sample('For SMM Approval', 'x'), 'video') === false, 'NOT actionable at For SMM Approval');
ok(api._sxrClientCompActive(sample('Kasper Approval', 'x'), 'video') === false, 'NOT actionable at Kasper Approval');
ok(api._sxrClientCompActive(sample('Approved', 'x'), 'video') === false, 'NOT actionable at Approved');

console.log('\n— (2) Client surface NEVER exposes a field editor —');
// Render a Client-Approval panel (the case that has the MOST controls) + the
// whole body, then assert no field-editor markers leak in.
const caBody = api._sxrClientReviewBodyHtml(sample('Client Approval', 'Client Approval'));
const fieldEditorMarkers = [
  'data-sxr-fld=',        // the editable card's field inputs (name / urls / cd)
  '_sxrOnFieldInput',     // field input wiring
  '_sxrOnFieldBlur',
  '_sxrOnTextareaInput',  // creative-direction textarea wiring
  'sxr-name-input',       // the editable name input
  'sxr-url-row',          // the URL editors
  'sxr-card-grip',        // the drag handle (SMM only)
  'sxr-pill-btn',         // the actionable (clickable) status pill (SMM only)
  '_sxrOpenStatusMenuFor',
  'class="sxr-input',     // any sxr field input
];
for (const mk of fieldEditorMarkers) {
  ok(caBody.indexOf(mk) === -1, `client review body has no "${mk}"`, caBody.indexOf(mk) === -1 ? '' : 'LEAKED');
}
// There is exactly ONE textarea per actionable panel — the review COMPOSER —
// and it carries the review draft attribute, NOT a field attribute.
const taCount = (caBody.match(/<textarea/g) || []).length;
eq(taCount, 2, 'two actionable panels → exactly two composer textareas (one each)');
ok(caBody.indexOf('data-sxr-cl-draft=') !== -1, 'the composer textarea is the review draft (data-sxr-cl-draft), not a field');
ok(caBody.indexOf('<input') === -1, 'no <input> anywhere in the client review body');

console.log('\n— (3) Control matrix per status —');
const vPanelCA = api._sxrClientReviewPanelHtml(sample('Client Approval', 'In Progress'), 'video');
ok(/cal-review-approve-btn/.test(vPanelCA), 'Client Approval → Approve control renders');
ok(/cal-review-tweak-btn/.test(vPanelCA), 'Client Approval → Request-change control renders');
ok(/_sxrClientReviewApprove\(/.test(vPanelCA), 'Approve is wired to _sxrClientReviewApprove');
ok(/_sxrClientReviewRequestChange\(/.test(vPanelCA), 'Request-change is wired to _sxrClientReviewRequestChange');

const vPanelTN = api._sxrClientReviewPanelHtml(sample('Tweaks Needed', 'In Progress'), 'video');
ok(/Changes requested/.test(vPanelTN), 'Tweaks Needed → "Changes requested" state');
ok(!/cal-review-approve-btn/.test(vPanelTN), 'Tweaks Needed → NO Approve control (client cannot approve its own pending request)');
ok(/cal-review-tweak-btn/.test(vPanelTN), 'Tweaks Needed → follow-up composer still present');

const vPanelApproved = api._sxrClientReviewPanelHtml(sample('Approved', 'In Progress'), 'video');
ok(/cal-review-panel-mini/.test(vPanelApproved) && /data-state="approved"/.test(vPanelApproved), 'Approved → terminal mini "approved" line');
ok(!/cal-review-approve-btn/.test(vPanelApproved) && !/cal-review-tweak-btn/.test(vPanelApproved), 'Approved → NO controls');

const roLine = api._sxrClientReadonlyLineHtml(sample('Kasper Approval', 'x'), 'video');
ok(/data-state="readonly"/.test(roLine), 'non-actionable status → read-only "in progress" line');
ok(!/cal-review-approve-btn/.test(roLine) && !/cal-review-tweak-btn/.test(roLine) && roLine.indexOf('<textarea') === -1, 'read-only line → NO controls, no composer');

// Whole-body wiring for a mixed card: video at Client Approval (panel), graphic
// at Kasper Approval (read-only line).
const mixed = api._sxrClientReviewBodyHtml(sample('Client Approval', 'Kasper Approval'));
ok(/data-sxr-cl-comp="video"/.test(mixed) && /cal-review-approve-btn/.test(mixed), 'mixed card: video gets the actionable panel');
ok(/data-state="readonly"/.test(mixed), 'mixed card: graphic (Kasper Approval) gets the read-only line, not a panel');

console.log('\n— (4) _sxrIsClientReady (collab-less client posture) —');
ok(api._sxrIsClientReady(sample('In Progress', 'In Progress')) === false, 'hidden while every component is In Progress');
ok(api._sxrIsClientReady(sample('For SMM Approval', 'In Progress')) === true, 'visible once a component leaves In Progress (For SMM Approval)');
ok(api._sxrIsClientReady(sample('Approved', 'Approved')) === true, 'visible when finished (Approved)');
eq(api._sxrClientReviewBodyHtml(sample('In Progress', 'In Progress')), '', 'a brand-new (In Progress only) card renders NO review body');

console.log(`\nOVERALL: ${fail ? 'FAIL' : 'PASS'}  (pass=${pass} fail=${fail})`);
process.exit(fail ? 1 : 0);

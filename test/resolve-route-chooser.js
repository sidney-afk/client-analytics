'use strict';
/*
 * Resolve-and-route chooser — selective resolve-on-route + the 3-route / ✕-close
 * redesign. Static-structure checks against the real index.html; the behaviour is
 * proven end-to-end by qa/probes (p62 Notes chooser, p57 SMM review, and the new
 * resolve-on-send probe).
 *
 * WHAT THIS GUARDS
 *   • Routing a component onward resolves the open change-requests so they don't
 *     linger in Notes demanding a second, redundant "mark done".
 *   • The resolve is SELECTIVE — only the change-requests the SMM ticks are
 *     marked done; un-ticked ones stay open (the 2+-open case).
 *   • The chooser offers three routes (Kasper / client / Approved) and a ✕ close
 *     that confirms first; the old Cancel button is gone.
 *   • Plain conversation comments (is_tweak false) are NEVER auto-resolved.
 *
 * Run:  node test/resolve-route-chooser.js   (exit 0 = all good)
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
let failures = 0;
const check = (label, got, want) => {
  const ok = got === want; if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${got}, want ${want})`);
};

// ---- chooser markup ----
const overlayAt = INDEX.indexOf('id="resolveDestOverlay"');
const gateAt = INDEX.indexOf('<!-- Password gate', overlayAt);
const overlay = INDEX.slice(overlayAt, gateAt > overlayAt ? gateAt : overlayAt + 3000);
console.log('— chooser markup: 3 routes + ✕ close, no Cancel —');
check('has a Kasper route button',  /id="resolveDestKasper"/.test(overlay), true);
check('has a Client route button',  /id="resolveDestClient"/.test(overlay), true);
check('has an Approve route button (new third route)', /id="resolveDestApprove"/.test(overlay), true);
check('has a ✕ close button',       /id="resolveDestClose"/.test(overlay), true);
check('has a change-request checklist container', /id="resolveDestChecklist"/.test(overlay), true);
check('the old Cancel button is gone', /onclick="_calDismissResolveDest\(\)">Cancel</.test(overlay), false);
check('no discard-confirm screen — ✕ just closes (same in both tabs)', /id="resolveDestDiscard"/.test(overlay), false);
check('✕ button just dismisses the chooser', /id="resolveDestClose"[\s\S]*?onclick="_calDismissResolveDest\(\)"/.test(overlay), true);
check('backdrop click just dismisses the chooser', /if\(event\.target===this\)_calDismissResolveDest\(\)/.test(overlay), true);

// ---- status mapping: Approve → Approved ----
console.log('\n— status mapping: Approve → Approved —');
const autoStatus = grabFunc('_calApplyAutoStatus');
check('smm_resolved_last maps dest "approved" → Approved', /dest === 'approved'\) \? 'Approved'/.test(autoStatus), true);
check('still maps "kasper" → Kasper Approval', /dest === 'kasper'\) \? 'Kasper Approval'/.test(autoStatus), true);

// ---- selective resolver ----
console.log('\n— selective resolver only touches the ticked change-requests —');
const resolver = grabFunc('_calResolveTweaksDone');
check('keys off the ids passed in', /const want = new Set\(ids\)/.test(resolver), true);
check('only marks roots in that set, still-open, undeleted', /want\.has\(c\.id\) && !c\.done && !c\.deleted/.test(resolver), true);
check('stamps done / done_at / done_by', /c\.done = true; c\.done_at = at; c\.done_by = by/.test(resolver), true);
const openFn = grabFunc('_calOpenTweaksForComp');
check('open list = undone, undeleted, non-reply change-requests (is_tweak only)',
  /!c\.parent_id && !c\.deleted && !c\.done && _calMsgIsTweak\(c\)/.test(openFn), true);

// ---- Review-tab send resolves via the chooser ----
console.log('\n— Review-tab "Approve & send" resolves open change-requests —');
const approve = grabFunc('_calReviewApprove');
check('SMM + open change-requests opens the chooser',
  /_calReviewMode\(\) === 'smm' && _calCanResolveComment\(\)[\s\S]*?_calOpenTweaksForComp\(post, comp\)[\s\S]*?_calShowResolveDest/.test(approve), true);
check('chooser resolves ticked, THEN runs the real approve',
  /_calResolveTweaksDone\(post, comp, ids\);[\s\S]*?_calReviewApplyApprove\(pid, comp, pickDest\)/.test(approve), true);
check('no open change-requests → routes directly (unchanged path)',
  /_calReviewApplyApprove\(pid, comp, dest\);/.test(approve), true);
const apply = grabFunc('_calReviewApplyApprove');
check('apply still routes the SMM dest (client / approved / kasper)',
  /dest === 'client' \? 'Client Approval' : \(dest === 'approved' \? 'Approved' : 'Kasper Approval'\)/.test(apply), true);

// ---- checklist only when there is a real choice (2+) ----
console.log('\n— checklist shows only when there is a real choice (2+ open) —');
const show = grabFunc('_calShowResolveDest');
check('renders the checklist when 2+ open', /openTweaks\.length >= 2/.test(show), true);
check('hides the checklist otherwise', /checklist\.hidden = true/.test(show), true);
check('ticked ids = checked rows, or all open when the checklist is hidden',
  /checklist\.hidden\) return openTweaks\.map\(t => t\.id\)/.test(show), true);

// ---- "Mark done — don't change the status" (resolve without routing) ----
console.log('\n— "Mark done" escape: resolve the change-request without moving the status —');
check('chooser markup has the no-route action', /id="resolveDestStay"/.test(overlay), true);
check('the no-route action is NOT a fourth route button (it sits outside the route row)',
  /resolve-dest-actions[\s\S]*?id="resolveDestApprove"[\s\S]*?<\/div>\s*<button[^>]*id="resolveDestStay"/.test(overlay), true);
check('stay button resolves with dest "stay"', /resolveDestStay[\s\S]*?pick\('stay'\)/.test(show), true);
const resolveLast = grabFunc('_calResolveLastTweak');
check('Notes path resolves but SKIPS the status flip on "stay"',
  /destPick !== 'stay'\) _calApplyAutoStatus/.test(resolveLast), true);
check('Review path resolves but SKIPS the approve on "stay" (repaint only)',
  /pickDest === 'stay'\)[\s\S]*?_calReviewRepaintCard[\s\S]*?\} else \{[\s\S]*?_calReviewApplyApprove/.test(approve), true);

// ---- ✕ closes outright in BOTH tabs; "don't change status" stays Notes-only ----
console.log('\n— ✕ closes outright everywhere; the status-stay option is Notes-only —');
check('Review opens the chooser with fromReview:true', /openTweaks: open,\s*fromReview: true,/.test(approve), true);
check('Notes opens the chooser with fromReview:false', /openTweaks: root \? \[root\] : \[\],\s*fromReview: false,/.test(resolveLast), true);
check('chooser hides the "don\'t change status" option when fromReview (Review)', /stayBtn\.hidden = !!opts\.fromReview/.test(show), true);
check('no close-confirm machinery remains (_calResolveDestRequestClose removed)', /_calResolveDestRequestClose/.test(INDEX), false);
check('no confirm-on-close flag remains (_calResolveDestConfirmClose removed)', /_calResolveDestConfirmClose/.test(INDEX), false);
const dismiss = grabFunc('_calDismissResolveDest');
check('_calDismissResolveDest just removes .active (no discard screen toggle)',
  /classList\.remove\('active'\)/.test(dismiss) && !/resolveDestDiscard/.test(dismiss), true);
check('CSS hides the stay button via [hidden]', /\.resolve-dest-stay\[hidden\] \{ display: none; \}/.test(INDEX), true);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll resolve-route-chooser checks passed.');

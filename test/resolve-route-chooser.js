'use strict';
/*
 * Resolve-and-route chooser. Static-structure checks against the real index.html; the behaviour is proven
 * end-to-end by qa/probes (p62 Notes chooser, p57 SMM review) and test/review-stage-one-question-browser.js (the
 * manager's Review tab with open change requests).
 *
 * WHAT THIS GUARDS
 *   • Routing a component onward resolves the open change-requests so they don't
 *     linger in Notes demanding a second, redundant "mark done".
 *   • The Review tab never opens the chooser: the manager's Kasper / client pick IS the answer, every open request on
 *     the part is marked done in the same send (toast with Undo; Settle, 2026-10-18).
 *   • The chooser (now only the Notes "mark done" on the LAST open request) offers three routes (Kasper / client / Approve), a
 *     "Mark done" that routes nowhere, and a ✕ close. No checklist.
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
console.log('— chooser markup: 3 routes (Kasper / client / Approve) + Mark done + ✕ close, no Cancel, no checklist —');
check('has a Kasper route button',  /id="resolveDestKasper"/.test(overlay), true);
check('has a Client route button',  /id="resolveDestClient"/.test(overlay), true);
check('has an Approve route button (the Notes chooser keeps all four options)', /id="resolveDestApprove"/.test(overlay), true);
check('has a ✕ close button',       /id="resolveDestClose"/.test(overlay), true);
check('has NO change-request checklist container', /id="resolveDestChecklist"/.test(overlay), false);
check('the old Cancel button is gone', /onclick="_calDismissResolveDest\(\)">Cancel</.test(overlay), false);
check('no discard-confirm screen — ✕ just closes (same in both tabs)', /id="resolveDestDiscard"/.test(overlay), false);
check('✕ button just dismisses the chooser', /id="resolveDestClose"[\s\S]*?onclick="_calDismissResolveDest\(\)"/.test(overlay), true);
check('backdrop click just dismisses the chooser', /if\(event\.target===this&&this\._backdropPressBegan\)_calDismissResolveDest\(\)/.test(overlay), true);
/* OPEN_REPAIRS 215: a press that starts inside the dialog and releases on the
   backdrop must NOT dismiss it — the plain event.target===this check alone
   cannot tell that apart from a real backdrop click, since `click` dispatches
   at the common ancestor either way. Guard against regressing back to it. */
check('backdrop dismiss requires the press to have begun on the backdrop, not just the click landing there', /data-backdrop-dismiss/.test(overlay), true);

// ---- status mapping: Approve → Approved ----
console.log('\n— status mapping (the helper still maps old queued retries that carry "approved") —');
const autoStatus = grabFunc('_calApplyAutoStatus');
/* The mapping moved into _calAutoResolveDestStatus on 2026-09-05, because
   _calResolveLastTweak has to know where the route is going BEFORE it resolves
   the change-request -- the auto-router now returns false for an empty
   component and its callers ignore the return, so resolving first would close
   the thread and move nothing. Executed here rather than regexed, which is
   stronger than the two checks it replaces. */
const autoDest = new Function(grabFunc('_calAutoResolveDestStatus') + '\nreturn _calAutoResolveDestStatus;')();
check('the router asks the shared helper', /_calAutoResolveDestStatus\(dest\)/.test(autoStatus), true);
check('an old queued retry carrying dest "approved" still maps → Approved', autoDest('approved'), 'Approved');
check('still maps "kasper" → Kasper Approval', autoDest('kasper'), 'Kasper Approval');
check('and "client" → Client Approval', autoDest('client'), 'Client Approval');

// ---- selective resolver ----
console.log('\n— selective resolver only touches the ticked change-requests —');
const resolver = grabFunc('_calResolveTweaksDone');
check('keys off the ids passed in', /const want = new Set\(ids\)/.test(resolver), true);
check('only marks roots in that set, still-open, undeleted', /want\.has\(c\.id\) && !c\.done && !c\.deleted/.test(resolver), true);
check('stamps done / done_at / done_by', /c\.done = true; c\.done_at = at; c\.done_by = by/.test(resolver), true);
const openFn = grabFunc('_calOpenTweaksForComp');
check('open list = undone, undeleted, non-reply change-requests (is_tweak only)',
  /!c\.parent_id && !c\.deleted && !c\.done && _calMsgIsTweak\(c\)/.test(openFn), true);

// ---- Review-tab send resolves with NO chooser ----
console.log('\n— Review-tab "Approve to Kasper / client" resolves open change-requests without a second question —');
const approve = grabFunc('_calReviewApprove');
check('SMM + open change-requests never opens the chooser', /_calShowResolveDest/.test(approve), false);
check('SMM + open change-requests resolves every open one, THEN runs the real approve',
  /_calReviewMode\(\) === 'smm' && _calCanResolveComment\(\)[\s\S]*?_calOpenTweaksForComp\(post, comp\)[\s\S]*?open\.map\(t => t\.id\)[\s\S]*?_calResolveTweaksDone\(post, comp, ids\);[\s\S]*?_calReviewApplyApprove\(pid, comp, pickDest(?:, resolvedBefore(?:, told)?)?\)/.test(approve), true);
check('the destination is the manager\'s own pick: client, else Kasper (never "approved")',
  /const pickDest = dest === 'client' \? 'client' : 'kasper';/.test(approve), true);
check('a refused approve is checked BEFORE any request is marked done',
  /_calReviewBlockReason\(post, comp, _calSmmApproveTo\(pickDest\)\)[\s\S]*?_calResolveTweaksDone\(post, comp, ids\)/.test(approve), true);
check('the send tells the manager how many were marked done, with Undo', /_calTellTweaksDone/.test(approve) && /actionLabel: 'Undo'/.test(grabFunc('_calTellTweaksDone')), true);
check('no open change-requests → routes directly (unchanged path)',
  /_calReviewApplyApprove\(pid, comp, dest\);/.test(approve), true);
const apply = grabFunc('_calReviewApplyApprove');
/* The routing ternary moved into _calSmmApproveTo when the empty-content review
   gate landed (2026-09-05). _calReviewApprove has to know the destination BEFORE
   it resolves the ticked change-requests -- a refused approve must not leave them
   marked done -- and two copies of the rule is how a guard starts answering a
   different question than the thing it guards. So the routing is pinned by
   EXECUTING the shared helper, which is stronger than the regex it replaces, and
   apply is pinned to asking it rather than carrying its own copy. */
const smmDest = new Function(grabFunc('_calSmmApproveTo') + '\nreturn _calSmmApproveTo;')();
check('apply routes the SMM dest through the shared helper', /_calSmmApproveTo\(dest\)/.test(apply), true);
check("routes 'client' to Client Approval", smmDest('client'), 'Client Approval');
check("an old queued retry carrying 'approved' still routes to Approved", smmDest('approved'), 'Approved');
check('routes anything else to Kasper Approval', smmDest('kasper'), 'Kasper Approval');
/* And the chooser's route is NOT this rule. On an unrecognised destination the
   chooser goes to the CLIENT and the approve-onward goes to Kasper, which is why
   they are two functions: one shared helper would make each guard protect the
   wrong move. Asserted so a later "tidy-up" that merges them fails here. */
check('the two destination rules genuinely differ on an unrecognised dest',
  autoDest('') === 'Client Approval' && smmDest('') === 'Kasper Approval', true);

// ---- no checklist: the one request is implied by the route ----
console.log('\n— the chooser has no checklist (it only ever holds the one last request) —');
const show = grabFunc('_calShowResolveDest');
check('no checklist code in the chooser', /checklist|resolve-dest-check/.test(show), false);
check('the Approve button is wired in the chooser', /resolveDestApprove/.test(show) && /aBtn\.onclick = \(\) => pick\('approved'\)/.test(show), true);
check('picks resolve every request passed in', /const allIds = \(\) => openTweaks\.map\(t => t\.id\)/.test(show), true);

// ---- "Mark done — don't change the status" (resolve without routing) ----
console.log('\n— "Mark done" escape: resolve the change-request without moving the status —');
check('chooser markup has the no-route action', /id="resolveDestStay"/.test(overlay), true);
check('the no-route action is NOT a third route button (it sits outside the route row)',
  /resolve-dest-actions[\s\S]*?id="resolveDestApprove"[\s\S]*?<\/div>\s*<button[^>]*id="resolveDestStay"/.test(overlay), true);
check('stay button resolves with dest "stay"', /resolveDestStay[\s\S]*?pick\('stay'\)/.test(show), true);
const resolveLast = grabFunc('_calResolveLastTweak');
check('Notes path resolves but SKIPS the status flip on "stay"',
  /destPick !== 'stay'\) _calApplyAutoStatus/.test(resolveLast), true);

// ---- ✕ closes outright; the chooser is Notes-only ----
console.log('\n— ✕ closes outright; only Notes opens the chooser —');
check('Notes opens the chooser with the one last request', /openTweaks: root \? \[root\] : \[\],/.test(resolveLast), true);
check('the Review tab no longer passes fromReview (the chooser is Notes-only)', /fromReview/.test(INDEX), false);
check('no close-confirm machinery remains (_calResolveDestRequestClose removed)', /_calResolveDestRequestClose/.test(INDEX), false);
check('no confirm-on-close flag remains (_calResolveDestConfirmClose removed)', /_calResolveDestConfirmClose/.test(INDEX), false);
const dismiss = grabFunc('_calDismissResolveDest');
check('_calDismissResolveDest just removes .active (no discard screen toggle)',
  /classList\.remove\('active'\)/.test(dismiss) && !/resolveDestDiscard/.test(dismiss), true);
check('CSS hides the stay button via [hidden]', /\.resolve-dest-stay\[hidden\] \{ display: none; \}/.test(INDEX), true);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll resolve-route-chooser checks passed.');

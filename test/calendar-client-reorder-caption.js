'use strict';
/*
 * Client drag-to-reorder + caption "there's more below" affordance harness.
 *
 * Run:  node test/calendar-client-reorder-caption.js   (exit 0 = all good)
 *
 * Guards two shipped changes against regression. Both are wiring checks on the
 * single-file app (index.html), in the same spirit as the WIRING section of
 * calendar-reorder-smoothness.js — assert the source still carries the fix.
 *
 *  A) CLIENT REORDER (desktop, reuse the existing engine): the Sheet-tab cards
 *     in the client share-link view are draggable and show the grip, going
 *     through the SAME persistCalReorder/optimistic-guard/undo pipeline as the
 *     SMM. The client gate was removed from ONLY the grip + draggable attr —
 *     `ro` (the media/status read-only flag) is untouched, and the copy-card-
 *     link + archive buttons stay SMM-only.
 *
 *  B) CAPTION AFFORDANCE: a collapsed-but-overflowing caption shows a bottom
 *     fade gradient + a "Show more / Show less" pill, and the read-only client
 *     caption is click-to-expand. Plus the measurement-timing hardening
 *     (ResizeObserver + document.fonts.ready) that fixes the intermittent
 *     "I entered the caption but it doesn't expand" report — with a width-only
 *     guard so our own height writes can't loop the observer.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('  ✅ ' + label); } else { fail++; console.log('  ❌ ' + label); } }

console.log('\n============================================================');
console.log('A) CLIENT REORDER — enabled via the existing engine only');
console.log('============================================================');
// draggable attr no longer forces false for the client (ro dropped from it)…
ok(/const draggable = \(isBlank \|\| selectable\) \? 'false' : 'true';/.test(INDEX),
   'draggable attr is gated on isBlank/selectable only (clients can drag)');
ok(!/const draggable = \(isBlank \|\| ro \|\| selectable\)/.test(INDEX),
   'old ro-gated draggable attr is gone (would re-lock clients)');
// …but `ro` itself still governs the media/status surface (NOT removed).
ok(/const ro = _isClientLink && !isBlank;/.test(INDEX),
   'ro (client media/status read-only) is left intact');
// grip shows for the client (gated on isBlank only)…
ok(/\$\{isBlank \? '' : `<span class="cal-card-grip"/.test(INDEX),
   'drag grip renders for clients (gated on isBlank only)');
ok(!/\$\{\(isBlank \|\| _isClientLink\) \? '' : `<span class="cal-card-grip"/.test(INDEX),
   'old client-gated grip is gone');
// …while the SMM-only chrome stays SMM-only.
ok(/\$\{\(isBlank \|\| _isClientLink\) \? '' : `<button class="cal-card-link"/.test(INDEX),
   'copy-card-link button stays SMM-only');
ok(/\$\{\(isBlank \|\| _isClientLink\) \? '' : `<button class="cal-card-del"/.test(INDEX),
   'archive/delete button stays SMM-only');
// the underlying engine is unchanged and client-agnostic (sends the slug).
ok(/body: JSON\.stringify\(\{ client: slug, items \}\)/.test(INDEX),
   'reorder still persists through persistCalReorder with the client slug');
ok(/function _calCanDragCards\(\) \{ return !_isClientLink \|\| _calIsCollabOn\(\); \}/.test(INDEX),
   'collab-gated day-reschedule drag (_calCanDragCards) is untouched — Sheet reorder is separate');

console.log('\n============================================================');
console.log('B) CAPTION — fade + Show more/less + click-to-expand');
console.log('============================================================');
ok(/\.cal-cap-fade \{/.test(INDEX),
   'fade overlay style (.cal-cap-fade) exists');
ok(/\.cal-cap-wrap\.is-clamped \.cal-cap-fade \{ opacity: 1; \}/.test(INDEX),
   'fade is shown only when the caption is clamped (is-clamped)');
ok(/<div class="cal-cap-fade" aria-hidden="true">/.test(INDEX),
   'each caption wrap renders the fade element');
ok(/onclick="_calCaptionWrapClick\(event,this\)"/.test(INDEX),
   'the caption wrap is wired as a click-to-expand target');
ok(/<span class="cal-cap-toggle-txt">Show more<\/span>/.test(INDEX),
   'the toggle is an explicit "Show more" pill, not a bare chevron');
ok(/wrap\.classList\.toggle\('is-clamped', overflowing && !open\)/.test(INDEX),
   '_calRefreshCaption drives is-clamped from overflow + collapsed state');
ok(/\.cal-cap-toggle\.is-expanded \.cal-cap-toggle-txt \{ display: none; \}/.test(INDEX),
   'expanded toggle collapses to an arrow-only button (label hidden) so it does not cover the caption end');
ok(/function _calCaptionWrapClick\(/.test(INDEX) && /if \(!ta \|\| !ta\.readOnly/.test(INDEX),
   'click-to-expand only hijacks the read-only (client) caption');

console.log('\n============================================================');
console.log('C) CAPTION — measurement-timing hardening (the "won\'t expand" bug)');
console.log('============================================================');
ok(/new ResizeObserver\(/.test(INDEX),
   'a ResizeObserver re-measures captions on reveal / resize / rotate');
ok(/if \(ta\._capLastW === w\) continue;/.test(INDEX),
   'the observer re-measures on WIDTH change only — height writes can\'t loop it');
ok(/document\.fonts\.ready/.test(INDEX),
   'a one-shot document.fonts.ready pass re-measures after the webfont swaps');
ok(/_calCapHookFonts\(\);/.test(INDEX) && /ro\.observe\(t\)/.test(INDEX),
   '_calAutosizeTextareas hooks fonts + observes each caption textarea');

console.log('\n============================================================');
console.log('D) CAPTION — focusing a caption disables the card drag');
console.log('============================================================');
// Selecting text inside the caption used to grab the whole card, because the
// card is the HTML5 drag SOURCE (so the dragstart guard's e.target is the card,
// not the textarea). Focusing a caption now clears the card's draggable attr.
ok(/function _calOnCaptionFocus\(ta\) \{ _calCaptionDragLock\(ta, true\);/.test(INDEX),
   'caption focus locks the card drag (_calCaptionDragLock(ta, true))');
ok(/function _calOnCaptionBlur\(ta\)\s+\{ _calCaptionDragLock\(ta, false\);/.test(INDEX),
   'caption blur restores the card drag (_calCaptionDragLock(ta, false))');
ok(/function _calCaptionDragLock\(/.test(INDEX) &&
   /card\.setAttribute\('draggable', 'false'\);/.test(INDEX),
   '_calCaptionDragLock turns the card draggable attr off while focused');
ok(/card\.dataset\.dragPrev = card\.getAttribute\('draggable'\)/.test(INDEX) &&
   /card\.setAttribute\('draggable', card\.dataset\.dragPrev\);/.test(INDEX),
   'it stashes + restores the pre-focus draggable value (blank/select-mode safe)');
ok(/function _calOnCaptionKey\(e, ta\) \{\s*if \(!e\) return;\s*e\.stopPropagation\(\);/.test(INDEX),
   'caption key events stop at the textarea so arrows/Enter/Space do not leak to card/page handlers');
ok(/if \(e\.key !== 'Escape' \|\| !ta\) return;/.test(INDEX) &&
   /ta\.blur\(\);/.test(INDEX),
   'Escape remains the explicit way to leave/collapse the caption field');

console.log('\n============================================================');
console.log('SUMMARY');
console.log('============================================================');
console.log('  ' + (fail === 0 ? 'PASS ✅' : 'FAIL ❌') + '  (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);

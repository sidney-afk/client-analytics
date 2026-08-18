'use strict';
/*
 * "Approve after tweaks" must take the component OUT of Kasper's queue.
 *
 * The button is his explicit pre-clearance: send the tweak, and skip my
 * re-review. The editor fixes it and it routes to the SMM, who can send it
 * straight to the client. It writes two things -- the component drops to
 * "Tweaks Needed", and a kasper tweak comment is posted unresolved.
 *
 * That pair is EXACTLY what the queue predicate matched to re-admit a card,
 * so the component came straight back to him, every time. The clause exists
 * for a plain "Request change" (there he does want it in front of him), so
 * the fix is not to drop it but to make it yield to the pre-clearance flag.
 *
 * Kasper reported this from live use: he pressed the button, and minutes
 * later the card was back in his approvals.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    // Comments are skipped rather than parsed: product comments contain
    // apostrophes ("Kasper's queue"), and treating those as string quotes
    // desynchronises the brace count and slices the wrong span.
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && source[i + 1] === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') { line = true; i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

// --- run the real predicate over real-shaped posts -------------------------
const visibleSrc = extract('_calCompKasperVisible');

function makePredicate() {
  const scope = {
    _calNormStatus: s => String(s || '').trim(),
    _calCompLinked: (post, comp) => comp !== 'graphic' || !!post.graphic_linked,
    _calCompHasUnresolvedKasperTweak: (post, comp) => !!(post._openKasperTweak || {})[comp],
    _calComponentsFor: () => ['video', 'graphic', 'caption'],
  };
  // The pre-clearance reader is EXTRACTED, not stubbed: it carries the
  // per-component rule and the "stop hiding once the work is done" rule, so a
  // stub would leave both untested and quietly pass a broken product.
  const names = Object.keys(scope);
  const body = extract('_calShowApprovedAfterTweaks') + '\n' + visibleSrc
    + '\nreturn _calCompKasperVisible;';
  return new Function(...names, body)(...names.map(n => scope[n]));
}

const visible = makePredicate();

const awaitingApproval = { video_status: 'Kasper Approval' };
ok(visible(awaitingApproval, 'video') === true,
'a component awaiting his approval is in his queue');

// A plain "Request change": he wants to keep seeing it.
const requestedChange = {
  video_status: 'Tweaks Needed',
  _openKasperTweak: { video: true },
  kasper_approved_after_tweaks: '',
};
ok(visible(requestedChange, 'video') === true,
'a plain request-change keeps the component in his queue');

// The bug: "approve after tweaks" writes the SAME pair, plus the flag.
const preCleared = {
  video_status: 'Tweaks Needed',
  _openKasperTweak: { video: true },
  kasper_approved_after_tweaks: 'video',
};
ok(visible(preCleared, 'video') === false,
'approve-after-tweaks takes the component OUT of his queue -- the reported bug');

// The pre-clearance is per component, not per card.
const mixed = {
  video_status: 'Tweaks Needed',
  caption_status: 'Tweaks Needed',
  _openKasperTweak: { video: true, caption: true },
  kasper_approved_after_tweaks: 'video',
};
ok(visible(mixed, 'video') === false && visible(mixed, 'caption') === true,
'pre-clearing the video does not pre-clear the caption on the same card');

// A later genuine re-route back to him must still surface, flag or not:
// _calClearApprovedAfterTweaks drops the flag on a real request-change, and
// clause (a) is deliberately left unscoped.
const reRouted = { video_status: 'Kasper Approval', kasper_approved_after_tweaks: 'video' };
ok(visible(reRouted, 'video') === true,
'a genuine re-route to Kasper Approval still reaches him even with the historical flag');

// The flag stays on the row forever as history, so the reader itself has to
// stop reporting once the work is finished. This is asserted against the
// reader DIRECTLY: routed through the visibility predicate a finished status
// is rejected anyway, so the assertion would hold no matter what the reader
// said, and the rule would go untested.
const showsPreClearance = new Function(
  '_calNormStatus',
  extract('_calShowApprovedAfterTweaks') + '\nreturn _calShowApprovedAfterTweaks;'
)(s => String(s || '').trim());

const inFlight = { video_status: 'Tweaks Needed', kasper_approved_after_tweaks: 'video' };
ok(showsPreClearance(inFlight, 'video') === true,
'the pre-clearance reports while the work is still in flight');
for (const done of ['Approved', 'Scheduled', 'Posted']) {
  ok(showsPreClearance({ video_status: done, kasper_approved_after_tweaks: 'video' }, 'video') === false,
  'the pre-clearance stops reporting once the component is ' + done);
}

// --- the card-stays rule uses the same scoping -----------------------------
const approveComp = extract('_kasperApproveComp');
ok(/_calCompKasperVisible\(item\.post, c\)[\s\S]{0,80}_calCompHasUnresolvedKasperTweak/.test(approveComp),
'the card-stays rule counts only tweaks on components he can still see');
ok(!/const stillHasTweaks = _calPostHasUnresolvedKasperTweak\(item\.post\);/.test(approveComp),
'the card-stays rule no longer counts a pre-cleared component as his open work');

if (failures) process.exit(1);
console.log('\nKasper approve-after-tweaks checks passed');

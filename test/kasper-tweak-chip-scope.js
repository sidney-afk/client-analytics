'use strict';
/*
 * Kasper review-card tweak CHIP counts only what he can see — regression test.
 *
 * Run:  node test/kasper-tweak-chip-scope.js   (exit 0 = all good)
 *
 * Extracts the REAL predicates from ../index.html (by name, brace-balanced) so
 * we test the ACTUAL shipping code, not a paraphrase.
 *
 * BUG (Alli Schaper, "What Happens After 30 Days of Lion's Mane"): the chip on
 * a Kasper review card showed "3 open tweaks", but opening the card showed only
 * 2 comments. The card really had 3 open change-requests — but one of them was a
 * CLIENT tweak on the THUMBNAIL, a component that was never at Kasper Approval
 * and carried no tweak of HIS, so _calCompKasperVisible hides that panel from
 * him. The expanded card filters by _calCompKasperVisible; the chip used the
 * whole-card _calOpenCommentCount, which doesn't. They were written to two
 * different standards.
 *
 * FIX: the chip now uses _kasperOpenTweakCount, which tallies open tweaks the
 * same way but ONLY over Kasper-visible components, so badge == panel. The
 * shared _calOpenCommentCount stays whole-card for the SMM calendar (which DOES
 * render every component).
 *
 * This harness asserts:
 *   • the reported repro: a client tweak on a hidden thumbnail does NOT inflate
 *     the chip (new == 2) while the whole-card count still sees all 3;
 *   • once Kasper ALSO tweaks the thumbnail, that component becomes visible and
 *     its tweaks DO count;
 *   • a component at Kasper Approval counts its tweaks (incl. client ones);
 *   • the unlinked-thumbnail gate holds (a graphic with no GRA link never
 *     counts, even with a tweak on it);
 *   • resolved (done) and deleted tweaks never count.
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

// Kasper context: not a client link, so _calCommentsForView returns the full
// (non-deleted/non-hidden) list — Kasper sees client + his own messages.
const HARNESS = `
let _isClientLink = false;
function _calPostPlatforms(){ return []; }            // test posts aren't YouTube → base 3 comps
function _calMsgAudience(){ return 'internal'; }       // only used on the client-link branch (off here)
`;

const REAL = [
  grabConst('CAL_STATUSES'),
  grabConst('CAL_COMPONENTS'),
  grabConst('CAL_REVIEW_COMPONENTS'),
  grabFunc('_calIsYouTubeCard'),
  grabFunc('_calTitleEngaged'),
  grabFunc('_calComponentsFor'),
  grabFunc('_calNormStatus'),
  grabFunc('_calCommentsFor'),
  grabFunc('_calCommentsForView'),
  grabFunc('_calCommentRoots'),
  grabFunc('_calMsgIsTweak'),
  grabFunc('_calCompHasUnresolvedKasperTweak'),
  grabFunc('_calCompKasperVisible'),
  grabFunc('_calOpenCommentCount'),
  grabFunc('_kasperOpenTweakCount'),
].join('\n\n');

const mod = new Function(HARNESS + '\n' + REAL +
  ';return { _kasperOpenTweakCount, _calOpenCommentCount };')();
const { _kasperOpenTweakCount, _calOpenCommentCount } = mod;

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${got}, want ${want})`);
}

const GRA = 'https://linear.app/x/issue/GRA-6267/x';
function kTweak(id, at)  { return { id, parent_id: null, role: 'kasper', author: 'Kasper', is_tweak: true, body: 'fix', created_at: at, updated_at: at, done: false }; }
function cTweak(id, at)  { return { id, parent_id: null, role: 'client', author: 'Client', is_tweak: true, body: 'note', created_at: at, updated_at: at, done: false }; }
function done(c)         { c.done = true; c.done_at = c.created_at; return c; }
function del(c)          { c.deleted = true; return c; }
function post(o) {
  return Object.assign({
    id: 'p', graphic_linear_issue_id: '',
    video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
    video_comments: [], graphic_comments: [], caption_comments: [],
  }, o);
}
const T = { a: '2026-06-04T10:00:00.000Z', b: '2026-06-18T01:00:00.000Z' };

// R1 — the EXACT reported card: his open video tweak + a client reply on the
// video, plus a CLIENT-ONLY tweak on a linked thumbnail at Tweaks Needed.
const lionsMane = post({
  video_status: 'Tweaks Needed',
  graphic_status: 'Tweaks Needed', graphic_linear_issue_id: GRA,
  caption_status: 'In Progress',
  video_comments:   [kTweak('v-k', T.a), cTweak('v-c', T.b)],
  graphic_comments: [cTweak('g-c', T.b)],
});
console.log('— The reported Lion\'s Mane card —');
check('whole-card count still sees all three (the old chip)', _calOpenCommentCount(lionsMane), 3);
check('Kasper chip counts only his visible component (video) → 2', _kasperOpenTweakCount(lionsMane), 2);

console.log('\n— Once the thumbnail is genuinely his to act on, it DOES count —');
// R2 — Kasper also tweaked the thumbnail → graphic becomes visible (case b).
check('his tweak on the linked thumbnail makes it count → 4',
  _kasperOpenTweakCount(post({
    video_status: 'Tweaks Needed',
    graphic_status: 'Tweaks Needed', graphic_linear_issue_id: GRA,
    video_comments:   [kTweak('v-k', T.a), cTweak('v-c', T.b)],
    graphic_comments: [cTweak('g-c', T.b), kTweak('g-k', T.b)],
  })), 4);

// R3 — graphic back at Kasper Approval (case a) → its tweaks count even if client.
check('thumbnail at Kasper Approval counts its (client) tweak → 3',
  _kasperOpenTweakCount(post({
    video_status: 'Tweaks Needed',
    graphic_status: 'Kasper Approval', graphic_linear_issue_id: GRA,
    video_comments:   [kTweak('v-k', T.a), cTweak('v-c', T.b)],
    graphic_comments: [cTweak('g-c', T.b)],
  })), 3);

console.log('\n— Gates: unlinked thumbnail, resolved, deleted —');
// R4 — unlinked thumbnail (no GRA link): never visible, never counts, even with a tweak.
check('unlinked thumbnail at Tweaks Needed with a tweak → not counted (0)',
  _kasperOpenTweakCount(post({
    graphic_status: 'Tweaks Needed', graphic_linear_issue_id: '',
    graphic_comments: [kTweak('g-k', T.b)],
  })), 0);

// R5 — resolved + deleted tweaks don't count on a visible component.
check('resolved/deleted video tweaks not counted (only the 1 live tweak)',
  _kasperOpenTweakCount(post({
    video_status: 'Tweaks Needed',
    video_comments: [kTweak('v-k', T.a), done(cTweak('v-d1', T.b)), del(cTweak('v-d2', T.b))],
  })), 1);

// R6 — nothing visible at all → 0.
check('no Kasper-visible component → 0',
  _kasperOpenTweakCount(post({ video_status: 'Approved', graphic_status: 'Approved' })), 0);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll kasper-tweak-chip-scope checks passed.');

'use strict';
/*
 * The half-linked card is a different defect from the unlinked one, and the
 * report is only useful if it cannot be confused with its sibling.
 *
 * `scripts/card-linkage-leak-check.js` counts cards born with NO work attached.
 * A card carrying a Linear URL passes that check and is still broken: post-flip,
 * the calendar's status write needs a deliverable ID and refuses with
 * `native_link_required` when only the URL is there. Sebastian pasted GRA-6678
 * onto a card on 2026-08-24 and was refused on his own paste the next morning.
 *
 * So this suite EXECUTES the real classifier from the script and pins the four
 * judgements a single count cannot make:
 *   - a Linear-AUTHORITATIVE team can never produce the refusal, because
 *     legacyParity makes the URL itself the write target,
 *   - a card with neither a link nor an ID is TARGETLESS, not half-linked, and
 *     counting it here would double-count the sibling report's defect,
 *   - an archived or fully-posted slot is real but unreachable, and letting it
 *     into the actionable number is how a big scary total hides the two rows
 *     that matter,
 *   - only a link set AFTER the authority flip proves the creation path is
 *     still open; a pre-flip link was complete and correct when it was made.
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.NATIVE_LINK_GAP_SRC || path.join(ROOT, 'scripts', 'calendar-native-link-gap-check.js');
const { slotBlocked, bucketFor, classify, identifierFrom, SLOTS } = require(SRC);

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

ok(typeof classify === 'function' && typeof slotBlocked === 'function',
  'the real classifier loads and runs (harness is not vacuous)');

const GRAPHIC = SLOTS.find(s => s.component === 'graphic');
const VIDEO = SLOTS.find(s => s.component === 'video');
ok(!!GRAPHIC && !!VIDEO, 'both component slots are declared');

/* The slot names must stay the ones the shipped page reads. `_writeUiNativeId`
   takes graphic_deliverable_id / video_deliverable_id and nothing else; if a
   rename lands there and not here, this report would silently measure a column
   that no longer decides anything. */
ok(GRAPHIC.deliverableColumn === 'graphic_deliverable_id' && GRAPHIC.linkColumn === 'graphic_linear_issue_id',
  'the graphic slot names the columns _writeUiNativeId actually reads');
ok(VIDEO.deliverableColumn === 'video_deliverable_id' && VIDEO.linkColumn === 'linear_issue_id',
  'the video slot names the columns _writeUiNativeId actually reads');

const halfLinked = {
  id: 'card_half', client: 'real-client', status: 'For SMM Approval',
  graphic_status: 'For SMM Approval', video_status: 'In Progress',
  graphic_linear_issue_id: 'https://linear.app/synchro-social/issue/GRA-6678/thumb',
  graphic_deliverable_id: '', linear_issue_id: '', video_deliverable_id: '',
};

const SYNCVIEW = { video: 'linear', graphics: 'syncview' };
const ALL_LINEAR = { video: 'linear', graphics: 'linear' };

ok(slotBlocked(halfLinked, GRAPHIC, SYNCVIEW) === true,
  'a link with no deliverable id on a SyncView-authoritative team is blocked');

/* legacyParity: `!intent.legacyOnly && !legacyParity && !intent.nativeId` can
   never be true while the team is Linear-authoritative. */
ok(slotBlocked(halfLinked, GRAPHIC, ALL_LINEAR) === false,
  'the SAME card is not blocked while the team is still Linear-authoritative');

ok(slotBlocked(halfLinked, VIDEO, SYNCVIEW) === false,
  'a component with neither a link nor an id is targetless, not half-linked');

ok(slotBlocked({ ...halfLinked, graphic_deliverable_id: 'del_x' }, GRAPHIC, SYNCVIEW) === false,
  'a card that carries the deliverable id is not blocked');

/* Reachability. The whole point of the actionable number is that it is small. */
ok(bucketFor({ ...halfLinked, status: 'Archived' }, GRAPHIC) === 'archived',
  'an archived card is counted but not actionable');
ok(bucketFor({ ...halfLinked, status: 'Posted', graphic_status: 'Posted' }, GRAPHIC) === 'settled',
  'card and component both posted is settled, not actionable');
ok(bucketFor({ ...halfLinked, status: 'Posted', graphic_status: 'Tweaks Needed' }, GRAPHIC) === 'actionable',
  'a posted card whose thumbnail is NOT done is still actionable');
ok(bucketFor(halfLinked, GRAPHIC) === 'actionable',
  'a live card mid-approval is actionable');

ok(identifierFrom('https://linear.app/synchro-social/issue/GRA-6678/natalie-thumb') === 'GRA-6678',
  'the Linear identifier is read out of the URL');
ok(identifierFrom('') === '', 'a missing URL yields no identifier rather than a guess');

/* End to end, including the post-flip split. */
const FLIP = '2026-08-16T19:58:55Z';
const cards = [
  halfLinked,
  { ...halfLinked, id: 'card_preflip' },
  { ...halfLinked, id: 'card_archived', status: 'Archived' },
  { ...halfLinked, id: 'card_settled', status: 'Posted', graphic_status: 'Posted' },
  { ...halfLinked, id: 'card_ok', graphic_deliverable_id: 'del_ok' },
  // The TEST client's drill fixtures are the bulk of the raw count and none of
  // the problem; letting them in makes the number unreadable.
  { ...halfLinked, id: 'card_test', client: 'sidneylaruel' },
];
const linkSetAt = {
  'card_half|graphic': '2026-08-24T23:22:37Z', 'card_half|graphic|actor': 'Sebastian',
  'card_preflip|graphic': '2026-08-01T10:00:00Z', 'card_preflip|graphic|actor': 'Analia',
  'card_test|graphic': '2026-08-24T09:00:00Z', 'card_test|graphic|actor': 'SyncView',
};
const report = classify(cards, SYNCVIEW, linkSetAt, FLIP);

ok(report.totals.blocked === 4,
  'blocked counts every real-client half-linked slot: ' + report.totals.blocked);
ok(report.totals.archived === 1 && report.totals.settled === 1,
  'the unreachable buckets are separated out');
ok(report.totals.actionable === 2,
  'actionable is only what someone can still hit: ' + report.totals.actionable);
ok(report.totals.post_flip === 1,
  'only the link set after the flip proves the creation path is open: ' + report.totals.post_flip);
ok(report.post_flip.length === 1 && report.post_flip[0].id === 'card_half'
  && report.post_flip[0].link_set_by === 'Sebastian',
  'the post-flip row names the card and who set the link');
ok(!report.actionable.some(r => r.id === 'card_test'),
  'the TEST client never reaches the actionable list');
ok(report.actionable[0].id === 'card_half',
  'the newest link sorts first, so the freshest breakage is the first thing read');

/* A card with no recorded link_set event must not be assumed post-flip: the
   events table does not reach back far enough, and guessing would report an
   open leak every run. */
const noEvents = classify([halfLinked], SYNCVIEW, {}, FLIP);
ok(noEvents.totals.actionable === 1 && noEvents.totals.post_flip === 0,
  'a slot with no link_set event is actionable but never counted as post-flip');

if (failures) { console.error('\ncalendar-native-link-gap-check checks FAILED: ' + failures); process.exit(1); }
console.log('\ncalendar native-link gap classifier checks passed');

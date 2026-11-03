'use strict';
/*
 * V2 (plan combined.md row V2; variants.md 4.3): import several versions' video links from a Frame folder in one
 * all-or-nothing write (trial-reels versions_import). Offline, Node, against supabase/functions/trial-reels/logic.mjs.
 *
 * The plan (importPlan) decides everything before anything is written: new letters become new rows, existing letters
 * take the link by today's link rules (a replaced link on an answered version starts it again), and anything wrong
 * refuses the whole import.
 */
const path = require('node:path');
let passed = 0;
const failures = [];
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const EARLY = '2026-11-02T08:00:00.000Z';
  const LINK = (l) => 'https://f.io/fixture-' + l.toLowerCase();
  const F = (n) => 'https://next.frame.io/share/fixture-share/view/fixture-file-' + n;
  const v = (letter, over) => Object.assign({ id: 'id-' + letter, letter, status: 'waiting', frame_url: LINK(letter), revision: 0, updated_at: '2026-11-02T09:00:00.000Z' }, over || {});
  const plan = (vs, items) => L.importPlan(vs, items, LINK('A'));

  ok(L.ACTIONS.includes('versions_import') && !L.CLIENT_ACTIONS.includes('versions_import'), 'versions_import is a staff action');
  ok(L.staffAllows('admin', 'versions_import') && L.staffAllows('smm', 'versions_import') && L.staffAllows('creative', 'versions_import') && !L.staffAllows('automation', 'versions_import'),
    'admin, SMM and an editor may import (an editor pastes links today); never the automation key');

  // New letters become new rows; nothing else moves.
  let r = plan([v('A')], [{ letter: 'B', link: F(1) }, { letter: 'C', link: F(2) }]);
  ok(!r.error && r.inserts.map((x) => x.letter + '=' + x.link).join() === 'B=' + F(1) + ',C=' + F(2) && r.updates.length === 0, 'B and C are added as new versions');

  // An existing letter takes the new link by today's rules.
  r = plan([v('A'), v('B', { frame_url: null })], [{ letter: 'B', link: F(1) }]);
  ok(!r.error && r.updates.length === 1 && r.updates[0].letter === 'B' && r.updates[0].patch.frame_url === F(1) && !r.updates[0].restarted, 'B with no link yet just takes the link');
  r = plan([v('A'), v('B', { status: 'approved', smm_ok_at: EARLY, kasper_ok_at: EARLY, client_ok_at: EARLY })], [{ letter: 'B', link: F(1) }]);
  ok(r.updates[0].restarted === true && r.updates[0].patch.status === 'waiting' && r.updates[0].patch.smm_ok_at === null && r.updates[0].patch.revision === 1,
    'a new link on an approved B starts it again through the SMM, as a pasted link does');
  ok(r.replacesAnswered.join() === 'B', 'and the plan says so, so the page asks first');
  r = plan([v('A'), v('B', { status: 'change asked', change_by: 'client', change_note: 'x', change_at: EARLY })], [{ letter: 'B', link: F(1) }]);
  ok(r.updates[0].restarted === true && r.replacesAnswered.length === 0, 'a version waiting for its new cut takes it without a question');
  r = plan([v('A'), v('B', { frame_url: F(1) })], [{ letter: 'B', link: F(1) }]);
  ok(!r.error && r.updates.length === 0 && r.inserts.length === 0, 'the same link again changes nothing');

  // Refusals: the whole import, before anything is written.
  ok(plan([v('A')], []).error === 'nothing_to_import' && plan([v('A')], null).error === 'nothing_to_import', 'nothing to import is refused');
  ok(plan([v('A')], Array.from({ length: 8 }, (_, i) => ({ letter: 'B', link: F(i) }))).error === 'too_many_versions', 'more than seven is refused');
  ok(plan([v('A')], [{ letter: 'H', link: F(1) }]).error === 'letter_invalid' && plan([v('A')], [{ letter: 'b', link: F(1) }]).error === 'letter_invalid', 'only the letters A to G');
  ok(plan([v('A')], [{ letter: 'B', link: F(1) }, { letter: 'B', link: F(2) }]).error === 'letter_twice', 'one letter twice is refused');
  ok(plan([v('A')], [{ letter: 'B', link: F(1) }, { letter: 'C', link: F(1) }]).error === 'link_twice', 'one video on two letters is refused');
  ok(plan([v('A')], [{ letter: 'B', link: 'http://f.io/x' }]).error === 'link_not_https' && plan([v('A')], [{ letter: 'B', link: 'https://example.com/x' }]).error === 'link_host_unsupported',
    'each link passes today\'s link rule');
  ok(plan([v('A')], [{ letter: 'B', link: '' }]).error === 'version_has_no_link', 'an empty link is refused');
  ok(plan([v('A')], [{ letter: 'A', link: F(1) }]).error === 'version_is_card', 'the version on the card is changed from its own row (today\'s attach), not here');
  ok(plan([v('A'), v('B', { frame_url: F(1) })], [{ letter: 'C', link: F(1) }]).error === 'link_used_by_another_version', 'a video another version already has is refused');
  ok(plan([v('A'), v('B', { status: 'dropped' })], [{ letter: 'B', link: F(1) }]).error === 'version_dropped', 'a dropped version: Bring back first');
  ok(plan([v('A', { status: 'on trial' }), v('B', { status: 'on trial' })], [{ letter: 'C', link: F(1) }]).error === 'version_on_trial', 'nothing is imported once the trial has started');
  ok(plan([], [{ letter: 'A', link: F(1) }]).error === 'attach_first', 'a card with no version yet: Video A goes on the card first');
  ok(plan([v('A'), v('B')], [{ letter: 'C', link: F(1) }, { letter: 'D', link: 'nope' }]).error === 'link_not_https', 'one bad row refuses the whole import');

  console.log(`\ntrial-versions-import-logic: ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

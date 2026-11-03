'use strict';
/*
 * V3 (plan combined.md row V3): each trial version's own thumbnail and caption, the effective read, and the winner copy
 * onto the card. Offline, Node, against supabase/functions/trial-reels/logic.mjs.
 *
 * The rule (combined.md section 2, row 2): coalesce(version.field, card.field). The version on the card is the card
 * (its fields are the card's own and cannot be set on its row). The winner copy and its Undo are the page's
 * (test/trial-version-fields-browser.js).
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
let passed = 0;
const failures = [];
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }

(async () => {
  const L = await import(path.join(ROOT, 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const NOW = '2026-11-02T10:00:00.000Z';
  const EARLY = '2026-11-02T08:00:00.000Z';
  const CARD = { thumbnail_url: 'https://e.example/card-thumb.jpg', caption: 'The card caption' };
  const LINK = (l) => 'https://f.io/fixture-' + l.toLowerCase();
  const v = (letter, over) => Object.assign({ id: 'id-' + letter, letter, status: 'waiting', frame_url: LINK(letter), revision: 0,
    thumbnail_url: null, caption: null, updated_at: '2026-11-02T09:00:00.000Z' }, over || {});
  const three = () => ['A', 'B', 'C'].map((l) => v(l));
  const fields = (vs, letter, body) => L.versionFieldsPatch(vs, Object.assign({ letter, mainLink: LINK('A') }, body));

  // The effective rule.
  ok(JSON.stringify(L.effectiveFields(v('B'), CARD)) === JSON.stringify(CARD), 'an empty version reads the card\'s thumbnail and caption');
  ok(JSON.stringify(L.effectiveFields(v('B', { caption: 'Own caption' }), CARD)) === JSON.stringify({ thumbnail_url: CARD.thumbnail_url, caption: 'Own caption' }),
    'a set field wins, the other still reads the card');
  ok(JSON.stringify(L.effectiveFields(v('B'), {})) === JSON.stringify({ thumbnail_url: null, caption: null }), 'nothing anywhere reads null, not undefined');

  // The read carries both: each version's own fields (staff) and its effective ones (everyone).
  const vs = [v('A'), v('B', { thumbnail_url: 'https://e.example/b.jpg', caption: 'B caption' }), v('C')];
  const staff = L.readShape(vs, { client: false, mainLink: LINK('A'), cardStatus: 'For SMM Approval', card: CARD });
  const row = (shape, l) => shape.versions.find((x) => x.letter === l);
  ok(row(staff, 'B').thumbnail_url === 'https://e.example/b.jpg' && row(staff, 'B').caption === 'B caption', 'a staff read carries B\'s own fields');
  ok(row(staff, 'C').thumbnail_url === null && row(staff, 'C').caption === null, 'and C\'s empty ones as null ("Same as the card")');
  ok(JSON.stringify(row(staff, 'B').effective) === JSON.stringify({ thumbnail_url: 'https://e.example/b.jpg', caption: 'B caption' }), 'B\'s effective fields are its own');
  ok(JSON.stringify(row(staff, 'C').effective) === JSON.stringify(CARD) && JSON.stringify(row(staff, 'A').effective) === JSON.stringify(CARD), 'A and C read the card');
  const cli = L.readShape(vs, { client: true, mainLink: LINK('A'), cardStatus: 'Client Approval', card: CARD });
  ok(JSON.stringify(row(cli, 'B').effective) === JSON.stringify({ thumbnail_url: 'https://e.example/b.jpg', caption: 'B caption' }) && !('caption' in row(cli, 'B')),
    'a client read carries the effective fields only');
  ok(JSON.stringify(row(L.readShape(vs, { client: false, mainLink: LINK('A'), cardStatus: '' }), 'C').effective) === JSON.stringify({ thumbnail_url: null, caption: null }),
    'a read with no card fields (an older caller) still answers, with nulls');

  // Setting a version's fields.
  let r = fields(three(), 'B', { thumbnail_url: 'https://e.example/b.jpg', caption: 'Stop doing this' });
  ok(!r.error && r.patch.thumbnail_url === 'https://e.example/b.jpg' && r.patch.caption === 'Stop doing this', 'B gets its own thumbnail and caption');
  r = fields(three(), 'B', { caption: 'Only the caption' });
  ok(!r.error && r.patch.caption === 'Only the caption' && !('thumbnail_url' in r.patch), 'a field left out of the request is left as it is');
  r = fields([v('A'), v('B', { caption: 'x', thumbnail_url: 'https://e.example/x.jpg' }), v('C')], 'B', { caption: '', thumbnail_url: '  ' });
  ok(!r.error && r.patch.caption === null && r.patch.thumbnail_url === null, 'an empty field goes back to "Same as the card" (null)');
  ok(fields(three(), 'B', { thumbnail_url: 'http://e.example/b.jpg' }).error === 'thumbnail_not_https', 'a thumbnail must be https');
  ok(fields(three(), 'B', { thumbnail_url: 'https://' + 'a'.repeat(2041) }).error === 'thumbnail_too_long', 'a thumbnail at most 2048 characters');
  ok(fields(three(), 'B', { thumbnail_url: 'https://user:pw@e.example/b.jpg' }).error === 'thumbnail_not_https', 'a thumbnail address with a credential in it is refused');
  ok(fields(three(), 'B', { caption: 'a'.repeat(4001) }).error === 'caption_too_long' && !fields(three(), 'B', { caption: 'a'.repeat(4000) }).error, 'a caption at most 4000 characters');
  ok(fields(three(), 'B', {}).error === 'nothing_to_set', 'a request with neither field is refused');
  ok(fields(three(), 'A', { caption: 'x' }).error === 'version_is_card', 'the version on the card is the card: its fields are set on the card');
  ok(fields(three(), 'F', { caption: 'x' }).error === 'version_not_found', 'an unknown letter is refused');
  ok(fields([v('A'), v('B', { status: 'dropped' })], 'B', { caption: 'x' }).error === 'version_dropped', 'a dropped version is refused');
  for (const s of ['on trial', 'winner', 'lost']) ok(fields([v('A'), v('B', { status: s })], 'B', { caption: 'x' }).error === 'version_on_trial', 'a version ' + s + ' cannot change');
  r = fields([v('A'), v('B', { caption: 'Same' })], 'B', { caption: 'Same' });
  ok(!r.error && r.patch === null, 'the same value again changes nothing');

  // A change on an answered version starts it again, as a replaced video link does (linkChange).
  r = fields([v('A'), v('B', { status: 'approved', smm_ok_at: EARLY, kasper_ok_at: EARLY, client_ok_at: EARLY })], 'B', { caption: 'New words' });
  ok(r.patch.status === 'waiting' && r.patch.revision === 1 && r.patch.smm_ok_at === null && r.patch.kasper_ok_at === null && r.patch.client_ok_at === null && r.restarted === true,
    'a new caption on an approved version starts it again through the SMM');
  r = fields([v('A'), v('B', { smm_ok_at: EARLY })], 'B', { thumbnail_url: 'https://e.example/n.jpg' });
  ok(r.restarted === true && r.patch.smm_ok_at === null, 'a new thumbnail on a version the SMM passed starts it again');
  r = fields(three(), 'B', { caption: 'First words' });
  ok(!r.restarted && !('status' in r.patch), 'a first caption on a version nobody answered just saves');

  // Before F2's columns are applied the rows carry no caption key: the action refuses, nothing else changes.
  ok(L.fieldsAvailable([{ id: 'x', letter: 'A', caption: null, thumbnail_url: null }]) === true && L.fieldsAvailable([{ id: 'x', letter: 'A' }]) === false,
    'fieldsAvailable: true only when the rows carry the new columns');
  ok(L.ACTIONS.includes('version_fields_set') && !L.CLIENT_ACTIONS.includes('version_fields_set'), 'version_fields_set is a staff action');
  ok(L.staffAllows('admin', 'version_fields_set') && L.staffAllows('smm', 'version_fields_set') && L.staffAllows('creative', 'version_fields_set') && !L.staffAllows('automation', 'version_fields_set'),
    'admin, SMM and an editor may set a version\'s thumbnail and caption; never the automation key');

  // Supervisor's guard 3: every letter's effective fields before the pick, after it (the card now carries the winner's)
  // and after Undo (the card's own back). A version that lost never reads the winner's fields as if they were its own.
  {
    const CARD_B = { thumbnail_url: 'https://e.example/b.jpg', caption: 'B words' };
    const base = (st) => [v('A', { status: st }), v('B', { status: st, thumbnail_url: CARD_B.thumbnail_url, caption: CARD_B.caption }), v('C', { status: st })];
    const eff = (vs, card, winner, client) => {
      const shape = L.readShape(L.settleWinner(vs, winner), { client: !!client, mainLink: winner ? LINK(winner) : LINK('A'), cardStatus: 'Posted', card });
      return Object.fromEntries(shape.versions.map((x) => [x.letter, x.effective]));
    };
    const before = eff(base('on trial'), CARD, null);
    ok(JSON.stringify(before.A) === JSON.stringify(CARD) && JSON.stringify(before.B) === JSON.stringify(CARD_B) && JSON.stringify(before.C) === JSON.stringify(CARD),
      'before the pick: A and C read the card, B its own');
    const after = eff(base('on trial'), CARD_B, 'B');
    ok(JSON.stringify(after.B) === JSON.stringify(CARD_B), 'after B wins (the card now carries B\'s): B reads its own');
    ok(JSON.stringify(after.A) === JSON.stringify({ thumbnail_url: null, caption: null }) && JSON.stringify(after.C) === JSON.stringify({ thumbnail_url: null, caption: null }),
      'and A and C, which lost, never read B\'s as their own');
    const cliAfter = eff(base('on trial'), CARD_B, 'B', true);
    ok(Object.keys(cliAfter).join() === 'B' && JSON.stringify(cliAfter.B) === JSON.stringify(CARD_B), 'the client link sees only the winner, with its own fields');
    const undone = eff(base('on trial'), CARD, null);
    ok(JSON.stringify(undone) === JSON.stringify(before), 'after Undo (the card\'s own back): every letter reads as before the pick');
  }

  // trial-reels still never writes the card itself: the page copies through today's card save.
  const code = fs.readFileSync(path.join(ROOT, 'supabase/functions/trial-reels/logic.mjs'), 'utf8') + fs.readFileSync(path.join(ROOT, 'supabase/functions/trial-reels/index.ts'), 'utf8');
  ok(!/\.from\("calendar_posts"\)\s*\.(update|insert|upsert)/.test(code), 'trial-reels never writes calendar_posts');

  console.log(`\ntrial-version-fields-logic: ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

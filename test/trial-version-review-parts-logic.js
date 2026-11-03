'use strict';
/*
 * V4 (plan combined.md row V4): Ask for a change on the review page picks the part of a version it is about (video,
 * thumbnail or caption). Offline, Node, against supabase/functions/trial-reels/logic.mjs: the part is stored with the
 * change (F2's change_part; null is the video, today's meaning), read back, refused when unknown or on an approve, and
 * cleared whenever the version starts again. The page side is test/trial-version-review-parts-browser.js.
 */
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
let passed = 0;
const failures = [];
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }

(async () => {
  const L = await import(path.join(ROOT, 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const NOW = '2026-11-03T10:00:00.000Z';
  const LINK = (l) => 'https://f.io/fixture-' + l.toLowerCase();
  const CARD = { thumbnail_url: 'https://e.example/card-thumb.jpg', caption: 'The card caption' };
  const v = (letter, over) => Object.assign({ id: 'id-' + letter, letter, status: 'waiting', frame_url: LINK(letter), revision: 0, smm_ok_at: null, kasper_ok_at: null,
    client_ok_at: null, client_pass_at: null, change_by: null, change_note: null, change_at: null, change_part: null, thumbnail_url: null, caption: null }, over || {});
  const three = () => ['A', 'B', 'C'].map((l) => v(l));
  const change = (vs, part, extra) => L.answerPatches(vs, Object.assign({ stage: 'smm', kind: 'change', letter: 'B', note: 'Brighter', cardStatus: 'For SMM Approval', part }, extra || {}), NOW);

  ok(JSON.stringify(L.CHANGE_PARTS) === JSON.stringify(['video', 'thumbnail', 'caption']), 'the three parts of a version: video, thumbnail, caption');
  const t = change(three(), 'thumbnail');
  ok(!t.error && t.patches.length === 1 && t.patches[0].patch.change_part === 'thumbnail' && t.patches[0].patch.status === 'change asked',
    'a change on Video B\'s thumbnail is stored with its part');
  ok(change(three(), 'Caption').patches[0].patch.change_part === 'caption', 'the part is read in any case');
  const vid = change(three(), 'video');
  ok(Object.prototype.hasOwnProperty.call(vid.patches[0].patch, 'change_part') && vid.patches[0].patch.change_part === null, 'a change on the video writes null (today\'s meaning)');
  const none = change(three(), undefined);
  ok(!Object.prototype.hasOwnProperty.call(none.patches[0].patch, 'change_part'), 'a change with no part (a page from before) writes no part at all');
  ok(change(three(), 'sound').error === 'part_invalid', 'an unknown part is refused');
  ok(L.answerPatches(three(), { stage: 'smm', kind: 'approve', letter: 'B', cardStatus: 'For SMM Approval', part: 'thumbnail' }, NOW).error === 'part_change_only',
    'a part on an approve is refused: one Approve covers every part of the version');
  ok(change(three(), 'caption', { note: '' }).error === 'note_required', 'a part does not lift the note a change needs');

  // Read back, and only while the change is open.
  const asked = three().map((x) => (x.letter === 'B' ? Object.assign({}, x, t.patches[0].patch) : x));
  const staff = L.readShape(asked, { client: false, mainLink: LINK('A'), cardStatus: 'For SMM Approval', card: CARD });
  const client = L.readShape(asked, { client: true, mainLink: LINK('A'), cardStatus: 'For SMM Approval', card: CARD });
  ok(staff.versions.find((x) => x.letter === 'B').change_part === 'thumbnail' && staff.versions.find((x) => x.letter === 'A').change_part === null,
    'a staff read carries the part of B\'s change, and null on A');
  ok(client.versions.every((x) => Object.prototype.hasOwnProperty.call(x, 'change_part')), 'a client read carries the part too (it is the client\'s own words\' part)');
  const stale = three().map((x) => (x.letter === 'C' ? Object.assign({}, x, { change_part: 'caption' }) : x));
  ok(L.readShape(stale, { client: false, mainLink: LINK('A'), cardStatus: 'For SMM Approval', card: CARD }).versions.find((x) => x.letter === 'C').change_part === null,
    'a part left on a version with no open change reads null');

  // Cleared whenever the version starts again.
  const b = asked.find((x) => x.letter === 'B');
  ok(L.newCutPatch(asked, 'B').patch.change_part === null, 'a new cut clears the part');
  ok(L.versionFieldsPatch(asked, { letter: 'B', thumbnail_url: 'https://e.example/b2.jpg', mainLink: LINK('A') }).patch.change_part === null,
    'a new thumbnail on B (V3) starts it again and clears the part');
  ok(L.linkPatch(asked, 'B', 'https://f.io/fixture-b2', LINK('A')).patch.change_part === null, 'a new video link clears the part');
  ok(!Object.prototype.hasOwnProperty.call(L.newCutPatch(three().map((x) => (x.letter === 'B' ? Object.assign({}, x, { status: 'change asked' }) : x)), 'B').patch, 'change_part'),
    'a version with no part set writes no part key (a row from before the column)');
  ok(b.change_part === 'thumbnail', 'the fixture really had the part set');

  console.log('\ntrial-version-review-parts-logic: ' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });

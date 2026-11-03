'use strict';
/* trial-versions-fields-import-live-check.js -- the V2+V3 live check's own rules, offline (OPEN_REPAIRS 660).
 *
 * scripts/trial-versions-fields-import-live-check.js writes on the live test client, so it is proven here first,
 * against a fake backend whose trial-reels answers with V2's and V3's real rules (logic.mjs readShape,
 * versionFieldsPatch, importPlan, dropPatch): the read-only refusals come before any write; a full run sets and
 * clears a version's fields, imports a share's new videos, sees the same video refused under another letter, and puts
 * everything back; a run with no source letter does V3 only; a share holding nothing new shows only the refusal; a card
 * written by the function or a failure mid-run fails the run and still puts things back; the summary carries no id,
 * client, link or key; and the workflow has no input that takes a link (its inputs are printed on the public run page).
 * The client is fictional.
 */
const assert = require('assert');
const path = require('path');
const C = require('../scripts/trial-versions-fields-import-live-check.js');
const V1 = require('../scripts/trial-version-status-live-check.js');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed += 1; console.log('  ok  ' + msg); }

const CLIENT = 'fixture-test-client';
const HASH = V1.sha256(CLIENT);
const CARD = 'p_fixture_card_660';
const LINK = (n) => 'https://next.frame.io/share/00000000-0000-4000-8000-000000000001/view/00000000-0000-4000-8000-00000000000' + n;
let L = null;

function backend(over = {}) {
  const st = {
    card: { id: CARD, client: CLIENT, video_status: 'For SMM Approval', updated_at: '2026-11-03T09:00:00.000Z', caption: 'The card caption, fixture.',
      thumbnail_url: over.cardThumb === undefined ? 'https://e.example/fixture-card-thumb.jpg' : over.cardThumb, asset_url: LINK(1),
      video_deliverable_id: null, graphic_deliverable_id: null, ...(over.card || {}) },
    enabled: over.enabled !== false,
    versions: over.versions || ['A', 'B', 'C'].map((l, i) => ({ id: 'v' + l, letter: l, status: 'waiting', frame_url: LINK(i + 1), smm_ok_at: null, kasper_ok_at: null,
      client_ok_at: null, client_pass_at: null, change_by: null, change_note: null, change_at: null, revision: 0, thumbnail_url: null, caption: null })),
    listed: over.listed || [{ file_id: 'f2', link: LINK(2), processing: false }, { file_id: 'f8', link: LINK(8), processing: false }, { file_id: 'f9', link: LINK(9), processing: false }],
    events: [], writes: 0, switchCalls: [], calls: [], listLinks: [],
  };
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const shape = () => L.readShape(st.versions, { client: false, mainLink: st.card.asset_url, cardStatus: st.card.video_status, card: st.card });
  const ledger = (action, letters) => { if (over.noFieldsEvents && action === 'trial_version_fields_set') return; for (const l of letters) st.events.push({ action, payload: { letter: l } }); };
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/rest/v1/')) {
      const table = u.pathname.slice('/rest/v1/'.length);
      if (over.breakAfterImport && st.imported && !st.broke) { st.broke = true; return reply(503, { message: 'down' }); }
      if (table === 'calendar_posts') return reply(200, u.searchParams.get('id') === 'eq.' + CARD ? [{ ...st.card }] : []);
      if (table === 'production_deliverables_browser_v1') return reply(200, []);
      if (table === 'calendar_post_events') { const a = (u.searchParams.get('action') || '').replace(/^eq\./, ''); return reply(200, st.events.filter((x) => x.action === a)); }
      return reply(404, {});
    }
    const body = JSON.parse(opts.body || '{}');
    st.calls.push(body.action || body.part);
    if (u.pathname.endsWith('/frameio-view')) st.listLinks.push(body.link);
    if (u.pathname.endsWith('/frameio-view')) return reply(200, { ok: true, name: 'Fixture folder', videos: st.listed, truncated: false });
    if (body.action === 'read') return reply(200, st.enabled ? { ok: true, enabled: true, ...shape() } : { ok: true, enabled: false });
    if (body.action === 'switch_set') { st.switchCalls.push(body.enabled === true); st.enabled = body.enabled === true; return reply(200, { ok: true, enabled: st.enabled }); }
    if (!st.enabled) return reply(409, { ok: false, error: 'trial_reels_off' });
    st.writes += 1;
    if (body.action === 'version_fields_set') {
      const r = L.versionFieldsPatch(st.versions, { letter: body.letter, thumbnail_url: body.thumbnail_url, caption: body.caption, mainLink: st.card.asset_url });
      if (r.error) return reply(400, { ok: false, error: r.error });
      if (r.patch) { st.versions = st.versions.map((v) => (v.letter === body.letter ? { ...v, ...r.patch } : v)); ledger('trial_version_fields_set', [body.letter]); }
      if (over.touchCard) st.card.updated_at = 'touched-' + st.writes;
      return reply(200, { ok: true, restarted: !!r.restarted, ...shape() });
    }
    if (body.action === 'versions_import') {
      const p = over.importNeverRefuses && st.imported ? { updates: [], inserts: body.items } : L.importPlan(st.versions, body.items, st.card.asset_url);
      if (p.error) return reply(409, { ok: false, error: p.error });
      for (const x of p.inserts) st.versions.push({ id: 'v' + x.letter, letter: x.letter, status: 'waiting', frame_url: x.link, smm_ok_at: null, kasper_ok_at: null,
        client_ok_at: null, client_pass_at: null, change_by: null, revision: 0, thumbnail_url: null, caption: null });
      ledger('trial_versions_import', p.inserts.map((x) => x.letter));
      st.imported = true;
      return reply(200, { ok: true, ...shape() });
    }
    if (body.action === 'version_drop') {
      const r = L.dropPatch(st.versions, body.letter, false, st.card.asset_url);
      if (r.error) return reply(400, { ok: false, error: r.error });
      if (r.patch) { st.versions = st.versions.map((v) => (v.letter === body.letter ? { ...v, ...r.patch } : v)); ledger('trial_version_drop', [body.letter]); }
      return reply(200, { ok: true, ...shape() });
    }
    return reply(400, { ok: false, error: 'action_invalid' });
  };
  // Codex on #2568: the server applies a write but its reply never arrives (once per action named in loseReply).
  const lost = new Set();
  const wrapped = async (url, opts = {}) => {
    const res = await fetchImpl(url, opts);
    const body = (() => { try { return JSON.parse(opts.body || '{}'); } catch (e) { return {}; } })();
    const key = body.action + (body.action === 'switch_set' ? ':' + body.enabled : '');
    if ((over.loseReply || []).includes(key) && !lost.has(key) && res.ok) { lost.add(key); throw new Error('reply_lost'); }
    return res;
  };
  return { st, fetchImpl: wrapped };
}

const env = (over = {}) => ({ SYNCVIEW_STAFF_KEY: 'fixture-staff-key-not-real', LIVE_CHECK_CLIENT: CLIENT, LIVE_CHECK_CARD: CARD, LIVE_CHECK_FIELDS_LETTER: 'C',
  LIVE_CHECK_SOURCE_LETTER: 'B', ...over });
async function go(over = {}, envOver = {}) {
  const b = backend(over);
  const logs = [];
  const res = await C.run({ env: env(envOver), fetchImpl: b.fetchImpl, anon: 'fixture-anon', log: (s) => logs.push(s), testHash: HASH, logic: L });
  return { ...res, st: b.st, logs };
}
const v = (r, l) => r.st.versions.find((x) => x.letter === l);

(async () => {
  L = await import(require('url').pathToFileURL(path.resolve(__dirname, '../supabase/functions/trial-reels/logic.mjs')).href);
  ok(C.PLACEHOLDER_THUMB.startsWith('https://syncview.synchrosocial.com/'), 'the fallback thumbnail is an image the SyncView site itself publishes, never a third party');

  // A full run.
  const full = await go();
  const s = full.summary;
  ok(full.exit === 0 && s.fields_passed && s.import_passed, 'a full run passes: fields set and cleared, import and its refusal, all put back (' + JSON.stringify([s.fields_passed, s.import_passed]) + ')');
  ok(s.thumbnail_source === 'card' && s.fields_set.own_read_back && s.fields_set.effective_read_back && s.fields_set.other_reads_card, 'V3: the card\'s own thumbnail is used; the version reads its own and effective fields, another still the card\'s');
  ok(s.fields_cleared.own_cleared && s.fields_cleared.effective_is_card && s.fields_set.card_unchanged && s.fields_cleared.card_unchanged, 'V3: cleared, the version reads the card\'s again, and the card row was never written');
  ok(s.fields_events_per_write === 1 && s.fields_set.events_added === 1 && s.fields_cleared.events_added === 1, 'V3: the history rows each write added are counted, not assumed');
  ok(full.st.listLinks.length === 1 && full.st.listLinks[0] === LINK(2), 'V2: the share listed is the one the source version holds on the card, read by the staff read');
  ok(s.listed_videos === 3 && s.import.videos === 2 && s.import.events_added === 2 && s.import.letters_read_back, 'V2: the listed videos no version holds (2 of 3) go in as new letters in one import, one history row each');
  ok(s.import_again.refused && s.import_again.error === 'link_used_by_another_version' && s.import_again.wrote_nothing, 'V2: the same video under another letter is refused and writes nothing');
  ok(s.imported_rows_left_dropped === 2 && v(full, 'D').status === 'dropped' && v(full, 'E').status === 'dropped', 'put back: the imported letters are dropped, and the summary says how many rows the run left dropped');
  ok(!v(full, 'C').caption && !v(full, 'C').thumbnail_url && v(full, 'A').status === 'waiting', 'put back: version C has no fields of its own, the others are untouched');

  // Variants.
  const noShare = await go({}, { LIVE_CHECK_SOURCE_LETTER: '' });
  ok(noShare.exit === 0 && noShare.summary.import_skipped === 'no_source_letter' && noShare.summary.import_ran === false && !noShare.st.calls.includes('list'),
    'with no source letter the run does V3 only and says so');
  const noThumb = await go({ cardThumb: null }, { LIVE_CHECK_SOURCE_LETTER: '' });
  ok(noThumb.exit === 0 && noThumb.summary.thumbnail_source === 'site_placeholder', 'a card with no thumbnail of its own takes the site\'s placeholder');
  const noEv = await go({ noFieldsEvents: true }, { LIVE_CHECK_SOURCE_LETTER: '' });
  ok(noEv.summary.fields_events_per_write === 'writes none', 'a fields write that logs no history row is reported as "writes none"');
  const sw = await go({ enabled: false }, { LIVE_CHECK_SWITCH_FOR_RUN: 'true' });
  ok(sw.exit === 0 && sw.st.switchCalls.join() === 'true,false' && sw.summary.switch_ended_off === true && sw.summary.switch_off_changed_versions === 0,
    'with switch_for_run the switch goes on for the run and ends off, changing no version');

  // Refused before any write.
  const answered = await go({ versions: ['A', 'B', 'C'].map((l, i) => ({ id: 'v' + l, letter: l, status: 'waiting', frame_url: LINK(i + 1), smm_ok_at: l === 'C' ? 't0' : null,
    kasper_ok_at: null, client_ok_at: null, client_pass_at: null, revision: 0, thumbnail_url: null, caption: null })) });
  ok(answered.exit === 1 && answered.summary.refused === 'fields_letter_unsuitable' && answered.st.writes === 0, 'an answered fields version (it would go back to the SMM) is refused before any write');
  const onCard = await go({}, { LIVE_CHECK_FIELDS_LETTER: 'A' });
  ok(onCard.summary.refused === 'fields_letter_unsuitable' && onCard.st.writes === 0, 'the version on the card is refused for fields before any write');
  const notTest = await go({}, { LIVE_CHECK_CLIENT: 'another-client' });
  ok(notTest.summary.refused === 'not_test_client' && notTest.st.calls.length === 0, 'any other client is refused before anything is called');
  const held = await go({ listed: [{ file_id: 'f2', link: LINK(2), processing: false }] });
  ok(held.exit === 0 && held.summary.import.skipped === 'nothing_new_on_share' && held.summary.import_again.refused
    && held.summary.import_again.error === 'link_used_by_another_version' && held.summary.import_again.wrote_nothing && held.summary.import_passed === true
    && !v(held, 'D'), 'a share of one video the source version already holds shows only the refusal under a free letter, and writes nothing');
  const nothingNew = await go({ listed: [{ file_id: 'f7', link: LINK(7), processing: true }] });
  ok(nothingNew.summary.refused === 'import_nothing_new' && nothingNew.st.writes === 0, 'a share with no finished video is refused before any write');
  const noLink = await go({}, { LIVE_CHECK_SOURCE_LETTER: 'F' });
  ok(noLink.summary.refused === 'source_letter_has_no_link' && noLink.st.writes === 0 && noLink.st.listLinks.length === 0, 'a source letter with no link on the card is refused before anything is listed or written');
  ok(full.summary.source_link_shape === 'share, one file' && full.summary.source_listable === true, 'the summary says what kind of link the source holds, and that the list opened it');
  ok(C.linkShape('https://f.io/allactions-a-1793209592511') === 'f.io placeholder' && C.linkShape('https://f.io/Ab12Cd34') === 'f.io short link'
    && C.linkShape('https://next.frame.io/share/x') === 'share' && C.linkShape('https://next.frame.io/project/p/view/f') === 'project file',
    'a placeholder f.io link reads as one, apart from a real short link, a share and a project file');
  const badLetter = await go({}, { LIVE_CHECK_SOURCE_LETTER: 'https://f.io/x' });
  ok(badLetter.summary.refused === 'source_letter_invalid' && badLetter.st.calls.length === 0, 'a source letter that is not A to G (a pasted link) is refused before anything is called');

  // Codex on #2568: a version that already has its own fields is refused (the put-back would clear them).
  const own = await go({ versions: ['A', 'B', 'C'].map((l, i) => ({ id: 'v' + l, letter: l, status: 'waiting', frame_url: LINK(i + 1), smm_ok_at: null, kasper_ok_at: null,
    client_ok_at: null, client_pass_at: null, revision: 0, thumbnail_url: null, caption: l === 'C' ? 'Its own caption, fixture.' : null })) });
  ok(own.exit === 1 && own.summary.refused === 'fields_letter_has_own_fields' && own.st.writes === 0 && v(own, 'C').caption === 'Its own caption, fixture.',
    'a fields version with its own caption already is refused before any write, and keeps it');

  // Codex on #2568: a write the server applied whose reply was lost is still put back, from a fresh read.
  const lostImport = await go({ loseReply: ['versions_import'] });
  ok(lostImport.exit === 1 && lostImport.summary.run_error && v(lostImport, 'D').status === 'dropped' && v(lostImport, 'E').status === 'dropped'
    && lostImport.summary.imported_rows_left_dropped === 2 && lostImport.summary.imported_all_dropped,
    'an import applied but unanswered: its letters are still dropped, and counted (' + JSON.stringify([lostImport.summary.imported_rows_left_dropped]) + ')');
  const lostFields = await go({ loseReply: ['version_fields_set'] }, { LIVE_CHECK_SOURCE_LETTER: '' });
  ok(lostFields.exit === 1 && !v(lostFields, 'C').caption && !v(lostFields, 'C').thumbnail_url && lostFields.summary.fields_put_back === true,
    'a fields write applied but unanswered is still cleared');
  const lostSwitch = await go({ enabled: false, loseReply: ['switch_set:true'] }, { LIVE_CHECK_SWITCH_FOR_RUN: 'true', LIVE_CHECK_SOURCE_LETTER: '' });
  ok(lostSwitch.exit === 1 && lostSwitch.st.enabled === false && lostSwitch.summary.switch_ended_off === true,
    'a switch turned on whose reply was lost is still turned off and read back');

  // What must fail the run, and still put things back.
  const touched = await go({ touchCard: true }, { LIVE_CHECK_SOURCE_LETTER: '' });
  ok(touched.exit === 1 && touched.summary.fields_set.card_unchanged === false, 'a function that writes the card fails the run');
  const leaky = await go({ importNeverRefuses: true });
  ok(leaky.exit === 1 && leaky.summary.import_again.refused === false, 'an import that is not refused the second time fails the run');
  const broken = await go({ breakAfterImport: true });
  ok(broken.exit === 1 && broken.summary.run_error && broken.summary.imported_rows_left_dropped === 2 && !v(broken, 'C').caption,
    'a failed read after the import still drops the imported letters and clears the fields');

  // The log is public.
  const printed = [full, noShare, sw, broken, held].map((r) => r.logs.join('\n') + JSON.stringify(r.summary)).join('\n');
  for (const bad of [CARD, CLIENT, LINK(2), LINK(8), 'f.io', 'frame.io', 'fixture-staff-key-not-real', 'fixture-anon', 'e.example', 'card caption', 'Live check caption']) {
    ok(!printed.includes(bad), 'the summary never prints ' + JSON.stringify(bad.slice(0, 12) + '…'));
  }
  // No workflow input takes a link: inputs and the step's env are printed on the public run page (OPEN_REPAIRS 660).
  const wf = require('fs').readFileSync(path.resolve(__dirname, '../.github/workflows/trial-versions-fields-import-live-check.yml'), 'utf8');
  const inputsBlock = wf.split(/\n {4}inputs:\n/)[1].split(/\n\S/)[0];
  const inputs = [...inputsBlock.matchAll(/^ {6}([a-z_]+):\s*$/gm)].map((m) => m[1]);
  ok(inputs.length === 5 && inputs.includes('source_letter'), 'the workflow\'s inputs are read (' + inputs.join(',') + ')');
  ok(!inputs.some((n) => /share|link|url/.test(n)), 'no workflow input is named for a link, share or URL');
  ok(!/https?:\/\//.test(inputsBlock.replace(/description:.*$/gm, '')), 'no workflow input has a link as its default');
  ok(!/LIVE_CHECK_FRAME_SHARE|inputs\.frame_share/.test(wf) && !/FRAME_SHARE/.test(require('fs').readFileSync(path.resolve(__dirname, '../scripts/trial-versions-fields-import-live-check.js'), 'utf8')),
    'neither the workflow nor the script reads a share link from the environment');
  console.log(`\ntrial-versions-fields-import-live-check: ${passed} passed, 0 failed`);
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';
/*
 * The live check for V3 (a version's own thumbnail and caption) and V2 (several versions imported from a Frame share
 * in one write), plan docs/plans/2026-11-trial-and-posting/combined.md, OPEN_REPAIRS 660. Run by hand from
 * .github/workflows/trial-versions-fields-import-live-check.yml as the robot SMM key.
 *
 * It WRITES, on the test client only. Before anything is written it refuses, read-only, exactly as the V1 check does
 * (scripts/trial-version-status-live-check.js, whose guards it reuses): not the test client (by SHA-256), not that
 * client's card, a Posted card, a card linked to Production, no trial switch (unless switch_for_run), a first read
 * that healed a link. Then, also before any write, V3's and V2's own rules (logic.mjs versionFieldsPatch, importPlan)
 * are run over the card's state as read, and the run stops if they would refuse, or if the fields change would send
 * an answered version back to the SMM.
 *
 *   V3: the fields version gets a caption and a thumbnail (the card's own thumbnail when it has one, else an image the
 *       SyncView site publishes), read back as its own and as its effective fields, with another version still
 *       reading the card's; then both are cleared and read back as the card's again. The card row is never written.
 *   V2 (only when a source letter is given): that version's own Frame link, read from the card by the staff read, is
 *       listed through frameio-view part "list". Every listed video no version already holds is imported as a new
 *       letter in one versions_import and read back, and the same video offered again under another letter must be
 *       refused (link_used_by_another_version) and write nothing. When every listed video is already on the card (a
 *       share of one video, held by the source version itself), only that refusal is shown. The link is never an
 *       input: a workflow_dispatch input and the step's env are printed on the run page of this public repository,
 *       so a share's token given there would be published (supervisor, OPEN_REPAIRS 660). A new share reaches the
 *       card the way the team adds one, through the page.
 *   Put back, always (finally): fields cleared, every imported letter dropped (the table has no delete grant, so a
 *       dropped row is the only way back; the summary counts them), and a switch turned on for the run turned off.
 *
 * History rows are counted from calendar_post_events, never assumed: the summary says how many each write added.
 * Prints only counts, true/false, HTTP statuses and refusal codes: never a title, a link, a name, an id or a key.
 *
 * Env: SYNCVIEW_STAFF_KEY, LIVE_CHECK_CLIENT, LIVE_CHECK_CARD, LIVE_CHECK_FIELDS_LETTER (A to G),
 *      LIVE_CHECK_SOURCE_LETTER (optional, A to G: empty runs V3 only), LIVE_CHECK_SWITCH_FOR_RUN (optional, true or false).
 */
const path = require('path');
const V1 = require('./trial-version-status-live-check.js');

const { SUPA, code, isTestClient, guardTarget, publishableKey } = V1;
// An image the SyncView site itself publishes (Pages), used when the card has no thumbnail of its own.
const PLACEHOLDER_THUMB = 'https://syncview.synchrosocial.com/syncview-favicon.png';
const FIELDS_CAPTION = 'Live check caption for this version (V3).';
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const loadLogic = () => import(require('url').pathToFileURL(path.resolve(__dirname, '../supabase/functions/trial-reels/logic.mjs')).href);

function io({ fetchImpl, key, anon }) {
  const f = fetchImpl || fetch;
  const rest = async (q) => {
    const r = await f(SUPA + '/rest/v1/' + q, { headers: { apikey: anon, Authorization: 'Bearer ' + anon, Accept: 'application/json' } });
    if (!r.ok) throw new Error('rest_' + r.status);
    return r.json();
  };
  const fn = async (name, body) => {
    const r = await f(SUPA + '/functions/v1/' + name, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': key }, body: JSON.stringify(body),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { rest, call: (body) => fn('trial-reels', body), frame: (body) => fn('frameio-view', body) };
}

/* What kind of Frame link the source version holds, in words that name no link (supervisor, run 41640666721: a
   placeholder f.io link answered 404 link_not_found, and the summary could not say it was one). */
function linkShape(link) {
  const u = String(link || '');
  if (/^https:\/\/f\.io\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]*-/.test(u)) return 'f.io placeholder';
  if (/^https:\/\/f\.io\//.test(u)) return 'f.io short link';
  if (/\/share\/[^/]+\/view\//.test(u)) return 'share, one file';
  if (/\/share\//.test(u)) return 'share';
  if (/\/project\//.test(u)) return 'project file';
  return 'other';
}
const ok = (r) => !!(r && r.json && r.json.ok === true);
const err = (r) => (ok(r) ? null : code(r && r.json && r.json.error) || 'request_failed');
const find = (r, letter) => ((r && r.json && r.json.versions) || []).find((v) => v.letter === letter) || null;
const same = (a, b) => (a || null) === (b || null);

/** The read-only plan by V3's and V2's own rules; returns a refusal code or null, and what the run will do. */
function planRun(logic, versions, { letter, mainLink, thumb, caption, listed }) {
  const v = versions.find((x) => x.letter === letter);
  if (!v || v.on_card || v.status === 'dropped' || ['on trial', 'winner', 'lost'].includes(v.status)) return { refused: 'fields_letter_unsuitable' };
  const f = logic.versionFieldsPatch(versions, { letter, thumbnail_url: thumb, caption, mainLink });
  if (f.error) return { refused: 'fields_not_allowed', code: code(f.error) };
  if (f.restarted) return { refused: 'fields_letter_unsuitable' };   // an answered version would go back to the SMM
  // A version that already has its own caption or thumbnail is refused: the put-back clears both, so it would lose them
  // (Codex on #2568). The check only ever writes fields onto a version that reads the card's.
  if (v.caption || v.thumbnail_url) return { refused: 'fields_letter_has_own_fields' };
  if (!listed) return { refused: null, items: [] };
  const used = new Set(versions.map((x) => x.frame_url).filter(Boolean));
  const free = LETTERS.filter((l) => !versions.some((x) => x.letter === l));
  const videos = listed.filter((r) => r && !r.processing && r.link && !used.has(r.link));
  const items = videos.slice(0, free.length).map((r, i) => ({ letter: free[i], link: r.link }));
  if (!free.length) return { refused: 'import_no_free_letter' };
  if (!items.length) {
    // Nothing new on the share: show only that a video already on the card is refused under a free letter.
    const held = listed.find((r) => r && !r.processing && r.link && used.has(r.link));
    if (!held) return { refused: 'import_nothing_new' };
    const p = logic.importPlan(versions, [{ letter: free[0], link: held.link }], mainLink);
    if (p.error !== 'link_used_by_another_version') return { refused: 'import_refusal_not_expected', code: code(p.error) };
    return { refused: null, items: [], refusalOnly: { letter: free[0], link: held.link } };
  }
  const p = logic.importPlan(versions, items, mainLink);
  if (p.error) return { refused: 'import_not_allowed', code: code(p.error) };
  if ((p.updates || []).length) return { refused: 'import_would_change_a_version' };
  return { refused: null, items, spareLetter: free[items.length] || null };
}

async function run({ env, fetchImpl, anon, log, testHash, logic }) {
  const say = log || ((s) => console.log(s));
  const key = String(env.SYNCVIEW_STAFF_KEY || '').trim();
  const client = String(env.LIVE_CHECK_CLIENT || '').trim().toLowerCase();
  const card = String(env.LIVE_CHECK_CARD || '').trim();
  const letter = String(env.LIVE_CHECK_FIELDS_LETTER || '').trim().toUpperCase();
  const source = String(env.LIVE_CHECK_SOURCE_LETTER || '').trim().toUpperCase();
  const switchForRun = String(env.LIVE_CHECK_SWITCH_FOR_RUN || '').trim().toLowerCase() === 'true';
  if (!key || !client || !card) return { exit: 2, summary: { refused: 'inputs_missing' } };
  if (!isTestClient(client, testHash)) return { exit: 1, summary: { refused: 'not_test_client' } };
  if (source && !LETTERS.includes(source)) return { exit: 2, summary: { refused: 'source_letter_invalid' } };
  const L = logic || await loadLogic();
  const { rest, call, frame } = io({ fetchImpl, key, anon });
  const e = encodeURIComponent;
  const readCard = async () => (await rest('calendar_posts?select=id,client,video_status,updated_at,caption,thumbnail_url,video_deliverable_id,graphic_deliverable_id&id=eq.'
    + e(card) + '&client=eq.' + e(client)))[0] || null;
  const events = async (action) => (await rest('calendar_post_events?select=action,payload&post_id=eq.' + e(card) + '&client=eq.' + e(client)
    + '&action=eq.' + e(action))).length;
  const versionEvents = async () => (await Promise.all(['trial_version_add', 'trial_version_drop', 'trial_version_restore', 'trial_versions_import'].map(events)))
    .reduce((n, x) => n + x, 0);
  const fail = (s) => ({ exit: 1, summary: s });

  const cardRow = await readCard();
  const productionRows = cardRow ? await rest('production_deliverables_browser_v1?select=card_id&card_id=eq.' + e(card)) : [];
  const pre = guardTarget({ client, card, cardRow, productionRows, read: { json: { ok: true, enabled: true, versions: [{ letter, card_status: 'x' }] } }, letter, testHash });
  if (pre) return fail({ refused: pre });
  const first = await call({ action: 'read', client, post_id: card });
  if (!ok(first)) return fail({ refused: 'read_failed', read_http_status: first.status });
  if (switchForRun && first.json.enabled === true) return fail({ refused: 'switch_already_on' });
  if (!switchForRun && first.json.enabled !== true) return fail({ refused: 'not_a_trial_card' });

  const out = { refused: null, switch_for_run: switchForRun, import_ran: false };
  // What was sent, not what was answered: a write whose reply is lost is still put back (Codex on #2568). The put-back
  // reads the card afresh and undoes whatever of these it finds.
  let switchAttempted = false, fieldsAttempted = false;
  const attemptedLetters = [];
  try {
    if (switchForRun) {
      const before = await versionEvents();
      switchAttempted = true;
      const on = await call({ action: 'switch_set', client, post_id: card, enabled: true });
      out.switch_on_ok = ok(on);
      if (!out.switch_on_ok) { out.refused = 'switch_on_failed'; return fail(out); }
      out.switch_on_seeded_versions = (await versionEvents()) - before;
      if (out.switch_on_seeded_versions !== 0) { out.refused = 'switch_on_seeded_a_version'; return fail(out); }
    }
    const linkBefore = await events('trial_version_link_set');
    const read = await call({ action: 'read', client, post_id: card });
    const linkAfter = await events('trial_version_link_set');
    const refused = guardTarget({ client, card, cardRow, productionRows, read, letter, testHash });
    if (refused && refused !== 'version_has_no_status') { out.refused = refused; return fail(out); }
    if (linkAfter !== linkBefore) { out.refused = 'read_healed_a_link'; return fail(out); }
    const versions = read.json.versions || [];
    const mainRow = versions.find((x) => x.on_card) || null;
    const mainLink = mainRow ? mainRow.frame_url : '';
    const thumb = cardRow.thumbnail_url || PLACEHOLDER_THUMB;
    out.thumbnail_source = cardRow.thumbnail_url ? 'card' : 'site_placeholder';

    let listed = null;
    if (source) {
      const src = versions.find((x) => x.letter === source);
      const share = src && src.status !== 'dropped' ? String(src.frame_url || '').trim() : '';
      if (!share) { out.refused = 'source_letter_has_no_link'; return fail(out); }
      out.source_link_shape = linkShape(share);
      const list = await frame({ link: share, part: 'list' });
      out.list_http_status = list.status;
      out.source_listable = ok(list);
      if (!ok(list)) { out.refused = 'share_list_failed'; out.list_error = err(list); return fail(out); }
      listed = Array.isArray(list.json.videos) ? list.json.videos : [];
      out.listed_videos = listed.length;
    } else {
      out.import_skipped = 'no_source_letter';
    }
    const plan = planRun(L, versions, { letter, mainLink, thumb, caption: FIELDS_CAPTION, listed });
    if (plan.refused) { out.refused = plan.refused; if (plan.code) out.refused_code = plan.code; return fail(out); }

    // V3: set, read back, clear, read back.
    const other = versions.find((x) => x.letter !== letter && x.status !== 'dropped') || null;
    const c0 = await readCard();
    const ev0 = await events('trial_version_fields_set');
    fieldsAttempted = true;
    const set = await call({ action: 'version_fields_set', client, post_id: card, letter, thumbnail_url: thumb, caption: FIELDS_CAPTION });
    const sv = find(set, letter), so = other && find(set, other.letter);
    const c1 = await readCard();
    out.fields_set = {
      http_status: set.status, ok: ok(set), error: err(set), restarted: !!(set.json && set.json.restarted),
      own_read_back: !!sv && sv.caption === FIELDS_CAPTION && sv.thumbnail_url === thumb,
      effective_read_back: !!sv && !!sv.effective && sv.effective.caption === FIELDS_CAPTION && sv.effective.thumbnail_url === thumb,
      other_reads_card: !other || (!!so && !!so.effective && same(so.effective.caption, so.caption || cardRow.caption)
        && same(so.effective.thumbnail_url, so.thumbnail_url || cardRow.thumbnail_url)),
      events_added: (await events('trial_version_fields_set')) - ev0,
      card_unchanged: !!c0 && !!c1 && c0.updated_at === c1.updated_at && same(c0.caption, c1.caption) && same(c0.thumbnail_url, c1.thumbnail_url),
    };
    const ev1 = await events('trial_version_fields_set');
    const clr = await call({ action: 'version_fields_set', client, post_id: card, letter, thumbnail_url: '', caption: '' });
    const cv = find(clr, letter);
    const c2 = await readCard();
    out.fields_cleared = {
      http_status: clr.status, ok: ok(clr), error: err(clr),
      own_cleared: !!cv && !cv.caption && !cv.thumbnail_url,
      effective_is_card: !!cv && !!cv.effective && same(cv.effective.caption, cardRow.caption) && same(cv.effective.thumbnail_url, cardRow.thumbnail_url),
      events_added: (await events('trial_version_fields_set')) - ev1,
      card_unchanged: !!c1 && !!c2 && c1.updated_at === c2.updated_at && same(c1.caption, c2.caption) && same(c1.thumbnail_url, c2.thumbnail_url),
    };
    out.fields_events_per_write = out.fields_set.events_added === 0 && out.fields_cleared.events_added === 0 ? 'writes none' : out.fields_set.events_added;

    // V2: one import, read back; the same video again under another letter refused.
    if (plan.refusalOnly) {
      out.import_ran = true;
      out.import = { skipped: 'nothing_new_on_share' };
      const evR = await events('trial_versions_import');
      attemptedLetters.push(plan.refusalOnly.letter);
      const again = await call({ action: 'versions_import', client, post_id: card, items: [plan.refusalOnly] });
      const after = await call({ action: 'read', client, post_id: card });
      out.import_again = {
        http_status: again.status, refused: !ok(again), error: err(again),
        wrote_nothing: (await events('trial_versions_import')) === evR && !find(after, plan.refusalOnly.letter),
      };
    } else if (plan.items.length) {
      out.import_ran = true;
      const evI = await events('trial_versions_import');
      const c3 = await readCard();
      attemptedLetters.push(...plan.items.map((x) => x.letter));
      const imp = await call({ action: 'versions_import', client, post_id: card, items: plan.items });
      const c4 = await readCard();
      out.import = {
        http_status: imp.status, ok: ok(imp), error: err(imp), videos: plan.items.length,
        letters_read_back: ok(imp) && plan.items.every((x) => { const r = find(imp, x.letter); return !!r && r.status === 'waiting'; }),
        events_added: (await events('trial_versions_import')) - evI,
        card_unchanged: !!c3 && !!c4 && c3.updated_at === c4.updated_at,
      };
      if (plan.spareLetter && ok(imp)) {
        const evR = await events('trial_versions_import');
        attemptedLetters.push(plan.spareLetter);
        const again = await call({ action: 'versions_import', client, post_id: card, items: [{ letter: plan.spareLetter, link: plan.items[0].link }] });
        const after = await call({ action: 'read', client, post_id: card });
        out.import_again = {
          http_status: again.status, refused: !ok(again), error: err(again),
          wrote_nothing: (await events('trial_versions_import')) === evR && !find(after, plan.spareLetter),
        };
      } else {
        out.import_again = { skipped: 'no_spare_letter' };
      }
    }
  } catch (x) {
    out.run_error = code(String(x && x.message)) || 'error';
  } finally {
    // Put back, from a fresh read, whatever was sent: fields cleared, attempted letters dropped, then the switch off.
    const readNow = async () => { const r = await call({ action: 'read', client, post_id: card }); return ok(r) && r.json.enabled === true ? (r.json.versions || []) : null; };
    try {
      let now = await readNow();
      if (fieldsAttempted) {
        const v = now && now.find((x) => x.letter === letter);
        if (!now || (v && (v.caption || v.thumbnail_url))) {
          const clr = await call({ action: 'version_fields_set', client, post_id: card, letter, thumbnail_url: '', caption: '' });
          out.fields_put_back = ok(clr);
        } else out.fields_put_back = true;
      }
      for (const l of attemptedLetters) {
        const v = now && now.find((x) => x.letter === l);
        if (!now || (v && v.status !== 'dropped')) await call({ action: 'version_drop', client, post_id: card, letter: l });
      }
      if (attemptedLetters.length || fieldsAttempted) now = await readNow();
      if (attemptedLetters.length) {
        const rows = attemptedLetters.map((l) => now && now.find((x) => x.letter === l)).filter(Boolean);
        out.imported_rows_left_dropped = rows.filter((x) => x.status === 'dropped').length;
        out.imported_all_dropped = !!now && rows.every((x) => x.status === 'dropped');
      } else if (out.import_ran) {
        out.imported_rows_left_dropped = 0;
        out.imported_all_dropped = true;
      }
      if (fieldsAttempted && now) {
        const v = now.find((x) => x.letter === letter);
        out.fields_put_back = !!v && !v.caption && !v.thumbnail_url;
      }
    } catch (x) { out.put_back_error = code(String(x && x.message)) || 'error'; }
    if (switchAttempted) {
      try {
        const before = await versionEvents();
        const off = await call({ action: 'switch_set', client, post_id: card, enabled: false });
        out.switch_off_ok = ok(off);
        out.switch_off_changed_versions = (await versionEvents()) - before;
        const after = await call({ action: 'read', client, post_id: card });
        out.switch_ended_off = ok(after) && after.json.enabled === false;
      } catch (x) { out.switch_off_ok = false; out.switch_ended_off = false; out.switch_off_error = code(String(x && x.message)) || 'error'; }
    }
  }
  if (out.refused) return fail(out);
  const fs = out.fields_set || {}, fc = out.fields_cleared || {};
  const fieldsPass = out.fields_put_back !== false && fs.ok && !fs.restarted && fs.own_read_back && fs.effective_read_back && fs.other_reads_card && fs.card_unchanged
    && fc.ok && fc.own_cleared && fc.effective_is_card && fc.card_unchanged;
  const im = out.import || {}, ia = out.import_again || {};
  const refusalPass = ia.refused && ia.error === 'link_used_by_another_version' && ia.wrote_nothing;
  const importPass = !out.import_ran || (im.skipped === 'nothing_new_on_share' ? refusalPass && out.imported_all_dropped
    : im.ok && im.letters_read_back && im.card_unchanged && im.events_added === im.videos
    && (ia.skipped || (ia.refused && ia.error === 'link_used_by_another_version' && ia.wrote_nothing)) && out.imported_all_dropped);
  const switchPass = !switchForRun || (out.switch_ended_off === true && out.switch_off_changed_versions === 0);
  out.fields_passed = !!fieldsPass;
  out.import_passed = out.import_ran ? !!importPass : null;
  say('trial versions fields and import live check: ' + JSON.stringify(out));
  return { exit: fieldsPass && importPass && switchPass && !out.run_error && !out.put_back_error ? 0 : 1, summary: out };
}

async function main() {
  const res = await run({ env: process.env, anon: publishableKey() });
  if (res.summary.refused) console.log('trial versions fields and import live check: ' + JSON.stringify(res.summary));
  process.exit(res.exit);
}

if (require.main === module) main().catch((x) => { console.error('trial versions fields and import live check failed:', x && (x.name + ' ' + code(String(x.message)))); process.exit(1); });
module.exports = { PLACEHOLDER_THUMB, FIELDS_CAPTION, linkShape, planRun, run };

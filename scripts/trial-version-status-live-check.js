'use strict';
/*
 * The live check for V1 (plan docs/plans/2026-11-trial-and-posting/combined.md row V1): a trial version's status set
 * with the card's own picker, through the live trial-reels function, as the robot SMM key. Run by hand from
 * .github/workflows/trial-version-status-live-check.yml.
 *
 * It WRITES, on the test client only: one version of one trial card is walked through the picker's words and then put
 * back to the word it started at. Before anything is written it refuses unless, read-only:
 *   - the client given is the test client (compared by its SHA-256, so no client slug is written in this public repo);
 *   - the card is that client's, is not Posted (a staff call on a Posted card starts the trial) and has no Production
 *     sub-issue (video_deliverable_id and graphic_deliverable_id empty, no row in production_deliverables_browser_v1),
 *     so no status sync or drift robot ever sees these writes (CLAUDE.md, OPEN_REPAIRS 373);
 *   - it is a trial card (switch on) with that version, and the first staff read changed no version link (a staff call
 *     heals the on-card version's link when it differs from the card's; a card where it did is refused, nothing more
 *     is written).
 * After each pick it reads back: the version's card_status, the new trial_status row in calendar_post_events (from,
 * to, source, letter), and that calendar_posts.updated_at and video_status did not change (V1 never writes the card).
 *
 * Prints only counts, true/false, HTTP statuses, refusal codes and the card's fixed status words: never a title, a
 * link, a name, an id or a key. The repository and its CI logs are public.
 *
 * Env: SYNCVIEW_STAFF_KEY (an SMM or admin role key), LIVE_CHECK_CLIENT (the test client's slug, given at dispatch),
 *      LIVE_CHECK_CARD (the card id), LIVE_CHECK_LETTER (A to G).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SUPA = 'https://uzltbbrjidmjwwfakwve.supabase.co';
// SHA-256 of the test client's slug. Any other client is refused before anything is read or written.
const TEST_CLIENT_SHA256 = 'c1424f0e39a727bd6c9f3e8fd68c241afa728472692d547509efde88d1edf964';
// The picker's words in walking order (logic.mjs VERSION_STATUSES; In Progress and For SMM Approval are one state,
// shown by the link, so the walk asks for For SMM Approval).
const WALK = ['For SMM Approval', 'Kasper Approval', 'Client Approval', 'Tweaks Needed', 'Approved'];

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const isTestClient = (slug, hash) => !!slug && sha256(slug) === (hash || TEST_CLIENT_SHA256);
const code = (x) => (typeof x === 'string' ? x.replace(/[^a-z_]/g, '').slice(0, 40) : null);

/** The publishable (browser) key, read from the page's own source in this checkout: it is public by design. */
function publishableKey(root) {
  const src = fs.readFileSync(path.join(root || path.resolve(__dirname, '..'), 'src/index/100-onboarding-staff-controls.js.part'), 'utf8');
  const m = src.match(/CAL_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/);
  if (!m) throw new Error('publishable key not found');
  return m[1];
}

/** The read-only refusals, before any write. Returns a refusal code or null. */
function guardTarget({ client, card, cardRow, productionRows, read, letter, testHash }) {
  if (!isTestClient(client, testHash)) return 'not_test_client';
  if (!/^[A-G]$/.test(letter || '')) return 'letter_invalid';
  if (!cardRow) return 'card_not_found';
  if (cardRow.id !== card || cardRow.client !== client) return 'card_not_test_client';
  if (cardRow.video_status === 'Posted') return 'card_posted';
  if (cardRow.video_deliverable_id || cardRow.graphic_deliverable_id) return 'card_linked_to_production';
  if (!Array.isArray(productionRows) || productionRows.length) return 'card_linked_to_production';
  if (!read || !read.json || read.json.ok !== true) return 'read_failed';
  if (read.json.enabled !== true) return 'not_a_trial_card';
  const v = (read.json.versions || []).find((x) => x.letter === letter);
  if (!v) return 'version_not_found';
  if (!v.card_status) return 'version_has_no_status';
  return null;
}

/** One pick's verdict from what was read back. Booleans and counts only. */
function judgeStep({ want, from, resp, letter, eventsBefore, eventsAfter, cardBefore, cardAfter }) {
  const ok = !!(resp && resp.json && resp.json.ok === true);
  const v = ok ? (resp.json.versions || []).find((x) => x.letter === letter) : null;
  const added = (eventsAfter || []).slice((eventsBefore || []).length);
  const noOp = from === want;
  const row = added[0];
  const eventOk = noOp ? added.length === 0
    : added.length === 1 && row.from_status === from && row.to_status === want && row.source === 'trial-reels'
      && !!row.payload && row.payload.letter === letter;
  const cardUnchanged = !!cardBefore && !!cardAfter && cardBefore.updated_at === cardAfter.updated_at && cardBefore.video_status === cardAfter.video_status;
  return {
    to: want, http_status: resp ? resp.status : 0, ok, error: ok ? null : code(resp && resp.json && resp.json.error) || 'request_failed',
    status_read_back: !!v && v.card_status === want, events_added: added.length, event_ok: ok && eventOk, card_unchanged: cardUnchanged,
  };
}

const stepPassed = (s) => s.ok && s.status_read_back && s.event_ok && s.card_unchanged;

function makeIo({ fetchImpl, key, anon }) {
  const f = fetchImpl || fetch;
  const rest = async (q) => {
    const r = await f(SUPA + '/rest/v1/' + q, { headers: { apikey: anon, Authorization: 'Bearer ' + anon, Accept: 'application/json' } });
    if (!r.ok) throw new Error('rest_' + r.status);
    return r.json();
  };
  const call = async (body) => {
    const r = await f(SUPA + '/functions/v1/trial-reels', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': key }, body: JSON.stringify(body),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { rest, call };
}

async function run({ env, fetchImpl, anon, log, testHash }) {
  const say = log || ((s) => console.log(s));
  const key = String(env.SYNCVIEW_STAFF_KEY || '').trim();
  const client = String(env.LIVE_CHECK_CLIENT || '').trim().toLowerCase();
  const card = String(env.LIVE_CHECK_CARD || '').trim();
  const letter = String(env.LIVE_CHECK_LETTER || '').trim().toUpperCase();
  if (!key || !client || !card) return { exit: 2, summary: { refused: 'inputs_missing' } };
  // The client is checked before anything is read.
  if (!isTestClient(client, testHash)) return { exit: 1, summary: { refused: 'not_test_client' } };
  const { rest, call } = makeIo({ fetchImpl, key, anon });
  const e = encodeURIComponent;
  const readCard = async () => (await rest('calendar_posts?select=id,client,video_status,updated_at,video_deliverable_id,graphic_deliverable_id&id=eq.' + e(card) + '&client=eq.' + e(client)))[0] || null;
  const readEvents = (action) => rest('calendar_post_events?select=action,from_status,to_status,source,payload,ts&post_id=eq.' + e(card)
    + '&client=eq.' + e(client) + '&action=eq.' + e(action) + '&order=ts.asc,id.asc');

  const cardRow = await readCard();
  const productionRows = cardRow ? await rest('production_deliverables_browser_v1?select=card_id&card_id=eq.' + e(card)) : [];
  const pre = guardTarget({ client, card, cardRow, productionRows, read: { json: { ok: true, enabled: true, versions: [{ letter, card_status: 'x' }] } }, letter, testHash });
  if (pre) return { exit: 1, summary: { refused: pre } };

  // The first staff call. Nothing may have healed: a link change here means the card is not one this check may use.
  const linkEventsBefore = await readEvents('trial_version_link_set');
  const read = await call({ action: 'read', client, post_id: card });
  const linkEventsAfter = await readEvents('trial_version_link_set');
  const refused = guardTarget({ client, card, cardRow, productionRows, read, letter, testHash });
  if (refused) return { exit: 1, summary: { refused, read_http_status: read.status } };
  if (linkEventsAfter.length !== linkEventsBefore.length) return { exit: 1, summary: { refused: 'read_healed_a_link' } };

  const start = read.json.versions.find((x) => x.letter === letter).card_status;
  let current = start;
  const pick = async (want) => {
    const cardBefore = await readCard();
    const eventsBefore = await readEvents('trial_status');
    const resp = await call({ action: 'version_status_set', client, post_id: card, letter, status: want });
    const eventsAfter = await readEvents('trial_status');
    const cardAfter = await readCard();
    const step = judgeStep({ want, from: current, resp, letter, eventsBefore, eventsAfter, cardBefore, cardAfter });
    if (step.ok) current = want;
    return step;
  };
  const steps = [];
  for (const want of WALK) steps.push(await pick(want));
  const restore = await pick(start);
  const summary = {
    refused: null, start_status: start, steps, restore,
    steps_passed: steps.filter(stepPassed).length, steps_total: steps.length, restored: stepPassed(restore),
  };
  say('trial version status live check: ' + JSON.stringify(summary));
  return { exit: summary.steps_passed === steps.length && summary.restored ? 0 : 1, summary };
}

async function main() {
  const out = await run({ env: process.env, anon: publishableKey() });
  if (out.summary.refused) console.log('trial version status live check: ' + JSON.stringify(out.summary));
  process.exit(out.exit);
}

if (require.main === module) main().catch((err) => { console.error('trial version status live check failed:', err && (err.name + ' ' + code(String(err.message)))); process.exit(1); });
module.exports = { TEST_CLIENT_SHA256, WALK, sha256, isTestClient, guardTarget, judgeStep, stepPassed, run, publishableKey };

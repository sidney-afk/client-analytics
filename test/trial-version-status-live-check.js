'use strict';
/* trial-version-status-live-check.js -- the V1 live check's own rules, offline.
 *
 * scripts/trial-version-status-live-check.js writes on the live test client, so its refusals and its verdicts are
 * proven here against a fake backend first: every read-only refusal comes before any write; a full walk reads back
 * each word, its one trial_status row and an untouched card, then puts the version back; a card written by the
 * function, a wrong history row or a refused pick fails the run; and the printed summary carries no id, client, link
 * or key. The fixture's client is fictional; its hash stands in for the real test client's.
 */
const assert = require('assert');
const L = require('../scripts/trial-version-status-live-check.js');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed += 1; console.log('  ok  ' + msg); }

const CLIENT = 'fixture-test-client';
const HASH = L.sha256(CLIENT);
const CARD = 'p_fixture_card_1';
const SECRET_LINK = 'https://f.io/fixture-secret-link';

/* A fake backend: calendar_posts, calendar_post_events, production_deliverables_browser_v1 and trial-reels. */
function backend(over = {}) {
  const st = {
    card: { id: CARD, client: CLIENT, video_status: 'Client Approval', updated_at: '2026-10-31T19:19:33.948Z', video_deliverable_id: null, graphic_deliverable_id: null, ...(over.card || {}) },
    production: over.production || [],
    enabled: over.enabled !== false,
    versions: over.versions || [{ letter: 'A', card_status: 'For SMM Approval', frame_url: SECRET_LINK }, { letter: 'B', card_status: 'Tweaks Needed', frame_url: SECRET_LINK + '-b' }],
    events: [],
    writes: 0,
  };
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/rest/v1/')) {
      const table = u.pathname.slice('/rest/v1/'.length);
      if (table === 'calendar_posts') return reply(200, u.searchParams.get('id') === 'eq.' + st.card.id && u.searchParams.get('client') === 'eq.' + st.card.client ? [{ ...st.card }] : []);
      if (table === 'production_deliverables_browser_v1') return reply(200, st.production);
      if (table === 'calendar_post_events') {
        const action = (u.searchParams.get('action') || '').replace(/^eq\./, '');
        return reply(200, st.events.filter((x) => x.action === action).map((x) => ({ ...x })));
      }
      return reply(404, { message: 'no table' });
    }
    const body = JSON.parse(opts.body || '{}');
    if (body.action === 'read') {
      if (over.healOnRead) st.events.push({ action: 'trial_version_link_set', source: 'trial-reels', payload: { letter: 'A' } });
      return reply(200, st.enabled ? { ok: true, enabled: true, versions: st.versions.map((v) => ({ ...v })) } : { ok: true, enabled: false });
    }
    if (body.action === 'version_status_set') {
      st.writes += 1;
      if (over.refuse && over.refuse === body.status) return reply(409, { ok: false, error: 'status_follows_card' });
      const v = st.versions.find((x) => x.letter === body.letter);
      const from = v.card_status;
      if (from !== body.status) {
        v.card_status = body.status;
        st.events.push({ action: 'trial_status', from_status: over.wrongFrom ? 'In Progress' : from, to_status: body.status, source: 'trial-reels', payload: { letter: body.letter, label: 'Video ' + body.letter } });
        if (over.touchCard) st.card.updated_at = 'touched-' + st.writes;
      }
      return reply(200, { ok: true, versions: st.versions.map((x) => ({ ...x })) });
    }
    return reply(400, { ok: false, error: 'action_invalid' });
  };
  return { st, fetchImpl };
}

const env = (over = {}) => ({ SYNCVIEW_STAFF_KEY: 'fixture-staff-key-not-real', LIVE_CHECK_CLIENT: CLIENT, LIVE_CHECK_CARD: CARD, LIVE_CHECK_LETTER: 'A', ...over });
async function go(over = {}, envOver = {}) {
  const b = backend(over);
  const logs = [];
  const out = await L.run({ env: env(envOver), fetchImpl: b.fetchImpl, anon: 'fixture-anon', log: (s) => logs.push(s), testHash: HASH });
  return { ...out, st: b.st, logs };
}

(async () => {
  // The guard, and that nothing is written before it passes.
  ok(L.isTestClient(CLIENT, HASH) && !L.isTestClient('another-client', HASH) && !L.isTestClient('', HASH), 'only the client whose hash is given counts as the test client');
  ok(/^[0-9a-f]{64}$/.test(L.TEST_CLIENT_SHA256) && !L.isTestClient(CLIENT), 'the script compares a SHA-256, never a slug written in the repository');
  ok(L.WALK.join('|') === 'For SMM Approval|Kasper Approval|Client Approval|Tweaks Needed|Approved', 'the walk is the picker\'s words up to Approved (Scheduled and Posted stay card-only)');

  const refusals = [
    [{}, { LIVE_CHECK_CLIENT: 'another-client' }, 'not_test_client'],
    [{}, { LIVE_CHECK_LETTER: 'H' }, 'letter_invalid'],
    [{}, { LIVE_CHECK_CARD: 'p_other' }, 'card_not_found'],
    [{ card: { video_status: 'Posted' } }, {}, 'card_posted'],
    [{ card: { video_deliverable_id: 'd1' } }, {}, 'card_linked_to_production'],
    [{ card: { graphic_deliverable_id: 'g1' } }, {}, 'card_linked_to_production'],
    [{ production: [{ card_id: CARD }] }, {}, 'card_linked_to_production'],
    [{ enabled: false }, {}, 'not_a_trial_card'],
    [{}, { LIVE_CHECK_LETTER: 'C' }, 'version_not_found'],
    [{ healOnRead: true }, {}, 'read_healed_a_link'],
  ];
  for (const [over, e, want] of refusals) {
    const r = await go(over, e);
    ok(r.exit === 1 && r.summary.refused === want && r.st.writes === 0, 'refused before any write: ' + want);
  }
  const missing = await go({}, { SYNCVIEW_STAFF_KEY: '' });
  ok(missing.exit === 2 && missing.st.writes === 0, 'no key: nothing is called');

  // A full walk on a well-behaved function.
  const good = await go();
  const s = good.summary;
  ok(good.exit === 0 && s.steps_passed === 5 && s.steps_total === 5 && s.restored === true, 'a full walk passes and the version is put back (' + JSON.stringify([s.steps_passed, s.restored]) + ')');
  ok(s.start_status === 'For SMM Approval' && good.st.versions[0].card_status === 'For SMM Approval', 'the version ends at the word it started at');
  ok(s.steps[0].events_added === 0 && s.steps[0].event_ok === true, 'a pick of the word it already has writes no history row, and that is checked');
  ok(s.steps.slice(1).every((x) => x.events_added === 1 && x.event_ok && x.status_read_back && x.card_unchanged), 'every other pick: one trial_status row, read back, card untouched');
  ok(s.restore.events_added === 1 && s.restore.to === 'For SMM Approval', 'the put-back is itself checked like a pick');
  ok(good.st.versions[1].card_status === 'Tweaks Needed', 'the other version is never picked');

  // What must fail the run.
  const touched = await go({ touchCard: true });
  ok(touched.exit === 1 && touched.summary.steps.slice(1).every((x) => x.card_unchanged === false), 'a function that writes the card fails the run');
  const wrong = await go({ wrongFrom: true });
  ok(wrong.exit === 1 && wrong.summary.steps.slice(1).every((x) => x.event_ok === false), 'a history row with the wrong from status fails the run');
  const refused = await go({ refuse: 'Kasper Approval' });
  const k = refused.summary.steps[1];
  ok(refused.exit === 1 && k.ok === false && k.error === 'status_follows_card' && k.http_status === 409, 'a refused pick fails the run and names the refusal code');
  ok(refused.summary.steps[2].ok === true && refused.summary.steps[2].event_ok === true, 'after a refusal the walk goes on from the word the version really has');

  // The log is public.
  const printed = good.logs.join('\n') + JSON.stringify(good.summary) + JSON.stringify(touched.summary) + JSON.stringify(refused.summary);
  for (const bad of [CARD, CLIENT, SECRET_LINK, 'f.io', 'fixture-staff-key-not-real', 'fixture-anon', 'Video A']) ok(!printed.includes(bad), 'the summary never prints ' + JSON.stringify(bad.slice(0, 12) + '…'));

  console.log(`\ntrial-version-status-live-check: ${passed} passed, 0 failed`);
})().catch((e) => { console.error(e); process.exit(1); });

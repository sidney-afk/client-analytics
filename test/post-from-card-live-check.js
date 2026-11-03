'use strict';
/*
 * The D6 live check for "From a card" (scripts/post-from-card-live-check.js), driven offline against fakes.
 * Proves the rules that keep it from ever publishing:
 *   1. the post is created SCHEDULED at least 7 days ahead (8), never "now"; on TikTok also private and to drafts;
 *   2. it is cancelled at once, then read back, and only "cancelled" read back is a pass;
 *   3. a failed cancel, or a read-back that is not "cancelled", exits 3 with the alarm and the row id to cancel by hand;
 *   4. a create that answered badly but not with a clear no is still cancelled (it may have made a post);
 *   5. a clear refusal (4xx) cancels nothing and exits 1; no account on file stops before any copy;
 *   6. the log carries no client name, account id, caption, address or key.
 * Run: node test/post-from-card-live-check.js
 */
const assert = require('assert/strict');
const crypto = require('crypto');
const { runCheck, accountFromCsv, MIN_AHEAD_MS, ALLOWED_CLIENT_SHA256 } = require('../scripts/post-from-card-live-check.js');

const CLIENT = 'fixtureclient';   // the card's client slug
const ALLOWED = [crypto.createHash('sha256').update(CLIENT).digest('hex')];
const NOW = Date.UTC(2026, 10, 3, 4, 0, 0);
const CSV = 'client_name,postforme_account_id,postforme_instagram_account_id\r\n"Other",spc_otherTikTok01,spc_otherInsta001\r\n"Fixture Client",spc_fixtureTikTok1,spc_fixtureInsta01\r\n';

function world(over = {}) {
  const calls = []; const lines = [];
  const answers = Object.assign({
    'post-source': { status: 200, json: { ok: true, media_url: 'https://data.postforme.dev/v/1', thumb_url: 'https://data.postforme.dev/t/1', rendition: 'original', bytes: 28291416 } },
    'instagram-upload:create': { status: 200, json: { ok: true, row: { id: 'ig_row_1', status: 'scheduled' } } },
    'instagram-upload:cancel': { status: 200, json: { ok: true, row: { id: 'ig_row_1', status: 'cancelled' } } },
    'instagram-upload:status': { status: 200, json: { ok: true, row: { id: 'ig_row_1', status: 'cancelled' } } },
    'tiktok-upload:create': { status: 200, json: { ok: true, row: { id: 'tk_row_1', status: 'scheduled' } } },
    'tiktok-upload-cancel': { status: 200, json: { ok: true, code: 'cancelled' } },
    'tiktok-upload:status': { status: 200, json: { ok: true, row: { id: 'tk_row_1', status: 'cancelled' } } },
  }, over);
  const deps = {
    call: async (fn, body) => { calls.push({ fn, body }); return answers[body.action ? fn + ':' + body.action : fn] || { status: 500, json: null }; },
    readClientsCsv: async () => (over.csv === undefined ? CSV : over.csv),
    readCard: async (id) => (over.cards || [{ id: 'p_1', client: CLIENT }]).filter((c) => c.id === id),
    allowed: over.allowed || ALLOWED,
    now: () => NOW,
    log: (l) => lines.push(l),
  };
  return { deps, calls, lines };
}
let checks = 0;
const ok = async (what, fn) => { await fn(); checks++; console.log('  ok  ' + what); };

(async () => {
  await ok('the account is read for the side from the Clients Info copy, by the card\'s client slug', async () => {
    assert.equal(accountFromCsv(CSV, CLIENT, 'instagram'), 'spc_fixtureInsta01');
    assert.equal(accountFromCsv(CSV, CLIENT, 'tiktok'), 'spc_fixtureTikTok1');
    assert.equal(accountFromCsv(CSV, 'nobody', 'tiktok'), '');
    assert.equal(accountFromCsv(CSV + '"FIXTURE-client",spc_x,spc_twinInstagram1\r\n', CLIENT, 'instagram'), '', 'two rows for one client: nothing (fail closed)');
  });
  await ok('the card id is the only input: a card of a client not on the allowlist is refused before anything is called', async () => {
    const w = world({ allowed: ['0'.repeat(64)] });
    assert.equal(await runCheck({ card: 'p_1', side: 'instagram' }, w.deps), 2);
    assert.equal(w.calls.length, 0); assert.match(w.lines.join('\n'), /not on the live check's allowlist/);
    const missing = world({ cards: [] });
    assert.equal(await runCheck({ card: 'p_1', side: 'tiktok' }, missing.deps), 2); assert.equal(missing.calls.length, 0);
    assert.equal(ALLOWED_CLIENT_SHA256[0], crypto.createHash('sha256').update('sidneylaruel').digest('hex'), 'the test client is on the shipped allowlist, by hash');
    assert.ok(ALLOWED_CLIENT_SHA256.every((h) => /^[0-9a-f]{64}$/.test(h)), 'hashes only');
  });
  await ok('Instagram: copy, create scheduled 8 days ahead, cancel at once, read back cancelled, exit 0', async () => {
    const w = world();
    assert.equal(await runCheck({ card: 'p_1', side: 'instagram' }, w.deps), 0);
    assert.deepEqual(w.calls.map((c) => c.fn + (c.body.action ? ':' + c.body.action : '')), ['post-source', 'instagram-upload:create', 'instagram-upload:cancel', 'instagram-upload:status']);
    const create = w.calls[1].body;
    assert.ok(Date.parse(create.scheduledAtUTC) - NOW >= MIN_AHEAD_MS, 'at least 7 days ahead');
    assert.equal(create.socialAccountId, 'spc_fixtureInsta01'); assert.equal(create.mediaUrl, 'https://data.postforme.dev/v/1'); assert.equal(create.coverUrl, 'https://data.postforme.dev/t/1');
    assert.equal(w.calls[2].body.id, 'ig_row_1');
  });
  await ok('P4: a version letter copies that version and schedules it as a trial reel, then cancels and reads back', async () => {
    const w = world();
    assert.equal(await runCheck({ card: 'p_1', side: 'instagram', letter: 'b' }, w.deps), 0);
    assert.deepEqual(w.calls[0].body, { client: w.calls[0].body.client, post_id: 'p_1', side: 'instagram', letter: 'B' });
    const create = w.calls[1].body;
    assert.equal(create.options.trial_reel_type, 'manual'); assert.ok(/_B$/.test(create.idempotencyKey));
    assert.ok(Date.parse(create.scheduledAtUTC) - NOW >= MIN_AHEAD_MS, 'at least 7 days ahead');
    assert.deepEqual(w.calls.slice(2).map((c) => c.body.action), ['cancel', 'status']);
  });
  await ok('P4: a bad letter, or a letter on the TikTok side, is refused before anything is called', async () => {
    for (const input of [{ card: 'p_1', side: 'instagram', letter: 'H' }, { card: 'p_1', side: 'tiktok', letter: 'B' }]) {
      const w = world();
      assert.equal(await runCheck(input, w.deps), 2); assert.equal(w.calls.length, 0);
    }
  });
  await ok('TikTok: scheduled 8 days ahead, private and to drafts, cancelled through tiktok-upload-cancel, read back', async () => {
    const w = world();
    assert.equal(await runCheck({ card: 'p_1', side: 'tiktok' }, w.deps), 0);
    const create = w.calls[1].body;
    assert.ok(Date.parse(create.scheduledAtUTC) - NOW >= MIN_AHEAD_MS);
    assert.equal(create.options.privacy_level, 'SELF_ONLY'); assert.equal(create.options.post_mode, 'MEDIA_UPLOAD');
    assert.equal(w.calls[2].fn, 'tiktok-upload-cancel'); assert.equal(w.calls[2].body.id, 'tk_row_1');
    assert.equal(w.calls[3].body.action, 'status');
  });
  await ok('a failed cancel exits 3 with the alarm and the row id to cancel by hand', async () => {
    for (const side of ['instagram', 'tiktok']) {
      const w = world({ 'instagram-upload:cancel': { status: 502, json: { ok: false, error: 'Post For Me did not cancel the post.' } }, 'tiktok-upload-cancel': { status: 502, json: { ok: false, code: 'cancel_failed' } } });
      assert.equal(await runCheck({ card: 'p_1', side }, w.deps), 3, side);
      assert.match(w.lines.join('\n'), /CANCEL FAILED: A SCHEDULED POST MAY STILL EXIST/);
      assert.match(w.lines.join('\n'), side === 'instagram' ? /ig_row_1/ : /tk_row_1/);
    }
  });
  await ok('a read-back that is not "cancelled" exits 3', async () => {
    const w = world({ 'instagram-upload:status': { status: 200, json: { ok: true, row: { id: 'ig_row_1', status: 'scheduled' } } } });
    assert.equal(await runCheck({ card: 'p_1', side: 'instagram' }, w.deps), 3);
    assert.match(w.lines.join('\n'), /READ-BACK DID NOT SAY CANCELLED/);
  });
  await ok('a create whose answer was lost (5xx) is still cancelled, under the key as the row id on TikTok', async () => {
    const w = world({ 'tiktok-upload:create': { status: 502, json: null } });
    assert.equal(await runCheck({ card: 'p_1', side: 'tiktok' }, w.deps), 0);
    assert.equal(w.calls[2].fn, 'tiktok-upload-cancel'); assert.equal(w.calls[2].body.id, w.calls[1].body.idempotencyKey);
  });
  await ok('a clear refusal (4xx) cancels nothing and exits 1; no account stops before any copy', async () => {
    const w = world({ 'instagram-upload:create': { status: 403, json: { ok: false, error: 'not the account on file' } } });
    assert.equal(await runCheck({ card: 'p_1', side: 'instagram' }, w.deps), 1);
    assert.equal(w.calls.length, 2);
    const w2 = world({ csv: 'client_name,postforme_account_id\r\n' });
    assert.equal(await runCheck({ card: 'p_1', side: 'tiktok' }, w2.deps), 2);
    assert.equal(w2.calls.length, 0);
  });
  await ok('the log carries no client name, account id, caption, address or key', async () => {
    const w = world();
    await runCheck({ card: 'p_1', side: 'instagram' }, w.deps);
    const all = w.lines.join('\n');
    assert.doesNotMatch(all, /fixtureclient|Fixture Client|spc_|postforme\.dev|SyncView live check|livecheck/i);
    assert.match(all, /"rendition":"original"/); assert.match(all, /"read_back_status":"cancelled"/);
  });
  console.log(`post-from-card-live-check: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });

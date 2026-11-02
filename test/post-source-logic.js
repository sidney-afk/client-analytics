'use strict';
/*
 * post-source (plan row F4, OPEN_REPAIRS 649): a card's or a trial version's video copied from Frame.io into Post for
 * Me storage, server to server. Runs the function's whole handler under Node with every outside thing faked: the
 * card and version reads, Frame (through frameio-view's lookup, faked here), Post for Me's upload address, and the
 * copy itself. Nothing reaches a real service and no post is ever created.
 *
 * Proves:
 *   1. refusals: no client or card id, a bad letter, a client not switched on, a card of another client, a version
 *      that does not exist or has no link, a folder link (strict lookup), a file too large for the side;
 *   2. the link is read on the server from the card (or the version; A is the card), never from the request;
 *   3. D2's rendition rule: the Original when Frame says it is an H.264 MP4; otherwise the largest H.264 proxy
 *      (high_quality before efficient); never a smaller proxy when a bigger one exists; unknown facts never pick
 *      the Original; a 403 on the Original falls to the largest proxy and says so;
 *   4. the copy streams Frame's body into one Post for Me upload address and answers its media_url; no Frame address
 *      is ever in the answer.
 *
 * Run: node test/post-source-logic.js
 */
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const HANDLER = pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'post-source', 'handler.mjs')).href;
const MB = 1024 * 1024;
const FRAME = {
  original: 'https://assets.frame.io/orig/clip.mov?Expires=9999999999',
  high_quality: 'https://assets.frame.io/hq/clip.mp4?Expires=9999999999',
  efficient: 'https://assets.frame.io/eff/clip.mp4?Expires=9999999999',
};
const CARD_LINK = 'https://next.frame.io/share/aaaa/view/bbbb';
const B_LINK = 'https://next.frame.io/share/cccc/view/dddd';

function world(over = {}) {
  const calls = { lookups: [], gets: [], puts: [], mints: 0 };
  const sizes = Object.assign({ original: 120 * MB, high_quality: 40 * MB, efficient: 6 * MB }, over.sizes || {});
  const deps = {
    allowedClients: 'test-client',
    readCard: async (client, postId) => (over.cards || [{ id: 'p_1', client: 'test-client', asset_url: CARD_LINK }])
      .find((c) => c.client === client && c.id === postId) || null,
    // Every stored row for the card, as the table holds them (duplicates of a letter are allowed: the table is unique
    // on client, batch, video and letter, not on the card and letter).
    readVersions: async (client, postId) => (over.versions || [{ id: 'v_b', client: 'test-client', post_id: 'p_1', letter: 'B', frame_url: B_LINK, created_at: '2026-10-01T00:00:00Z' }])
      .filter((v) => v.client === client && v.post_id === postId),
    lookupVideo: async (link) => {
      calls.lookups.push(link);
      if (over.lookupError) throw over.lookupError;
      return { name: 'Final cut.mp4', file_id: 'f_1', duration_seconds: 31, renditions: over.renditions || { ...FRAME } };
    },
    fileFacts: async () => (over.facts === undefined ? { media_type: 'video/mp4', codec: 'h264', width: 1080, height: 1920 } : over.facts),
    mint: async () => { calls.mints++; return over.mintFails ? { ok: false } : { ok: true, upload_url: 'https://storage.postforme.test/put/' + calls.mints, media_url: 'https://data.postforme.dev/m/' + calls.mints }; },
    fetchFn: async (url, init = {}) => {
      if ((init.method || 'GET') === 'PUT') {
        calls.puts.push({ url, body: init.body, headers: init.headers || {}, duplex: init.duplex });
        return { ok: !over.putFails, status: over.putFails ? 500 : 200, body: null };
      }
      calls.gets.push(url);
      const name = Object.keys(FRAME).find((k) => FRAME[k] === url);
      if (over.forbidOriginal && name === 'original') return { ok: false, status: 403, headers: new Map(), body: { cancel() {} } };
      const len = sizes[name];
      return { ok: true, status: 200, headers: new Map([['content-length', String(len)], ['content-type', 'video/mp4']]), body: { stream: name, cancel() { calls.cancelled = name; } } };
    },
    now: () => 1_700_000_000_000,
  };
  return { deps, calls };
}

let checks = 0;
const ok = async (what, fn) => { await fn(); checks++; console.log('  ok  ' + what); };

(async () => {
  const { handlePostSource, pickPostRendition } = await import(HANDLER);
  const run = (w, body) => handlePostSource({ body, deps: w.deps });

  // ---- 1. refusals
  await ok('a request with no client or no card id is refused, and nothing is read from Frame', async () => {
    for (const body of [{ post_id: 'p_1' }, { client: 'test-client' }, {}]) {
      const w = world();
      const r = await run(w, body);
      assert.equal(r.status, 400); assert.equal(r.body.error, 'bad_request');
      assert.equal(w.calls.lookups.length, 0);
    }
  });
  await ok('a letter outside A to G is refused', async () => {
    const w = world();
    const r = await run(w, { client: 'test-client', post_id: 'p_1', letter: 'H' });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'bad_request');
  });
  await ok('a client not switched on for posting is refused before anything is read', async () => {
    const w = world();
    w.deps.allowedClients = 'someone-else';
    const r = await run(w, { client: 'test-client', post_id: 'p_1' });
    assert.equal(r.status, 403); assert.equal(r.body.error, 'client_not_allowed');
    assert.equal(w.calls.lookups.length, 0); assert.equal(w.calls.mints, 0);
    w.deps.allowedClients = '';
    assert.equal((await run(w, { client: 'test-client', post_id: 'p_1' })).body.error, 'client_not_allowed', 'nobody until the setting is set');
    w.deps.allowedClients = '*';
    assert.equal((await run(w, { client: 'test-client', post_id: 'p_1' })).status, 200, '"*" is everyone');
  });
  await ok('a card of another client is not found, so its link is never used', async () => {
    const w = world({ cards: [{ id: 'p_1', client: 'other-client', asset_url: CARD_LINK }] });
    const r = await run(w, { client: 'test-client', post_id: 'p_1' });
    assert.equal(r.status, 404); assert.equal(r.body.error, 'card_not_found');
    assert.equal(w.calls.lookups.length, 0);
  });
  await ok('a card with no Frame link is refused with a plain message', async () => {
    const w = world({ cards: [{ id: 'p_1', client: 'test-client', asset_url: '' }] });
    const r = await run(w, { client: 'test-client', post_id: 'p_1' });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'no_link'); assert.match(r.body.message, /Frame/);
  });
  await ok('a version that does not exist, or has no link, is refused', async () => {
    let w = world();
    let r = await run(w, { client: 'test-client', post_id: 'p_1', letter: 'C' });
    assert.equal(r.status, 404); assert.equal(r.body.error, 'version_not_found');
    w = world({ versions: [{ id: 'v_b', client: 'test-client', post_id: 'p_1', letter: 'B', frame_url: '', created_at: '2026-10-01T00:00:00Z' }] });
    r = await run(w, { client: 'test-client', post_id: 'p_1', letter: 'B' });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'no_link');
  });
  await ok('two rows for the same letter: the one trial-reels shows (earliest, then smallest id) is the one copied', async () => {
    const LATE = 'https://next.frame.io/share/late/view/late';
    const w = world({ versions: [
      { id: 'v_9', client: 'test-client', post_id: 'p_1', letter: 'B', frame_url: LATE, created_at: '2026-10-05T00:00:00Z' },
      { id: 'v_2', client: 'test-client', post_id: 'p_1', letter: 'B', frame_url: B_LINK, created_at: '2026-10-01T00:00:00Z' },
      { id: 'v_1', client: 'test-client', post_id: 'p_1', letter: 'C', frame_url: LATE, created_at: '2026-09-01T00:00:00Z' },
    ] });
    const r = await run(w, { client: 'test-client', post_id: 'p_1', letter: 'B' });
    assert.equal(r.status, 200); assert.deepEqual(w.calls.lookups, [B_LINK]);
    const tie = world({ versions: [
      { id: 'v_8', client: 'test-client', post_id: 'p_1', letter: 'B', frame_url: LATE, created_at: '2026-10-01T00:00:00Z' },
      { id: 'v_3', client: 'test-client', post_id: 'p_1', letter: 'B', frame_url: B_LINK, created_at: '2026-10-01T00:00:00Z' },
    ] });
    await run(tie, { client: 'test-client', post_id: 'p_1', letter: 'B' });
    assert.deepEqual(tie.calls.lookups, [B_LINK], 'same time: the smallest id');
  });
  await ok("a Frame refusal (a folder link under the strict lookup) is passed on as it is, and nothing is copied", async () => {
    const err = Object.assign(new Error('This link opens a folder. Paste the video’s own link.'), { code: 'folder_link', status: 422 });
    const w = world({ lookupError: err });
    const r = await run(w, { client: 'test-client', post_id: 'p_1' });
    assert.equal(r.status, 422); assert.equal(r.body.error, 'folder_link'); assert.equal(r.body.message, err.message);
    assert.equal(w.calls.mints, 0); assert.equal(w.calls.puts.length, 0);
  });
  await ok('a file over the side\'s limit is refused before any upload, and Frame\'s download is stopped', async () => {
    const w = world({ sizes: { original: 300 * MB } });
    const r = await run(w, { client: 'test-client', post_id: 'p_1', side: 'tiktok' });
    assert.equal(r.status, 413); assert.equal(r.body.error, 'too_large'); assert.match(r.body.message, /287 MB/);
    assert.equal(w.calls.puts.length, 0); assert.equal(w.calls.cancelled, 'original');
  });
  await ok('Post for Me not giving an upload address, or refusing the upload, says to download from Frame instead', async () => {
    let w = world({ mintFails: true });
    let r = await run(w, { client: 'test-client', post_id: 'p_1' });
    assert.equal(r.status, 502); assert.equal(r.body.error, 'copy_failed'); assert.match(r.body.message, /Download it from Frame/);
    w = world({ putFails: true });
    r = await run(w, { client: 'test-client', post_id: 'p_1' });
    assert.equal(r.status, 502); assert.equal(r.body.error, 'copy_failed');
  });

  // ---- 2. the link comes from the server
  await ok('the card\'s own link is looked up, never one sent in the request; letter A is the card', async () => {
    for (const letter of [undefined, 'A', 'a']) {
      const w = world();
      const r = await run(w, { client: 'test-client', post_id: 'p_1', letter, link: 'https://next.frame.io/share/evil/view/evil' });
      assert.equal(r.status, 200);
      assert.deepEqual(w.calls.lookups, [CARD_LINK]);
    }
  });
  await ok('letter B uses version B\'s own link', async () => {
    const w = world();
    const r = await run(w, { client: 'test-client', post_id: 'p_1', letter: 'B' });
    assert.equal(r.status, 200); assert.deepEqual(w.calls.lookups, [B_LINK]);
  });

  // ---- 3. D2: which file
  await ok('D2: an H.264 MP4 Original is the file that goes', async () => {
    assert.equal(pickPostRendition(FRAME, { media_type: 'video/mp4', codec: 'h264' })[0], 'original');
    assert.equal(pickPostRendition(FRAME, { media_type: 'video/mp4', codec: 'AVC' })[0], 'original');
    assert.equal(pickPostRendition(FRAME, { media_type: 'video/mp4', codec: 'avc1' })[0], 'original');
  });
  await ok('D2: an HEVC or QuickTime Original passes over to the full-size proxy', async () => {
    assert.equal(pickPostRendition(FRAME, { media_type: 'video/mp4', codec: 'hevc' })[0], 'high_quality');
    assert.equal(pickPostRendition(FRAME, { media_type: 'video/quicktime', codec: 'h264' })[0], 'high_quality');
    assert.equal(pickPostRendition(FRAME, { media_type: 'video/mp4', codec: 'ProRes 422' })[0], 'high_quality');
  });
  await ok('D2: facts Frame did not give never pick the Original', async () => {
    assert.equal(pickPostRendition(FRAME, null)[0], 'high_quality');
    assert.equal(pickPostRendition(FRAME, { media_type: 'video/mp4' })[0], 'high_quality');
    assert.equal(pickPostRendition(FRAME, { codec: 'h264' })[0], 'high_quality');
  });
  await ok('D2: never a smaller proxy when a bigger one exists; the small one only when it is all there is', async () => {
    const order = pickPostRendition(FRAME, { media_type: 'video/mp4', codec: 'hevc' });
    assert.deepEqual(order, ['high_quality', 'efficient']);
    assert.deepEqual(pickPostRendition({ efficient: FRAME.efficient, original: FRAME.original }, { media_type: 'video/quicktime', codec: 'hevc' }), ['efficient']);
    assert.deepEqual(pickPostRendition(FRAME, { media_type: 'video/mp4', codec: 'h264' }), ['original', 'high_quality', 'efficient']);
  });
  await ok('D2: an Original that is not H.264 MP4 with no proxy at all is refused, not sent', async () => {
    const w = world({ renditions: { original: FRAME.original }, facts: { media_type: 'video/quicktime', codec: 'hevc' } });
    const r = await run(w, { client: 'test-client', post_id: 'p_1' });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'no_h264_copy'); assert.equal(w.calls.mints, 0);
  });
  await ok('D2 end to end: the H.264 MP4 Original is copied and named on the answer', async () => {
    const w = world();
    const r = await run(w, { client: 'test-client', post_id: 'p_1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.rendition, 'original'); assert.equal(r.body.fell_back_from_original, false);
    assert.equal(r.body.bytes, 120 * MB); assert.equal(r.body.width, 1080); assert.equal(r.body.height, 1920);
    assert.deepEqual(w.calls.gets, [FRAME.original]);
  });
  await ok('D2 end to end: a 403 on the Original takes the largest proxy and says so', async () => {
    const w = world({ forbidOriginal: true });
    const r = await run(w, { client: 'test-client', post_id: 'p_1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.rendition, 'high_quality'); assert.equal(r.body.fell_back_from_original, true);
    assert.deepEqual(w.calls.gets, [FRAME.original, FRAME.high_quality]);
    assert.equal(w.calls.mints, 1, 'one upload address, minted only once the file to send is known');
  });

  // ---- 4. the copy
  await ok('the copy streams Frame\'s body straight into the upload address and answers its media_url', async () => {
    const w = world({ facts: { media_type: 'video/mp4', codec: 'hevc', width: 1080, height: 1920 } });
    const r = await run(w, { client: 'test-client', post_id: 'p_1', side: 'instagram' });
    assert.equal(r.status, 200);
    assert.equal(w.calls.puts.length, 1);
    const put = w.calls.puts[0];
    assert.equal(put.url, 'https://storage.postforme.test/put/1');
    assert.deepEqual(put.body, { stream: 'high_quality', cancel: put.body.cancel }, 'the body is Frame\'s own stream, not a buffered copy');
    assert.equal(put.duplex, 'half', 'a streamed request body needs duplex half');
    assert.equal(put.headers['Content-Length'], String(40 * MB));
    assert.equal(put.headers['Content-Type'], 'video/mp4');
    assert.equal(r.body.media_url, 'https://data.postforme.dev/m/1');
    assert.equal(r.body.file_name, 'Final cut.mp4');
    assert.equal(r.body.duration_seconds, 31);
    assert.equal(typeof r.body.took_ms, 'number');
  });
  await ok('no Frame address is ever in an answer, a success or a refusal', async () => {
    const answers = [];
    answers.push((await run(world(), { client: 'test-client', post_id: 'p_1' })).body);
    answers.push((await run(world({ forbidOriginal: true }), { client: 'test-client', post_id: 'p_1' })).body);
    answers.push((await run(world({ putFails: true }), { client: 'test-client', post_id: 'p_1' })).body);
    answers.push((await run(world({ sizes: { original: 900 * MB } }), { client: 'test-client', post_id: 'p_1', side: 'tiktok' })).body);
    for (const a of answers) assert.doesNotMatch(JSON.stringify(a), /frame\.io/i);
  });

  // ---- 5. the live check prints numbers only
  await ok('the live check\'s log line carries no address, file name or key', async () => {
    const { safeSummary } = require('../scripts/post-source-live-check.js');
    const r = await run(world(), { client: 'test-client', post_id: 'p_1' });
    const line = JSON.stringify(safeSummary({ ...r.body, key: 'secret-key-value' }));
    assert.doesNotMatch(line, /postforme|frame\.io|Final cut|secret-key-value|media_url|file_name/i);
    assert.match(line, /"rendition":"original"/); assert.match(line, /"bytes":/); assert.match(line, /"took_ms":/);
  });

  console.log(`post-source-logic: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });

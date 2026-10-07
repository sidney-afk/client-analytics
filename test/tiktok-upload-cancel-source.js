'use strict';
// tiktok-upload-cancel Edge Function: the cancel decision under Node with Post For Me and the queue Sheet
// faked, plus static wiring checks. No network, nothing reaches Post For Me or Google.
// The rule under test: the queue row says cancelled ONLY after Post For Me no longer holds the post.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// A fake Post For Me holding posts by id. mode: 'normal' | 'refuse_delete' | 'down' | 'publishes_on_delete' | 'delete_lies'.
function fakePfm(posts, { mode = 'normal', results = {} } = {}) {
  const calls = [];
  const fn = async (method, p) => {
    calls.push(method + ' ' + p);
    if (mode === 'down') return { ok: false, status: 0, data: {} };
    let m;
    if ((m = /^\/social-post-results\?post_id=(.+)$/.exec(p))) return { ok: true, status: 200, data: { data: results[decodeURIComponent(m[1])] || [] } };
    if ((m = /^\/social-posts\?external_id=(.+)$/.exec(p))) {
      const ext = decodeURIComponent(m[1]);
      return { ok: true, status: 200, data: { data: Object.values(posts).filter((x) => x.external_id === ext) } };
    }
    m = /^\/social-posts\/(.+)$/.exec(p);
    const id = decodeURIComponent(m[1]);
    if (method === 'GET') return posts[id] ? { ok: true, status: 200, data: posts[id] } : { ok: false, status: 404, data: { message: 'not found' } };
    if (method === 'DELETE') {
      if (!posts[id]) return { ok: false, status: 404, data: {} };
      if (mode === 'refuse_delete') return { ok: false, status: 500, data: { message: 'boom' } };
      if (mode === 'publishes_on_delete') { posts[id].status = 'processing'; return { ok: false, status: 400, data: {} }; }
      if (mode === 'delete_lies') return { ok: true, status: 200, data: { success: true } };
      delete posts[id];
      return { ok: true, status: 200, data: { success: true } };
    }
    throw new Error('unexpected ' + method + ' ' + p);
  };
  fn.calls = calls;
  return fn;
}
function fakeSheet(row, { writeFails = false } = {}) {
  const s = {
    row, writes: 0,
    async find(id) { return row && row.id === id ? { row: { ...row }, rowNumber: 2, header: Object.keys(row) } : null; },
    async markCancelled(found, nowIso) { if (writeFails) throw new Error('sheet_write_failed_500'); s.writes++; row.status = 'cancelled'; row.updated_at = nowIso; },
  };
  return s;
}
const NOW = '2026-10-07T12:00:00.000Z';
const scheduledRow = () => ({ id: 'tk_1', client: 'Fixture client', status: 'scheduled', upload_post_id: 'sp_1', error: '', updated_at: '' });
const scheduledPost = () => ({ sp_1: { id: 'sp_1', status: 'scheduled', external_id: 'tk_1' } });

(async () => {
  const L = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/tiktok-upload-cancel/logic.mjs')).href);
  const run = (row, pfm, opts) => { const sheet = fakeSheet(row, opts); return L.cancelTiktokUpload({ id: row ? row.id : 'nope', pfm, sheet, nowIso: NOW }).then((out) => ({ out, sheet })); };

  // 1. Success: deleted in Post For Me, proven gone, THEN the row says cancelled.
  {
    const posts = scheduledPost(); const pfm = fakePfm(posts); const row = scheduledRow();
    const { out, sheet } = await run(row, pfm);
    eq([out.status, out.body.ok, out.body.code], [200, true, 'cancelled'], 'a scheduled post is cancelled');
    ok(!posts.sp_1, 'the post is gone from Post For Me');
    eq(sheet.writes, 1, 'the row is written once'); eq(row.status, 'cancelled', 'the row says cancelled');
    const del = pfm.calls.indexOf('DELETE /social-posts/sp_1');
    ok(del > 0 && pfm.calls.slice(del + 1).includes('GET /social-posts/sp_1'), 'the post is read back after the delete');
  }
  // 2. Already posted: Post For Me says processed (or processing). Nothing deleted, row untouched.
  for (const st of ['processed', 'processing']) {
    const posts = { sp_1: { id: 'sp_1', status: st } }; const pfm = fakePfm(posts); const row = scheduledRow();
    const { out, sheet } = await run(row, pfm);
    eq([out.status, out.body.ok, out.body.code, out.body.message], [409, false, 'already_posted', 'Already posted, could not cancel.'], st + ' means already posted');
    ok(!pfm.calls.some((c) => c.startsWith('DELETE')), st + ': nothing is deleted');
    eq([sheet.writes, row.status], [0, 'scheduled'], st + ': the row does not say cancelled');
  }
  // 2b. Post gone but a result says it published: already posted, not cancelled.
  {
    const pfm = fakePfm({}, { results: { sp_1: [{ post_id: 'sp_1', success: true }] } }); const row = scheduledRow();
    const { out, sheet } = await run(row, pfm);
    eq([out.body.code, sheet.writes], ['already_posted', 0], 'a success result means posted even when the post record is gone');
  }
  // 2c. It started publishing while we asked: the refused delete is re-read and reported as posted.
  {
    const posts = scheduledPost(); const pfm = fakePfm(posts, { mode: 'publishes_on_delete' }); const row = scheduledRow();
    const { out, sheet } = await run(row, pfm);
    eq([out.body.code, sheet.writes, row.status], ['already_posted', 0, 'scheduled'], 'publishing mid-cancel reads as already posted');
  }
  // 3. Failures: the row must not say cancelled.
  for (const [mode, label] of [['refuse_delete', 'Post For Me refuses the delete'], ['down', 'Post For Me is unreachable'], ['delete_lies', 'the delete answers ok but the post is still there']]) {
    const posts = scheduledPost(); const pfm = fakePfm(posts, { mode }); const row = scheduledRow();
    const { out, sheet } = await run(row, pfm);
    eq([out.status, out.body.ok, out.body.code, out.body.message], [502, false, 'cancel_failed', 'Cancel failed, try again.'], label + ': cancel failed');
    eq([sheet.writes, row.status], [0, 'scheduled'], label + ': the row does not say cancelled');
  }
  // 3b. Post For Me deleted it but the Sheet write failed: reported as a failure, row untouched, a retry finishes it.
  {
    const posts = scheduledPost(); const pfm = fakePfm(posts); const row = scheduledRow();
    const { out } = await run(row, pfm, { writeFails: true });
    eq([out.status, out.body.ok, out.body.code], [502, false, 'queue_update_failed'], 'a failed queue write is a failure');
    eq(row.status, 'scheduled', 'the row did not change');
    const again = await run(row, fakePfm(posts));
    eq([again.out.body.code, row.status], ['cancelled', 'cancelled'], 'retrying after the post is gone marks the row cancelled');
  }
  // 4. No post id on the row: found by external_id, else refused (the submit may still be on its way).
  {
    const posts = scheduledPost(); const pfm = fakePfm(posts); const row = { ...scheduledRow(), upload_post_id: '' };
    const { out } = await run(row, pfm);
    eq([out.body.code, !!posts.sp_1], ['cancelled', false], 'a row without its post id is matched by external id and cancelled');
    const row2 = { ...scheduledRow(), id: 'tk_2', status: 'queued', upload_post_id: '' };
    const r2 = await run(row2, fakePfm({}));
    eq([r2.out.body.code, r2.sheet.writes], ['cancel_failed', 0], 'nothing in Post For Me yet is not a cancel');
  }
  // 5. Row states.
  eq((await run({ ...scheduledRow(), status: 'cancelled' }, fakePfm({}))).out.body.code, 'already_cancelled', 'cancelling twice is fine');
  eq((await run({ ...scheduledRow(), status: 'posted' }, fakePfm({}))).out.body.code, 'already_posted', 'a posted row is already posted');
  eq((await run({ ...scheduledRow(), status: 'failed' }, fakePfm({}))).out.status, 409, 'a failed row is not cancellable');
  eq((await run(null, fakePfm({}))).out.body.code, 'not_found', 'an unknown id is not found');

  // 6. Sheet helpers: only status, error and updated_at of the matched row are written.
  const values = [['id', 'client', 'status', 'upload_post_id', 'error', 'updated_at'], ['tk_0', 'x', 'posted', 'sp_0', '', ''], ['tk_1', 'x', 'scheduled', 'sp_1', 'old', '']];
  const found = L.locateRow(values, 'tk_1');
  eq([found.rowNumber, found.row.upload_post_id], [3, 'sp_1'], 'the row is found by id');
  eq(L.cancelUpdates(found, NOW).map((u) => [u.range, u.values[0][0]]), [["'TikTokUpload'!C3", 'cancelled'], ["'TikTokUpload'!E3", ''], ["'TikTokUpload'!F3", NOW]], 'only three cells change');
  eq(L.locateRow(values, 'tk_9'), null, 'a missing id is null');

  // 7. Wiring: the handler, the page and the deploy lane.
  const HANDLER = read('supabase/functions/tiktok-upload-cancel/index.ts');
  ok(/authorizeStaffKey\(/.test(HANDLER), 'the function requires a staff key');
  ok(/POST_FOR_ME_API_KEY/.test(HANDLER) && !/spc_|sp_[A-Za-z0-9]{6}|10QQ/.test(HANDLER), 'secrets come from env, no ids in the source');
  const SHARED = read('src/index/040-shared-briefs.js.part');
  ok(/TIKTOK_UPLOAD_CANCEL_URL = '[^']*\/functions\/v1\/tiktok-upload-cancel'/.test(SHARED), 'the Cancel button calls the Supabase function');
  const PAGE = read('src/index/300-tiktok-upload.js.part');
  ok(!/may also need to cancel it there/.test(PAGE), 'the old "cancel it there too" wording is gone');
  ok(/_syncviewEfHeaders\(\{[^}]*\}, TIKTOK_UPLOAD_CANCEL_URL\)/.test(PAGE), 'the cancel call carries the staff key');
  const DEPLOY = read('.github/workflows/deploy-single-function.yml');
  ok((DEPLOY.match(/tiktok-upload-cancel/g) || []).length >= 2, 'the function is on the one-function deploy lane (choice and re-check)');

  console.log(`tiktok-upload-cancel-source: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });

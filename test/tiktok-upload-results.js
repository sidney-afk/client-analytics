'use strict';
// The TikTok queue table stays current without n8n (OPEN_REPAIRS 369): Post For Me's result webhook lands on
// the tiktok-upload function, and a safety net asks Post For Me about every open row whose time has come.
// Runs the function's own handler under Node against a fake Post For Me and a fake table. No network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakePostForMe, fakeQueueTable } = require('./helpers/tiktok-upload-fakes.js');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const H = 3600000;
const now = Date.now();
const at = (h) => new Date(now + h * H).toISOString();
const HOOK_URL = 'https://fixture.supabase.co/functions/v1/tiktok-upload?pfm_webhook=1';
const base = { client: 'Fixture Client A', profile: 'spc_fixtureTiktok01', timezone: 'UTC', error: '', tiktok_url: '', title: 't' };

(async () => {
  const Q = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/tiktok-queue.mjs')).href);
  const { handleResultWebhook, handleTiktokUpload } = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/tiktok-upload/handler.mjs')).href);

  // --- 1. The secret check.
  ok(Q.sameSecret('whsec_abc', 'whsec_abc'), 'the same secret matches');
  ok(!Q.sameSecret('whsec_abd', 'whsec_abc') && !Q.sameSecret('whsec_ab', 'whsec_abc') && !Q.sameSecret('', 'whsec_abc') && !Q.sameSecret('x', ''), 'anything else does not');
  eq(Q.webhookFor({ data: [{ id: 'a', url: 'https://other.example/x' }, { id: 'b', url: HOOK_URL, secret: 's' }] }, HOOK_URL).id, 'b', 'our webhook is found by its url');

  // --- 2. The webhook: a result lands on the row by upload_post_id.
  {
    const store = fakeQueueTable({ rows: [
      { ...base, id: 'w1', status: 'scheduled', scheduled_for: at(-1), upload_post_id: 'sp_w1', created_at: at(-30) },
      { ...base, id: 'w2', status: 'processing', upload_post_id: 'sp_w2', created_at: at(-2) },
      { ...base, id: 'w3', status: 'cancelled', upload_post_id: 'sp_w3', created_at: at(-2) },
    ] });
    const hook = (secret, body, expected = 'whsec_live') => handleResultWebhook({ secret, body, expectedSecret: async () => expected, store });
    const posted = { event_type: 'social.post.result.created', data: { id: 'spr_1', post_id: 'sp_w1', success: true, platform_data: { url: 'https://example.invalid/v/1' } } };
    eq((await hook('wrong', posted)).status, 401, 'a wrong secret is refused');
    eq((await hook('', posted)).status, 401, 'no secret is refused');
    eq(store.table.get('w1').status, 'scheduled', 'and changes nothing');
    eq((await hook('whsec_live', posted, null)).status, 503, 'no webhook configured: 503, so Post For Me retries later');
    const r1 = await hook('whsec_live', posted);
    eq([r1.status, r1.body.matched, r1.body.status], [200, true, 'posted'], 'a success result marks the row posted');
    eq([store.table.get('w1').tiktok_url, !!store.table.get('w1').posted_at, !!store.table.get('w1').last_checked_at], ['https://example.invalid/v/1', true, true], 'with its link, time and checked time');
    const failed = { event_type: 'social.post.result.created', data: { post_id: 'sp_w2', success: false, error: 'Failed to post to TikTok', details: { error: { message: 'spam_risk' } } } };
    await hook('whsec_live', failed);
    eq([store.table.get('w2').status, store.table.get('w2').error], ['failed', 'Failed to post to TikTok: spam_risk'], 'a failure keeps TikTok\'s reason');
    const late = await hook('whsec_live', { event_type: 'social.post.result.created', data: { post_id: 'sp_w3', success: true, platform_data: { url: 'https://example.invalid/v/3' } } });
    eq([late.body.status, store.table.get('w3').status], ['posted', 'posted'], 'a post that went out after all says posted: the truth wins');
    eq((await hook('whsec_live', { event_type: 'social.post.updated', data: { id: 'sp_w1' } })).body.ignored, 'event_type', 'other events are acknowledged and ignored');
    eq((await hook('whsec_live', { event_type: 'social.post.result.created', data: {} })).body.ignored, 'no_post_id', 'a result without a post id is acknowledged');
    eq((await hook('whsec_live', { event_type: 'social.post.result.created', data: { post_id: 'sp_instagram', success: true } })).body.matched, false, 'a post not in the TikTok queue (an Instagram one) is acknowledged, nothing written');
    const again = await hook('whsec_live', posted);
    eq([again.status, store.table.get('w1').status], [200, 'posted'], 'a repeated delivery is harmless');
  }

  // --- 3. The safety net: every open row whose time has come, not only the newest page.
  {
    const rows = [];
    for (let i = 0; i < 120; i++) rows.push({ ...base, id: 'new' + i, status: 'posted', upload_post_id: 'sp_new' + i, created_at: at(-i / 10) });
    rows.push({ ...base, id: 'old-due', status: 'scheduled', scheduled_for: at(-24 * 30), upload_post_id: 'sp_old', created_at: at(-24 * 31) });
    rows.push({ ...base, id: 'old-noid', status: 'scheduled', scheduled_for: at(-24 * 60), upload_post_id: '', created_at: at(-24 * 61) });
    rows.push({ ...base, id: 'lost-id', status: 'uploading', upload_post_id: '', created_at: at(-3) });
    rows.push({ ...base, id: 'future', status: 'scheduled', scheduled_for: at(48), upload_post_id: 'sp_future', created_at: at(-1) });
    const pfm = fakePostForMe({
      posts: { sp_lost: { id: 'sp_lost', status: 'processed', external_id: 'lost-id' } },
      results: {
        sp_old: [{ post_id: 'sp_old', success: true, platform_data: { url: 'https://example.invalid/v/old' } }],
        sp_lost: [{ post_id: 'sp_lost', success: true, platform_data: { url: 'https://example.invalid/v/lost' } }],
      },
    });
    const store = fakeQueueTable({ rows });
    const call = (body, role = 'smm') => handleTiktokUpload({ body, role, actor: 'QA', pfm, store, readSheet: async () => null, webhookUrl: HOOK_URL });
    const list = await call({ action: 'list' });
    ok(!list.body.rows.some((r) => r.id === 'old-due'), 'the old row is outside the newest 100 the queue shows');
    eq([store.table.get('old-due').status, store.table.get('old-due').tiktok_url], ['posted', 'https://example.invalid/v/old'], 'yet the list still settled it');
    eq([store.table.get('lost-id').upload_post_id, store.table.get('lost-id').status], ['sp_lost', 'posted'], 'a row that lost its post id finds it by external_id and settles');
    ok(store.table.get('old-noid').last_checked_at && store.table.get('old-noid').status === 'scheduled', 'a row Post For Me never had is noted as asked and left as it is');
    ok(!pfm.calls.some((c) => c.path.includes('sp_future')), 'a future post is not asked about');
    const sweep = await call({ action: 'refresh_due' });
    eq([sweep.status, sweep.body.ok, sweep.body.checked, sweep.body.still_open], [200, true, 1, 1], 'refresh_due checks what is still open and due (the row Post For Me never had)');
    eq(Q.sweepCandidates([{ id: 'a', status: 'scheduled', scheduled_for: at(-1), last_checked_at: at(-1) }, { id: 'b', status: 'processing' }, { id: 'a', status: 'scheduled', scheduled_for: at(-1) }, { id: 'c', status: 'posted' }], now, 5).map((r) => r.id), ['b', 'a'], 'never-asked first, no repeats, closed rows out');
  }

  // --- 4. Admin webhook setup: status, register (once), remove another one; never a secret.
  {
    const pfm = fakePostForMe({ webhooks: [{ id: 'wh_n8n', url: 'https://n8n.example/webhook/tiktok-result', event_types: ['social.post.result.created'], secret: 'whsec_old' }] });
    const store = fakeQueueTable();
    const call = (body, role = 'admin') => handleTiktokUpload({ body, role, actor: 'QA', pfm, store, readSheet: async () => null, webhookUrl: HOOK_URL });
    eq((await call({ action: 'webhook_status' }, 'smm')).status, 403, 'webhook setup needs the admin key');
    const st = await call({ action: 'webhook_status' });
    eq([st.body.webhook_url, st.body.webhooks.length, st.body.webhooks[0].points_here], [HOOK_URL, 1, false], 'status lists the current webhook');
    ok(!JSON.stringify(st.body).includes('whsec'), 'status never shows a secret');
    const reg = await call({ action: 'webhook_register' });
    eq([reg.body.created, reg.body.webhook.url, reg.body.webhook.event_types], [true, HOOK_URL, ['social.post.result.created']], 'register creates one webhook to the function for results');
    ok(!JSON.stringify(reg.body).includes('whsec'), 'register never shows the secret');
    eq((await call({ action: 'webhook_register' })).body.created, false, 'registering again creates nothing');
    eq((await call({ action: 'webhook_remove', id: reg.body.webhook.id })).status, 409, 'the function\'s own webhook is not removed from here');
    eq((await call({ action: 'webhook_remove', id: 'nope' })).status, 404, 'an unknown id');
    const rm = await call({ action: 'webhook_remove', id: 'wh_n8n' });
    eq([rm.body.ok, pfm.webhooks.map((w) => w.id)], [true, [reg.body.webhook.id]], 'the old n8n webhook can be removed by id');
    // The registered secret is what the webhook then accepts.
    const mine = Q.webhookFor(pfm.webhooks, HOOK_URL);
    const t = fakeQueueTable({ rows: [{ ...base, id: 'x', status: 'processing', upload_post_id: 'sp_x', created_at: at(-1) }] });
    const r = await handleResultWebhook({ secret: mine.secret, body: { event_type: 'social.post.result.created', data: { post_id: 'sp_x', success: true } }, expectedSecret: async () => Q.webhookFor((await pfm('GET', '/webhooks')).data, HOOK_URL).secret, store: t });
    eq([r.status, t.table.get('x').status], [200, 'posted'], 'a delivery carrying the registered secret is accepted');
  }

  // --- 5. Wiring.
  {
    const IDX = read('supabase/functions/tiktok-upload/index.ts');
    const webhookAt = IDX.indexOf('handleResultWebhook({'), authAt = IDX.indexOf('authorizeStaffKey(clean(');
    ok(webhookAt > 0 && authAt > webhookAt, 'the webhook is answered before the staff key check (Post For Me has no staff key)');
    ok(/searchParams\.get\("pfm_webhook"\) === "1"/.test(IDX) && /WEBHOOK_HEADER/.test(IDX), 'routed by ?pfm_webhook=1 or the secret header');
    ok(/TIKTOK_PFM_WEBHOOK_SECRET/.test(IDX) && /"GET", "\/webhooks"/.test(IDX), 'secret from the env, else from Post For Me');
    ok(!/whsec_|spc_[A-Za-z0-9]{6}/.test(IDX + read('supabase/functions/tiktok-upload/handler.mjs')), 'no secrets or account ids in the source');
    ok(/\.order\("last_checked_at", \{ ascending: true, nullsFirst: true \}\)/.test(IDX), 'the safety net reads least-recently-asked first');
  }

  console.log(`tiktok-upload-results: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });

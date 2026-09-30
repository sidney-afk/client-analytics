'use strict';
// instagram-upload Edge Function (Instagram side of the TikTok Upload tab): the pure logic under Node, plus static
// wiring checks on the handler, the migration and the deploy lane. No network, nothing reaches Post For Me.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HANDLER = read('supabase/functions/instagram-upload/index.ts');
const MIGRATION = read('migrations/2026-09-30-instagram-uploads.sql');
const DEPLOY = read('.github/workflows/deploy-single-function.yml');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

(async () => {
  const L = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/instagram-upload/logic.mjs')).href);
  const NOW = Date.parse('2026-09-30T12:00:00.000Z');
  const NOWISO = new Date(NOW).toISOString();
  const base = { clientName: 'Fixture Client A', socialAccountId: 'spc_fixtureInstagram01', title: 'Hello', mediaUrl: 'https://data.postforme.dev/x.mp4', idempotencyKey: 'key1' };

  // --- the safety switch: fail closed, nothing is listed in the repository
  ok(!L.clientAllowed('Fixture Client A', undefined), 'nobody can post until the setting exists');
  ok(!L.clientAllowed('Fixture Client A', ''), 'an empty setting allows nobody');
  ok(!L.clientAllowed('', 'fixtureclienta'), 'no client is refused');
  ok(L.clientAllowed('Fixture Client A', 'fixtureclienta, fixtureclientb'), 'a listed client is allowed, spelling and spacing aside');
  ok(L.clientAllowed('FIXTURE-CLIENT-B', 'fixtureclienta, fixtureclientb'), 'a listed slug spelling is the same client');
  ok(!L.clientAllowed('Fixture Client C', 'fixtureclienta, fixtureclientb'), 'an unlisted client is refused');
  ok(L.clientAllowed('Fixture Client C', '*'), '* allows everyone');
  ok(!('DEFAULT_ALLOWED_CLIENTS' in L), 'no default client list exists in the source');

  // --- the account must be the one on file for that client
  eq(L.expectedAccountId({ extra: { postforme_instagram_account_id: ' spc_fixtureInstagram01 ' } }), 'spc_fixtureInstagram01', 'the id on file is read from the synced Clients Info copy');
  eq(L.expectedAccountId({ extra: {} }), '', 'no id on file reads as empty');
  eq(L.expectedAccountId(null), '', 'no profile reads as empty');

  // --- status refreshes cannot be starved
  {
    const T = Date.parse('2026-09-30T12:00:00.000Z');
    const mk = (id, status, extra = {}) => ({ id, status, post_id: 'p_' + id, scheduled_for: null, last_checked_at: null, ...extra });
    const future = Array.from({ length: 12 }, (_, i) => mk('f' + i, 'scheduled', { scheduled_for: '2026-10-05T00:00:00Z' }));
    const old = mk('old', 'processing', { last_checked_at: '2026-09-29T00:00:00Z' });
    const picked = L.refreshCandidates([...future, old], T, 10);
    eq(picked.map(r => r.id), ['old'], 'future scheduled posts are never asked about, so they cannot crowd out an older one');
    const due = mk('due', 'scheduled', { scheduled_for: '2026-09-30T11:00:00Z', last_checked_at: '2026-09-30T11:30:00Z' });
    const never = mk('never', 'processing');
    eq(L.refreshCandidates([due, never, old], T, 2).map(r => r.id), ['never', 'old'], 'never-asked first, then the longest unasked, capped');
  }

  // --- the account must be an Instagram one
  eq(L.platformMismatch({ platform: 'instagram' }), '', 'instagram passes');
  ok(/tiktok, not Instagram/.test(L.platformMismatch({ platform: 'tiktok' })), 'a TikTok account is refused');
  ok(L.platformMismatch({}) !== '', 'an answer with no network is refused (fail closed)');
  ok(L.platformMismatch(null) !== '', 'no answer is refused');

  // --- create: validation
  ok(!L.buildCreate({ ...base, clientName: '' }, NOW).ok, 'client required');
  ok(!L.buildCreate({ ...base, socialAccountId: 'acct_1' }, NOW).ok, 'only spc_ ids');
  ok(!L.buildCreate({ ...base, socialAccountId: '' }, NOW).ok, 'an account id is required');
  ok(!L.buildCreate({ ...base, title: '  ' }, NOW).ok, 'caption required');
  ok(!L.buildCreate({ ...base, title: 'x'.repeat(2201) }, NOW).ok, 'caption over 2200 refused');
  ok(L.buildCreate({ ...base, title: 'x'.repeat(2200) }, NOW).ok, 'exactly 2200 accepted');
  ok(!L.buildCreate({ ...base, mediaUrl: 'https://evil.example/x.mp4' }, NOW).ok, 'media must come from Post For Me storage');
  ok(!L.buildCreate({ ...base, mediaUrl: 'http://data.postforme.dev/x.mp4' }, NOW).ok, 'and over https');
  ok(!L.buildCreate({ ...base, scheduledAtUTC: 'soon' }, NOW).ok, 'a bad time is refused');
  ok(!L.buildCreate({ ...base, scheduledAtUTC: '2026-09-30T11:00:00.000Z' }, NOW).ok, 'a time in the past is refused');
  ok(!L.buildCreate({ ...base, idempotencyKey: 'bad key!' }, NOW).ok, 'odd key characters refused');

  // --- create: post now
  let r = L.buildCreate(base, NOW, 'QA Admin');
  ok(r.ok, 'a valid request builds');
  eq(r.postBody, {
    caption: 'Hello', social_accounts: ['spc_fixtureInstagram01'], media: [{ url: 'https://data.postforme.dev/x.mp4' }],
    account_configurations: [{ social_account_id: 'spc_fixtureInstagram01', configuration: { placement: 'reels' } }], external_id: 'key1',
  }, 'posting now: a Reel to exactly one account, no schedule');
  eq(r.row.status, 'uploading', 'the row starts as uploading');
  eq(r.row.created_by, 'QA Admin', 'the actor is recorded');

  // --- create: scheduled, feed video, cover frame
  r = L.buildCreate({ ...base, scheduledAtUTC: '2026-10-01T15:00:00Z', timezone: 'America/New_York', options: { placement: 'timeline', cover_timestamp_ms: 2500 } }, NOW);
  eq(r.postBody.scheduled_at, '2026-10-01T15:00:00.000Z', 'the UTC instant is sent');
  eq(r.postBody.account_configurations[0].configuration.placement, 'timeline', 'a feed video keeps its placement');
  eq(r.postBody.media[0].thumbnail_timestamp_ms, 2500, 'the cover frame is sent');
  eq(r.row.status, 'scheduled', 'a scheduled row is scheduled');
  eq(L.buildCreate({ ...base, options: { placement: 'stories' } }, NOW).postBody.account_configurations[0].configuration.placement, 'reels', 'an unknown placement falls back to a Reel');
  eq(L.buildCreate({ ...base, options: '{"placement":"timeline"}' }, NOW).postBody.account_configurations[0].configuration.placement, 'timeline', 'options sent as text are read');
  ok(/^ig_/.test(L.buildCreate({ ...base, idempotencyKey: '' }, NOW).row.id), 'a missing key gets a generated one');

  // --- Post For Me's answers become statuses
  const row = L.buildCreate(base, NOW).row;
  eq(L.applyCreateResponse(row, { id: 'sp_1', status: 'processing' }, NOWISO).status, 'processing', 'created, in flight');
  eq(L.applyCreateResponse({ ...row, status: 'scheduled' }, { id: 'sp_1' }, NOWISO).status, 'scheduled', 'a scheduled post stays scheduled');
  eq(L.applyCreateResponse(row, { id: 'sp_1', status: 'processed' }, NOWISO).status, 'posted', 'processed is posted');
  const failed = L.applyCreateResponse(row, { message: 'bad media' }, NOWISO);
  eq([failed.status, failed.error], ['failed', 'bad media'], 'no post id is a failure with the reason');
  ok(L.applyCreateResponse(row, { error: 'x'.repeat(500) }, NOWISO).error.length <= 280, 'errors are cut to fit');

  const inflight = { ...row, post_id: 'sp_1', status: 'processing' };
  eq(L.applyResults(inflight, { data: [] }, NOWISO), inflight, 'no result yet means no change');
  const good = L.applyResults(inflight, { data: [{ post_id: 'sp_1', success: true, platform_data: { url: 'https://www.instagram.com/reel/ABC/' } }] }, NOWISO);
  eq([good.status, good.instagram_url, good.posted_at], ['posted', 'https://www.instagram.com/reel/ABC/', NOWISO], 'a success is posted with its link');
  const bad = L.applyResults(inflight, [{ post_id: 'sp_1', success: false, error: 'Failed to post to Instagram', details: { error: { message: 'Media too short' } } }], NOWISO);
  eq([bad.status, bad.error], ['failed', 'Failed to post to Instagram: Media too short'], 'a rejection shows the specific reason');
  eq(L.applyResults(inflight, { data: [{ post_id: 'other', success: true }] }, NOWISO), inflight, "another post's result is ignored");
  ok(L.needsRefresh(inflight) && !L.needsRefresh(good) && !L.needsRefresh({ ...row, status: 'uploading' }), 'only unfinished posts with an id are refreshed');

  // --- the browser never sees account ids
  const pub = L.publicRow({ ...good, account_id: 'spc_secretish' });
  ok(!('account_id' in pub) && !('post_id' in pub), 'the public row carries no account id or post id');

  // --- static wiring
  ok(/authorizeStaffKey\(/.test(HANDLER), 'a staff role key is required');
  ok(/Deno\.env\.get\("POST_FOR_ME_API_KEY"\)/.test(HANDLER), 'the Post For Me key comes from the environment');
  ok(!/pfm_[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9]{20,}/.test(HANDLER + read('supabase/functions/instagram-upload/logic.mjs')), 'no key is written in the source');
  ok(/clientAllowed\(row\.client, Deno\.env\.get\("INSTAGRAM_UPLOAD_ALLOWED_CLIENTS"\)\)/.test(HANDLER), 'the client allowlist is enforced before anything is sent');
  ok(/expected !== row\.account_id/.test(HANDLER) && HANDLER.indexOf('expectedAccountId(') < HANDLER.indexOf('"/social-posts", postBody'), 'the account must match the one on file before the post is created');
  ok(/external_id=/.test(HANDLER), 'an earlier attempt with the same key is looked up before a second post is created');
  ok(HANDLER.indexOf('clientAllowed(') < HANDLER.indexOf('"/social-posts"'), 'the allowlist check comes before the post is created');
  ok(HANDLER.indexOf('platformMismatch(') < HANDLER.indexOf('"/social-posts"'), 'the platform check comes before the post is created');
  ok(!/n8n/i.test(HANDLER.replace(/^\/\/.*$/gm, '')), 'the handler does not call n8n');
  ok(/revoke all on table public\.instagram_uploads from public, anon, authenticated, service_role/.test(MIGRATION), 'the migration revokes all four roles');
  ok(/grant select, insert, update on table public\.instagram_uploads to service_role/.test(MIGRATION), 'and gives service_role only what it needs');
  ok(/enable row level security/.test(MIGRATION), 'row level security is on');
  ok(/^-- NOT APPLIED/m.test(MIGRATION), 'the migration says it is not applied yet');
  ok(DEPLOY.includes('instagram-upload'), 'the single-function deploy lane names the function');
  console.log(`instagram-upload-source: ${checks} checks passed ✅`);
})().catch((e) => { console.error(e); process.exit(1); });

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

  // --- the client is found by slug or display name (OPEN_REPAIRS 398): a slug is not always the squashed name
  const profiles = [
    { slug: 'janedoe', display_name: 'Dr. Jane Doe', extra: { postforme_instagram_account_id: 'spc_a' } },
    { slug: 'alpha&beta', display_name: 'Alpha and Beta', extra: { postforme_instagram_account_id: 'spc_b' } },
    { slug: 'fixtureclienta', display_name: 'Fixture Client A', extra: { postforme_instagram_account_id: 'spc_c' } },
  ];
  eq(L.expectedAccountId(L.findClientProfile(profiles, 'Dr. Jane Doe')), 'spc_a', 'a "Dr." display name finds its client (its slug drops the title)');
  eq(L.expectedAccountId(L.findClientProfile(profiles, 'Alpha and Beta')), 'spc_b', 'an "and" display name finds the "&" slug');
  eq(L.expectedAccountId(L.findClientProfile(profiles, 'Fixture Client A')), 'spc_c', 'an ordinary name still finds its client');
  eq(L.findClientProfile(profiles, 'Nobody Here'), null, 'an unknown name finds nobody');
  eq(L.findClientProfile([{ slug: 'x1', display_name: 'Twin' }, { slug: 'x2', display_name: 'Twin' }], 'Twin'), null, 'a name two clients share finds nobody (fail closed)');
  ok(!/\.eq\("slug", clientKey\(/.test(HANDLER), 'the handler no longer looks the client up by the squashed name alone');

  // --- Cancel asks Post For Me first and proves the post is gone (OPEN_REPAIRS 398; the TikTok rule of 361)
  {
    const fake = (script) => { const calls = []; const fn = async (method, p) => { calls.push(method + ' ' + p); const k = method + ' ' + p.split('?')[0]; const q = script[k]; const r = Array.isArray(q) ? q.shift() : q; return r || { ok: false, status: 0, data: {} }; }; fn.calls = calls; return fn; };
    const P = '/social-posts/pfm_1', R = '/social-post-results';
    let f = fake({ ['GET ' + P]: [{ ok: true, status: 200, data: { status: 'scheduled' } }, { ok: false, status: 404, data: {} }], ['DELETE ' + P]: { ok: true, status: 200, data: {} }, ['GET ' + R]: { ok: true, status: 200, data: { data: [] } } });
    eq(await L.cancelInPostForMe(f, 'pfm_1'), 'cancelled', 'a scheduled post is deleted, read back as gone, and no result says it went out: cancelled');
    f = fake({ ['GET ' + P]: { ok: true, status: 200, data: { status: 'processing' } } });
    eq(await L.cancelInPostForMe(f, 'pfm_1'), 'already_posted', 'a post Post For Me is publishing is not cancelled');
    ok(!f.calls.some(c => c.startsWith('DELETE')), 'and nothing is deleted');
    f = fake({ ['GET ' + P]: { ok: false, status: 404, data: {} }, ['GET ' + R]: { ok: true, status: 200, data: { data: [{ post_id: 'pfm_1', success: true }] } } });
    eq(await L.cancelInPostForMe(f, 'pfm_1'), 'already_posted', 'gone from Post For Me but a result says it went out: already posted (it used to say Cancelled)');
    f = fake({ ['GET ' + P]: [{ ok: true, status: 200, data: { status: 'scheduled' } }, { ok: true, status: 200, data: { status: 'scheduled' } }], ['DELETE ' + P]: { ok: true, status: 200, data: {} } });
    eq(await L.cancelInPostForMe(f, 'pfm_1'), 'cancel_failed', 'a delete that answers ok while the post is still there is not a cancel');
    f = fake({ ['GET ' + P]: [{ ok: true, status: 200, data: { status: 'scheduled' } }, { ok: true, status: 200, data: { status: 'processed' } }], ['DELETE ' + P]: { ok: false, status: 409, data: {} } });
    eq(await L.cancelInPostForMe(f, 'pfm_1'), 'already_posted', 'a refused delete because it just went out says so');
    f = fake({});
    eq(await L.cancelInPostForMe(f, 'pfm_1'), 'cancel_failed', 'Post For Me unreachable: the row stays as it was');
    ok(/cancelInPostForMe\(/.test(HANDLER) && !/pfm\(pfmKey, "DELETE"/.test(HANDLER), 'the handler cancels only through the checked path');
  }

  // --- the account must be the one on file for that client
  eq(L.expectedAccountId({ extra: { postforme_instagram_account_id: ' spc_fixtureInstagram01 ' } }), 'spc_fixtureInstagram01', 'the id on file is read from the client profile (client_profiles.extra)');
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
  r = L.buildCreate({ ...base, scheduledAtUTC: '2026-10-01T15:00:00Z', timezone: 'America/New_York', options: { cover_timestamp_ms: 2500 } }, NOW);
  eq(r.postBody.scheduled_at, '2026-10-01T15:00:00.000Z', 'the UTC instant is sent');
  eq(r.postBody.media[0].thumbnail_timestamp_ms, 2500, 'the cover frame is sent');
  eq(r.row.status, 'scheduled', 'a scheduled row is scheduled');
  eq(L.buildCreate({ ...base, options: { placement: 'stories' } }, NOW).postBody.account_configurations[0].configuration.placement, 'reels', 'every post is a Reel, whatever placement is asked for');
  eq(L.buildCreate({ ...base, options: '{"placement":"timeline"}' }, NOW).postBody.account_configurations[0].configuration.placement, 'reels', 'a feed-video request is turned into a Reel too');
  ok(/^ig_/.test(L.buildCreate({ ...base, idempotencyKey: '' }, NOW).row.id), 'a missing key gets a generated one');

  // --- cover: an image or a frame, never both, from Post For Me storage only
  r = L.buildCreate({ ...base, coverUrl: 'https://data.postforme.dev/cover.jpg' }, NOW);
  eq(r.postBody.media, [{ url: 'https://data.postforme.dev/x.mp4', thumbnail_url: 'https://data.postforme.dev/cover.jpg' }], 'a cover image goes on the media item as thumbnail_url');
  eq(r.row.options.cover, 'image', 'the row records an image cover');
  r = L.buildCreate({ ...base, options: { cover_timestamp_ms: 2500 } }, NOW);
  eq(r.postBody.media, [{ url: 'https://data.postforme.dev/x.mp4', thumbnail_timestamp_ms: 2500 }], 'a chosen frame goes on the media item as thumbnail_timestamp_ms');
  eq(r.row.options.cover, 'frame', 'the row records a frame cover');
  r = L.buildCreate({ ...base, coverUrl: 'https://data.postforme.dev/cover.png', options: { cover_timestamp_ms: 2500 } }, NOW);
  eq(r.postBody.media[0].thumbnail_timestamp_ms, undefined, 'with both, only the image is sent (Post For Me does not say which wins)');
  eq(r.postBody.media[0].thumbnail_url, 'https://data.postforme.dev/cover.png', 'the image is the one that stays');
  ok(!L.buildCreate({ ...base, coverUrl: 'https://evil.example/c.jpg' }, NOW).ok, 'a cover must come from Post For Me storage');
  ok(!L.buildCreate({ ...base, coverUrl: 'http://data.postforme.dev/c.jpg' }, NOW).ok, 'and over https');
  eq(L.buildCreate(base, NOW).postBody.media, [{ url: 'https://data.postforme.dev/x.mp4' }], 'no cover chosen sends no thumbnail field at all');
  eq(L.publicRow({ id: 'a', options: { cover: 'image' } }).cover, 'image', 'the queue row says which cover kind it used');

  // --- trial reels: manual only
  r = L.buildCreate(base, NOW);
  ok(!('trial_reel_type' in r.postBody.account_configurations[0].configuration), 'off: no trial field is sent');
  eq(r.row.options.trial_reel_type, null, 'off: the row says it is not a trial');
  eq(L.publicRow(r.row).trial, false, 'off: the queue row is not marked Trial');
  r = L.buildCreate({ ...base, options: { trial_reel_type: 'manual' } }, NOW);
  ok(r.ok, 'a manual trial reel builds');
  eq(r.postBody.account_configurations[0].configuration, { placement: 'reels', trial_reel_type: 'manual' }, 'on: a Reel with trial_reel_type manual');
  eq(r.row.options.trial_reel_type, 'manual', 'on: stored in the row options');
  eq(L.publicRow(r.row).trial, true, 'on: the queue row is marked Trial');
  eq(L.buildCreate({ ...base, options: '{"trial_reel_type":"MANUAL"}' }, NOW).postBody.account_configurations[0].configuration.trial_reel_type, 'manual', 'case and string options are accepted');
  ok(!L.buildCreate({ ...base, options: { trial_reel_type: 'performance' } }, NOW).ok, 'performance (Instagram shares it by itself) is refused');
  ok(!L.buildCreate({ ...base, options: { trial_reel_type: 'SS_PERFORMANCE' } }, NOW).ok, "Meta's own performance name is refused too");
  ok(!L.buildCreate({ ...base, options: { trial_reel_type: 'yes' } }, NOW).ok, 'any other value is refused');

  // --- carousels: 2 to 10 items from Post For Me storage, one feed post (placement timeline), never a trial
  {
    const urls = (n) => Array.from({ length: n }, (_, i) => 'https://data.postforme.dev/c' + i + (i % 3 === 2 ? '.mp4' : '.jpg'));
    const car = { clientName: base.clientName, socialAccountId: base.socialAccountId, title: 'Swipe', idempotencyKey: 'car1', kind: 'carousel' };
    for (const n of [2, 5, 10]) {
      const c = L.buildCreate({ ...car, mediaUrls: urls(n) }, NOW, 'QA Admin');
      ok(c.ok, n + ' items build a carousel');
      eq(c.postBody.media, urls(n).map((url) => ({ url })), n + ' items: every item is sent, in order, images and videos mixed');
      eq(c.postBody.account_configurations, [{ social_account_id: 'spc_fixtureInstagram01', configuration: { placement: 'timeline' } }], n + ' items: placement timeline (feed), to exactly one account');
      eq(c.row.options, { kind: 'carousel', placement: 'timeline', items: n, cover: null, cover_timestamp_ms: null, trial_reel_type: null }, n + ' items: the kind and count are kept in the row options');
      eq([L.publicRow(c.row).kind, L.publicRow(c.row).items, L.publicRow(c.row).trial], ['carousel', n, false], n + ' items: the queue row says Carousel (' + n + ')');
    }
    ok(!L.buildCreate({ ...car, mediaUrls: urls(1) }, NOW).ok, 'one item is not a carousel');
    ok(!L.buildCreate({ ...car, mediaUrls: urls(11) }, NOW).ok, 'eleven items are refused (Instagram allows 10)');
    ok(!L.buildCreate({ ...car, mediaUrls: [] }, NOW).ok, 'no items are refused');
    ok(!L.buildCreate({ ...car }, NOW).ok, 'a carousel without mediaUrls is refused');
    ok(!L.buildCreate({ ...car, mediaUrls: 'https://data.postforme.dev/a.jpg' }, NOW).ok, 'mediaUrls must be a list');
    ok(!L.buildCreate({ ...car, mediaUrls: [urls(2)[0], 'https://evil.example/b.jpg'] }, NOW).ok, 'a foreign item url is refused');
    ok(!L.buildCreate({ ...car, mediaUrls: [urls(2)[0], 'http://data.postforme.dev/b.jpg'] }, NOW).ok, 'an item over http is refused');
    ok(!L.buildCreate({ ...car, mediaUrls: [urls(2)[0], urls(2)[0]] }, NOW).ok, 'the same item twice is refused');
    ok(!L.buildCreate({ ...car, mediaUrls: urls(2), options: { trial_reel_type: 'manual' } }, NOW).ok, 'a trial is refused on a carousel');
    ok(!L.buildCreate({ ...car, mediaUrls: urls(2), options: '{"trial_reel_type":"manual"}' }, NOW).ok, 'also when options come as a string');
    ok(!L.buildCreate({ ...car, mediaUrls: urls(2), coverUrl: 'https://data.postforme.dev/cover.jpg' }, NOW).ok, 'a cover image is refused on a carousel');
    ok(!L.buildCreate({ ...car, mediaUrls: urls(2), options: { cover_timestamp_ms: 2000 } }, NOW).ok, 'a cover frame is refused on a carousel');
    ok(!L.buildCreate({ ...car, mediaUrls: urls(2), mediaUrl: base.mediaUrl }, NOW).ok, 'a carousel with a Reel video too is refused');
    ok(!L.buildCreate({ ...car, mediaUrls: urls(2), socialAccountId: 'acct_1' }, NOW).ok, 'a carousel needs an spc_ account id');
    ok(!L.buildCreate({ ...car, mediaUrls: urls(2), title: ' ' }, NOW).ok, 'a carousel needs a caption');
    ok(!L.buildCreate({ ...car, mediaUrls: urls(2), clientName: '' }, NOW).ok, 'a carousel needs a client');
    ok(!L.buildCreate({ ...car, mediaUrls: urls(2), scheduledAtUTC: '2026-09-30T11:00:00.000Z' }, NOW).ok, 'a carousel in the past is refused');
    const sc = L.buildCreate({ ...car, mediaUrls: urls(3), scheduledAtUTC: '2026-10-01T15:00:00Z' }, NOW);
    eq([sc.postBody.scheduled_at, sc.row.status], ['2026-10-01T15:00:00.000Z', 'scheduled'], 'a carousel can be scheduled');
    ok(!L.buildCreate({ ...car, kind: 'story', mediaUrls: urls(2) }, NOW).ok, 'an unknown kind is refused');
    // A Reel is unchanged: no kind (or kind reel) builds exactly what it did before carousels.
    const before = L.buildCreate(base, NOW, 'QA Admin');
    const asReel = L.buildCreate({ ...base, kind: 'reel' }, NOW, 'QA Admin');
    eq(asReel.postBody, before.postBody, 'kind reel sends the same Post For Me body as before');
    eq({ ...asReel.row, created_at: 0, updated_at: 0 }, { ...before.row, created_at: 0, updated_at: 0 }, 'and stores the same row');
    ok(!('kind' in before.row.options), 'a Reel row keeps its old options shape');
    eq([L.publicRow(before.row).kind, L.publicRow(before.row).items], ['reel', 1], 'a Reel row (and every row from before) reads as a Reel');
    ok(!L.buildCreate({ ...base, mediaUrls: urls(2) }, NOW).ok, 'a Reel with a list of items is refused, never half-sent');
    eq(L.buildCreate({ ...base, options: { trial_reel_type: 'manual' } }, NOW).postBody.account_configurations[0].configuration, { placement: 'reels', trial_reel_type: 'manual' }, 'a trial Reel still works');
  }

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
  ok(/^-- APPLIED 2026-09-30 by Lighthouse/m.test(MIGRATION) && !/NOT APPLIED/.test(MIGRATION), 'the migration header says it is applied (2026-09-30, Lighthouse)');
  ok(/last_checked_at\s+timestamptz/.test(MIGRATION), 'the applied table shape includes last_checked_at');
  ok(DEPLOY.includes('instagram-upload'), 'the single-function deploy lane names the function');
  console.log(`instagram-upload-source: ${checks} checks passed ✅`);
})().catch((e) => { console.error(e); process.exit(1); });

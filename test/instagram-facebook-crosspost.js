'use strict';
// Instagram posts also to the client's Facebook Page (OPEN_REPAIRS 618): the pure logic of the
// instagram-upload function (the one Post For Me post with both accounts, trials and video carousels kept
// Instagram only, each network's result kept apart), the profile field's rules (client-profile-edit.mjs),
// and static wiring checks on both handlers and the Kasper Clients tab. No network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const IG_HANDLER = read('supabase/functions/instagram-upload/index.ts');
const CPW_HANDLER = read('supabase/functions/client-profile-write/index.ts');
const CLIENTS_TAB = read('src/index/323-kasper-dashboard-tail.js.part');
const COMPOSER = read('src/index/299-instagram-upload.js.part');
const MIGRATION = read('migrations/2026-10-31-client-facebook-page.sql');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

(async () => {
  const L = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/instagram-upload/logic.mjs')).href);
  const E = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/client-profile-edit.mjs')).href);
  const NOW = Date.parse('2026-10-31T12:00:00.000Z');
  const NOWISO = new Date(NOW).toISOString();
  const IG = 'spc_fixtureInstagram01';
  const FB = 'spc_fixtureFacebook01';
  const reel = { clientName: 'Fixture Client A', socialAccountId: IG, title: 'Hello', mediaUrl: 'https://data.postforme.dev/x.mp4', idempotencyKey: 'key1' };
  const urls = ['https://data.postforme.dev/a.jpg', 'https://data.postforme.dev/b.jpg', 'https://data.postforme.dev/c.jpg'];
  const carousel = { clientName: 'Fixture Client A', socialAccountId: IG, title: 'Hi', kind: 'carousel', mediaUrls: urls, idempotencyKey: 'key2' };

  // --- 1. nothing changes without the box: the exact body sent before cross-posting existed
  const plain = L.buildCreate(reel, NOW, 'smm');
  eq(plain.postBody.social_accounts, [IG], 'Instagram only: one account');
  eq(plain.postBody.account_configurations, [{ social_account_id: IG, configuration: { placement: 'reels' } }], 'Instagram only: one configuration');
  ok(!('facebook' in plain.row.options), 'Instagram only: the row has no Facebook part');
  eq(L.publicRow(plain.row).facebook, null, 'Instagram only: the page sees facebook null');
  eq(L.buildCreate({ ...reel, alsoFacebook: false, facebookAccountId: FB }, NOW, 'smm').postBody.social_accounts, [IG], 'alsoFacebook false sends nothing to Facebook');

  // --- 2. a Reel to both: ONE post, both accounts, a configuration each, Facebook as a Facebook Reel
  const both = L.buildCreate({ ...reel, alsoFacebook: true, facebookAccountId: FB, scheduledAtUTC: '2026-11-01T15:00:00Z', options: { cover_timestamp_ms: 1500 } }, NOW, 'smm');
  ok(both.ok, 'a Reel to both is accepted');
  eq(both.postBody.social_accounts, [IG, FB], 'one post, both accounts, Instagram first');
  eq(both.postBody.account_configurations, [
    { social_account_id: IG, configuration: { placement: 'reels' } },
    { social_account_id: FB, configuration: { placement: 'reels' } },
  ], 'Instagram as a Reel, Facebook as a Facebook Reel (placement reels, per Post For Me)');
  eq(both.postBody.media, [{ url: reel.mediaUrl, thumbnail_timestamp_ms: 1500 }], 'one media list, shared');
  eq(both.postBody.scheduled_at, '2026-11-01T15:00:00.000Z', 'one schedule for both');
  eq(both.postBody.external_id, 'key1', 'one retry-safe key for both: a second press cannot post twice on either');
  eq(both.row.options.facebook, { account_id: FB, placement: 'reels', status: 'scheduled', url: '', error: '', posted_at: null }, 'the row keeps a Facebook part of its own');
  eq(L.buildCreate({ ...reel, alsoFacebook: 'true', facebookAccountId: FB }, NOW, 'smm').postBody.social_accounts, [IG, FB], 'the string "true" counts');

  // --- 3. refusals: a trial is Instagram only; bad or same ids
  eq(L.buildCreate({ ...reel, alsoFacebook: true, facebookAccountId: FB, options: { trial_reel_type: 'manual' } }, NOW, 'smm').error,
    'a trial reel is for Instagram only, not Facebook', 'a trial reel never goes to Facebook');
  ok(L.buildCreate({ ...reel, options: { trial_reel_type: 'manual' } }, NOW, 'smm').ok, 'a trial alone still works');
  eq(L.buildCreate({ ...reel, alsoFacebook: true }, NOW, 'smm').error, 'facebookAccountId must be a Post For Me connection id (spc_...)', 'no Facebook id is refused');
  eq(L.buildCreate({ ...reel, alsoFacebook: true, facebookAccountId: 'https://facebook.com/x' }, NOW, 'smm').error, 'facebookAccountId must be a Post For Me connection id (spc_...)', 'a non spc_ id is refused');
  eq(L.buildCreate({ ...reel, alsoFacebook: true, facebookAccountId: IG }, NOW, 'smm').error, 'the Facebook account cannot be the Instagram account', 'the Instagram id is refused as the Facebook one');

  // --- 4. carousels: photos go to Facebook as one multi-photo post; a video keeps it Instagram only
  const car = L.buildCreate({ ...carousel, alsoFacebook: true, facebookAccountId: FB, itemTypes: ['image', 'image', 'image'] }, NOW, 'smm');
  ok(car.ok, 'an all-photo carousel to both is accepted');
  eq(car.postBody.social_accounts, [IG, FB], 'carousel: both accounts');
  eq(car.postBody.account_configurations[1], { social_account_id: FB, configuration: { placement: 'timeline', set_caption_for_each_image: false } },
    'Facebook: one feed post of the photos, caption on the post only');
  eq(car.postBody.account_configurations[0], { social_account_id: IG, configuration: { placement: 'timeline' } }, 'Instagram unchanged');
  eq(car.postBody.media, urls.map((url) => ({ url })), 'the same items in the same order');
  eq(car.row.options.facebook.placement, 'timeline', 'the row says it went to the Facebook feed');
  eq(L.buildCreate({ ...carousel, alsoFacebook: true, facebookAccountId: FB, itemTypes: ['image', 'video', 'image'] }, NOW, 'smm').error,
    'Facebook takes a carousel of images only; this one has a video', 'a carousel with a video is refused for Facebook');
  eq(L.buildCreate({ ...carousel, alsoFacebook: true, facebookAccountId: FB }, NOW, 'smm').error, 'a Facebook carousel needs itemTypes, one per item', 'item types are required');
  eq(L.buildCreate({ ...carousel, alsoFacebook: true, facebookAccountId: FB, itemTypes: ['image'] }, NOW, 'smm').error, 'a Facebook carousel needs itemTypes, one per item', 'one type per item');
  ok(L.buildCreate({ ...carousel, itemTypes: ['image', 'video', 'image'] }, NOW, 'smm').ok, 'a mixed carousel to Instagram only still works');

  // --- 5. Post For Me's create answer moves both networks; a refusal fails both (one post)
  const sched = L.applyCreateResponse(both.row, { id: 'sp_1', status: 'scheduled' }, NOWISO);
  eq([sched.status, sched.options.facebook.status], ['scheduled', 'scheduled'], 'scheduled on both');
  const now = L.buildCreate({ ...reel, alsoFacebook: true, facebookAccountId: FB }, NOW, 'smm').row;
  const processed = L.applyCreateResponse(now, { id: 'sp_2', status: 'processed' }, NOWISO);
  eq([processed.status, processed.options.facebook.status], ['posted', 'processing'], 'a processed post waits for Facebook\'s own result');
  const refusedCreate = L.applyCreateResponse(now, { message: 'bad media' }, NOWISO);
  eq([refusedCreate.status, refusedCreate.options.facebook.status, refusedCreate.options.facebook.error], ['failed', 'failed', 'bad media'], 'a refused create fails both, with the reason');

  // --- 6. results are read per account: one network's failure never hides the other's success
  const live = { ...L.applyCreateResponse(now, { id: 'sp_3', status: 'processing' }, NOWISO), account_id: IG };
  const igOk = { post_id: 'sp_3', social_account_id: IG, success: true, platform_data: { url: 'https://www.instagram.com/reel/x/' } };
  const fbBad = { post_id: 'sp_3', social_account_id: FB, success: false, error: 'Page token expired' };
  const fbOk = { post_id: 'sp_3', social_account_id: FB, success: true, platform_data: { url: 'https://www.facebook.com/reel/1' } };
  const igBad = { post_id: 'sp_3', social_account_id: IG, success: false, error: { message: 'Media type not supported' } };

  let r = L.applyResults(live, { data: [igOk, fbBad] }, NOWISO);
  eq([r.status, r.instagram_url, r.error], ['posted', 'https://www.instagram.com/reel/x/', ''], 'Instagram posted, with its link');
  eq([r.options.facebook.status, r.options.facebook.error, r.options.facebook.url], ['failed', 'Page token expired', ''], 'Facebook failed, with its reason, apart');
  eq(L.overallStatus(r), 'failed', 'the queue shows the row under Failed so the Facebook failure is seen');
  eq(L.publicRow(r).status, 'posted', 'and Instagram still reads Posted');
  r = L.applyResults(live, { data: [igBad, fbOk] }, NOWISO);
  eq([r.status, r.error], ['failed', 'Media type not supported'], 'Instagram failed with its reason');
  eq([r.options.facebook.status, r.options.facebook.url], ['posted', 'https://www.facebook.com/reel/1'], 'Facebook posted, with its link');
  r = L.applyResults(live, [igOk], NOWISO);
  eq([r.status, r.options.facebook.status], ['posted', 'processing'], 'only Instagram answered: Facebook keeps waiting');
  ok(L.needsRefresh(r), 'a row whose Facebook part is still going is asked about again');
  eq(L.overallStatus(r), 'processing', 'and stays under Upcoming');
  const done = L.applyResults(r, [igOk, fbOk], NOWISO);
  eq([done.status, done.options.facebook.status, done.options.facebook.posted_at], ['posted', 'posted', NOWISO], 'both posted');
  ok(!L.needsRefresh(done), 'nothing left to ask once both are final');
  eq(L.overallStatus(done), 'posted', 'under Done');
  r = L.applyResults(live, [{ post_id: 'sp_3', success: false, error: 'mystery' }], NOWISO);
  eq([r.status, r.options.facebook.status], ['processing', 'processing'], 'a result without an account id is not guessed onto either network of a cross-post');
  const legacy = { ...L.buildCreate(reel, NOW, 'smm').row, post_id: 'sp_4', status: 'processing' };
  eq(L.applyResults(legacy, [{ post_id: 'sp_4', success: true, platform_data: { url: 'u' } }], NOWISO).status, 'posted', 'an Instagram-only row still reads a result without an account id');
  eq(L.applyResults({ ...legacy, account_id: IG }, [{ post_id: 'sp_4', social_account_id: IG, success: true, platform_data: { url: 'u' } }], NOWISO).instagram_url, 'u', 'and one with its account id');

  // --- 7. cancel is both (one post); the page never sees an account id
  const cancelled = L.markCancelled(sched, NOWISO);
  eq([cancelled.status, cancelled.options.facebook.status], ['cancelled', 'cancelled'], 'cancel cancels both');
  ok(!L.needsRefresh({ ...cancelled, post_id: 'sp_1' }), 'a cancelled post is not asked about');
  const pub = L.publicRow(done);
  eq(pub.facebook, { status: 'posted', url: 'https://www.facebook.com/reel/1', error: '', posted_at: NOWISO, placement: 'reels' }, 'the page sees Facebook\'s own status, link and error');
  ok(!JSON.stringify(pub).includes(FB) && !JSON.stringify(pub).includes(IG), 'no account id reaches the page');

  // --- 8. the profile: the Facebook Page sits in extra, spc_ only, checked as a Facebook account
  eq(L.expectedFacebookAccountId({ extra: { postforme_facebook_account_id: ' ' + FB + ' ' } }), FB, 'read from extra, trimmed');
  eq(L.expectedFacebookAccountId({ extra: {} }), '', 'none on file');
  eq(L.platformMismatch({ platform: 'facebook' }, 'facebook'), '', 'a Facebook account passes the Facebook check');
  eq(L.platformMismatch({ platform: 'instagram' }, 'facebook'), 'That Post For Me account is on instagram, not Facebook.', 'an Instagram account fails it');
  eq(L.platformMismatch({ platform: 'facebook' }), 'That Post For Me account is on facebook, not Instagram.', 'the Instagram check is unchanged');
  eq(E.normalizeChanges({ postforme_facebook_account_id: ' ' + FB }).changes, { postforme_facebook_account_id: FB }, 'the field is editable');
  eq(E.normalizeChanges({ postforme_facebook_account_id: '' }).changes, { postforme_facebook_account_id: '' }, 'blank clears it');
  eq(E.normalizeChanges({ postforme_facebook_account_id: 'facebook.com/page' }), { ok: false, error: 'bad_value', field: 'postforme_facebook_account_id' }, 'only spc_ ids');
  eq(E.normalizeChanges({ postforme_instagram_account_id: IG }).changes, { postforme_instagram_account_id: IG }, 'the Instagram id beside it is editable too');
  eq(E.normalizeChanges({ postforme_instagram_account_id: 'not-an-id' }), { ok: false, error: 'bad_value', field: 'postforme_instagram_account_id' }, 'with the same spc_ rule');
  eq(E.EXTRA_ACCOUNT_PLATFORM, { postforme_instagram_account_id: 'instagram', postforme_facebook_account_id: 'facebook' }, 'each is checked against its own network');
  eq(E.splitChanges({ email: 'a@example.test', postforme_facebook_account_id: FB }), { columns: { email: 'a@example.test' }, extra: { postforme_facebook_account_id: FB } }, 'columns and extra split');
  ok(!E.EDITABLE_FIELDS.includes('postforme_facebook_account_id') && !E.EDITABLE_FIELDS.includes('postforme_instagram_account_id'), 'neither is planned as a Sheet-main cell edit');
  eq(E.accountPlatformProblem({ platform: 'facebook' }, 'facebook'), '', 'platform check passes');
  eq(E.accountPlatformProblem({ platform: 'instagram' }, 'facebook'), 'postforme_wrong_platform', 'the Instagram connection is refused as a Page');
  eq(E.accountPlatformProblem({}, 'facebook'), 'postforme_platform_unknown', 'an answer without a platform is refused');

  // --- 9. wiring
  ok(/expectedFacebookAccountId\(findClientProfile\(profiles/.test(IG_HANDLER) && /platformMismatch\(fbAcct\.data, "facebook"\)/.test(IG_HANDLER),
    'instagram-upload: the Page must be the one on file AND Post For Me must call it Facebook');
  ok(IG_HANDLER.indexOf('platformMismatch(fbAcct.data') < IG_HANDLER.indexOf('.insert(row)'), 'both checks run before anything is written');
  ok(IG_HANDLER.indexOf('clientAllowed(row.client') < IG_HANDLER.indexOf('expectedFacebookAccountId('), 'INSTAGRAM_UPLOAD_ALLOWED_CLIENTS still governs first');
  ok(/if \(facebookPart\(row\)\) patch\.options = next\.options/.test(IG_HANDLER), 'the status poll saves Facebook\'s result');
  ok(/markCancelled\(row/.test(IG_HANDLER), 'cancel marks both');
  ok(/checkExtraAccounts\(split\.extra\)/.test(CPW_HANDLER) && CPW_HANDLER.indexOf('checkExtraAccounts(split.extra)') < CPW_HANDLER.indexOf('rpc("client_profile_admin_edit"'),
    'client-profile-write asks Post For Me before it saves');
  ok(/extraKeys\.length\) return json\(\{ ok: false, error: "authority_not_syncview"/.test(CPW_HANDLER), 'never written to the Sheet path');
  ok(!/client_profile_edits"\)\.insert/.test(CPW_HANDLER), 'history is still written only by the SQL function');
  ok(/\['postforme_instagram_account_id', 'Instagram \(Post for Me\)'\], \['postforme_facebook_account_id', 'Facebook Page \(Post for Me\)'\]/.test(CLIENTS_TAB),
    'Clients tab: the Page sits next to the Instagram account in Publishing');
  ok(/^-- ef-auto-deploy: functions-cope-without-this$/m.test(MIGRATION.split('\n')[0]), 'the migration does not hold the deploy');
  ok(/Trial reels are an Instagram feature/.test(COMPOSER) && /Facebook takes a carousel of photos only/.test(COMPOSER) && /No Facebook Page connected for this client/.test(COMPOSER),
    'the composer says why when it cannot go to Facebook');

  console.log(`instagram-facebook-crosspost: ${checks} checks passed ✅`);
})().catch((e) => { console.error(e); process.exit(1); });

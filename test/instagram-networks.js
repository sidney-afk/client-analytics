'use strict';
// YouTube and LinkedIn through instagram-upload (plan row P3, server half, decision D5, OPEN_REPAIRS 652): the pure
// logic (logic.mjs) and static wiring checks on the handler. No network.
//   1. one Post for Me post carries every ticked network; YouTube gets title, public and made for kids; LinkedIn
//      nothing extra; Instagram may be unticked, and then the row's own fields describe the first ticked network;
//   2. a Short is refused when the file is known to be over 3 minutes or not vertical, and the same file is accepted
//      as a regular video; an unknown length or shape is left to YouTube;
//   3. the caption and title limits, trials and carousels stay Instagram's, one account per network;
//   4. made for kids comes from the client's profile only;
//   5. every non-Instagram account is checked against the profile and Post for Me's platform before any write;
//   6. each network's result is kept apart; a cancel or a failed create covers every network.
// Every existing Instagram and Facebook suite runs unchanged beside this one.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const HANDLER = fs.readFileSync(path.join(ROOT, 'supabase/functions/instagram-upload/index.ts'), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

(async () => {
  const L = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/instagram-upload/logic.mjs')).href);
  const NOW = Date.parse('2026-11-03T12:00:00.000Z');
  const IG = 'spc_fixtureInstagram01', FB = 'spc_fixtureFacebook01', YT = 'spc_fixtureYouTube001', LI = 'spc_fixtureLinkedIn01';
  const base = { clientName: 'Fixture Client A', socialAccountId: IG, title: 'First line\nMore text', mediaUrl: 'https://data.postforme.dev/x.mp4', idempotencyKey: 'key1' };
  const build = (extra) => L.buildCreate(Object.assign({}, base, extra), NOW, 'smm');
  const yt = (o) => Object.assign({ accountId: YT, title: 'First line', format: 'short', durationSeconds: 42, width: 1080, height: 1920 }, o || {});

  // ---- 1. one post, every ticked network
  {
    const b = build({ youtube: yt(), linkedin: { accountId: LI } });
    ok(b.ok, 'Instagram + YouTube + LinkedIn builds');
    eq(b.postBody.social_accounts, [IG, YT, LI], 'one post, three accounts');
    const ytConf = b.postBody.account_configurations.find((c) => c.social_account_id === YT);
    eq(ytConf.configuration, { title: 'First line', privacy_status: 'public', made_for_kids: false }, 'YouTube: title, public, made for kids off until the profile says');
    ok(!b.postBody.account_configurations.some((c) => c.social_account_id === LI), 'LinkedIn takes nothing extra');
    eq(b.row.account_id, IG, 'the row\'s own account is Instagram');
    ok(!('network' in b.row.options), 'an Instagram row has no network field (rows written before P3 read the same)');
    eq(Object.keys(b.row.options.networks), ['youtube', 'linkedin'], 'YouTube and LinkedIn each have their own part');
    eq(b.row.options.networks.youtube, { account_id: YT, status: 'uploading', url: '', error: '', posted_at: null }, 'a fresh part');
    eq(b.row.options.youtube, { title: 'First line', format: 'short', privacy_status: 'public', made_for_kids: false }, 'YouTube settings kept on the row');
  }
  {
    const b = build({ socialAccountId: '', instagram: false, youtube: yt({ format: 'regular' }) });
    ok(b.ok, 'Instagram may be unticked');
    eq(b.postBody.social_accounts, [YT], 'only YouTube');
    eq([b.row.account_id, b.row.options.network, b.row.options.networks], [YT, 'youtube', undefined], 'the row\'s own fields describe YouTube');
    const fbFirst = build({ socialAccountId: '', instagram: false, alsoFacebook: true, facebookAccountId: FB, linkedin: { accountId: LI } });
    eq([fbFirst.row.account_id, fbFirst.row.options.network, fbFirst.row.options.facebook, Object.keys(fbFirst.row.options.networks)], [FB, 'facebook', undefined, ['linkedin']], 'Facebook first when Instagram is off');
    eq(build({ socialAccountId: '', instagram: false }).error, 'tick at least one network', 'nothing ticked is refused');
    ok(/not ticked/.test(build({ instagram: false, youtube: yt() }).error), 'an Instagram account sent with Instagram unticked is refused');
  }

  // ---- 2. Short or regular
  {
    const four = yt({ durationSeconds: 240 });
    eq(build({ youtube: four }).error, 'A Short is at most 3 minutes; this video is 4:00. Post it as a regular video.', 'a 4-minute vertical file is refused as a Short');
    ok(build({ youtube: Object.assign({}, four, { format: 'regular' }) }).ok, 'and accepted as a regular video');
    ok(/vertical video; this one is 1920×1080/.test(build({ youtube: yt({ width: 1920, height: 1080 }) }).error), 'a horizontal file is refused as a Short');
    ok(build({ youtube: yt({ durationSeconds: null, width: null, height: null }) }).ok, 'an unknown length and shape are left to YouTube');
    ok(build({ youtube: yt({ durationSeconds: 180 }) }).ok, 'exactly 3 minutes is a Short');
    ok(/short or regular/.test(build({ youtube: yt({ format: 'long' }) }).error), 'an unknown format is refused');
  }

  // ---- 3. limits and rules
  {
    ok(/needs a title/.test(build({ youtube: yt({ title: '  ' }) }).error), 'YouTube needs a title');
    ok(/over 100/.test(build({ youtube: yt({ title: 'x'.repeat(101) }) }).error), 'a title over 100 characters is refused');
    ok(build({ youtube: yt({ title: 'x'.repeat(100) }) }).ok, '100 characters is fine');
    ok(/< or >/.test(build({ youtube: yt({ title: 'a <b>' }) }).error), 'YouTube refuses < and > in a title');
    ok(/LinkedIn's 3000/.test(build({ title: 'x'.repeat(2100), linkedin: { accountId: LI }, socialAccountId: '', instagram: false }).error) === false, '2,100 characters is fine for LinkedIn');
    ok(/LinkedIn's 3000/.test(build({ title: 'x'.repeat(3001), instagram: false, socialAccountId: '', linkedin: { accountId: LI } }).error), 'over 3,000 characters is refused for LinkedIn');
    ok(/5,000 bytes/.test(build({ title: 'é'.repeat(2600), instagram: false, socialAccountId: '', youtube: yt() }).error), 'a caption over 5,000 bytes is refused for YouTube');
    ok(/Instagram only/.test(build({ options: { trial_reel_type: 'manual' }, youtube: yt() }).error), 'a trial cannot go to YouTube');
    ok(/Instagram only/.test(build({ options: { trial_reel_type: 'manual' }, linkedin: { accountId: LI } }).error), 'or LinkedIn');
    ok(/carousel goes to Instagram/.test(build({ kind: 'carousel', mediaUrl: '', mediaUrls: ['https://data.postforme.dev/a.jpg', 'https://data.postforme.dev/b.jpg'], youtube: yt() }).error), 'a carousel stays Instagram\'s');
    ok(/same as another/.test(build({ youtube: yt({ accountId: IG }) }).error), 'one account cannot stand for two networks');
    ok(/connection id/.test(build({ linkedin: { accountId: 'nope' } }).error), 'a LinkedIn id must be spc_');
  }

  // ---- 4. made for kids from the profile only
  {
    const b = build({ youtube: Object.assign(yt(), { made_for_kids: true }) });
    const off = L.applyProfileSettings(b.row, b.postBody, { extra: {} });
    eq(off.postBody.account_configurations.find((c) => c.social_account_id === YT).configuration.made_for_kids, false, 'the page cannot set made for kids: absent on the profile is off');
    const on = L.applyProfileSettings(b.row, b.postBody, { extra: { youtube_made_for_kids: true } });
    eq(on.postBody.account_configurations.find((c) => c.social_account_id === YT).configuration.made_for_kids, true, 'on when the profile says so');
    eq(on.row.options.youtube.made_for_kids, true, 'and recorded on the row');
    eq(L.applyProfileSettings(b.row, b.postBody, { extra: { youtube_made_for_kids: 'true' } }).row.options.youtube.made_for_kids, false, 'only the stored true counts');
    const plain = build({});
    eq(L.applyProfileSettings(plain.row, plain.postBody, { extra: { youtube_made_for_kids: true } }).postBody, plain.postBody, 'an Instagram-only post is untouched');
  }

  // ---- 5. accounts checked before any write
  {
    const b = build({ youtube: yt(), linkedin: { accountId: LI } });
    const profile = { extra: { postforme_instagram_account_id: IG, postforme_youtube_account_id: YT, postforme_linkedin_account_id: LI } };
    const asked = [];
    const pf = (platforms) => async (id) => { asked.push(id); return { ok: true, status: 200, data: { platform: platforms[id] } }; };
    eq(await L.checkNetworkAccounts(b.row, profile, pf({ [YT]: 'youtube', [LI]: 'linkedin' })), { ok: true }, 'both on file and on their networks');
    eq(asked, [YT, LI], 'Instagram is checked by its own long-standing code, not twice');
    const wrong = await L.checkNetworkAccounts(b.row, { extra: { ...profile.extra, postforme_youtube_account_id: 'spc_someoneElse001' } }, pf({}));
    eq([wrong.status, wrong.error], [403, 'That YouTube account is not the one on file for this client.'], 'another client\'s YouTube is refused');
    const none = await L.checkNetworkAccounts(b.row, { extra: { postforme_youtube_account_id: YT } }, pf({ [YT]: 'youtube' }));
    eq(none.status, 409, 'no LinkedIn on the profile: refused'); ok(/Untick LinkedIn/.test(none.error), 'with what to do');
    const plat = await L.checkNetworkAccounts(b.row, profile, pf({ [YT]: 'tiktok', [LI]: 'linkedin' }));
    eq([plat.status, plat.error], [400, 'That Post For Me account is on tiktok, not YouTube.'], 'a YouTube slot holding a TikTok account is refused');
    eq((await L.checkNetworkAccounts(b.row, profile, async () => ({ ok: false, status: 404, data: {} }))).status, 400, 'an id Post for Me does not know');
    eq((await L.checkNetworkAccounts(b.row, profile, async () => ({ ok: false, status: 0, data: {} }))).status, 502, 'Post for Me not answering');
    const fbFirst = build({ socialAccountId: '', instagram: false, alsoFacebook: true, facebookAccountId: FB });
    eq(L.checkedNetworks(fbFirst.row), [{ name: 'facebook', account_id: FB }], 'Facebook as the first network is checked here');
    ok(HANDLER.indexOf('checkNetworkAccounts(row, profile') > 0 && HANDLER.indexOf('checkNetworkAccounts(row, profile') < HANDLER.indexOf('.insert(row)')
      && HANDLER.indexOf('checkNetworkAccounts(row, profile') < HANDLER.indexOf('"/social-posts", postBody'), 'the handler checks them before it writes the row or creates the post');
    ok(HANDLER.indexOf('applyProfileSettings(row, postBody, profile)') > HANDLER.indexOf('checkNetworkAccounts(row, profile') && HANDLER.indexOf('applyProfileSettings(') < HANDLER.indexOf('.insert(row)'), 'made for kids is set from the profile before the row is written');
    ok(/if \(existing && existing\.post_id\) return json/.test(HANDLER) && HANDLER.indexOf('existing.post_id') < HANDLER.indexOf('checkNetworkAccounts('), 'the same key returns the same post');
    ok(/if \(networkParts\(row\)\.length\) patch\.options = next\.options/.test(HANDLER), 'the status poll saves YouTube\'s and LinkedIn\'s results');
  }

  // ---- 6. each network's result apart
  {
    const b = build({ youtube: yt(), linkedin: { accountId: LI }, scheduledAtUTC: '2026-11-20T12:00:00Z' });
    const created = L.applyCreateResponse(b.row, { id: 'sp_1', status: 'processed' }, '2026-11-03T12:00:01Z');
    eq([created.status, created.options.networks.youtube.status, created.options.networks.linkedin.status], ['scheduled', 'scheduled', 'scheduled'], 'an accepted post moves every network');
    const now = L.applyCreateResponse({ ...b.row, status: 'uploading', scheduled_for: null }, { id: 'sp_2', status: 'processed' }, 'x');
    eq(now.status, 'processing', '"processed" with other networks waits for each one\'s result');
    const failed = L.applyCreateResponse(b.row, { message: 'nope' }, 'x');
    eq([failed.options.networks.youtube.status, failed.options.networks.linkedin.error], ['failed', 'nope'], 'a refused create fails every network');
    const results = { data: [
      { post_id: 'sp_1', social_account_id: IG, success: true, platform_data: { url: 'https://instagram.example/p/1' } },
      { post_id: 'sp_1', social_account_id: YT, success: true, platform_data: { url: 'https://youtube.example/s/1' } },
      { post_id: 'sp_1', social_account_id: LI, success: false, error: 'LinkedIn said no' },
    ] };
    const read = L.applyResults({ ...created, status: 'processing' }, results, '2026-11-03T13:00:00Z');
    eq([read.status, read.instagram_url, read.options.networks.youtube.status, read.options.networks.youtube.url, read.options.networks.linkedin.status, read.options.networks.linkedin.error],
      ['posted', 'https://instagram.example/p/1', 'posted', 'https://youtube.example/s/1', 'failed', 'LinkedIn said no'], 'Instagram, YouTube and LinkedIn read apart');
    eq(L.overallStatus(read), 'failed', 'the queue shows it under Failed');
    const pending = L.applyResults({ ...created, status: 'processing' }, { data: [results.data[0]] }, 'x');
    ok(L.needsRefresh(pending), 'still asked about while YouTube or LinkedIn has no answer');
    const cancelled = L.markCancelled(created, 'x');
    eq([cancelled.status, cancelled.options.networks.youtube.status, cancelled.options.networks.linkedin.status], ['cancelled', 'cancelled', 'cancelled'], 'a cancel covers every network');
    ok(!L.needsRefresh({ ...cancelled, post_id: 'sp_1' }), 'a cancelled row is not asked about');
    const pub = L.publicRow(read);
    eq([pub.network, Object.keys(pub.networks), pub.youtube.title], ['instagram', ['youtube', 'linkedin'], 'First line'], 'the page sees each network\'s result');
    ok(!JSON.stringify(pub).includes('spc_'), 'and no account id');
    const ytOnly = L.applyResults(L.applyCreateResponse(build({ socialAccountId: '', instagram: false, youtube: yt() }).row, { id: 'sp_3' }, 'x'),
      { data: [{ post_id: 'sp_3', social_account_id: YT, success: false, error: 'bad' }] }, 'x');
    eq([ytOnly.status, ytOnly.error, L.publicRow(ytOnly).network], ['failed', 'bad', 'youtube'], 'a YouTube-only row reads its own result');
  }

  console.log(`instagram-networks: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });

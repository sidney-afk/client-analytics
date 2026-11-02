'use strict';
// frameio-view Edge Function: the lookup under Node with Frame.io faked (all data below is made up), plus static
// checks on the handler. No network. What it holds the function to:
//   - a card's Frame.io link (short, share, or project view) becomes a playable address and the comments;
//   - the Adobe access token is only ever sent to Frame.io: never in a response, a log line or an error;
//   - the handler answers to a staff role key, or to a client review token for that client's OWN card only;
//     a client never gets comments, never gets anything for another client, and nothing is written.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const ACCT_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ACCT_B = 'aaaaaaaa-0000-4000-8000-000000000002';
const SHARE = 'bbbbbbbb-0000-4000-8000-000000000001';
const STACK = 'cccccccc-0000-4000-8000-000000000001';
const FILE = 'dddddddd-0000-4000-8000-000000000001';
const FILE_OLD = 'dddddddd-0000-4000-8000-000000000002';
const PROJECT = 'eeeeeeee-0000-4000-8000-000000000001';
const SECRET_TOKEN = 'secret-access-token-for-tests';
const NOW = Date.parse('2026-10-14T12:00:00Z');
const EXPIRES = Math.floor(NOW / 1000) + 20 * 3600;

function jwt(exp) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b({ alg: 'none' }) + '.' + b({ exp, sub: 'x' }) + '.sig';
}
const STREAM = 'https://stream-download.frame.io/manifest/hls?token=' + jwt(EXPIRES + 4 * 3600);
const ORIGINAL = 'https://assets.frame.io/uploads/' + FILE + '/original.mp4?Expires=' + EXPIRES + '&Signature=sig';

// A fake Frame.io (V4 shape, measured 2026-10-14). `opts` switches the awkward cases on.
function fakeFrameio(opts = {}) {
  const log = [];
  const reply = (status, data, headers = {}) => ({
    ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] || null }, json: async () => data,
  });
  const comment = (id, ts, text, extra = {}) => Object.assign({ id, timestamp: ts, text, created_at: '2026-10-01T10:0' + (ts % 10) + ':00Z', completed_at: null, owner: null, replies: [] }, extra);
  const comments = opts.comments || [
    comment('c2', 240, 'Second note, a guest wrote it', { replies: [{ id: 'r1', text: 'Fixed, thanks', created_at: '2026-10-02T09:00:00Z', timestamp: null }] }),
    comment('c1', 24, 'First note by a team member', { owner: { name: 'Team Member' } }),
    comment('c3', 0, 'Very start', { completed_at: '2026-10-03T00:00:00Z' }),
  ];
  const file = { id: FILE, name: 'Sample Video V2.mp4', type: 'file', status: 'transcoded', media_type: 'video/mp4', created_at: '2026-10-05T00:00:00Z',
    media_links: { efficient: { download_url: STREAM }, high_quality: { download_url: STREAM + '&q=hq' }, original: { inline_url: ORIGINAL } } };
  const fn = async (url, init = {}) => {
    log.push({ url, auth: init.headers && init.headers.Authorization, key: init.headers && init.headers['x-api-key'] });
    if (opts.down) throw new Error('network down');
    if (url === 'https://f.io/abc123') return reply(302, {}, { location: 'https://next.frame.io/share/' + SHARE });
    if (url === 'https://f.io/dead') return reply(404, {});
    if (url === 'https://f.io/offsite') return reply(302, {}, { location: 'https://example.test/somewhere' });
    const m = url.replace('https://api.frame.io/v4', '');
    if (m === '/accounts') return reply(200, { data: [{ id: ACCT_A }, { id: ACCT_B }] });
    if (m === '/accounts/' + ACCT_A + '/shares/' + SHARE) return reply(404, {});
    if (m === '/accounts/' + ACCT_B + '/shares/' + SHARE) {
      return reply(200, { data: { id: SHARE, enabled: opts.shareOff ? false : true, expiration: opts.expired ? '2026-01-01T00:00:00Z' : null } });
    }
    if (m === '/accounts/' + ACCT_B + '/shares/' + SHARE + '/assets') {
      return reply(200, { data: opts.emptyShare ? [] : [{ id: STACK, type: 'version_stack', head_version: Object.assign({}, file, { media_links: undefined }) }] });
    }
    if (m.startsWith('/accounts/' + ACCT_A + '/files/')) return reply(404, {});
    if (m === '/accounts/' + ACCT_B + '/files/' + STACK) return reply(200, { data: { id: STACK, type: 'version_stack' } });
    if (m === '/accounts/' + ACCT_B + '/version_stacks/' + STACK + '/children') {
      return reply(200, { data: [{ id: FILE_OLD, type: 'file', created_at: '2026-09-01T00:00:00Z' }, { id: FILE, type: 'file', created_at: '2026-10-05T00:00:00Z' }] });
    }
    if (m === '/accounts/' + ACCT_B + '/files/' + FILE_OLD) return reply(200, { data: Object.assign({}, file, { id: FILE_OLD }) });
    if (m.startsWith('/accounts/' + ACCT_B + '/files/' + FILE + '?include=media_links')) {
      if (opts.image) return reply(200, { data: Object.assign({}, file, { media_type: 'image/png' }) });
      if (opts.created) return reply(200, { data: Object.assign({}, file, { status: 'created' }) });
      if (opts.noLinks) return reply(200, { data: Object.assign({}, file, { media_links: {} }) });
      if (opts.originalOnly) return reply(200, { data: Object.assign({}, file, { media_links: { original: { inline_url: ORIGINAL } } }) });
      return reply(200, { data: file });
    }
    if (m === '/accounts/' + ACCT_B + '/files/' + FILE) return reply(200, { data: file });
    if (m === '/accounts/' + ACCT_B + '/files/' + FILE + '/metadata') {
      if (opts.noMeta) return reply(404, {});
      return reply(200, { data: { metadata: [{ field_definition_name: 'Frame Rate', value: 24 }, { field_definition_name: 'Duration', value: 45.5 },
        { field_definition_name: 'Video Codec', value: 'H.264' }, { field_definition_name: 'Audio Codec', value: 'AAC' },
        { field_definition_name: 'Width', value: 1080 }, { field_definition_name: 'Height', value: 1920 }] } });
    }
    if (m.startsWith('/accounts/' + ACCT_B + '/files/' + FILE + '/comments?')) {
      if (opts.commentsDown) return reply(500, {});
      if (opts.manyPages) return reply(200, { data: [comment('p' + log.length, 1, 'page')], links: { next: 'https://api.frame.io/v4/accounts/' + ACCT_B + '/files/' + FILE + '/comments?after=x' } });
      return reply(200, { data: comments, links: { next: null } });
    }
    if (m === '/accounts/' + ACCT_B + '/comments/r1?include=owner') return reply(200, { data: { id: 'r1', owner: { name: 'Another Member', email: 'x@example.test' } } });
    if (opts.rate && m.includes('/comments/')) return reply(429, {});
    return reply(404, {});
  };
  return { fn, log };
}

function deps(f, over = {}) {
  let dropped = 0;
  return Object.assign({
    fetchFn: f.fn, getToken: async () => SECRET_TOKEN, dropToken: () => { dropped++; }, clientId: 'client-id-test', now: () => NOW,
    get dropped() { return dropped; },
  }, over);
}

(async () => {
  const logic = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/frameio-view/logic.mjs')).href);
  const { lookup, parseFrameLink, addressExpiry, pickAddress, pickRenditions, tokenSource, ViewError } = logic;
  const code = async (p) => { try { await p; return 'no error'; } catch (e) { return e instanceof ViewError ? e.code : 'other:' + e.message; } };

  // ---- the link
  eq(parseFrameLink('https://f.io/abc123'), { kind: 'short', code: 'abc123' }, 'short link');
  eq(parseFrameLink('see https://f.io/abc123, thanks'), { kind: 'short', code: 'abc123' }, 'a link inside text, punctuation trimmed');
  eq(parseFrameLink('https://next.frame.io/share/' + SHARE), { kind: 'share', shareId: SHARE, assetId: '' }, 'share link');
  eq(parseFrameLink('https://next.frame.io/share/' + SHARE + '/view/' + STACK).assetId, STACK, 'share link with the asset');
  eq(parseFrameLink('https://next.frame.io/project/' + PROJECT + '/view/' + STACK + '?version=' + FILE),
    { kind: 'view', projectId: PROJECT, fileId: STACK, versionId: FILE }, 'project view link with version');
  eq(parseFrameLink('https://drive.google.com/file/d/x/view https://f.io/zzz999'), { kind: 'short', code: 'zzz999' }, 'the first Frame.io link in a mixed field');
  for (const bad of ['', 'https://frame.io/test/12345', 'https://evil.test/f.io/abc123', 'https://f.io/a/b', 'https://next.frame.io/project/' + PROJECT, 'https://next.frame.io/share/not-a-uuid', 'f.io/abc123']) {
    eq(parseFrameLink(bad), null, 'not understood: ' + bad.slice(0, 40));
  }
  eq(await code(lookup('https://frame.io/test/1', deps(fakeFrameio()))), 'unsupported_link', 'an unknown link is refused before any request');
  { const f = fakeFrameio(); await code(lookup('nope', deps(f))); eq(f.log.length, 0, 'no request for a refused link'); }

  // ---- a short link, end to end
  const f = fakeFrameio();
  const d = deps(f);
  const out = await lookup('https://f.io/abc123', d);
  ok(out.ok === true, 'short link resolves');
  eq(out.video.url, STREAM + '&q=hq', 'the full-size file is the one to start with');
  eq(out.video.renditions, { efficient: STREAM, high_quality: STREAM + '&q=hq', original: ORIGINAL }, 'every rendition Frame.io gave is handed on by name, so the page can fall back to the small one on a slow connection');
  eq(out.video.name, 'Sample Video V2.mp4', 'file name');
  eq(out.video.fps, 24, 'frame rate read');
  eq(out.video.duration_seconds, 45.5, 'duration read');
  eq(out.video.file_id, FILE, 'the newest version is the file');
  eq(out.video.expires_at, new Date(Math.min(EXPIRES + 4 * 3600) * 1000).toISOString(), 'expiry read from the stream token');
  eq(out.open_url, 'https://next.frame.io/share/' + SHARE + '/view/' + STACK, 'the open-in-Frame.io address names the video');
  eq(out.comments.map((c) => c.id), ['c3', 'c1', 'c2'], 'comments are in time order');
  eq(out.comments.map((c) => c.time_seconds), [0, 1, 10], 'frames become seconds at 24 fps');
  const c2 = out.comments.find((c) => c.id === 'c2');
  eq([c2.author, c2.guest], ['', true], 'a comment with no owner is a guest');
  eq(out.comments.find((c) => c.id === 'c1').author, 'Team Member', 'a team member keeps the name');
  eq(c2.replies.map((r) => [r.text, r.author, r.guest]), [['Fixed, thanks', 'Another Member', false]], 'a reply gets its author by its own lookup');
  eq(out.comments.find((c) => c.id === 'c3').done, true, 'completed comments are marked done');
  ok(!('email' in c2.replies[0]) && !JSON.stringify(out).includes('x@example.test'), 'no email address leaves the function');
  ok(f.log.every((l) => !l.url.startsWith('https://api.frame.io') || (l.auth === 'Bearer ' + SECRET_TOKEN && l.key === 'client-id-test')), 'every Frame.io call carries the token and app key');
  ok(!JSON.stringify(out).includes(SECRET_TOKEN), 'the access token is not in the response');
  ok(f.log.filter((l) => l.url === 'https://f.io/abc123').length === 1 && !f.log.some((l) => /DELETE|POST|PATCH|PUT/.test(String(l.method || ''))), 'only reads');

  // ---- a project view link (the file is in the second account)
  const v = await lookup('https://next.frame.io/project/' + PROJECT + '/view/' + STACK, deps(fakeFrameio()));
  eq(v.video.file_id, FILE, 'view link on a version stack finds the newest version');
  eq(v.open_url, 'https://next.frame.io/project/' + PROJECT + '/view/' + STACK, 'view link opens itself');

  // ---- fallbacks and limits
  eq((await lookup('https://f.io/abc123', deps(fakeFrameio({ originalOnly: true })))).video.url, ORIGINAL, 'the original is the last resort');
  eq(pickAddress({ efficient: { download_url: STREAM }, original: { inline_url: ORIGINAL } }), STREAM, 'with no full-size file the small one is next, the original after it');
  eq(Object.keys(pickRenditions({ efficient: { download_url: 'http://evil.test/x' }, high_quality: { download_url: STREAM } })), ['high_quality'], 'an address off Frame.io is left out of the renditions');
  eq(addressExpiry(ORIGINAL, NOW), new Date(EXPIRES * 1000).toISOString(), 'expiry from a signed Expires');
  eq(addressExpiry('https://assets.frame.io/x', NOW), new Date(NOW + 3600000).toISOString(), 'one hour when nothing says');
  eq(pickAddress({ efficient: { download_url: 'http://evil.test/x' } }), '', 'an address off Frame.io is never handed on');
  const nm = await lookup('https://f.io/abc123', deps(fakeFrameio({ noMeta: true })));
  eq([nm.video.fps, nm.comments.map((c) => c.time_seconds)], [null, [null, null, null]], 'no frame rate: comments are listed without a jump time');
  const cd = await lookup('https://f.io/abc123', deps(fakeFrameio({ commentsDown: true })));
  ok(cd.ok && cd.video.url && cd.comments.length === 0 && cd.comments_error === 'frameio_unavailable', 'comments failing does not stop the video');
  const mp = await lookup('https://f.io/abc123', deps(fakeFrameio({ manyPages: true })));
  ok(mp.comments_truncated === true && mp.comments.length === 3, 'comment paging stops at three pages and says so');
  const big = Array.from({ length: 40 }, (_, i) => ({ id: 'k' + i, timestamp: i, text: 't', created_at: '2026-10-01T00:00:00Z', owner: null, replies: [{ id: 'r' + i, text: 'x', created_at: '2026-10-02T00:00:00Z' }] }));
  const bf = fakeFrameio({ comments: big });
  const bo = await lookup('https://f.io/abc123', deps(bf));
  eq(bf.log.filter((l) => /\/comments\/r\d+\?include=owner/.test(l.url)).length, 30, 'reply author lookups are capped at 30');
  ok(bo.reply_names_partial === true, 'the cap is reported');

  // ---- refusals, each in plain words
  eq(await code(lookup('https://f.io/dead', deps(fakeFrameio()))), 'link_not_found', 'dead short link');
  eq(await code(lookup('https://f.io/offsite', deps(fakeFrameio()))), 'link_not_found', 'a redirect that is not a share is not followed');
  eq(await code(lookup('https://f.io/abc123', deps(fakeFrameio({ shareOff: true })))), 'share_off', 'share switched off');
  eq(await code(lookup('https://f.io/abc123', deps(fakeFrameio({ expired: true })))), 'share_expired', 'share expired');
  eq(await code(lookup('https://f.io/abc123', deps(fakeFrameio({ emptyShare: true })))), 'empty_share', 'empty share');
  eq(await code(lookup('https://f.io/abc123', deps(fakeFrameio({ image: true })))), 'not_video', 'an image is not played');
  eq(await code(lookup('https://f.io/abc123', deps(fakeFrameio({ created: true })))), 'still_processing', 'still processing');
  eq(await code(lookup('https://f.io/abc123', deps(fakeFrameio({ noLinks: true })))), 'no_playable_address', 'no address');
  eq(await code(lookup('https://f.io/abc123', deps(fakeFrameio({ down: true })))), 'frameio_unavailable', 'Frame.io down');
  const errors = Object.values(logic.fail ? { a: logic.fail('share_off'), b: logic.fail('frameio_busy') } : {});
  ok(errors.every((e) => e.message.length > 10 && !/token|api|exception/i.test(e.message)), 'error sentences are plain');

  // ---- a 401 drops the cached token and tries once more, then asks for a new login
  {
    let first = true; const base = fakeFrameio();
    const flaky = async (url, init) => { if (url.endsWith('/accounts') && first) { first = false; return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({}) }; } return base.fn(url, init); };
    const dd = deps(base, { fetchFn: flaky });
    ok((await lookup('https://f.io/abc123', dd)).ok && dd.dropped === 1, 'one 401 is retried with a fresh token');
    const always = async (url) => (url.startsWith('https://f.io') ? base.fn(url) : { ok: false, status: 401, headers: { get: () => null }, json: async () => ({}) });
    eq(await code(lookup('https://f.io/abc123', deps(base, { fetchFn: always }))), 'frameio_login_needed', 'a second 401 means the login is needed');
  }

  // ---- the token source: kept in memory until just before it ends, never invented
  {
    let t = NOW; let n = 0; const seen = [];
    const fetchFn = async (url, init) => { n++; seen.push({ url, key: init.headers['x-broker-key'] }); return { ok: true, status: 200, json: async () => ({ access_token: 'tok' + n, expires_in: 3599 }) }; };
    const ts = tokenSource({ fetchFn, brokerUrl: 'https://project.test/functions/v1/frameio-token', brokerKey: 'k'.repeat(40), now: () => t });
    eq([await ts.get(), await ts.get()], ['tok1', 'tok1'], 'the token is reused while fresh');
    t += 3500 * 1000; eq(await ts.get(), 'tok2', 'and renewed before it runs out');
    ts.drop(); eq(await ts.get(), 'tok3', 'dropped means renewed');
    eq(seen[0], { url: 'https://project.test/functions/v1/frameio-token', key: 'k'.repeat(40) }, 'the key keeper is asked with the broker key');
    const login = tokenSource({ fetchFn: async () => ({ ok: false, status: 401, json: async () => ({ error: 'login_needed' }) }), brokerUrl: 'x', brokerKey: 'k', now: () => t });
    eq(await code(login.get()), 'frameio_login_needed', 'login_needed from the keeper is passed on in words');
  }

  // ---- the handler
  const src = read('supabase/functions/frameio-view/index.ts');
  const lg = read('supabase/functions/frameio-view/logic.mjs');
  ok(/authorizeStaffKey\(staffKey, \["admin", "smm", "creative"\]\)/.test(src), 'a staff role key is required for a staff request');
  ok(/if \(clientToken && staffKey\) return json\(\{ ok: false, error: "ambiguous_credentials" \}, 400\)/.test(src), 'a request with both a staff key and a client token is refused');
  ok(/if \(!clientToken\) \{\s*const auth = authorizeStaffKey/.test(src), 'no client token means the staff key check runs');
  ok(src.indexOf('authorizeStaffKey(') < src.indexOf('req.json()'), 'the key is checked before the body is read');
  ok(src.indexOf('authorizeClientCard(') > src.indexOf('req.json()') && src.indexOf('authorizeClientCard(') < src.indexOf('await lookup('), 'a client is authorized before Frame.io is asked anything');
  ok(/clientToken \? \{ client: true \}/.test(src), 'a client lookup never asks for comments');
  ok(/link = card\.link;/.test(src), "a client request plays the card's own link, not the one in the request");
  ok(/verify_jwt = false/.test(read('supabase/config.toml').split('[functions.frameio-view]')[1] || ''), 'registered in config.toml (the key is checked in code)');
  ok(src.split('\n').filter((l) => /console\./.test(l)).every((l) => !/link|token|url|body|comment/i.test(l.replace(/frameio-view/g, ''))), 'no log line carries a link, token, address or comment');
  const cc = read('supabase/functions/frameio-view/client-card.mjs');
  ok(!/\.from\(|createClient|supabase-js|\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(src + lg + cc), 'nothing is written to the database');
  ok(!/method:\s*['"]?(PUT|PATCH|DELETE)/i.test(src + cc) && !/rest\/v1\/[^\n]*method:\s*"POST"/.test(src), 'the client check only reads');
  ok(!/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(lg.replace(/method: 'POST', headers: \{ 'x-broker-key'/, '')), 'only GETs reach Frame.io');
  ok(!/access_token/.test(src), 'the handler never touches the access token');
  ok(!/\baccess_token\b/.test(lg.replace(/body\.access_token/g, '').replace(/clean\(body\.access_token\)/g, '')), 'logic reads the token only from the key keeper reply');

  // ---- fast start: the video address comes back without waiting for the comments, and a repeat open skips the search
  {
    const pf = fakeFrameio();
    const only = await lookup('https://f.io/abc123', deps(pf), { part: 'video' });
    ok(only.ok && only.video.url && only.video.name && only.open_url && !('comments' in only), 'part "video" answers with the addresses and no comments');
    ok(pf.log.every((e) => !/\/comments/.test(e.url)), 'part "video": Frame.io is not asked for comments at all');
    // post-source (plan row F4, D2) decides which file to copy from what Frame says about the upload itself.
    eq([only.video.media_type, only.video.codec, only.video.width, only.video.height], ['video/mp4', 'H.264', 1080, 1920], 'part "video" carries the upload\'s type, video codec and size');
    const asClient = await lookup('https://f.io/abc123', deps(fakeFrameio()), { client: true });
    ok(!['media_type', 'codec', 'width', 'height'].some((k) => k in asClient.video), 'a client lookup gets none of those facts');
    const cf = fakeFrameio();
    const com = await lookup('https://f.io/abc123', deps(cf), { part: 'comments' });
    ok(com.ok && com.comments.length === 3 && !('video' in com) && com.open_url, 'part "comments" answers with the comments only');
    ok(cf.log.every((e) => !/media_links/.test(e.url)), 'part "comments": no media address is asked for');
    eq((await lookup('https://f.io/abc123', deps(fakeFrameio()), { part: 'nonsense' })).comments.length, 3, 'an unknown part means both, as before');

    // the file behind a link is remembered for a minute (hover, then click)
    const cache = new Map(); let t = NOW; const f1 = fakeFrameio();
    const d1 = deps(f1, { cache, now: () => t });
    await lookup('https://f.io/abc123', d1, { part: 'video' });
    const first = f1.log.length;
    await lookup('https://f.io/abc123', d1, { part: 'comments' });
    const second = f1.log.length - first;
    ok(first >= 6 && second <= 4, `a second ask for the same link skips the redirect, the account search, the share and the assets (${first} calls, then ${second})`);
    ok(f1.log.filter((e) => e.url === 'https://f.io/abc123').length === 1, 'the short link is followed once');
    t += 61000; const before = f1.log.length;
    await lookup('https://f.io/abc123', d1, { part: 'video' });
    ok(f1.log.length - before >= 6, 'after a minute the link is looked up afresh (a new version shows within a minute)');
    // the two halves are asked for side by side: the video address does not wait for metadata
    const order = []; const slow = fakeFrameio(); const base = slow.fn;
    const fnOrder = async (url, init) => { if (/\/metadata$/.test(url)) order.push('meta-start'); if (/media_links/.test(url)) order.push('media-start'); return base(url, init); };
    await lookup('https://f.io/abc123', deps({ fn: fnOrder, log: slow.log }), { part: 'video' });
    eq(order, ['media-start', 'meta-start'], 'the address and the metadata are asked for together, not one after the other');
  }

  // ---- a share link that names a file plays THAT file, or refuses; it never swaps in another video (F0)
  // The share holds, on its first page, a version stack and a folder (a stack and a loose file inside); a second
  // page (reached only through links.next) holds another stack. All ids are made up.
  {
    const SH = 'bbbbbbbb-0000-4000-8000-000000000002';
    const id = (n) => 'ffffffff-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
    const S1 = id(1), F1 = id(2), F1_OLD = id(3), DIR = id(4), S3 = id(5), F3 = id(6), F4 = id(7), S2 = id(8), F2 = id(9), GONE = id(99);
    const vid = (fid, name) => ({ id: fid, name, type: 'file', status: 'transcoded', media_type: 'video/mp4', created_at: '2026-10-05T00:00:00Z' });
    const files = { [F1]: vid(F1, 'One.mp4'), [F1_OLD]: vid(F1_OLD, 'One old.mp4'), [F3]: vid(F3, 'Three.mp4'), [F4]: vid(F4, 'Four.mp4'), [F2]: vid(F2, 'Two.mp4') };
    const shareFake = (o = {}) => {
      const log = [];
      const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => data });
      const fn = async (url) => {
        log.push({ url });
        const m = url.replace('https://api.frame.io/v4', '');
        const B = '/accounts/' + ACCT_B;
        if (m === '/accounts') return reply(200, { data: [{ id: ACCT_B }] });
        if (m === B + '/shares/' + SH) return reply(200, { data: { id: SH, enabled: true, expiration: null } });
        if (m.startsWith(B + '/shares/' + SH + '/assets')) {
          if (/after=p2/.test(m) && o.page2Down) return reply(500, {});
          if (/after=p2/.test(m)) return reply(200, { data: [{ id: S2, type: 'version_stack', head_version: files[F2] }], links: { next: null } });
          return reply(200, { data: [{ id: S1, type: 'version_stack', head_version: files[F1] }, { id: DIR, type: 'folder' }],
            links: { next: 'https://api.frame.io/v4' + B + '/shares/' + SH + '/assets?page_size=50&after=p2' } });
        }
        if (m.startsWith(B + '/folders/' + DIR + '/children')) return reply(200, { data: [{ id: S3, type: 'version_stack', head_version: files[F3] }, files[F4]], links: { next: null } });
        if (m.startsWith(B + '/version_stacks/' + S1 + '/children')) return reply(200, { data: [files[F1_OLD], files[F1]], links: { next: null } });
        if (m.startsWith(B + '/version_stacks/' + S2 + '/children')) return reply(200, { data: [files[F2]], links: { next: null } });
        if (m.startsWith(B + '/version_stacks/' + S3 + '/children')) return reply(200, { data: [files[F3]], links: { next: null } });
        const fm = m.match(/^\/accounts\/[^/]+\/files\/([0-9a-f-]{36})(\/metadata|\?include=media_links.*)?$/);
        if (fm && files[fm[1]]) {
          if (fm[2] === '/metadata') return reply(200, { data: { metadata: [] } });
          return reply(200, { data: Object.assign({}, files[fm[1]], { media_links: { high_quality: { download_url: 'https://cdn.frame.io/' + fm[1] + '.mp4' } } }) });
        }
        return reply(404, {});
      };
      return { fn, log };
    };
    const play = async (tail) => (await lookup('https://next.frame.io/share/' + SH + tail, deps(shareFake()), { part: 'video' })).video.file_id;
    const named = async (tail) => { try { return await play(tail); } catch (e) { return e instanceof ViewError ? e.code : 'other:' + e.message; } };
    eq(await named('/view/' + F4), F4, 'a file inside a shared folder plays that file, not the first video');
    eq(await named('/view/' + S3), F3, 'a version stack inside a shared folder plays its newest version');
    eq(await named('/view/' + S2), F2, 'a file on the second page of the share plays that file');
    eq(await named('/view/' + F1_OLD), F1_OLD, 'an older version named by its own id plays that version');
    eq(await named('/view/' + S1), F1, 'a top-level stack still plays its newest version');
    eq(await named('/view/' + GONE), 'file_not_in_share', 'a named file that is not in the share is refused, never swapped for another video');
    eq(await named(''), F1, 'a bare share (no file named) still plays its first video');
    { const sf = shareFake({ page2Down: true });
      const out = await lookup('https://next.frame.io/share/' + SH + '/view/' + S1, deps(sf), { part: 'video' });
      ok(out.video.file_id === F1 && !sf.log.some((e) => /after=p2/.test(e.url)), 'a named file found on page 1 plays without asking for page 2 (a later page that fails cannot stop it)'); }
    const refusal = logic.fail('file_not_in_share');
    ok(refusal.status === 404 && refusal.message.length > 10 && !/token|api|exception/i.test(refusal.message), 'the refusal is a 404 in plain words, like link_not_found');
  }

  // ---- part "list" (staff only) and the strict lookup (F1). All ids and names are made up.
  {
    const SH = 'bbbbbbbb-0000-4000-8000-000000000003';
    const SH_ONE = 'bbbbbbbb-0000-4000-8000-000000000004';
    const DIR = 'ffffffff-1000-4000-8000-000000000001';
    const BIG = 'ffffffff-1000-4000-8000-000000000002';
    const ONE = 'ffffffff-1000-4000-8000-000000000003';
    const vid = (n, extra = {}) => Object.assign({
      id: 'ffffffff-2000-4000-8000-' + String(n).padStart(12, '0'), name: 'Clip ' + n + '.mp4', type: 'file', status: 'transcoded',
      media_type: 'video/mp4', created_at: new Date(Date.UTC(2026, 9, 1) + n * 60000).toISOString(), duration: 10 + n,
      media_links: { thumbnail: { download_url: 'https://assets.frame.io/thumb/' + n + '.jpg' } },
    }, extra);
    const img = (n) => vid(n, { name: 'Still ' + n + '.png', media_type: 'image/png' });
    const six = [1, 2, 3, 4, 5, 6].map((n) => vid(n));
    const listFake = (o = {}) => {
      const log = [];
      const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => data });
      const B = '/accounts/' + ACCT_B;
      const fn = async (url) => {
        log.push({ url });
        const m = url.replace('https://api.frame.io/v4', '');
        if (m === '/accounts') return reply(200, { data: [{ id: ACCT_B }] });
        if (m === B + '/shares/' + SH) return reply(200, { data: { id: SH, name: 'Test folder', enabled: true, expiration: null } });
        if (m === B + '/shares/' + SH_ONE) return reply(200, { data: { id: SH_ONE, name: 'One video', enabled: true, expiration: null } });
        if (m.startsWith(B + '/shares/' + SH + '/assets')) {
          const folder = o.big ? { id: BIG, type: 'folder', name: 'Big folder' } : { id: DIR, type: 'folder', name: 'Test folder' };
          return reply(200, { data: [folder], links: { next: null } });
        }
        if (m.startsWith(B + '/shares/' + SH_ONE + '/assets')) return reply(200, { data: [{ id: ONE, type: 'version_stack', head_version: vid(40) }], links: { next: null } });
        if (m.startsWith(B + '/folders/' + DIR + '/children') && o.endless) {
          // an image-heavy folder that never runs out of pages: one image and one video per page
          const p = Number((m.match(/after=(\d+)/) || [0, 0])[1]);
          return reply(200, { data: [img(500 + p), ...(p < 3 ? [vid(300 + p)] : [])], links: { next: 'https://api.frame.io/v4' + B + '/folders/' + DIR + '/children?page_size=50&after=' + (p + 1) } });
        }
        if (m.startsWith(B + '/folders/' + DIR + '/children')) return reply(200, { data: [six[0], img(7), six[1], six[2], img(8), six[3], six[4], six[5]], links: { next: null } });
        if (m.startsWith(B + '/folders/' + BIG + '/children')) {
          if (/after=2/.test(m)) return reply(200, { data: Array.from({ length: 30 }, (_, i) => vid(130 + i)), links: { next: null } });
          return reply(200, { data: Array.from({ length: 30 }, (_, i) => vid(100 + i)), links: { next: 'https://api.frame.io/v4' + B + '/folders/' + BIG + '/children?page_size=50&after=2' } });
        }
        const fm = m.match(/^\/accounts\/[^/]+\/files\/([0-9a-f-]{36})/);
        if (fm && fm[1].startsWith('ffffffff-2000-')) {
          const n = Number(fm[1].slice(-12));
          if (/\/metadata$/.test(m)) return reply(200, { data: { metadata: [] } });
          return reply(200, { data: vid(n, { media_links: { high_quality: { download_url: 'https://cdn.frame.io/' + n + '.mp4' }, thumbnail: { download_url: 'https://assets.frame.io/thumb/' + n + '.jpg' } } }) });
        }
        return reply(404, {});
      };
      return { fn, log };
    };
    const lf = listFake();
    const out = await lookup('https://next.frame.io/share/' + SH, deps(lf), { part: 'list' });
    eq(out.videos.length, 6, 'a folder of 6 videos and 2 images lists the 6 videos');
    ok(out.videos.every((v) => /^Clip \d\.mp4$/.test(v.name) && v.duration_seconds > 10 && /^https:\/\/assets\.frame\.io\/thumb\//.test(v.thumbnail_url)), 'each row has its name, length and Frame thumbnail');
    ok(out.videos.every((v) => v.link === 'https://next.frame.io/share/' + SH + '/view/' + v.file_id), 'each row has its own share link, naming its file');
    ok(out.videos.every((v, i, a) => i === 0 || a[i - 1].created_at >= v.created_at), 'newest first');
    eq([out.name, out.truncated], ['Test folder', false], 'the folder name comes back, and nothing was cut');
    ok(!('comments' in out) && lf.log.every((e) => !/comments|media_links\.(original|high_quality|efficient)/.test(e.url)), 'a list asks for no comments and no playable address');
    // each listed link plays the file it names (F0)
    eq((await lookup(out.videos[4].link, deps(listFake()), { part: 'video' })).video.file_id, out.videos[4].file_id, 'a listed link plays its own video');

    const big = await lookup('https://next.frame.io/share/' + SH, deps(listFake({ big: true })), { part: 'list' });
    eq([big.videos.length, big.truncated], [50, true], 'a folder past one page is followed to its second page and cut at 50, saying so');
    eq(big.videos[0].name, 'Clip 159.mp4', 'the 50 kept are the newest');

    const endless = await lookup('https://next.frame.io/share/' + SH, deps(listFake({ endless: true })), { part: 'list' });
    eq([endless.videos.length, endless.truncated], [3, true], 'a folder whose pages run past the cap says it was cut, even with few videos found');

    const one = await lookup('https://next.frame.io/share/' + SH_ONE + '/view/' + ONE, deps(listFake()), { part: 'list' });
    eq(one.videos.map((v) => [v.name, v.link]), [['Clip 40.mp4', 'https://next.frame.io/share/' + SH_ONE + '/view/' + ONE]], 'a link to one file lists that one video');

    // strict: the exact file, or a refusal
    eq(await code(lookup('https://next.frame.io/share/' + SH, deps(listFake()), { part: 'video', strict: true })), 'folder_link', 'strict refuses a bare folder link');
    eq(await code(lookup('https://next.frame.io/share/' + SH + '/view/' + DIR, deps(listFake()), { part: 'video', strict: true })), 'folder_link', 'strict refuses a link that names a folder');
    eq((await lookup('https://next.frame.io/share/' + SH + '/view/' + six[2].id, deps(listFake()), { part: 'video', strict: true })).video.file_id, six[2].id, 'strict plays a link that names a file');
    eq((await lookup('https://next.frame.io/share/' + SH, deps(listFake()), { part: 'video' })).video.file_id, six[0].id, 'without strict a bare folder link still plays its first video');
    const fl = logic.fail('folder_link');
    ok(fl.status === 422 && fl.message.length > 10 && !/token|api|exception/i.test(fl.message), 'the strict refusal is in plain words');
    // a client never gets a list: the client lookup is always the video part
    ok(!('videos' in (await lookup('https://next.frame.io/share/' + SH, deps(listFake()), { client: true, part: 'list' }))), 'a client lookup that asks for a list gets the video only');
  }

  // ---- the client side: one client's token plays that client's own card, nothing else
  {
    const cc = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/frameio-view/client-card.mjs')).href);
    const { authorizeClientCard, ClientRefusal, flagAllows, normalizeClient } = cc;
    const TOK_A = 'A'.repeat(32), TOK_B = 'B'.repeat(32);
    const LINK = 'https://f.io/abc123';
    function fakeDb(over = {}) {
      const asked = [];
      const db = Object.assign({
        client_access: [{ slug: 'clientone', review_token: TOK_A }, { slug: 'clienttwo', review_token: TOK_B }],
        flag: { all: false, clients: ['clientone', 'clienttwo'] },
        clients: [{ slug: 'clientone' }, { slug: 'clienttwo' }],
        cards: [{ id: 'card-1', client: 'clientone', asset_url: LINK }, { id: 'card-2', client: 'clienttwo', asset_url: 'https://f.io/other99' }, { id: 'card-3', client: 'clientone', asset_url: '' }],
        trialFlag: { clients: ['clientone'] },
        trialCards: [{ client: 'clientone', post_id: 'card-1', enabled: true }],
        versions: [
          { client: 'clientone', post_id: 'card-1', letter: 'A', status: 'approved', frame_url: LINK },
          { client: 'clientone', post_id: 'card-1', letter: 'B', status: 'pending', frame_url: 'https://f.io/verb22' },
          { client: 'clientone', post_id: 'card-1', letter: 'C', status: 'dropped', frame_url: 'https://f.io/verc33' },
          { client: 'clienttwo', post_id: 'card-2', letter: 'B', status: 'pending', frame_url: 'https://f.io/twob44' },
        ],
      }, over);
      const rest = async (p) => {
        asked.push(p);
        if (db.down) throw new Error('db down');
        if (p.startsWith('client_access?')) return db.client_access;
        if (p.startsWith('syncview_runtime_flags?') && /key=eq\.trial_reels_pages/.test(p)) return db.trialFlag === null ? [] : [{ value: db.trialFlag }];
        if (p.startsWith('syncview_runtime_flags?')) { if (db.flagDown) throw new Error('flag read failed'); return db.flag === null ? [] : [{ value: db.flag }]; }
        if (p.startsWith('trial_reel_cards?')) { const c = /client=eq\.([^&]+)/.exec(p), i = /post_id=eq\.([^&]+)/.exec(p); return db.trialCards.filter((r) => r.client === decodeURIComponent(c[1]) && r.post_id === decodeURIComponent(i[1])); }
        if (p.startsWith('studio_trial_versions?')) { if (db.versionsDown) throw new Error('versions read failed'); const c = /client=ilike\.([^&]+)/.exec(p), i = /post_id=eq\.([^&]+)/.exec(p);
          return db.versions.filter((r) => r.client.toLowerCase() === decodeURIComponent(c[1]).toLowerCase() && r.post_id === decodeURIComponent(i[1])); }
        if (p.startsWith('clients?')) { const m = /slug=eq\.([^&]+)/.exec(p); return db.clients.filter((c) => c.slug === decodeURIComponent(m[1])); }
        if (p.startsWith('calendar_posts?')) { const c = /client=eq\.([^&]+)/.exec(p), i = /id=eq\.([^&]+)/.exec(p); return db.cards.filter((r) => r.client === decodeURIComponent(c[1]) && r.id === decodeURIComponent(i[1])); }
        throw new Error('unexpected read ' + p);
      };
      return { rest, asked };
    }
    const refused = async (args, db) => { try { await authorizeClientCard(args, db.rest); return 'no error'; } catch (e) { return e instanceof ClientRefusal ? e.code + ' ' + e.status : 'other:' + e.message; } };

    { const db = fakeDb(); const r = await authorizeClientCard({ token: TOK_A, cardId: 'card-1' }, db.rest); eq(r, { slug: 'clientone', link: LINK }, "a client plays its own card, with the card's own link"); }
    { const db = fakeDb(); eq(await refused({ token: '', cardId: 'card-1' }, db), 'credentials_required 401', 'no token is refused'); eq(db.asked.length, 0, 'no token: nothing was read'); }
    eq(await refused({ token: '   ', cardId: 'card-1' }, fakeDb()), 'credentials_required 401', 'a blank token is refused');
    eq(await refused({ token: 'C'.repeat(32), cardId: 'card-1' }, fakeDb()), 'invalid_client_token 401', 'an unknown token is refused');
    { const wrong = await refused({ token: TOK_A, cardId: 'card-2' }, fakeDb()), missing = await refused({ token: TOK_A, cardId: 'card-nope' }, fakeDb());
      eq(wrong, 'not_found 404', 'the wrong client is refused'); eq(wrong, missing, "another client's card and a missing card look the same"); }
    eq(await refused({ token: TOK_B, cardId: 'card-1' }, fakeDb()), 'not_found 404', 'the other client is refused the same way');
    eq(await refused({ token: TOK_A, cardId: 'card-1', link: 'https://f.io/other99' }, fakeDb()), 'not_found 404', "a link that is not the card's own is refused");
    eq((await authorizeClientCard({ token: TOK_A, cardId: 'card-1', link: LINK }, fakeDb().rest)).link, LINK, "the card's own link may be sent back");
    eq(await refused({ token: TOK_A, cardId: 'card-3' }, fakeDb()), 'not_found 404', 'a card with no video link has nothing to play');
    eq(await refused({ token: TOK_A, cardId: '../x' }, fakeDb()), 'invalid_scope 400', 'an odd card id is refused');
    eq(await refused({ token: TOK_A, cardId: 'card-1' }, fakeDb({ client_access: [{ slug: 'clientone', review_token: TOK_A }, { slug: 'clienttwo', review_token: TOK_A }] })), 'ambiguous_client_token 403', 'a token shared by two clients is refused');
    eq(await refused({ token: TOK_A, cardId: 'card-1' }, fakeDb({ client_access: [{ slug: 'clientone', review_token: '' }] })), 'invalid_client_token 401', 'a blank stored token never matches');
    eq(await refused({ token: TOK_A, cardId: 'card-1' }, fakeDb({ flag: null })), 'not_enabled 403', 'no flag row means off');
    eq(await refused({ token: TOK_A, cardId: 'card-1' }, fakeDb({ flag: { all: false, clients: ['clienttwo'] } })), 'not_enabled 403', 'a flag that lists other clients means off for this one');
    eq(await refused({ token: TOK_A, cardId: 'card-1' }, fakeDb({ flag: { all: 'true', clients: [] } })), 'not_enabled 403', 'all must be literally true');
    eq(await refused({ token: TOK_A, cardId: 'card-1' }, fakeDb({ flag: ['clientone'] })), 'not_enabled 403', 'a flag of the wrong shape means off');
    eq(await refused({ token: TOK_A, cardId: 'card-1' }, fakeDb({ flagDown: true })), 'not_enabled 403', 'a failed flag read means off');
    eq((await authorizeClientCard({ token: TOK_A, cardId: 'card-1' }, fakeDb({ flag: { all: true, clients: [] } }).rest)).slug, 'clientone', 'all:true switches every client on');
    eq(await refused({ token: TOK_A, cardId: 'card-1' }, fakeDb({ clients: [] })), 'inactive_client 403', 'an inactive client is refused');
    eq(await refused({ token: TOK_A, cardId: 'card-1' }, fakeDb({ down: true })), 'authorization_unavailable 503', 'a database that does not answer is refused, not guessed');
    eq([flagAllows({ all: false, clients: ['Client One'] }, 'clientone'), flagAllows({ clients: 'clientone' }, 'clientone'), flagAllows(null, 'clientone')], [true, false, false], 'the flag reads display names like the page does');
    eq(normalizeClient('Client One'), 'clientone', 'client names are normalized like the other client functions');
    { const db = fakeDb(); await authorizeClientCard({ token: TOK_A, cardId: 'card-1' }, db.rest); ok(db.asked.every((a) => /^(client_access|syncview_runtime_flags|clients|calendar_posts)\?/.test(a)), 'only the four tables are read'); }

    // Trial reels (plan section 10 item 1): a version of THIS card the client may see plays by its link; nothing else does.
    const VB = 'https://f.io/verb22';
    eq(await authorizeClientCard({ token: TOK_A, cardId: 'card-1', link: VB }, fakeDb().rest), { slug: 'clientone', link: VB }, "a trial card's Video B plays on the client link");
    eq(await refused({ token: TOK_A, cardId: 'card-1', link: 'https://f.io/verc33' }, fakeDb()), 'not_found 404', 'a dropped version is refused');
    { const versions = [{ client: 'clientone', post_id: 'card-1', letter: 'A', status: 'approved', frame_url: LINK }, { client: 'clientone', post_id: 'card-1', letter: 'B', status: 'pending', frame_url: 'https://f.io/verb22/?x=1' }];
      eq((await authorizeClientCard({ token: TOK_A, cardId: 'card-1', link: VB }, fakeDb({ versions }).rest)).link, 'https://f.io/verb22/?x=1', "a version saved with a trailing slash and query plays when asked by the player's short link (Codex on PR 2367)"); }
    eq(await refused({ token: TOK_A, cardId: 'card-1', link: 'https://f.io/twob44' }, fakeDb()), 'not_found 404', "another card's (another client's) version is refused");
    eq(await refused({ token: TOK_A, cardId: 'card-1', link: VB }, fakeDb({ trialFlag: { clients: ['clienttwo'] } })), 'not_found 404', 'trial reels off for this client: refused like any other link');
    eq(await refused({ token: TOK_A, cardId: 'card-1', link: VB }, fakeDb({ trialFlag: null })), 'not_found 404', 'no trial reels switch row: refused');
    eq(await refused({ token: TOK_A, cardId: 'card-1', link: VB }, fakeDb({ trialCards: [{ client: 'clientone', post_id: 'card-1', enabled: false }] })), 'not_found 404', "the card's Trial reels switch off: refused");
    eq(await refused({ token: TOK_A, cardId: 'card-1', link: VB }, fakeDb({ versionsDown: true })), 'not_found 404', 'a failed versions read: refused, not guessed');
    { const versions = [{ client: 'clientone', post_id: 'card-1', letter: 'A', status: 'winner', frame_url: LINK }, { client: 'clientone', post_id: 'card-1', letter: 'B', status: 'pending', frame_url: VB }];
      const picked = [{ client: 'clientone', post_id: 'card-1', enabled: true, winner_letter: 'A' }];
      eq(await refused({ token: TOK_A, cardId: 'card-1', link: VB }, fakeDb({ versions, trialCards: picked })), 'not_found 404', 'once a winner is picked only the winner plays');
      eq((await authorizeClientCard({ token: TOK_A, cardId: 'card-1', link: LINK }, fakeDb({ versions, trialCards: picked }).rest)).link, LINK, 'the winner (the card link) still plays'); }
    // The winner is SyncView's alone (owner, 2026-10-27): the card's winner_letter, never a status the studio wrote.
    { const VC = 'https://f.io/verc77';
      const versions = [{ client: 'clientone', post_id: 'card-1', letter: 'A', status: 'on trial', frame_url: LINK }, { client: 'clientone', post_id: 'card-1', letter: 'B', status: 'lost', frame_url: VB }, { client: 'clientone', post_id: 'card-1', letter: 'C', status: 'winner', frame_url: VC }];
      eq((await authorizeClientCard({ token: TOK_A, cardId: 'card-1', link: VB }, fakeDb({ versions }).rest)).link, VB, 'a studio-written winner with no winner letter on the card cuts nothing: Video B (studio "lost") still plays');
      const picked = [{ client: 'clientone', post_id: 'card-1', enabled: true, winner_letter: 'B' }];
      eq((await authorizeClientCard({ token: TOK_A, cardId: 'card-1', link: VB }, fakeDb({ versions, trialCards: picked }).rest)).link, VB, "the card's letter (B) is the winner, whatever its row says");
      eq(await refused({ token: TOK_A, cardId: 'card-1', link: VC }, fakeDb({ versions, trialCards: picked })), 'not_found 404', 'and the studio-written winner (C) is refused'); }
    { const db = fakeDb(); await authorizeClientCard({ token: TOK_A, cardId: 'card-1', link: VB }, db.rest);
      ok(db.asked.every((a) => /^(client_access|syncview_runtime_flags|clients|calendar_posts|trial_reel_cards|studio_trial_versions)\?/.test(a)), 'a version link reads only the trial reels tables beside the four'); }
    ok(/trialVersionLink/.test(read('supabase/functions/frameio-view/client-card.mjs')) && !/trial/i.test(read('supabase/functions/frameio-view/logic.mjs')), 'the trial check lives in client-card.mjs; logic.mjs (shared with higgsfield-mcp) is untouched');

    { const f = fakeFrameio(); const out = await lookup(LINK, deps(f), { comments: false });
      ok(out.ok && out.video.url === STREAM + '&q=hq' && out.video.renditions.efficient === STREAM, 'a client gets the playable addresses');
      ok(!('comments' in out) && !('comments_error' in out) && !('comments_truncated' in out) && !('reply_names_partial' in out), 'a client response has no comments at all');
      ok(!JSON.stringify(out).includes('Second note') && !JSON.stringify(out).includes('Team Member') && !JSON.stringify(out).includes('Fixed, thanks'), 'no comment text, author or reply anywhere in it');
      ok(!('open_url' in out) && !('name' in out.video) && !('file_id' in out.video), 'no Frame.io page address, file name or id either');
      ok(f.log.every((e) => !/\/comments/.test(e.url)), 'Frame.io was never even asked for comments');
      ok(!JSON.stringify(out).includes(SECRET_TOKEN), 'and the access token is not in it'); }
    { const out = await lookup(LINK, deps(fakeFrameio())); ok(out.comments.length === 3 && out.open_url && out.video.name, 'staff still get comments, the Frame.io page and the file name'); }
  }

  console.log(`frameio-view-source: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });

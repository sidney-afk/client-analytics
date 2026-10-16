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
      return reply(200, { data: { metadata: [{ field_definition_name: 'Frame Rate', value: 24 }, { field_definition_name: 'Duration', value: 45.5 }] } });
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
      }, over);
      const rest = async (p) => {
        asked.push(p);
        if (db.down) throw new Error('db down');
        if (p.startsWith('client_access?')) return db.client_access;
        if (p.startsWith('syncview_runtime_flags?')) { if (db.flagDown) throw new Error('flag read failed'); return db.flag === null ? [] : [{ value: db.flag }]; }
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

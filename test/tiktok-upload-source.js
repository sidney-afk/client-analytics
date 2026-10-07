'use strict';
// tiktok-upload Edge Function (the TikTok Upload tab off n8n and off the Sheet, OPEN_REPAIRS 362): the real
// action handler and the shared queue logic under Node, against a fake Post For Me and a fake table, plus
// static checks on the migration, the cancel function's table lookup, the page and the deploy lane.
// No network: nothing reaches Post For Me, Google or Supabase. Fixture names only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakePostForMe, fakeQueueTable, cancelQueueOver } = require('./helpers/tiktok-upload-fakes.js');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const ACCOUNT = 'spc_fixtureTiktok01';
const OTHER = 'spc_fixtureTiktok02';
const IG = 'spc_fixtureInstagram1';
const PROFILES = [
  { slug: 'fixtureclienta', display_name: 'Fixture Client A', postforme_account_id: ACCOUNT },
  { slug: 'fixture-b-legacy', display_name: 'Fixture Client B', postforme_account_id: OTHER },
  { slug: 'fixtureclientc', display_name: 'Fixture Client C', postforme_account_id: IG },
];
const MEDIA = 'https://data.postforme.dev/fixture/video-1';

(async () => {
  const Q = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/tiktok-queue.mjs')).href);
  const { handleTiktokUpload } = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/tiktok-upload/handler.mjs')).href);
  const C = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/tiktok-upload-cancel/logic.mjs')).href);

  const setup = (extra = {}) => {
    const pfm = fakePostForMe({ accounts: { [ACCOUNT]: 'tiktok', [OTHER]: 'tiktok_business', [IG]: 'instagram' }, ...(extra.pfm || {}) });
    const store = fakeQueueTable({ profiles: PROFILES, rows: extra.rows || [] });
    let now = NOW;
    const call = (body, role = 'smm', readSheet = async () => null) =>
      handleTiktokUpload({ body, role, actor: 'QA Admin', pfm, store, readSheet, now: () => now });
    return { pfm, store, call, tick: (ms) => { now += ms; } };
  };
  const create = (over = {}) => ({ action: 'create', clientName: 'Fixture Client A', socialAccountId: ACCOUNT, title: 'Hello', mediaUrl: MEDIA, timezone: 'UTC', idempotencyKey: 'key-1', options: JSON.stringify({ privacy_level: 'PUBLIC_TO_EVERYONE', post_mode: 'DIRECT_POST', cover_timestamp_ms: 1000 }), ...over });

  // --- 1. The Post For Me request is the one n8n "Submit (Direct)" builds.
  {
    const b = Q.buildCreate(create({ scheduledAtUTC: '2026-10-08T15:00:00.000Z' }), NOW, 'QA');
    eq(b.postBody, {
      caption: 'Hello',
      social_accounts: [ACCOUNT],
      media: [{ url: MEDIA, thumbnail_timestamp_ms: 1000 }],
      account_configurations: [{ social_account_id: ACCOUNT, configuration: { privacy_status: 'public', allow_comment: true, allow_duet: true, allow_stitch: true, disclose_your_brand: false, disclose_branded_content: false, is_ai_generated: false, is_draft: false, localizations: null } }],
      external_id: 'key-1',
      scheduled_at: '2026-10-08T15:00:00.000Z',
    }, 'video post body matches n8n');
    eq([b.row.status, b.row.profile, b.row.scheduled_for, b.row.source], ['scheduled', ACCOUNT, '2026-10-08T15:00:00.000Z', 'syncview'], 'scheduled row');
    const photos = Q.buildCreate(create({ mediaUrl: '', mediaUrls: JSON.stringify([MEDIA, MEDIA + 'b']), options: { privacy_level: 'SELF_ONLY', post_mode: 'MEDIA_UPLOAD', disable_duet: true, auto_add_music: false, cover_timestamp_ms: 1000 } }), NOW, 'QA');
    const cfg = photos.postBody.account_configurations[0].configuration;
    eq([cfg.privacy_status, cfg.is_draft, cfg.allow_duet, cfg.auto_add_music], ['private', true, false, false], 'photo settings');
    eq(photos.postBody.media, [{ url: MEDIA }, { url: MEDIA + 'b' }], 'a carousel has no cover frame');
    eq([photos.row.status, photos.postBody.scheduled_at], ['uploading', undefined], 'post now');
    eq(Q.buildCreate(create({ scheduledAtUTC: '', scheduledAt: '2026-10-08T09:30', timezone: 'America/New_York' }), NOW, 'QA').row.scheduled_for, '2026-10-08T13:30:00.000Z', 'wall clock in a time zone, like n8n');
    for (const [over, label] of [[{ clientName: '' }, 'no client'], [{ socialAccountId: 'abc' }, 'bad account'], [{ title: '' }, 'no caption'], [{ mediaUrl: 'https://evil.example/x' }, 'foreign media'], [{ scheduledAtUTC: '2026-10-01T00:00:00Z' }, 'past time'], [{ idempotencyKey: 'a b' }, 'bad key']]) {
      ok(!Q.buildCreate(create(over), NOW, 'QA').ok, 'refused: ' + label);
    }
  }

  // --- 2. Submit: mint, create (scheduled and now), idempotent, account checks, failures.
  {
    const { pfm, store, call } = setup();
    const mint = await call({ action: 'mint' });
    eq([mint.status, mint.body.ok, /^https:\/\/data\.postforme\.dev\//.test(mint.body.media_url)], [200, true, true], 'mint returns a Post For Me upload url');
    pfm.mode = 'mint_fails';
    eq((await call({ action: 'mint' })).status, 502, 'a failed mint is a 502');
    pfm.mode = '';

    const r = await call(create({ scheduledAtUTC: '2026-10-08T15:00:00.000Z' }));
    eq([r.status, r.body.ok, r.body.status, r.body.row.upload_post_id], [200, true, 'scheduled', 'sp_fixture_1'], 'scheduled post created');
    eq(store.table.get('key-1').post_body.scheduled_at, '2026-10-08T15:00:00.000Z', 'the request is kept for a retry');
    ok(!('profile' in r.body.row) && !('post_body' in r.body.row), 'the page never sees the account id or the request');
    const again = await call(create({ scheduledAtUTC: '2026-10-08T15:00:00.000Z' }));
    eq([again.body.id, pfm.calls.filter((c) => c.method === 'POST' && c.path === '/social-posts').length], ['key-1', 1], 'same key twice is one post');

    const now = await call(create({ idempotencyKey: 'key-2' }));
    eq(now.body.status, 'processing', 'post now is processing until Post For Me reports');

    eq((await call(create({ idempotencyKey: 'key-3', socialAccountId: OTHER }))).status, 403, 'another client\'s account is refused');
    eq((await call(create({ idempotencyKey: 'key-4', clientName: 'Fixture Client B', socialAccountId: OTHER }))).body.ok, true, 'a client whose slug is not its name is found by name');
    eq((await call(create({ idempotencyKey: 'key-5', clientName: 'Fixture Client C', socialAccountId: IG }))).status, 400, 'an Instagram account is refused');
    eq((await call(create({ idempotencyKey: 'key-6', clientName: 'Nobody' }))).status, 409, 'no account on file');
    ok(!store.table.has('key-3') && !store.table.has('key-5') && !store.table.has('key-6'), 'refused posts leave no row');

    pfm.createError = 'caption too long for TikTok';
    const bad = await call(create({ idempotencyKey: 'key-7' }));
    eq([bad.status, bad.body.ok, bad.body.status, bad.body.error], [200, false, 'failed', 'caption too long for TikTok'], 'Post For Me refusing is a failed row with its reason');
    pfm.createError = '';
    pfm.mode = 'down';
    const down = await call(create({ idempotencyKey: 'key-8' }));
    eq([down.status, down.body.ok], [502, false], 'Post For Me unreachable: the account check fails closed');
    pfm.mode = '';

    // An attempt that reached Post For Me but never got its id back is adopted, never posted twice.
    store.table.set('key-9', { ...store.table.get('key-2'), id: 'key-9', upload_post_id: '', status: 'uploading' });
    pfm.posts.sp_fixture_99 = { id: 'sp_fixture_99', status: 'processing', external_id: 'key-9' };
    const before = pfm.calls.filter((c) => c.method === 'POST' && c.path === '/social-posts').length;
    const adopted = await call(create({ idempotencyKey: 'key-9' }));
    eq([adopted.body.row.upload_post_id, pfm.calls.filter((c) => c.method === 'POST' && c.path === '/social-posts').length], ['sp_fixture_99', before], 'an earlier accepted attempt is adopted');
  }

  // --- 3. List and status: results from Post For Me land on the row; future posts are not asked about.
  {
    const rows = [
      { id: 'due', client: 'Fixture Client A', status: 'processing', upload_post_id: 'sp_due', created_at: '2026-10-07T08:00:00Z', updated_at: '2026-10-07T08:00:00Z', title: 'a' },
      { id: 'bad', client: 'Fixture Client A', status: 'scheduled', scheduled_for: '2026-10-07T10:00:00Z', upload_post_id: 'sp_bad', created_at: '2026-10-06T08:00:00Z', updated_at: '2026-10-06T08:00:00Z', title: 'b' },
      { id: 'future', client: 'Fixture Client A', status: 'scheduled', scheduled_for: '2026-10-09T10:00:00Z', upload_post_id: 'sp_future', created_at: '2026-10-06T08:00:00Z', updated_at: '2026-10-06T08:00:00Z', title: 'c' },
      { id: 'silent', client: 'Fixture Client A', status: 'processing', upload_post_id: 'sp_silent', created_at: '2026-10-07T07:00:00Z', updated_at: '2026-10-07T07:00:00Z', title: 'd' },
    ];
    const { pfm, store, call } = setup({ rows, pfm: { results: {
      sp_due: [{ post_id: 'sp_due', success: true, platform_data: { url: 'https://example.invalid/v/1' } }],
      sp_bad: [{ post_id: 'sp_bad', success: false, error: 'Failed to post to TikTok', details: { error: { message: 'spam_risk' } } }],
    } } });
    const list = await call({ action: 'list' });
    const by = Object.fromEntries(list.body.rows.map((r) => [r.id, r]));
    eq([by.due.status, by.due.tiktok_url], ['posted', 'https://example.invalid/v/1'], 'a posted result lands on the row');
    eq([by.bad.status, by.bad.error], ['failed', 'Failed to post to TikTok: spam_risk'], 'a failure keeps TikTok\'s own reason');
    eq([by.future.status, by.silent.status], ['scheduled', 'processing'], 'no result keeps the row as it is');
    ok(!pfm.calls.some((c) => c.path.includes('sp_future')), 'a future scheduled post is not asked about');
    eq(list.body.rows.map((r) => r.id), ['future', 'bad', 'due', 'silent'], 'newest scheduled-or-sent time first, like the n8n list');
    ok(store.table.get('silent').last_checked_at, 'the asked time is kept so no row starves');

    const st = await call({ action: 'status', id: 'silent' });
    eq([st.status, st.body.pfm], [200, { state: 'none' }], 'status says when there is no result yet');
    pfm.mode = 'results_fail';
    eq((await call({ action: 'status', id: 'silent' })).body.pfm, { state: 'unknown' }, 'a failed lookup is unknown, the row unchanged');
    pfm.mode = '';
    eq((await call({ action: 'status', id: 'nope' })).status, 404, 'unknown id');
  }

  // --- 4. Retry: only a failed post whose request was kept.
  {
    const { pfm, store, call, tick } = setup();
    pfm.createError = 'temporary';
    await call(create({ idempotencyKey: 'r1', scheduledAtUTC: '2026-10-07T12:30:00.000Z' }));
    pfm.createError = '';
    eq(store.table.get('r1').status, 'failed', 'set up a failed post');
    tick(60 * 60000);
    const re = await call({ action: 'retry', id: 'r1' });
    eq([re.body.ok, re.body.row.status, re.body.row.upload_post_id], [true, 'processing', 'sp_fixture_1'], 'a retry whose time has passed posts now');
    ok(!pfm.posts.sp_fixture_1.body.scheduled_at, 'no time in the past is sent');
    eq((await call({ action: 'retry', id: 'r1' })).status, 409, 'a row that is not failed cannot be retried');
    store.table.set('old', { id: 'old', client: 'Fixture Client A', status: 'failed', source: 'sheet', created_at: '2026-09-01T00:00:00Z' });
    const old = await call({ action: 'retry', id: 'old' });
    eq([old.status, old.body.code], [409, 'no_request'], 'a row copied from the Sheet says to upload again');
  }

  // --- 5. The one-time copy of the Sheet tab.
  {
    const { store, call } = setup({ rows: [{ id: 'kept', client: 'Fixture Client A', status: 'posted', title: 'newer in the table', created_at: '2026-10-01T00:00:00Z' }] });
    const header = ['id', 'client', 'profile', 'title', 'post_comment', 'options_json', 'scheduled_for', 'timezone', 'status', 'upload_post_id', 'tiktok_url', 'error', 'posted_at', 'created_at', 'updated_at'];
    const values = [header,
      ['s1', 'Fixture Client A', ACCOUNT, 'one', '', '{"privacy_level":"SELF_ONLY"}', '2026-10-09T10:00:00.000Z', 'UTC', 'scheduled', 'sp_s1', '', '', '', '2026-10-06T10:00:00.000Z', '2026-10-06T10:00:00.000Z'],
      ['s2', 'Fixture Client A', ACCOUNT, 'two', '', 'not json', '', '', 'Canceled', 'sp_s2', '', '', '', 46000, ''],
      ['s3', 'Fixture Client A', '', 'three', '', '', '', '', 'weird', '', '', '', '', '2026-10-01T00:00:00Z', ''],
      ['bad id!', 'Fixture Client A'], ['s4', ''], ['', '', '', ''],
      ['kept', 'Fixture Client A', '', 'older in the Sheet', '', '', '', '', 'scheduled', '', '', '', '', '', ''],
      ['s1', 'Fixture Client A', ACCOUNT, 'one, later copy', '', '', '2026-10-09T10:00:00.000Z', 'UTC', 'posted', 'sp_s1', 'https://example.invalid/v/9', '', '', '2026-10-06T10:00:00.000Z', ''],
    ];
    eq((await call({ action: 'import_sheet' }, 'smm', async () => values)).status, 403, 'only the admin key can copy');
    eq((await call({ action: 'import_sheet' }, 'admin', async () => null)).status, 503, 'no Sheet configured');
    eq((await call({ action: 'import_sheet' }, 'admin', async () => [['x']])).status, 422, 'a tab without the columns is refused');
    const dry = await call({ action: 'import_sheet', dry_run: true }, 'admin', async () => values);
    eq([dry.body.counts.sheet_rows, dry.body.counts.valid, dry.body.counts.skipped_bad_id, dry.body.counts.skipped_no_client, dry.body.counts.unknown_status, dry.body.counts.repeated_id, store.table.size], [7, 4, 1, 1, 1, 1, 1], 'dry run counts and writes nothing');
    const copy = await call({ action: 'import_sheet' }, 'admin', async () => values);
    eq([copy.body.counts.copied, copy.body.counts.already_here], [3, 1], 'three copied, the table row kept');
    eq(store.table.get('kept').title, 'newer in the table', 'a row already in the table is never overwritten');
    eq([store.table.get('s1').status, store.table.get('s1').tiktok_url, store.table.get('s1').source], ['posted', 'https://example.invalid/v/9', 'sheet'], 'the last copy of a repeated id wins');
    eq([store.table.get('s2').status, store.table.get('s2').options_json, store.table.get('s2').created_at], ['cancelled', {}, '2025-12-09T00:00:00.000Z'], 'Canceled, bad JSON and a date serial are read');
    eq([store.table.get('s3').status, /weird/.test(store.table.get('s3').error)], ['failed', true], 'an unknown status is kept visible as failed');
    const again = await call({ action: 'import_sheet' }, 'admin', async () => values);
    eq([again.body.counts.copied, again.body.counts.already_here], [0, 4], 'running the copy again adds nothing');
  }

  // --- 6. Cancel reads the table first, the Sheet only for rows the table does not have.
  {
    const { pfm, store, call } = setup();
    await call(create({ idempotencyKey: 'c1', scheduledAtUTC: '2026-10-08T15:00:00.000Z' }));
    let sheetAsked = 0;
    const sheet = { async find() { sheetAsked++; return null; }, async markCancelled() { throw new Error('must not write the Sheet'); } };
    const out = await C.cancelTiktokUpload({ id: 'c1', pfm, queue: C.firstQueue([cancelQueueOver(store), sheet]), nowIso: '2026-10-07T12:00:00.000Z' });
    eq([out.body.code, store.table.get('c1').status, !!pfm.posts.sp_fixture_1, sheetAsked], ['cancelled', 'cancelled', false, 0], 'a table row is cancelled in Post For Me and in the table only');
    const sheetRow = { row: { id: 'only-sheet', status: 'scheduled', upload_post_id: 'sp_only' } };
    pfm.posts.sp_only = { id: 'sp_only', status: 'scheduled' };
    let sheetWrote = 0;
    const sheet2 = { async find(id) { return id === 'only-sheet' ? sheetRow : null; }, async markCancelled() { sheetWrote++; } };
    const out2 = await C.cancelTiktokUpload({ id: 'only-sheet', pfm, queue: C.firstQueue([cancelQueueOver(store), sheet2]), nowIso: '2026-10-07T12:00:00.000Z' });
    eq([out2.body.code, sheetWrote], ['cancelled', 1], 'a row only in the Sheet is still cancelled there');
    pfm.posts.sp_posted = { id: 'sp_posted', status: 'processed' };
    store.table.set('p1', { id: 'p1', client: 'Fixture Client A', status: 'scheduled', upload_post_id: 'sp_posted' });
    const out3 = await C.cancelTiktokUpload({ id: 'p1', pfm, queue: C.firstQueue([cancelQueueOver(store)]), nowIso: '2026-10-07T12:00:00.000Z' });
    eq([out3.status, out3.body.message, store.table.get('p1').status], [409, 'Already posted, could not cancel.', 'scheduled'], 'already posted leaves the table row');
    const broken = { async find() { throw new Error('sheet_read_failed_500'); } };
    await assert.rejects(() => C.cancelTiktokUpload({ id: 'nowhere', pfm, queue: C.firstQueue([cancelQueueOver(store), broken]), nowIso: '2026-10-07T12:00:00.000Z' }), /sheet_read_failed/);
    checks++;
    // tableQueue against a supabase-like client.
    const calls = [];
    const fakeDb = { from: (t) => { const q = { _t: t, select() { return q; }, eq(k, v) { calls.push([t, k, v]); return q; }, async maybeSingle() { return { data: { id: 'x', status: 'scheduled' }, error: null }; }, update(p) { calls.push(['update', p.status]); return { eq: async () => ({ error: null }) }; } }; return q; } };
    const tq = C.tableQueue(fakeDb);
    const found = await tq.find('x');
    await tq.markCancelled(found, 'T');
    eq(calls, [['tiktok_uploads', 'id', 'x'], ['update', 'cancelled']], 'tableQueue reads and writes tiktok_uploads');
    const missingDb = { from: () => { const q = { select() { return q; }, eq() { return q; }, async maybeSingle() { return { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }; } }; return q; } };
    eq(await C.tableQueue(missingDb).find('x'), null, 'before the migration the table is skipped, so the Sheet still answers');
    const brokenDb = { from: () => { const q = { select() { return q; }, eq() { return q; }, async maybeSingle() { return { data: null, error: { code: '500', message: 'down' } }; } }; return q; } };
    await assert.rejects(() => C.tableQueue(brokenDb).find('x'), /table_read_failed/);
    checks++;
  }

  // --- 7. Static wiring: migration, functions, page, deploy lane.
  {
    const MIG = read('migrations/2026-10-07-tiktok-uploads.sql');
    ok(/^-- NOT APPLIED/m.test(MIG), 'the migration says it is not applied');
    ok(/revoke all on table public\.tiktok_uploads from public, anon, authenticated, service_role;/.test(MIG), 'the revoke names all four roles');
    ok(/grant select, insert, update on table public\.tiktok_uploads to service_role;/.test(MIG), 'service_role gets back only what the functions need');
    ok(/\('tiktok_upload_source', '\{"source":"n8n"\}'::jsonb/.test(MIG) && /on conflict \(key\) do nothing/.test(MIG), 'the switch starts on n8n and never overwrites a live value');
    for (const col of Q.SHEET_COLUMNS) ok(new RegExp('^  ' + col + '\\s', 'm').test(MIG), 'the table has the Sheet column ' + col);
    const H = read('supabase/functions/tiktok-upload/index.ts');
    ok(/authorizeStaffKey\(/.test(H) && /\["admin", "smm", "creative"\]/.test(H), 'staff key required');
    ok(!/10QQ|spc_[A-Za-z0-9]{6}/.test(H + read('supabase/functions/tiktok-upload/handler.mjs') + read('supabase/functions/_shared/tiktok-queue.mjs')), 'no Sheet or account ids in the source');
    const CI = read('supabase/functions/tiktok-upload-cancel/index.ts');
    ok(/firstQueue\(\[tableQueue\(db\), sheet\]\)/.test(CI), 'cancel looks in the table first');
    const SHARED = read('src/index/040-shared-briefs.js.part');
    ok(/TIKTOK_UPLOAD_FN_URL = '[^']*\/functions\/v1\/tiktok-upload'/.test(SHARED) && /TIKTOK_UPLOAD_SOURCE_FLAG_KEY = 'tiktok_upload_source'/.test(SHARED), 'the page knows the function and the switch');
    const PAGE = read('src/index/300-tiktok-upload.js.part');
    ok(/if \(source === 'supabase'\) \{\s*_tkSubmitDirect\(/.test(PAGE), 'on the function every video goes direct to storage');
    const DEPLOY = read('.github/workflows/deploy-single-function.yml');
    ok((DEPLOY.match(/tiktok-upload(?!-)/g) || []).length >= 3, 'tiktok-upload is on the one-function deploy lane (choice, guard, loop)');
  }

  console.log(`tiktok-upload-source: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });

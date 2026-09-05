'use strict';
// Execute the actual TypeScript request handler, auth and projection. Only its
// Supabase transport is substituted with finite fictional tables; no network.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
if (!process.execArgv.includes('--experimental-strip-types')) {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', __filename], { stdio: 'inherit' });
  process.exit(run.status == null ? 1 : run.status);
}
const root = path.resolve(__dirname, '..');
const now = '2026-09-01T12:00:00.000Z';
const target = { id: 'feedback-deliverable', client_slug: 'fixture-feedback', team: 'video', origin: 'calendar', card_id: 'feedback-card' };
const note = (id, extra = {}) => ({ id, author: 'Fixture reviewer', role: 'smm', body: 'Same text', created_at: now, updated_at: now, is_tweak: false, ...extra });
const canonical = (id, extra = {}) => ({ id, deliverable_id: target.id, native_comment_id: id, author_name: 'Fixture reviewer', role: 'smm', body: 'Same text', component: 'video', is_tweak: false, round: null, source_created_at: now, source_updated_at: now, created_at: now, updated_at: now, version: 1, audience: 'internal', ...extra });
let db, reads, handler, hook, failures, auditAllowed;
function reset(notes = [note('source-one')]) {
  reads = []; hook = null; failures = new Set(); auditAllowed = true;
  db = {
    team_members: [{ id: 'reviewer', name: 'Fixture Reviewer', role: 'smm', active: true, team: null }, { id: 'creative', name: 'Fixture Creative', role: 'designer', active: true, team: 'graphics' }],
    deliverables: [structuredClone(target)],
    calendar_posts: [{ id: target.card_id, client: target.client_slug, video_deliverable_id: target.id, video_tweaks: JSON.stringify(notes), tweaks: '' }],
    sample_reviews: [], production_comment_card_links: [], production_comments: [],
    client_access: [{ slug: target.client_slug, review_token: 'fictional-client' }], clients: [{ slug: target.client_slug, active: true }],
  };
}
class Query {
  constructor(table) { this.table = table; this.filters = []; this.cap = Infinity; this.head = false; this.single = false; }
  select(columns, options = {}) { this.columns = columns; this.head = options.head; return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
  order() { return this; }
  limit(value) { this.cap = value; return this; }
  or() { return this; }
  maybeSingle() { this.single = true; return this; }
  insert() { this.inserted = true; return this; }
  then(resolve, reject) {
    try {
      reads.push({ table: this.table, columns: this.columns, inserted: !!this.inserted });
      if (hook) hook(this.table, reads.filter(read => read.table === this.table).length);
      if (failures.has(this.table)) return Promise.resolve({ data: null, error: { message: 'synthetic refusal' } }).then(resolve, reject);
      const rows = structuredClone((db[this.table] || []).filter(row => this.filters.every(fn => fn(row))));
      const data = this.head ? null : this.single ? rows.length === 1 ? rows[0] : null : rows.slice(0, this.cap);
      return Promise.resolve({ data, count: rows.length, error: this.single && rows.length > 1 ? {} : null }).then(resolve, reject);
    } catch (error) { return Promise.reject(error).then(resolve, reject); }
  }
}
globalThis.__feedbackClient = () => ({ from: table => new Query(table), rpc: async name => ({ data: name === 'production_comment_read_authorize'
  ? { ok: true, authorized: auditAllowed } : { ok: true, allowed: true }, error: null }) });
globalThis.Deno = { env: { get: name => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictional-service', ROLE_KEY_SMM: 'fictional-staff', ROLE_KEY_CREATIVE: 'fictional-creative' }[name]) }, serve: fn => { handler = fn; } };
globalThis.fetch = () => { throw new Error('network forbidden'); };
const staff = { 'x-syncview-key': 'fictional-staff', 'x-syncview-actor': 'Fixture Reviewer' };
async function call(extra = {}, headers = staff) {
  const response = await handler(new Request('https://fixture.invalid', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ deliverable_id: target.id, include_feedback: true, ...extra }) }));
  return { status: response.status, body: await response.json() };
}
let count = 0;
async function check(label, run) { reset(); await run(); count++; console.log('  ok  ' + label); }
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-handler-'));
  try {
    const entry = path.join(root, 'supabase/functions/production-comments/index.ts');
    const original = fs.readFileSync(entry, 'utf8');
    const authCopy = path.join(tmp, 'staff-role-auth.mts');
    fs.copyFileSync(path.join(root, 'supabase/functions/_shared/staff-role-auth.ts'), authCopy);
    const source = original.replace(/import \{ createClient, SupabaseClient \} from "npm:[^"]+";/,
      'const createClient = globalThis.__feedbackClient; type SupabaseClient = any;')
      .replace(/from "(\.\.?\/[^\"]+)"/g, (_all, relative) => 'from ' + JSON.stringify(pathToFileURL(
        relative === '../_shared/staff-role-auth.ts' ? authCopy : path.resolve(path.dirname(entry), relative)).href));
    assert.notEqual(source, original);
    const entryCopy = path.join(tmp, 'handler.mts');
    fs.writeFileSync(entryCopy, source);
    await import(pathToFileURL(entryCopy).href);
    const projection = await import(pathToFileURL(path.join(root, 'supabase/functions/production-comments/feedback.mjs')).href);
    const importer = require('../scripts/f42-card-comment-import');
    await check('F42 composite identity matches existing importer exactly', async () => {
      const scope = projection.feedbackScope(target);
      assert.equal(await projection.importedCommentId(scope, 'source-one'), importer.productionId('calendar', target.card_id, 'video', 'source-one'));
    });
    await check('real handler authorizes and exposes exact mapped source as read-only', async () => {
      const r = await call(); assert.equal(r.status, 200); assert.equal(r.body.feedback.complete, true);
      assert.equal(r.body.feedback.rows.length, 1); assert.equal(r.body.feedback.rows[0].can_edit, false);
      assert.equal(r.body.feedback.rows[0].source_only, true); assert(!reads.some(r => r.inserted));
    });
    await check('legacy callers do not gain extra source reads or fields', async () => {
      const r = await call({ include_feedback: false }); assert.equal(r.body.feedback, undefined);
      assert(!reads.some(r => r.table === 'calendar_posts'));
    });
    await check('wrong credential and wrong creative team never read source', async () => {
      assert.equal((await call({}, {})).status, 401);
      assert.equal((await call({}, { 'x-syncview-key': 'fictional-creative', 'x-syncview-actor': 'Fixture Creative' })).status, 403);
      assert(!reads.some(r => r.table === 'calendar_posts'));
    });
    await check('durable allow-audit refusal releases no feedback', async () => {
      auditAllowed = false; assert.equal((await call()).status, 503); assert(!reads.some(r => r.table === 'calendar_posts'));
    });
    await check('exact-client endpoint excludes all source cells and internal canonical comments', async () => {
      db.deliverables[0].origin = 'samples'; db.production_comments = [canonical('internal'), canonical('public', { audience: 'client' })];
      const r = await call({ source_surface: 'sxr', card_id: target.card_id, component: 'video' }, { 'x-syncview-client-token': 'fictional-client' });
      assert.equal(r.status, 200); assert.deepEqual(r.body.comments.map(c => c.id), ['public']); assert.equal(r.body.feedback, undefined);
      assert(!reads.some(r => ['calendar_posts', 'sample_reviews', 'production_comment_card_links'].includes(r.table)));
      assert.equal(r.body.comments[0].resolved_by_name, undefined);
    });
    await check('reciprocal card binding and exact client are mandatory', async () => {
      db.calendar_posts[0].video_deliverable_id = 'other'; assert.equal((await call()).body.feedback.status, 'link_changed');
      db.calendar_posts[0].client = 'other-client'; assert.equal((await call()).body.feedback.rows.length, 0);
    });
    await check('same-client card rebind during read withholds source payload', async () => {
      hook = (table, n) => { if (table === 'calendar_posts' && n === 2) db.calendar_posts[0].video_deliverable_id = 'other'; };
      const r = await call(); assert.equal(r.body.feedback.status, 'link_changed'); assert.deepEqual(r.body.feedback.rows, []);
    });
    await check('deliverable scope change before release refuses whole response', async () => {
      hook = (table, n) => { if (table === 'deliverables' && n === 2) db.deliverables[0].client_slug = 'other-client'; };
      const r = await call(); assert.equal(r.status, 403); assert.equal(r.body.feedback, undefined);
    });
    await check('equal text under different IDs is never deduplicated', async () => {
      reset([note('first'), note('second')]); db.production_comments = [canonical('unrelated')];
      const r = await call(); assert.equal(r.body.feedback.rows.length, 2); assert(r.body.feedback.rows.every(row => !row.covered_by));
    });
    await check('stable identity and full current content prove one canonical copy only', async () => {
      reset([note('one'), note('one')]); db.production_comments = [canonical('one')];
      const r = await call(); assert.equal(r.body.feedback.rows.length, 2); assert.equal(r.body.feedback.rows.filter(row => row.covered_by).length, 1);
      assert.equal(r.body.feedback.rows[0].covered_version, 1); assert.equal(r.body.feedback.rows[0].covered_updated_at, now);
    });
    await check('source edit after canonical import remains visible', async () => {
      db.production_comments = [canonical('source-one', { body: 'Earlier body' })];
      assert.equal((await call()).body.feedback.rows[0].covered_by, undefined);
    });
    await check('proven video aliases preserve maximum multiplicity and different IDs', async () => {
      reset([note('one'), note('one')]); db.calendar_posts[0].tweaks = JSON.stringify([note('one'), note('two')]);
      assert.equal((await call()).body.feedback.rows.length, 3);
    });
    await check('malformed alias, missing identity and hidden rows cannot yield complete', async () => {
      reset([note(''), note('hidden', { hidden: true, body: 'suppressed' })]); db.calendar_posts[0].tweaks = 'unparseable';
      const r = await call(); assert.equal(r.body.feedback.complete, false); assert.equal(r.body.feedback.rows.length, 1);
      assert(!JSON.stringify(r.body).includes('suppressed'));
    });
    await check('missing tweak metadata remains unknown and plain notes remain plain', async () => {
      reset([note('plain'), note('unknown', { is_tweak: undefined })]);
      const r = await call(); assert.equal(r.body.feedback.rows[0].is_tweak, false); assert.equal(r.body.feedback.rows[1].is_tweak, null);
    });
    await check('failed source read preserves canonical response with incomplete status', async () => {
      failures.add('calendar_posts'); db.production_comments = [canonical('retained')];
      const r = await call(); assert.equal(r.body.comments.length, 1); assert.equal(r.body.feedback.status, 'source_unavailable');
    });
    await check('malformed same-scope source permits stale retention, observed suppression never does', async () => {
      db.calendar_posts[0].tweaks = 'malformed'; assert.equal((await call()).body.feedback.retain_previous, true);
      db.calendar_posts[0].video_tweaks = JSON.stringify([note('hidden', { hidden: 'true' })]);
      const hidden = (await call()).body.feedback; assert.equal(hidden.retain_previous, false); assert.equal(hidden.rows.length, 0);
      db.calendar_posts[0].video_tweaks = JSON.stringify([note('deleted', { deleted: true })]);
      assert.equal((await call()).body.feedback.retain_previous, false);
    });
    await check('source change during read withholds prior-content retention', async () => {
      hook = (table, n) => { if (table === 'calendar_posts' && n === 2) db.calendar_posts[0].video_tweaks = 'changed'; };
      const r = await call(); assert.equal(r.body.feedback.status, 'source_changed'); assert.equal(r.body.feedback.retain_previous, undefined);
    });
    await check('size refusal marks incomplete and permits only an already-scoped stale snapshot', async () => {
      db.calendar_posts[0].video_tweaks = 'x'.repeat(1024 * 1024);
      const r = await call(); assert.equal(r.body.feedback.status, 'source_limit'); assert.equal(r.body.feedback.retain_previous, true);
      assert.equal(r.body.feedback.rows.length, 0);
    });
    await check('source and identity query limits cannot establish completeness', async () => {
      reset(Array.from({ length: 501 }, (_, i) => note('note-' + i))); const r = await call();
      assert.equal(r.body.feedback.rows.length, 500); assert.equal(r.body.feedback.complete, false);
    });
    await check('replies retain deleted parent identity and erase deleted body', async () => {
      reset([note('parent', { deleted: true, body: 'erased secret' }), note('reply', { parent_id: 'parent' }), note('orphan', { parent_id: 'absent' })]);
      const rows = (await call()).body.feedback.rows;
      assert.equal(rows[0].body, ''); assert.equal(rows[1].parent_id, rows[0].id); assert.equal(rows[2].parent_unavailable, true);
    });
    await check('graphics Samples source uses only exact graphic fields', async () => {
      db.deliverables[0] = { ...target, team: 'graphics', origin: 'samples' };
      db.sample_reviews = [{ id: target.card_id, client: target.client_slug, graphic_deliverable_id: target.id,
        graphic_tweaks: JSON.stringify([note('graphic')]), video_tweaks: JSON.stringify([note('video', { body: 'wrong component' })]) }];
      const r = await call(); assert.equal(r.body.feedback.rows[0].component, 'graphic'); assert(!JSON.stringify(r.body).includes('wrong component'));
      assert(!reads.some(r => r.table === 'calendar_posts'));
    });
    await check('pagination retains canonical cursor and all unrepresented source notes', async () => {
      db.production_comments = [canonical('one'), canonical('two')]; const r = await call({ limit: 1 });
      assert.equal(r.body.has_more, true); assert(r.body.next_cursor); assert.equal(r.body.feedback.rows.length, 1);
    });
    console.log(`Component feedback actual-handler checks: ${count} PASS; no live transport.`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

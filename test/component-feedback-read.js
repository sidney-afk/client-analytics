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
// Historical tweak entries commonly omit the redundant `is_tweak` flag, so the
// fixture omits it too. The canonical twin carries `is_tweak: true` because
// that is what the F42 importer WRITES for anything it read out of a `*_tweaks`
// cell — a canonical row imported from `video_tweaks` cannot be `false`.
const note = (id, extra = {}) => ({ id, author: 'Fixture reviewer', role: 'smm', body: 'Same text', created_at: now, updated_at: now, ...extra });
// The flag fields whose predicate diverges from the importer.
const FLAG_FIELDS = ['done', 'resolved', 'deleted', 'is_deleted'];
// The candidate pool is GENERATED from the predicate's declared vocabulary, not
// hand-written. Two earlier versions of this were a fixed list and then a scrape
// of the source literals; both were samples wearing the word "exact", and a
// token added to `truthy` would have been silently untested by either. Here the
// vocabulary is read out of the shipped expression — every `value === <literal>`
// comparison and every member of its token list — and each string token is
// expanded into the normalisation forms the predicate's own `clean(...)
// .toLowerCase()` makes equivalent. Every generated form is then VERIFIED
// against the executed predicate below, so if the normalisation ever changes the
// generation is caught rather than quietly diverging.
// Full enumeration of an arbitrary predicate's input space is impossible; what
// is achievable, and what this does, is enumerate the declared vocabulary,
// generate its normalisation forms, and prove by execution that the generation
// still matches the predicate.
const label = value => value === undefined ? 'undefined' : JSON.stringify(value);
const TRUTHY_VOCABULARY = (() => {
  const helper = fs.readFileSync(path.join(root, 'supabase/functions/production-comments/feedback.mjs'), 'utf8')
    .match(/^const truthy = (.*);$/m);
  if (!helper) throw new Error('missing truthy helper');
  const compared = [...helper[1].matchAll(/value === (true|false|-?\d+|'[^']*')/g)]
    .map(match => match[1]).map(raw => raw === 'true' ? true : raw === 'false' ? false
      : raw.startsWith("'") ? raw.slice(1, -1) : Number(raw));
  const listed = (helper[1].match(/\[([^\]]*)\]/) || [, ''])[1]
    .split(',').map(part => part.trim().replace(/^'|'$/g, '')).filter(Boolean);
  return [...new Set([...compared, ...listed])];
})();
// Normalisation forms of one token: case permutations plus the whitespace
// `clean` strips. Non-strings pass through unchanged.
const normalisationForms = token => typeof token !== 'string' ? [token] : [...new Set([
  token, token.toUpperCase(), token.toLowerCase(),
  token.charAt(0).toUpperCase() + token.slice(1).toLowerCase(),
  token.split('').map((ch, i) => i % 2 ? ch.toUpperCase() : ch.toLowerCase()).join(''),
  ' ' + token + ' ', '\t' + token + '\n', '  ' + token.toUpperCase() + '  ',
])];
const FLAG_CANDIDATES = [
  ...TRUTHY_VOCABULARY.flatMap(normalisationForms),
  // Values the predicate must NOT accept, so the exception is proven confined to
  // the accepting branch rather than to flag fields in general.
  false, 0, '0', 'false', 'no', 'off', '', '   ', null, undefined,
];
const canonical = (id, extra = {}) => ({ id, deliverable_id: target.id, native_comment_id: id, author_name: 'Fixture reviewer', role: 'smm', body: 'Same text', component: 'video', is_tweak: true, round: null, source_created_at: now, source_updated_at: now, created_at: now, updated_at: now, version: 1, audience: 'internal', ...extra });
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
    await check('the source field carries tweak provenance exactly as the F42 importer reads it', async () => {
      // This check previously asserted that a flagless entry projects `null`,
      // which described the DEFECT rather than production: the importer records
      // an entry read out of a `*_tweaks` cell as a tweak whether or not the
      // historical row repeated the flag, so `sameCurrentComment`'s strict
      // equality could never meet the imported canonical `true` and an exact
      // imported comment kept a PERMANENT duplicate in Feedback & tweaks.
      reset([note('flagless'), note('flagged-false', { is_tweak: false })]);
      db.calendar_posts[0].tweaks = JSON.stringify([note('shared')]);
      const rows = (await call()).body.feedback.rows;
      assert.equal(rows[0].is_tweak, true, 'a flagless video_tweaks entry is a tweak');
      assert.equal(rows[1].is_tweak, true, 'and the durable source field outranks a stale explicit false, as the importer does');
      assert.equal(rows[2].is_tweak, null, 'the shared `tweaks` cell is outside the importer\'s vocabulary, so it stays unknown');
    });
    await check('the projection derives is_tweak by executing the same rule the importer writes', async () => {
      // Not a restatement of the rule: both REAL functions run and their
      // answers are compared, so the two cannot drift apart again.
      const importScope = { productionId: 'pc-fixture', deliverableId: target.id, surface: 'calendar',
        cardId: target.card_id, component: 'video', team: 'video', importRunId: 'fixture-run', resolvedAudience: 'internal' };
      for (const flag of [true, false, undefined]) {
        reset([note('parity', { is_tweak: flag })]);
        const projected = (await call()).body.feedback.rows[0].is_tweak;
        const imported = importer.normalizeComment({ ...note('parity', { is_tweak: flag }), _source_field: 'video_tweaks' }, importScope, null).is_tweak;
        assert.equal(projected, imported, 'video_tweaks with is_tweak=' + String(flag));
      }
      reset([]);
      db.deliverables[0] = { ...target, team: 'graphics' };
      db.calendar_posts[0] = { id: target.card_id, client: target.client_slug,
        graphic_deliverable_id: target.id, graphic_tweaks: JSON.stringify([note('parity')]) };
      const projected = (await call()).body.feedback.rows[0].is_tweak;
      const imported = importer.normalizeComment({ ...note('parity'), _source_field: 'graphic_tweaks' },
        { ...importScope, component: 'graphic', team: 'graphics' }, null).is_tweak;
      assert.equal(projected, imported, 'graphic_tweaks with no flag');
    });
    await check('the projection derives source_created_at by executing the same rule the importer writes', async () => {
      // Second member of the same family as the is_tweak parity check above: a
      // historical entry carrying only `updated_at` is accepted by the importer,
      // which writes that value as source_created_at. Projecting `null` instead
      // made sameCurrentComment's strict equality on that field unmeetable, so
      // the note stayed visible twice forever. Both REAL functions run and their
      // answers are compared, so they cannot drift apart again.
      // The planner resolves a ROOT's audience with the importer's own exported
      // rule before handing it to normalizeComment. Hard-coding 'internal' here
      // made the fixture disagree with production for a client-role root, which
      // then looked like a divergence in the projection rather than in the
      // fixture. Use the real rule.
      const importScope = raw => ({ productionId: 'pc-fixture', deliverableId: target.id, surface: 'calendar',
        cardId: target.card_id, component: 'video', team: 'video', importRunId: 'fixture-run',
        resolvedAudience: importer.ownAudience(raw) });
      const bare = { id: 'stamped', author: 'Fixture reviewer', role: 'smm', body: 'Same text' };
      const shapes = [
        { label: 'updated_at only', raw: { ...bare, updated_at: now } },
        { label: 'created_at and updated_at', raw: note('stamped') },
        { label: 'ts only', raw: { ...bare, ts: now } },
      ];
      for (const shape of shapes) {
        reset([shape.raw]);
        const projected = (await call()).body.feedback.rows[0].source_created_at;
        const imported = importer.normalizeComment({ ...shape.raw, _source_field: 'video_tweaks' }, importScope(shape.raw), null).source_created_at;
        assert.equal(projected, imported, 'video_tweaks with ' + shape.label);
      }
      // Where the projection deliberately STOPS mirroring the importer, and why.
      // For an entry with no timestamp anywhere the importer writes the epoch
      // (`new Date(0).toISOString()`). Copying that here would print a 1970 date
      // beside a tweak note in the Workload popover — inventing a fact rather
      // than reporting one, which is the failure this lane exists to prevent.
      // The cost is that such a row cannot be covered and shows twice; a visible
      // duplicate is the mild failure, and a note wrongly HIDDEN by a loosened
      // identity match is the one nobody can report. Left deliberately.
      reset([bare]);
      const projected = (await call()).body.feedback.rows[0].source_created_at;
      const imported = importer.normalizeComment({ ...bare, _source_field: 'video_tweaks' }, importScope(bare), null).source_created_at;
      assert.equal(projected, null, 'an entry with no timestamp projects an honest absence');
      assert.equal(imported, new Date(0).toISOString(), 'even though the importer defaults it to the epoch');
    });
    await check('the projection mirrors the importer\'s own-audience rule, executed on both sides', async () => {
      // feedback.mjs cannot import a Node script, so it carries a mirror of
      // ownAudience. A hand-written mirror is exactly what the last four rounds
      // of findings were about, so it is verified against the importer's real
      // EXPORTED rule rather than trusted.
      const helper = fs.readFileSync(path.join(root, 'supabase/functions/production-comments/feedback.mjs'), 'utf8')
        .match(/^const ownAudience = ([\s\S]*?);$/m);
      assert(helper, 'the projection must declare a readable ownAudience mirror');
      const policy = await import(pathToFileURL(path.join(root, 'supabase/functions/production-comments/policy.mjs')).href);
      const mirrored = new Function('clean', 'return (' + helper[1] + ');')(policy.clean);
      const shapes = [
        {}, { audience: 'client' }, { audience: 'CLIENT' }, { audience: ' client ' }, { audience: 'internal' },
        { audience: 'anything' }, { role: 'client' }, { role: 'CLIENT' }, { role: 'smm' }, { role: 'designer' },
        { audience: 'internal', role: 'client' }, { audience: 'client', role: 'smm' }, { role: '' }, { audience: null },
      ];
      for (const raw of shapes) {
        assert.equal(mirrored(raw), importer.ownAudience(raw),
          'own-audience mirror disagrees for ' + JSON.stringify(raw));
      }
    });
    await check('a reply is matched on the audience it INHERITS, and the card label still reports the card', async () => {
      // The planner makes a reply inherit its thread root's audience — "a reply
      // never sets its own client visibility" — so the canonical twin of a
      // client-marked reply under an internal root carries `internal`. Matching
      // on the reply's row-local value could never meet it, and the reply
      // duplicated forever. The EMITTED source_audience stays row-local on
      // purpose: the panel renders it as "Card: client-visible" / "Card:
      // internal", a label about what the card recorded.
      const rootRaw = { id: 'root', author: 'Fixture reviewer', role: 'smm', body: 'Same text',
        created_at: now, updated_at: now, audience: 'internal' };
      const replyRaw = { id: 'reply', parent_id: 'root', author: 'Fixture reviewer', role: 'smm',
        body: 'Same text', created_at: now, updated_at: now, audience: 'client' };
      reset([rootRaw, replyRaw]);
      const scope = { productionId: 'pc-fixture', deliverableId: target.id, surface: 'calendar',
        cardId: target.card_id, component: 'video', team: 'video', importRunId: 'fixture-run' };
      const importedRoot = importer.normalizeComment({ ...rootRaw, _source_field: 'video_tweaks' },
        { ...scope, resolvedAudience: importer.ownAudience(rootRaw) }, null);
      // What the planner does for a reply: inherit the ROOT's audience.
      const importedReply = importer.normalizeComment({ ...replyRaw, _source_field: 'video_tweaks' },
        { ...scope, resolvedAudience: importer.ownAudience(rootRaw) }, 'root');
      assert.equal(importedReply.audience, 'internal', 'the importer writes the inherited audience');
      const canonicalFrom = (raw, imported, extra) => ({ ...canonical(raw.id),
        author_name: imported.author_name, role: imported.role, body: imported.body,
        audience: imported.audience, is_tweak: imported.is_tweak, round: imported.round,
        source_created_at: imported.source_created_at, source_updated_at: imported.source_updated_at,
        edited_at: imported.edited_at, deleted_at: imported.deleted_at,
        resolved_at: imported.resolved_at, resolved_by_name: imported.resolved_by_name, ...extra });
      db.production_comments = [
        canonicalFrom(rootRaw, importedRoot),
        canonicalFrom(replyRaw, importedReply, { parent_id: 'root' }),
      ];
      const rows = (await call()).body.feedback.rows;
      // The response does not carry native_id, so the reply is identified by the
      // card-local audience it kept — which is itself half the assertion.
      const reply = rows.find(row => row.source_audience === 'client');
      assert(reply, 'the reply is projected, still labelled with what the CARD recorded');
      assert.equal(reply.covered_by, 'reply',
        'a client-marked reply under an internal root is covered by its imported twin instead of duplicating');
      const rootRow = rows.find(row => row.source_audience === 'internal');
      assert.equal(rootRow && rootRow.covered_by, 'root', 'and the root is still covered by its own twin');
    });
    await check('PARITY MATRIX: every shape the importer accepts is covered, not duplicated', async () => {
      // Three divergences between this projection and the F42 importer have now
      // been found ONE AT A TIME by review — is_tweak, source_created_at,
      // resolved_at — each with the same consequence: `sameCurrentComment`
      // compares the field strictly, the values disagree, coverage becomes
      // impossible and the note duplicates forever. Finding the fourth the same
      // way would be a process failure, so this drives BOTH real functions over
      // a matrix of the raw shapes historical cards actually contain and asserts
      // the projection is covered by exactly what the importer would have
      // written. A new divergence fails here instead of in a review round.
      const importScope = raw => ({ productionId: 'pc-fixture', deliverableId: target.id, surface: 'calendar',
        cardId: target.card_id, component: 'video', team: 'video', importRunId: 'fixture-run',
        resolvedAudience: importer.ownAudience(raw) });
      const base = { id: 'shape', body: 'Same text' };
      const shapes = [
        { label: 'author and role present', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, updated_at: now } },
        { label: 'no author at all', raw: { ...base, role: 'smm', created_at: now } },
        { label: 'no author and no role', raw: { ...base, created_at: now } },
        { label: 'client role, no author', raw: { ...base, role: 'client', created_at: now } },
        { label: 'upper-case role', raw: { ...base, author: 'Fixture reviewer', role: 'SMM', created_at: now } },
        { label: 'updated_at only', raw: { ...base, author: 'Fixture reviewer', role: 'smm', updated_at: now } },
        { label: 'ts only', raw: { ...base, author: 'Fixture reviewer', role: 'smm', ts: now } },
        { label: 'done with no done_at', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, updated_at: now, done: true } },
        { label: 'resolved with no resolved_at', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, updated_at: now, resolved: true } },
        { label: 'done with done_at', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, updated_at: now, done: true, done_at: now } },
        { label: 'done with resolver name', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, updated_at: now, done: true, done_by: 'Fixture Reviewer' } },
        // The importer picks `done_at || sourceUpdatedAt` whenever either
        // boolean is true and never consults `resolved_at` on that branch, so a
        // row carrying BOTH is the shape most likely to disagree. It was missing
        // from the first version of this matrix, which is exactly the kind of
        // gap the matrix exists to prevent.
        { label: 'done true with a differing explicit resolved_at', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, updated_at: now, done: true, resolved_at: '2026-08-11T09:00:00.000Z' } },
        { label: 'resolved true with a differing explicit resolved_at', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, updated_at: now, resolved: true, resolved_at: '2026-08-11T09:00:00.000Z' } },
        { label: 'done true with both done_at and resolved_at', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, updated_at: now, done: true, done_at: now, resolved_at: '2026-08-11T09:00:00.000Z' } },
        { label: 'resolved_at alone, no boolean', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, updated_at: now, resolved_at: '2026-08-11T09:00:00.000Z' } },
        { label: 'both done_by and resolved_by_name', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, updated_at: now, done: true, done_by: 'Fixture Reviewer', resolved_by_name: 'Someone Else' } },
        // Every candidate value against every flag it governs. The ACCEPTED ones
        // are the deliberate divergences; the rejected ones must still be
        // covered, which is what proves the exception is confined to the
        // accepting branch rather than to flag fields in general.
        ...FLAG_FIELDS.flatMap(field => FLAG_CANDIDATES.map(value => ({
          label: 'truthy ' + field + ' = ' + label(value),
          raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, updated_at: now, [field]: value },
        }))),
        { label: 'author_name rather than author', raw: { ...base, author_name: 'Fixture reviewer', role: 'smm', created_at: now } },
        { label: 'deleted', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, updated_at: now, deleted: true } },
        { label: 'is_deleted', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, updated_at: now, is_deleted: true } },
        { label: 'numeric-string round', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, round: '2' } },
        { label: 'zero round', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, round: 0 } },
        { label: 'edited', raw: { ...base, author: 'Fixture reviewer', role: 'smm', created_at: now, edited_at: now } },
      ];
      // One family diverges DELIBERATELY, and the matrix decides its membership
      // by RUNNING the shipped predicate rather than reading it. The importer
      // treats only a literal `true` as deleted/resolved (`raw.done === true`);
      // this projection uses `truthy`, which also normalises its input, so
      // " TRUE " and "Yes" are accepted as well as 1, "1", "true" and "yes".
      // Every accepted-but-not-literal-true value is suppressed here and was
      // imported as unresolved/undeleted. Mirroring the importer would mean
      // making the projection strict — and the identical predicate governs
      // `deleted`, so it would start SHOWING the body of a note the card marked
      // deleted. That trades a duplicate for exposed content, the one direction
      // this lane never goes. The duplicate is accepted; the suppression kept.
      const policy = await import(pathToFileURL(path.join(root, 'supabase/functions/production-comments/policy.mjs')).href);
      const helperSource = fs.readFileSync(path.join(root, 'supabase/functions/production-comments/feedback.mjs'), 'utf8')
        .match(/^const truthy = (.*);$/m);
      assert(helperSource, 'the truthy helper must be readable so this matrix can execute it');
      const truthy = new Function('clean', 'return (' + helperSource[1] + ');')(policy.clean);
      // The generation is only trustworthy if the predicate still agrees with
      // it: every normalisation form of a declared token must actually be
      // accepted. If `truthy` stops trimming or lower-casing, this fires here
      // rather than leaving the family quietly under-generated.
      for (const token of TRUTHY_VOCABULARY) {
        for (const form of normalisationForms(token)) {
          assert(truthy(form), 'the predicate no longer accepts ' + label(form)
            + ', so the generated normalisation forms no longer match it');
        }
      }
      // Accepted by the projection, rejected by the importer's literal `true`.
      const divergentValues = FLAG_CANDIDATES.filter(value => truthy(value) && value !== true);
      assert(divergentValues.length >= TRUTHY_VOCABULARY.length,
        'the candidate pool must exercise the accepting branch for every declared token');
      assert(FLAG_CANDIDATES.some(value => !truthy(value)),
        'and the rejecting branch too, so a benign value is proven to stay covered');
      const deliberate = FLAG_FIELDS.flatMap(field =>
        divergentValues.map(value => 'truthy ' + field + ' = ' + label(value)));
      const divergent = [];
      for (const shape of shapes) {
        const imported = importer.normalizeComment({ ...shape.raw, _source_field: 'video_tweaks' }, importScope(shape.raw), null);
        reset([shape.raw]);
        db.production_comments = [{ ...canonical(shape.raw.id),
          author_name: imported.author_name, role: imported.role, body: imported.body,
          audience: imported.audience, is_tweak: imported.is_tweak, round: imported.round,
          source_created_at: imported.source_created_at, source_updated_at: imported.source_updated_at,
          edited_at: imported.edited_at, deleted_at: imported.deleted_at,
          resolved_at: imported.resolved_at, resolved_by_name: imported.resolved_by_name }];
        const row = (await call()).body.feedback.rows[0];
        if (!row || row.covered_by !== shape.raw.id) divergent.push(shape.label);
      }
      assert.deepEqual(divergent, deliberate,
        'divergence set changed. Unexpectedly divergent shapes duplicate forever; a shape that '
        + 'disappeared from the deliberate list should be removed from it. Got: ' + divergent.join('; '));
    });
    await check('an imported note carrying only updated_at is covered instead of duplicating forever', async () => {
      // The end the reader actually sees: without the fallback this row can
      // never be covered, so the same feedback shows twice and can displace a
      // source-only tweak from the popover's three-row preview.
      reset([{ id: 'stamped', author: 'Fixture reviewer', role: 'smm', body: 'Same text', updated_at: now }]);
      db.production_comments = [canonical('stamped')];
      const rows = (await call()).body.feedback.rows;
      assert.equal(rows[0].covered_by, 'stamped');
      assert.equal(rows[0].covered_version, 1);
    });
    await check('an imported note that omitted is_tweak is covered instead of duplicating forever', async () => {
      reset([note('imported')]);
      db.production_comments = [canonical('imported')];
      const rows = (await call()).body.feedback.rows;
      assert.equal(rows[0].covered_by, 'imported');
      assert.equal(rows[0].covered_version, 1);
    });
    await check('unknown tweak metadata never blocks an exact identity match, and a known one still must agree', async () => {
      // The shared `tweaks` cell projects `null`. Unknown metadata is
      // non-disqualifying here exactly as unknown role and unknown audience
      // already are; a value that IS known still has to match.
      reset([]);
      db.calendar_posts[0].video_tweaks = '[]';
      db.calendar_posts[0].tweaks = JSON.stringify([note('shared')]);
      db.production_comments = [canonical('shared')];
      assert.equal((await call()).body.feedback.rows[0].covered_by, 'shared');

      reset([note('flagless')]);
      db.production_comments = [canonical('flagless', { is_tweak: false })];
      assert.equal((await call()).body.feedback.rows[0].covered_by, undefined,
        'a canonical row that disagrees on a KNOWN tweak flag still covers nothing');
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
    await check('hidden stable identity suppresses stale alias in either direction without suppressing unrelated IDs', async () => {
      for (const reversed of [false, true]) {
        reset([note('retired', { hidden: true, body: 'ALIAS HIDDEN CANARY' }), note('unrelated')]);
        db.calendar_posts[0].tweaks = JSON.stringify([note('retired', { body: 'ALIAS HIDDEN CANARY' }), note('other')]);
        if (reversed) [db.calendar_posts[0].video_tweaks, db.calendar_posts[0].tweaks] = [db.calendar_posts[0].tweaks, db.calendar_posts[0].video_tweaks];
        const r = await call(); assert(!JSON.stringify(r.body).includes('ALIAS HIDDEN CANARY'));
        assert.equal(r.body.feedback.rows.length, 2); assert.equal(r.body.feedback.retain_previous, false);
      }
    });
    await check('deleted stable identity suppresses stale alias body but retains tombstone and replies', async () => {
      reset([note('retired', { deleted: true, body: 'ALIAS DELETED CANARY' }), note('reply', { parent_id: 'retired' })]);
      db.calendar_posts[0].tweaks = JSON.stringify([note('retired', { body: 'ALIAS DELETED CANARY' }), note('unrelated')]);
      const r = await call(); assert(!JSON.stringify(r.body).includes('ALIAS DELETED CANARY'));
      assert.equal(r.body.feedback.rows.filter(row => row.deleted).length, 1);
      assert.equal(r.body.feedback.rows.length, 3); assert.equal(r.body.feedback.retain_previous, false);
    });
    await check('suppression beyond projected row cap still suppresses an earlier alias', async () => {
      reset([note('retired', { body: 'LATE HIDDEN CANARY' })]);
      db.calendar_posts[0].tweaks = JSON.stringify([...Array.from({ length: 500 }, (_, i) => note('other-' + i)), note('retired', { hidden: true })]);
      const r = await call(); assert(!JSON.stringify(r.body).includes('LATE HIDDEN CANARY'));
      assert.equal(r.body.feedback.complete, false); assert.equal(r.body.feedback.retain_previous, false);
    });
    await check('the size refusal revalidates the binding before authorising retention', async () => {
      // `retain_previous` tells the reader to KEEP what it is already showing,
      // so it may only be granted on a binding this response revalidated. This
      // path used to return on the first read alone, so a card detached after
      // that read still authorised retention of its notes — and the Workload
      // popover's read cache was resting on a guarantee this branch did not make.
      db.calendar_posts[0].video_tweaks = 'x'.repeat(1024 * 1024);
      hook = (table, n) => { if (table === 'calendar_posts' && n === 2) db.calendar_posts[0].video_deliverable_id = 'other'; };
      const detached = (await call()).body.feedback;
      assert.equal(detached.status, 'link_changed', 'a card detached mid-read refuses instead of permitting retention');
      assert.equal(detached.retain_previous, undefined, 'and never authorises keeping the detached card notes');
      // The hook's mutation is durable, so the binding is restored explicitly
      // before proving the intact case still behaves.
      hook = null;
      db.calendar_posts[0].video_deliverable_id = target.id;
      const intact = (await call()).body.feedback;
      assert.equal(intact.status, 'source_limit', 'an intact binding still gets the size refusal');
      assert.equal(intact.retain_previous, true, 'with retention still permitted');
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
    await check('video Samples source projects its notes instead of failing the whole read', async () => {
      // D3 regression. `tweaks` is a calendar_posts column; sample_reviews has
      // only video_tweaks/graphic_tweaks. Selecting it here errored the read and
      // surfaced as `source_unavailable`, which the panel words like a transient
      // failure — so the Samples video path looked flaky rather than broken.
      reset();
      db.deliverables[0] = { ...target, team: 'video', origin: 'samples' };
      db.sample_reviews = [{ id: target.card_id, client: target.client_slug, video_deliverable_id: target.id,
        video_tweaks: JSON.stringify([note('sxr-video')]), graphic_tweaks: JSON.stringify([note('graphic', { body: 'wrong component' })]) }];
      const r = await call();
      assert.equal(r.body.feedback.status, 'complete');
      assert.equal(r.body.feedback.complete, true);
      assert.equal(r.body.feedback.rows.length, 1);
      assert.equal(r.body.feedback.rows[0].component, 'video');
      assert(!JSON.stringify(r.body).includes('wrong component'));
      assert(!reads.some(read => read.table === 'calendar_posts'));
    });
    await check('every column the handler selects exists in the live schema baseline', async () => {
      // The finite mock returns whatever key it is asked for, so it cannot fail
      // on a column Postgres does not have. Pair the projection with the real
      // schema: this is the assertion that would have caught D3. The column set
      // is the baseline create block plus every later `add column`, because
      // these two tables are still being extended by migration.
      const dir = path.join(root, 'migrations');
      const sql = fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort()
        .map(name => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');
      const columnsOf = table => {
        const columns = new Set();
        const start = sql.indexOf('create table if not exists public.' + table + ' (');
        assert(start > -1, 'baseline is missing ' + table);
        const body = sql.slice(sql.indexOf('(', start) + 1, sql.indexOf('\n);', start));
        for (const line of body.split('\n')) {
          const name = line.trim().split(/\s+/)[0].replace(/,$/, '');
          if (name) columns.add(name);
        }
        // `alter table public.<t>` runs until the next statement terminator.
        const alter = new RegExp('alter\\s+table\\s+(?:if\\s+exists\\s+)?public\\.' + table + '\\b([\\s\\S]*?);', 'gi');
        for (const match of sql.matchAll(alter)) {
          for (const add of match[1].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi)) columns.add(add[1]);
        }
        return columns;
      };
      const known = { calendar_posts: columnsOf('calendar_posts'), sample_reviews: columnsOf('sample_reviews') };
      assert(known.calendar_posts.has('tweaks'), 'calendar_posts should still carry the shared tweaks cell');
      assert(!known.sample_reviews.has('tweaks'), 'sample_reviews must not gain a tweaks cell without this guard being revisited');
      assert(known.sample_reviews.has('video_tweaks') && known.sample_reviews.has('graphic_tweaks'),
        'the parser must see the sample_reviews component cells, or this guard proves nothing');

      const seen = [];
      for (const [origin, team, table] of [['calendar', 'video', 'calendar_posts'], ['calendar', 'graphics', 'calendar_posts'],
        ['samples', 'video', 'sample_reviews'], ['samples', 'graphics', 'sample_reviews']]) {
        reset();
        const component = team === 'graphics' ? 'graphic' : 'video';
        db.deliverables[0] = { ...target, team, origin };
        const card = { id: target.card_id, client: target.client_slug, [component + '_deliverable_id']: target.id };
        if (origin === 'calendar') db.calendar_posts = [card]; else { db.calendar_posts = []; db.sample_reviews = [card]; }
        await call();
        const read = reads.find(entry => entry.table === table && typeof entry.columns === 'string');
        assert(read, 'expected a ' + table + ' read for ' + origin + '/' + team);
        for (const column of read.columns.split(',').map(value => value.trim()).filter(Boolean)) {
          assert(known[table].has(column), table + ' has no column `' + column + '` (selected for ' + origin + '/' + team + ')');
        }
        seen.push(origin + '/' + team);
      }
      assert.equal(seen.length, 4);
    });
    console.log(`Component feedback actual-handler checks: ${count} PASS; no live transport.`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

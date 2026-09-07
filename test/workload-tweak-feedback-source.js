'use strict';
// The Workload "Tweaks Needed" popover had no automated coverage anywhere in
// the repo before this file. It is the surface an editor reads to find out what
// a client asked to be changed, and after the Linear exit it is a Supabase
// reader rather than an n8n/Linear one. These checks execute the REAL functions
// lifted out of index.html — no reimplementation — against a mocked transport.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0, count = 0;
function ok(value, label) {
  if (value) { count++; console.log('  ok  ' + label); }
  else { failures++; console.error('FAIL  ' + label); }
}

// Same comment-aware brace walk the sibling suites use, but anchored on the
// `async` keyword so the extracted text stays awaitable.
function extract(name) {
  let start = source.indexOf('async function ' + name);
  if (start < 0) start = source.indexOf('function ' + name);
  if (start < 0) throw new Error('missing ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (!quote && ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (!quote && ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) return source.slice(start, i + 1); }
  }
  throw new Error('unclosed ' + name);
}

// The Workload block cannot see `PROD_COMMENTS_PAGE_SIZE` — that constant is
// declared inside a nested function scope thousands of lines away. So the block
// declares its own, and the sandbox executes the REAL declaration rather than
// being handed a fixture value: supplying one is exactly how a scope bug hid
// here once already.
function pageSizeDeclaration() {
  const match = source.match(/^ *const WL_TWEAK_FEEDBACK_PAGE_SIZE = \d+;$/m);
  if (!match) throw new Error('missing WL_TWEAK_FEEDBACK_PAGE_SIZE declaration');
  return match[0].trim();
}

const NATIVE_ID = 'del_fixture_one';
const now = '2026-09-01T12:00:00.000Z';
const canonical = (id, extra = {}) => ({ id, author_name: 'Fixture reviewer', body: 'canonical ' + id,
  source_created_at: now, created_at: now, ...extra });
const cardNote = (id, extra = {}) => ({ id: 'source:' + id, author_name: 'Fixture client', body: 'card ' + id,
  source_created_at: now, created_at: now, source_only: true, ...extra });

// One sandbox per scenario: the real functions, everything they reach stubbed.
function build(options = {}) {
  const calls = [];
  const issue = { id: 'wl-1', nativeId: NATIVE_ID, workloadSource: options.workloadSource ?? 'native' };
  const snapshot = options.snapshot === undefined ? [issue] : options.snapshot;
  let identity = options.owner === undefined ? 'staff-fixture' : options.owner;
  const pages = options.pages || [];
  let pageIndex = 0;
  const context = {
    console,
    JSON, Math, Date, Map, Set, Number, Array, Object, String, Error, Promise,
    AbortController, setTimeout, clearTimeout,
    CAL_SUPABASE_URL: 'https://fixture.invalid',
    WL_PLAN_READ_TIMEOUT_MS: 15000,
    WL_TWEAK_COMMENTS_TTL_MS: 5 * 60 * 1000,
    LINEAR_TWEAK_COMMENTS_WEBHOOK: 'https://n8n.invalid/webhook/linear-tweak-comments',
    _wlTweakCommentsCache: new Map(),
    _syncviewEfHeaders: (headers) => ({ ...headers, 'x-syncview-key': 'fictional' }),
    wlEscape: value => String(value == null ? '' : value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    _calFmtCommentTime: () => 'just now',
    wlState: { issueSnapshot: snapshot },
    setIdentity: value => { identity = value; },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      if (String(url).includes('linear-tweak-comments')) {
        return { ok: true, json: async () => ({ ok: true, comments: { 'wl-1': [{ author: 'Legacy', body: 'legacy note', createdAt: now }] } }) };
      }
      if (options.identityFlipsOnPage === pageIndex) identity = 'someone-else';
      const page = pages[pageIndex++];
      if (!page) throw new Error('fixture ran out of pages');
      return { ok: page.httpOk !== false, json: async () => page.value };
    },
  };
  if (options.laneA !== false) context.wlSnapshotIdentity = () => identity;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext([
    pageSizeDeclaration(),
    extract('wlFetchTweakComments'),
    extract('_wlNativeTweakComments'),
    extract('_wlLegacyFetchTweakComments'),
    extract('wlRenderTweakComments'),
  ].join('\n'), context);
  return { context, calls };
}
const page = (comments, extra = {}) => ({ value: { ok: true, canonical_thread: true, audience_scope: 'all',
  comments, total: comments.length, has_more: false, ...extra } });

(async () => {
  // ── One page size, three places, no drift ────────────────────────────
  {
    const mine = Number(pageSizeDeclaration().match(/= (\d+);/)[1]);
    const shared = Number((source.match(/const PROD_COMMENTS_PAGE_SIZE = (\d+);/) || [])[1]);
    const guard = fs.readFileSync(path.join(__dirname, '..', 'docs/syncview-design/tests/prod-structure-subset.js'), 'utf8');
    const enforced = Number((guard.match(/body\.limit === (\d+)/) || [])[1]);
    ok(mine === shared, 'the Workload page size matches PROD_COMMENTS_PAGE_SIZE (' + mine + ' vs ' + shared + ')');
    ok(mine === enforced, 'and matches the limit the house read-shape guard enforces (' + enforced + ')');
    ok(!/PROD_COMMENTS_PAGE_SIZE/.test(source.slice(source.indexOf('const WL_TWEAK_FEEDBACK_PAGE_SIZE'), source.indexOf('async function _wlLegacyFetchTweakComments'))),
      'and the Workload reader does not reach for a constant declared in a scope it cannot see');
  }

  // ── Routing ──────────────────────────────────────────────────────────
  {
    // The state of origin/main today: lane A has not landed, so nothing can be
    // classified native and the popover must behave exactly as it does now.
    const { context, calls } = build({ laneA: false });
    const out = await context.wlFetchTweakComments(['wl-1']);
    ok(calls.length === 1 && calls[0].url.includes('linear-tweak-comments'),
      'without lane A the reader stays entirely on the legacy lane');
    ok(!calls.some(c => c.url.includes('production-comments')),
      'and issues no production-comments request it cannot yet classify');
    ok(out['wl-1'][0].body === 'legacy note', 'legacy comments still reach the popover unchanged');
  }
  {
    const { context, calls } = build({ workloadSource: 'legacy', pages: [] });
    await context.wlFetchTweakComments(['wl-1']);
    ok(calls.every(c => !c.url.includes('production-comments')),
      'a row lane A marks legacy keeps the legacy lane even once lane A is present');
  }
  {
    const { context, calls } = build({ snapshot: [], pages: [] });
    await context.wlFetchTweakComments(['wl-1']);
    ok(calls.length === 1 && calls[0].url.includes('linear-tweak-comments'),
      'an unclassifiable row falls back rather than refusing — an absence is the failure an editor cannot report');
  }

  // ── The request shape the house guard enforces ───────────────────────
  {
    const { context, calls } = build({ pages: [page([canonical('a')])] });
    await context.wlFetchTweakComments(['wl-1']);
    const body = calls[0].body;
    ok(Object.keys(body).sort().join(',') === 'before,deliverable_id,include_feedback,limit',
      'the native read sends exactly the key set prod-structure-subset.js accepts');
    ok(body.limit === 50,
      'and pages at PROD_COMMENTS_PAGE_SIZE, so one page size covers every production-comments read on the page');
    ok(body.include_feedback === true,
      'include_feedback is sent, so a tweak that took the legacy write lane is visible here too (D5)');
    ok(body.deliverable_id === NATIVE_ID, 'the read is keyed on the native deliverable id, never a Linear identifier');
  }

  // ── Completeness integrity ───────────────────────────────────────────
  {
    const { context, calls } = build({ pages: [
      page([canonical('a')], { total: 2, has_more: true, next_cursor: { id: 'a', created_at: now } }),
      page([canonical('b')], { total: 2 }),
    ] });
    const out = await context.wlFetchTweakComments(['wl-1']);
    ok(calls.length === 2 && calls[1].body.before.id === 'a', 'pagination advances on the served cursor');
    ok(out['wl-1'].length === 2, 'and both pages reach the popover');
  }
  const refuses = async (label, options) => {
    const { context } = build(options);
    let threw = false;
    try { await context.wlFetchTweakComments(['wl-1']); } catch (e) { threw = true; }
    ok(threw, label);
  };
  await refuses('a duplicate comment id across pages refuses rather than double-counting', { pages: [
    page([canonical('a')], { total: 2, has_more: true, next_cursor: { id: 'a', created_at: now } }),
    page([canonical('a')], { total: 2 }),
  ] });
  await refuses('a total that moves between pages refuses — the thread changed under the read', { pages: [
    page([canonical('a')], { total: 2, has_more: true, next_cursor: { id: 'a', created_at: now } }),
    page([canonical('b')], { total: 9 }),
  ] });
  await refuses('a repeated next_cursor refuses instead of looping', { pages: Array.from({ length: 3 }, () =>
    page([canonical('a')], { total: 2, has_more: true, next_cursor: { id: 'same', created_at: now } })) });
  await refuses('a served count that disagrees with total refuses', { pages: [page([canonical('a')], { total: 5 })] });
  await refuses('a non-ok body refuses', { pages: [{ value: { ok: false } }] });
  await refuses('a wrong audience_scope refuses — this popover reads the whole thread or nothing',
    { pages: [page([canonical('a')], { audience_scope: 'client' })] });
  await refuses('a staff identity change mid-read refuses, so one signed-in staff never paints another one’s feedback',
    { identityFlipsOnPage: 0, pages: [page([canonical('a')])] });

  // ── What the editor actually sees ────────────────────────────────────
  {
    const { context } = build({ pages: [page(
      [canonical('a'), canonical('resolved', { resolved_at: now }), canonical('gone', { deleted_at: now })],
      { feedback: { version: 1, status: 'complete', complete: true, rows: [cardNote('c1')] } },
    )] });
    const rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1'];
    ok(rows.length === 2, 'resolved and deleted comments are filtered out of the popover');
    ok(rows.some(r => r.fromCard === true), 'a card-cell note with no canonical twin still reaches the editor');
    ok(rows.filter(r => r.fromCard).length === 1 && rows.find(r => r.fromCard).body === 'card c1',
      'and carries its own body, not a canonical one');
    ok(rows.native === true && rows.sourceComplete === true, 'a complete read is marked complete');
  }
  {
    const { context } = build({ pages: [page([canonical('a')],
      { feedback: { version: 1, status: 'source_unavailable', complete: false, rows: [] } })] });
    const rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1'];
    ok(rows.sourceComplete === false,
      'an unreadable card projection does NOT borrow the canonical thread’s completeness');
    ok(context.wlRenderTweakComments(rows).includes('may be incomplete'),
      'and the popover says so rather than presenting a partial list as the whole record');
  }

  // ── Copy: no surviving instruction to open Linear on a native row ────
  {
    const { context } = build({ pages: [] });
    const nativeEmpty = Object.assign([], { native: true });
    const rendered = context.wlRenderTweakComments(nativeEmpty);
    ok(rendered.includes('Open the post in SyncView'), 'an empty native read says where to look instead of rendering silence');
    ok(!/Linear/i.test(rendered), 'and never names Linear');
    ok(context.wlRenderTweakComments([]) === '', 'an empty legacy read still renders nothing, as it does today');

    const many = Object.assign(Array.from({ length: 5 }, (_, i) => ({ author: 'A', body: 'b' + i, createdAt: now })), { native: true });
    ok(!/Linear/i.test(context.wlRenderTweakComments(many)), 'the native overflow row drops "on the sub-issue in Linear"');
    const legacyMany = Array.from({ length: 5 }, (_, i) => ({ author: 'A', body: 'b' + i, createdAt: now }));
    ok(/in Linear/.test(context.wlRenderTweakComments(legacyMany)),
      'while a legacy row keeps it, because that is still where those comments are until the cutoff');
  }
  {
    // The failure path is the one that told staff to open a dead system.
    const callSite = source.slice(source.indexOf('async function wlFetchTweakComments'));
    const catchCopy = callSite.slice(0, callSite.indexOf('// Position:'));
    ok(!/open the sub-issue in Linear to read them/.test(catchCopy),
      'the popover’s catch branch no longer instructs staff to open the sub-issue in Linear');
    ok(/Couldn&rsquo;t load feedback/.test(catchCopy), 'and offers a retry against SyncView instead');
  }

  // ── Mixed board ──────────────────────────────────────────────────────
  {
    const { context, calls } = build({ pages: [page([canonical('a')])] });
    context.wlState.issueSnapshot.push({ id: 'wl-2', nativeId: '', workloadSource: 'legacy' });
    const out = await context.wlFetchTweakComments(['wl-1', 'wl-2']);
    ok(calls.some(c => c.url.includes('production-comments')) && calls.some(c => c.url.includes('linear-tweak-comments')),
      'a board holding both kinds of row reads each on its own lane');
    ok(out['wl-1'] && out['wl-2'], 'and returns both, keyed by row id');
  }

  if (failures) { console.error('\nWorkload tweak feedback: ' + failures + ' FAILED'); process.exitCode = 1; }
  else console.log('\nWorkload tweak feedback source checks: ' + count + ' passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

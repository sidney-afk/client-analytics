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

// It also pins the SyncLinear panel's side of finding 1, because that defect is
// a property of the PAIR: an absent card projection must be incomplete on both
// readers, and only the popover ever got it wrong.

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
// The collection's bounds are product numbers — how long staff stare at a
// skeleton — so they are read out of the shipped declaration rather than
// retyped here. Tolerant on purpose: against a tree that has no bounds at all
// the sandbox still runs, and the checks below fail on the MEASUREMENT instead
// of on a missing symbol, which is what makes the red meaningful.
function numericConst(name) {
  const match = source.match(new RegExp('^ *const ' + name + ' = \\d+;$', 'm'));
  return match ? match[0].trim() : '';
}
const valueOf = decl => Number((decl.match(/= (\d+);/) || [0, 0])[1]);
const POOL_DECL = numericConst('WL_TWEAK_FEEDBACK_POOL');
const DEADLINE_DECL = numericConst('WL_TWEAK_FEEDBACK_DEADLINE_MS');
const POOL = valueOf(POOL_DECL);
const DEADLINE_MS = valueOf(DEADLINE_DECL);
// The per-row abort the popover actually ships with. The sandbox used to carry
// a hand-typed 15000 while index.html read 8000, which would have published a
// worst case nearly double the real one (AGENTS.md: measure with the key the
// shipped code uses).
const ROW_TIMEOUT_MS = valueOf((source.match(/^ *const WL_PLAN_READ_TIMEOUT_MS = \d+;$/m) || [''])[0]);
// The per-deliverable read cache. Tolerant like the bounds above, so a tree
// without it still runs and fails on the measurement.
const NATIVE_CACHE_DECL = (source.match(/^ *const _wlNativeTweakCommentsCache = new Map\(\);/m) || [''])[0].trim();
const IN_FLIGHT_DECL = (source.match(/^ *const _wlNativeTweakCommentsInFlight = new Map\(\);/m) || [''])[0].trim();
// The native lane's own TTL. Deliberately NOT WL_TWEAK_COMMENTS_TTL_MS: a cached
// native read cannot revalidate the card binding the endpoint checks on every
// live read, so it is given a much shorter life of its own.
const NATIVE_TTL_DECL = (source.match(/^ *const WL_NATIVE_TWEAK_COMMENTS_TTL_MS = .*$/m) || [''])[0].trim();
const NATIVE_TTL_MS = (() => {
  const match = NATIVE_TTL_DECL.match(/= (.+);$/);
  if (!match) return 0;
  try { return Function('"use strict";return (' + match[1] + ')')(); } catch (e) { return 0; }
})();
// The actor-wide read budget, read out of the migration that enforces it rather
// than retyped here — the number this popover has to stay under.
const READ_BUDGET = Number((fs.readFileSync(path.join(__dirname, '..',
  'migrations/2026-07-23-production-comment-thread-lifecycle.sql'), 'utf8')
  .match(/requests < (\d+)/) || [0, 0])[1]);
const TTL_MS = valueOf((source.match(/^ *const WL_TWEAK_COMMENTS_TTL_MS = .*$/m) || [''])[0])
  || 5 * 60 * 1000;

// ── A virtual clock ──────────────────────────────────────────────────────
// The finding is about reads that HANG, not reads that reject: a rejection is
// instant and cannot reproduce it. So the fixture never resolves those fetches
// at all — the only thing that ends them is the AbortController the code under
// test arms — and time is advanced by firing the code's own timers in order.
// That makes the assertion below a measurement of wall clock, not of ordering.
function makeClock() {
  let now = 0, seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    jump(ms) { now += ms; },
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + (Number(ms) || 0), fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fireNext() {
      let bestId = null, bestAt = Infinity;
      for (const [id, timer] of timers) if (timer.at < bestAt) { bestAt = timer.at; bestId = id; }
      if (bestId === null) return false;
      const timer = timers.get(bestId);
      timers.delete(bestId);
      if (timer.at > now) now = timer.at;
      timer.fn();
      return true;
    },
  };
}
const drainMicrotasks = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };
// Runs a promise to settlement against the virtual clock: drain every pending
// continuation, then advance to the next armed timer, until it settles or there
// is no timer left to fire. A read with no bound at all never settles, and that
// is reported as the failure it is rather than hanging the suite.
async function runWithClock(clock, promise) {
  const result = { settled: false, value: null, error: null };
  promise.then(value => { result.settled = true; result.value = value; },
              error => { result.settled = true; result.error = error || new Error('rejected'); });
  for (let guard = 0; guard < 5000 && !result.settled; guard++) {
    await drainMicrotasks();
    if (result.settled) break;
    if (!clock.fireNext()) break;
  }
  await drainMicrotasks();
  return result;
}
const abortError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
// A request that answers only when it is aborted. This is the shape the review
// found: not a rejection, a hang.
const hangs = init => new Promise((_, reject) => {
  const signal = init && init.signal;
  if (!signal) return;
  if (signal.aborted) return reject(abortError());
  signal.addEventListener('abort', () => reject(abortError()));
});
const nativeRows = n => Array.from({ length: n }, (_, i) =>
  ({ id: 'wl-' + (i + 1), nativeId: 'del-' + (i + 1), workloadSource: 'native' }));

const NATIVE_ID = 'del_fixture_one';
const now = '2026-09-01T12:00:00.000Z';
const canonical = (id, extra = {}) => ({ id, author_name: 'Fixture reviewer', body: 'canonical ' + id,
  source_created_at: now, created_at: now, ...extra });
const cardNote = (id, extra = {}) => ({ id: 'source:' + id, author_name: 'Fixture client', body: 'card ' + id,
  source_created_at: now, created_at: now, source_only: true, ...extra });

// One sandbox per scenario: the real functions, everything they reach stubbed.
function build(options = {}) {
  const calls = [];
  let inFlight = 0, peakInFlight = 0;
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
    WL_PLAN_READ_TIMEOUT_MS: ROW_TIMEOUT_MS,
    WL_TWEAK_COMMENTS_TTL_MS: 5 * 60 * 1000,
    LINEAR_TWEAK_COMMENTS_WEBHOOK: 'https://n8n.invalid/webhook/linear-tweak-comments',
    _wlTweakCommentsCache: new Map(),
    _syncviewEfHeaders: (headers) => ({ ...headers, 'x-syncview-key': 'fictional' }),
    wlEscape: value => String(value == null ? '' : value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    _calFmtCommentTime: () => 'just now',
    wlState: { issueSnapshot: snapshot },
    setIdentity: value => { identity = value; },
    fetch: (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body, at: options.clock ? options.clock.now() : 0 });
      inFlight++;
      if (inFlight > peakInFlight) peakInFlight = inFlight;
      const settled = value => { inFlight--; return value; };
      const done = promise => promise.then(settled, error => { settled(); throw error; });
      return done((async () => {
      if (String(url).includes('linear-tweak-comments')) {
        if (options.legacyHangs) return hangs(init);
        if (options.legacyThrows) throw new Error('legacy lane unreachable');
        return { ok: true, json: async () => ({ ok: true, comments: options.legacyComments
          || { 'wl-1': [{ author: 'Legacy', body: 'legacy note', createdAt: now }] } }) };
      }
      // Multi-row scenarios queue pages per deliverable instead of one shared
      // list, so a rejection can be aimed at ONE row while its neighbours
      // answer normally. `{ reject }` is the real failure Codex named: an
      // aborted read on the timeout, or a rate-limited retry that never lands.
      if (options.byDeliverable) {
        const queue = options.byDeliverable[body.deliverable_id];
        if (!queue || !queue.length) throw new Error('fixture ran out of pages for ' + body.deliverable_id);
        const next = queue.shift();
        if (next.hang) return hangs(init);
        if (next.reject) throw new Error(next.reject);
        return { ok: next.httpOk !== false, json: async () => next.value };
      }
      if (options.identityFlipsOnPage === pageIndex) identity = 'someone-else';
      const page = pages[pageIndex++];
      if (!page) throw new Error('fixture ran out of pages');
      if (page.hang) return hangs(init);
      return { ok: page.httpOk !== false, json: async () => page.value };
      })());
    },
  };
  if (options.clock) {
    // A real Date with only `now` replaced. The first version of this stub was a
    // bare `{ now }` object, which silently lost `parse`, `UTC` and construction
    // — invisible until the code under test reached for one of them, and then it
    // looked like a product failure rather than a fixture one.
    context.Date = class extends Date { static now() { return options.clock.now(); } };
    context.setTimeout = (fn, ms) => options.clock.setTimeout(fn, ms);
    context.clearTimeout = id => options.clock.clearTimeout(id);
  }
  if (options.laneA !== false) context.wlSnapshotIdentity = () => identity;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext([
    pageSizeDeclaration(),
    POOL_DECL,
    DEADLINE_DECL,
    NATIVE_CACHE_DECL,
    IN_FLIGHT_DECL,
    NATIVE_TTL_DECL,
    extract('wlFetchTweakComments'),
    extract('_wlNativeTweakComments'),
    extract('_wlLegacyFetchTweakComments'),
    extract('wlRenderTweakComments'),
  ].join('\n'), context);
  return { context, calls, peak: () => peakInFlight };
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
  // An integrity violation refuses on the ROW it happened to, not on the read.
  // Refusing is still absolute — nothing partial or unverified is ever
  // presented as feedback — but since the per-row settle (finding 3) the
  // refusal is confined to its own deliverable, so the rows beside it that
  // were read whole still reach the editor. What must never happen is a
  // corrupt read arriving as comments, or as the silent "no feedback" box.
  const refuses = async (label, options) => {
    const { context } = build(options);
    let rows = null, threw = false;
    try { rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1']; } catch (e) { threw = true; }
    const refused = threw || (!!rows && rows.failed === true && rows.length === 0);
    ok(refused, label);
    if (!threw && rows) {
      const rendered = context.wlRenderTweakComments(rows);
      ok(/Couldn&rsquo;t load this deliverable&rsquo;s feedback/.test(rendered)
        && !/No feedback is available here/.test(rendered),
        '  ↳ and the refusal is visible on that row rather than read as an empty thread');
    }
  };
  // The one whole-collection fact: the signed-in staff identity moving under
  // the read invalidates every row at once, so this one still rejects outright.
  const refusesEverything = async (label, options) => {
    const { context } = build(options);
    let threw = false;
    try { await context.wlFetchTweakComments(['wl-1']); } catch (e) { threw = true; }
    ok(threw, label);
  };
  await refuses('a duplicate comment id across pages refuses rather than double-counting', { pages: [
    page([canonical('a')], { total: 2, has_more: true, next_cursor: { id: 'a', created_at: now } }),
    page([canonical('a')], { total: 2 }),
  ] });
  await refuses('a terminal count that disagrees with the rows collected refuses — the thread changed under the read', { pages: [
    page([canonical('a')], { total: 2, has_more: true, next_cursor: { id: 'a', created_at: now } }),
    page([canonical('b')], { total: 9 }),
  ] });
  await refuses('a repeated next_cursor refuses instead of looping', { pages: Array.from({ length: 3 }, () =>
    page([canonical('a')], { total: 2, has_more: true, next_cursor: { id: 'same', created_at: now } })) });
  await refuses('a served count that disagrees with total refuses', { pages: [page([canonical('a')], { total: 5 })] });

  // ── The nullable count, and the line it must not cross ───────────────
  // The endpoint's exact count fails OPEN: it scans every comment row on the
  // deliverable while the page is bounded, so it is the half that can hit a
  // statement timeout, and when it does the response carries `total: null`
  // beside a page that was read perfectly well. This reader is one of the two
  // consumers of that endpoint, and it proved completeness with
  // `rows.length === total` -- so a null used to land in the malformed-response
  // branch and paint "Couldn't load this deliverable's feedback" on a thread
  // nothing was wrong with. What must NOT come out of accepting the null is a
  // partial thread presented as whole, so each case below pairs the acceptance
  // with the refusal that still has to hold.
  {
    const { context } = build({ pages: [page([canonical('a')], { total: null })] });
    const rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1'];
    ok(Array.isArray(rows) && rows.length === 1 && rows.failed !== true,
      'a single page whose count failed open still reaches the popover');
    ok(!/Couldn&rsquo;t load this deliverable&rsquo;s feedback/.test(context.wlRenderTweakComments(rows)),
      '  \u21b3 and renders as feedback rather than as the refusal the fail-open exists to prevent');
  }
  // THE LINE AN UNCOUNTED WALK MAY NOT CROSS, and it is narrower than it first
  // looks. The endpoint orders newest-first and the cursor filters strictly
  // OLDER (`created_at.lt`), so a comment posted after page 1 is invisible to
  // every later page and the terminating `has_more === false` proves only that
  // nothing older remains below the cursor. What catches that when counts are
  // present is the cross-page AGREEMENT, not `rows.length === total`: page 1's
  // count predates the insert and the walk collects exactly that many older
  // rows, so the subtraction still balances. The protection therefore needs
  // every page after the first to be counted, and a walk with a gap in its
  // counts has no proof at all — so it refuses, exactly as it did before the
  // count began failing open.
  await refuses('an uncounted walk that PAGED refuses — has_more only proves nothing older remains below the cursor, not that the head stayed put', { pages: [
    page([canonical('a')], { total: null, has_more: true, next_cursor: { id: 'a', created_at: now } }),
    page([canonical('b')], { total: null }),
  ] });
  await refuses('a paged walk whose TERMINAL count failed open refuses — an earlier count predates the pages after it, so a head insertion leaves it balancing', { pages: [
    page([canonical('a')], { total: 2, has_more: true, next_cursor: { id: 'a', created_at: now } }),
    page([canonical('b')], { total: null }),
  ] });
  {
    // The mirror image is NOT a refusal, and getting this wrong hid threads that
    // had been read whole. The endpoint applies the cursor to the page query
    // only — `totalQuery` is never filtered by `before` — so every count is a
    // whole-thread count at the moment its page was served. A count on the
    // TERMINAL page is therefore taken after the entire walk, and it alone
    // proves the total. Counts on the pages before it add nothing.
    const { context, calls } = build({ pages: [
      page([canonical('a')], { total: null, has_more: true, next_cursor: { id: 'a', created_at: now } }),
      page([canonical('b')], { total: 2 }),
    ] });
    const rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1'];
    ok(calls.length === 2 && rows.length === 2 && rows.failed !== true,
      'a paged walk whose terminal count succeeded is accepted even though an earlier count failed open');
  }
  // The hazard the terminal count exists to catch, driven rather than argued: a
  // comment posted after page 1 is invisible to every later page (the cursor
  // filters strictly older), but it IS in the whole-thread terminal count, which
  // then exceeds the rows collected.
  await refuses('a terminal count higher than the rows collected refuses — that is a comment posted into the head mid-walk', { pages: [
    page([canonical('a')], { total: null, has_more: true, next_cursor: { id: 'a', created_at: now } }),
    page([canonical('b')], { total: 3 }),
  ] });
  {
    // The counted paged walk is untouched: this is the path the fail-open never
    // needed to change, and it must keep working.
    const { context, calls } = build({ pages: [
      page([canonical('a')], { total: 2, has_more: true, next_cursor: { id: 'a', created_at: now } }),
      page([canonical('b')], { total: 2 }),
    ] });
    const rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1'];
    ok(calls.length === 2 && rows.length === 2 && rows.failed !== true,
      'a fully counted paged walk still succeeds — the strict path is unchanged');
  }
  await refuses('a terminal count still governs across a walk with a null page in the middle', { pages: [
    page([canonical('a')], { total: 2, has_more: true, next_cursor: { id: 'a', created_at: now } }),
    page([canonical('b')], { total: null, has_more: true, next_cursor: { id: 'b', created_at: now } }),
    page([canonical('c')], { total: 9 }),
  ] });
  {
    // INTERMEDIATE counts are not retained, and must not be. They are taken at
    // different moments, so an older row that page 1 counted but had not yet
    // served can legitimately be deleted before the terminal page: the terminal
    // count comes back smaller and the rows collected are still the whole
    // current thread. Comparing the two counts rejected that read. It also
    // caught nothing the terminal count does not — a head insertion leaves the
    // terminal count ABOVE rows.length, a deletion of an already-collected row
    // leaves it BELOW — so the comparison was pure false refusal.
    const { context } = build({ pages: [
      page([canonical('a')], { total: 3, has_more: true, next_cursor: { id: 'a', created_at: now } }),
      page([canonical('b')], { total: 2 }),
    ] });
    const rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1'];
    ok(rows.length === 2 && rows.failed !== true,
      'an older unserved row deleted mid-walk is accepted — the terminal count matches the rows collected, and the higher earlier count is not held against it');
  }
  await refuses('a counted page that disagrees with the rows served still refuses when a later count is null', { pages: [
    page([canonical('a')], { total: 5, has_more: true, next_cursor: { id: 'a', created_at: now } }),
    page([canonical('b')], { total: null }),
  ] });
  await refuses('an uncounted read that never terminates refuses rather than presenting a partial thread as whole',
    { pages: Array.from({ length: 60 }, (_, i) =>
      page([canonical('n' + i)], { total: null, has_more: true, next_cursor: { id: 'n' + i, created_at: now } })) });
  await refuses('an uncounted read with a repeated cursor still refuses instead of looping', { pages: Array.from({ length: 3 }, () =>
    page([canonical('a')], { total: null, has_more: true, next_cursor: { id: 'same', created_at: now } })) });
  await refuses('an uncounted read with a duplicate id across pages still refuses', { pages: [
    page([canonical('a')], { total: null, has_more: true, next_cursor: { id: 'a', created_at: now } }),
    page([canonical('a')], { total: null }),
  ] });
  await refuses('an uncounted read that claims more pages but serves no cursor still refuses', { pages: [
    page([canonical('a')], { total: null, has_more: true, next_cursor: null }),
  ] });
  // `null` is the count failing open. Every OTHER non-integer is a malformed
  // response and has to stay refused, `undefined` above all: a reader that has
  // lost the field entirely is not a reader that could not count, and this PR
  // already carries one P1 about treating a missing projection as complete.
  for (const [label, total] of [['undefined', undefined], ['a string', '3'], ['a float', 1.5],
    ['a negative', -1], ['NaN', Number.NaN], ['an object', {}]]) {
    await refuses('a total that is ' + label + ' is malformed, not a failed-open count, and still refuses',
      { pages: [{ value: { ok: true, canonical_thread: true, audience_scope: 'all',
        comments: [canonical('a')], total, has_more: false } }] });
  }
  await refuses('a non-ok body refuses', { pages: [{ value: { ok: false } }] });
  await refuses('a wrong audience_scope refuses — this popover reads the whole thread or nothing',
    { pages: [page([canonical('a')], { audience_scope: 'client' })] });
  await refusesEverything('a staff identity change mid-read refuses the WHOLE read, so one signed-in staff never paints another one’s feedback',
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

  // ── An absent projection is incomplete, never complete (finding 1) ───
  {
    // This lane's merge order is FORCED to be merge-then-deploy: the Section 4
    // deploy lane only accepts a `commit_sha` already on `main`. So the window
    // where this browser is live and the dispatch-only `production-comments`
    // update is not is guaranteed, not hypothetical — and an older reader
    // answers with no `feedback` key at all. Reading that as complete presented
    // the canonical comments as the whole record and silently dropped every
    // card-only note. The SyncLinear panel already refused to do that
    // (`_prodFeedbackState` maps a missing projection to `unavailable`); this
    // popover did not, so the honest banner staff were promised for that window
    // only ever appeared on one of the two surfaces.
    const { context } = build({ pages: [page([canonical('a')])] });
    const rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1'];
    ok(rows.sourceComplete === false,
      'a response carrying NO feedback projection at all is incomplete, not complete');
    ok(context.wlRenderTweakComments(rows).includes('may be incomplete'),
      'and the popover warns until the matching reader is deployed');
  }
  {
    // The same window with an empty canonical thread reaches the OTHER branch,
    // where "No feedback is available here" is the identical silent claim.
    const { context } = build({ pages: [page([])] });
    const rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1'];
    const rendered = context.wlRenderTweakComments(rows);
    ok(!rendered.includes('No feedback is available here'),
      'an empty thread whose card projection could not be read never claims there is no feedback');
    ok(rendered.includes('may be incomplete'), 'it says the record could not be read whole');
  }

  // ── Covered source rows are not shown twice (finding 2) ──────────────
  const COVERED_AT = '2026-09-02T09:00:00.000Z';
  const coveredNote = (id, canonicalId, extra = {}) => cardNote(id, { covered_by: canonicalId,
    covered_version: 3, covered_updated_at: COVERED_AT, ...extra });
  {
    // `covered_by` means the endpoint proved this source row's exact canonical
    // counterpart is already in `rows`. Concatenating every source row
    // unconditionally showed imported feedback twice, and on a thread with two
    // canonical comments the duplicates filled the three-row preview and pushed
    // the genuinely source-only tweak behind the collapsed older count — the
    // one row an editor actually opens this popover to read.
    const { context } = build({ pages: [page(
      [canonical('c-one', { version: 3, updated_at: COVERED_AT }), canonical('c-two', { version: 3, updated_at: COVERED_AT })],
      { feedback: { version: 1, status: 'complete', complete: true, rows: [
        coveredNote('dup-one', 'c-one'), coveredNote('dup-two', 'c-two'), cardNote('only')] } },
    )] });
    const rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1'];
    ok(rows.length === 3, 'a source row already covered by a loaded canonical row is not shown a second time');
    ok(rows.filter(r => r.fromCard).length === 1 && rows.find(r => r.fromCard).body === 'card only',
      'the genuinely source-only tweak is the one card row that survives');
    ok(context.wlRenderTweakComments(rows).includes('card only'),
      'and it reaches the three-row preview instead of the collapsed older count');
  }
  {
    // Coverage is believed only once THIS browser holds the canonical row at
    // the proven version and update clock — the same check the panel applies.
    const { context } = build({ pages: [page([canonical('c-one', { version: 4, updated_at: COVERED_AT })],
      { feedback: { version: 1, status: 'complete', complete: true, rows: [coveredNote('dup-one', 'c-one')] } })] });
    const rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1'];
    ok(rows.filter(r => r.fromCard).length === 1,
      'a canonical row loaded at a different version does not cover its source note');
  }
  {
    const { context } = build({ pages: [page([canonical('other', { version: 3, updated_at: COVERED_AT })],
      { feedback: { version: 1, status: 'complete', complete: true, rows: [coveredNote('dup-one', 'c-one')] } })] });
    const rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1'];
    ok(rows.filter(r => r.fromCard).length === 1,
      'a covered_by naming a canonical row this browser never loaded does not hide the note');
  }

  // ── The sibling surface: the SyncLinear panel (finding 1) ────────────
  {
    // The panel already mapped a missing `feedback` key to `unavailable`, so it
    // did show the honest banner the owner was promised — but the existing
    // Chromium case proves that with `has_more: true`, which makes the row
    // incomplete on the CANONICAL side regardless of what the projection says.
    // Pin the projection side on its own, with a fully-read canonical thread
    // beside it, so this surface cannot quietly regress into the popover's bug.
    const panel = { console, JSON, Map, Number, String, Array, Object, Boolean,
      _calEsc: value => String(value == null ? '' : value),
      _calEscAttr: value => String(value == null ? '' : value),
      _jsAttrArg: value => JSON.stringify(String(value)),
      _prodCommentHTML: row => '<div data-prod-comment-id="' + row.id + '"></div>',
      _prodComments: { refresh: () => {} } };
    panel.globalThis = panel;
    vm.createContext(panel);
    vm.runInContext([extract('_prodFeedbackState'), extract('_prodFeedbackHTML')].join('\n'), panel);

    const state = panel._prodFeedbackState(undefined, null);
    ok(state.status === 'unavailable' && state.complete === false,
      'the panel reads a response carrying no feedback projection as unavailable, not complete');
    const html = panel._prodFeedbackHTML(state, [{ id: 'a' }], 'issue-1', false);
    ok(html.includes('data-prod-feedback-state="incomplete"'),
      'and marks the view incomplete even when the canonical thread was read whole');
    ok(html.includes('unavailable'),
      'so both readers now say the card notes are missing instead of presenting the thread as the whole record');
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
  {
    // The fetch layer can hand a deliverable over the moment it settles, but
    // only the call site can put it on screen — every check in this file would
    // still pass if the popover ignored the channel and waited for the map.
    const block = source.slice(source.indexOf('const token = ++_wlTweakCommentsToken;'));
    const fill = block.slice(0, block.indexOf('// Position:'));
    ok(/wlFetchTweakComments\(tweakSubs\.map\(s => s\.id\), paintRow, abandoned\)/.test(fill),
      'the popover passes a per-row painter, so a settled deliverable reaches the screen before the collection finishes');
    ok(/painted\.has\(s\.id\)/.test(fill),
      'and the final pass leaves an already-painted row alone, so a comment an editor expanded mid-read is not collapsed under them');
    // The lifecycle is RECORDED, not inferred from the DOM. Reading it off the
    // `open` class cannot work from here: `pop` gets that class a few lines
    // BELOW this block, so every sample taken before then sees "not open yet",
    // and a popover closed before its first page returned is never sampled while
    // open at all — the drain then runs to completion for a popover nobody is
    // looking at, which is precisely when the budget protection has to work.
    ok(/const abandoned = \(\) => token !== _wlTweakCommentsToken;/.test(fill),
      'the stop predicate is the recorded generation alone and reads no DOM state');
    ok(!/wasOpen/.test(fill), 'so there is no open-class sampling left to get the timing wrong');
    // And the generation has to advance on EVERY replacement. A rollup with no
    // tweak rows destroys the previous popover's feedback boxes just as
    // thoroughly as one that has them.
    const opener = source.slice(source.indexOf('function wlOpenRollupPopover'));
    const body = opener.slice(0, opener.indexOf('// Position:'));
    const bump = body.indexOf('const token = ++_wlTweakCommentsToken;');
    const guard = body.indexOf('if (tweakSubs.length) {');
    ok(bump > 0 && guard > 0 && bump < guard,
      'the feedback generation advances on every popover replacement, not only one that starts a read of its own');
    ok(/pop\.innerHTML = header \+ frameNote \+ items;/.test(body.slice(0, bump)),
      'and it advances where the previous popover’s feedback boxes are actually destroyed');
    const closer = source.slice(source.indexOf('function wlClosePopover'));
    ok(/_wlTweakCommentsToken\+\+;/.test(closer.slice(0, closer.indexOf('function onLinearSearchInput'))),
      'closing the popover records itself in the same generation, so an in-flight drain stops rather than running to completion');
  }

  // ── One failed row does not blank the rows that answered (finding 3) ─
  const complete = rows => ({ feedback: { version: 1, status: 'complete', complete: true, rows } });
  {
    // The bug: `wlFetchTweakComments` awaited each native row in one
    // all-or-nothing chain, so the first rejection escaped it and the call
    // site's catch replaced EVERY feedback box with the error state —
    // discarding rows already read whole. Same shape as OPEN_REPAIRS 177,
    // where six drifted rows discarded a 5,000-row Workload snapshot.
    // A unit fixture where every row succeeds cannot see this, which is why
    // the rejection is injected on exactly one row out of three here.
    const snapshot = [
      { id: 'wl-1', nativeId: 'del-one', workloadSource: 'native' },
      { id: 'wl-2', nativeId: 'del-two', workloadSource: 'native' },
      { id: 'wl-3', nativeId: 'del-three', workloadSource: 'native' },
    ];
    const { context } = build({ snapshot, byDeliverable: {
      'del-one':   [page([canonical('a')], complete([]))],
      'del-two':   [{ reject: 'The user aborted a request.' }],
      'del-three': [page([canonical('c')], complete([cardNote('c1')]))],
    } });
    let rejected = null;
    const out = await context.wlFetchTweakComments(['wl-1', 'wl-2', 'wl-3'])
      .catch(error => { rejected = error; return null; });
    ok(!rejected, 'one row rejecting no longer rejects the whole read');
    ok(!!out && Object.keys(out).length === 3, 'every id asked for leaves with an answer of its own');
    ok(!!out && out['wl-1'].length === 1 && out['wl-1'][0].body === 'canonical a',
      'the row read BEFORE the failure keeps its real feedback');
    ok(!!out && out['wl-3'].length === 2 && out['wl-3'].some(r => r.fromCard === true),
      'and so does the row read AFTER it, card notes included');
    ok(!!out && out['wl-2'].failed === true && out['wl-1'].failed !== true && out['wl-3'].failed !== true,
      'only the row that actually failed is marked unavailable');

    const worked = context.wlRenderTweakComments(out['wl-3']);
    ok(worked.includes('canonical c') && worked.includes('card c1'),
      'a working deliverable renders its feedback instead of an error state it did not earn');

    // Finding 2 of the brief: the degraded state has to SAY it is degraded.
    const failed = context.wlRenderTweakComments(out['wl-2']);
    const emptyButRead = context.wlRenderTweakComments(Object.assign([], { native: true, sourceComplete: true }));
    ok(failed !== emptyButRead, 'a row we could not ask does not render the same box as a row with no feedback');
    ok(/Couldn&rsquo;t load this deliverable&rsquo;s feedback/.test(failed),
      'the failed row says the read failed, on that row');
    ok(!/No feedback is available here/.test(failed),
      'and never claims there is no feedback — the claim an editor acts on by shipping the cut unchanged');
    ok(emptyButRead.includes('No feedback is available here'),
      'while a deliverable genuinely read whole with nothing on it still says so');
    ok(/class="wl-tweak-comments-status is-unavailable"/.test(failed),
      'the failed notice carries its own class, so it is not the muted italic "nothing here" voice');
  }
  {
    // A native row and a legacy row in one popover, legacy lane down. The
    // legacy read is ONE batched request, so its failure is genuinely unknown
    // for every legacy id — and for none of the native ones.
    const snapshot = [
      { id: 'wl-1', nativeId: 'del-one', workloadSource: 'native' },
      { id: 'wl-2', nativeId: '', workloadSource: 'legacy' },
    ];
    const { context } = build({ snapshot, legacyThrows: true,
      byDeliverable: { 'del-one': [page([canonical('a')], complete([]))] } });
    const out = await context.wlFetchTweakComments(['wl-1', 'wl-2']);
    ok(out['wl-1'].length === 1 && out['wl-1'].failed !== true,
      'a legacy lane outage does not blank the native rows beside it');
    ok(out['wl-2'].failed === true, 'and the legacy rows say they could not be read');
  }
  {
    const { context } = build({ pages: [] });
    ok(/Couldn&rsquo;t load this deliverable&rsquo;s feedback/.test(context.wlRenderTweakComments(undefined)),
      'a row with no entry at all renders unavailable rather than an empty box');
    ok(context.wlRenderTweakComments([]) === '',
      'while an empty legacy array still renders nothing, as it does today');
  }

  // ── The collection is bounded, not just each row (finding 4) ────────
  // Settling per row removed the all-or-nothing failure and introduced a
  // sequential one: N independent 8s aborts awaited back to back, so a popover
  // of 20 unreachable deliverables sat on skeletons for 160s where the old
  // chain gave up at 8s. Every check in this section makes the reads HANG
  // rather than reject, because a rejection is instant and cannot reproduce it.
  {
    ok(POOL >= 2 && POOL <= 8,
      'the native reads declare a bounded concurrency pool (' + (POOL || 'none') + ')');
    ok(DEADLINE_MS > 0 && DEADLINE_MS <= 30000,
      'and the collection declares a wall-clock deadline (' + (DEADLINE_MS || 'none') + 'ms)');
    ok(ROW_TIMEOUT_MS === 8000,
      'measured against the per-row abort the page actually ships (' + ROW_TIMEOUT_MS + 'ms)');
  }
  const allHang = snapshot => Object.fromEntries(snapshot.map(row => [row.nativeId, [{ hang: true }]]));
  for (const rowCount of [3, 12, 20, 40]) {
    const snapshot = nativeRows(rowCount);
    const ids = snapshot.map(row => row.id);
    const clock = makeClock();
    const { context, peak } = build({ clock, snapshot, byDeliverable: allHang(snapshot) });
    const run = await runWithClock(clock, context.wlFetchTweakComments(ids));
    const label = rowCount + ' unreachable rows';
    ok(run.settled && !run.error, label + ': the read settles instead of hanging on the slowest row');
    if (!run.settled || run.error) continue;
    // Sequential settling cost rowCount x the per-row abort. The pool divides
    // that by the pool size, and the deadline caps whatever is left.
    const sequential = rowCount * ROW_TIMEOUT_MS;
    const expected = Math.min(Math.ceil(rowCount / (POOL || 1)) * ROW_TIMEOUT_MS, DEADLINE_MS || Infinity);
    ok(clock.now() <= (DEADLINE_MS || Infinity),
      label + ': the whole collection finishes inside the deadline (' + clock.now() + 'ms)');
    ok(clock.now() === expected,
      label + ': worst case is ceil(N/pool) timeouts, capped by the deadline — ' + clock.now()
        + 'ms, where sequential settling took ' + sequential + 'ms');
    ok(rowCount < 8 || clock.now() < sequential / 2,
      label + ': and is a fraction of the sequential worst case, not a rounding off it');
    ok(peak() <= POOL,
      label + ': never more than the pool is in flight, so a wide rollup is not fired at the '
        + 'endpoint’s per-actor rate limit in one burst (peak ' + peak() + ')');
    ok(!!run.value && ids.every(id => run.value[id] && run.value[id].failed === true),
      label + ': and every row that could not be read says so on its own row');
  }
  {
    // The bound must not depend on the row count. 40 rows may not cost more
    // wall clock than 20 — that is the whole property the review asked for.
    const measure = async rowCount => {
      const snapshot = nativeRows(rowCount);
      const clock = makeClock();
      const { context } = build({ clock, snapshot, byDeliverable: allHang(snapshot) });
      await runWithClock(clock, context.wlFetchTweakComments(snapshot.map(row => row.id)));
      return clock.now();
    };
    const twenty = await measure(20), forty = await measure(40), eighty = await measure(80);
    ok(twenty === forty && forty === eighty,
      'doubling and quadrupling the rollup does not move the wall clock at all ('
        + twenty + '/' + forty + '/' + eighty + 'ms)');
  }

  // ── A fast row does not wait on a hanging one (finding 4, part two) ──
  {
    // "No successful row renders until the entire loop finishes" was half the
    // complaint, and the pool alone does not fix it: the caller still awaited
    // one map. `onRow` hands each deliverable over the moment it settles.
    const snapshot = nativeRows(3);
    const clock = makeClock();
    const { context } = build({ clock, snapshot, byDeliverable: {
      'del-1': [{ hang: true }],
      'del-2': [page([canonical('b')], complete([]))],
      'del-3': [page([canonical('c')], complete([cardNote('c1')]))],
    } });
    const painted = [];
    const run = await runWithClock(clock,
      context.wlFetchTweakComments(['wl-1', 'wl-2', 'wl-3'], (id, rows) => painted.push({ id, rows, at: clock.now() })));
    ok(painted.length === 3, 'every deliverable is handed to the caller as it settles, not once at the end');
    const at = id => { const hit = painted.find(entry => entry.id === id); return hit ? hit.at : null; };
    ok(at('wl-2') === 0 && at('wl-3') === 0,
      'a deliverable that answered immediately renders at 0ms, with the hanging row still outstanding');
    ok(at('wl-1') === ROW_TIMEOUT_MS,
      'while the hanging row settles only when its own abort fires (' + at('wl-1') + 'ms)');
    ok(painted.findIndex(entry => entry.id === 'wl-2') < painted.findIndex(entry => entry.id === 'wl-1'),
      'so the fast rows are painted BEFORE the slow one, even though the slow one was asked for first');
    const early = painted.find(entry => entry.id === 'wl-2');
    ok(!!early && context.wlRenderTweakComments(early.rows).includes('canonical b'),
      'and what is handed over early is that row’s real feedback, ready to render');
    ok(run.settled && !!run.value && run.value['wl-1'].failed === true && run.value['wl-3'].length === 2,
      'the final map still carries every row, hanging one included');
  }

  // ── Isolation, unchanged, with the reads hanging instead of rejecting ─
  {
    // LX-D3's guarantee re-proved through the new shape. A hang was always the
    // likelier failure than a rejection, and it must still land on ONE row.
    const snapshot = nativeRows(3);
    const clock = makeClock();
    const { context } = build({ clock, snapshot, byDeliverable: {
      'del-1': [page([canonical('a')], complete([]))],
      'del-2': [{ hang: true }],
      'del-3': [page([canonical('c')], complete([cardNote('c1')]))],
    } });
    const run = await runWithClock(clock, context.wlFetchTweakComments(['wl-1', 'wl-2', 'wl-3']));
    const out = run.value || {};
    ok(run.settled && !run.error, 'a hanging deliverable does not reject the collection');
    ok(!!out['wl-1'] && out['wl-1'][0] && out['wl-1'][0].body === 'canonical a'
      && !!out['wl-3'] && out['wl-3'].some(row => row.fromCard === true),
      'the deliverables beside it keep their real feedback, card notes included');
    ok(!!out['wl-2'] && out['wl-2'].failed === true && out['wl-1'] && out['wl-1'].failed !== true
      && out['wl-3'] && out['wl-3'].failed !== true,
      'and only the row that hung is marked unavailable');
    const failed = context.wlRenderTweakComments(out['wl-2']);
    const emptyButRead = context.wlRenderTweakComments(Object.assign([], { native: true, sourceComplete: true }));
    ok(failed !== emptyButRead && /class="wl-tweak-comments-status is-unavailable"/.test(failed),
      'a row we could not ask still looks different from a row that genuinely has no feedback');
    ok(!/No feedback is available here/.test(failed) && emptyButRead.includes('No feedback is available here'),
      'and still never claims a client said nothing');
  }

  // ── The legacy lane had no bound at all ─────────────────────────────
  {
    // `_wlLegacyFetchTweakComments` armed no AbortController, so a hung n8n
    // webhook held the popover indefinitely — the same defect on the other
    // lane, and it would have made "the collection is bounded" false.
    const clock = makeClock();
    const { context } = build({ clock, legacyHangs: true,
      snapshot: [{ id: 'wl-1', nativeId: '', workloadSource: 'legacy' }] });
    const run = await runWithClock(clock, context.wlFetchTweakComments(['wl-1']));
    ok(run.settled, 'a hung legacy webhook no longer holds the popover open forever');
    ok(clock.now() <= (DEADLINE_MS || Infinity),
      'it is cut at the same collection deadline (' + clock.now() + 'ms)');
    ok(run.settled && !run.error && !!run.value && run.value['wl-1'].failed === true,
      'and the legacy rows say they could not be read rather than reading as empty');
  }
  {
    // And it runs BESIDE the native pool now, so its latency is no longer
    // added to theirs.
    const clock = makeClock();
    const { context, calls } = build({ clock, legacyHangs: true, snapshot: [
      { id: 'wl-1', nativeId: 'del-1', workloadSource: 'native' },
      { id: 'wl-2', nativeId: '', workloadSource: 'legacy' },
    ], byDeliverable: { 'del-1': [page([canonical('a')], complete([]))] } });
    const painted = [];
    const run = await runWithClock(clock,
      context.wlFetchTweakComments(['wl-1', 'wl-2'], (id) => painted.push({ id, at: clock.now() })));
    const legacyCall = calls.find(entry => String(entry.url).includes('linear-tweak-comments'));
    ok(legacyCall && legacyCall.at === 0, 'the legacy batch is issued at once rather than queued behind the native reads');
    ok(painted.some(entry => entry.id === 'wl-1' && entry.at === 0),
      'so a native row still renders at 0ms while the legacy lane hangs');
    ok(run.settled && !!run.value && run.value['wl-1'].failed !== true && run.value['wl-2'].failed === true,
      'and the legacy outage lands only on the legacy rows');
  }

  // ── The pool must not spend the actor-wide read budget (finding 5) ──
  // `production_comment_read_budget_take` allows 120 requests per actor per
  // fixed five-minute window, PRINCIPAL-wide: exhausting it here also stops
  // SyncLinear's comment panel for the rest of that window. Bounding the wait
  // is what made that reachable — six opens of a 20-row rollup used to take
  // ~16 minutes across four windows and now fit inside two minutes of one.
  {
    ok(READ_BUDGET === 120,
      'the read budget is read from the migration that enforces it (' + READ_BUDGET + ' per actor per window)');
  }
  const nativeCalls = calls => calls.filter(entry => String(entry.url).includes('production-comments')).length;
  {
    const snapshot = nativeRows(20);
    const ids = snapshot.map(row => row.id);
    const answers = () => Object.fromEntries(snapshot.map(row =>
      [row.nativeId, [page([canonical('a')], complete([]))]]));
    const { context, calls } = build({ snapshot, byDeliverable: answers() });
    await context.wlFetchTweakComments(ids);
    const first = nativeCalls(calls);
    ok(first === 20, 'a 20-row rollup costs one request per deliverable on the first open (' + first + ')');
    // The fixture queues exactly one page per deliverable, so a second read that
    // reached the network at all would run out of pages and fail. It does not.
    const again = await context.wlFetchTweakComments(ids);
    ok(nativeCalls(calls) === first, 'reopening the same rollup costs NO further requests');
    ok(ids.every(id => again[id] && again[id].length === 1 && again[id].failed !== true),
      'and every row still renders its real feedback from the cache');
    // Six opens is the number that used to exhaust the window.
    for (let open = 0; open < 4; open++) await context.wlFetchTweakComments(ids);
    ok(nativeCalls(calls) === 20,
      'six opens of that rollup cost 20 requests, not 120 — the whole actor-wide budget');
    ok(nativeCalls(calls) < READ_BUDGET,
      'so the popover cannot lock SyncLinear out of the comment endpoint for the rest of the window');
  }
  {
    // A failure must never be remembered as an answer: that would turn one
    // aborted read into five minutes of "couldn't load" on a healthy row.
    const snapshot = nativeRows(1);
    const { context, calls } = build({ snapshot, byDeliverable: { 'del-1': [
      { reject: 'The user aborted a request.' },
      page([canonical('a')], complete([])),
    ] } });
    const failed = await context.wlFetchTweakComments(['wl-1']);
    ok(!!failed['wl-1'] && failed['wl-1'].failed === true, 'a failed read is reported as failed');
    const retried = await context.wlFetchTweakComments(['wl-1']);
    ok(nativeCalls(calls) === 2, 'and is retried on the next open rather than served from cache');
    ok(!!retried['wl-1'] && retried['wl-1'].failed !== true && (retried['wl-1'][0] || {}).body === 'canonical a',
      'so the row recovers as soon as the endpoint does');
  }
  {
    // A cache entry belongs to the staff identity that took it. Serving it to
    // another one is the mid-read identity failure, deferred by up to a TTL.
    const snapshot = nativeRows(1);
    const { context, calls } = build({ snapshot, byDeliverable: { 'del-1': [
      page([canonical('a')], complete([])),
      page([canonical('b')], complete([])),
    ] } });
    await context.wlFetchTweakComments(['wl-1']);
    context.setIdentity('another-staff');
    const out = await context.wlFetchTweakComments(['wl-1']);
    ok(nativeCalls(calls) === 2, 'a different signed-in staff does not read the previous one’s cached feedback');
    ok(!!out['wl-1'] && (out['wl-1'][0] || {}).body === 'canonical b', 'they get their own read');
  }
  {
    // The cache expires on the same TTL the legacy lane has always used here.
    const clock = makeClock();
    const snapshot = nativeRows(1);
    const { context, calls } = build({ clock, snapshot, byDeliverable: { 'del-1': [
      page([canonical('a')], complete([])),
      page([canonical('b')], complete([])),
    ] } });
    await runWithClock(clock, context.wlFetchTweakComments(['wl-1']));
    clock.jump(NATIVE_TTL_MS - 1);
    await runWithClock(clock, context.wlFetchTweakComments(['wl-1']));
    ok(nativeCalls(calls) === 1, 'a read inside the TTL is still served from cache');
    clock.jump(2);
    const fresh = await runWithClock(clock, context.wlFetchTweakComments(['wl-1']));
    ok(nativeCalls(calls) === 2, 'and past it the deliverable is read again rather than shown indefinitely stale');
    ok(!!fresh.value && !!fresh.value['wl-1'] && (fresh.value['wl-1'][0] || {}).body === 'canonical b',
      'with the newer feedback');
  }
  {
    // A cached row costs no request and no wait, so it must not queue behind a
    // neighbour that is going to hang for its whole timeout.
    const clock = makeClock();
    const snapshot = nativeRows(6);
    const queues = { 'del-6': [page([canonical('f')], complete([]))] };
    for (let i = 1; i <= 5; i++) queues['del-' + i] = [{ hang: true }];
    const { context, calls } = build({ clock, snapshot, byDeliverable: queues });
    // Warm the cache for one deliverable, then open a rollup where every OTHER
    // row hangs. Same sandbox, so this is the cache the second read consults.
    await runWithClock(clock, context.wlFetchTweakComments(['wl-6']));
    const before = nativeCalls(calls);
    const painted = [];
    await runWithClock(clock, context.wlFetchTweakComments(snapshot.map(row => row.id),
      (id) => painted.push({ id, at: clock.now() })));
    const cachedAt = (painted.find(entry => entry.id === 'wl-6') || {}).at;
    ok(cachedAt === 0, 'a cached deliverable paints immediately, ahead of five rows that are going to hang');
    ok(painted[0] && painted[0].id === 'wl-6', 'it is served first rather than queued behind them');
    ok(nativeCalls(calls) === before + 5, 'and costs no request of its own');
  }
  {
    // Once the popover is closed or reopened elsewhere, the rows STILL QUEUED
    // are the ones worth not paying for. Suppressing their paint was never
    // enough — the request had already been sent and the budget already spent.
    const clock = makeClock();
    const snapshot = nativeRows(20);
    const { context, calls } = build({ clock, snapshot, byDeliverable: allHang(snapshot) });
    let settledCount = 0;
    const run = await runWithClock(clock, context.wlFetchTweakComments(
      snapshot.map(row => row.id),
      () => { settledCount++; },
      // The popover closed as soon as the first row came back.
      () => settledCount >= 1));
    ok(run.settled, 'an abandoned read still settles rather than leaking');
    ok(nativeCalls(calls) === POOL,
      'a popover closed after the first row costs ' + nativeCalls(calls) + ' requests — only the wave already in flight — not 20');
    ok(!!run.value && snapshot.every(row => (run.value[row.id] || {}).failed === true),
      'and the rows never asked for are unavailable, never an empty thread');
  }
  {
    // A paging read spends one request per PAGE, so the same has to hold
    // between pages — and the rows collected before it stopped must never be
    // presented as this deliverable's feedback.
    const snapshot = nativeRows(1);
    let seen = 0;
    const { context, calls } = build({ snapshot, byDeliverable: { 'del-1': [
      page([canonical('a')], { total: 2, has_more: true, next_cursor: { id: 'a', created_at: now } }),
      page([canonical('b')], { total: 2 }),
    ] } });
    const out = await context.wlFetchTweakComments(['wl-1'], () => { seen++; }, () => nativeCalls(calls) >= 1);
    ok(nativeCalls(calls) === 1, 'an abandoned paging read stops after the page it was already committed to');
    const rendered = context.wlRenderTweakComments(out['wl-1']);
    ok(!!out['wl-1'] && out['wl-1'].failed === true && /Couldn&rsquo;t load this deliverable&rsquo;s feedback/.test(rendered),
      'and its partial rows are discarded rather than shown as the thread');
    ok(!/No feedback is available here/.test(rendered),
      'never as an empty one — an abandoned read is not evidence a client said nothing');
  }

  // ── A cached read cannot vouch for a card binding (finding 6) ───────
  {
    // The endpoint reads the linked card before AND after building the
    // projection and answers `link_changed` when the deliverable no longer names
    // it — a refusal that exists to withhold the previous card's notes. A cached
    // response skips that refusal entirely, and a deliverable re-linked to a
    // different CLIENT's card would put that client's notes under this one.
    ok(NATIVE_TTL_MS > 0 && NATIVE_TTL_MS < TTL_MS,
      'the native lane has a TTL of its own, shorter than the legacy lane’s ('
        + NATIVE_TTL_MS + 'ms vs ' + TTL_MS + 'ms)');
    ok(/feedbackCardMatches/.test(fs.readFileSync(path.join(__dirname, '..',
      'supabase/functions/production-comments/feedback.mjs'), 'utf8')),
      'and the binding check it cannot perform is real, on the endpoint side');
  }
  {
    // `wlApplyData` replaces issueSnapshot with fresh row OBJECTS on every
    // refresh, so row identity is the browser's own evidence that nothing it can
    // see about this deliverable has moved. A hit must not outlive it.
    const snapshot = nativeRows(1);
    const { context, calls } = build({ snapshot, byDeliverable: { 'del-1': [
      page([canonical('a')], complete([])),
      page([canonical('after-relink')], complete([])),
    ] } });
    await context.wlFetchTweakComments(['wl-1']);
    ok(nativeCalls(calls) === 1, 'the first open reads the deliverable');
    await context.wlFetchTweakComments(['wl-1']);
    ok(nativeCalls(calls) === 1, 'an immediate reopen on the SAME snapshot row is served from cache');
    // The board refreshes: same ids, new objects, exactly as wlApplyData leaves it.
    context.wlState.issueSnapshot = snapshot.map(row => ({ ...row }));
    const after = await context.wlFetchTweakComments(['wl-1']);
    ok(nativeCalls(calls) === 2,
      'once the board refreshes, the cached answer is no longer one this browser can vouch for and the deliverable is read again');
    ok(!!after['wl-1'] && (after['wl-1'][0] || {}).body === 'canonical after-relink',
      'so a re-linked deliverable shows the feedback of the card it is bound to NOW');
  }
  {
    // The answer records which binding it was verified against, so a stored
    // response is never a set of notes with no stated provenance.
    const snapshot = nativeRows(1);
    const scope = { surface: 'calendar', card_id: 'card-one', component: 'video',
      client_slug: 'fixture-client', deliverable_id: 'del-1' };
    const { context } = build({ snapshot, byDeliverable: { 'del-1': [
      page([canonical('a')], { feedback: { version: 1, status: 'complete', complete: true, scope, rows: [] } }),
    ] } });
    const out = await context.wlFetchTweakComments(['wl-1']);
    ok(!!out['wl-1'].scope && out['wl-1'].scope.card_id === 'card-one',
      'the verified card scope travels with the answer');
  }

  // ── The three-row preview shows the NEWEST feedback (finding 9) ─────
  {
    // wlRenderTweakComments shows three rows and collapses the rest as "older
    // comments", so merge order decides what an editor actually reads.
    // Concatenating canonical then source put every card note behind every
    // canonical one regardless of when it was written: a tweak submitted
    // minutes ago sat behind three older canonical rows and was described as
    // OLDER than them. This popover exists to surface exactly that note.
    const older = t => ({ source_created_at: t, created_at: t });
    const snapshot = nativeRows(1);
    const { context } = build({ snapshot, byDeliverable: { 'del-1': [page(
      [canonical('old-1', older('2026-08-01T09:00:00.000Z')),
       canonical('old-2', older('2026-08-02T09:00:00.000Z')),
       canonical('old-3', older('2026-08-03T09:00:00.000Z'))],
      { feedback: { version: 1, status: 'complete', complete: true, rows: [
        cardNote('fresh', older('2026-09-01T09:00:00.000Z'))] } },
    )] } });
    const rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1'];
    ok(rows.length === 4, 'all four notes reach the popover');
    ok(rows[0] && rows[0].fromCard === true && rows[0].body === 'card fresh',
      'the newest note leads, even though it came from the card rather than the canonical thread');
    const rendered = context.wlRenderTweakComments(rows);
    ok(rendered.includes('card fresh'),
      'so a freshly submitted card tweak is IN the three-row preview, not behind the collapsed count');
    const freshAt = rendered.indexOf('card fresh');
    const olderAt = rendered.indexOf('older comment');
    ok(freshAt >= 0 && olderAt > freshAt,
      'and the genuinely older canonical row is the one described as older, below it');
  }
  {
    // Ties keep the previous order, so nothing reshuffles on equal timestamps.
    const snapshot = nativeRows(1);
    const { context } = build({ snapshot, byDeliverable: { 'del-1': [page(
      [canonical('c-one'), canonical('c-two')],
      { feedback: { version: 1, status: 'complete', complete: true, rows: [cardNote('same-time')] } },
    )] } });
    const rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1'];
    ok(rows.map(row => row.body).join('|') === 'canonical c-one|canonical c-two|card same-time',
      'equal timestamps keep canonical before source, the order this surface already had');
  }
  {
    // An undated row must sort last rather than jumping the queue on a NaN.
    const snapshot = nativeRows(1);
    const { context } = build({ snapshot, byDeliverable: { 'del-1': [page(
      [canonical('dated')],
      { feedback: { version: 1, status: 'complete', complete: true, rows: [
        { id: 'undated', author_name: 'Fixture client', body: 'card undated', source_only: true }] } },
    )] } });
    const rows = (await context.wlFetchTweakComments(['wl-1']))['wl-1'];
    ok(rows.length === 2 && rows[0].body === 'canonical dated',
      'a note with no usable timestamp sorts last instead of displacing a dated one');
  }

  // ── A refreshed row must not join a stale flight (finding 11) ───────
  {
    // Sharing in-flight reads is keyed on owner + deliverable, which says
    // nothing about WHICH snapshot row the read was started for. A refresh
    // mid-flight hands the next popover a new row object while the in-flight
    // read still holds the old one — and that read rejects at its own
    // snapshot-identity check, so joining it would give the new popover an
    // unavailable row instead of a real read of the refreshed binding.
    const clock = makeClock();
    const snapshot = nativeRows(1);
    const { context, calls } = build({ clock, snapshot, byDeliverable: { 'del-1': [
      { hang: true },
      page([canonical('after-refresh')], complete([])),
    ] } });
    // First popover starts a read that will hang until its abort fires.
    const first = context.wlFetchTweakComments(['wl-1']);
    await drainMicrotasks();
    ok(nativeCalls(calls) === 1, 'the first popover has a read in flight');
    // The board refreshes: same id, new row object, as wlApplyData leaves it.
    context.wlState.issueSnapshot = snapshot.map(row => ({ ...row }));
    const second = context.wlFetchTweakComments(['wl-1']);
    const [, secondRun] = await Promise.all([runWithClock(clock, first), runWithClock(clock, second)]);
    ok(nativeCalls(calls) === 2,
      'the popover opened after the refresh issues its own read rather than joining the stale flight');
    ok(!!secondRun.value && secondRun.value['wl-1'] && secondRun.value['wl-1'].failed !== true,
      'so it gets a real answer instead of the stale flight’s refusal');
    ok(!!secondRun.value && (secondRun.value['wl-1'][0] || {}).body === 'canonical after-refresh',
      'and it is the feedback for the row the board holds NOW');
  }
  {
    // Sharing still happens when the row really is the same object.
    const snapshot = nativeRows(1);
    const { context, calls } = build({ snapshot, byDeliverable: { 'del-1': [
      page([canonical('a')], complete([])),
      page([canonical('second-request')], complete([])),
    ] } });
    const both = await Promise.all([
      context.wlFetchTweakComments(['wl-1']),
      context.wlFetchTweakComments(['wl-1']),
    ]);
    ok(nativeCalls(calls) === 1, 'two opens on the SAME snapshot row still share one request');
    ok(both.every(out => (out['wl-1'][0] || {}).body === 'canonical a'), 'and both get that answer');
  }

  // ── A degraded answer is never remembered (finding 7) ───────────────
  {
    // The endpoint answers 200 with an INCOMPLETE projection for
    // `source_unavailable`, `link_changed` and `source_limit`. Caching that
    // holds the degraded view for the rest of the TTL even once the source has
    // recovered or the link has been repaired — caching an outage extends it,
    // and the thing it keeps invisible is card-only notes.
    const snapshot = nativeRows(1);
    const { context, calls } = build({ snapshot, byDeliverable: { 'del-1': [
      page([canonical('a')], { feedback: { version: 1, status: 'source_unavailable', complete: false, rows: [] } }),
      page([canonical('a')], complete([cardNote('recovered')])),
    ] } });
    const degraded = await context.wlFetchTweakComments(['wl-1']);
    ok(degraded['wl-1'].sourceComplete === false, 'an unreadable card projection reports itself incomplete');
    ok(context.wlRenderTweakComments(degraded['wl-1']).includes('may be incomplete'),
      'and says so on the row');
    const after = await context.wlFetchTweakComments(['wl-1']);
    ok(nativeCalls(calls) === 2, 'reopening asks again rather than serving the degraded answer back');
    ok(!!after['wl-1'] && after['wl-1'].sourceComplete === true
      && after['wl-1'].some(row => row.fromCard === true),
      'so the card notes appear as soon as the source recovers, not a minute later');
  }
  {
    // The complete case is still cached — the budget fix must survive this.
    const snapshot = nativeRows(1);
    const { context, calls } = build({ snapshot, byDeliverable: { 'del-1': [
      page([canonical('a')], complete([])),
    ] } });
    await context.wlFetchTweakComments(['wl-1']);
    await context.wlFetchTweakComments(['wl-1']);
    ok(nativeCalls(calls) === 1, 'a projection read whole is still remembered, so the budget fix stands');
  }

  // ── Overlapping popovers share a read rather than racing it ─────────
  {
    // The completed-value cache cannot help two popovers that overlap: reopening
    // a rollup before its first reads land means both generations miss it and
    // both send a request for the same deliverable, so a slow popover opened
    // repeatedly still spends a pool-sized wave every time.
    const snapshot = nativeRows(1);
    const { context, calls } = build({ snapshot, byDeliverable: { 'del-1': [
      page([canonical('a')], complete([])),
      page([canonical('second-request')], complete([])),
    ] } });
    const both = await Promise.all([
      context.wlFetchTweakComments(['wl-1']),
      context.wlFetchTweakComments(['wl-1']),
    ]);
    ok(nativeCalls(calls) === 1, 'two overlapping opens of the same deliverable cost ONE request, not two');
    ok(both.every(out => out['wl-1'] && (out['wl-1'][0] || {}).body === 'canonical a'),
      'and both popovers get the same real feedback');
  }
  {
    // A shared read must not be abandoned by a generation that walked away while
    // another is still waiting on it — that would turn a reopen into a failure.
    const clock = makeClock();
    const snapshot = nativeRows(1);
    const { context, calls } = build({ clock, snapshot, byDeliverable: { 'del-1': [
      page([canonical('a')], { total: 2, has_more: true, next_cursor: { id: 'a', created_at: now } }),
      page([canonical('b')], { total: 2 }),
    ] } });
    // The first popover gives up immediately; the second one is still watching.
    const abandonedRun = context.wlFetchTweakComments(['wl-1'], null, () => true);
    const watching = context.wlFetchTweakComments(['wl-1'], null, () => false);
    const [gone, kept] = await Promise.all([
      runWithClock(clock, abandonedRun),
      runWithClock(clock, watching),
    ]);
    ok(!!kept.value && kept.value['wl-1'] && kept.value['wl-1'].failed !== true,
      'the popover still watching gets its feedback even though the one before it gave up');
    ok(!!kept.value && kept.value['wl-1'].length === 2,
      'read whole, across both pages, rather than cut off at the abandoned generation');
    ok(gone.settled, 'and the abandoned generation still settles');
  }
  {
    // Once every waiter has gone, the shared read stops like any other.
    const clock = makeClock();
    const snapshot = nativeRows(20);
    const { context, calls } = build({ clock, snapshot, byDeliverable: allHang(snapshot) });
    let settledCount = 0;
    await runWithClock(clock, context.wlFetchTweakComments(
      snapshot.map(row => row.id), () => { settledCount++; }, () => settledCount >= 1));
    ok(nativeCalls(calls) === POOL,
      'sharing in-flight reads does not weaken the abandon bound (' + nativeCalls(calls) + ' requests)');
  }

  // ── Progressive paint never outruns the whole-collection refusal ─────
  {
    // Painting early is only safe if the one fact that invalidates EVERY row —
    // the signed-in staff identity moving — still stops it. A row that settles
    // after the change is neither stored nor handed to the caller, and the read
    // still rejects so the caller's catch clears what was already on screen.
    const { context } = build({ identityFlipsOnPage: 0, pages: [page([canonical('a')])] });
    const painted = [];
    let threw = false;
    try { await context.wlFetchTweakComments(['wl-1'], (id, rows) => painted.push({ id, rows })); }
    catch (e) { threw = true; }
    ok(threw, 'a staff identity change mid-read still refuses the whole read');
    ok(painted.length === 0, 'and nothing was painted into the popover on the way out');
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

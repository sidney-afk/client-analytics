'use strict';
/*
 * A feed of readable comments was thrown away because COUNTING them failed.
 *
 * `production-comments` answered every read with two queries fired together:
 *
 *   totalQuery  select("id", { count: "exact", head: true })  -- deliverable_id
 *   pageQuery   select(COMMENT_SELECT) ... limit(limit + 1)   -- 26 rows
 *
 * and then `if (totalResult.error || pageResult.error) throw`. The two halves do
 * not age alike. The page is bounded at `limit + 1`; the count is filtered only
 * by `deliverable_id` (plus `audience` for a client), so it scans every comment
 * row the deliverable has ever accumulated and is the half that grows without
 * bound until it can hit a statement timeout. When it did, the throw landed in
 * the handler's catch, the gateway answered 500 `read_failed`, and the browser
 * replaced the WHOLE feed with "Comments could not load." on the SyncLinear
 * detail pane and the calendar/SXR comment modals -- while the rows themselves
 * had been fetched perfectly well and were sitting in `pageResult.data`.
 *
 * The repair is the smallest one that exists, and it is deliberately not a
 * contract change: the count fails OPEN. It is settled on its own so it cannot
 * fail the request, `total` becomes null when it does not arrive, and the field,
 * `has_more` and `next_cursor` all keep their shape. The page read stays fatal,
 * because comments that genuinely cannot be READ must say so rather than render
 * as an empty thread.
 *
 * WHAT THIS PROVES, AND WHY IT IS BUILT THE WAY IT IS. The scenario that matters
 * is the ASYMMETRIC one: the count fails while the page succeeds. A fixture that
 * fails both is a different scenario (that one is a genuine read failure and
 * must still be a 500), and it passes against the broken code too -- so it
 * proves nothing here. Part 1 therefore drives the real TypeScript handler with
 * a transport that can refuse ONE of the two queries by shape, and part 2 feeds
 * the response it actually produced through the real browser comment module
 * extracted from index.html, so "the feed still renders" is executed rather than
 * asserted about.
 *
 * Ledger: OPEN_REPAIRS 172 (lane LX-D). Whether this endpoint should compute an
 * exact count at all remains an open OWNER decision; nothing here forecloses it.
 */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

// The handler is TypeScript. Re-enter under the type stripper once.
if (!process.execArgv.includes('--experimental-strip-types')) {
  const run = spawnSync(process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', __filename],
    { stdio: 'inherit' });
  process.exit(run.status == null ? 1 : run.status);
}

const root = path.resolve(__dirname, '..');
const { extractFunction } = require('./helpers/extract-function');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* ===================================================================== */
/* Part 1 -- the real handler, with one of its two queries refused        */
/* ===================================================================== */

const now = '2026-09-01T12:00:00.000Z';
const target = {
  id: 'fail-open-deliverable', client_slug: 'fixture-failopen',
  team: 'video', origin: 'calendar', card_id: 'fail-open-card',
};
const row = (id, extra = {}) => ({
  id, deliverable_id: target.id, native_comment_id: id,
  author_name: 'Fixture reviewer', role: 'smm', body: 'Body of ' + id,
  component: 'video', is_tweak: false, round: null,
  source_created_at: now, source_updated_at: now,
  created_at: now, updated_at: now, version: 1, audience: 'internal', ...extra,
});

let db, handler, refuse, rejectInstead, seen;

function reset(comments = [row('c1'), row('c2'), row('c3')]) {
  // `refuse` names which of the two production_comments queries the transport
  // turns down: the counting one ('count'), the paging one ('page'), or both.
  refuse = new Set();
  // A count can also REJECT rather than resolve with an error (an aborted
  // socket, a thrown transport). Promise.all propagates a rejection, so a fix
  // that only inspected `.error` would still 500. This switches which failure
  // shape the refused query produces.
  rejectInstead = false;
  seen = [];
  db = {
    team_members: [{ id: 'reviewer', name: 'Fixture Reviewer', role: 'smm', active: true, team: null }],
    deliverables: [structuredClone(target)],
    production_comments: comments.map(c => structuredClone(c)),
    calendar_posts: [], sample_reviews: [], production_comment_card_links: [],
    client_access: [{ slug: target.client_slug, review_token: 'fictional-client' }],
    clients: [{ slug: target.client_slug, active: true }],
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
  // The count query is the head/count one; the page query is the other read of
  // the same table. Discriminating by SHAPE rather than by call order is what
  // lets the fixture refuse exactly one of two concurrent queries.
  get role() {
    if (this.table !== 'production_comments' || this.inserted) return '';
    return this.head ? 'count' : 'page';
  }
  then(resolve, reject) {
    try {
      const role = this.role;
      if (role) seen.push(role);
      if (role && refuse.has(role)) {
        if (rejectInstead) return Promise.reject(new Error('synthetic ' + role + ' rejection')).then(resolve, reject);
        return Promise.resolve({ data: null, count: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } }).then(resolve, reject);
      }
      const rows = structuredClone((db[this.table] || []).filter(r => this.filters.every(fn => fn(r))));
      const data = this.head ? null : this.single ? (rows.length === 1 ? rows[0] : null) : rows.slice(0, this.cap);
      return Promise.resolve({ data, count: rows.length, error: this.single && rows.length > 1 ? {} : null }).then(resolve, reject);
    } catch (error) { return Promise.reject(error).then(resolve, reject); }
  }
}

globalThis.__failOpenClient = () => ({
  from: table => new Query(table),
  rpc: async name => ({
    data: name === 'production_comment_read_authorize' ? { ok: true, authorized: true } : { ok: true, allowed: true },
    error: null,
  }),
});
globalThis.Deno = {
  env: { get: name => ({
    SUPABASE_URL: 'https://fixture.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'fictional-service',
    ROLE_KEY_SMM: 'fictional-staff',
  }[name]) },
  serve: fn => { handler = fn; },
};
globalThis.fetch = () => { throw new Error('network forbidden'); };

const staff = { 'x-syncview-key': 'fictional-staff', 'x-syncview-actor': 'Fixture Reviewer' };
async function call(extra = {}) {
  const response = await handler(new Request('https://fixture.invalid', {
    method: 'POST',
    headers: { ...staff, 'content-type': 'application/json' },
    body: JSON.stringify({ deliverable_id: target.id, ...extra }),
  }));
  return { status: response.status, body: await response.json() };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'total-fail-open-'));
  try {
    const entry = path.join(root, 'supabase/functions/production-comments/index.ts');
    const original = fs.readFileSync(entry, 'utf8');
    const authCopy = path.join(tmp, 'staff-role-auth.mts');
    fs.copyFileSync(path.join(root, 'supabase/functions/_shared/staff-role-auth.ts'), authCopy);
    const source = original
      .replace(/import \{ createClient, SupabaseClient \} from "npm:[^"]+";/,
        'const createClient = globalThis.__failOpenClient; type SupabaseClient = any;')
      .replace(/from "(\.\.?\/[^"]+)"/g, (_all, relative) => 'from ' + JSON.stringify(pathToFileURL(
        relative === '../_shared/staff-role-auth.ts' ? authCopy : path.resolve(path.dirname(entry), relative)).href));
    assert.notEqual(source, original, 'the transport substitution must actually apply');
    const entryCopy = path.join(tmp, 'handler.mts');
    fs.writeFileSync(entryCopy, source);
    await import(pathToFileURL(entryCopy).href);
    assert.ok(handler, 'the handler registered itself');

    /* ---- 1a. Baseline: neither query fails, the count is unchanged ------- */
    reset();
    const clean = await call();
    ok(clean.status === 200, 'baseline read answers 200');
    ok(clean.body.total === 3, 'baseline total is the exact count, exactly as before (' + clean.body.total + ')');
    ok((clean.body.comments || []).length === 3, 'baseline returns every comment');
    ok(seen.includes('count') && seen.includes('page'), 'baseline really issued both queries, so the fixture discriminates them');

    /* ---- 1b. THE SCENARIO: the count fails, the page does not ----------- */
    reset();
    refuse.add('count');
    const countDown = await call();
    ok(countDown.status === 200,
      'a timed-out COUNT no longer fails the request (status ' + countDown.status + ') -- this is the assertion that is red before the fix');
    ok(countDown.body.ok === true, 'and the response is a success envelope, not `read_failed`');
    ok(countDown.body.total === null, 'total is null rather than a number invented from a query that did not run');
    ok(Object.prototype.hasOwnProperty.call(countDown.body, 'total'),
      'and the FIELD is still present -- nullable, not deleted, so no caller loses a key it reads');
    const ids = body => (Array.isArray(body.comments) ? body.comments : []).map(c => c.id).join(',');
    ok(ids(countDown.body) === 'c1,c2,c3',
      'every comment the page read is served anyway -- the rows were never the thing that failed');
    ok(countDown.body.has_more === false && countDown.body.next_cursor === null,
      'has_more and next_cursor are derived from the PAGE and are untouched by the count failing');
    ok(countDown.body.canonical_thread === true && countDown.body.audience_scope === 'all',
      'the rest of the envelope is unchanged');

    /* ---- 1c. A count that REJECTS, not merely errors --------------------- */
    reset();
    refuse.add('count');
    rejectInstead = true;
    const countThrew = await call();
    ok(countThrew.status === 200 && countThrew.body.total === null,
      'a count that REJECTS (aborted socket, thrown transport) also fails open -- Promise.all would have propagated it');
    ok(ids(countThrew.body) === 'c1,c2,c3', 'and still serves the page');

    /* ---- 1d. Counterfactual: the PAGE is still fatal --------------------- */
    reset();
    refuse.add('page');
    const pageDown = await call();
    ok(pageDown.status === 500 && pageDown.body.error === 'read_failed',
      'a failed PAGE read still refuses -- comments that genuinely cannot be read must say so, not render as an empty thread');
    ok(pageDown.body.comments === undefined, 'and releases no partial thread');

    reset();
    refuse.add('page');
    rejectInstead = true;
    const pageThrew = await call();
    ok(pageThrew.status === 500 && pageThrew.body.error === 'read_failed',
      'a page read that rejects is fatal too');

    /* ---- 1e. Both down is a DIFFERENT scenario and stays a 500 ----------- */
    reset();
    refuse.add('count'); refuse.add('page');
    const bothDown = await call();
    ok(bothDown.status === 500 && bothDown.body.error === 'read_failed',
      'both queries failing is a real read failure and still answers 500 -- the case a naive test would have used, which passes against the broken code too');

    /* ---- 1f. The page half keeps paging while the count is down ---------- */
    reset([row('c1'), row('c2'), row('c3')]);
    refuse.add('count');
    const paged = await call({ limit: 2 });
    ok(paged.status === 200 && paged.body.has_more === true && !!paged.body.next_cursor,
      'pagination still works with no count at all: has_more and the cursor come from the fetched page');
    ok(paged.body.total === null, 'and total stays null rather than being back-filled from the page length');

    /* ---- 1g. The count is taken strictly AFTER the page it certifies ----- */
    /* The two queries are independent PostgREST requests in independent
       transactions. Fired concurrently they observe two different database
       states, so a count could be taken BEFORE the page it is meant to
       validate: delete an older row in that window and the count returns one
       too high for a page that is perfectly current, and a caller checking
       `rows.length === total` refuses a thread nothing is wrong with. The
       Workload reader does exactly that check, so the ordering is load-bearing
       rather than cosmetic. It also means a failed page never pays for the
       count's unbounded scan. */
    reset();
    await call();
    ok(seen.join(',') === 'page,count',
      'the page is read first and the count strictly after it (' + seen.join(',') + ')');

    reset();
    refuse.add('page');
    await call();
    ok(seen.join(',') === 'page' && !seen.includes('count'),
      'and a failed page skips the count entirely rather than paying for a scan whose answer is about to be thrown away');

    /* ---- 1h. An empty thread is still 0, not null ------------------------ */
    reset([]);
    const empty = await call();
    ok(empty.status === 200 && empty.body.total === 0,
      'a thread with no comments still counts 0 -- null means "not counted", never "counted zero"');

    /* =================================================================== */
    /* Part 2 -- the real browser module, fed the real response            */
    /* =================================================================== */
    /*
     * The fix is only worth anything if the browser draws the feed. The comment
     * module is an IIFE inside index.html, so it is sliced by its own
     * boundaries and executed here. The state path runs for real, including the
     * extracted `_prodCommentMerge` / `_prodCommentNormalize` it calls. The pure
     * row-HTML helpers are recording stubs: what is under test is which STATE
     * the module lands in and which rows reach the renderer, not the markup of a
     * comment row (which prod-comments-browser.js covers).
     */
    const INDEX = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const moduleStart = INDEX.indexOf('const _prodComments = (() => {');
    const apiLine = INDEX.indexOf('return { clear, ensure, refresh, retry, loadOlder, signIn, render, find, adopt, readCanonical };', moduleStart);
    const moduleEnd = INDEX.indexOf('})();', apiLine);
    assert.ok(moduleStart > 0 && apiLine > moduleStart && moduleEnd > apiLine, 'could not locate the comments module');
    const MODULE = INDEX.slice(moduleStart, moduleEnd + '})();'.length);

    const helpers = ['_prodCommentTruthy', '_prodHashText', '_prodCommentNormalize', '_prodCommentMerge', '_prodFeedbackState']
      .map(name => {
        const fn = extractFunction(INDEX, name);
        assert.ok(fn, 'could not extract ' + name);
        return fn;
      }).join('\n');

    const rendered = [];
    const sandbox = {
      // Recording stubs for presentation only.
      _prodCommentHTML: (comment) => { rendered.push(comment && comment.id); return '<div class="prod-comment" data-id="' + (comment && comment.id) + '"></div>'; },
      _prodCommentLoadingHTML: () => '<div class="prod-comment-skeleton"></div>',
      _prodFeedbackHTML: () => '',
      _calEsc: v => String(v == null ? '' : v),
      _jsAttrArg: v => JSON.stringify(String(v)),
      // Environment the module reads.
      PROD_COMMENTS_EF_URL: 'https://fixture.invalid/functions/v1/production-comments',
      PROD_COMMENTS_PAGE_SIZE: 25,
      PROD_COMMENTS_READ_TIMEOUT_MS: 15000,
      CAL_SUPABASE_ANON_KEY: 'sb_publishable_fixture',
      _isClientLink: false,
      _prodIssue: () => null,
      _prodRender: () => {},
      _prodClientCommentSurfaceKey: surface => JSON.stringify(surface || null),
      _syncviewEfHeaders: () => ({ 'content-type': 'application/json' }),
      _syncviewStaffIdentityForHeaders: () => ({ actor: 'Fixture Reviewer' }),
      _syncviewOpenStaffIdentity: () => {},
      _syncviewClientWriteToken: () => '',
      console, JSON, Promise, Math, Date, Array, Object, String, Number, Boolean,
      Map, Set, Error, isNaN, parseInt, parseFloat, structuredClone,
      setTimeout, clearTimeout, AbortController,
    };
    let served = null;
    sandbox.fetch = async () => ({
      ok: served.status >= 200 && served.status < 300,
      status: served.status,
      json: async () => served.body,
    });

    const proxy = new Proxy(sandbox, {
      has: () => true,
      get: (t, k) => {
        if (k === Symbol.unscopables) return undefined;
        if (!(k in t)) throw new Error('the comment module reached for an unstubbed global: ' + String(k));
        return t[k];
      },
      set: (t, k, v) => { t[k] = v; return true; },
    });
    // eslint-disable-next-line no-new-func
    const build = new Function('__scope', 'with (__scope) { ' + helpers + '\n' + MODULE + '\nreturn _prodComments; }');
    const prodComments = build(proxy);

    // readCanonical is the awaitable entry point the detail pane and both
    // comment modals go through; ensure() is fire-and-forget and would be
    // measured before its own fetch resolved.
    async function browserRender(response) {
      served = response;
      prodComments.clear(target.id);
      rendered.length = 0;
      const state = await prodComments.readCanonical(target.id, { replace: true });
      return { html: prodComments.render(target.id), status: state && state.status };
    }

    /* ---- 2a. The count-down response renders as a normal feed ------------ */
    const feed = await browserRender(countDown);
    ok(/data-prod-comments-state="ready"/.test(feed.html),
      'the browser renders the READY feed for a response whose total is null');
    ok(!/Comments could not load\./.test(feed.html) && !/data-prod-comments-state="error"/.test(feed.html),
      'and does NOT paint "Comments could not load." -- the whole point of the repair');
    ok(rendered.join(',') === 'c1,c2,c3',
      'all three comments reach the row renderer (' + rendered.join(',') + ')');
    ok(!/total/i.test(feed.html),
      'the feed never displayed the count in the first place, which is why nulling it costs the reader nothing visible');

    /* ---- 2b. Counterfactual: the 500 is what used to happen -------------- */
    const broken = await browserRender(pageDown);
    ok(/data-prod-comments-state="error"/.test(broken.html) && /Comments could not load\./.test(broken.html),
      'and the 500 the endpoint still returns for a genuine page failure DOES paint the error state -- so 2a is a real difference, not a renderer that never errors');
    ok(rendered.length === 0, 'with no rows rendered on that path');

    /* ---- 2c. A numeric total is still handled identically ---------------- */
    const baseline = await browserRender(clean);
    ok(/data-prod-comments-state="ready"/.test(baseline.html) && rendered.join(',') === 'c1,c2,c3',
      'an unchanged response with a numeric total renders exactly the same, so nothing regressed for the normal path');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(failures === 0
    ? '\nproduction-comments total fail-open checks passed'
    : '\n' + failures + ' total fail-open check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
})().catch(error => { console.error(error); process.exit(1); });

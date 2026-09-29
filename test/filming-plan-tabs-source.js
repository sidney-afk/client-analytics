'use strict';
// filming-plan-tabs Edge Function (docs/plans/2026-09-28-n8n-exit.md, PR 1a):
// the pure logic under Node, plus static wiring checks on the handler, the
// migration and the deploy lane. Nothing here touches a network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HANDLER = read('supabase/functions/filming-plan-tabs/index.ts');
const MIGRATION = read('migrations/2026-09-29-filming-plan-tabs-cache.sql');
const CONFIG = read('supabase/config.toml');

const ID = (c) => c.repeat(44);
const A = ID('a'), B = ID('b'), C = ID('c');

function deps(over = {}) {
  const calls = { google: [], n8n: [], writes: [] };
  const store = over.store || new Map();
  const d = {
    calls,
    now: () => Date.parse('2026-09-29T12:00:00Z'),
    cacheRead: async (ids) => new Map(ids.filter((i) => store.has(i)).map((i) => [i, store.get(i)])),
    cacheWrite: async (id, tabs, source) => { calls.writes.push({ id, source }); },
    googleTabs: async (id) => { calls.google.push(id); return { ok: true, tabs: [{ tabId: 't.0', title: 'June 2026', url: 'u' }] }; },
    n8nTabs: async (id) => { calls.n8n.push(id); return { ok: true, tabs: [{ tabId: 'n.0', title: 'May 2026', url: 'u' }] }; },
  };
  return Object.assign(d, over.deps || {}, { calls });
}

(async () => {
  const T = await import(path.join(ROOT, 'supabase/functions/filming-plan-tabs/tabs.mjs'));

  // --- parsing -----------------------------------------------------------
  const q = (s) => new URLSearchParams(s);
  assert.deepEqual(T.parseDocIds(q('doc=' + A)), { ids: [A], bulk: false });
  assert.deepEqual(T.parseDocIds(q('docs=' + A + ',' + B + ',' + A)), { ids: [A, B], bulk: true }, 'bulk dedupes, keeps order');
  assert.equal(T.parseDocIds(q('')).error, 'doc_required');
  assert.equal(T.parseDocIds(q('doc=' + A + '&docs=' + B)).error, 'doc_and_docs_together');
  assert.equal(T.parseDocIds(q('doc=short')).error, 'invalid_doc_id');
  assert.equal(T.parseDocIds(q('doc=' + A + '/../x')).error, 'invalid_doc_id', 'no path tricks in a Doc id');
  const many = Array.from({ length: T.MAX_DOCS + 1 }, (_, i) => String(i).padStart(2, '0') + 'x'.repeat(30)).join(',');
  assert.equal(T.parseDocIds(q('docs=' + many)).error, 'too_many_docs');

  // --- shaping: the same walk the n8n "Shape Tabs" node did ---------------
  const shaped = T.shapeTabs(A, { tabs: [
    { tabProperties: { tabId: 't.1', title: 'June 2026' }, childTabs: [{ tabProperties: { tabId: 't.1a', title: 'Notes' } }] },
    { tabProperties: { title: 'no id' } },
    { tabProperties: { tabId: 't.2' } },
  ] });
  assert.deepEqual(shaped, [
    { tabId: 't.1', title: 'June 2026', url: 'https://docs.google.com/document/d/' + A + '/edit?tab=t.1' },
    { tabId: 't.1a', title: 'Notes', url: 'https://docs.google.com/document/d/' + A + '/edit?tab=t.1a' },
    { tabId: 't.2', title: '', url: 'https://docs.google.com/document/d/' + A + '/edit?tab=t.2' },
  ], 'parent before child, tabs without an id skipped, missing title becomes ""');
  assert.deepEqual(T.shapeTabs(A, {}), [], 'a Doc with no tabs answers an empty list');
  assert.equal(T.DOCS_FIELDS, 'title,tabs(tabProperties(tabId,title,index),childTabs(tabProperties(tabId,title,index)))', 'same Docs field mask as the n8n workflow');

  // --- the normal path makes ZERO n8n requests ---------------------------
  {
    const d = deps();
    const r = await T.resolveDocs([A, B, C], d);
    assert.equal(d.calls.n8n.length, 0, 'readable Docs never reach n8n');
    assert.deepEqual(d.calls.google.sort(), [A, B, C].sort());
    assert.deepEqual(Object.keys(r.fallback), []);
    const one = T.buildResponse([A], false, r, 'sa@example.iam.gserviceaccount.com');
    assert.deepEqual(Object.keys(one.body), ['ok', 'docId', 'tabs'], 'single-doc answer is exactly { ok, docId, tabs }');
    assert.equal(one.status, 200);
    const bulk = T.buildResponse([A, B, C], true, r, 'sa@example.iam.gserviceaccount.com');
    assert.deepEqual(Object.keys(bulk.body), ['ok', 'docs'], 'no share_with or fallback keys when nothing fell back');
    for (const id of [A, B, C]) assert.deepEqual(Object.keys(bulk.body.docs[id]), ['ok', 'docId', 'tabs'], 'each bulk entry is the single-doc answer');
  }

  // --- cache -------------------------------------------------------------
  {
    const store = new Map([[A, { tabs: [{ tabId: 'c.0', title: 'April 2026', url: 'u' }], fetched_at: '2026-09-29T10:00:00Z' }]]);
    const d = deps({ store });
    const r = await T.resolveDocs([A], d);
    assert.equal(d.calls.google.length + d.calls.n8n.length, 0, 'a fresh cached copy makes no Google or n8n call');
    assert.equal(r.sources[A], 'cache');
    const r2 = await T.resolveDocs([A], d, { refresh: true });
    assert.equal(d.calls.google.length, 1, 'refresh=1 re-reads from Google');
    assert.equal(r2.sources[A], 'google');
    assert.deepEqual(d.calls.writes, [{ id: A, source: 'google' }], 'and rewrites the cache');
    const old = new Map([[A, { tabs: [], fetched_at: '2026-09-29T08:00:00Z' }]]);
    const d3 = deps({ store: old });
    await T.resolveDocs([A], d3);
    assert.equal(d3.calls.google.length, 1, 'a copy older than the TTL is re-read');
  }

  // --- a Doc Google cannot read falls back to n8n, and says so -----------
  {
    const d = deps({ deps: { googleTabs: async (id) => (id === B ? { ok: false, status: 403, reason: 'PERMISSION_DENIED' } : { ok: true, tabs: [{ tabId: 't.0', title: 'June 2026', url: 'u' }] }) } });
    const r = await T.resolveDocs([A, B, C], d);
    assert.deepEqual(d.calls.n8n, [B], 'only the unreadable Doc goes to n8n');
    assert.equal(r.sources[B], 'n8n');
    assert.equal(r.sources[A], 'google');
    assert.deepEqual(r.fallback, { [B]: { status: 403, reason: 'PERMISSION_DENIED' } });
    assert.ok(d.calls.writes.some((w) => w.id === B && w.source === 'n8n'), 'the n8n answer is cached so the next open does not hit n8n again');
    const out = T.buildResponse([A, B, C], true, r, 'sa@example.iam.gserviceaccount.com');
    assert.equal(out.body.share_with, 'sa@example.iam.gserviceaccount.com', 'the service account email is reported');
    assert.deepEqual(out.body.fallback, r.fallback);
    assert.equal(out.body.docs[B].ok, true);
    const single = T.buildResponse([B], false, { docs: { [B]: r.docs[B] }, sources: {}, fallback: r.fallback }, 'sa@example.iam.gserviceaccount.com');
    assert.deepEqual(Object.keys(single.body).sort(), ['docId', 'fallback', 'ok', 'share_with', 'tabs'], 'single-doc answer gains only the two report keys');
  }

  // --- both fail: stale copy, then a per-Doc error, never a whole-call failure
  {
    const stale = new Map([[A, { tabs: [{ tabId: 's.0', title: 'March 2026', url: 'u' }], fetched_at: '2026-09-28T00:00:00Z' }]]);
    const d = deps({ store: stale, deps: { googleTabs: async () => ({ ok: false, status: 404, reason: '' }), n8nTabs: async () => ({ ok: false }) } });
    const r = await T.resolveDocs([A, B], d);
    assert.equal(r.sources[A], 'stale-cache');
    assert.equal(r.docs[A].ok, true);
    assert.deepEqual(r.docs[B], { ok: false, docId: B, error: 'tabs_unavailable' });
    assert.equal(T.buildResponse([B], false, { docs: { [B]: r.docs[B] }, sources: {}, fallback: r.fallback }, '').status, 502);
    assert.equal(T.buildResponse([A, B], true, r, '').status, 200, 'bulk stays 200 with per-Doc flags');
  }

  // --- static wiring -----------------------------------------------------
  assert(/authorizeStaffKey\(supplied, \["admin", "smm", "creative"\]/.test(HANDLER), 'staff role key required');
  assert(HANDLER.indexOf('requireStaff(req)') < HANDLER.indexOf('searchParams.get("whoami")'), 'auth runs before anything else, whoami included');
  assert(HANDLER.includes('documents.readonly'), 'Docs read-only scope');
  assert(HANDLER.includes('GOOGLE_SERVICE_ACCOUNT_JSON') && HANDLER.includes('GOOGLE_CLIENT_EMAIL') && HANDLER.includes('GOOGLE_PRIVATE_KEY'), 'reads the same service account variables the other functions use');
  // No response line may mention the key or a token: only the email is ever reported.
  const responseLines = HANDLER.split('\n').filter((l) => /\bjson\(/.test(l) && !/^\s*function json/.test(l));
  assert(responseLines.length >= 5, 'found the handler responses');
  assert(responseLines.every((l) => !/creds\.key|private_key|token|assertion/i.test(l)), 'no response carries the key or a token');
  assert(/service_account_email: creds \? creds\.email/.test(HANDLER) && /creds \? creds\.email : ""/.test(HANDLER), 'only the email is ever reported');
  assert(HANDLER.includes('await db.from("filming_plan_tabs_cache").upsert('), 'cache written with service role');
  assert(/\[functions\.filming-plan-tabs\]\s*\nverify_jwt = false/.test(CONFIG), 'config.toml registers the function');
  assert(/revoke all on table public\.filming_plan_tabs_cache from public, anon, authenticated, service_role/.test(MIGRATION), 'revoke names all four roles');
  assert(/grant select, insert, update on table public\.filming_plan_tabs_cache to service_role/.test(MIGRATION), 'service_role gets back only what it needs');
  assert(/enable row level security/.test(MIGRATION), 'RLS on');
  assert(/^-- NOT APPLIED/m.test(MIGRATION), 'migration is written, not applied');
  // PR 1b: Kasper uses the function only behind the runtime flag, and keeps n8n as the default and the fallback.
  const frag = read('src/index/321-kasper-dashboard-replies.js.part');
  assert(frag.includes("/functions/v1/filming-plan-tabs"), 'Kasper knows the function URL');
  assert(frag.includes("FILMING_PLAN_TABS_URL + '?doc='"), 'and still has the n8n webhook call, as the default and the fallback');
  assert(frag.includes("'filming_plan_tabs_source'") && /value\.mode === 'function'\) \? 'function' : 'n8n'/.test(frag), 'the function is used only for the exact flag value, n8n otherwise');

  console.log('FILMING_PLAN_TABS_SOURCE_OK');
})().catch((e) => { console.error(e); process.exit(1); });

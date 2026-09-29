// Pure logic for the filming-plan-tabs Edge Function. No Deno or network APIs
// here so test/filming-plan-tabs-source.js can run it under Node.
//
// It replaces the n8n webhook `filming-plan-tabs`, which answered
// GET ?doc=<docId> with { ok, docId, tabs: [{ tabId, title, url }] } by asking
// the Google Docs API for the tab list. This keeps that answer byte for byte
// and adds a bulk form so Kasper's Filming view asks once instead of once per
// client.

export const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
export const MAX_DOCS = 60;
export const DOC_ID_RE = /^[A-Za-z0-9_-]{20,100}$/;

// The Docs API field mask the n8n workflow used, unchanged, so a Doc reads the
// same here as there (child tabs one level deep, as before).
export const DOCS_FIELDS =
  "title,tabs(tabProperties(tabId,title,index),childTabs(tabProperties(tabId,title,index)))";

const clean = (v) => String(v == null ? "" : v).trim();

// Accepts ?doc=<id> (single) or ?docs=<id>,<id>,... (bulk). Never both.
export function parseDocIds(params) {
  const single = clean(params.get("doc"));
  const bulk = clean(params.get("docs"));
  if (single && bulk) return { error: "doc_and_docs_together" };
  const raw = single ? [single] : bulk.split(",").map(clean).filter(Boolean);
  if (!raw.length) return { error: "doc_required" };
  const ids = [];
  for (const id of raw) {
    if (!DOC_ID_RE.test(id)) return { error: "invalid_doc_id" };
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > MAX_DOCS) return { error: "too_many_docs" };
  return { ids, bulk: !single };
}

// Same walk as the n8n "Shape Tabs" node: depth first, child tabs after their
// parent, tabs without a tabId skipped.
export function shapeTabs(docId, googleDoc) {
  const out = [];
  const walk = (tabs) => {
    if (!Array.isArray(tabs)) return;
    for (const t of tabs) {
      const p = (t && t.tabProperties) || {};
      if (p.tabId) {
        out.push({
          tabId: p.tabId,
          title: p.title || "",
          url: "https://docs.google.com/document/d/" + docId + "/edit?tab=" + p.tabId,
        });
      }
      if (t && Array.isArray(t.childTabs)) walk(t.childTabs);
    }
  };
  walk(googleDoc && googleDoc.tabs);
  return out;
}

export function entryFor(docId, tabs) {
  return { ok: true, docId, tabs };
}

export function cacheFresh(fetchedAt, now, ttlMs = CACHE_TTL_MS) {
  const t = Date.parse(fetchedAt);
  return Number.isFinite(t) && now - t >= 0 && now - t < ttlMs;
}

// deps: { cacheRead(ids) -> Map(id -> {tabs, fetched_at}), cacheWrite(id, tabs, source),
//         googleTabs(id) -> {ok, tabs?, status?, reason?},
//         n8nTabs(id) -> {ok, tabs?}, now() }
// Order per doc: fresh cache, then Google, then n8n (only when Google could not
// read the Doc), then a stale cached copy, then a per-doc failure. One Doc
// failing never affects another.
export async function resolveDocs(ids, deps, opts = {}) {
  const now = deps.now ? deps.now() : Date.now();
  const cached = opts.refresh ? new Map() : await deps.cacheRead(ids);
  const staleCopies = opts.refresh ? await deps.cacheRead(ids) : cached;
  const docs = {};
  const sources = {};
  const fallback = {};

  const one = async (id) => {
    const hit = cached.get(id);
    if (hit && cacheFresh(hit.fetched_at, now)) {
      docs[id] = entryFor(id, hit.tabs);
      sources[id] = "cache";
      return;
    }
    const g = await deps.googleTabs(id);
    if (g && g.ok) {
      await deps.cacheWrite(id, g.tabs, "google");
      docs[id] = entryFor(id, g.tabs);
      sources[id] = "google";
      return;
    }
    fallback[id] = { status: (g && g.status) || 0, reason: (g && g.reason) || "" };
    const n = await deps.n8nTabs(id);
    if (n && n.ok) {
      await deps.cacheWrite(id, n.tabs, "n8n");
      docs[id] = entryFor(id, n.tabs);
      sources[id] = "n8n";
      return;
    }
    const stale = staleCopies.get(id);
    if (stale) {
      docs[id] = entryFor(id, stale.tabs);
      sources[id] = "stale-cache";
      return;
    }
    docs[id] = { ok: false, docId: id, error: "tabs_unavailable" };
    sources[id] = "none";
  };

  // Small pool so 34 Docs never open 34 sockets at once.
  const queue = ids.slice();
  const worker = async () => { while (queue.length) await one(queue.shift()); };
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker));
  return { docs, sources, fallback };
}

// One-doc responses stay exactly { ok, docId, tabs }. Only when a Doc had to
// fall back do the extra keys appear, so nobody sees them on the normal path.
export function buildResponse(ids, bulk, result, serviceAccountEmail) {
  const fellBack = Object.keys(result.fallback);
  const extra = {};
  if (fellBack.length) {
    extra.share_with = serviceAccountEmail || "";
    extra.fallback = result.fallback;
  }
  if (bulk) return { status: 200, body: Object.assign({ ok: true, docs: result.docs }, extra) };
  const entry = result.docs[ids[0]];
  return {
    status: entry.ok ? 200 : 502,
    body: Object.assign({}, entry, extra),
  };
}

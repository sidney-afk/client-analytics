'use strict';
// Fakes for the TikTok upload tests: a Post For Me that keeps posts, accounts and results in memory, and a
// queue table with the same behaviour as public.tiktok_uploads (newest sort_at first; a copy never overwrites
// a row that is already there). No network. Fixture names only.

const OPEN = ['queued', 'uploading', 'processing', 'scheduled'];

// accounts: { spc_id: platform }. Knobs on the returned function (fn.mode, fn.createError) switch failures on.
function fakePostForMe({ accounts = {}, posts = {}, results = {}, webhooks = [] } = {}) {
  const calls = [];
  let hooks = 0;
  let mints = 0, made = 0;
  const fn = async (method, path, body) => {
    calls.push({ method, path, body });
    if (fn.mode === 'down') return { ok: false, status: 0, data: {} };
    let m;
    if (method === 'POST' && path === '/media/create-upload-url') {
      if (fn.mode === 'mint_fails') return { ok: false, status: 500, data: { message: 'boom' } };
      mints++;
      return { ok: true, status: 200, data: { upload_url: 'https://storage.postforme.test/upload-' + mints, media_url: 'https://data.postforme.dev/fixture/media-' + mints } };
    }
    if (path === '/webhooks' && method === 'GET') return { ok: true, status: 200, data: { data: webhooks.map((w) => ({ ...w })) } };
    if (path === '/webhooks' && method === 'POST') {
      hooks++;
      const w = { id: 'wh_fixture_' + hooks, url: body.url, event_types: body.event_types, secret: 'whsec_fixture_' + hooks };
      webhooks.push(w);
      return { ok: true, status: 200, data: { ...w } };
    }
    if ((m = /^\/webhooks\/(.+)$/.exec(path)) && method === 'DELETE') {
      const i = webhooks.findIndex((w) => w.id === decodeURIComponent(m[1]));
      if (i < 0) return { ok: false, status: 404, data: {} };
      webhooks.splice(i, 1);
      return { ok: true, status: 200, data: { success: true } };
    }
    if ((m = /^\/social-accounts\/(.+)$/.exec(path))) {
      const id = decodeURIComponent(m[1]);
      return accounts[id] ? { ok: true, status: 200, data: { id, platform: accounts[id] } } : { ok: false, status: 404, data: {} };
    }
    if (method === 'POST' && path === '/social-posts') {
      if (fn.createError) return { ok: false, status: 400, data: { message: fn.createError } };
      made++;
      const id = 'sp_fixture_' + made;
      posts[id] = { id, status: body.scheduled_at ? 'scheduled' : 'processing', external_id: body.external_id, body };
      return { ok: true, status: 200, data: { id, status: posts[id].status, external_id: body.external_id } };
    }
    if ((m = /^\/social-posts\?external_id=(.+)$/.exec(path))) {
      const ext = decodeURIComponent(m[1]);
      return { ok: true, status: 200, data: { data: Object.values(posts).filter((p) => p.external_id === ext) } };
    }
    if ((m = /^\/social-post-results\?post_id=(.+)$/.exec(path))) {
      if (fn.mode === 'results_fail') return { ok: false, status: 500, data: {} };
      return { ok: true, status: 200, data: { data: results[decodeURIComponent(m[1])] || [] } };
    }
    if ((m = /^\/social-posts\/(.+)$/.exec(path))) {
      const id = decodeURIComponent(m[1]);
      if (method === 'GET') return posts[id] ? { ok: true, status: 200, data: posts[id] } : { ok: false, status: 404, data: {} };
      if (method === 'DELETE') {
        if (!posts[id]) return { ok: false, status: 404, data: {} };
        if (fn.mode === 'refuse_delete') return { ok: false, status: 500, data: { message: 'Internal server error when deleting the Post.' } };
        delete posts[id];
        return { ok: true, status: 200, data: { success: true } };
      }
    }
    throw new Error('unexpected Post For Me call ' + method + ' ' + path);
  };
  fn.calls = calls;
  fn.posts = posts;
  fn.results = results;
  fn.webhooks = webhooks;
  fn.mode = '';
  fn.createError = '';
  return fn;
}

function fakeQueueTable({ rows = [], profiles = [] } = {}) {
  const table = new Map(rows.map((r) => [r.id, { ...r }]));
  const sortAt = (r) => Date.parse(r.scheduled_for || r.created_at || 0) || 0;
  const store = {
    table,
    failSave: false,
    async get(id) { return table.has(id) ? { ...table.get(id) } : null; },
    async insert(row) {
      if (table.has(row.id)) throw new Error('duplicate key');
      table.set(row.id, { ...row });
    },
    async save(row) {
      if (store.failSave) throw new Error('write failed');
      if (!table.has(row.id)) throw new Error('no such row');
      table.set(row.id, { ...table.get(row.id), ...row });
    },
    async list(limit) { return [...table.values()].sort((a, b) => sortAt(b) - sortAt(a)).slice(0, limit).map((r) => ({ ...r })); },
    async profiles() { return profiles.map((p) => ({ ...p })); },
    async dueOpen(limit) {
      const now = Date.now();
      const asked = (r) => (r.last_checked_at ? Date.parse(r.last_checked_at) || 0 : 0);
      return [...table.values()].filter((r) => OPEN.includes(r.status) && (!r.scheduled_for || Date.parse(r.scheduled_for) <= now))
        .sort((a, b) => asked(a) - asked(b)).slice(0, limit).map((r) => ({ ...r }));
    },
    async byPostId(postId) { const r = [...table.values()].find((x) => x.upload_post_id === postId); return r ? { ...r } : null; },
    async copy(list) {
      let added = 0;
      for (const r of list) if (!table.has(r.id)) { table.set(r.id, { ...r }); added++; }
      return added;
    },
  };
  return store;
}

// The cancel function's view of the same table (what tableQueue gives it in production).
function cancelQueueOver(store) {
  return {
    async find(id) { const row = await store.get(id); return row ? { row } : null; },
    async markCancelled(found, nowIso) { await store.save({ id: found.row.id, status: 'cancelled', error: '', updated_at: nowIso }); },
  };
}

module.exports = { fakePostForMe, fakeQueueTable, cancelQueueOver, OPEN };

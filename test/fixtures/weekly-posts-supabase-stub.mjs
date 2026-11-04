// In-memory stand-in for the Supabase client parts analytics-weekly-posts uses.
// Tables live in globalThis.__DB; the claim and commit RPCs mirror
// migrations/2026-11-04-analytics-weekly-posts.sql.
const T = () => globalThis.__DB;
const clone = x => JSON.parse(JSON.stringify(x));
class Builder {
  constructor(table) { this.table = table; this.filters = []; this.op = 'select'; this.opts = {}; }
  select() { return this; }
  upsert(rows, opts) { this.op = 'upsert'; this.rows = rows; this.opts = opts || {}; return this; }
  update(patch) { this.op = 'update'; this.patch = patch; return this; }
  eq(c, v) { this.filters.push(r => r[c] === v); return this; }
  in(c, vs) { this.filters.push(r => vs.includes(r[c])); return this; }
  maybeSingle() { this.single = true; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    const rows = (T()[this.table] = T()[this.table] || []);
    const match = rows.filter(r => this.filters.every(f => f(r)));
    if (this.op === 'update') { for (const r of match) Object.assign(r, clone(this.patch)); return { data: null, error: null }; }
    if (this.op === 'upsert') {
      const keys = this.opts.onConflict.split(',');
      for (const row of this.rows) {
        const hit = rows.find(r => keys.every(k => r[k] === row[k]));
        if (hit) { if (!this.opts.ignoreDuplicates) Object.assign(hit, clone(row)); }
        else rows.push({ state: 'pending', attempts: 0, stages: {}, lease_until: null, ...clone(row) });
      }
      return { data: null, error: null };
    }
    const out = clone(match);
    return this.single ? { data: out[0] ?? null, error: null } : { data: out, error: null };
  }
}
export function createClient() {
  return {
    from: t => new Builder(t),
    async rpc(name, a) {
      const db = T();
      if (name === 'analytics_weekly_posts_claim') {
        const now = Date.now();
        const q = (db.analytics_weekly_posts_queue = db.analytics_weekly_posts_queue || []);
        const pool = q.filter(r => r.week_of === a.p_week_of && ['pending', 'running'].includes(r.state)
          && (!r.lease_until || Date.parse(r.lease_until) < now) && r.attempts < a.p_max_attempts
          && (!a.p_slugs || a.p_slugs.includes(r.client_slug)))
          .sort((x, y) => x.attempts - y.attempts || (x.client_slug < y.client_slug ? -1 : 1)).slice(0, Math.max(1, Math.min(a.p_limit, 3)));
        for (const r of pool) { r.state = 'running'; r.attempts += 1; r.lease_until = new Date(now + a.p_lease_seconds * 1000).toISOString(); }
        return { data: clone(pool), error: null };
      }
      if (name === 'analytics_weekly_posts_commit') {
        if (globalThis.__DB_FAIL && globalThis.__DB_FAIL.commit) return { data: null, error: new Error('commit refused') };
        const tp = (db.analytics_weekly_top_posts = db.analytics_weekly_top_posts || []);
        for (const r of a.p_platforms) {
          if (r.status !== 'ok') continue;
          db.analytics_weekly_top_posts = db.analytics_weekly_top_posts.filter(x => !(x.client_slug === a.p_client_slug && x.week_of === a.p_week_of && x.platform === r.platform));
          for (const p of r.posts || []) db.analytics_weekly_top_posts.push({ client_slug: a.p_client_slug, week_of: a.p_week_of, platform: r.platform, ...clone(p) });
        }
        const m = (db.analytics_weekly_messages = db.analytics_weekly_messages || []);
        const okCount = o => Object.values(o || {}).filter(v => v === 'ok').length;
        const hit = m.find(x => x.client_slug === a.p_client_slug && x.week_of === a.p_week_of);
        const next = { client_slug: a.p_client_slug, week_of: a.p_week_of, text: a.p_text || null, platform_status: clone(a.p_platform_status) };
        if (!hit) m.push(next);
        else if (next.text && okCount(next.platform_status) >= (hit.text ? okCount(hit.platform_status) : 0)) Object.assign(hit, next);
        Object.assign(db.analytics_weekly_posts_queue.find(r => r.week_of === a.p_week_of && r.client_slug === a.p_client_slug), { state: 'done', lease_until: null });
        return { data: null, error: null };
      }
      return { data: null, error: new Error('unknown rpc ' + name) };
    },
  };
}

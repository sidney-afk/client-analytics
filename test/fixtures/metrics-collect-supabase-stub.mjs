// In-memory stand-in for the parts of the Supabase client that
// analytics-metrics-collect, analytics-top-videos-collect and analytics-market-research-collect use. State lives in globalThis.__DB (tables as
// arrays of rows); globalThis.__DB_FAIL.commit makes the commit RPC fail.
const T = () => globalThis.__DB;
const clone = x => JSON.parse(JSON.stringify(x));

class Builder {
  constructor(table) { this.table = table; this.filters = []; this.op = 'select'; this.orders = []; this._limit = null; this.opts = {}; }
  select(cols, opts) { if (this.op === 'select') this.opts = opts || {}; return this; }
  upsert(rows, opts) { this.op = 'upsert'; this.rows = rows; this.opts = opts || {}; return this; }
  update(patch) { this.op = 'update'; this.patch = patch; return this; }
  eq(c, v) { this.filters.push(r => r[c] === v); return this; }
  in(c, vs) { this.filters.push(r => vs.includes(r[c])); return this; }
  lt(c, v) { this.filters.push(r => String(r[c]) < String(v)); return this; }
  is(c, v) { this.filters.push(r => (r[c] ?? null) === v); return this; }
  order(c, o) { this.orders.push([c, o && o.ascending === false ? -1 : 1]); return this; }
  limit(n) { this._limit = n; return this; }
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
        if (hit) { if (!this.opts.ignoreDuplicates) Object.assign(hit, clone(row)); } else rows.push({ ...clone(row), state: row.state ?? 'pending', attempts: row.attempts ?? 0, stages: row.stages ?? {}, lease_until: null });
      }
      return { data: null, error: null };
    }
    let out = match.slice();
    for (const [c, d] of this.orders.slice().reverse()) out.sort((a, b) => (String(a[c]) < String(b[c]) ? -d : String(a[c]) > String(b[c]) ? d : 0));
    if (this._limit != null) out = out.slice(0, this._limit);
    if (this.opts.head) return { data: null, count: out.length, error: null };
    out = clone(out);
    if (this.single) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
}

export function createClient() {
  return {
    from: t => new Builder(t),
    async rpc(name, a) {
      const db = T();
      if (name === 'analytics_metrics_collect_claim') {
        const now = Date.now();
        const q = (db.analytics_metrics_collect_queue = db.analytics_metrics_collect_queue || []);
        const pool = q.filter(r => r.run_date === a.p_run_date && ['pending', 'running'].includes(r.state)
          && (!r.lease_until || Date.parse(r.lease_until) < now) && r.attempts < a.p_max_attempts)
          .sort((x, y) => x.attempts - y.attempts || (x.client_slug < y.client_slug ? -1 : 1)).slice(0, Math.max(1, Math.min(a.p_limit, 4)));
        for (const r of pool) { r.state = 'running'; r.attempts += 1; r.lease_until = new Date(now + a.p_lease_seconds * 1000).toISOString(); }
        return { data: clone(pool), error: null };
      }
      if (name === 'analytics_metrics_collect_commit_shadow') {
        if (globalThis.__DB_FAIL && globalThis.__DB_FAIL.commit) return { data: null, error: new Error('commit refused') };
        (db.shadow = db.shadow || []).push({ slug: a.p_client_slug, run_date: a.p_run_date, row: a.p_row, run_id: a.p_run_id });
        const pt = (db.analytics_post_tracking = db.analytics_post_tracking || []);
        for (const p of a.p_posts) {
          const hit = pt.find(r => r.post_id === p.post_id);
          if (hit) Object.assign(hit, { views_yesterday: p.views_yesterday, views_today: p.views_today, views_gained_today: p.views_gained_today });
          else pt.push(clone(p));
        }
        const row = db.analytics_metrics_collect_queue.find(r => r.run_date === a.p_run_date && r.client_slug === a.p_client_slug);
        Object.assign(row, { state: 'done', lease_until: null });
        return { data: null, error: null };
      }
      if (name === 'analytics_top_videos_collect_claim') {
        const now = Date.now();
        const q = (db.analytics_top_videos_collect_queue = db.analytics_top_videos_collect_queue || []);
        const pool = q.filter(r => r.run_date === a.p_run_date && ['pending', 'running'].includes(r.state)
          && (!r.lease_until || Date.parse(r.lease_until) < now) && r.attempts < a.p_max_attempts)
          .sort((x, y) => x.attempts - y.attempts || (x.client_slug < y.client_slug ? -1 : 1)).slice(0, Math.max(1, Math.min(a.p_limit, 4)));
        for (const r of pool) { r.state = 'running'; r.attempts += 1; r.lease_until = new Date(now + a.p_lease_seconds * 1000).toISOString(); }
        return { data: clone(pool), error: null };
      }
      if (name === 'analytics_top_videos_collect_commit_shadow') {
        if (globalThis.__DB_FAIL && globalThis.__DB_FAIL.commit) return { data: null, error: new Error('commit refused') };
        const sh = (db.top_shadow = db.top_shadow || []).filter(r => !(r.slug === a.p_client_slug && r.run_date === a.p_run_date));
        db.top_shadow = sh;
        sh.push({ slug: a.p_client_slug, run_date: a.p_run_date, rows: clone(a.p_rows), states: clone(a.p_states), run_id: a.p_run_id });
        const row = db.analytics_top_videos_collect_queue.find(r => r.run_date === a.p_run_date && r.client_slug === a.p_client_slug);
        Object.assign(row, { state: 'done', lease_until: null, outcome: clone(a.p_states) });
        return { data: null, error: null };
      }
      if (name === 'analytics_market_research_collect_claim') {
        const now = Date.now();
        const q = (db.analytics_market_research_collect_queue = db.analytics_market_research_collect_queue || []);
        for (const r of q) if (['pending', 'running'].includes(r.state) && r.attempts >= a.p_max_attempts) { r.state = 'failed'; r.last_error = 'attempts_exhausted'; }
        const today = new Date().toISOString().slice(0, 10);
        const startedToday = q.filter(r => r.started_at && r.started_at.slice(0, 10) === today).length;
        const pool = q.filter(r => ['pending', 'running'].includes(r.state) && (!r.lease_until || Date.parse(r.lease_until) < now)
          && (r.started_at || startedToday < a.p_max_new_per_day)).sort((x, y) => (x.started_at ? 0 : 1) - (y.started_at ? 0 : 1) || (x.created_at < y.created_at ? -1 : 1)).slice(0, 1);
        for (const r of pool) { r.state = 'running'; r.attempts += 1; r.started_at = r.started_at || new Date(now).toISOString(); r.lease_until = new Date(now + a.p_lease_seconds * 1000).toISOString(); }
        return { data: clone(pool), error: null };
      }
      if (name === 'analytics_market_research_collect_commit_shadow') {
        if (globalThis.__DB_FAIL && globalThis.__DB_FAIL.commit) return { data: null, error: new Error('commit refused') };
        (db.mr_shadow = db.mr_shadow || []).push({ queue_id: a.p_id, row: clone(a.p_row), outcome: clone(a.p_outcome), run_id: a.p_run_id });
        const row = db.analytics_market_research_collect_queue.find(r => r.id === a.p_id);
        Object.assign(row, { state: 'done', lease_until: null, outcome: clone(a.p_outcome), stages: { finished: true } });
        return { data: null, error: null };
      }
      return { data: null, error: new Error('unknown rpc ' + name) };
    },
  };
}

// In-memory stand-in for the Supabase client parts analytics-weekly-slack-post uses.
// Tables live in globalThis.__DB; the claim and finish RPCs mirror
// migrations/2026-11-04-analytics-weekly-slack-post.sql.
const T = () => globalThis.__DB;
const clone = x => JSON.parse(JSON.stringify(x));
class Builder {
  constructor(table) { this.table = table; this.filters = []; }
  select() { return this; }
  eq(c, v) { this.filters.push(r => r[c] === v); return this; }
  maybeSingle() { this.single = true; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    if (globalThis.__DB_FAIL && globalThis.__DB_FAIL.table === this.table) return { data: null, error: new Error('read refused') };
    if (globalThis.__DB_MISSING_COLUMN && this.table === 'client_profiles' && this.columns && this.columns.includes('slack_mention_user_id')) return { data: null, error: new Error('column missing') };
    const rows = T()[this.table] || [];
    const out = clone(rows.filter(r => this.filters.every(f => f(r))));
    return this.single ? { data: out[0] ?? null, error: null } : { data: out, error: null };
  }
}
export function createClient() {
  return {
    from: t => { const b = new Builder(t); const sel = b.select.bind(b); b.select = (cols) => { b.columns = cols || ''; return sel(); }; return b; },
    async rpc(name, a) {
      const db = T();
      const posts = (db.analytics_weekly_slack_posts = db.analytics_weekly_slack_posts || []);
      const now = globalThis.__NOW ? globalThis.__NOW() : Date.now();
      if (name === 'analytics_weekly_slack_claim') {
        if (!['allow_list', 'all'].includes(a.p_mode)) return { data: null, error: null };
        for (const p of posts) if (p.week_of === a.p_week_of && p.status === 'pending' && now - p.updated_at > 10 * 60000) { p.status = 'unknown'; p.error_class = 'stuck_pending'; p.updated_at = now; }
        const allow = (db.analytics_weekly_slack_allow || []).map(r => r.client_slug);
        const cand = (db.analytics_weekly_messages || []).filter(m => m.week_of === a.p_week_of && m.text
          && (!a.p_slugs || a.p_slugs.includes(m.client_slug)) && (a.p_mode === 'all' || allow.includes(m.client_slug)))
          .map(m => ({ m, p: posts.find(p => p.client_slug === m.client_slug && p.week_of === m.week_of) }))
          .filter(({ p }) => !p || (['failed', 'skipped'].includes(p.status) && (a.p_reset || (p.attempts < 3 && now - p.updated_at > 5 * 60000))))
          .sort((x, y) => (x.p ? x.p.attempts : 0) - (y.p ? y.p.attempts : 0) || (x.m.client_slug < y.m.client_slug ? -1 : 1));
        if (!cand.length) return { data: null, error: null };
        const { m, p } = cand[0];
        if (!p) posts.push({ client_slug: m.client_slug, week_of: m.week_of, status: 'pending', slack_ts: null, error_class: null, attempts: 1, updated_at: now });
        else Object.assign(p, { status: 'pending', attempts: a.p_reset ? 1 : p.attempts + 1, slack_ts: null, error_class: null, updated_at: now });
        return { data: m.client_slug, error: null };
      }
      if (name === 'analytics_weekly_slack_finish') {
        if (globalThis.__DB_FAIL && globalThis.__DB_FAIL.finish) return { data: null, error: new Error('finish refused') };
        const p = posts.find(x => x.client_slug === a.p_client_slug && x.week_of === a.p_week_of && x.status === 'pending');
        if (p) Object.assign(p, { status: a.p_status, slack_ts: a.p_slack_ts || null, error_class: a.p_error_class || null, updated_at: now });
        return { data: null, error: null };
      }
      return { data: null, error: new Error('unknown rpc ' + name) };
    },
  };
}

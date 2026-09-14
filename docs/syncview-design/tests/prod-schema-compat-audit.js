'use strict';
// Owner-approved narrow schema compatibility exception; all unrelated failures remain errors.
const fields = Object.freeze({ clients: ['native_project_ids'], production_deliverables_browser_v1: ['raw_attribution_project_id', 'raw_attribution_native_epoch'] });
function recoveryFor(failure, outcomes, { origin, windowMs = 15000 }) {
  if (failure.method !== 'GET' || failure.status !== 400 || !failure.body || failure.body.code !== '42703') return null;
  let u; try { u = new URL(failure.url); } catch { return null; }
  if (u.origin !== origin || u.username || u.password || u.hash) return null;
  const table = u.pathname.slice('/rest/v1/'.length);
  if (u.pathname !== '/rest/v1/' + table || !Object.hasOwn(fields, table)) return null;
  const optional = fields[table];
  if (!optional.some(field => failure.body.message === `column ${table}.${field} does not exist`)) return null;
  if (u.searchParams.getAll('select').length !== 1) return null;
  const selected = u.searchParams.get('select').split(',');
  if (selected.some(s => !/^[a-z][a-z0-9_]*$/.test(s)) || new Set(selected).size !== selected.length || !optional.every(f => selected.includes(f))) return null;
  const reduced = selected.filter(f => !optional.includes(f));
  if (!reduced.length) return null;
  u.searchParams.set('select', reduced.join(','));
  // URLSearchParams normalization only: all filter values, duplicate parameters,
  // pagination, ordering, and their order remain identical. No source fallback.
  const expected = u.href;
  return outcomes.find(next => {
    if (next.method !== 'GET' || !Number.isInteger(next.status) || next.status < 200 || next.status >= 300 || next.finished !== true || !Array.isArray(next.body)) return false;
    if (!Number.isFinite(next.startedAt) || !Number.isFinite(next.at) || !Number.isFinite(failure.at)
      || next.startedAt < failure.at || next.at < next.startedAt || next.at - failure.at > windowMs) return false;
    try { const candidate = new URL(next.url); candidate.search = candidate.searchParams.toString(); return candidate.href === expected; } catch { return false; }
  }) || null;
}
function classify(outcomes, consoles, options) {
  const recoveries = outcomes.filter(x => x.status >= 400 || x.status === 'network-error').map(failure => ({failure, success: recoveryFor(failure, outcomes, options), used: false}));
  const unresolved = recoveries.filter(r => !r.success).map(r => r.failure);
  const unexplained = consoles.filter(error => {
    if (!/^Failed to load resource:/i.test(error.message)) return true;
    const r = recoveries.find(r => r.success && !r.used && error.url === r.failure.url
      && Number.isFinite(error.at) && error.at >= r.failure.at - 1000 && error.at <= r.failure.at + 1000);
    if (!r) return true;
    r.used = true;
    return false;
  });
  return {ok: !unresolved.length && !unexplained.length, unresolved, unexplained, recovered: recoveries.filter(r => r.success).length};
}
module.exports = { recoveryFor, classify };

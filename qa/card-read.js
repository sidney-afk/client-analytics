'use strict';
const { TEST_CLIENT, requireTestClientToken } = require('./test-client-entry.js');
const { isFakeStaffKey } = require('./staff-gate-seed.js');
const CARD_TABLES = new Set(['calendar_posts', 'sample_reviews']);

// Node QA readers always use the authenticated function, independent of the
// page flag. Both transports keep credentials in memory or curl stdin.
function cardReadRequest(base, publishableKey, table, qs, env = process.env) {
  if (!CARD_TABLES.has(table)) throw new Error('QA card read table refused');
  const query = new URLSearchParams(qs);
  const clients = query.getAll('client');
  if (clients.length > 1 || (clients.length && clients[0] !== 'eq.' + TEST_CLIENT.slug)) {
    throw new Error('QA card reads are restricted to the TEST client');
  }
  query.set('client', 'eq.' + TEST_CLIENT.slug);
  query.set('table', table);
  // PostgREST accepts an omitted sort direction; the function requires it.
  if (query.has('order')) query.set('order', query.get('order').split(',').map(order =>
    /^[a-z_][a-z0-9_]*(\.(nullsfirst|nullslast))?$/.test(order)
      ? order.replace(/^([a-z_][a-z0-9_]*)/, '$1.asc') : order).join(','));
  const headers = { apikey: publishableKey, Authorization: 'Bearer ' + publishableKey };
  const staffKey = String(env.SYNCVIEW_STAFF_KEY || '').trim();
  if (staffKey) {
    if (staffKey.length > 4096 || /[\u0000-\u001f\u007f]/.test(staffKey)) throw new Error('QA staff credential invalid');
    headers['X-Syncview-Key'] = staffKey;
  } else {
    headers['X-Syncview-Client-Token'] = requireTestClientToken(env.SYNCVIEW_TEST_CLIENT_TOKEN);
  }
  return { url: new URL('/functions/v1/card-read', base).href + '?' + query, headers };
}

function cardReadRows(status, body) {
  if (!Number.isInteger(status) || status < 200 || status >= 300) throw new Error('QA card read failed (HTTP ' + Number(status) + ')');
  let rows;
  try { rows = JSON.parse(body); } catch (_) { throw new Error('QA card read returned invalid JSON'); }
  if (!Array.isArray(rows)) throw new Error('QA card read returned invalid rows');
  return rows;
}
// Staff pages use the shared synthetic entry seed. Replace only that seed's
// credential on card GETs; client tabs and genuine identities retain theirs.
function cardReadStaffHeaders(base, method, url, headers, clientEntryCtx, env = process.env) {
  if (method !== 'GET' || clientEntryCtx || !env.SYNCVIEW_STAFF_KEY) return null;
  const staffKey = String(env.SYNCVIEW_STAFF_KEY).trim();
  if (!staffKey || staffKey.length > 4096 || /[\u0000-\u001f\u007f]/.test(staffKey)) throw new Error('QA staff credential invalid');
  const target = new URL(url);
  if (target.origin !== new URL(base).origin || target.pathname !== '/functions/v1/card-read') return null;
  const out = Object.assign({}, headers || {});
  for (const [name, value] of Object.entries(out)) {
    if (name.toLowerCase() === 'x-syncview-client-token') return null;
    if (name.toLowerCase() === 'x-syncview-key') {
      if (!isFakeStaffKey(value)) return null;
      delete out[name];
    }
  }
  out['x-syncview-key'] = staffKey;
  return out;
}
module.exports = { CARD_TABLES, cardReadRequest, cardReadRows, cardReadStaffHeaders };

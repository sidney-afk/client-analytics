'use strict';
// frameio-token Edge Function: the refresh and login logic under Node with Adobe and the table faked, plus
// static checks on the function and its migration. No network: nothing reaches Adobe or the database.
// The rule under test: every refresh saves Adobe's NEW refresh token before the next caller can refresh,
// so the login never dies while it is used, and the refresh token never appears in a response.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// A fake Adobe IMS that behaves like the real one measured on 2026-10-13: each refresh spends the refresh
// token it was given (refused afterwards with 400 access_denied) and hands back a new one.
function fakeAdobe({ mode = 'normal', email = 'owner@example.test', delayMs = 0, prefix = 'rt-' } = {}) {
  const live = new Set();
  let n = 0;
  const issue = () => { const t = prefix + (++n); live.add(t); return t; };
  const codes = new Set();
  const calls = [];
  const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  const fn = async (url, init = {}) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    calls.push(url);
    if (mode === 'down') throw new Error('network down');
    if (url.includes('/ims/userinfo/v2')) return reply(200, { email });
    const p = new URLSearchParams(init.body);
    if (p.get('client_secret') !== 'secret') return reply(400, { error: 'invalid_client' });
    if (mode === 'busy') return reply(503, {});
    if (p.get('grant_type') === 'authorization_code') {
      if (!codes.has(p.get('code'))) return reply(400, { error: 'invalid_grant' });
      codes.delete(p.get('code'));
      return reply(200, { access_token: 'at-' + n, refresh_token: issue(), expires_in: 86399 });
    }
    const rt = p.get('refresh_token');
    if (!live.has(rt)) return reply(400, { error: 'access_denied' });
    live.delete(rt);
    return reply(200, { access_token: 'at-' + n + '-' + Math.random().toString(36).slice(2, 6), refresh_token: issue(), expires_in: 86399 });
  };
  return { fn, live, calls, issue, addCode: (c) => codes.add(c) };
}

// A fake table with the same claim rule as the real conditional UPDATE: only a free (or expired) lease
// on a row that holds a refresh token can be claimed.
function fakeStore() {
  const row = { exists: false };
  const s = {
    row,
    failSave: false,
    async claim(leaseId, nowIso, untilIso) {
      if (!row.exists || !row.refresh_token) return { state: 'missing' };
      if (row.lease_until && row.lease_until >= nowIso) return { state: 'busy' };
      row.lease_id = leaseId; row.lease_until = untilIso;
      return { state: 'claimed', refresh_token: row.refresh_token };
    },
    async save(leaseId, token, result, nowIso, spent) {
      if (s.failSave) throw new Error('db down');
      if (row.lease_id === leaseId) {
        Object.assign(row, { refresh_token: token, saved_at: nowIso, last_result: result, lease_id: null, lease_until: null });
      } else if (row.refresh_token === spent) {
        Object.assign(row, { refresh_token: token, saved_at: nowIso, last_result: result });
      }
      return true;
    },
    async release(leaseId, result) {
      if (row.lease_id === leaseId) { row.lease_id = null; row.lease_until = null; }
      row.last_result = result;
    },
    async setLoginState(state, exp) { row.exists = true; row.login_state = state; row.login_state_expires = exp; },
    async takeLoginState(state, nowIso) {
      if (!row.login_state || row.login_state !== state || !(row.login_state_expires > nowIso)) return false;
      row.login_state = null; row.login_state_expires = null;
      return true;
    },
    async saveLogin(token, result, nowIso) {
      row.exists = true;
      Object.assign(row, { refresh_token: token, saved_at: nowIso, last_result: result, lease_id: null, lease_until: null });
      return true;
    },
  };
  return s;
}

(async () => {
  const L = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/frameio-token/logic.mjs')).href);
  const LOGIN = 'https://project.example/functions/v1/frameio-token/login';
  const REDIRECT = 'https://project.example/functions/v1/frameio-token/callback';
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5)));
  let lease = 0;
  const refresh = (store, adobe, extra = {}) => L.refreshAccessToken({
    store, fetchFn: adobe.fn, clientId: 'cid', clientSecret: 'secret', loginUrl: LOGIN, leaseId: 'lease-' + (++lease), sleep, ...extra,
  });
  const q = (o) => new URLSearchParams(o);
  async function login(store, adobe, { email = 'owner@example.test', allowed = 'Owner@Example.test' } = {}) {
    let state = '';
    const start = await L.startLogin({ store, clientId: 'cid', redirectUri: REDIRECT, newState: () => (state = 'state-' + Math.random()) });
    adobe.addCode('code-1');
    const out = await L.finishLogin({ store, fetchFn: adobe.fn, clientId: 'cid', clientSecret: 'secret', allowedEmails: allowed, query: q({ code: 'code-1', state }) });
    return { start, out, state };
  }

  // Nothing saved yet: a clear login_needed with the login link.
  {
    const store = fakeStore(); const adobe = fakeAdobe();
    const out = await refresh(store, adobe);
    eq(out, { status: 401, body: { error: 'login_needed', login_url: LOGIN } }, 'no saved login asks for the login link');
    eq(adobe.calls.length, 0, 'Adobe is not called without a saved login');
  }

  // The one-time login: redirect to Adobe with the right scope, then "Frame.io connected" and a saved token.
  const store = fakeStore(); const adobe = fakeAdobe();
  {
    const { start, out, state } = await login(store, adobe);
    eq(start.status, 302, 'login redirects');
    const u = new URL(start.location);
    eq(u.origin + u.pathname, 'https://ims-na1.adobelogin.com/ims/authorize/v2', 'login goes to Adobe authorize v2');
    eq(u.searchParams.get('scope'), 'openid,additional_info.roles,offline_access,email,profile', 'login asks for the agreed scope');
    eq(u.searchParams.get('redirect_uri'), REDIRECT, 'login names the callback as redirect URI');
    eq(u.searchParams.get('state'), state, 'login carries the one-time state');
    eq(u.searchParams.get('response_type'), 'code', 'login asks for a code');
    eq(out, { status: 200, text: 'Frame.io connected. You can close this tab.' }, 'callback says Frame.io connected');
    ok(adobe.live.has(store.row.refresh_token), 'callback saved a live refresh token');
    eq(store.row.login_state, null, 'state is spent');
  }

  // Two POSTs in a row: both succeed, and the saved token moved on each time (the old one is dead at Adobe).
  {
    const first = store.row.refresh_token;
    const a = await refresh(store, adobe);
    const second = store.row.refresh_token;
    const b = await refresh(store, adobe);
    eq([a.status, b.status], [200, 200], 'two refreshes in a row both work');
    ok(a.body.access_token && b.body.access_token && a.body.access_token !== b.body.access_token, 'each returns a fresh access token');
    ok(first !== second && second !== store.row.refresh_token, 'the saved refresh token rotates on every refresh');
    ok(!adobe.live.has(first) && !adobe.live.has(second) && adobe.live.has(store.row.refresh_token), 'only the newest saved token is live');
    eq(Object.keys(a.body).sort(), ['access_token', 'expires_at', 'expires_in'], 'the answer carries access token fields only');
    eq(a.body.expires_in, 86399, 'expiry is passed through');
    ok(!JSON.stringify([a, b]).includes('rt-'), 'no refresh token in any answer');
    eq(store.row.lease_id, null, 'the lease is released after a refresh');
  }

  // Two callers at once: the second waits for the first, then refreshes with the newly saved token.
  {
    const slow = fakeAdobe({ delayMs: 20 });
    const st = fakeStore();
    await login(st, slow);
    const [a, b] = await Promise.all([refresh(st, slow), refresh(st, slow)]);
    eq([a.status, b.status], [200, 200], 'two simultaneous callers both get an access token');
    ok(slow.live.has(st.row.refresh_token) && slow.live.size === 1, 'the login survives two simultaneous callers');
  }

  // A login that lands while a refresh is still finishing wins: the refresh does not overwrite it.
  {
    const slow = fakeAdobe({ delayMs: 30 });
    const st = fakeStore();
    await login(st, slow);
    const pending = refresh(st, slow);
    await new Promise((r) => setTimeout(r, 5));
    await login(st, fakeAdobe({ prefix: 'rt-other-' })); // a quick login, done while the slow refresh is still at Adobe
    const fresh = st.row.refresh_token;
    eq(st.row.lease_id, null, 'the login took the row while the refresh was out');
    const out = await pending;
    eq(out.status, 200, 'the overlapping refresh still returns its access token');
    eq(st.row.refresh_token, fresh, 'a login saved during a refresh is not overwritten');
  }

  // A lease held too long: the waiting caller gives up with busy, without spending the token.
  {
    const st = fakeStore(); const ad = fakeAdobe();
    await login(st, ad);
    st.row.lease_id = 'stuck'; st.row.lease_until = '9999-01-01T00:00:00.000Z';
    let t = 0;
    const out = await refresh(st, ad, { now: () => (t += 10000) });
    eq(out.status, 503, 'a stuck lease ends in busy');
    eq(out.body.error, 'busy', 'busy is named');
  }

  // Adobe refuses the saved token: login_needed, lease released.
  {
    const st = fakeStore(); const ad = fakeAdobe();
    await login(st, ad);
    ad.live.clear();
    const out = await refresh(st, ad);
    eq(out, { status: 401, body: { error: 'login_needed', login_url: LOGIN } }, 'a refused token asks for login again');
    eq(st.row.lease_id, null, 'lease released after a refusal');
    ok(/^login_needed: access_denied$/.test(st.row.last_result), 'the refusal is recorded as a short code');
  }

  // Adobe down or rate limiting: the saved token is untouched.
  for (const mode of ['down', 'busy']) {
    const st = fakeStore(); const ad = fakeAdobe();
    await login(st, ad);
    const before = st.row.refresh_token;
    const down = fakeAdobe({ mode }); down.live.add(before);
    const out = await refresh(st, down);
    eq(out.status, 502, 'Adobe ' + mode + ' answers 502');
    eq(out.body.error, 'adobe_unavailable', 'Adobe ' + mode + ' is named');
    eq(st.row.refresh_token, before, 'Adobe ' + mode + ' leaves the saved login unchanged');
  }

  // A wrong client secret is a setup problem, not a login problem.
  {
    const st = fakeStore(); const ad = fakeAdobe();
    await login(st, ad);
    const out = await refresh(st, ad, { clientSecret: 'wrong' });
    eq([out.status, out.body.error], [500, 'not_configured'], 'invalid_client reads as not configured');
  }

  // The new token cannot be saved: today's access token still comes back, with a warning.
  {
    const st = fakeStore(); const ad = fakeAdobe();
    await login(st, ad);
    st.failSave = true;
    const out = await refresh(st, ad);
    eq(out.status, 200, 'save failure still returns the access token');
    eq(out.body.warning, 'login_not_saved', 'save failure is flagged');
    ok(!JSON.stringify(out).includes('rt-'), 'no refresh token in the warning answer');
  }

  // Callback refusals: nothing is saved.
  {
    const st = fakeStore(); const ad = fakeAdobe({ email: 'someone-else@example.test' });
    const { out } = await login(st, ad);
    eq(out.status, 403, 'another Adobe account is refused');
    eq(st.row.refresh_token, undefined, 'a refused account saves nothing');

    const st2 = fakeStore(); const ad2 = fakeAdobe();
    const r2 = await login(st2, ad2, { allowed: '' });
    eq(r2.out.status, 500, 'no allowed account configured refuses');

    const st3 = fakeStore(); const ad3 = fakeAdobe();
    await L.startLogin({ store: st3, clientId: 'cid', redirectUri: REDIRECT, newState: () => 'good' });
    ad3.addCode('c');
    const base = { store: st3, fetchFn: ad3.fn, clientId: 'cid', clientSecret: 'secret', allowedEmails: 'owner@example.test' };
    eq((await L.finishLogin({ ...base, query: q({ code: 'c', state: 'bad' }) })).status, 400, 'wrong state refused');
    eq((await L.finishLogin({ ...base, query: q({ error: 'access_denied' }) })).status, 400, 'Adobe error refused');
    eq((await L.finishLogin({ ...base, query: q({ code: 'c', state: 'good' }) })).status, 200, 'right state accepted once');
    eq((await L.finishLogin({ ...base, query: q({ code: 'c', state: 'good' }) })).status, 400, 'state cannot be reused');

    const st4 = fakeStore(); const ad4 = fakeAdobe();
    let t = Date.now();
    await L.startLogin({ store: st4, clientId: 'cid', redirectUri: REDIRECT, newState: () => 's', now: () => t });
    ad4.addCode('c');
    const late = await L.finishLogin({ store: st4, fetchFn: ad4.fn, clientId: 'cid', clientSecret: 'secret', allowedEmails: 'owner@example.test', query: q({ code: 'c', state: 's' }), now: () => t + L.LOGIN_STATE_MS + 1 });
    eq(late.status, 400, 'an expired login state is refused');
  }

  // Static: the handler, the store and the migration.
  const src = read('supabase/functions/frameio-token/index.ts');
  const logic = read('supabase/functions/frameio-token/logic.mjs');
  const sql = read('migrations/2026-10-13-frameio-token-keeper.sql');
  ok(/brokerKey\.length < 32/.test(src) && /timingSafeEqual\(given, brokerKey\)/.test(src) && src.includes('"x-broker-key"'), 'POST needs a 32+ character broker key, compared in constant time');
  ok(src.split('\n').filter((l) => /console\./.test(l)).every((l) => !/refresh_token|refreshToken|token\b/i.test(l.replace(/frameio-token/g, ''))), 'no log line mentions a token');
  ok(!/refresh_token/.test(src), 'the handler never touches the refresh token itself');
  ok(/\.or\('lease_until\.is\.null,lease_until\.lt\."/.test(logic) && /\.not\('refresh_token', 'is', null\)/.test(logic), 'the claim is one conditional UPDATE on a free lease');
  ok(/store\.save\(leaseId, nextRefresh, 'ok', iso\(now\(\)\), claim\.refresh_token\)/.test(logic)
    && /\.update\(vals\)\.eq\('id', 1\)\.eq\('refresh_token', spentToken\)/.test(logic), 'after a lost lease the save only replaces the token it spent');
  ok(/enable row level security/.test(sql), 'RLS on');
  ok(/revoke all on table public\.frameio_token_keeper from public, anon, authenticated, service_role;/.test(sql), 'revoked from all four roles');
  ok(/grant select, insert, update on table public\.frameio_token_keeper to service_role;/.test(sql), 'service_role gets select, insert, update only');
  ok(!/grant[^;]*\b(delete|truncate|all)\b[^;]*frameio_token_keeper/i.test(sql) && !/grant[^;]*frameio_token_keeper[^;]*\b(anon|authenticated|public)\b/i.test(sql.replace(/^--.*$/gm, '')), 'no other grant');

  console.log(`frameio-token-source: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });

// frameio-token logic: Adobe IMS refresh with a saved, rotating refresh token, and the one-time login.
// Kept free of Deno so test/frameio-token-source.js runs it under Node with Adobe and the table faked.
//
// The rule it keeps: Adobe hands out a NEW refresh token on every refresh and refuses the old one right
// after, so the new one is saved before anything else happens, and only one refresh runs at a time.
// The refresh token never leaves this file except into the table; responses carry access tokens only.

export const IMS = 'https://ims-na1.adobelogin.com';
export const SCOPE = 'openid,additional_info.roles,offline_access,email,profile';
export const LEASE_MS = 45000; // longer than one Adobe call (ADOBE_TIMEOUT_MS) plus the save
export const CLAIM_WAIT_MS = 30000; // how long a second caller waits for the first one's refresh
export const LOGIN_STATE_MS = 15 * 60 * 1000;
const ADOBE_TIMEOUT_MS = 20000;
const TABLE = 'frameio_token_keeper';

const clean = (v) => String(v == null ? '' : v).trim();
// Adobe error codes only ever reach the table or a response as a short word.
const code = (v) => clean(v).toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 60);
const iso = (ms) => new Date(ms).toISOString();

// One form POST to Adobe's token endpoint. Never throws: a network failure or timeout is { ok:false, status:0 }.
export async function adobeToken(fetchFn, params) {
  try {
    const resp = await fetchFn(IMS + '/ims/token/v3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(ADOBE_TIMEOUT_MS),
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data: data || {} };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

async function adobeEmail(fetchFn, clientId, accessToken) {
  try {
    const resp = await fetchFn(IMS + '/ims/userinfo/v2?client_id=' + encodeURIComponent(clientId), {
      headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
      signal: AbortSignal.timeout(ADOBE_TIMEOUT_MS),
    });
    if (!resp.ok) return '';
    const data = await resp.json().catch(() => ({}));
    return clean(data && data.email).toLowerCase();
  } catch {
    return '';
  }
}

export function authorizeUrl({ clientId, redirectUri, state }) {
  const q = new URLSearchParams({ client_id: clientId, scope: SCOPE, response_type: 'code', redirect_uri: redirectUri, state });
  return IMS + '/ims/authorize/v2?' + q.toString();
}

function accessBody(data, nowMs) {
  const expiresIn = Math.max(0, Math.floor(Number(data.expires_in) || 0));
  return { access_token: clean(data.access_token), expires_in: expiresIn, expires_at: iso(nowMs + expiresIn * 1000) };
}

async function saveWithRetry(fn, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { if (await fn()) return true; } catch { /* retried below */ }
  }
  return false;
}

// POST: one refresh. Returns { status, body } where body is the JSON to send.
export async function refreshAccessToken({ store, fetchFn, clientId, clientSecret, loginUrl, leaseId, now = Date.now, sleep }) {
  const loginNeeded = { status: 401, body: { error: 'login_needed', login_url: loginUrl } };
  const deadline = now() + CLAIM_WAIT_MS;
  let claim;
  for (;;) {
    claim = await store.claim(leaseId, iso(now()), iso(now() + LEASE_MS));
    if (claim.state !== 'busy') break;
    if (now() >= deadline) return { status: 503, body: { error: 'busy', message: 'Another refresh is still running. Try again in a minute.' } };
    await sleep(1000);
  }
  if (claim.state === 'missing') return loginNeeded;

  const r = await adobeToken(fetchFn, { grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: claim.refresh_token });
  if (!r.ok) {
    const why = code(r.data.error) || 'http_' + r.status;
    if (why === 'invalid_client' || why === 'unauthorized_client') {
      await store.release(leaseId, 'not_configured: ' + why);
      return { status: 500, body: { error: 'not_configured', message: 'Adobe refused this app\'s client id or secret.' } };
    }
    if (r.status >= 400 && r.status < 500 && r.status !== 429) {
      await store.release(leaseId, 'login_needed: ' + why);
      return loginNeeded;
    }
    // Adobe down or slow: the saved refresh token was not spent, so it stays good.
    await store.release(leaseId, 'adobe_unavailable: ' + why);
    return { status: 502, body: { error: 'adobe_unavailable', message: 'Adobe did not answer. The saved login is unchanged; try again later.' } };
  }
  const body = accessBody(r.data, now());
  if (!body.access_token) {
    await store.release(leaseId, 'adobe_unavailable: no_access_token');
    return { status: 502, body: { error: 'adobe_unavailable', message: 'Adobe answered without an access token.' } };
  }
  const nextRefresh = clean(r.data.refresh_token);
  if (nextRefresh) {
    const saved = await saveWithRetry(() => store.save(leaseId, nextRefresh, 'ok', iso(now()), claim.refresh_token));
    // The access token is still good for today, so it is returned, but the caller is told the login is at risk.
    if (!saved) return { status: 200, body: { ...body, warning: 'login_not_saved' } };
  } else {
    await store.release(leaseId, 'ok: same refresh token');
  }
  return { status: 200, body };
}

// GET /login: remember a one-time state, then send the browser to Adobe.
export async function startLogin({ store, clientId, redirectUri, newState, now = Date.now }) {
  const state = newState();
  await store.setLoginState(state, iso(now() + LOGIN_STATE_MS));
  return { status: 302, location: authorizeUrl({ clientId, redirectUri, state }) };
}

// GET /callback: check the state, swap the code, check the Adobe account, save the refresh token.
export async function finishLogin({ store, fetchFn, clientId, clientSecret, allowedEmails, query, now = Date.now }) {
  const allowed = String(allowedEmails || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return { status: 500, text: 'Not set up yet: the allowed Adobe account (FRAMEIO_LOGIN_EMAIL) is missing on the server.' };
  if (clean(query.get('error'))) return { status: 400, text: 'Adobe did not finish the login (' + code(query.get('error')) + '). Open the login link again.' };
  const authCode = clean(query.get('code'));
  const state = clean(query.get('state'));
  if (!authCode || !state) return { status: 400, text: 'This page needs the link from Adobe. Open the login link again.' };
  if (!(await store.takeLoginState(state, iso(now())))) return { status: 400, text: 'This login has expired or was already used. Open the login link again.' };

  const r = await adobeToken(fetchFn, { grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code: authCode });
  const accessToken = clean(r.data.access_token);
  const refreshToken = clean(r.data.refresh_token);
  if (!r.ok || !accessToken) return { status: 502, text: 'Adobe refused the login (' + (code(r.data.error) || 'http_' + r.status) + '). Open the login link again.' };
  if (!refreshToken) return { status: 502, text: 'Adobe did not give a long-lived login. Check the credential allows offline_access, then open the login link again.' };

  const email = await adobeEmail(fetchFn, clientId, accessToken);
  if (!email || !allowed.includes(email)) {
    return { status: 403, text: 'This Adobe account is not the one allowed to connect Frame.io here. Sign out of Adobe, then open the login link again with the right account.' };
  }
  const saved = await saveWithRetry(() => store.saveLogin(refreshToken, 'ok: login', iso(now())));
  if (!saved) return { status: 500, text: 'Adobe accepted the login but it could not be saved. Open the login link again.' };
  return { status: 200, text: 'Frame.io connected. You can close this tab.' };
}

// The table, through supabase-js with the service role. Each claim is one conditional UPDATE, so Postgres's
// row lock decides between two callers: exactly one gets the row back, the other sees "busy" and waits.
export function supabaseStore(db) {
  const t = () => db.from(TABLE);
  const must = (res) => { if (res.error) throw new Error(res.error.message || 'database error'); return res.data || []; };
  return {
    async claim(leaseId, nowIso, untilIso) {
      const got = must(await t().update({ lease_id: leaseId, lease_until: untilIso })
        .eq('id', 1).not('refresh_token', 'is', null)
        .or('lease_until.is.null,lease_until.lt."' + nowIso + '"')
        .select('refresh_token'));
      if (got.length === 1) return { state: 'claimed', refresh_token: got[0].refresh_token };
      const row = must(await t().select('id').eq('id', 1).not('refresh_token', 'is', null));
      return { state: row.length ? 'busy' : 'missing' };
    },
    async save(leaseId, refreshToken, result, nowIso, spentToken) {
      const vals = { refresh_token: refreshToken, saved_at: nowIso, last_result: result, last_result_at: nowIso };
      const mine = must(await t().update({ ...vals, lease_id: null, lease_until: null }).eq('id', 1).eq('lease_id', leaseId).select('id'));
      if (mine.length === 1) return true;
      // We lost the lease. Save only while the row still holds the token we spent: then ours is the newest
      // valid one. If it holds anything else, a login saved a newer token since, and that one wins.
      must(await t().update(vals).eq('id', 1).eq('refresh_token', spentToken).select('id'));
      return true;
    },
    async release(leaseId, result) {
      try {
        await t().update({ lease_id: null, lease_until: null, last_result: result, last_result_at: new Date().toISOString() })
          .eq('id', 1).eq('lease_id', leaseId);
      } catch { /* the lease runs out by itself */ }
    },
    async setLoginState(state, expiresIso) {
      must(await t().upsert({ id: 1, login_state: state, login_state_expires: expiresIso }, { onConflict: 'id' }).select('id'));
    },
    async takeLoginState(state, nowIso) {
      return must(await t().update({ login_state: null, login_state_expires: null })
        .eq('id', 1).eq('login_state', state).gt('login_state_expires', nowIso).select('id')).length === 1;
    },
    async saveLogin(refreshToken, result, nowIso) {
      return must(await t().update({
        refresh_token: refreshToken, saved_at: nowIso, last_result: result, last_result_at: nowIso, lease_id: null, lease_until: null,
      }).eq('id', 1).select('id')).length === 1;
    },
  };
}

'use strict';
// The connector's OAuth sign-in (supabase/functions/higgsfield-mcp/oauth.mjs),
// for apps that will not take a link with ?key= in it. Walks the whole flow an
// app makes (discover, register, sign in, swap the code, refresh) and the ways
// it must refuse. The passes here are made up.
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

(async () => {
  const { makeOAuth, isOAuthToken, redirectAllowed, CODE_TTL_S } = await import(path.join(__dirname, '..', 'supabase', 'functions', 'higgsfield-mcp', 'oauth.mjs'));
  const GOOD = 'ab'.repeat(16);
  let active = true;
  let clock = 1_000_000;
  const base = 'https://example.test/functions/v1/higgsfield-mcp';
  const mk = (secret) => makeOAuth({ secret, baseUrl: base, signinPage: 'https://site.test/signin/', checkPass: async (p) => active && p === GOOD, now: () => clock });
  const o = mk('test-secret-one');
  const call = (method, sub, body, type) => {
    const url = new URL(base + sub);
    const init = { method };
    if (body !== undefined) { init.body = body; init.headers = { 'content-type': type || 'application/json' }; }
    return o.handle(new Request(url, init), sub, url);
  };
  const b64u = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // Discovery.
  const pr = await (await call('GET', '/.well-known/oauth-protected-resource')).json();
  assert.equal(pr.resource, base);
  assert.deepEqual(pr.authorization_servers, [base]);
  for (const p of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
    const m = await (await call('GET', p)).json();
    assert.equal(m.issuer, base);
    assert.equal(m.token_endpoint, base + '/oauth/token');
    assert.deepEqual(m.code_challenge_methods_supported, ['S256']);
  }
  assert.equal(await call('GET', '/something-else'), null);
  const ch = o.challenge({});
  assert.equal(ch.status, 401);
  assert.match(ch.headers.get('www-authenticate'), /resource_metadata="https:\/\/example\.test\/functions\/v1\/higgsfield-mcp\/\.well-known\/oauth-protected-resource"/);

  // Registration.
  assert.equal(redirectAllowed('http://evil.test/cb'), false);
  assert.equal(redirectAllowed('http://localhost:3000/cb'), true);
  assert.equal((await call('POST', '/oauth/register', JSON.stringify({ redirect_uris: ['http://evil.test/cb'] }))).status, 400);
  const reg = await call('POST', '/oauth/register', JSON.stringify({ redirect_uris: ['https://app.test/cb'], client_name: 'Test <app>' }));
  assert.equal(reg.status, 201);
  const { client_id } = await reg.json();
  assert.ok(!client_id.includes('app.test'), 'client id is sealed, not readable');

  // Sign-in page.
  const verifier = b64u(crypto.randomBytes(32));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: 'https://app.test/cb', state: 'st"1', code_challenge: challenge, code_challenge_method: 'S256' });
  const pageRes = await o.handle(new Request(base + '/oauth/authorize?' + q), '/oauth/authorize', new URL(base + '/oauth/authorize?' + q));
  assert.equal(pageRes.status, 302, 'sends the person to the static sign-in page');
  const pageUrl = new URL(pageRes.headers.get('location'));
  assert.equal(pageUrl.origin + pageUrl.pathname, 'https://site.test/signin/');
  assert.equal(pageUrl.searchParams.get('app'), 'Test <app>');
  assert.equal(pageUrl.searchParams.get('host'), 'app.test');
  assert.equal(pageUrl.searchParams.get('state'), 'st"1');
  assert.equal(pageUrl.searchParams.get('error'), null);
  const badRedirect = new URLSearchParams(q); badRedirect.set('redirect_uri', 'https://evil.test/cb');
  assert.equal((await o.handle(new Request(base + '/oauth/authorize?' + badRedirect), '/oauth/authorize', new URL(base + '/oauth/authorize?' + badRedirect))).status, 400);
  const noPkce = new URLSearchParams(q); noPkce.delete('code_challenge');
  assert.equal((await o.handle(new Request(base + '/oauth/authorize?' + noPkce), '/oauth/authorize', new URL(base + '/oauth/authorize?' + noPkce))).status, 400);

  // Wrong pass, then the right one.
  const form = (pass) => { const f = new URLSearchParams(q); f.set('pass', pass); return f.toString(); };
  const wrong = await call('POST', '/oauth/authorize', form('cd'.repeat(16)), 'application/x-www-form-urlencoded');
  assert.equal(wrong.status, 302);
  const wrongUrl = new URL(wrong.headers.get('location'));
  assert.equal(wrongUrl.host, 'site.test');
  assert.equal(wrongUrl.searchParams.get('error'), '1');
  assert.ok(!wrong.headers.get('location').includes('cd'.repeat(16)), 'the typed pass never goes back into a link');
  const ok = await call('POST', '/oauth/authorize', form(GOOD), 'application/x-www-form-urlencoded');
  assert.equal(ok.status, 302);
  const back = new URL(ok.headers.get('location'));
  assert.equal(back.origin + back.pathname, 'https://app.test/cb');
  assert.equal(back.searchParams.get('state'), 'st"1');
  const code = back.searchParams.get('code');
  assert.ok(!code.includes(GOOD), 'the pass never shows in the code');

  // Token swap.
  const swap = (extra) => call('POST', '/oauth/token', new URLSearchParams({ grant_type: 'authorization_code', code, client_id, redirect_uri: 'https://app.test/cb', code_verifier: verifier, ...extra }).toString(), 'application/x-www-form-urlencoded');
  assert.equal((await swap({ code_verifier: 'wrong' })).status, 400);
  assert.equal((await swap({ redirect_uri: 'https://app.test/other' })).status, 400);
  const tok = await (await swap({})).json();
  assert.equal(tok.token_type, 'Bearer');
  assert.ok(isOAuthToken(tok.access_token));
  assert.ok(!tok.access_token.includes(GOOD) && !tok.refresh_token.includes(GOOD));
  assert.equal(await o.passFromToken(tok.access_token), GOOD);
  assert.equal(await mk('another-secret').passFromToken(tok.access_token), null, 'a token from another key does not open');
  assert.equal(await o.passFromToken(tok.access_token.slice(0, -2) + 'AA'), null, 'a changed token does not open');
  assert.equal(await o.passFromToken(tok.refresh_token), null, 'a refresh token is not an access token');

  // Expired code; expired access token; refresh.
  clock += CODE_TTL_S + 1;
  assert.equal((await swap({})).status, 400);
  clock += 31 * 24 * 3600;
  assert.equal(await o.passFromToken(tok.access_token), null);
  const ref = await call('POST', '/oauth/token', JSON.stringify({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id }));
  const tok2 = await ref.json();
  assert.equal(await o.passFromToken(tok2.access_token), GOOD);

  // Turning the person off ends refresh.
  active = false;
  assert.equal((await call('POST', '/oauth/token', JSON.stringify({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }))).status, 400);

  console.log('higgsfield-oauth: ok');
})().catch((e) => { console.error(e); process.exit(1); });

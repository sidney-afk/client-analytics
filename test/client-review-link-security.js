'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('index.html');
const edge = read('supabase/functions/client-review-link/index.ts');
const supabaseConfig = read('supabase/config.toml');

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  assert(start >= 0, 'missing function ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed function ' + name);
}

// The browser has only the public Edge Function URL. It never receives the
// service role and never reads a token from clientMap / public sheet data.
assert(source.includes("const CLIENT_REVIEW_LINK_URL = CAL_SUPABASE_URL + '/functions/v1/client-review-link'"));
assert(!/clientMap[^\n]{0,120}client_review_token/.test(source), 'public clientMap must never supply a review token');
assert(!/CLIENTS_URL[^\n]{0,300}review_token/.test(source), 'Clients Info fetch path must not consume review tokens');

const helper = extract('_syncviewIssueClientShareUrl');
const headerHelper = extract('_syncviewEfHeaders');
assert(helper.includes('_syncviewStaffIdentityForHeaders()'));
assert(helper.includes('fetch(CLIENT_REVIEW_LINK_URL'));
assert(helper.includes("headers: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, CLIENT_REVIEW_LINK_URL)"));
assert(helper.includes('body: JSON.stringify({ client: clientName })'));
assert(helper.includes("q.set('t', json.token)"));
assert(!/localStorage|sessionStorage/.test(helper), 'copy-time token result must not be cached in browser storage');
assert(!/console\./.test(helper), 'copy-time token result must not be logged');
assert(headerHelper.includes("out['X-Syncview-Key'] = identity.key"));
assert(headerHelper.includes("out['X-Syncview-Actor'] = identity.member.name"));
assert(headerHelper.includes("out['X-Syncview-Role'] = identity.role"));

for (const name of ['copyShareLink', 'calCopyShareLink', 'smCopyShareLink', '_sxrCopyShareLink']) {
  const body = extract(name);
  assert(/^async function/.test(body), name + ' must wait for authenticated issuance');
  assert(body.includes('await _syncviewIssueClientShareUrl'), name + ' must issue only at copy time');
}

const clientPreflight = extract('_syncviewPreflightClientEntry');
const clientBindingVerifier = extract('_syncviewVerifyClientLinkAccess');
assert(clientPreflight.includes('fetch(CLIENT_TOKEN_VERIFY_URL'));
assert(clientPreflight.includes('strict: true'), 'client entry must request strict verification even while the global flag is permissive');
assert(clientPreflight.includes('json.valid !== true'), 'a permissive ok response without a valid token must not authorize entry');
assert(clientPreflight.includes("cache: 'no-store'"), 'client verification response must not be browser-cached');
assert(!/clientMap|client_review_token/.test(clientPreflight), 'client boot must verify service-side only');
assert(!/localStorage|sessionStorage/.test(clientPreflight), 'raw client token must not be copied into browser storage');
assert(!/fetch\(/.test(clientBindingVerifier), 'post-preflight checks must use the verified in-memory binding, not issue a second request');
assert(clientBindingVerifier.includes('cap && cap.verified'));
assert(clientBindingVerifier.includes('_syncviewClientEntrySlug(clientName) === cap.slug'));
assert(clientBindingVerifier.includes('_syncviewInvalidClientLinkScreen()'));

const sanitizer = extract('_clientsInfoPublicRows');
const sanitizeContext = {
  CLIENTS_INFO_FORBIDDEN_FIELDS: new Set(['client_review_token']),
  parseCSV: () => [{ client_name: 'Client One', client_review_token: 'must disappear', slack_channel_id: 'C1' }],
  String,
  Object,
};
vm.createContext(sanitizeContext);
vm.runInContext(sanitizer, sanitizeContext);
const sanitized = sanitizeContext._clientsInfoPublicRows('public csv');
assert.deepStrictEqual(JSON.parse(JSON.stringify(sanitized)), [{ client_name: 'Client One', slack_channel_id: 'C1' }]);
assert(extract('_analyticsCacheWrite').includes('_clientsInfoPublicRows(cur.clients)'));
assert(extract('_analyticsCacheWrite').includes('_clientsInfoPublicRows(next.clients)'));
assert(extract('_analyticsHydrateFromCache').includes('localStorage.setItem(ANALYTICS_CACHE_KEY, JSON.stringify(c))'));

// The live-v2 issuer delegates authentication to the shared browser-write
// contract, accepts both current-main's `client` body and #813's `slug` body,
// then reads only the exact active client's service-role-only token.
assert(edge.includes('import { authorizeBrowserWrite, normalizeBrowserWriteClient } from "../_shared/browser-write-auth.ts"'));
assert(/normalizeBrowserWriteClient\(body\.client \|\| body\.slug\)/.test(edge));
assert(/authorizeBrowserWrite\(supabase, req, slug, "client-review-link"\)/.test(edge));
assert(/principal\.kind !== "staff"/.test(edge));
assert(/\.from\("clients"\)\.select\("slug,active"\)\.eq\("slug", slug\)/.test(edge));
assert(/client\.active !== true/.test(edge));
assert(/\.from\("client_access"\)[\s\S]{0,160}\.select\("review_token"\)[\s\S]{0,100}\.eq\("slug", slug\)/.test(edge));
assert(/SUPABASE_SERVICE_ROLE_KEY/.test(edge));
assert(/"Cache-Control": "no-store"/.test(edge));
const allowedHeaders = (edge.match(/"Access-Control-Allow-Headers": "([^"]+)"/) || [])[1] || '';
assert(allowedHeaders.split(/,\s*/).includes('x-syncview-actor'), 'CORS must allow staff actor metadata');
assert(allowedHeaders.split(/,\s*/).includes('x-syncview-role'), 'CORS must allow staff role metadata');
assert(/const status = Number\(\(error as \{ status\?: number \}\)\?\.status \|\| 500\)/.test(edge));
assert(/const code = String\(\(error as \{ code\?: string \}\)\?\.code \|\| "request_failed"\)/.test(edge));
assert(!/console\./.test(edge), 'issuer must never log token-bearing request/response context');
assert(!/body\.(?:token|review_token)/.test(edge), 'issuer must not accept a caller-supplied review token');
assert(/\[functions\.client-review-link\]\s+verify_jwt = false/.test(supabaseConfig));

(async () => {
  const requests = [];
  let identity = { key: 'staff-key', role: 'smm', member: { id: 'member-1', name: 'Staff One' } };
  const context = {
    CLIENT_REVIEW_LINK_URL: 'https://supabase.invalid/functions/v1/client-review-link',
    CAL_SUPABASE_URL: 'https://supabase.invalid',
    _isClientLink: false,
    _syncviewStaffIdentityForHeaders: () => identity,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true, client: 'clientone', token: 'issued token' }) };
    },
    URLSearchParams,
    location: { origin: 'https://sync.invalid', pathname: '/' },
  };
  vm.createContext(context);
  vm.runInContext([headerHelper, helper].join('\n'), context);
  const first = await context._syncviewIssueClientShareUrl('Client One', 'calendar');
  const second = await context._syncviewIssueClientShareUrl('Client One', 'calendar');
  assert.strictEqual(first, 'https://sync.invalid/?c=Client+One&v=calendar&t=issued+token');
  assert.strictEqual(second, first);
  assert.strictEqual(requests.length, 2, 'each copy action must fetch; no token cache/single-use bypass');
  for (const request of requests) {
    assert.strictEqual(request.url, context.CLIENT_REVIEW_LINK_URL);
    assert.deepStrictEqual(JSON.parse(request.options.body), { client: 'Client One' });
    assert.strictEqual(request.options.headers['X-Syncview-Key'], 'staff-key');
    assert.strictEqual(request.options.headers['X-Syncview-Actor'], 'Staff One');
    assert.strictEqual(request.options.headers['X-Syncview-Role'], 'smm');
  }

  context.fetch = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'credentials_required' }) });
  await assert.rejects(
    context._syncviewIssueClientShareUrl('Client One', 'calendar'),
    error => error && error.message === 'credentials_required',
  );
  identity = null;
  await assert.rejects(
    context._syncviewIssueClientShareUrl('Client One', 'calendar'),
    /Sign in with your staff account/,
  );

  console.log('client review-link issuer security checks: ok');
})().catch(error => { console.error(error); process.exit(1); });

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('index.html');
const edge = read('supabase/functions/client-review-link/index.ts');
const workflow = read('.github/workflows/deploy-onboarding-edge-functions.yml');
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

const helper = extract('_clientShareLinkWithReviewToken');
assert(helper.includes("_syncviewRequireStaffIdentity('review-link')"));
assert(helper.includes("'X-Syncview-Key'"));
assert(helper.includes("'X-Syncview-Actor'"));
assert(helper.includes('member_id: identity && identity.member && identity.member.id'));
assert(helper.includes('fetch(CLIENT_REVIEW_LINK_URL'));
assert(!/localStorage|sessionStorage/.test(helper), 'copy-time token result must not be cached in browser storage');
assert(!/console\./.test(helper), 'copy-time token result must not be logged');
assert(extract('_syncviewStaffCan').includes("capability === 'review-link'"));

for (const name of ['copyShareLink', 'calCopyShareLink', 'smCopyShareLink', '_sxrCopyShareLink']) {
  const body = extract(name);
  assert(/^async function/.test(body), name + ' must wait for authenticated issuance');
  assert(body.includes('await _clientShareLinkWithReviewToken'), name + ' must issue only at copy time');
}

const clientVerifier = extract('_syncviewVerifyClientLinkAccess');
assert(clientVerifier.includes('fetch(CLIENT_TOKEN_VERIFY_URL'));
assert(!/clientMap|client_review_token/.test(clientVerifier), 'client boot must verify service-side only');
assert(!/localStorage|sessionStorage/.test(clientVerifier), 'raw client token must not be copied into browser storage');

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

// The issuer authenticates a secret-derived role and exact active roster row,
// then reads only one active client's service-role-only token. It has no token
// input, response logging, anon database key, or cacheable response.
assert(/matchingRoleForKey\(key\)/.test(edge));
assert(/keyRole !== "admin" && keyRole !== "smm"/.test(edge));
assert(/\.from\("team_members"\)[\s\S]{0,220}\.eq\("id", memberId\)[\s\S]{0,100}\.eq\("active", true\)/.test(edge));
assert(/normalizeActor\(member\.name\) !== normalizeActor\(actor\)/.test(edge));
assert(/\.from\("clients"\)[\s\S]{0,220}\.eq\("slug", slug\)[\s\S]{0,100}\.eq\("active", true\)/.test(edge));
assert(/\.from\("client_access"\)[\s\S]{0,160}\.select\("review_token"\)[\s\S]{0,100}\.eq\("slug", slug\)/.test(edge));
assert(/SUPABASE_SERVICE_ROLE_KEY/.test(edge));
assert(/"Cache-Control": "no-store, private"/.test(edge));
assert(!/console\./.test(edge), 'issuer must never log token-bearing request/response context');
assert(!/body\.(?:token|review_token)/.test(edge), 'issuer must not accept a caller-supplied review token');

assert(workflow.includes("supabase/functions/client-review-link/**"));
const deployLoop = (workflow.match(/for fn in ([^;]+); do/) || [])[1] || '';
assert(/(?:^|\s)client-review-link(?:\s|$)/.test(deployLoop));
assert(/\[functions\.client-review-link\]\s+verify_jwt = false/.test(supabaseConfig));

(async () => {
  const requests = [];
  const context = {
    CLIENT_REVIEW_LINK_URL: 'https://supabase.invalid/functions/v1/client-review-link',
    _syncviewRequireStaffIdentity: async capability => {
      assert.strictEqual(capability, 'review-link');
      return { key: 'staff-key', member: { id: 'member-1', name: 'Staff One' } };
    },
    calClientSlug: () => 'client-one',
    wlNormalizeClient: () => 'client-one',
    _syncviewStaffIdentityClear: () => {},
    _syncviewOpenStaffIdentity: () => {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true, slug: 'client-one', token: 'issued token' }) };
    },
    URL,
  };
  vm.createContext(context);
  vm.runInContext(helper, context);
  const first = await context._clientShareLinkWithReviewToken('https://sync.invalid/?c=Client%20One&v=calendar', 'Client One');
  const second = await context._clientShareLinkWithReviewToken('https://sync.invalid/?c=Client%20One&v=calendar', 'Client One');
  assert.strictEqual(first, 'https://sync.invalid/?c=Client+One&v=calendar&t=issued+token');
  assert.strictEqual(second, first);
  assert.strictEqual(requests.length, 2, 'each copy action must fetch; no token cache/single-use bypass');
  for (const request of requests) {
    assert.strictEqual(request.url, context.CLIENT_REVIEW_LINK_URL);
    assert.deepStrictEqual(JSON.parse(request.options.body), { slug: 'client-one', member_id: 'member-1' });
    assert.strictEqual(request.options.headers['X-Syncview-Key'], 'staff-key');
    assert.strictEqual(request.options.headers['X-Syncview-Actor'], 'Staff One');
  }

  let cleared = 0;
  let opened = 0;
  context.fetch = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'credentials_required' }) });
  context._syncviewStaffIdentityClear = () => { cleared++; };
  context._syncviewOpenStaffIdentity = options => { assert.strictEqual(options.reason, 'required'); opened++; };
  await assert.rejects(
    context._clientShareLinkWithReviewToken('https://sync.invalid/?c=Client%20One', 'Client One'),
    error => error && error.status === 401 && error.code === 'credentials_required',
  );
  assert.strictEqual(cleared, 1);
  assert.strictEqual(opened, 1, 'credentials_required must open the existing staff sign-in');

  console.log('client review-link issuer security checks: ok');
})().catch(error => { console.error(error); process.exit(1); });

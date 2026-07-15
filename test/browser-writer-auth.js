'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const helper = read('supabase/functions/_shared/browser-write-auth.ts');
const index = read('index.html');
const writerPaths = [
  'supabase/functions/calendar-upsert/index.ts',
  'supabase/functions/calendar-reorder/index.ts',
  'supabase/functions/sample-review-upsert/index.ts',
  'supabase/functions/sample-review-reorder/index.ts',
  'supabase/functions/templates-save/index.ts',
  'supabase/functions/caption-prompts-save/index.ts',
];
const postAuthMarkers = {
  'calendar-upsert': 'const existingRead = await readExisting(',
  'calendar-reorder': 'for (const item of parsed.items)',
  'sample-review-upsert': 'const existingRead = await readExisting(',
  'sample-review-reorder': 'for (const item of parsed.items)',
  'templates-save': 'const { data: existing, error: readError }',
  'caption-prompts-save': 'const now = new Date().toISOString()',
};

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

(async () => {
  const policy = await import(pathToFileURL(path.join(
    ROOT,
    'supabase/functions/_shared/browser-write-auth-policy.mjs',
  )).href);

  ok(policy.browserWriteCredentialMode('', '') === 'missing'
    && policy.browserWriteCredentialMode('staff-secret', 'client-secret') === 'ambiguous',
  'missing and dual credentials take explicit deny paths');
  ok(policy.browserWriteCredentialMode('staff-secret', '') === 'staff'
    && policy.browserWriteCredentialMode('', 'client-secret') === 'client',
  'each single credential takes only its matching allow path');
  ok(policy.normalizeWriteClient(' Dr. Example and Partner ') === 'example&partner'
    && policy.normalizeWriteClient('Example---Partner') === 'examplepartner',
  'client display names canonicalize exactly like stored review-token slugs');

  const staff = policy.staffWriteAttribution('smm', 'Calendar Upsert');
  const automation = policy.automationWriteAttribution('Calendar Upsert');
  const client = policy.clientWriteAttribution('Example Client', 'Samples Upsert');
  ok(staff && staff.actor === 'staff:smm' && staff.role === 'smm' && staff.source === 'calendarupsert',
    'staff attribution is minted from the matched key role');
  ok(automation && automation.actor === 'staff:automation' && automation.role === 'automation'
    && automation.source === 'calendarupsert',
  'the dedicated server caller key receives fixed automation attribution');
  ok(client && client.actor === 'client:exampleclient' && client.role === 'client' && client.source === 'samplesupsert',
    'client attribution is minted from the authenticated target slug');
  ok(policy.staffWriteAttribution('forged-admin', 'calendar') === null
    && policy.clientWriteAttribution('', 'calendar') === null,
  'unknown roles and empty client scopes cannot mint principals');
  const equal = (a, b) => a === b;
  ok(policy.uniqueClientTokenSlug([
    { slug: 'alpha', review_token: 'token-a' },
    { slug: 'beta', review_token: 'token-b' },
  ], 'token-a', equal) === 'alpha',
  'one unique stored token resolves only its owning client');
  ok(policy.uniqueClientTokenSlug([
    { slug: 'alpha', review_token: 'same-token' },
    { slug: 'beta', review_token: 'same-token' },
  ], 'same-token', equal) === ''
    && policy.uniqueClientTokenSlug([], 'unknown', equal) === '',
  'duplicate and unknown stored tokens take the deny path');

  ok(/mode === "missing"[\s\S]{0,100}credentials_required/.test(helper)
    && /mode === "ambiguous"[\s\S]{0,100}ambiguous_credentials/.test(helper),
  'shared helper fails closed before any credential lookup');
  ok(/matchingRoleForKey\(staffKey\)/.test(helper)
    && /SYNCVIEW_WRITER_STAFF_KEY/.test(helper)
    && /timingSafeEqual\(staffKey, automationKey\)/.test(helper)
    && /invalid_staff_key/.test(helper),
  'staff allow path requires a configured role secret or dedicated server caller secret');
  ok(/\.from\("client_access"\)[\s\S]{0,120}\.select\("slug,review_token"\)/.test(helper)
    && /uniqueClientTokenSlug\(data, clientToken, timingSafeEqual\)/.test(helper)
    && /storedSlug !== targetSlug/.test(helper)
    && /timingSafeEqual/.test(helper),
  'client allow path rejects duplicate tokens and binds the unique match to the exact target slug');
  ok(/\.from\("clients"\)[\s\S]{0,120}\.select\("slug,active"\)/.test(helper)
    && /\.eq\("slug", storedSlug\)/.test(helper)
    && /client\.active !== true/.test(helper)
    && /invalid_client_token/.test(helper),
  'offboarded or missing clients cannot keep writing with retained bearer tokens');
  ok(!/auth_enforcement/.test(helper),
    'global permissive auth cannot weaken these service-role writers');

  for (const relative of writerPaths) {
    const source = read(relative);
    const name = relative.split('/').slice(-2, -1)[0];
    const authCall = source.indexOf('await authorizeBrowserWrite(');
    const nextOperation = source.indexOf(postAuthMarkers[name]);
    ok(authCall >= 0 && nextOperation > authCall,
      `${name} authenticates before its first target read or mutation`);
    ok(source.includes('browserWriteAuthResponse(e)')
      && source.includes('error: auth.code')
      && source.includes('auth.status'),
    `${name} preserves deny status instead of collapsing auth failures to 500`);
    ok(source.includes('x-syncview-client-token'),
      `${name} preflight permits the scoped client token`);
    ok(source.includes('normalizeBrowserWriteClient'),
      `${name} uses the canonical authenticated slug for every target read/write`);
    ok(!source.includes('req.headers.get("x-syncview-actor")')
      && !source.includes('req.headers.get("x-syncview-role")')
      && !source.includes('body.actor_name')
      && !source.includes('body.actor_role'),
    `${name} ignores caller-supplied actor and role claims`);
  }

  ok(!index.includes('[Calendar] EF reorder failed; falling back to n8n')
    && !index.includes('[Samples] EF reorder failed; falling back to n8n'),
  'a flagged reorder auth denial cannot downgrade to an anonymous n8n writer');
  const templates = read('supabase/functions/templates-save/index.ts');
  ok(/k === "client_slug" \|\| k === "client_name" \|\| k === "updated_at"/.test(templates),
    'template patch aliases cannot override the authenticated row identity');

  for (const relative of ['scripts/linear-sync-reconcile.js', 'scripts/sample-linear-reconcile.js']) {
    const source = read(relative);
    const name = path.basename(relative);
    ok(/if \(url === UPSERT_EF_URL\)/.test(source)
      && /headers\['X-Syncview-Key'\] = SYNCVIEW_STAFF_KEY/.test(source)
      && /SYNCVIEW_STAFF_KEY is required/.test(source),
    `${name} supplies a staff key only to protected EF writes and fails closed when missing`);
  }
  for (const relative of [
    '.github/workflows/linear-sync-reconcile.yml',
    '.github/workflows/sample-linear-reconcile.yml',
  ]) {
    ok(/SYNCVIEW_STAFF_KEY:\s*\$\{\{ secrets\.SYNCVIEW_STAFF_KEY \}\}/.test(read(relative)),
      `${path.basename(relative)} wires the protected writer secret`);
  }
  for (const relative of [
    'scripts/a1-calendar-upsert-parity.js',
    'scripts/a2-writer-parity.js',
    'scripts/a4-settings-backfill-parity.js',
  ]) {
    const source = read(relative);
    ok(/SYNCVIEW_STAFF_KEY/.test(source) && /X-Syncview-Key/.test(source),
      `${path.basename(relative)} keeps its TEST-only EF allow path authenticated`);
  }

  if (failures) {
    console.error(`\n${failures} browser writer auth check(s) failed`);
    process.exit(1);
  }
  console.log('\nBrowser writer auth checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});

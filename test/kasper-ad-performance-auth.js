'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SHARED_PATH = path.join(ROOT, 'supabase/functions/_shared/staff-role-auth.ts');
const SOURCE = read('supabase/functions/kasper-ad-performance-read/index.ts');
const INDEX = read('index.html');

function ok(value, message) {
  if (!value) {
    console.error('FAIL kasper-ad-performance-auth:', message);
    process.exit(1);
  }
}

ok(SOURCE.includes('../_shared/staff-role-auth.ts'), 'kasper-ad-performance-read must use the shared role-key gate');
ok(SOURCE.includes('x-syncview-key'), 'kasper-ad-performance-read CORS must allow the staff key');
ok(/authorizeStaffKey\(given, \["admin"\]\)/.test(SOURCE),
  'kasper-ad-performance-read must allow only the admin role key — it exposes real spend and booking counts');
ok(/staffAuthFailureStatus\(auth\)/.test(SOURCE),
  'kasper-ad-performance-read must return 401 for unmatched keys and 403 for disallowed role keys');
ok(SOURCE.indexOf('authorizeStaffKey(given') < SOURCE.indexOf('createClient(Deno.env.get("SUPABASE_URL")'),
  'kasper-ad-performance-read must authenticate before constructing the service-role client');
ok(!/req\.headers\.get\(["']x-syncview-role["']\)/i.test(SOURCE),
  'kasper-ad-performance-read must not trust a spoofable role header for authorization');
ok(!/\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/.test(SOURCE),
  'kasper-ad-performance-read is read-only and must never write any of its four tables');

// kasper_ad_leads and kasper_ad_unfinished_leads carry real PII (name/email/
// phone) — the console.log below must stay aggregate-only (counts), never a
// row's content, matching every other staff-sensitive function in this repo.
const logCallMatch = SOURCE.match(/console\.log\(JSON\.stringify\(([\s\S]*?)\)\)/);
ok(!!logCallMatch, 'kasper-ad-performance-read logs one aggregate line so PII exposure stays auditable');
if (logCallMatch) {
  const logBody = logCallMatch[1];
  ok(!/lead_email|lead_name|leads\[|leads\.map|leads,\s*$/.test(logBody) && /leads:\s*leads\.length/.test(logBody),
    'the log line includes only leads.length, never lead content');
  ok(!/leads\.map|leads\[|\.\.\.leads\b|\bleads\)/.test(logBody),
    'the log line never spreads, indexes, or dumps the leads array itself, only its length');
  ok(!/unfinishedLeads\.map|unfinishedLeads\[|\.\.\.unfinishedLeads\b|unfinishedLeads,\s*$/.test(logBody)
    && /unfinished_leads:\s*unfinishedLeads\.length/.test(logBody),
    'the log line includes only unfinishedLeads.length, never unfinished-lead content');
}
ok(!/console\.(log|error|warn|info|debug)\([^)]*lead_email/i.test(SOURCE)
  && !/console\.(log|error|warn|info|debug)\([^)]*lead_name/i.test(SOURCE),
  'no console call anywhere in the function references a lead\'s email or name');
ok(!/console\.(log|error|warn|info|debug)\([^)]*\bemail\b/i.test(SOURCE)
  && !/console\.(log|error|warn|info|debug)\([^)]*\bphone\b/i.test(SOURCE)
  && !/console\.(log|error|warn|info|debug)\([^)]*first_name/i.test(SOURCE)
  && !/console\.(log|error|warn|info|debug)\([^)]*last_name/i.test(SOURCE),
  'no console call anywhere in the function references an unfinished lead\'s email, phone, or name');

// The function must actually be wired up in the SPA — a literal EF URL string
// so test/truth-sync.js's endpoint scan (and ENDPOINTS.md) can see the call.
ok(INDEX.includes('functions/v1/kasper-ad-performance-read'),
  'index.html must call functions/v1/kasper-ad-performance-read (checked against docs/truth/ENDPOINTS.md by truth-sync)');
ok(/_syncviewEfHeaders\([^)]*KASPER_AD_PERF_EF_URL\)/.test(INDEX)
  || /'X-Syncview-Key':\s*[^,}]*\}\s*\)[\s\S]{0,80}KASPER_AD_PERF_EF_URL/.test(INDEX)
  || /headers:[\s\S]{0,120}x-syncview-key/i.test(INDEX.slice(INDEX.indexOf('KASPER_AD_PERF_EF_URL'), INDEX.indexOf('KASPER_AD_PERF_EF_URL') + 4000)),
  'the browser caller must send the verified staff key to kasper-ad-performance-read');

// Execute the production helper with dummy-only secrets for explicit deny and
// allow proofs without contacting live data or exposing a real role key.
const helperUrl = pathToFileURL(SHARED_PATH).href + '?kasper-ad-performance-auth';
const runner = `
  const { authorizeStaffKey, staffAuthFailureStatus } = await import(${JSON.stringify(helperUrl)});
  const secrets = {
    ROLE_KEY_ADMIN: 'dummy-admin',
    ROLE_KEY_SMM: 'dummy-smm',
    ROLE_KEY_CREATIVE: 'dummy-creative',
  };
  const getSecret = name => secrets[name];
  const check = key => {
    const auth = authorizeStaffKey(key, ['admin'], [], getSecret);
    return { ...auth, status: auth.ok ? 200 : staffAuthFailureStatus(auth) };
  };
  process.stdout.write(JSON.stringify({
    admin: check('dummy-admin'),
    smm: check('dummy-smm'),
    creative: check('dummy-creative'),
    wrong: check('dummy-wrong'),
    empty: check(''),
  }));
`;
const child = spawnSync(process.execPath, [
  '--no-warnings',
  '--experimental-strip-types',
  '--input-type=module',
  '--eval',
  runner,
], { encoding: 'utf8' });
ok(child.status === 0, `could not execute shared helper: ${child.stderr || child.stdout}`);
const matrix = JSON.parse(child.stdout);
ok(matrix.admin.ok && matrix.admin.status === 200 && matrix.admin.role === 'admin', 'admin allow path failed');
for (const role of ['smm', 'creative']) {
  ok(!matrix[role].ok && matrix[role].status === 403 && matrix[role].role === role,
    `${role} role key must be forbidden (403), not silently allowed`);
}
for (const invalid of ['wrong', 'empty']) {
  ok(!matrix[invalid].ok && matrix[invalid].status === 401, `${invalid} key must be unauthorized (401)`);
}

console.log('Kasper ad performance reader auth checks passed (admin-only allow; SMM/creative 403; absent/wrong 401; read-only)');

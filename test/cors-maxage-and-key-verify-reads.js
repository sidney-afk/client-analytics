'use strict';
/*
 * Two source-level guarantees for the 2026-10-01 sign-in speed work (owner-approved A and B1; B2 refused).
 *
 * A. Browsers may reuse a CORS preflight answer for 2 hours. Without Access-Control-Max-Age they re-ask
 *    every 5 s, so the first call to each function in a tab pays an extra round trip. Added to the hot-path
 *    functions. NOT to production-write (waits for the next sealed Section 4 deploy) and NOT to
 *    calendar-upsert (frozen by owner directive: its repo source must never be deployed).
 * B1. key-verify runs the flag read and the member read together and selects only the columns the answer
 *    uses. The audit insert still runs BEFORE the answer and still blocks sign-in when it fails (B2 refused).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = name => fs.readFileSync(path.join(ROOT, 'supabase/functions', name, 'index.ts'), 'utf8');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok  ' + m); };

const WITH = ['key-verify', 'production-comments', 'analytics-read', 'brain', 'thumbnail-revision-read', 'smm-weekly-reports', 'workload-plan'];
for (const fn of WITH) {
  const s = src(fn);
  const map = s.slice(s.indexOf('const CORS'), s.indexOf('};', s.indexOf('const CORS')));
  ok(/"Access-Control-Max-Age": "7200"/.test(map), fn + ': the CORS map lets browsers keep a preflight answer for 7200 s');
  ok(/"Access-Control-Allow-Origin": "\*"/.test(map), fn + ': the allowed origins are unchanged');
}
for (const fn of ['production-write', 'calendar-upsert']) {
  ok(!/Access-Control-Max-Age/.test(src(fn)), fn + ': left alone (sealed Section 4 deploy / frozen by owner directive)');
}

const kv = src('key-verify');
ok(/const role = matchingRoleForKey\(key\);/.test(kv), 'the role comes from a pure comparison, before any database call');
ok(/const \[mode, member\] = await Promise\.all\(\[\s*authMode\(supabase\),\s*role \? resolveMember\(supabase, body, req\) : Promise\.resolve\(null\),\s*\]\);/.test(kv),
  'the flag read and the member read run together, and the member read still happens only for a recognised key');
ok(!/const mode = await authMode/.test(kv) && !/await resolveMember/.test(kv.replace(/\[mode, member\][\s\S]*?\]\);/, '')), 'neither read is awaited on its own any more');
ok(!/\.select\("\*"\)/.test(kv) && /const MEMBER_COLUMNS = "id,name,email,role,team,active";/.test(kv) && (kv.match(/\.select\(MEMBER_COLUMNS\)/g) || []).length === 2,
  'both member reads select only id, name, email, role, team, active (the columns the answer and the role check use)');
const all = kv.indexOf('Promise.all');
const audit = kv.indexOf('await logAuth(supabase');
const okAnswer = kv.indexOf('return json({\n      ok: true');
const denyAnswer = kv.indexOf('return json({ ok: false, mode, reason, error: "key_not_valid" }, 401)');
ok(all > 0 && audit > all && audit < okAnswer && audit < denyAnswer, 'the audit row is still written, awaited, before either answer is returned (an audit failure still ends in the 500)');
ok(!/waitUntil/.test(kv), 'and it is not moved to the background');
ok(/console\.error\("key-verify failed", e\);\s*return json\(\{ ok: false, error: "verify_failed" \}, 500\)/.test(kv), 'a failed read or audit write still answers 500 verify_failed');
console.log('\ncors-maxage-and-key-verify-reads: ' + passed + ' checks passed');

'use strict';
// Every workflow that installs the Supabase CLI names an exact version.
// `version: latest` makes supabase/setup-cli ask GitHub's API for the newest
// release on every run, and that unauthenticated read is rate-limited: on
// 2026-11-02 the merge lane run 41440814518 failed "Failed to resolve latest
// Supabase CLI release: rate limit exceeded" before deploying trial-reels.
// The other lanes were already pinned to 2.109.0 (calendar-upsert-live-delta,
// the Section 4 lane), which supports --use-api.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', '.github', 'workflows');
let failures = 0;
let installs = 0;
for (const name of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8');
  const re = /uses:\s*supabase\/setup-cli@[^\n]*\n((?:[ \t]+[^\n]*\n){0,4})/g;
  let m;
  while ((m = re.exec(text))) {
    installs += 1;
    const block = m[1];
    const v = /version:\s*([^\s#]+)/.exec(block);
    if (!v) { console.error(`FAIL ${name}: setup-cli without an exact version`); failures += 1; continue; }
    if (!/^\d+\.\d+\.\d+$/.test(v[1])) { console.error(`FAIL ${name}: setup-cli version "${v[1]}" is not an exact x.y.z`); failures += 1; }
  }
}
if (installs < 10) { console.error(`FAIL: expected at least 10 setup-cli installs, found ${installs}`); failures += 1; }
if (failures) { console.error(`supabase-cli-pinned: ${failures} failure(s)`); process.exit(1); }
console.log(`supabase-cli-pinned: ${installs} setup-cli installs, every one names an exact version`);

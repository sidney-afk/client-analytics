/*
 * repo-map-sync.js — keeps REPO_MAP.md honest.
 *
 * The map is only useful if it can't go stale, so this suite fails when:
 *   1. a top-level tracked file/directory is missing from REPO_MAP.md,
 *   2. a docs/ subdirectory is missing from REPO_MAP.md,
 *   3. REPO_MAP.md references a path that no longer exists.
 *
 * Add/move/delete something → update REPO_MAP.md in the same change.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('OK  ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}

const MAP = fs.readFileSync(path.join(ROOT, 'REPO_MAP.md'), 'utf8');

let tracked;
try {
  tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
} catch (e) {
  // No git (e.g. tarball download): nothing to enforce against.
  console.log('SKIP repo-map-sync — git unavailable');
  process.exit(0);
}

// 1. Every top-level tracked entry must be mentioned in the map.
const topLevel = [...new Set(tracked.map(f => f.split('/')[0]))];
for (const entry of topLevel) {
  const isDir = tracked.some(f => f.startsWith(entry + '/'));
  const mentioned = MAP.includes('`' + entry + '`') || MAP.includes('`' + entry + '/`');
  ok(mentioned, `top-level ${isDir ? 'directory' : 'file'} \`${entry}\` is documented in REPO_MAP.md`);
}

// 2. Every docs/ subdirectory must be mentioned.
const docsSubdirs = [...new Set(tracked.filter(f => f.startsWith('docs/') && f.split('/').length > 2)
  .map(f => f.split('/')[1]))];
for (const sub of docsSubdirs) {
  ok(MAP.includes('`docs/' + sub + '/`'), `docs subdirectory \`docs/${sub}/\` is documented in REPO_MAP.md`);
}

// 3. Every backticked path-like token in the map must exist.
//    Path-like = no spaces, contains '/' or names a top-level entry, and is
//    not a glob/flag. Trailing '/' is allowed for directories.
const tokens = [...MAP.matchAll(/`([^`\n]+)`/g)].map(m => m[1]);
const checked = new Set();
for (const raw of tokens) {
  if (/[\s*?<>]/.test(raw) || raw.startsWith('-') || raw.startsWith('/')) continue;
  const token = raw.replace(/\/$/, '');
  if (!(raw.includes('/') || topLevel.includes(token))) continue;
  if (checked.has(token)) continue;
  checked.add(token);
  ok(fs.existsSync(path.join(ROOT, token)), `REPO_MAP.md path \`${raw}\` exists`);
}

console.log(`\nrepo-map-sync: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

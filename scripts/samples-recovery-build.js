'use strict';
// Offline, explicit-output-only inverse. Never edits a checkout or deploys.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { extractFunction } = require('../test/helpers/extract-function');
const CANDIDATE = 'a3f86c96e99b0d1ff3e93d6ac9f8e2ee496f8ca5';
const BASELINE = 'a4925097aad2be1d8b4710e56da1220a19c850c5';
const ROOT = path.resolve(__dirname, '..');
const gitSource = (ref, cwd = ROOT) => execFileSync('git', ['show', ref + ':index.html'], { cwd, maxBuffer: 16e6 }).toString('utf8');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function build(target = gitSource(CANDIDATE), baseline = gitSource(BASELINE), candidate = gitSource(CANDIDATE)) {
  // The historical paginator is already present. Restore its call, never its
  // unsafe fallback or an old whole HTML document (which would lose debt UI).
  assert.equal(extractFunction(target, '_calSupabaseFetchAllRows'), extractFunction(baseline, '_calSupabaseFetchAllRows'), 'baseline paginator drift');
  assert.ok(target.includes('const _sxrSupabaseFetchAllRows = _calSupabaseFetchAllRows;'));
  const start = candidate.indexOf('    const SXR_WORK_PREFIX =');
  const end = candidate.indexOf('    function _sxrValidateReadRows', start);
  assert.ok(start > 0 && end > start);
  assert.ok(target.includes(candidate.slice(start, end)), 'local work schema/ownership compatibility drift');
  for (const name of ['loadSxrCards', '_sxrFlushCardSave', '_sxrOnFieldInput', '_sxrOnFieldBlur', '_sxrBlankSample', '_sxrCacheWrite', '_sxrCacheRead']) {
    assert.equal(extractFunction(target, name), extractFunction(candidate, name), name + ' compatibility drift');
  }
  const original = extractFunction(candidate, '_sxrFetchPosts');
  assert.equal(extractFunction(target, '_sxrFetchPosts'), original, 'reader drift');
  const from = 'const rows = await _sxrFetchAuthoritativePosts(baseUrl, slug, signal);\n            return { ok: true, posts: _sxrValidateReadRows(rows, slug) };';
  assert.ok(original.includes(from));
  const replacement = original.replace(from, `// Recovery: baseline pagination cannot certify completeness, even on HTTP 200.
            const rows = _sxrValidateReadRows(await _sxrSupabaseFetchAllRows(baseUrl, signal), slug);
            if (!rows.some(row => _sxrNormStatus(row.status) !== 'Archived')) throw new Error('samples_recovery_unverified_empty');
            return { ok: true, posts: rows, authoritative: false };`);
  const recovery = target.replace(original, replacement);
  assert.equal(recovery.replace(replacement, original), target, 'inverse must preserve every other byte');
  const offset = target.indexOf(original), lineStart = target.lastIndexOf('\n', offset) + 1;
  const prefix = target.slice(lineStart, offset);
  const oldLines = (prefix + original).split('\n'), newLines = (prefix + replacement).split('\n');
  const line = target.slice(0, lineStart).split('\n').length;
  const patch = '--- a/index.html\n+++ b/index.html\n@@ -' + line + ',' + oldLines.length + ' +' + line + ',' + newLines.length + ' @@\n'
    + oldLines.map(value => '-' + value).join('\n') + '\n' + newLines.map(value => '+' + value).join('\n') + '\n';
  return { recovery, patch, manifest: { baseline: BASELINE, candidate: CANDIDATE,
    baselineHtmlSha256: sha256(baseline), forwardHtmlSha256: sha256(target), recoveryHtmlSha256: sha256(recovery),
    originalReaderSha256: sha256(original), recoveryReaderSha256: sha256(replacement),
    changedFunction: '_sxrFetchPosts', restoredByteEquality: true } };
}
if (require.main === module) {
  const [output, targetRepo, targetRef] = process.argv.slice(2);
  assert.ok(output, 'Usage: node scripts/samples-recovery-build.js OUTPUT_DIRECTORY [EXACT_TARGET_REPO EXACT_TARGET_SHA]');
  assert.equal(!!targetRepo, !!targetRef, 'target repo and full SHA required together');
  if (targetRef) assert.match(targetRef, /^[0-9a-f]{40}$/);
  const target = gitSource(targetRef || CANDIDATE, targetRepo || ROOT);
  const result = build(target);
  const dir = path.resolve(output);
  assert.notEqual(dir, ROOT, 'never overwrite the checkout');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries({ 'forward.html': target, 'recovery.html': result.recovery, 'recovery.patch': result.patch, 'manifest.json': JSON.stringify({ ...result.manifest, targetRef: targetRef || CANDIDATE }, null, 2) + '\n' })) {
    fs.writeFileSync(path.join(dir, name), content, { flag: 'wx' });
  }
  console.log(JSON.stringify(result.manifest));
}
module.exports = { build, gitSource, sha256, CANDIDATE, BASELINE };

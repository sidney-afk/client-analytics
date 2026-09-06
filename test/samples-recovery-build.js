'use strict';
// Offline synthetic reads only; no git/network dependency in the CI test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const { build, sha256 } = require('../scripts/samples-recovery-build');
const { extractFunction } = require('./helpers/extract-function');
const { setup, row, response } = require('./samples-authoritative-read');
const source = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
async function main() {
  const { recovery, patch } = build(source, source, source);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'samples-inverse-'));
  try {
    fs.writeFileSync(path.join(scratch, 'index.html'), source);
    const gitOptions = ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf'];
    execFileSync('git', [...gitOptions, 'apply', '--unidiff-zero', '-'], { cwd: scratch, input: patch });
    assert.equal(sha256(fs.readFileSync(path.join(scratch, 'index.html'))), sha256(recovery));
    execFileSync('git', [...gitOptions, 'apply', '--reverse', '--unidiff-zero', '-'], { cwd: scratch, input: patch });
    assert.equal(sha256(fs.readFileSync(path.join(scratch, 'index.html'))), sha256(source));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  const original = extractFunction(source, '_sxrFetchPosts');
  const inverse = extractFunction(recovery, '_sxrFetchPosts');
  assert.equal(recovery.replace(inverse, original), source);
  assert.ok(!inverse.includes('_sxrFetchAuthoritativePosts('));
  assert.throws(() => build(source.replace('const SXR_WORK_PREFIX =', 'const CHANGED_WORK_PREFIX ='), source, source), /compatibility drift/);
  assert.throws(() => build(source.replace('const sep = baseUrl.indexOf', 'const sep = altered.indexOf'), source, source), /paginator drift/);
  assert.throws(() => build(source.replace('async function _sxrFetchPosts(slug, signal) {', 'async function _sxrFetchPosts(slug, signal) { /* drift */'), source, source), /reader drift/);
  const observer = "            if (typeof _reviewDraftSourceAck === 'function') _reviewDraftSourceAck('samples', _saveSlug, wirePost, owner.principal);\n";
  assert.ok(source.includes(observer));
  const beforeObserver = source.replace(observer, '');
  assert.equal(build(source, beforeObserver, beforeObserver).recovery, recovery, 'exact receipt observer survives recovery unchanged');
  assert.throws(() => build(source.replace(observer, observer.replace('owner.principal', "'foreign-owner'")), beforeObserver, beforeObserver), /compatibility drift/);
  let cases = 0;
  for (const [primary, fallback, expected] of [
    [response([row()]), null, 'available'],
    [response([], 200), response({ ok: true, posts: [] }), 'failed'],
    [response({}, 500), response({ ok: true, posts: [row()] }, 500), 'failed'],
    [response({}, 500), response({ ok: true, posts: [row()] }), 'available'],
    [response({}, 500), response({ posts: [row()] }), 'failed'],
    [response({}, 500), response({ ok: true, posts: [row('x', 'other')] }), 'failed'],
    [response([row(), row()]), response({ ok: true, posts: [] }), 'failed'],
    [response('invalid-json'), response({ ok: true, posts: [], items: [] }), 'failed'],
  ]) {
    const { s } = setup(recovery);
    vm.runInContext('async ' + extractFunction(source, '_calSupabaseFetchAllRows') + '\nconst _sxrSupabaseFetchAllRows = _calSupabaseFetchAllRows;', s);
    let requests = 0;
    s.fetch = async () => { const result = requests++ === 0 ? primary : fallback; assert.ok(result, 'unexpected read'); return result; };
    if (expected === 'failed') await assert.rejects(s._sxrFetchPosts('fixture-a'));
    else {
      const result = await s._sxrFetchPosts('fixture-a');
      assert.equal(result.authoritative, false); assert.equal(result.posts.length, 1);
    }
    cases++;
  }
  console.log('PASS recovery builder exact Git patch apply/reverse and 3 drift refusals; ' + cases + ' actual-reader failure/shape/completeness cases');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

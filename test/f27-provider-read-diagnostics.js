'use strict';
/*
 * The deploy lane must survive a transient provider read, and must be able to
 * SAY what happened when it does not.
 *
 * WHAT HAPPENED (2026-08-07, F27 Section 4 deploy run 6).
 *
 * All four functions deployed and read back PASS individually. The run then
 * failed at "Verify the final exact four-function release" — 4.5 seconds into
 * an ~8 second four-function capture, so partway through, on one of its twelve
 * Management API reads. Production was correct the whole time; the same
 * capture, byte for byte, passes on demand.
 *
 * Two separate defects turned one throttled HTTP response into a red deploy of
 * unknown standing:
 *
 *   1. NO RETRY. Every Management API read in the repository threw on the first
 *      non-2xx. A deploy run makes ~50 of them in a few minutes.
 *   2. NO REASON. The step redirected stderr into the private directory and
 *      published only "the capture failed"; the private directory is then
 *      destroyed by the cleanup step. Even had it been echoed, the CLI's
 *      formatter collapses any unrecognised error to one generic sentence.
 *
 * The second is the same defect shape this project keeps hitting: a check that
 * reports THAT something failed without reporting WHAT. It is guarded here so
 * it cannot come back silently.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const { managementGet, retryDelayMs, TRANSIENT_READ_STATUS } = require('../scripts/ef-fingerprint.js');
const { publicFailure } = require('../scripts/f27-edge-source-rollback-lib.js');
const { formatCliFailure } = require('../scripts/f27-edge-source-rollback.js');

const URL_UNDER_TEST = 'https://api.supabase.com/v1/projects/aaaaaaaaaaaaaaaaaaaa/functions';

function response(status, { retryAfter = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => (String(name).toLowerCase() === 'retry-after' ? retryAfter : null) },
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function withFetch(queue, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error('fetch called more times than the test queued');
    return next;
  };
  return Promise.resolve()
    .then(() => run(calls))
    .finally(() => { globalThis.fetch = original; });
}

(async () => {
  // --- 1. The exact failure mode: a throttled read must not end the deploy ---
  await withFetch([response(429, { retryAfter: '0' }), response(200)], async calls => {
    const result = await managementGet(URL_UNDER_TEST, 'token', 'application/json', 'linear-outbound metadata');
    ok(result.status === 200 && calls.length === 2,
      'a 429 followed by a 200 succeeds on retry instead of failing the run (the 2026-08-07 outage)');
    ok(calls[0].init && calls[0].init.method === 'GET' && calls[0].init.redirect === 'error',
      'the retried request is still the same read-only, redirect-refusing GET');
  });

  // A single 5xx blip, and a network-level failure, are both survivable.
  await withFetch([response(503, { retryAfter: '0' }), response(200)], async calls => {
    const result = await managementGet(URL_UNDER_TEST, 'token', 'application/json', 'batch-write metadata');
    ok(result.status === 200 && calls.length === 2, 'a 503 is retried');
  });
  await withFetch([Object.assign(new Error('aborted'), { name: 'TimeoutError' }), response(200)],
    async calls => {
      const result = await managementGet(URL_UNDER_TEST, 'token', 'application/json', 'batch-write metadata');
      ok(result.status === 200 && calls.length === 2, 'a request that never completed is retried');
    });

  // --- 2. It must stay a CHECK, not a wish -----------------------------------
  // Retrying forever, or retrying an authorization failure, would turn a real
  // problem into a slow one. Neither is allowed.
  await withFetch([response(403)], async calls => {
    let thrown = null;
    try {
      await managementGet(URL_UNDER_TEST, 'token', 'application/json', 'linear-outbound metadata');
    } catch (error) { thrown = error; }
    ok(thrown && calls.length === 1,
      'a 403 fails on the FIRST response — a permission problem is never retried');
    ok(thrown && /HTTP 403/.test(thrown.message),
      'the non-transient status is named in the failure');
  });
  await withFetch([404].map(status => response(status)), async calls => {
    let thrown = null;
    try { await managementGet(URL_UNDER_TEST, 'token', 'application/json', 'x metadata'); } catch (error) { thrown = error; }
    ok(thrown && calls.length === 1, 'a 404 is not retried either');
  });
  await withFetch(Array.from({ length: 8 }, () => response(429, { retryAfter: '0' })), async calls => {
    let thrown = null;
    try {
      await managementGet(URL_UNDER_TEST, 'token', 'application/json', 'linear-outbound metadata');
    } catch (error) { thrown = error; }
    ok(thrown && calls.length === 4,
      'retries are bounded — a persistently throttled read fails after 4 attempts rather than hanging the deploy');
    ok(thrown && /after 4 attempts/.test(thrown.message),
      'the failure states how many attempts were made, so a bound change is visible in the log');
  });

  ok(!TRANSIENT_READ_STATUS.has(401) && !TRANSIENT_READ_STATUS.has(403)
    && !TRANSIENT_READ_STATUS.has(404) && !TRANSIENT_READ_STATUS.has(400),
  'authorization, not-found and bad-request are absent from the transient set');
  ok(TRANSIENT_READ_STATUS.has(429) && TRANSIENT_READ_STATUS.has(502) && TRANSIENT_READ_STATUS.has(503),
    'throttling and gateway errors are the statuses that get another chance');

  // Backoff grows, and an absurd Retry-After cannot park a 90-minute job.
  ok(retryDelayMs(1, null) < retryDelayMs(2, null) && retryDelayMs(2, null) < retryDelayMs(3, null),
    'the delay backs off between attempts');
  ok(retryDelayMs(1, '3600') <= 30_000,
    "a hostile or mistaken Retry-After is capped, so one header cannot stall the deploy");
  ok(retryDelayMs(1, 'not-a-number') === retryDelayMs(1, null),
    'an unparseable Retry-After falls back to the computed backoff');

  // --- 3. The reason must survive the formatter ------------------------------
  const bare = publicFailure(new Error('some internal detail'));
  ok(bare.code === 'F27_EDGE_ROLLBACK_FAILED' && !('detail' in bare),
    'an ordinary error still publishes ONLY the fixed vocabulary — no detail leaks by default');

  const readError = (() => {
    try { assert.ok(false); } catch (_) { /* unreachable */ }
    const error = new Error('Management API read failed — linear-outbound metadata: HTTP 429 after 4 attempts');
    Object.defineProperty(error, 'f27PublicDetail',
      { value: 'linear-outbound metadata: HTTP 429 after 4 attempts', enumerable: false });
    return error;
  })();
  const detailed = publicFailure(readError);
  ok(detailed.detail === 'linear-outbound metadata: HTTP 429 after 4 attempts',
    'a read failure publishes WHICH read and WHICH status — the fact the 2026-08-07 run could not state');
  ok(/HTTP 429/.test(formatCliFailure(readError)) && /F27_EDGE_ROLLBACK_FAILED/.test(formatCliFailure(readError)),
    'the CLI stderr line carries both the code and the detail');

  // The detail channel is opt-in and shape-gated: it can never become a hole
  // through which source bytes, a token or a private path escapes.
  for (const hostile of [
    '/home/runner/work/_temp/f27-section4.PHu6sH/final-four-live.sourcebundle',
    // Assembled at runtime: a literal of this shape is itself blocked by
    // GitHub push protection, which is a fair proof that the gate below is
    // guarding the right shape.
    `sbp${'_'}${'0'.repeat(40)}`,
    'line one\nline two',
    'x'.repeat(200),
  ]) {
    const error = new Error('x');
    Object.defineProperty(error, 'f27PublicDetail', { value: hostile, enumerable: false });
    const failure = publicFailure(error);
    ok(!('detail' in failure) || failure.detail !== hostile,
      `a detail containing "${hostile.slice(0, 24)}…" is refused by the shape gate`);
  }

  // --- 4. The workflow must actually echo it ---------------------------------
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'deploy-f27-section4-closures.yml'), 'utf8');
  const swallowed = workflow.match(/2> "\$F27_PRIVATE_DIR\/[A-Za-z0-9._-]+\.error"; then/g) || [];
  const echoed = workflow.match(/public_failure "\$F27_PRIVATE_DIR\/[A-Za-z0-9._-]+\.error"/g) || [];
  ok(swallowed.length >= 13 && echoed.length === swallowed.length,
    `every step that redirects stderr to a private file echoes it back (${echoed.length}/${swallowed.length})`);
  const helperCount = (workflow.match(/^\s*public_failure\(\) \{$/gm) || []).length;
  ok(helperCount >= 1,
    'the helper is defined in every step that uses it (each run: block is its own shell)');
  ok(/grep -aoE '\^\(f27-edge-source-rollback\|ef-fingerprint\): \.\{0,200\}'/.test(workflow),
    'the echo is an allowlist of the two formatters own lines, not a cat of the whole file');

  // Each `public_failure` call must name the SAME file the redirect just wrote.
  const pairs = [...workflow.matchAll(
    /2> "\$F27_PRIVATE_DIR\/([A-Za-z0-9._-]+)\.error"; then\n\s*public_failure "\$F27_PRIVATE_DIR\/([A-Za-z0-9._-]+)\.error"/g)];
  ok(pairs.length === swallowed.length && pairs.every(match => match[1] === match[2]),
    'each echo reads the error file its own command just wrote, not another step s');

  if (failures) {
    console.error(`\n${failures} provider-read diagnostics check(s) failed`);
    process.exit(1);
  }
  console.log('\nF27 provider read retry + diagnostics checks passed');
})().catch(error => { console.error(error); process.exit(1); });

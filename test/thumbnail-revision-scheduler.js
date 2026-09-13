'use strict';

/* Offline contract checks for the scheduled thumbnail revision scan. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_BATCHES,
  DEFAULT_URL,
  HEADER_NAME,
  MAX_BATCHES,
  MAX_LIMIT,
  resolveConfig,
  runScan,
  sanitizeSummary,
} = require('../scripts/thumbnail-revision-scan');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'thumbnail-revision-scan.yml'),
  'utf8',
);
const EDGE_FUNCTION = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'thumbnail-revision-scan', 'index.ts'),
  'utf8',
);
const CALLER = fs.readFileSync(
  path.join(ROOT, 'scripts', 'thumbnail-revision-scan.js'),
  'utf8',
);
const SCANNER = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', '_shared', 'thumbnail-revisions.ts'),
  'utf8',
);

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

async function rejectsMessage(work, pattern) {
  let thrown;
  try { await work(); } catch (error) { thrown = error; }
  assert(thrown, 'expected operation to reject');
  assert.match(String(thrown.message || thrown), pattern);
  return thrown;
}

(async () => {
  let calls = 0;
  await rejectsMessage(
    () => runScan({ env: {}, fetchImpl: async () => { calls++; } }),
    /THUMBNAIL_REVISION_SCAN_KEY is required/,
  );
  assert.strictEqual(calls, 0, 'missing secret must fail before any network request');

  assert.throws(
    () => resolveConfig({
      THUMBNAIL_REVISION_SCAN_KEY: 'configured',
      THUMBNAIL_REVISION_SCAN_LIMIT: String(MAX_LIMIT + 1),
    }),
    /between 1 and 25/,
    'the workflow caller must not request an unbounded batch',
  );
  assert.throws(
    () => resolveConfig({
      THUMBNAIL_REVISION_SCAN_KEY: 'configured',
      THUMBNAIL_REVISION_SCAN_BATCHES: String(MAX_BATCHES + 1),
    }),
    /between 1 and 20/,
    'the workflow caller must not request an unbounded number of batches',
  );
  assert.strictEqual(resolveConfig({ THUMBNAIL_REVISION_SCAN_KEY: 'configured' }).batches, DEFAULT_BATCHES);

  const sensitive = {
    id: 'private-post-id-123',
    client: 'private-client-name',
    storage_path: 'thumbnail-revisions/private/source.png',
    error: 'private upstream error body',
  };
  let request;
  const summary = await runScan({
    env: {
      THUMBNAIL_REVISION_SCAN_KEY: 'scheduler-secret',
      THUMBNAIL_REVISION_SCAN_BATCHES: '1',
    },
    fetchImpl: async (url, init) => {
      calls++;
      request = { url, init };
      return response({
        ok: true,
        checked: 4,
        changed: 1,
        unchanged: 1,
        failed: 1,
        skipped: 1,
        items: [sensitive],
        debug: sensitive,
      });
    },
  });
  assert.strictEqual(request.url, DEFAULT_URL);
  assert.strictEqual(request.init.method, 'POST');
  const firstBody = JSON.parse(request.init.body);
  assert.strictEqual(firstBody.limit, 25);
  assert.match(firstBody.checked_before, /^\d{4}-\d{2}-\d{2}T/);
  assert.strictEqual(request.init.headers[HEADER_NAME], 'scheduler-secret');
  assert.strictEqual(request.init.headers['Content-Type'], 'application/json');
  assert.deepStrictEqual(summary, {
    ok: true,
    checked: 4,
    changed: 1,
    unchanged: 1,
    failed: 1,
    skipped: 1,
    // Absent on the wire -- the deployed function predates these counters -- and
    // the four-way conservation is unchanged, so an old response still balances.
    missing_source: 0,
    missing_source_new: 0,
  });

  let batchCalls = 0;
  const batchCutoffs = new Set();
  const multiSummary = await runScan({
    env: {
      THUMBNAIL_REVISION_SCAN_KEY: 'scheduler-secret',
      THUMBNAIL_REVISION_SCAN_LIMIT: '2',
      THUMBNAIL_REVISION_SCAN_BATCHES: '4',
    },
    fetchImpl: async (_url, init) => {
      batchCalls++;
      batchCutoffs.add(JSON.parse(init.body).checked_before);
      return batchCalls < 3
        ? response({ ok: true, checked: 2, changed: 0, unchanged: 2, failed: 0, skipped: 0 })
        : response({ ok: true, checked: 1, changed: 1, unchanged: 0, failed: 0, skipped: 0 });
    },
  });
  assert.strictEqual(batchCalls, 3, 'a short page must end the bounded scan cycle');
  assert.strictEqual(batchCutoffs.size, 1, 'every page in one run must share one fairness cutoff');
  assert.deepStrictEqual(multiSummary, {
    ok: true,
    checked: 5,
    changed: 1,
    unchanged: 4,
    failed: 0,
    skipped: 0,
    missing_source: 0,
    missing_source_new: 0,
  });
  const logged = JSON.stringify(summary);
  for (const value of Object.values(sensitive)) {
    assert(!logged.includes(value), `aggregate output leaked sensitive value: ${value}`);
  }
  assert.match(CALLER, /if \(realFailures > 0\)[\s\S]{0,200}?process\.exitCode = 1/,
    'scheduled caller must fail the job when any real failure remains');
  assert.match(CALLER, /JSON\.stringify\(summary\)/,
    'scheduled caller must print the aggregate summary before failing');

  /* A Drive 404 is a source the scanner cannot read, and Google answers 404
   * identically for a deleted file and for one it simply cannot see. So the
   * counters are a SUBSET of `failed`, never a bucket beside it: the four-way
   * conservation stays exactly what every caller has always applied, which is
   * what makes the function and this caller safe to ship in either order.
   *
   * Known-dead rows do not keep the lane red -- they are what made it red on 5
   * of its last 8 scheduled runs purely by cursor position (OPEN_REPAIRS 203),
   * and nothing can ever clear them. A NEWLY unreadable source does, because
   * "the service account lost a folder" must not read like "the same three dead
   * files came round again". */
  const knownMissingOnly = await runScan({
    env: { THUMBNAIL_REVISION_SCAN_KEY: 'scheduler-secret', THUMBNAIL_REVISION_SCAN_BATCHES: '1' },
    fetchImpl: async () => response({
      ok: true, checked: 3, changed: 0, unchanged: 2, failed: 1, skipped: 0,
      missing_source: 1, missing_source_new: 0,
    }),
  });
  assert.deepStrictEqual(knownMissingOnly, {
    ok: true, checked: 3, changed: 0, unchanged: 2, failed: 1, skipped: 0,
    missing_source: 1, missing_source_new: 0,
  });
  assert.strictEqual(knownMissingOnly.failed - knownMissingOnly.missing_source, 0,
    'a page whose only failure is a known-dead Drive source has no real failures left');
  assert.match(CALLER, /const realFailures = summary\.failed - summary\.missing_source;/,
    'the caller must subtract the known-missing subset rather than ignoring failed');
  assert.match(CALLER, /if \(summary\.missing_source_new > 0\)[\s\S]{0,200}?process\.exitCode = 1/,
    'a NEWLY unreadable Drive source must still fail the scheduled job');

  /* Behavioural, not a source match: these two pages balance only if the
   * per-page aggregate loop carries BOTH counters, and the totals are right only
   * if it sums them rather than taking the last page. */
  let missingPages = 0;
  const missingAcrossPages = await runScan({
    env: {
      THUMBNAIL_REVISION_SCAN_KEY: 'scheduler-secret',
      THUMBNAIL_REVISION_SCAN_LIMIT: '4',
      THUMBNAIL_REVISION_SCAN_BATCHES: '3',
    },
    fetchImpl: async () => {
      missingPages++;
      return missingPages === 1
        ? response({ ok: true, checked: 4, changed: 0, unchanged: 2, failed: 2, skipped: 0, missing_source: 2, missing_source_new: 1 })
        : response({ ok: true, checked: 1, changed: 0, unchanged: 0, failed: 1, skipped: 0, missing_source: 1, missing_source_new: 0 });
    },
  });
  assert.strictEqual(missingPages, 2, 'a short page must still end the cycle');
  assert.deepStrictEqual(missingAcrossPages, {
    ok: true, checked: 5, changed: 0, unchanged: 2, failed: 3, skipped: 0,
    missing_source: 3, missing_source_new: 1,
  });

  assert.throws(
    () => sanitizeSummary({
      ok: true, checked: 3, changed: 0, unchanged: 2, failed: 0, skipped: 0, missing_source: 0,
    }),
    /invalid aggregate response/,
    'the four-way conservation is unchanged, so an unbalanced page still fails closed',
  );
  assert.throws(
    () => sanitizeSummary({
      ok: true, checked: 3, changed: 0, unchanged: 2, failed: 1, skipped: 0, missing_source: '1',
    }),
    /invalid aggregate response/,
    'a PRESENT but malformed counter is still a hard failure, unlike an absent one',
  );
  /* A subset bigger than its superset would make realFailures NEGATIVE and read
   * as green. Fail closed instead of subtracting nonsense. */
  assert.throws(
    () => sanitizeSummary({
      ok: true, checked: 3, changed: 0, unchanged: 2, failed: 1, skipped: 0, missing_source: 2,
    }),
    /invalid aggregate response/,
    'missing_source may never exceed failed -- it is a subset of it',
  );
  assert.throws(
    () => sanitizeSummary({
      ok: true, checked: 3, changed: 0, unchanged: 2, failed: 1, skipped: 0,
      missing_source: 1, missing_source_new: 2,
    }),
    /invalid aggregate response/,
    'missing_source_new may never exceed missing_source',
  );

  assert.match(EDGE_FUNCTION, /missing_source:\s*Number\(result\.missing_source \|\| 0\)/,
    'the Edge Function must surface the missing-source counter');
  assert.match(EDGE_FUNCTION, /missing_source_new:\s*Number\(result\.missing_source_new \|\| 0\)/,
    'the Edge Function must surface the NEW missing-source counter, which is the one that pages');
  const scanCatchBlock = SCANNER.slice(
    SCANNER.indexOf('const driveGone = driveStatusOf(e) === 404;'),
    SCANNER.indexOf('out.items.push({ id, status: driveGone'));
  assert.match(SCANNER, /driveError\(msg, resp\.status\)/,
    'driveMetadata must carry the HTTP status, not leave the caller matching on Google prose');
  /* UNCONDITIONAL, and asserted as a bare statement on its own line. `out.failed++`
   * appearing anywhere is not enough: `if (!driveGone) out.failed++;` contains it
   * too, and that guard IS the bug this whole revision exists to remove -- it is
   * what would let a folder-wide access revocation pass as green. */
  assert.match(scanCatchBlock, /\n {6}out\.failed\+\+;\n/,
    'a Drive 404 must stay inside failed unconditionally -- reported as a subset, never exempted');
  assert.doesNotMatch(scanCatchBlock, /if \([^)]*driveGone[^)]*\)\s*out\.failed\+\+/,
    'incrementing failed must not be conditional on the Drive status');
  assert.match(SCANNER, /if \(!knownMissing\) out\.missing_source_new\+\+;/,
    'a source not already recorded as unreadable must count as NEW');
  assert.match(SCANNER, /clean\(row\.error\)\.startsWith\(MISSING_SOURCE_MARKER\)/,
    'known-vs-new must be decided by our own persisted marker, not by Google prose');

  /* The row must stay `pending`. syncview_thumbnail_revision_backfill re-enrols
   * any active non-archived source with no pending row, so writing a terminal
   * status here would re-create the row on the very next run and grow the table
   * instead of settling it. Assert the catch block's update carries no `status`
   * at all rather than asserting the absence of one spelling of it. */
  const scanCatch = SCANNER.slice(SCANNER.indexOf('const driveGone = driveStatusOf(e) === 404;'));
  const catchUpdate = scanCatch.slice(scanCatch.indexOf('.update({'), scanCatch.indexOf('.eq("id", id)'));
  assert(catchUpdate.includes('error: stored.slice(0, 500)'), 'the catch update must still record the error text');
  assert(!catchUpdate.includes('status'),
    'the catch must not move the row out of pending -- the backfill would re-create it');

  assert.throws(
    () => sanitizeSummary({ ok: true, checked: 2, changed: 1, unchanged: 0, failed: 0, skipped: 0 }),
    /invalid aggregate response/,
    'inconsistent aggregate counters must fail closed',
  );
  assert.throws(
    () => sanitizeSummary({ ok: true, checked: 1, changed: '1', unchanged: 0, failed: 0, skipped: 0 }),
    /invalid aggregate response/,
    'string counters must not be accepted',
  );

  const upstreamBody = 'private upstream error body that must never reach logs';
  const httpError = await rejectsMessage(
    () => runScan({
      env: {
        THUMBNAIL_REVISION_SCAN_KEY: 'scheduler-secret',
        THUMBNAIL_REVISION_SCAN_BATCHES: '1',
      },
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        async json() { return { error: upstreamBody }; },
        async text() { return upstreamBody; },
      }),
    }),
    /HTTP 500/,
  );
  assert(!httpError.message.includes(upstreamBody), 'HTTP error leaked the upstream response body');

  assert.match(WORKFLOW, /cron:\s*['"]\*\/10 \* \* \* \*['"]/);
  assert.match(WORKFLOW, /if:\s*vars\.THUMBNAIL_REVISION_SCAN_ENABLED == 'true'/);
  assert.match(WORKFLOW, /group:\s*thumbnail-revision-scan/);
  assert.match(WORKFLOW, /cancel-in-progress:\s*false/);
  assert.match(WORKFLOW, /timeout-minutes:\s*10/);
  assert.match(WORKFLOW, /THUMBNAIL_REVISION_SCAN_BATCHES:\s*'12'/);
  assert.match(WORKFLOW, /secrets\.THUMBNAIL_REVISION_SCAN_KEY/);
  assert.match(WORKFLOW, /node scripts\/thumbnail-revision-scan\.js/);
  assert.doesNotMatch(WORKFLOW, /upload-artifact|download-artifact|\bcurl\b|\btee\b/i);

  assert.strictEqual(HEADER_NAME, 'X-Syncview-Scheduler-Signature');
  assert.match(EDGE_FUNCTION, /x-syncview-scheduler-signature/i,
    'Edge Function and scheduled caller must share the dedicated scheduler header');
  assert.match(EDGE_FUNCTION, /if \(!key\)/,
    'Edge Function must fail closed when the scheduler secret is not configured');

  console.log('thumbnail revision scheduler checks passed');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

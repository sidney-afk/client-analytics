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
    // Absent on the wire -- the deployed function predates the counter -- and
    // the old four-way conservation must still balance exactly.
    missing_source: 0,
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
  });
  const logged = JSON.stringify(summary);
  for (const value of Object.values(sensitive)) {
    assert(!logged.includes(value), `aggregate output leaked sensitive value: ${value}`);
  }
  assert.match(CALLER, /if \(summary\.failed > 0\)[\s\S]*process\.exitCode = 1/,
    'scheduled caller must fail the job when any scanned item failed');
  assert.match(CALLER, /JSON\.stringify\(summary\)/,
    'scheduled caller must print the aggregate summary before failing');

  /* A Drive 404 is a deleted or unshared source file. It is permanent, no scan
   * can clear it, and the row cannot be retired either -- the backfill re-enrols
   * any active non-archived source that has no pending row. Three such rows made
   * this lane red on 5 of its last 8 scheduled runs purely by where the
   * round-robin cursor landed (OPEN_REPAIRS 203). It gets its own counter, it is
   * reported every run, and it does NOT turn Actions red; a real Drive or
   * Storage outage still lands in `failed` and still does. */
  const missingOnly = await runScan({
    env: { THUMBNAIL_REVISION_SCAN_KEY: 'scheduler-secret', THUMBNAIL_REVISION_SCAN_BATCHES: '1' },
    fetchImpl: async () => response({
      ok: true, checked: 3, changed: 0, unchanged: 2, failed: 0, skipped: 0, missing_source: 1,
    }),
  });
  assert.deepStrictEqual(missingOnly, {
    ok: true, checked: 3, changed: 0, unchanged: 2, failed: 0, skipped: 0, missing_source: 1,
  });
  assert.doesNotMatch(CALLER, /summary\.missing_source > 0[\s\S]{0,200}?process\.exitCode = 1/,
    'a missing Drive source must never fail the scheduled job on its own');

  /* Behavioural, not a source match: these two pages balance ONLY if the
   * per-page aggregate loop carries missing_source, and the total is right only
   * if it SUMS rather than taking the last page. Drop the field from either and
   * this rejects as an invalid aggregate response. */
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
        ? response({ ok: true, checked: 4, changed: 0, unchanged: 2, failed: 0, skipped: 0, missing_source: 2 })
        : response({ ok: true, checked: 1, changed: 0, unchanged: 0, failed: 0, skipped: 0, missing_source: 1 });
    },
  });
  assert.strictEqual(missingPages, 2, 'a short page must still end the cycle');
  assert.deepStrictEqual(missingAcrossPages, {
    ok: true, checked: 5, changed: 0, unchanged: 2, failed: 0, skipped: 0, missing_source: 3,
  });

  assert.throws(
    () => sanitizeSummary({
      ok: true, checked: 3, changed: 0, unchanged: 2, failed: 0, skipped: 0, missing_source: 0,
    }),
    /invalid aggregate response/,
    'conservation must account for missing_source, so an unbalanced page still fails closed',
  );
  assert.throws(
    () => sanitizeSummary({
      ok: true, checked: 3, changed: 0, unchanged: 2, failed: 0, skipped: 0, missing_source: '1',
    }),
    /invalid aggregate response/,
    'a PRESENT but malformed missing_source is still a hard failure, unlike an absent one',
  );

  assert.match(EDGE_FUNCTION, /missing_source:\s*Number\(result\.missing_source \|\| 0\)/,
    'the Edge Function must surface the missing-source counter to the caller');
  assert.match(SCANNER, /driveError\(msg, resp\.status\)/,
    'driveMetadata must carry the HTTP status, not leave the caller matching on Google prose');
  assert.match(SCANNER, /driveStatusOf\(e\) === 404\) out\.missing_source\+\+; else out\.failed\+\+/,
    'only a Drive 404 may be reclassified; every other error stays a failure');
  assert.match(SCANNER, /\.update\(\{ error: msg\.slice\(0, 500\)/,
    'the per-row error text must still be recorded even when it is not a failure');
  /* The row must stay `pending`. syncview_thumbnail_revision_backfill re-enrols
   * any active non-archived source that has no pending row, so writing a
   * terminal status here would re-create the row on the very next run and grow
   * the table instead of settling it. Assert the catch block's update carries no
   * `status` at all rather than asserting the absence of one spelling of it. */
  const scanCatch = SCANNER.slice(SCANNER.indexOf('if (driveStatusOf(e) === 404)'));
  const catchUpdate = scanCatch.slice(scanCatch.indexOf('.update({'), scanCatch.indexOf('.eq("id", id)'));
  assert(catchUpdate.includes('error: msg.slice(0, 500)'), 'the catch update must still record the error text');
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

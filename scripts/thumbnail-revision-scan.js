'use strict';

/*
 * Bounded caller for the thumbnail revision scanner Edge Function.
 *
 * This deliberately accepts only a batch limit and only prints aggregate
 * counters. Source URLs, post IDs, storage paths, and per-item errors must not
 * leak into GitHub Actions logs.
 */

const DEFAULT_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/thumbnail-revision-scan';
const HEADER_NAME = 'X-Syncview-Scheduler-Signature';
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 25;
const DEFAULT_BATCHES = 12;
const MAX_BATCHES = 20;
const DEFAULT_TIMEOUT_MS = 480000;
const MAX_TIMEOUT_MS = 540000;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function parseBoundedInteger(value, fallback, max, label) {
  const raw = clean(value);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${label} must be an integer between 1 and ${max}`);
  }
  return parsed;
}

function resolveConfig(env = process.env) {
  const secret = clean(env.THUMBNAIL_REVISION_SCAN_KEY);
  if (!secret) throw new Error('THUMBNAIL_REVISION_SCAN_KEY is required');

  let endpoint;
  try {
    endpoint = new URL(clean(env.THUMBNAIL_REVISION_SCAN_URL) || DEFAULT_URL);
  } catch (_error) {
    throw new Error('THUMBNAIL_REVISION_SCAN_URL must be a valid HTTPS URL');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('THUMBNAIL_REVISION_SCAN_URL must be a valid HTTPS URL');
  }

  return {
    endpoint: endpoint.toString(),
    secret,
    limit: parseBoundedInteger(
      env.THUMBNAIL_REVISION_SCAN_LIMIT,
      DEFAULT_LIMIT,
      MAX_LIMIT,
      'THUMBNAIL_REVISION_SCAN_LIMIT',
    ),
    batches: parseBoundedInteger(
      env.THUMBNAIL_REVISION_SCAN_BATCHES,
      DEFAULT_BATCHES,
      MAX_BATCHES,
      'THUMBNAIL_REVISION_SCAN_BATCHES',
    ),
    timeoutMs: parseBoundedInteger(
      env.THUMBNAIL_REVISION_SCAN_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
      'THUMBNAIL_REVISION_SCAN_TIMEOUT_MS',
    ),
  };
}

function aggregateCount(payload, field) {
  const value = payload[field];
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('thumbnail revision scan returned an invalid aggregate response');
  }
  return value;
}

/* Both missing-source counters are OPTIONAL on the wire and read 0 when absent,
 * and both are a SUBSET of `failed` rather than a bucket beside it. That is what
 * makes this safe to merge and deploy in either order: the four-way conservation
 * below is byte-for-byte the rule every caller has always applied, so a new
 * function answering an old caller still balances, and an old function answering
 * this caller reports no subset and simply behaves as it does today. A
 * PRESENT-but-malformed value is still a hard failure. */
function optionalAggregateCount(payload, field) {
  if (payload[field] === undefined) return 0;
  return aggregateCount(payload, field);
}

function sanitizeSummary(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.ok !== true) {
    throw new Error('thumbnail revision scan returned an invalid aggregate response');
  }

  const summary = {
    ok: true,
    checked: aggregateCount(payload, 'checked'),
    changed: aggregateCount(payload, 'changed'),
    unchanged: aggregateCount(payload, 'unchanged'),
    failed: aggregateCount(payload, 'failed'),
    skipped: aggregateCount(payload, 'skipped'),
    missing_source: optionalAggregateCount(payload, 'missing_source'),
    missing_source_new: optionalAggregateCount(payload, 'missing_source_new'),
  };
  if (summary.checked !== summary.changed + summary.unchanged + summary.failed + summary.skipped) {
    throw new Error('thumbnail revision scan returned an invalid aggregate response');
  }
  // Fail closed on a response that contradicts itself about the subset, rather
  // than subtracting it below and reporting a negative failure count as green.
  if (summary.missing_source > summary.failed
    || summary.missing_source_new > summary.missing_source) {
    throw new Error('thumbnail revision scan returned an invalid aggregate response');
  }
  return Object.freeze(summary);
}

async function runScan(options = {}) {
  const env = options.env || process.env;
  const config = resolveConfig(env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    // Keep one cutoff for the whole run. The Edge query excludes rows checked
    // at or after it, so later batches cannot wrap around to the first page
    // when the eligible count is an exact multiple of the page size.
    const checkedBefore = new Date().toISOString();
    const total = { ok: true, checked: 0, changed: 0, unchanged: 0, failed: 0, skipped: 0,
      missing_source: 0, missing_source_new: 0 };
    for (let batch = 0; batch < config.batches; batch++) {
      let response;
      try {
        response = await fetchImpl(config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [HEADER_NAME]: config.secret,
          },
          body: JSON.stringify({ limit: config.limit, checked_before: checkedBefore }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error && error.name === 'AbortError') {
          throw new Error('thumbnail revision scan request timed out');
        }
        throw new Error('thumbnail revision scan request failed');
      }

      if (!response || response.ok !== true) {
        const status = response && Number.isInteger(response.status) ? ` (HTTP ${response.status})` : '';
        throw new Error(`thumbnail revision scan failed${status}`);
      }

      let payload;
      try {
        payload = await response.json();
      } catch (_error) {
        throw new Error('thumbnail revision scan returned an invalid aggregate response');
      }
      const summary = sanitizeSummary(payload);
      for (const field of ['checked', 'changed', 'unchanged', 'failed', 'skipped',
        'missing_source', 'missing_source_new']) {
        const next = total[field] + summary[field];
        if (!Number.isSafeInteger(next)) {
          throw new Error('thumbnail revision scan returned an invalid aggregate response');
        }
        total[field] = next;
      }
      // A short final page means this cycle has already visited every currently
      // eligible watcher, so avoid wrapping around and scanning it twice.
      if (summary.checked < config.limit) break;
    }
    return Object.freeze(total);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const summary = await runScan();
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  // A transport-level 200 is not a healthy scan when any row failed. Keep the
  // only logged detail aggregate-only, but make Actions red so silent Drive or
  // Storage outages cannot leave every viewer stale behind a green schedule.
  //
  // The one thing that does NOT keep the lane red is a Drive 404 on a source
  // this scan has already recorded as unreadable. Those are the rows that made
  // the lane red on 5 of its last 8 scheduled runs purely by where the
  // round-robin cursor landed (OPEN_REPAIRS 204), and no scan can ever clear
  // them: the backfill re-enrols any active non-archived source with no pending
  // row, so they cannot be retired either.
  //
  // A NEWLY unreadable source still goes red, and that distinction is the whole
  // point. Google answers 404 identically for a deleted file and for one the
  // caller simply cannot see, so "the service account lost a folder" would
  // otherwise hide behind the same counter as "the same three dead files came
  // round again" -- which is the silent-outage failure the paragraph above
  // exists to prevent.
  const realFailures = summary.failed - summary.missing_source;
  if (realFailures > 0) {
    process.stderr.write('thumbnail revision scan completed with failed items\n');
    process.exitCode = 1;
  }
  if (summary.missing_source_new > 0) {
    process.stderr.write('thumbnail revision scan found newly unreadable Drive sources\n');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : 'thumbnail revision scan failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_BATCHES,
  DEFAULT_LIMIT,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_URL,
  HEADER_NAME,
  MAX_BATCHES,
  MAX_LIMIT,
  MAX_TIMEOUT_MS,
  resolveConfig,
  runScan,
  sanitizeSummary,
};

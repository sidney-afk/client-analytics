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
  };
  if (summary.checked !== summary.changed + summary.unchanged + summary.failed + summary.skipped) {
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
    const total = { ok: true, checked: 0, changed: 0, unchanged: 0, failed: 0, skipped: 0 };
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
      for (const field of ['checked', 'changed', 'unchanged', 'failed', 'skipped']) {
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
  if (summary.failed > 0) {
    process.stderr.write('thumbnail revision scan completed with failed items\n');
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

'use strict';

/*
 * Read-only post-deploy proof that the Linear inbound mirror is still fresh.
 *
 * The operator supplies SUPABASE_PROJECT_REF, the matching canonical
 * SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY:
 *
 *   SUPABASE_PROJECT_REF=abcdefghijklmnopqrst \
 *   SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/f27-inbound-freshness.js
 *
 * The project ref and URL are validated before the key can be attached to a
 * request. The script performs one latest-row GET and one exact-count HEAD against
 * deliverable_events. Its JSON result intentionally omits row ids, client
 * fields, payloads, project URLs, credentials, and response bodies so the
 * result can be attached to public F27 evidence.
 */

const CHECK_NAME = 'f27_linear_inbound_freshness';
const LINEAR_WEBHOOK_ACTOR = 'Linear webhook';
const MIRROR_SOURCE = 'mirror';
const ACTION_FILTER = 'mirror_in_*';
// The operational bar is 12 hours. Passing at 11h59m would not be "well
// under" it, so the packaged gate reserves a full six-hour safety margin.
const HARD_FRESHNESS_BAR_HOURS = 12;
const FRESHNESS_HOURS = 6;
const RECENT_WINDOW_HOURS = 12;
const FUTURE_SKEW_MINUTES = 5;
const REQUEST_TIMEOUT_MS = 15_000;
const HOUR_MS = 60 * 60 * 1000;
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;

class OperatorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'OperatorError';
    this.code = code;
  }
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function finiteDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function canonicalSupabaseUrl(rawValue, projectValue) {
  const rawUrl = clean(rawValue);
  const projectRef = clean(projectValue);
  if (!PROJECT_REF_RE.test(projectRef)) throw new OperatorError('invalid_supabase_project_ref');
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    throw new OperatorError('invalid_supabase_url');
  }
  const canonical = `https://${projectRef}.supabase.co`;
  if (url.protocol !== 'https:'
      || url.username || url.password || url.port
      || url.search || url.hash
      || url.hostname !== `${projectRef}.supabase.co`
      || url.pathname !== '/'
      || (rawUrl !== canonical && rawUrl !== `${canonical}/`)) {
    throw new OperatorError('invalid_supabase_url');
  }
  return canonical;
}

function loadConfig(env = process.env) {
  const rawUrl = clean(env.SUPABASE_URL);
  const projectRef = clean(env.SUPABASE_PROJECT_REF);
  if (!projectRef) throw new OperatorError('missing_supabase_project_ref');
  if (!PROJECT_REF_RE.test(projectRef)) throw new OperatorError('invalid_supabase_project_ref');
  if (!rawUrl) throw new OperatorError('missing_supabase_url');

  const canonical = canonicalSupabaseUrl(rawUrl, projectRef);
  const key = clean(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new OperatorError('missing_supabase_service_role_key');
  return { baseUrl: canonical, key, projectRef };
}

function filteredEventsUrl(baseUrl, select) {
  const url = new URL(`${baseUrl}/rest/v1/deliverable_events`);
  url.searchParams.set('select', select);
  url.searchParams.set('source', `eq.${MIRROR_SOURCE}`);
  url.searchParams.set('actor', `eq.${LINEAR_WEBHOOK_ACTOR}`);
  url.searchParams.set('action', `like.${ACTION_FILTER}`);
  return url;
}

function buildReadUrls(baseUrl, windowStart) {
  const latest = filteredEventsUrl(baseUrl, 'ts,action,actor,source');
  latest.searchParams.set('order', 'ts.desc');
  latest.searchParams.set('limit', '1');

  const count = filteredEventsUrl(baseUrl, 'id');
  count.searchParams.set('ts', `gte.${windowStart.toISOString()}`);
  return { latest: latest.toString(), count: count.toString() };
}

function publicResult({ ok, reason, now, windowStart, latestTs = null, latestAction = null, ageMinutes = null, recentCount = 0 }) {
  return {
    check: CHECK_NAME,
    ok: Boolean(ok),
    reason,
    observed_at: now.toISOString(),
    hard_freshness_bar_hours: HARD_FRESHNESS_BAR_HOURS,
    freshness_limit_hours: FRESHNESS_HOURS,
    recent_window_hours: RECENT_WINDOW_HOURS,
    recent_window_start: windowStart.toISOString(),
    latest_event_ts: latestTs,
    latest_event_action: latestAction,
    latest_event_age_minutes: ageMinutes,
    recent_event_count: recentCount,
  };
}

function parseExactCount(contentRange) {
  const match = clean(contentRange).match(/^(?:\d+-\d+|\*)\/(\d+)$/);
  if (!match) throw new OperatorError('invalid_count_response');
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 0) throw new OperatorError('invalid_count_response');
  return count;
}

function evaluateFreshness({ latestRows, recentCount, now, windowStart }) {
  if (!Array.isArray(latestRows)) throw new OperatorError('invalid_latest_response');
  if (!Number.isSafeInteger(recentCount) || recentCount < 0) throw new OperatorError('invalid_count_response');
  if (latestRows.length === 0) {
    return publicResult({ ok: false, reason: 'no_matching_event', now, windowStart, recentCount });
  }

  const row = latestRows[0];
  const action = clean(row && row.action);
  const timestamp = finiteDate(row && row.ts);
  const validBinder = clean(row && row.actor) === LINEAR_WEBHOOK_ACTOR
    && clean(row && row.source) === MIRROR_SOURCE
    && /^mirror_in_[a-z0-9_]+$/.test(action);
  if (!timestamp || !validBinder) {
    return publicResult({ ok: false, reason: 'invalid_latest_event', now, windowStart, recentCount });
  }

  const rawAgeMs = now.getTime() - timestamp.getTime();
  const ageMinutes = Number((Math.max(0, rawAgeMs) / 60_000).toFixed(2));
  const common = {
    now,
    windowStart,
    latestTs: timestamp.toISOString(),
    latestAction: action,
    ageMinutes,
    recentCount,
  };

  if (rawAgeMs < -(FUTURE_SKEW_MINUTES * 60_000)) {
    return publicResult({ ...common, ok: false, reason: 'latest_event_clock_skew' });
  }
  if (rawAgeMs >= FRESHNESS_HOURS * HOUR_MS) {
    return publicResult({ ...common, ok: false, reason: 'latest_event_stale' });
  }
  if (recentCount === 0) {
    return publicResult({ ...common, ok: false, reason: 'recent_window_empty' });
  }
  return publicResult({ ...common, ok: true, reason: 'fresh' });
}

function responseHeader(response, name) {
  return response && response.headers && typeof response.headers.get === 'function'
    ? response.headers.get(name)
    : null;
}

async function timedFetch(fetchImpl, url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
  } catch (_) {
    throw new OperatorError(controller.signal.aborted ? 'rest_timeout' : 'rest_unavailable');
  } finally {
    clearTimeout(timer);
  }
}

function safeHttpCode(prefix, response) {
  const status = Number(response && response.status);
  const suffix = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 'unknown';
  return `${prefix}_http_${suffix}`;
}

async function runInboundFreshness({
  baseUrl,
  key,
  projectRef,
  now = new Date(),
  fetchImpl = globalThis.fetch,
}) {
  const observedAt = finiteDate(now);
  if (!observedAt) throw new OperatorError('invalid_observation_time');
  if (typeof fetchImpl !== 'function') throw new OperatorError('fetch_unavailable');
  const canonicalBaseUrl = canonicalSupabaseUrl(baseUrl, projectRef);
  if (!clean(key)) throw new OperatorError('missing_supabase_service_role_key');

  const windowStart = new Date(observedAt.getTime() - RECENT_WINDOW_HOURS * HOUR_MS);
  const urls = buildReadUrls(canonicalBaseUrl, windowStart);
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };

  const [latestResponse, countResponse] = await Promise.all([
    timedFetch(fetchImpl, urls.latest, { method: 'GET', headers }),
    timedFetch(fetchImpl, urls.count, {
      method: 'HEAD',
      headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
    }),
  ]);
  if (!latestResponse || !latestResponse.ok) {
    throw new OperatorError(safeHttpCode('latest_read', latestResponse));
  }
  if (!countResponse || !countResponse.ok) {
    throw new OperatorError(safeHttpCode('count_read', countResponse));
  }

  let latestRows;
  try {
    latestRows = await latestResponse.json();
  } catch (_) {
    throw new OperatorError('invalid_latest_response');
  }
  const recentCount = parseExactCount(responseHeader(countResponse, 'content-range'));
  return evaluateFreshness({ latestRows, recentCount, now: observedAt, windowStart });
}

function publicError(reason, now = new Date()) {
  const observedAt = finiteDate(now) || new Date(0);
  return {
    check: CHECK_NAME,
    ok: false,
    reason: /^[a-z0-9_]+$/.test(clean(reason)) ? clean(reason) : 'operator_error',
    observed_at: observedAt.toISOString(),
  };
}

async function cli({ env = process.env, fetchImpl = globalThis.fetch, now = new Date(), write = line => console.log(line) } = {}) {
  try {
    const config = loadConfig(env);
    const result = await runInboundFreshness({ ...config, now, fetchImpl });
    write(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    const reason = error instanceof OperatorError ? error.code : 'operator_error';
    write(JSON.stringify(publicError(reason, now)));
    return 1;
  }
}

if (require.main === module) {
  cli().then(code => { process.exitCode = code; });
}

module.exports = {
  ACTION_FILTER,
  CHECK_NAME,
  FRESHNESS_HOURS,
  HARD_FRESHNESS_BAR_HOURS,
  LINEAR_WEBHOOK_ACTOR,
  MIRROR_SOURCE,
  OperatorError,
  RECENT_WINDOW_HOURS,
  buildReadUrls,
  canonicalSupabaseUrl,
  cli,
  evaluateFreshness,
  loadConfig,
  parseExactCount,
  publicError,
  runInboundFreshness,
};

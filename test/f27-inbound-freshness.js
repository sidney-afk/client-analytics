'use strict';

const {
  FRESHNESS_HOURS,
  HARD_FRESHNESS_BAR_HOURS,
  cli,
  evaluateFreshness,
  loadConfig,
  parseExactCount,
  runInboundFreshness,
} = require('../scripts/f27-inbound-freshness');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

function response({ body = [], status = 200, contentRange = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => name.toLowerCase() === 'content-range' ? contentRange : null },
    json: async () => body,
  };
}

const NOW = new Date('2026-07-22T18:00:00.000Z');
const WINDOW_START = new Date('2026-07-22T06:00:00.000Z');
const PROJECT_REF = 'abcdefghijklmnopqrst';
function event(ts = '2026-07-22T17:45:00.000Z', overrides = {}) {
  return {
    ts,
    action: 'mirror_in_status_change',
    actor: 'Linear webhook',
    source: 'mirror',
    ...overrides,
  };
}

async function run() {
  ok(HARD_FRESHNESS_BAR_HOURS === 12 && FRESHNESS_HOURS === 6,
    'the pass threshold reserves a six-hour margin beneath the strict 12-hour install bar');
  ok(parseExactCount('0-0/17') === 17 && parseExactCount('*/0') === 0,
    'PostgREST exact Content-Range totals are parsed without reading row bodies');

  const calls = [];
  const fresh = await runInboundFreshness({
    baseUrl: `https://${PROJECT_REF}.supabase.co`,
    projectRef: PROJECT_REF,
    key: 'fixture-secret-key',
    now: NOW,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return options.method === 'HEAD'
        ? response({ contentRange: '0-0/9' })
        : response({ body: [event()] });
    },
  });
  ok(fresh.ok && fresh.reason === 'fresh' && fresh.recent_event_count === 9,
    'a recent matching webhook plus nonzero recent-window count passes');
  ok(fresh.latest_event_age_minutes === 15 && fresh.latest_event_action === 'mirror_in_status_change',
    'public evidence contains only aggregate freshness and controlled action data');
  ok(calls.length === 2 && calls.some(call => call.options.method === 'GET')
    && calls.some(call => call.options.method === 'HEAD')
    && calls.every(call => call.options.redirect === 'error'),
  'the proof performs exactly one latest-row GET and one row-body-free exact-count HEAD');

  for (const call of calls) {
    const url = new URL(call.url);
    ok(url.pathname === '/rest/v1/deliverable_events'
      && url.searchParams.get('source') === 'eq.mirror'
      && url.searchParams.get('actor') === 'eq.Linear webhook'
      && url.searchParams.get('action') === 'like.mirror_in_*',
    'both REST reads bind mirror source, exact Linear actor, and mirror_in action prefix');
  }
  const latestCall = calls.find(call => call.options.method === 'GET');
  const countCall = calls.find(call => call.options.method === 'HEAD');
  ok(new URL(latestCall.url).searchParams.get('select') === 'ts,action,actor,source'
    && new URL(latestCall.url).searchParams.get('order') === 'ts.desc'
    && new URL(latestCall.url).searchParams.get('limit') === '1',
  'latest read selects no row id, client field, or payload and orders by timestamp');
  ok(new URL(countCall.url).searchParams.get('select') === 'id'
    && new URL(countCall.url).searchParams.get('ts') === 'gte.2026-07-22T06:00:00.000Z'
    && countCall.options.headers.Prefer === 'count=exact'
    && countCall.options.headers.Range === '0-0',
  'recent count uses the same 12-hour window and PostgREST exact-count headers');

  const serialized = JSON.stringify(fresh);
  ok(!/fixture|secret|client|payload|\/rest\/v1|event_id/i.test(serialized),
    'public JSON omits credentials, project URL, client fields, payloads, and row identifiers');

  const justFresh = evaluateFreshness({
    latestRows: [event('2026-07-22T12:00:00.001Z')],
    recentCount: 1,
    now: NOW,
    windowStart: WINDOW_START,
  });
  const exactBoundary = evaluateFreshness({
    latestRows: [event('2026-07-22T12:00:00.000Z')],
    recentCount: 1,
    now: NOW,
    windowStart: WINDOW_START,
  });
  ok(justFresh.ok && !exactBoundary.ok && exactBoundary.reason === 'latest_event_stale',
    'freshness is strict: just under six hours passes and exactly six hours fails');

  const empty = evaluateFreshness({
    latestRows: [event()], recentCount: 0, now: NOW, windowStart: WINDOW_START,
  });
  ok(!empty.ok && empty.reason === 'recent_window_empty',
    'a fresh-looking latest row cannot pass with a zero recent-window count');
  ok(evaluateFreshness({ latestRows: [], recentCount: 0, now: NOW, windowStart: WINDOW_START }).reason === 'no_matching_event',
    'no matching inbound event fails closed');
  ok(evaluateFreshness({
    latestRows: [event('2026-07-22T18:06:00.000Z')], recentCount: 1, now: NOW, windowStart: WINDOW_START,
  }).reason === 'latest_event_clock_skew', 'a materially future-dated event cannot manufacture freshness');
  ok(evaluateFreshness({
    latestRows: [event(undefined, { actor: 'someone else' })], recentCount: 1, now: NOW, windowStart: WINDOW_START,
  }).reason === 'invalid_latest_event', 'the returned row binder is independently revalidated');

  let invalidCountFailed = false;
  try { parseExactCount('0-0/*'); } catch (error) { invalidCountFailed = error.code === 'invalid_count_response'; }
  ok(invalidCountFailed, 'an unavailable exact count fails closed');

  const missingOutput = [];
  let networkCalled = false;
  const missingExit = await cli({
    env: {},
    now: NOW,
    fetchImpl: async () => { networkCalled = true; },
    write: line => missingOutput.push(line),
  });
  const missingJson = JSON.parse(missingOutput[0]);
  ok(missingExit === 1 && !networkCalled && missingJson.reason === 'missing_supabase_project_ref',
    'missing operator configuration exits nonzero before any network access');

  const rejectedUrls = [
    `http://${PROJECT_REF}.supabase.co`,
    `https://${PROJECT_REF}.supabase.co.evil.example`,
    `https://${PROJECT_REF}.supabase.co@evil.example`,
    `https://evil.example/${PROJECT_REF}.supabase.co`,
    `https://${PROJECT_REF}.supabase.co/rest/v1`,
    `https://${PROJECT_REF}.supabase.co?next=https://evil.example`,
    `https://${PROJECT_REF}.supabase.co#fragment`,
    `https://${PROJECT_REF}.supabase.co:443`,
    `https://${PROJECT_REF.toUpperCase()}.supabase.co`,
  ];
  for (const maliciousUrl of rejectedUrls) {
    let rejected = false;
    try {
      loadConfig({
        SUPABASE_PROJECT_REF: PROJECT_REF,
        SUPABASE_URL: maliciousUrl,
        SUPABASE_SERVICE_ROLE_KEY: 'must-never-be-sent',
      });
    } catch (error) {
      rejected = error.code === 'invalid_supabase_url';
    }
    ok(rejected, `credential-bearing requests reject noncanonical URL: ${new URL(maliciousUrl).hostname}`);
  }
  let mismatchRejected = false;
  try {
    loadConfig({
      SUPABASE_PROJECT_REF: PROJECT_REF,
      SUPABASE_URL: 'https://tsrqponmlkjihgfedcba.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'must-never-be-sent',
    });
  } catch (error) {
    mismatchRejected = error.code === 'invalid_supabase_url';
  }
  ok(mismatchRejected, 'a valid-looking but mismatched project host is rejected before network access');
  let malformedRefRejected = false;
  try {
    loadConfig({
      SUPABASE_PROJECT_REF: 'too-short',
      SUPABASE_URL: 'https://too-short.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'must-never-be-sent',
    });
  } catch (error) {
    malformedRefRejected = error.code === 'invalid_supabase_project_ref';
  }
  ok(malformedRefRejected, 'the independently confirmed project ref must be exactly 20 lowercase alphanumerics');
  const canonical = loadConfig({
    SUPABASE_PROJECT_REF: PROJECT_REF,
    SUPABASE_URL: `https://${PROJECT_REF}.supabase.co/`,
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-key',
  });
  ok(canonical.baseUrl === `https://${PROJECT_REF}.supabase.co`
    && canonical.projectRef === PROJECT_REF,
  'the canonical root URL is bound to the independently confirmed project ref');
  let directNetworkCalled = false;
  let directRejected = false;
  try {
    await runInboundFreshness({
      baseUrl: `https://${PROJECT_REF}.supabase.co.evil.example`,
      projectRef: PROJECT_REF,
      key: 'must-never-be-sent',
      now: NOW,
      fetchImpl: async () => { directNetworkCalled = true; },
    });
  } catch (error) {
    directRejected = error.code === 'invalid_supabase_url';
  }
  ok(directRejected && !directNetworkCalled,
    'the reusable runner also revalidates the canonical project URL before attaching a key');

  const errorOutput = [];
  const errorExit = await cli({
    env: {
      SUPABASE_PROJECT_REF: PROJECT_REF,
      SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: 'do-not-print-this',
    },
    now: NOW,
    fetchImpl: async (_url, options) => options.method === 'HEAD'
      ? response({ contentRange: '*/0' })
      : response({ status: 503, body: { live_row_body: 'do-not-print-this-either' } }),
    write: line => errorOutput.push(line),
  });
  ok(errorExit === 1 && JSON.parse(errorOutput[0]).reason === 'latest_read_http_503'
    && !/do-not-print|live_row_body|supabase\.co/.test(errorOutput[0]),
  'REST failures emit only a stable public-safe reason and never echo response bodies, URLs, or keys');

  if (failures) {
    console.error(`\n${failures} F27 inbound freshness check(s) failed`);
    process.exit(1);
  }
  console.log('\nF27 inbound freshness checks passed');
}

run().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});

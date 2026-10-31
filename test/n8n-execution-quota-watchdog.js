'use strict';

const fs = require('fs');
const path = require('path');
const {
  alertPayload,
  confirmAlertDelivery,
  evaluateThresholds,
  findRelayExecution,
  isRetryableStatus,
  monthWindow,
  parseThresholds,
  readMonthlyExecutionCount,
} = require('../scripts/n8n-execution-quota-watchdog');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

async function run() {
  const guatemala = monthWindow(new Date('2026-07-13T12:00:00.000Z'), 'America/Guatemala');
  ok(guatemala.key === '2026-07', 'month key follows the configured staff time zone');
  ok(guatemala.start.toISOString() === '2026-07-01T06:00:00.000Z', 'month starts at local midnight');
  ok(guatemala.end.toISOString() === '2026-08-01T06:00:00.000Z', 'month ends at next local midnight');

  const calls = [];
  const usage = await readMonthlyExecutionCount({
    baseUrl: 'https://fixture.invalid',
    apiKey: 'fixture-key',
    now: new Date('2026-07-15T00:00:00.000Z'),
    timeZone: 'UTC',
    sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({
        total: { value: calls.length === 1 ? 1000 : 234, unit: 'count', deviation: 10 },
        failed: { value: calls.length === 1 ? 10 : 2, unit: 'count', deviation: 2 },
      });
    },
  });
  ok(usage.execution_count === 1234 && usage.failed_count === 12, 'billing-grade Insights production totals are preserved');
  ok(usage.source === 'n8n_insights_summary' && usage.complete, 'the result identifies the compacted Insights source');
  ok(calls.length === 2 && calls.every(call => call.options.method === 'GET'), 'closed and current days use read-only Insights queries');
  const insightsUrl = new URL(calls[0].url);
  ok(insightsUrl.pathname === '/api/v1/insights/summary', 'the supported public Insights endpoint owns the count');
  ok(insightsUrl.searchParams.get('startDate') === '2026-07-01T00:00:00.000Z'
    && insightsUrl.searchParams.get('endDate') === '2026-07-15T00:00:00.000Z'
    && new URL(calls[1].url).searchParams.get('startDate') === '2026-07-15T00:00:00.000Z'
    && new URL(calls[1].url).searchParams.get('endDate') === '2026-07-17T00:00:00.000Z',
  'closed days and current day form nonoverlapping calendar intervals, the open one two days long');
  ok(usage.checkpoint.through === '2026-07-15T00:00:00.000Z'
    && usage.checkpoint.execution_count === 1000,
  'only complete days enter the checkpoint');

  let missingHistoryFailed = false;
  try {
    await readMonthlyExecutionCount({
      baseUrl: 'https://fixture.invalid', apiKey: 'fixture-key',
      now: new Date('2026-07-28T12:00:00.000Z'), timeZone: 'UTC',
      fetchImpl: async () => { throw new Error('should not query a partial month'); },
    });
  } catch (error) {
    missingHistoryFailed = /complete monthly checkpoint is required/.test(String(error.message));
  }
  ok(missingHistoryFailed, 'missing early history fails before a partial count can pass');

  const resumedCalls = [];
  const resumed = await readMonthlyExecutionCount({
    baseUrl: 'https://fixture.invalid', apiKey: 'fixture-key',
    now: new Date('2026-07-28T12:00:00.000Z'), timeZone: 'UTC',
    checkpoint: { month: '2026-07', time_zone: 'UTC', through: '2026-07-26T00:00:00.000Z', execution_count: 4000, failed_count: 40 },
    fetchImpl: async url => {
      resumedCalls.push(new URL(url));
      return response({ total: { value: resumedCalls.length === 1 ? 200 : 30, unit: 'count' }, failed: { value: resumedCalls.length === 1 ? 2 : 1, unit: 'count' } });
    },
  });
  ok(resumed.execution_count === 4230 && resumed.checkpoint.execution_count === 4200
    && resumedCalls[0].searchParams.get('startDate') === '2026-07-26T00:00:00.000Z'
    && resumed.checkpoint.through === '2026-07-28T00:00:00.000Z',
  'a verified checkpoint carries forward exactly the uncovered closed days');

  const foldedCalls = [];
  const folded = await readMonthlyExecutionCount({
    baseUrl: 'https://fixture.invalid', apiKey: 'fixture-key',
    now: new Date('2026-07-28T12:00:00.000Z'), timeZone: 'UTC',
    checkpoint: { month: '2026-07', time_zone: 'UTC', through: '2026-07-27T00:00:00.000Z', execution_count: 4000, failed_count: 40 },
    fetchImpl: async url => {
      foldedCalls.push(new URL(url));
      return response({ total: { value: 230, unit: 'count' }, failed: { value: 3, unit: 'count' } });
    },
  });
  ok(foldedCalls.length === 1
    && foldedCalls[0].searchParams.get('startDate') === '2026-07-27T00:00:00.000Z'
    && foldedCalls[0].searchParams.get('endDate') === '2026-07-30T00:00:00.000Z'
    && folded.execution_count === 4230 && folded.failed_count === 43
    && folded.checkpoint.through === '2026-07-27T00:00:00.000Z' && folded.checkpoint.execution_count === 4000,
  'a single closed day is never queried alone: it is read with today and the checkpoint waits a day');

  const nullFailed = await readMonthlyExecutionCount({
    baseUrl: 'https://fixture.invalid', apiKey: 'fixture-key',
    now: new Date('2026-07-28T12:00:00.000Z'), timeZone: 'UTC',
    checkpoint: { month: '2026-07', time_zone: 'UTC', through: '2026-07-26T00:00:00.000Z', execution_count: 4000, failed_count: null },
    fetchImpl: async () => response({ total: { value: 10, unit: 'count' }, failed: { value: 1, unit: 'count' } }),
  });
  ok(nullFailed.execution_count === 4020 && nullFailed.failed_count === null && nullFailed.checkpoint.failed_count === null,
    'a checkpoint saved without the optional failed count still resumes the total');

  let partialCheckpointFailed = false;
  try {
    await readMonthlyExecutionCount({
      baseUrl: 'https://fixture.invalid', apiKey: 'fixture-key',
      now: new Date('2026-07-28T12:00:00.000Z'), timeZone: 'UTC',
      checkpoint: { month: '2026-07', time_zone: 'UTC', through: '2026-07-15T17:39:00.000Z', execution_count: 1000, failed_count: 10 },
      fetchImpl: async () => response({ total: { value: 1, unit: 'count' } }),
    });
  } catch (error) { partialCheckpointFailed = /checkpoint is invalid/.test(String(error.message)); }
  ok(partialCheckpointFailed, 'a mid-day count cannot masquerade as a complete-day checkpoint');

  let invalidSummaryFailed = false;
  try {
    await readMonthlyExecutionCount({
      baseUrl: 'https://fixture.invalid',
      apiKey: 'fixture-key',
      now: new Date('2026-07-15T00:00:00.000Z'),
      timeZone: 'UTC',
      sleepImpl: async () => {},
      fetchImpl: async () => response({ total: { value: 'not-a-count', unit: 'count' } }),
    });
  } catch (error) {
    invalidSummaryFailed = /valid production execution total/.test(String(error && error.message));
  }
  ok(invalidSummaryFailed, 'an invalid Insights summary fails closed');

  // A stand-in for n8n's Insights summary that applies its real rules (n8n
  // packages/modules/insights: validateDateFiltersLicense, getDateFiltersGranularity
  // and getDateRangesCommonTableExpressionQuery). Hourly mode is decided on the
  // SERVER's wall clock (America/New_York by default), not the timeZone parameter;
  // an end date other than today takes that whole local day; executions are known
  // per Guatemala day. On 2026-10-31 the old one-day read crossed the US fall-back.
  const SERVER_ZONE = 'America/New_York';
  const STAFF_ZONE = 'America/Guatemala';
  const dayKey = (date, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  function wallMs(date, zone) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  const perDay = key => 100 + Number(key.slice(8, 10)) + 7 * Number(key.slice(5, 7));
  function n8nInsights(now) {
    const sent = [];
    const impl = async url => {
      const u = new URL(url);
      const start = new Date(u.searchParams.get('startDate'));
      const end = new Date(u.searchParams.get('endDate'));
      const zone = u.searchParams.get('timeZone');
      sent.push({ start: start.toISOString(), end: end.toISOString() });
      if ((wallMs(end, SERVER_ZONE) - wallMs(start, SERVER_ZONE)) / 86400000 < 1) {
        return response({ message: 'Hourly data is not available with your current license' }, 403);
      }
      const endIsToday = dayKey(end, zone) === dayKey(now, zone);
      let total = 0;
      for (let t = start.getTime(); ; t += 3600 * 1000) {
        const key = dayKey(new Date(t), zone);
        if (endIsToday ? t >= end.getTime() : key > dayKey(end, zone)) break;
        if (key > dayKey(now, zone)) break; // no future executions
        if (dayKey(new Date(t - 3600 * 1000), zone) !== key || t === start.getTime()) total += perDay(key);
      }
      return response({ total: { value: total, unit: 'count' }, failed: { value: 0, unit: 'count' } });
    };
    return { impl, sent };
  }

  const halloween = new Date('2026-10-31T13:17:02.000Z');
  const oldShape = n8nInsights(halloween);
  const oldRead = await (await oldShape.impl(`https://fixture.invalid/api/v1/insights/summary?startDate=2026-10-31T06:00:00.000Z&endDate=2026-11-01T06:00:00.000Z&timeZone=${STAFF_ZONE}`)).text();
  ok(/Hourly data is not available/.test(oldRead),
    'the n8n stand-in refuses the exact one-day read the 2026-10-31 run sent');

  async function simulate(days, label, { every = 1 } = {}) {
    let checkpoint = null;
    let wrong = [];
    let refused = [];
    for (let i = 0; i < days.length; i += every) {
      const now = days[i];
      const month = dayKey(now, STAFF_ZONE).slice(0, 7);
      if (checkpoint && checkpoint.month !== month) checkpoint = null; // the cache key is per month
      const n8n = n8nInsights(now);
      let usage;
      try {
        usage = await readMonthlyExecutionCount({
          baseUrl: 'https://fixture.invalid', apiKey: 'fixture-key', now, timeZone: STAFF_ZONE,
          checkpoint, sleepImpl: async () => {}, fetchImpl: n8n.impl, maxHistoryDays: 14,
        });
      } catch (error) {
        refused.push(`${dayKey(now, STAFF_ZONE)}: ${error.message}`);
        continue;
      }
      let expected = 0;
      const todayKey = dayKey(now, STAFF_ZONE);
      for (let d = 1; d <= Number(todayKey.slice(8, 10)); d++) expected += perDay(`${month}-${String(d).padStart(2, '0')}`);
      if (usage.execution_count !== expected) wrong.push(`${todayKey}: ${usage.execution_count} != ${expected}`);
      checkpoint = usage.checkpoint;
    }
    ok(!refused.length, `${label}: no read is refused (${refused[0] || 'none'})`);
    ok(!wrong.length, `${label}: every daily total equals the month's executions exactly (${wrong[0] || 'none'})`);
  }
  const dailyRuns = (from, count, at = '13:17:02') => Array.from({ length: count }, (_, i) => {
    const d = new Date(`${from}T${at}.000Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });
  await simulate(dailyRuns('2026-10-01', 40), 'Oct to early Nov 2026 (US fall-back on 1 Nov, month end on 31 Oct)');
  await simulate(dailyRuns('2026-10-01', 40, '18:40:00'), 'the same days at the evening schedule fallback');
  await simulate(dailyRuns('2026-10-01', 40), 'the same days when every other run is missed', { every: 2 });
  await simulate(dailyRuns('2027-10-01', 45), 'Oct to mid Nov 2027 (US fall-back on 7 Nov, mid-month)');
  await simulate(dailyRuns('2027-03-01', 31), 'March 2027 (US spring-forward on 14 Mar)');

  // The failing run itself: 2026-10-31 13:17 UTC, resuming the checkpoint the
  // 2026-10-30 run saved (complete days through 30 Oct 00:00 Guatemala).
  const octoberCheckpoint = { month: '2026-10', time_zone: STAFF_ZONE, through: '2026-10-30T06:00:00.000Z', execution_count: 0, failed_count: 0 };
  for (let d = 1; d <= 29; d++) octoberCheckpoint.execution_count += perDay(`2026-10-${String(d).padStart(2, '0')}`);
  const rerun = n8nInsights(halloween);
  let rerunUsage = null;
  let rerunError = '';
  try {
    rerunUsage = await readMonthlyExecutionCount({
      baseUrl: 'https://fixture.invalid', apiKey: 'fixture-key', now: halloween, timeZone: STAFF_ZONE,
      checkpoint: octoberCheckpoint, sleepImpl: async () => {}, fetchImpl: rerun.impl,
    });
  } catch (error) { rerunError = error.message; }
  ok(rerunUsage && rerunUsage.execution_count === octoberCheckpoint.execution_count + perDay('2026-10-30') + perDay('2026-10-31'),
    `the 2026-10-31 run passes with the exact October total (${rerunError || 'ok'})`);
  ok(rerun.sent.length === 1 && rerun.sent[0].start === '2026-10-30T06:00:00.000Z' && rerun.sent[0].end === '2026-11-02T06:00:00.000Z',
    'on 2026-10-31 the closed 30th and today are read as one three-day range');
  await simulate(dailyRuns('2026-11-01', 1), 'a first run on the first day of a month');

  const firstCrossing = evaluateThresholds({ count: 95, cap: 100, thresholds: [80, 90], alreadyAlerted: [] });
  ok(firstCrossing.due.join(',') === '80,90', 'a first observation above 90 emits both missed threshold alerts');
  ok(firstCrossing.remaining === 5 && firstCrossing.percent === 95, 'headroom and percentage are exact');

  const secondCrossing = evaluateThresholds({ count: 95, cap: 100, thresholds: [80, 90], alreadyAlerted: [80] });
  ok(secondCrossing.due.join(',') === '90', 'the monthly 80 marker suppresses repeats without suppressing 90');
  ok(evaluateThresholds({ count: 79, cap: 100, thresholds: [80, 90], alreadyAlerted: [] }).due.length === 0,
    'usage below 80 stays quiet');

  const payload = alertPayload({ month: '2026-07', threshold: 90, assessment: secondCrossing, runId: '123' });
  ok(payload.type === 'n8n_quota_90', 'alert identifies the crossed threshold');
  ok(/used_95_cap_100_remaining_5_pct_95\.0/.test(payload.issue_identifier), 'alert carries used, cap, percentage, and remaining headroom');
  ok(payload.team === 'account' && payload.details.run_id === '123', 'alert uses the existing owner relay shape');

  const relayExecution = {
    id: 'fixture-execution',
    status: 'success',
    data: {
      resultData: {
        runData: {
          'Receive Edge Alert': [{ data: { main: [[{ json: { body: payload } }]] } }],
        },
      },
    },
  };
  ok(findRelayExecution([relayExecution], { runId: '123', type: 'n8n_quota_90' }) === relayExecution,
    'relay confirmation matches both the unique run token and alert type');
  ok(findRelayExecution([relayExecution], { runId: 'wrong', type: 'n8n_quota_90' }) === null,
    'relay confirmation cannot adopt an unrelated execution');

  const confirmationCalls = [];
  const confirmed = await confirmAlertDelivery({
    baseUrl: 'https://fixture.invalid',
    apiKey: 'fixture-key',
    workflowId: 'fixture-workflow',
    runId: '123',
    type: 'n8n_quota_90',
    sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      confirmationCalls.push({ url: String(url), options });
      return response({ data: confirmationCalls.length === 1 ? [] : [relayExecution] });
    },
  });
  ok(confirmed.id === 'fixture-execution' && confirmationCalls.length === 2,
    'alert delivery waits for the matching relay execution to finish');
  const confirmationUrl = new URL(confirmationCalls[0].url);
  ok(confirmationCalls[0].options.method === 'GET'
    && confirmationUrl.searchParams.get('workflowId') === 'fixture-workflow'
    && confirmationUrl.searchParams.get('includeData') === 'true',
  'alert delivery confirmation is a read-only workflow-scoped API poll');

  ok(parseThresholds('90,80,80').join(',') === '80,90', 'threshold parsing sorts and deduplicates');
  ok(isRetryableStatus(429) && isRetryableStatus(500) && !isRetryableStatus(401), 'only throttling and server failures retry');

  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'n8n-execution-quota-watchdog.yml'), 'utf8');
  ok(workflow.includes('N8N_QUOTA_DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}')
    && workflow.includes('Live quota runs are allowed only on the default branch'),
  'production alerts and monthly markers are restricted to the default branch');

  if (failures) {
    console.error(`\n${failures} n8n quota watchdog check(s) failed`);
    process.exit(1);
  }
  console.log('\nn8n execution quota watchdog checks passed');
}

run().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});

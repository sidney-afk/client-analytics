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
        total: { value: 1234, unit: 'count', deviation: 10 },
        failed: { value: 12, unit: 'count', deviation: 2 },
      });
    },
  });
  ok(usage.execution_count === 1234 && usage.failed_count === 12, 'billing-grade Insights production totals are preserved');
  ok(usage.source === 'n8n_insights_summary' && usage.complete, 'the result identifies the compacted Insights source');
  ok(calls.length === 1 && calls[0].options.method === 'GET', 'n8n Insights access is one read-only request');
  const insightsUrl = new URL(calls[0].url);
  ok(insightsUrl.pathname === '/api/v1/insights/summary', 'the supported public Insights endpoint owns the count');
  ok(insightsUrl.searchParams.get('startDate') === '2026-07-01T00:00:00.000Z'
    && insightsUrl.searchParams.get('endDate') === '2026-07-15T00:00:00.000Z',
  'the query spans the exact current calendar month through now');

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

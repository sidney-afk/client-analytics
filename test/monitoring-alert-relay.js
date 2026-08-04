'use strict';

/*
 * Locks the alert last hop.
 *
 * Two defects made every page useless and this suite exists so neither can
 * come back: (1) requiring the response body to be the literal string "ok",
 * which is a Slack-incoming-webhook contract the relay does not honour, and
 * (2) posting `{ text }` only, which the relay renders as
 * `type=edge_alert issue=unknown team=unknown` — delivered and contentless.
 */

const fs = require('fs');
const path = require('path');
const {
  RELAY_SUMMARY_BUDGET,
  assertPublicSafe,
  confirmRelayDelivery,
  findRelayExecution,
  fitSummary,
  postAlert,
  relayAlphabet,
  relayPayload,
  relayToken,
  sendAlert,
} = require('../scripts/monitoring-alert-relay');

let failures = 0;
function ok(condition, message) {
  if (!condition) {
    console.error('FAIL monitoring-alert-relay:', message);
    failures++;
  }
}

async function rejects(promise, message) {
  try {
    await promise;
    ok(false, message);
  } catch (_error) {
    ok(true, message);
  }
}

const response = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => body,
  json: async () => JSON.parse(body),
});

const noSleep = async () => {};

(async () => {
  // ---------------------------------------------------------------------
  // Defect 1: the success predicate.
  // ---------------------------------------------------------------------
  {
    // The exact body that broke it: n8n answers 200 with a JSON envelope.
    const accepted = await postAlert({ type: 't' }, {
      webhook: 'https://relay.example/hook',
      fetchImpl: async () => response(200, '{"message":"Workflow was started"}'),
      sleepImpl: noSleep,
    });
    ok(accepted.accepted === true && accepted.status === 200,
      'a 200 whose body is not "ok" must count as accepted');
  }

  for (const status of [201, 202, 204]) {
    const accepted = await postAlert({ type: 't' }, {
      webhook: 'https://relay.example/hook',
      fetchImpl: async () => response(status, ''),
      sleepImpl: noSleep,
    });
    ok(accepted.accepted === true, `HTTP ${status} must count as accepted`);
  }

  await rejects(postAlert({ type: 't' }, {
    webhook: 'https://relay.example/hook',
    fetchImpl: async () => response(404, 'ok'),
    sleepImpl: noSleep,
  }), 'a non-2xx must still fail even when the body says "ok"');

  {
    let calls = 0;
    const accepted = await postAlert({ type: 't' }, {
      webhook: 'https://relay.example/hook',
      fetchImpl: async () => { calls++; return response(calls < 3 ? 503 : 200, ''); },
      sleepImpl: noSleep,
    });
    ok(accepted.accepted === true && calls === 3, 'a retryable status must be retried before giving up');
  }

  await rejects(postAlert({ type: 't' }, { webhook: '', fetchImpl: async () => response(200, '') }),
    'an absent webhook must fail loudly rather than silently skipping the page');

  {
    // The relay URL is a secret and this repository is public.
    let message = '';
    try {
      await postAlert({ type: 't' }, {
        webhook: 'https://relay.example/hook/super-secret-path',
        fetchImpl: async () => response(400, 'nope'),
        sleepImpl: noSleep,
      });
    } catch (error) { message = String(error && error.message); }
    ok(message && !message.includes('super-secret-path') && !message.includes('relay.example'),
      'a rejected page must not leak the webhook URL into a public Actions log');
  }

  // ---------------------------------------------------------------------
  // Defect 2: the payload shape the relay actually renders.
  // ---------------------------------------------------------------------
  {
    const payload = relayPayload({
      type: 'reconcile_repair_list_size',
      summary: 'repairs_drift runs=1:2 repair_list_size=27->29',
      team: 'video,graphics',
      count: 29,
      runId: 'run-123',
    });
    ok(payload.type === 'reconcile_repair_list_size', 'type must be sent — the relay renders it');
    // Normalised to the relay's own alphabet, so this is literally what renders.
    ok(payload.issue_identifier.includes('repair_list_size_27_29'),
      'the incident summary must ride in issue_identifier, the widest rendered field');
    ok(payload.team === 'video_graphics', 'team must be sent — the relay renders it');
    ok(payload.count === 29, 'count must be sent — the relay renders it');
    ok(payload.details.run_id === 'run-123', 'details.run_id must be sent — the relay renders it');
    ok(typeof payload.text === 'string' && payload.text.length > 0,
      'text is kept so a plain Slack incoming webhook is still a valid target');
  }

  {
    // `team` may honestly be unknown; `type` and the summary never may — those
    // two falling through to the relay defaults is what produced the
    // contentless `type=edge_alert issue=unknown` DMs.
    const payload = relayPayload({ type: '', summary: '', team: '' });
    ok(payload.type !== 'edge_alert' && payload.type.length > 0,
      'an under-specified page must not fall through to the relay type default');
    ok(payload.issue_identifier !== 'unknown' && payload.issue_identifier.length > 0,
      'an under-specified page must not fall through to the relay issue default');
  }

  ok(relayToken('a\nb\tc   d').indexOf('\n') === -1, 'rendered tokens must be single-line');
  ok(relayToken('x'.repeat(500), 100).length === 100, 'rendered tokens must be bounded');

  // ---------------------------------------------------------------------
  // What the relay does to the summary, measured off a real delivered
  // message (run 30945918826): every non-alphanumeric becomes `_`, and the
  // field is cut at ~100 characters. The first dead-man's-switch page lost
  // two of its four lane names to exactly this.
  // ---------------------------------------------------------------------
  {
    ok(relayAlphabet('a=b/c d-e') === 'a_b_c_d_e',
      'the client must normalise to the relay\'s alphabet so callers see what the owner sees');
    ok(relayAlphabet('__lead and trail__') === 'lead_and_trail',
      'normalisation must not leave separator noise at the edges');
  }

  {
    const long = ['first', 'second', 'third', 'fourth', 'fifth']
      .map(word => `${word}_lane_is_quite_long_indeed`);
    const fitted = fitSummary(long);
    ok(fitted.length <= RELAY_SUMMARY_BUDGET,
      'a summary must fit the relay\'s rendered budget rather than be cut mid-word by the relay');
    ok(/plus\d+more/.test(fitted),
      'dropped parts must be announced in the message — silent truncation makes a partial page look complete');
    ok(fitted.startsWith('first_lane'),
      'the earliest (most important) parts must survive the trim');

    const short = fitSummary(['lanes2', 'no_heartbeat']);
    ok(short === 'lanes2_no_heartbeat' && !/plus\d+more/.test(short),
      'a summary that fits must not be marked as trimmed');
  }

  {
    // The end-to-end shape of the page that actually went out.
    const payload = relayPayload({
      type: 'monitoring_heartbeat_stale',
      summaryParts: ['lanes4', 'no_heartbeat', 'reconciler_pager=never/max240m',
        'monitoring_watchdog=never/max180m', 'production_write_drill=never/max2160m',
        'b1_incremental_refresh=never/max240m'],
      team: 'monitoring',
      count: 4,
      runId: 'r',
    });
    ok(payload.issue_identifier.length <= RELAY_SUMMARY_BUDGET,
      'the built page must already fit the relay budget');
    ok(payload.issue_identifier.startsWith('lanes4'),
      'the lane count must survive even a heavy trim — it is the one fact a truncated page must still carry');
  }

  // ---------------------------------------------------------------------
  // Public safety: this repository is public and the relay DMs a person.
  // ---------------------------------------------------------------------
  for (const [field, value] of [
    ['summary', 'see https://hooks.example.com/T000/B000/xxxx'],
    ['summary', 'contact someone@example.com about it'],
    ['summary', 'token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'],
  ]) {
    let threw = false;
    try { relayPayload({ type: 'x', team: 'y', [field]: value }); } catch (_error) { threw = true; }
    ok(threw, `a payload carrying ${value.slice(0, 18)}... must be refused before it reaches a DM`);
  }

  {
    let message = '';
    try { assertPublicSafe({ summary: 'https://hooks.example.com/secret-path-abc' }); } catch (error) {
      message = String(error && error.message);
    }
    ok(message.includes('summary') && !message.includes('secret-path-abc'),
      'the public-safety refusal must name the field, never echo the offending value');
  }

  // ---------------------------------------------------------------------
  // Acceptance is not delivery.
  // ---------------------------------------------------------------------
  {
    const execution = {
      id: 42,
      status: 'success',
      data: { resultData: { runData: { 'Receive Edge Alert': [{ data: { main: [[{ json: { body: { type: 'monitoring_selftest', details: { run_id: 'r-9' } } } }]] } }] } } },
    };
    ok(findRelayExecution([execution], { runId: 'r-9', type: 'monitoring_selftest' }) === execution,
      'a page must be correlated to its own relay execution by run_id + type');
    ok(findRelayExecution([execution], { runId: 'r-8', type: 'monitoring_selftest' }) === null,
      'another page\'s execution must never be counted as this page\'s receipt');

    const confirmed = await confirmRelayDelivery({
      runId: 'r-9',
      type: 'monitoring_selftest',
      apiKey: 'k',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [execution] }) }),
      sleepImpl: noSleep,
      attempts: 1,
    });
    ok(confirmed.confirmed === true && confirmed.execution_id === '42',
      'a terminal success execution must confirm delivery');

    const errored = await confirmRelayDelivery({
      runId: 'r-9',
      type: 'monitoring_selftest',
      apiKey: 'k',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [{ ...execution, status: 'error' }] }) }),
      sleepImpl: noSleep,
      attempts: 1,
    });
    ok(errored.confirmed === false && errored.reason === 'relay_execution_error',
      'a failed relay execution must not read as delivered');

    const unknown = await confirmRelayDelivery({ runId: 'r', type: 't', apiKey: '' });
    ok(unknown.confirmed === false && unknown.reason === 'n8n_api_key_absent',
      'an absent API key must read as unknown delivery, never as delivered');
  }

  {
    // The end-to-end shape a monitor gets back: accepted, but honest that
    // nothing proved a human saw it.
    const receipt = await sendAlert(
      { type: 'monitoring_selftest', summary: 's', team: 'monitoring', runId: 'r-1' },
      {
        webhook: 'https://relay.example/hook',
        fetchImpl: async () => response(200, '{"message":"Workflow was started"}'),
        sleepImpl: noSleep,
        apiKey: '',
      },
    );
    ok(receipt.accepted === true && receipt.delivery_confirmed === false
      && receipt.delivery_reason === 'n8n_api_key_absent',
      'acceptance without a receipt must be reported as unconfirmed, not as success');
  }

  // ---------------------------------------------------------------------
  // No caller may reintroduce the string match.
  // ---------------------------------------------------------------------
  {
    const root = path.join(__dirname, '..', 'scripts');
    for (const file of ['linear-reconcile-inbound-pager.js', 'track-b-backup.js', 'monitoring-alert-relay.js', 'monitoring-watchdog.js']) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      // Match the predicate itself, not the prose explaining why it is gone.
      ok(!/toLowerCase\(\)\s*!==\s*['"]ok['"]/.test(source),
        `${file} must not gate alert success on the response body being "ok"`);
    }
    const pager = fs.readFileSync(path.join(root, 'linear-reconcile-inbound-pager.js'), 'utf8');
    ok(/require\(['"]\.\/monitoring-alert-relay['"]\)/.test(pager),
      'the pager must deliver through the shared relay client');
  }

  console.log(failures ? `monitoring-alert-relay: ${failures} check(s) failed` : 'monitoring-alert-relay checks passed');
  process.exit(failures ? 1 : 0);
})();

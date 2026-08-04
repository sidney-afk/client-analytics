'use strict';

/*
 * One client for the owner alert relay, shared by every repository-hosted
 * monitor. It exists because two independent defects made the alarm useless,
 * and both live at this last hop.
 *
 * DEFECT 1 -- the success predicate.
 * `postSlack` used to require the response body to be literally the string
 * "ok". That is the contract of a *Slack incoming webhook*. `SLACK_ALERT_WEBHOOK`
 * no longer points at one: it points at the n8n relay `Tfhc3vebZyG6obOg`
 * (`SyncView Edge Alert Relay -> DM Sidney`), whose webhook node answers 200
 * with a JSON envelope. So every page threw AFTER the POST had already been
 * accepted -- which also meant the caller never reached its "latch this
 * incident" step, so the same incident re-paged on every later run.
 *
 * DEFECT 2 -- the payload shape.
 * The relay does not echo `text`. It renders its own line from named fields:
 *
 *   [SyncView] Edge anomaly alert: type=<type> issue=<issue_identifier> \
 *     team=<team> count=<count> run_id=<details.run_id>
 *
 * with `edge_alert` / `unknown` / `unknown` as the defaults for the first
 * three, and `count` / `run_id` omitted when absent. Callers that posted only
 * `{ text }` therefore delivered a message that said nothing at all. That is
 * exactly the contentless `type=edge_alert issue=unknown team=unknown` DM the
 * owner sees ~20-25 times a day: the reconciler pager firing, arriving, and
 * carrying none of its content -- then failing its own success check so it
 * never latched and fired again next run.
 *
 * The contract above is not guessed. It is read back off live delivered
 * messages produced by `scripts/n8n-execution-quota-watchdog.js`, the one
 * caller that already sent the typed shape, e.g.
 *
 *   [SyncView] Edge anomaly alert: type=n8n_quota_80
 *     issue=month_2026-07_used_109287_cap_135000_remaining_25713_pct_81.0
 *     team=account count=109287 run_id=29268930214-1-80
 *
 * See docs/audits/2026-08-04-monitoring-readiness-cutover.md.
 *
 * PUBLIC SAFETY. This repository is public and the relay DMs a person. Every
 * field here is caller-supplied and must already be public-safe: aggregate
 * counts, GitHub run handles, team keys, Linear identifiers. Never a client
 * slug, name, email, token, webhook URL or raw payload body. `assertPublicSafe`
 * is a backstop, not a licence to pass secrets through it.
 *
 * ACCEPTANCE IS NOT DELIVERY. The relay's webhook responds before the Slack
 * step runs, so 2xx proves the relay took the message, nothing more. When an
 * n8n API key is available, `confirmRelayDelivery` correlates the terminal
 * execution by `details.run_id` and turns acceptance into a real receipt.
 */

const DEFAULT_RELAY_BASE_URL = 'https://synchrosocial.app.n8n.cloud';
const DEFAULT_RELAY_WORKFLOW_ID = 'Tfhc3vebZyG6obOg';
const RELAY_WEBHOOK_NODE = 'Receive Edge Alert';

// The relay renders these five and drops everything else. `text` is kept in the
// body so a plain Slack incoming webhook stays a valid target for this client
// too; the relay simply ignores it.
const RELAY_RENDERED_FIELDS = Object.freeze(['type', 'issue_identifier', 'team', 'count', 'details.run_id']);

// Anything matching these must never reach a DM from this public repository.
const FORBIDDEN_VALUE_PATTERNS = Object.freeze([
  /https?:\/\//i,                         // webhook URLs / private links
  /\beyJ[A-Za-z0-9_-]{10,}/,              // JWT-shaped credentials
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // email addresses
]);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Collapse a value into something the relay can render on one line: no
 * newlines, no control characters, bounded length.
 */
function relayToken(value, maxLength = 240) {
  const text = clean(value).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}~` : text;
}

function assertPublicSafe(payload) {
  const offenders = [];
  const walk = (value, path) => {
    if (value == null) return;
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
      return;
    }
    const text = String(value);
    if (FORBIDDEN_VALUE_PATTERNS.some(pattern => pattern.test(text))) offenders.push(path);
  };
  walk(payload, '');
  if (offenders.length) {
    // Report the FIELD NAMES only. Echoing the offending value would put the
    // very thing we are refusing to send into a public Actions log.
    throw new Error(`alert payload carries non-public-safe fields: ${offenders.sort().join(', ')}`);
  }
  return true;
}

/**
 * Build the relay body. `issue_identifier` is the widest rendered field, so
 * callers should pack the human-readable summary of the incident into it --
 * that is the part of the DM an operator actually reads.
 */
function relayPayload({ type, summary, team, count, runId, details = {}, text = '' }) {
  const resolvedType = relayToken(type, 64) || 'syncview_alert';
  const resolvedSummary = relayToken(summary, 240) || 'no_summary';
  const resolvedTeam = relayToken(team, 64) || 'unknown';
  const payload = {
    // --- rendered by the relay ---
    type: resolvedType,
    issue_identifier: resolvedSummary,
    team: resolvedTeam,
    details: { ...details, run_id: relayToken(runId, 96) || 'local' },
    // --- ignored by the relay, kept for a plain Slack incoming webhook ---
    text: relayToken(text, 900) || `[SyncView] ${resolvedType}: ${resolvedSummary} team=${resolvedTeam}`,
    syncview_alert: true,
    source: 'repository-monitor',
  };
  if (Number.isFinite(Number(count))) payload.count = Number(count);
  assertPublicSafe(payload);
  return payload;
}

/**
 * POST the alert. Success is HTTP 2xx -- the relay's actual contract. The
 * response body is returned for diagnostics and deliberately NOT asserted on:
 * pinning it to one literal string is the defect this function replaces.
 */
async function postAlert(payload, {
  webhook = process.env.SLACK_ALERT_WEBHOOK,
  fetchImpl = fetch,
  attempts = 3,
  sleepImpl = sleep,
} = {}) {
  const url = clean(webhook);
  if (!url) throw new Error('SLACK_ALERT_WEBHOOK is required when paging');
  let lastError = null;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      lastError = new Error(`alert relay transport failure: ${clean(error && error.message).slice(0, 200)}`);
      if (attempt === attempts) throw lastError;
      await sleepImpl(500 * attempt);
      continue;
    }
    const body = await response.text().catch(() => '');
    if (response.status >= 200 && response.status < 300) {
      return { accepted: true, status: response.status, body: body.slice(0, 300) };
    }
    // The relay URL itself is a secret; never let it into an error string.
    lastError = new Error(`alert relay rejected the page with HTTP ${response.status}`);
    if (!isRetryableStatus(response.status) || attempt === attempts) throw lastError;
    await sleepImpl(500 * attempt);
  }
  throw lastError || new Error('alert relay did not accept the page');
}

function relayExecutionBody(execution) {
  try {
    return execution.data.resultData.runData[RELAY_WEBHOOK_NODE][0].data.main[0][0].json.body || null;
  } catch (_error) {
    return null;
  }
}

function findRelayExecution(executions, { runId, type }) {
  return (Array.isArray(executions) ? executions : []).find(execution => {
    const body = relayExecutionBody(execution);
    return body && clean(body.type) === clean(type)
      && body.details && clean(body.details.run_id) === clean(runId);
  }) || null;
}

/**
 * Turn acceptance into delivery. Mirrors the quota watchdog's proven approach:
 * poll the relay workflow's executions and match this exact page by
 * `details.run_id`, then require a terminal `success`.
 *
 * Returns `{ confirmed: false, reason }` when no API key is configured -- an
 * absent receipt must read as "unknown", never as "delivered".
 */
async function confirmRelayDelivery({
  runId,
  type,
  apiKey = process.env.N8N_API_KEY,
  baseUrl = process.env.N8N_BASE_URL || DEFAULT_RELAY_BASE_URL,
  workflowId = process.env.SYNCVIEW_ALERT_RELAY_WORKFLOW_ID || DEFAULT_RELAY_WORKFLOW_ID,
  fetchImpl = fetch,
  sleepImpl = sleep,
  attempts = 12,
} = {}) {
  if (!clean(apiKey)) return { confirmed: false, reason: 'n8n_api_key_absent' };
  const root = clean(baseUrl).replace(/\/+$/, '');
  const url = new URL(`${root}/api/v1/executions`);
  url.searchParams.set('workflowId', clean(workflowId));
  url.searchParams.set('limit', '20');
  url.searchParams.set('includeData', 'true');

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let payload = null;
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { 'X-N8N-API-KEY': clean(apiKey), Accept: 'application/json' },
      });
      if (response.ok) payload = await response.json().catch(() => null);
    } catch (_error) { /* transient; retried below */ }
    const execution = findRelayExecution(payload && payload.data, { runId, type });
    if (execution) {
      if (execution.status === 'success') {
        return { confirmed: true, execution_id: String(execution.id), status: execution.status };
      }
      if (['error', 'crashed', 'canceled'].includes(execution.status)) {
        return { confirmed: false, reason: `relay_execution_${execution.status}`, execution_id: String(execution.id) };
      }
    }
    if (attempt < attempts) await sleepImpl(1000);
  }
  return { confirmed: false, reason: 'relay_execution_not_observed' };
}

/**
 * The one call a monitor should make: build, send, and (when possible) prove.
 * Throws only when the relay refused the page -- an unconfirmed-but-accepted
 * page is reported, not thrown, because the message may still have arrived.
 */
async function sendAlert(spec, options = {}) {
  const payload = relayPayload(spec);
  const accepted = await postAlert(payload, options);
  const delivery = await confirmRelayDelivery({
    runId: payload.details.run_id,
    type: payload.type,
    ...options,
  });
  return {
    type: payload.type,
    run_id: payload.details.run_id,
    accepted: accepted.accepted,
    http_status: accepted.status,
    delivery_confirmed: delivery.confirmed === true,
    delivery_reason: delivery.reason || null,
    relay_execution_id: delivery.execution_id || null,
    rendered: payload.issue_identifier,
  };
}

module.exports = {
  DEFAULT_RELAY_BASE_URL,
  DEFAULT_RELAY_WORKFLOW_ID,
  FORBIDDEN_VALUE_PATTERNS,
  RELAY_RENDERED_FIELDS,
  RELAY_WEBHOOK_NODE,
  assertPublicSafe,
  confirmRelayDelivery,
  findRelayExecution,
  isRetryableStatus,
  postAlert,
  relayPayload,
  relayToken,
  sendAlert,
};

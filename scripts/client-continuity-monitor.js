'use strict';

// W01/W02/W10 preparation. No scheduler, credentials or implicit network calls.
const { randomUUID } = require('node:crypto');
const { relayPayload, postAlert, confirmRelayDelivery } = require('./monitoring-alert-relay');
const CODES = Object.freeze(['healthy', 'valid_link_auth', 'read_failed', 'false_empty',
  'stale_unwarned', 'stale_overdue', 'count_unproven', 'integration_missing',
  'monitor_missing', 'terminal_missing', 'alert_undelivered', 'ack_overdue',
  'action_unpersisted', 'action_failed', 'cleanup_failed', 'recovered',
  'inconclusive', 'render_failed', 'browser_error', 'mutation_blocked', 'unexpected_request', 'scope_mismatch', 'release_mismatch']);
const LANES = ['calendar', 'samples', 'actions', 'observer'];
function check(value, code = 'integration_missing') { if (!value) throw new Error(code); }
function age(now, at) { return Number.isFinite(at) && at <= now ? now - at : Infinity; }
function report(lane, code, count = 0) {
  check(LANES.includes(lane) && CODES.includes(code));
  check(Number.isSafeInteger(count) && count >= 0);
  return { version: 1, lane, code, count, ok: code === 'healthy' || code === 'recovered' };
}

// Input must describe ONE settled load, same generation/scope/snapshot, with a
// complete independent census for this exact visible filter (never whole roster).
function assessRead(lane, s, now = Date.now()) {
  check(['calendar', 'samples'].includes(lane));
  if (s && s.validLink === true && [401, 403].includes(s.authStatus)) return report(lane, 'valid_link_auth');
  if (!s || s.version !== 1 || s.correlated !== true || s.settled !== true ||
      !['success', 'failure', 'partial'].includes(s.outcome) ||
      !['content', 'empty', 'error'].includes(s.display) ||
      !Number.isSafeInteger(s.renderedCount) || s.renderedCount < 0 ||
      typeof s.warningVisible !== 'boolean' || typeof s.retryVisible !== 'boolean') return report(lane, 'integration_missing');
  if (s.outcome !== 'success' && s.display === 'empty') return report(lane, 'false_empty');
  if (s.display === 'content' && (s.outcome !== 'success' || age(now, s.verifiedAt) > 300000) && !s.warningVisible) return report(lane, 'stale_unwarned');
  if (s.outcome !== 'success') return report(lane, 'read_failed');
  if (age(now, s.verifiedAt) > 300000) return report(lane, 'stale_overdue');
  if (s.complete !== true || s.authorityMatched !== true || !Number.isSafeInteger(s.authoritativeCount) ||
      s.authoritativeCount < 0 || s.renderedCount !== s.authoritativeCount) return report(lane, 'count_unproven');
  if ((s.display === 'empty') !== (s.renderedCount === 0) || s.display === 'error') return report(lane, 'integration_missing');
  return report(lane, 'healthy', s.renderedCount);
}

// Read retries only, at most once; safety/invariant/auth failures never retry.
async function viewingCheck(lane, read, now = Date.now) {
  let result;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { result = assessRead(lane, await bounded(read), now()); }
    catch { result = report(lane, 'read_failed'); }
    if (result.code !== 'read_failed') break;
  }
  return result;
}

async function bounded(fn, milliseconds = 10000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(() => fn(controller.signal)), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('operation_timeout')); }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function assessLiveness({ lane, enabled, activatedAt, lastStartedAt, terminal, incident }, now = Date.now()) {
  check(LANES.includes(lane) && typeof enabled === 'boolean');
  if (!enabled) return { version: 1, lane, code: 'inactive', ok: false, count: 0 };
  const cadence = lane === 'actions' ? 900000 : 300000;
  if (age(now, activatedAt) === Infinity) return report(lane, 'integration_missing');
  // A later start never conceals an absent terminal receipt or failing check.
  if (lastStartedAt && (!terminal || terminal.startedAt !== lastStartedAt) && age(now, lastStartedAt) >= 120000) return report(lane, 'terminal_missing');
  if (!terminal || age(now, terminal.finishedAt) >= cadence * 2) {
    if (age(now, activatedAt) >= cadence * 2) return report(lane, 'monitor_missing');
    return report(lane, 'terminal_missing');
  }
  if (!Number.isFinite(terminal.startedAt) || terminal.finishedAt < terminal.startedAt || !CODES.includes(terminal.code)) return report(lane, 'integration_missing');
  if (incident && incident.delivered !== true) return report(lane, 'alert_undelivered');
  if (incident && incident.acknowledged !== true && age(now, incident.openedAt) >= 600000) return report(lane, 'ack_overdue');
  return report(lane, terminal.code);
}

function formatAlert(result, runId) {
  // Reconstruct from enums/counts, never spread arbitrary caller data.
  const safe = report(result.lane, result.code, result.count);
  check(/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(runId));
  return relayPayload({ type: 'client_continuity', summaryParts: [safe.lane, safe.code],
    team: 'client_surfaces', count: safe.count, runId });
}

// fallback is a separately hosted authenticated receipt interface. A relay 2xx
// with no correlated terminal delivery is failure, so fallback is tried too.
async function routeAlert(result, config, fetchImpl = fetch) {
  check(config.enabled === true && config.activation === 'OWNER_APPROVED_DELIVERY_DRILL');
  let primary, fallback;
  try { primary = new URL(config.primaryUrl); fallback = new URL(config.fallbackUrl); }
  catch { throw new Error('private_route_config_required'); }
  check(primary.protocol === 'https:' && fallback.protocol === 'https:' && primary.hostname !== fallback.hostname);
  check(config.fallbackToken && config.n8nApiKey);
  const runId = randomUUID();
  const payload = formatAlert(result, runId);
  let primaryDelivered = false, fallbackDelivered = false;
  const timedFetch = (url, init) => fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(3000) });
  try {
    await postAlert(payload, { webhook: config.primaryUrl, fetchImpl: timedFetch, attempts: 1 });
    const receipt = await confirmRelayDelivery({ runId, type: payload.type, apiKey: config.n8nApiKey,
      baseUrl: config.n8nBaseUrl, fetchImpl: timedFetch, attempts: 2, sleepImpl: async () => {} });
    primaryDelivered = receipt.confirmed === true;
  } catch { /* raw errors and URLs must never enter public output */ }
  if (!primaryDelivered) {
    try {
      const response = await timedFetch(config.fallbackUrl, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.fallbackToken}` },
        body: JSON.stringify(payload) });
      const receipt = response.ok ? await response.json() : null;
      fallbackDelivered = !!receipt && receipt.run_id === runId && receipt.delivered === true;
    } catch { /* fail closed */ }
  }
  return { version: 1, runId, primaryDelivered, fallbackDelivered,
    delivered: primaryDelivered || fallbackDelivered, acknowledged: false,
    exitCode: primaryDelivered || fallbackDelivered ? 0 : 1 };
}

module.exports = { assessRead, viewingCheck, assessLiveness, formatAlert, routeAlert, report, bounded };

// The request handler for the monitoring-watchdog-tick Edge Function: the
// dead-man's switch's PRIMARY host since 2026-10-09 (OPEN_REPAIRS 388).
//
// WHY IT EXISTS. The switch used to run only from GitHub Actions schedules, and
// GitHub delivers those crons every 3 to 7 hours rather than every 15 minutes,
// so the watchdog's own lane kept reporting ITSELF stale. Supabase's timer
// (pg_cron, through pg_net) runs on the database, outside that queue. See the
// comment above the `monitoring_watchdog` lane in monitoring-watchdog-core.mjs.
//
// WHAT IT RUNS. Exactly the pass `node scripts/monitoring-watchdog.js --check`
// runs: the same `runCheck` from ./monitoring-watchdog-core.mjs (same lanes,
// same thresholds, same latches, same `monitoring_watchdog` beat) and the same
// page shape from ./monitoring-alert-relay-core.mjs. Only the transport is
// local: PostgREST with the service key, and a POST to the alert relay.
//
// WHAT IT DOES NOT RUN: delivery confirmation. The Node relay client polls the
// n8n executions API (N8N_API_KEY) to turn "the relay accepted the page" into
// "the relay finished sending it". That is a receipt, not a gate -- an
// unconfirmed page is still latched and reported, never re-sent -- so it is
// left to the GitHub hosts, and this host does not hold an n8n API key at all.
// Its receipts say `delivery_reason: "not_checked_by_timer_host"`.
//
// ONE WAY IN, refused before the body is read: the timer key
// (X-Monitoring-Watchdog-Key against MONITORING_WATCHDOG_KEY, at least 32
// characters). Actions: `ping` (no database, no page: proves the deploy, the
// key and whether the other secrets are set) and `tick` (one full pass).
// Responses carry lane keys, ages and counts only.
import { runCheck } from './monitoring-watchdog-core.mjs';
import { postAlert, relayPayload } from './monitoring-alert-relay-core.mjs';

export const ACTOR = 'supabase-cron-monitoring-watchdog';
export const KEY_HEADER = 'x-monitoring-watchdog-key';
export const MAX_BODY = 2000;

const clean = (v) => String(v == null ? '' : v).trim();

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** The names of the secrets a tick needs that are not set. Names only, never values. */
export function missingConfig(config) {
  const c = config || {};
  const missing = [];
  if (!clean(c.supabaseUrl)) missing.push('SUPABASE_URL');
  if (!clean(c.serviceKey)) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!clean(c.alertWebhook)) missing.push('MONITORING_ALERT_WEBHOOK');
  return missing;
}

/** The timer host's `io` for the shared core. */
export function timerIo({ config, fetchImpl, runHandle, nowMs, dryRun, sleepImpl }) {
  const base = clean(config.supabaseUrl).replace(/\/+$/, '');
  const key = clean(config.serviceKey);
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  return {
    runHandle,
    nowMs,
    dryRun: Boolean(dryRun),
    async restRows(path) {
      const response = await fetchImpl(`${base}/rest/v1/${path}`, { headers: { ...auth, Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Supabase read HTTP ${response.status}`);
      return response.json();
    },
    async insertEvent(action, payload) {
      const response = await fetchImpl(`${base}/rest/v1/deliverable_events`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify([{ client_slug: '_system', action, source: 'system', actor: ACTOR, payload }]),
      });
      if (!response.ok) throw new Error(`Supabase ${action} HTTP ${response.status}`);
    },
    async sendAlert(spec) {
      const payload = relayPayload(spec);
      const accepted = await postAlert(payload, { webhook: config.alertWebhook, fetchImpl, sleepImpl });
      return {
        type: payload.type,
        run_id: payload.details.run_id,
        accepted: accepted.accepted,
        http_status: accepted.status,
        delivery_confirmed: false,
        delivery_reason: 'not_checked_by_timer_host',
        relay_execution_id: null,
        rendered: payload.issue_identifier,
      };
    },
  };
}

/**
 * deps: keyOk(req) -> boolean; config() -> { supabaseUrl, serviceKey, alertWebhook };
 *       fetchImpl; newId() -> string; now() -> ms; sleepImpl (optional, tests)
 */
export function buildHandler(deps) {
  return async function handle(req) {
    if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    // Authenticate before the body is read or anything is configured.
    if (!clean(req.headers.get(KEY_HEADER)) || !deps.keyOk(req)) return json({ ok: false, error: 'unauthorized' }, 401);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ ok: false, error: 'body_too_large' }, 413);
    let body;
    try { body = JSON.parse(raw || '{}'); } catch (_e) { return json({ ok: false, error: 'bad_json' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'bad_json' }, 400);

    const config = deps.config() || {};
    const missing = missingConfig(config);
    const action = clean(body.action);
    // ping: the schedule migration refuses to install the timer until a signed
    // ping has been answered with ready:true, so a missing deploy, a key that
    // differs from the Vault value or an unset secret stops the install there.
    if (action === 'ping') return json({ ok: true, pong: 'monitoring-watchdog-tick', ready: missing.length === 0, missing });
    if (action !== 'tick') return json({ ok: false, error: 'unknown_action' }, 400);
    if (missing.length) return json({ ok: false, error: 'server_not_configured', missing }, 500);

    try {
      const result = await runCheck(timerIo({
        config,
        fetchImpl: deps.fetchImpl,
        sleepImpl: deps.sleepImpl,
        runHandle: `pgcron:${clean(deps.newId()).slice(0, 8)}`,
        nowMs: deps.now,
        dryRun: body.dry_run === true,
      }));
      // A completed pass is a 200 even when it paged: the page and the latch
      // are the alarm, and pg_net's status column records whether the pass ran.
      return json({ ok: true, host: 'pg_cron', ...result });
    } catch (e) {
      // Error text from this file carries HTTP statuses only. A Deno fetch
      // failure names the URL it tried, and the relay URL is a secret, so any
      // URL is cut out before the text leaves.
      const detail = clean(e && e.message).replace(/https?:\/\/\S+/gi, '<url>').slice(0, 200);
      return json({ ok: false, error: 'check_failed', detail }, 502);
    }
  };
}

'use strict';

/*
 * Non-n8n inbound-drift pager for the deliverables reconciler.
 *
 * It pages only when two distinct consecutive GitHub schedule runs have
 * non-zero Linear -> SyncView diffs. Re-runs share a github_run_id and therefore
 * cannot satisfy the two-run condition. Messages contain run handles, aggregate
 * counts, team keys, and Linear identifiers only. A successful page latches one
 * incident until a later clean scheduled run records a reset marker.
 */

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const SLACK_WEBHOOK = String(process.env.SLACK_ALERT_WEBHOOK || '');
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.INBOUND_PAGER_DRY_RUN || '');
const SUMMARY_ACTION = 'linear_deliverables_reconcile_v2';
const MARKER_ACTION = 'linear_reconcile_inbound_pager';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function payloadOf(event) {
  const value = event && event.payload;
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return {}; }
}

function inboundCount(event) {
  const payload = payloadOf(event);
  const value = Number(payload && payload.summary && payload.summary.inbound_diff_count || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function decimal(value) {
  const text = clean(value);
  if (!/^[1-9]\d*$/.test(text)) return '';
  return text.replace(/^0+/, '');
}

function compareDecimal(a, b) {
  const left = decimal(a);
  const right = decimal(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  if (left.length !== right.length) return left.length - right.length;
  return left === right ? 0 : (left > right ? 1 : -1);
}

function scheduledRunMeta(event) {
  const payload = payloadOf(event);
  if (clean(payload.github_event_name) !== 'schedule') return null;
  if (clean(payload.run_class) !== 'scheduled-monitor') return null;
  const runId = decimal(payload.github_run_id);
  const runAttempt = decimal(payload.github_run_attempt);
  if (!runId || !runAttempt) return null;
  return { run_id: runId, run_attempt: runAttempt };
}

function monitorSummaries(events) {
  const seen = new Set();
  return (events || [])
    .map(event => ({ event, meta: scheduledRunMeta(event) }))
    .filter(row => row.meta)
    .sort((a, b) => {
      const byRun = compareDecimal(b.meta.run_id, a.meta.run_id);
      if (byRun) return byRun;
      const byAttempt = compareDecimal(b.meta.run_attempt, a.meta.run_attempt);
      if (byAttempt) return byAttempt;
      return compareDecimal(clean(b.event && b.event.id), clean(a.event && a.event.id));
    })
    .filter(row => {
      if (seen.has(row.meta.run_id)) return false;
      seen.add(row.meta.run_id);
      return true;
    })
    .map(row => row.event);
}

function markerState(marker) {
  if (!marker) return 'none';
  const payload = payloadOf(marker);
  const state = clean(payload.incident_state).toLowerCase();
  if (state === 'latched' || state === 'reset') return state;
  return payload.event_pair || Array.isArray(payload.github_run_ids) ? 'latched' : 'none';
}

function maxRunId(values) {
  return (Array.isArray(values) ? values : [])
    .map(decimal)
    .filter(Boolean)
    .reduce((max, value) => compareDecimal(value, max) > 0 ? value : max, '');
}

function runIdOf(event) {
  const meta = scheduledRunMeta(event);
  return meta ? meta.run_id : '';
}

function isAfterRun(event, boundary) {
  return !boundary || compareDecimal(runIdOf(event), boundary) > 0;
}

function pageDecision(events, marker) {
  const summaries = monitorSummaries(events);
  const state = markerState(marker);
  const markerPayload = payloadOf(marker);
  let resetEvent = null;
  let boundary = state === 'reset' ? decimal(markerPayload.reset_by_github_run_id) : '';

  if (state === 'latched') {
    const latchBoundary = maxRunId(markerPayload.github_run_ids);
    resetEvent = summaries.find(event => isAfterRun(event, latchBoundary) && inboundCount(event) === 0) || null;
    if (!resetEvent) {
      return {
        should_page: false,
        should_reset: false,
        reason: 'incident_already_latched',
        events: summaries.slice(0, 2),
      };
    }
    boundary = runIdOf(resetEvent);
  }

  const newerClean = summaries.find(event => isAfterRun(event, boundary) && inboundCount(event) === 0) || null;
  if (newerClean) {
    boundary = runIdOf(newerClean);
    if (state === 'latched') resetEvent = newerClean;
  }

  const latest = summaries.filter(event => isAfterRun(event, boundary)).slice(0, 2);
  if (latest.length < 2) {
    return {
      should_page: false,
      should_reset: Boolean(resetEvent),
      reason: resetEvent ? 'clean_scheduled_run_reset' : 'fewer_than_two_monitor_runs',
      reset_event: resetEvent,
      events: latest,
    };
  }
  if (!latest.every(event => inboundCount(event) > 0)) {
    return { should_page: false, reason: 'consecutive_nonzero_not_met', events: latest };
  }
  const pair = latest.map(runIdOf).sort(compareDecimal).join(':');
  return {
    should_page: true,
    should_reset: false,
    reason: 'two_consecutive_nonzero',
    pair,
    events: latest,
  };
}

function identifierSample(events) {
  const out = [];
  const seen = new Set();
  for (const event of events || []) {
    const sample = payloadOf(event).inbound_identifier_sample;
    for (const item of Array.isArray(sample) ? sample : []) {
      const identifier = clean(item && item.identifier).toUpperCase();
      const team = clean(item && item.team).toLowerCase();
      if (!/^(VID|GRA)-\d+$/.test(identifier) || seen.has(identifier)) continue;
      seen.add(identifier);
      out.push({ identifier, team: ['video', 'graphics'].includes(team) ? team : 'unknown' });
      if (out.length >= 20) return out;
    }
  }
  return out;
}

function slackPayload(decision) {
  const counts = decision.events.map(inboundCount);
  const identifiers = identifierSample(decision.events);
  const idText = identifiers.length ? identifiers.map(row => row.identifier).join(', ') : 'none in safe sample';
  const teamText = Array.from(new Set(identifiers.map(row => row.team).filter(team => team !== 'unknown'))).sort().join(', ') || 'unknown';
  return {
    text: `SyncView inbound drift persisted for two scheduled runs. runs=${decision.pair}; inbound_diffs=${counts.slice().reverse().join(' -> ')}; teams=${teamText}; identifiers=${idText}`,
  };
}

async function restRows(path) {
  if (!SUPA_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const response = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Supabase read HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

function stateMarkerPayload(decision, incidentState) {
  if (incidentState === 'reset') {
    const event = decision.reset_event;
    const meta = scheduledRunMeta(event);
    return {
      incident_state: 'reset',
      reset_by_github_run_id: meta && meta.run_id || null,
      reset_by_github_run_attempt: meta && meta.run_attempt || null,
      reset_summary_event_id: event && event.id || null,
    };
  }
  return {
    incident_state: 'latched',
    incident_id: decision.pair,
    github_run_ids: decision.events.map(event => scheduledRunMeta(event).run_id),
    github_run_attempts: decision.events.map(event => scheduledRunMeta(event).run_attempt),
    summary_event_ids: decision.events.map(event => event.id),
    inbound_diff_counts: decision.events.map(inboundCount),
    identifier_count: identifierSample(decision.events).length,
  };
}

async function insertMarker(decision, incidentState) {
  const response = await fetch(`${SUPA_URL}/rest/v1/deliverable_events`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify([{
      client_slug: '_system',
      action: MARKER_ACTION,
      source: 'system',
      actor: 'github-actions-inbound-pager',
      payload: stateMarkerPayload(decision, incidentState),
    }]),
  });
  if (!response.ok) throw new Error(`Supabase marker HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

async function postSlack(body) {
  if (!SLACK_WEBHOOK) throw new Error('SLACK_ALERT_WEBHOOK is required when paging');
  const response = await fetch(SLACK_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok || clean(text).toLowerCase() !== 'ok') {
    throw new Error(`Slack alert failed with HTTP ${response.status}`);
  }
}

async function main() {
  const [events, markers] = await Promise.all([
    restRows(`deliverable_events?select=id,ts,payload&action=eq.${SUMMARY_ACTION}&order=id.desc&limit=30`),
    restRows(`deliverable_events?select=id,ts,payload&action=eq.${MARKER_ACTION}&order=id.desc&limit=1`),
  ]);
  const decision = pageDecision(events, markers && markers[0]);
  if (decision.should_reset) {
    if (DRY_RUN) {
      console.log(JSON.stringify({
        paged: false,
        dry_run: true,
        incident_state: 'reset',
        reason: decision.reason,
        reset_by_github_run_id: runIdOf(decision.reset_event),
      }));
      return;
    }
    await insertMarker(decision, 'reset');
    console.log(JSON.stringify({
      paged: false,
      incident_state: 'reset',
      reason: decision.reason,
      reset_by_github_run_id: runIdOf(decision.reset_event),
    }));
    return;
  }
  if (!decision.should_page) {
    console.log(JSON.stringify({ paged: false, reason: decision.reason, run_pair: decision.pair || null }));
    return;
  }
  const body = slackPayload(decision);
  if (DRY_RUN) {
    console.log(JSON.stringify({ paged: false, dry_run: true, reason: decision.reason, run_pair: decision.pair, message: body.text }));
    return;
  }
  await postSlack(body);
  await insertMarker(decision, 'latched');
  console.log(JSON.stringify({ paged: true, incident_state: 'latched', reason: decision.reason, run_pair: decision.pair }));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || error && error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  inboundCount,
  identifierSample,
  monitorSummaries,
  pageDecision,
  scheduledRunMeta,
  slackPayload,
  stateMarkerPayload,
};

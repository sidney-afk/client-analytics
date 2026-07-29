'use strict';

/*
 * Non-n8n actionable-drift pager for the deliverables reconciler.
 *
 * It pages only when two distinct consecutive GitHub schedule runs report a
 * non-zero ACTIONABLE count. Re-runs share a github_run_id and therefore cannot
 * satisfy the two-run condition. Messages contain run handles, aggregate counts,
 * team keys, and Linear identifiers only. A successful page latches one incident
 * until a later clean scheduled run records a reset marker.
 *
 * WHY THIS DOES NOT WATCH `inbound_diff_count`
 * It used to, and that made it a dead alarm. PR #920 (2026-07-23) added
 * `compareAttribution`, which flags every row whose stored attribution stamp
 * differs from a freshly computed one -- `mapping_revision` included. Every row
 * written before that comparison existed therefore counts as a diff while still
 * naming the correct client: 4,262 of 4,552 rows, against just 25 genuinely
 * `needs_attribution`. `inbound_diff_count` is a stamp-age counter, not a health
 * signal. Watching it means firing once, latching, and then never firing again --
 * because the reset requires a zero that will not come. See
 * `docs/audits/2026-07-29-b3-zero-gate-investigation.md`.
 *
 * It is still REPORTED in the message as context. It is never a firing condition.
 *
 * INDEPENDENT CLASSES (F132)
 * Each class in ALERT_CLASSES latches separately, keyed by `alert_class` on its
 * marker row. A latched repair incident must not silence a new linkage or
 * outbound one -- "one class can suppress another" is the defect MONITORING.md
 * records against the n8n pager, and summing the classes here would reproduce it.
 */

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const SLACK_WEBHOOK = String(process.env.SLACK_ALERT_WEBHOOK || '');
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.INBOUND_PAGER_DRY_RUN || '');
const SUMMARY_ACTION = 'linear_deliverables_reconcile_v2';
const MARKER_ACTION = 'linear_reconcile_inbound_pager';

// Watched independently, most client-affecting first. `inbound_diff_count` is
// deliberately absent: see the header note.
const ALERT_CLASSES = [
  { key: 'repair_list_size', label: 'repairs' },
  { key: 'linkage_actionable', label: 'linkage' },
  { key: 'outbound_diff_count', label: 'outbound_diffs' },
];

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function payloadOf(event) {
  const value = event && event.payload;
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return {}; }
}

function summaryCount(event, key) {
  const payload = payloadOf(event);
  const value = Number(payload && payload.summary && payload.summary[key] || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// Context only. Never a firing condition -- see the header note.
function inboundCount(event) {
  return summaryCount(event, 'inbound_diff_count');
}

function classCount(event, classKey) {
  return summaryCount(event, classKey);
}

function alertClass(classKey) {
  return ALERT_CLASSES.find(entry => entry.key === classKey) || ALERT_CLASSES[0];
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

function markerState(marker, classKey) {
  if (!marker) return 'none';
  const payload = payloadOf(marker);
  // Defence in depth alongside main()'s per-class marker lookup: a marker
  // belonging to another class -- or to none, i.e. written before alert_class
  // existed -- must never latch this class. Silencing an alarm by handing it the
  // wrong marker is the exact failure this pager was rewritten to stop.
  if (classKey && clean(payload.alert_class) !== clean(classKey)) return 'none';
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

function pageDecision(events, marker, classKey) {
  const entry = alertClass(classKey);
  const countOf = event => classCount(event, entry.key);
  const summaries = monitorSummaries(events);
  const state = markerState(marker, entry.key);
  const markerPayload = payloadOf(marker);
  let resetEvent = null;
  let boundary = state === 'reset' ? decimal(markerPayload.reset_by_github_run_id) : '';

  if (state === 'latched') {
    const latchBoundary = maxRunId(markerPayload.github_run_ids);
    resetEvent = summaries.find(event => isAfterRun(event, latchBoundary) && countOf(event) === 0) || null;
    if (!resetEvent) {
      return {
        alert_class: entry.key,
        should_page: false,
        should_reset: false,
        reason: 'incident_already_latched',
        events: summaries.slice(0, 2),
      };
    }
    boundary = runIdOf(resetEvent);
  }

  const newerClean = summaries.find(event => isAfterRun(event, boundary) && countOf(event) === 0) || null;
  if (newerClean) {
    boundary = runIdOf(newerClean);
    if (state === 'latched') resetEvent = newerClean;
  }

  const latest = summaries.filter(event => isAfterRun(event, boundary)).slice(0, 2);
  if (latest.length < 2) {
    return {
      alert_class: entry.key,
      should_page: false,
      should_reset: Boolean(resetEvent),
      reason: resetEvent ? 'clean_scheduled_run_reset' : 'fewer_than_two_monitor_runs',
      reset_event: resetEvent,
      events: latest,
    };
  }
  if (!latest.every(event => countOf(event) > 0)) {
    return { alert_class: entry.key, should_page: false, reason: 'consecutive_nonzero_not_met', events: latest };
  }
  const pair = latest.map(runIdOf).sort(compareDecimal).join(':');
  return {
    alert_class: entry.key,
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
  const entry = alertClass(decision && decision.alert_class);
  const counts = decision.events.map(event => classCount(event, entry.key));
  // Reported for context so a reader can see the stamp counter without it ever
  // having been the reason this fired.
  const context = decision.events.map(inboundCount);
  const identifiers = identifierSample(decision.events);
  const idText = identifiers.length ? identifiers.map(row => row.identifier).join(', ') : 'none in safe sample';
  const teamText = Array.from(new Set(identifiers.map(row => row.team).filter(team => team !== 'unknown'))).sort().join(', ') || 'unknown';
  return {
    text: `SyncView ${entry.label} drift persisted for two scheduled runs. class=${entry.key}; runs=${decision.pair}; ${entry.key}=${counts.slice().reverse().join(' -> ')}; inbound_diff_context=${context.slice().reverse().join(' -> ')}; teams=${teamText}; identifiers=${idText}`,
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
  const entry = alertClass(decision && decision.alert_class);
  if (incidentState === 'reset') {
    const event = decision.reset_event;
    const meta = scheduledRunMeta(event);
    return {
      alert_class: entry.key,
      incident_state: 'reset',
      reset_by_github_run_id: meta && meta.run_id || null,
      reset_by_github_run_attempt: meta && meta.run_attempt || null,
      reset_summary_event_id: event && event.id || null,
    };
  }
  return {
    alert_class: entry.key,
    incident_state: 'latched',
    incident_id: decision.pair,
    github_run_ids: decision.events.map(event => scheduledRunMeta(event).run_id),
    github_run_attempts: decision.events.map(event => scheduledRunMeta(event).run_attempt),
    summary_event_ids: decision.events.map(event => event.id),
    alert_class_counts: decision.events.map(event => classCount(event, entry.key)),
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
    // One marker row per class, so read enough rows to find the newest of each
    // rather than assuming the single newest row belongs to the class at hand.
    restRows(`deliverable_events?select=id,ts,payload&action=eq.${MARKER_ACTION}&order=id.desc&limit=${ALERT_CLASSES.length * 10}`),
  ]);

  const markerRows = Array.isArray(markers) ? markers : [];
  const results = [];
  let failure = null;

  for (const entry of ALERT_CLASSES) {
    // A marker written before alert_class existed carries no class and is not
    // claimed by any class, so a legacy row can never silence a new incident.
    const marker = markerRows.find(row => clean(payloadOf(row).alert_class) === entry.key) || null;
    const decision = pageDecision(events, marker, entry.key);

    if (decision.should_reset) {
      if (!DRY_RUN) await insertMarker(decision, 'reset');
      results.push({
        alert_class: entry.key,
        paged: false,
        dry_run: DRY_RUN || undefined,
        incident_state: 'reset',
        reason: decision.reason,
        reset_by_github_run_id: runIdOf(decision.reset_event),
      });
      continue;
    }

    if (!decision.should_page) {
      results.push({
        alert_class: entry.key,
        paged: false,
        reason: decision.reason,
        run_pair: decision.pair || null,
      });
      continue;
    }

    const body = slackPayload(decision);
    if (DRY_RUN) {
      results.push({
        alert_class: entry.key,
        paged: false,
        dry_run: true,
        reason: decision.reason,
        run_pair: decision.pair,
        message: body.text,
      });
      continue;
    }

    // One class failing to deliver must not stop the remaining classes from
    // being evaluated and paged; the first error is rethrown after the loop so
    // the GitHub run still fails loudly.
    try {
      await postSlack(body);
      await insertMarker(decision, 'latched');
      results.push({
        alert_class: entry.key,
        paged: true,
        incident_state: 'latched',
        reason: decision.reason,
        run_pair: decision.pair,
      });
    } catch (error) {
      failure = failure || error;
      results.push({
        alert_class: entry.key,
        paged: false,
        reason: 'page_failed',
        run_pair: decision.pair,
      });
    }
  }

  console.log(JSON.stringify({ classes: results }));
  if (failure) throw failure;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || error && error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  ALERT_CLASSES,
  classCount,
  inboundCount,
  identifierSample,
  monitorSummaries,
  pageDecision,
  scheduledRunMeta,
  slackPayload,
  stateMarkerPayload,
};

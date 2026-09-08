'use strict';

/*
 * WATCHER — the mirror queue must be empty, and STAY empty, and an unreadable
 * census must scream.
 *
 * THE FAILURE THIS CLOSES.
 *
 * Setting `linear_outbound_enabled` to `{"mode":"off"}` stops the worker
 * READING the queue. It does not stop anything ENQUEUING into it.
 * `production_comment_write` durably enqueues comments into this same lane, so
 * from the minute the flag flips, every mirror intent becomes a row that will
 * never be delivered and never fail.
 *
 * That is the worst shape a bug can have here: it is permanent, it is silent,
 * and it is invisible to every existing alarm — because the outbound's own
 * `failed_write` alert fires on rows reaching `failed`, and these rows never
 * reach `failed`. They sit at `pending` forever. Nothing counts them. Nothing
 * ages them. A client comment that never appeared and a status change that
 * never landed both look, from every dashboard in this repository, exactly like
 * a quiet afternoon.
 *
 * WHAT IT COUNTS. Non-terminal rows for REAL clients only
 * (`legacy_parity = false and test_only = false`), in the three statuses the
 * worker treats as work: `pending`, `failed`, `shadow_ok`. Plus the age of the
 * oldest one, which is the signal that separates "the drain is mid-flight" from
 * "these are never moving again".
 *
 * WHAT IT DELIBERATELY DOES NOT COUNT.
 *   - `skipped` is TERMINAL and is not debt. Structurally-unsendable duplicate
 *     rows land there on purpose; linear-outbound/index.ts:1415-1436 explains
 *     that failing them instead buys an identical outcome plus eight pointless
 *     API calls and a permanent false alarm. Counting them here would rebuild
 *     that false alarm one layer up.
 *   - `stale` is also TERMINAL. `mirror_outbox_status_b4_check`
 *     (migrations/2026-07-11-b4-linear-outbound.sql:112) allows
 *     pending / shadow_ok / written / failed / skipped / stale, and the worker's
 *     `normalStatuses` (index.ts:1050) only ever re-reads the first, second and
 *     fourth. A `stale` row has been dispositioned and dropped on purpose; it is
 *     not waiting for anything.
 *   - `legacy_parity = true` rows. That lane is dead across the stack
 *     (OPEN_REPAIRS 75) and is turned off in its own runbook step; folding it in
 *     would make the real-client number unreadable.
 *   - The `linear_outbound_cutoff_debt_v1` view. It is not installed (the cutoff
 *     ships as flags, not a migration), and even where it is installed its
 *     SECOND branch is `when not c.cutoff_enabled then 'cutoff_inactive'`,
 *     evaluated before every other non-terminal branch — so while
 *     `cutoff_enabled` is false EVERY non-terminal row reports `cutoff_inactive`
 *     and none of the four debt dispositions is ever produced. The raw status
 *     count is the honest census in every scenario.
 *
 * HOW IT ALARMS. It does not page. It exits non-zero and its workflow records a
 * heartbeat under `if: always()`; the dead-man's switch pages, latches and
 * dedups. See scripts/workload-source-freshness.js for why every watcher in this
 * repository that grew its own alarm grew the same defect.
 *
 * DOES IT SURVIVE A TOTAL n8n OUTAGE? The page does not — `SLACK_ALERT_WEBHOOK`
 * points at the n8n relay, so no page in this estate does. The red run does: a
 * non-zero exit leaves the GitHub run failed and GitHub emails the owner, which
 * touches no n8n.
 *
 * AN UNREADABLE CENSUS IS NEVER ZERO DEBT. Every count that cannot be
 * established is `null`, and a null anywhere produces `unreadable` and a
 * non-zero exit. This is the single most important property in the file: the
 * failure mode of a debt counter that guesses low is a queue nobody looks at.
 *
 * PUBLIC SAFETY. Statuses, counts and ages. Never a client slug, a dedup key,
 * an identifier or a payload.
 */

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

const NON_TERMINAL_STATUSES = Object.freeze(['pending', 'failed', 'shadow_ok']);

/*
 * 60 minutes. The drain workflow is scheduled every 10 minutes and the
 * outbound's own pending-age alarm fires at 30
 * (linear-outbound/monitoring.mjs:17). Sitting at 60 keeps this census a
 * DISTINCT signal rather than a duplicate of that alarm: a row still here an
 * hour after it was written is not mid-flight, it is stuck — and after the
 * cutoff it is permanent.
 */
const MAX_AGE_MINUTES = Number(process.env.OUTBOX_DEBT_MAX_AGE_MINUTES || 60);

const VERDICTS = Object.freeze({
  CLEAR: 'clear',
  DRAINING: 'draining',
  DEBT: 'debt',
  UNREADABLE: 'unreadable',
});

function ageMinutes(iso, nowMs) {
  const ms = Date.parse(String(iso == null ? '' : iso).trim());
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((nowMs - ms) / 60000));
}

/**
 * Pure decision.
 *
 * `counts` maps each non-terminal status to a number, or to null where the
 * count could not be established. `oldestAt` is the oldest `created_at` among
 * them, or null.
 */
function assessDebt({ counts, oldestAt, nowMs, maxAgeMinutes = MAX_AGE_MINUTES }) {
  const observed = {};
  let unreadable = false;
  let total = 0;
  for (const status of NON_TERMINAL_STATUSES) {
    const value = counts ? counts[status] : undefined;
    if (!Number.isFinite(value)) { observed[status] = null; unreadable = true; continue; }
    observed[status] = value;
    total += value;
  }

  const base = { counts: observed, max_age_minutes: maxAgeMinutes, oldest_age_minutes: null };

  // Checked FIRST, before the zero-total shortcut. A census with a hole in it
  // can total zero across the statuses it did manage to read, and reporting
  // that as `clear` is exactly the lie this watcher exists to prevent.
  if (unreadable) {
    return { ...base, total: null, verdict: VERDICTS.UNREADABLE, ok: false,
      detail: 'at least one status count could not be established' };
  }

  if (total === 0) {
    return { ...base, total: 0, verdict: VERDICTS.CLEAR, ok: true, detail: null };
  }

  const age = ageMinutes(oldestAt, nowMs);
  if (age === null) {
    // Rows exist but their age is unknown, so "is this mid-flight or stuck?"
    // cannot be answered. Unknown is not healthy.
    return { ...base, total, verdict: VERDICTS.UNREADABLE, ok: false,
      detail: 'non-terminal rows exist but the oldest created_at is unreadable' };
  }
  if (age > maxAgeMinutes) {
    return { ...base, total, oldest_age_minutes: age, verdict: VERDICTS.DEBT, ok: false,
      detail: 'undeliverable rows are accumulating and will never fail — nothing else reports these' };
  }
  return { ...base, total, oldest_age_minutes: age, verdict: VERDICTS.DRAINING, ok: true,
    detail: 'non-terminal rows present but inside the drain window' };
}

const REAL_CLIENT_FILTER = 'legacy_parity=eq.false&test_only=eq.false';

async function restCount(status) {
  if (!SUPA_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const response = await fetch(
    `${SUPA_URL}/rest/v1/mirror_outbox?select=id&${REAL_CLIENT_FILTER}&status=eq.${encodeURIComponent(status)}`,
    {
      method: 'HEAD',
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        Accept: 'application/json',
        Prefer: 'count=exact',
      },
    },
  );
  if (!response.ok) throw new Error(`Supabase count HTTP ${response.status} for status=${status}`);
  const match = /\/(\d+)\s*$/.exec(String(response.headers.get('content-range') || ''));
  // A malformed header reads as UNKNOWN, never as zero.
  return match ? Number(match[1]) : null;
}

async function restOldest() {
  const response = await fetch(
    `${SUPA_URL}/rest/v1/mirror_outbox?select=created_at&${REAL_CLIENT_FILTER}`
    + `&status=in.(${NON_TERMINAL_STATUSES.join(',')})&order=created_at.asc&limit=1`,
    {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
    },
  );
  if (!response.ok) throw new Error(`Supabase read HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? row.created_at : null;
}

async function readCensus() {
  const [counts, oldestAt] = await Promise.all([
    Promise.all(NON_TERMINAL_STATUSES.map(status => restCount(status)))
      .then(values => Object.fromEntries(NON_TERMINAL_STATUSES.map((status, i) => [status, values[i]]))),
    restOldest(),
  ]);
  return { counts, oldestAt };
}

async function main() {
  let assessment;
  try {
    const census = await readCensus();
    assessment = assessDebt({ ...census, nowMs: Date.now() });
  } catch (error) {
    assessment = {
      counts: Object.fromEntries(NON_TERMINAL_STATUSES.map(status => [status, null])),
      max_age_minutes: MAX_AGE_MINUTES,
      oldest_age_minutes: null,
      total: null,
      verdict: VERDICTS.UNREADABLE,
      ok: false,
      detail: 'census read failed',
    };
    console.log(JSON.stringify(assessment));
    throw error;
  }

  console.log(JSON.stringify(assessment));
  if (!assessment.ok) {
    throw new Error(`mirror outbox ${assessment.verdict}: ${assessment.detail} `
      + `(total=${assessment.total}, oldest=${assessment.oldest_age_minutes}m, max=${assessment.max_age_minutes}m)`);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || error && error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  MAX_AGE_MINUTES,
  NON_TERMINAL_STATUSES,
  VERDICTS,
  ageMinutes,
  assessDebt,
};

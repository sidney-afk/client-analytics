'use strict';

/*
 * WATCHER — the Workload board's source must be provably fresh.
 *
 * THE FAILURE THIS CLOSES, and it is the quietest one in the estate.
 *
 * `public.workload_issues` does NOT empty when Linear dies. The n8n reconcile
 * returns `[]` on a bad read and its own safety gate keeps the old rows, so the
 * board FREEZES: about 2,000 rows stay `active=true` with a `synced_at` that
 * stops advancing. Every card is still there. Every name is still right. The
 * board is a photograph of the day Linear died and it will keep looking correct
 * indefinitely.
 *
 * The browser cannot catch it. `_wlV2CheckWatermark` (index.html:14485-14505)
 * refreshes only when the watermark moves FORWARD (`:14501`); on an unchanged
 * value it does nothing, and on no watermark at all it CLEARS the background
 * refresh failure banner and returns (`:14491-14494`). Frozen is
 * indistinguishable from healthy, client-side, by construction.
 *
 * And the other half: if the mirror ever does return zero active rows, or the
 * read fails, the board does not go blank either — index.html:14553 and :14555
 * fall through to `LINEAR_ISSUES_WEBHOOK`, the n8n endpoint that reads Linear.
 * Post-cutoff that is a dead endpoint. So both outcomes are silent: a frozen
 * board, or a board reaching for a corpse.
 *
 * This watcher is the only thing that says so.
 *
 * HOW IT ALARMS, and why it does not page by itself.
 * It does not call the alert relay. It exits non-zero and its workflow records
 * a heartbeat under `if: always()`. The dead-man's switch then does the paging,
 * with the latching, the (kind,lane) separation and the dedup already built and
 * already proven. Every watcher that grew its own alarm in this repository grew
 * the same defect: docs/ops/MONITORING.md records both nightlies red for WEEKS
 * (samples 26 nights, calendar 16) because their only alarm was a Slack webhook
 * step that degrades to a log warning when its secret is unset, and it was.
 *
 * DOES IT SURVIVE A TOTAL n8n OUTAGE? The Slack page does not — `SLACK_ALERT_WEBHOOK`
 * points at the n8n relay `Tfhc3vebZyG6obOg`, so no page in this estate survives
 * n8n being down. The RED RUN does: this script's non-zero exit leaves the GitHub
 * run failed and GitHub emails the owner directly, which touches no n8n. That is
 * the whole reason the exit code is load-bearing here and not cosmetic.
 *
 * AN UNREADABLE CENSUS IS A FAILURE, NEVER "FRESH". A read error exits non-zero
 * with `unreadable`. A watcher that reports health when it could not look is the
 * exact thing this estate has been bitten by twice.
 *
 * PUBLIC SAFETY. Counts, ages and a table name. Never a client slug, an
 * identifier, an assignee, or a row body.
 */

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

/*
 * THE SOURCE IS A VARIABLE, BUT THE HANDOVER IS A RETIREMENT, NOT A REPOINT.
 *
 * Today the Workload board reads `workload_issues`, the Linear-derived MIRROR,
 * and its freshness is the thing that matters: a mirror can silently stop being
 * refreshed while still looking full.
 *
 * When lane A repoints the board at the native source, do NOT point this
 * watcher there. `migrations/2026-09-02-workload-native-view.sql` returns
 * `null::timestamptz as synced_at` in both arms (`:177`, `:294`) and says why
 * at `:147` — "`synced_at` IS NULL. Native IS the source; there is no sync to
 * stamp." Repointing would fail `no_timestamp` on every run, forever.
 *
 * That null is correct, not an oversight: FRESHNESS IS THE WRONG QUESTION for a
 * native source. It cannot go stale the way a mirror can, because it IS the
 * data. So at handover this lane is RETIRED — `retired: {at, reason}` in
 * scripts/monitoring-watchdog.js plus unscheduling its workflow, in one commit,
 * with test/monitoring-watchdog.js enforcing the pairing in both directions.
 *
 * The variables below stay configurable only so a DIFFERENT mirror, if one is
 * ever introduced, can be watched without a code change.
 */
const SOURCE_TABLE = String(process.env.WORKLOAD_SOURCE_TABLE || 'workload_issues').trim();
const SOURCE_TIMESTAMP_COLUMN = String(process.env.WORKLOAD_SOURCE_TIMESTAMP_COLUMN || 'synced_at').trim();
/*
 * 180 minutes. The n8n reconcile is scheduled every 10 minutes, so a healthy
 * lane is never more than minutes stale; three hours absorbs a long n8n
 * incident, a schedule slip and a retry without crying wolf, and still catches
 * a freeze on the same working day it starts.
 */
const MAX_AGE_MINUTES = Number(process.env.WORKLOAD_SOURCE_MAX_AGE_MINUTES || 180);

const VERDICTS = Object.freeze({
  HEALTHY: 'healthy',
  FROZEN: 'frozen',
  EMPTY: 'empty',
  NO_TIMESTAMP: 'no_timestamp',
  UNREADABLE: 'unreadable',
});

function ageMinutes(iso, nowMs) {
  const ms = Date.parse(String(iso == null ? '' : iso).trim());
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((nowMs - ms) / 60000));
}

/**
 * Pure decision. Takes what was read, returns the verdict — so every branch,
 * including the ones that only happen on a bad day, is exercised offline with
 * no database.
 *
 * `activeRows` null means the count could not be established. `newestAt` null
 * means no timestamp came back. Neither is ever read as healthy.
 */
function assessSource({ activeRows, newestAt, nowMs, maxAgeMinutes = MAX_AGE_MINUTES, source = SOURCE_TABLE }) {
  const base = { source, max_age_minutes: maxAgeMinutes, active_rows: activeRows, age_minutes: null };

  if (!Number.isFinite(activeRows)) {
    return { ...base, verdict: VERDICTS.UNREADABLE, ok: false,
      detail: 'active row count could not be established' };
  }
  if (activeRows === 0) {
    /*
     * NOT "the board is empty, which is at least visible". index.html:14553
     * treats zero active rows as a reason to fall back to the linear-issues
     * webhook, so after the cutoff zero rows means the board reaches for a dead
     * endpoint. Zero is an incident, not a quiet state.
     */
    return { ...base, verdict: VERDICTS.EMPTY, ok: false,
      detail: 'zero active rows — the browser falls back to the linear-issues webhook' };
  }

  const age = ageMinutes(newestAt, nowMs);
  if (age === null) {
    return { ...base, verdict: VERDICTS.NO_TIMESTAMP, ok: false,
      detail: 'rows are active but none carries a parseable timestamp' };
  }
  if (age > maxAgeMinutes) {
    return { ...base, age_minutes: age, verdict: VERDICTS.FROZEN, ok: false,
      detail: 'the source has stopped advancing — the board is a snapshot' };
  }
  return { ...base, age_minutes: age, verdict: VERDICTS.HEALTHY, ok: true, detail: null };
}

async function restRows(path, { head = false } = {}) {
  if (!SUPA_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const headers = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' };
  if (head) headers.Prefer = 'count=exact';
  const response = await fetch(`${SUPA_URL}/rest/v1/${path}`, { method: head ? 'HEAD' : 'GET', headers });
  if (!response.ok) {
    throw new Error(`Supabase read HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  if (head) return response.headers.get('content-range');
  return response.json();
}

/**
 * The exact-count header PostgREST returns for a HEAD with `count=exact` looks
 * like `0-0/2014` or `*​/0`. Anything else is unparseable and must read as
 * "unknown", never as zero — reading a malformed header as zero would turn an
 * API change into a permanent false EMPTY.
 */
function parseExactCount(contentRange) {
  const match = /\/(\d+)\s*$/.exec(String(contentRange || ''));
  return match ? Number(match[1]) : null;
}

async function readSource() {
  const [countHeader, newestRows] = await Promise.all([
    restRows(`${encodeURIComponent(SOURCE_TABLE)}?select=id&active=eq.true`, { head: true }),
    restRows(`${encodeURIComponent(SOURCE_TABLE)}?select=${encodeURIComponent(SOURCE_TIMESTAMP_COLUMN)}`
      + `&active=eq.true&order=${encodeURIComponent(SOURCE_TIMESTAMP_COLUMN)}.desc.nullslast&limit=1`),
  ]);
  const row = Array.isArray(newestRows) ? newestRows[0] : null;
  return {
    activeRows: parseExactCount(countHeader),
    newestAt: row ? row[SOURCE_TIMESTAMP_COLUMN] : null,
  };
}

async function main() {
  let assessment;
  try {
    const read = await readSource();
    assessment = assessSource({ ...read, nowMs: Date.now() });
  } catch (error) {
    /*
     * The read itself failed. Report it as a verdict rather than as a stack
     * trace so the JSON shape is the same on every run — but still exit
     * non-zero, because a census that could not be taken is a failure.
     */
    assessment = {
      source: SOURCE_TABLE,
      max_age_minutes: MAX_AGE_MINUTES,
      active_rows: null,
      age_minutes: null,
      verdict: VERDICTS.UNREADABLE,
      ok: false,
      detail: 'source read failed',
    };
    console.log(JSON.stringify(assessment));
    throw error;
  }

  console.log(JSON.stringify(assessment));
  if (!assessment.ok) {
    throw new Error(`workload source ${assessment.verdict}: ${assessment.detail} `
      + `(rows=${assessment.active_rows}, age=${assessment.age_minutes}m, max=${assessment.max_age_minutes}m)`);
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
  SOURCE_TABLE,
  VERDICTS,
  ageMinutes,
  assessSource,
  parseExactCount,
};

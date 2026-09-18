'use strict';
/*
 * One-off catch-up for calendar posts whose component status lags the linked
 * production card.
 *
 * DRY-RUN IS THE DEFAULT. `--apply` is the only thing that writes.
 *
 * RUN IT FROM ANY DIRECTORY. The path below is absolute, so there is no `cd` to
 * work out and no working directory to infer — a fresh PowerShell window at the
 * default prompt is exactly right. Windows PowerShell, as written:
 *
 *   $env:SUPABASE_URL = "https://<project-ref>.supabase.co"
 *   node "$env:USERPROFILE\client-analytics\scripts\native-calendar-status-backfill.js"
 *   node "$env:USERPROFILE\client-analytics\scripts\native-calendar-status-backfill.js" --apply
 *   node "$env:USERPROFILE\client-analytics\scripts\native-calendar-status-backfill.js" --since=2026-09-18T00:00:00Z
 *
 * `$env:USERPROFILE` is expanded by the shell before node sees it, so this is
 * an absolute path, not a relative one dressed up — the same form the F27
 * capture script is handed over with, and for the same reason. On a POSIX
 * checkout, pass the absolute path to this same file instead.
 *
 * The script itself reads nothing relative to the current directory. Verified
 * as written from an unrelated directory: with no key it refuses on the key,
 * and with one it reaches the RPC — never on "cannot find module".
 *
 * WHY THIS EXISTS SEPARATELY FROM THE TRIGGER.
 *
 * migrations/2026-09-18-native-calendar-status-bridge.sql installs the
 * projection going forward, but a trigger only ever sees changes made after it
 * exists. The cards that already lagged when it landed -- ten posts across
 * seven clients at 20:44Z on 2026-09-18, the oldest since 17:34Z -- are not
 * touched by it, and nothing else will move them: the reconciler that used to
 * converge them pulled from Linear, and native receipts send nothing there.
 *
 * WHY THE WORK IS IN SQL AND NOT HERE.
 *
 * Both modes call ONE routine, `production_native_calendar_status_backfill`,
 * installed by the same migration as the trigger. The dry run and the apply are
 * the same code path with one boolean flipped, so the report cannot describe a
 * set the apply would not touch, and the predicate cannot drift from the
 * trigger's. This file is transport and presentation.
 *
 * WHY RE-RUNNING IS SAFE, AND WHY THAT MATTERS MORE THAN IT LOOKS.
 *
 * `calendar_posts.video_status_at` is the urgent editor ping's deduplication
 * key: `production_notification_enqueue_urgent` builds
 * `intent_key = 'urgent:' || sha256(deliverable_id || '|' || video_status_at)`.
 * A write that re-stamps that column without a real card-visible change opens a
 * fresh pingable round for a tweak that was already pinged. The routine
 * therefore only ever writes a component whose mapped value actually differs
 * from what the card holds, so a second run lists nothing and writes nothing,
 * and a card an SMM has already corrected by hand is skipped rather than
 * re-stamped.
 *
 * REQUIRED ENV
 *   SUPABASE_SERVICE_ROLE_KEY   the routine is service-role only, by design
 *   SUPABASE_URL                the project REST origin, e.g.
 *                               https://<project-ref>.supabase.co
 *
 * THERE IS NO DEFAULT PROJECT, DELIBERATELY. This file carried the live
 * project's REST origin as a fallback until 2026-09-18. The repository is
 * public, so that published an identifier for the production database to
 * anybody reading it -- and separately it made the dangerous direction the
 * silent one: a run with the variable unset, or misspelled, would quietly point
 * a `--apply` at production instead of refusing. Requiring it costs one
 * exported variable and removes both.
 *
 * `scripts/linear-label-catalog-export.cli.js` has the same fallback at line
 * 384 (this repair is not extended to it here -- that script has its own
 * callers and its own test lane, and widening this change would put an
 * unrelated tool in a regression PR). Recorded in OPEN_REPAIRS.
 *
 * PUBLIC-SAFETY. The repository is public and so is any CI log this prints
 * into. Output is by card id, deliverable id and component, plus counts. It
 * never prints a client slug, a client display name, a staff name or a token;
 * clients are reported only as a distinct count.
 */

const SUPA_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const APPLY = process.argv.includes('--apply');
const DEFAULT_SINCE = '2026-09-18T00:00:00Z';
const sinceArg = process.argv.find(a => a.startsWith('--since='));
const SINCE = sinceArg ? sinceArg.slice('--since='.length) : DEFAULT_SINCE;

function fail(message) {
  console.error('ERROR: ' + message);
  process.exit(1);
}

if (!SUPA_URL) {
  fail('SUPABASE_URL is required — this script has no default project, so that an unset variable refuses rather than guessing production.');
}
if (!/^https:\/\/[^/]+$/.test(SUPA_URL)) {
  fail('SUPABASE_URL must be an https origin with no path, e.g. https://<project-ref>.supabase.co');
}
if (!SERVICE_KEY) {
  fail('SUPABASE_SERVICE_ROLE_KEY is required — production_native_calendar_status_backfill is service-role only.');
}
if (!isFinite(Date.parse(SINCE))) {
  fail(`--since must be an ISO timestamp; got ${JSON.stringify(SINCE)}`);
}

/* Reported without identities: a count of distinct clients, never their slugs. */
function summarise(rows) {
  const clients = new Set(rows.map(r => r.client));
  const byComponent = rows.reduce((acc, r) => {
    acc[r.component] = (acc[r.component] || 0) + 1;
    return acc;
  }, {});
  const oldest = rows
    .map(r => r.deliverable_status_at)
    .filter(Boolean)
    .sort()[0] || null;
  return {
    lagging_components: rows.length,
    video: byComponent.video || 0,
    graphic: byComponent.graphic || 0,
    distinct_clients: clients.size,
    oldest_lag_since: oldest,
  };
}

(async () => {
  console.log(`MODE: ${APPLY ? 'APPLY' : 'DRY-RUN'}  since=${SINCE}`);

  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/production_native_calendar_status_backfill`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ p_since: new Date(SINCE).toISOString(), p_apply: APPLY }),
  });

  const text = await res.text();
  if (!res.ok) {
    // The body can echo the request; print the status and the routine's own
    // error code rather than the whole response.
    const code = (text.match(/native_calendar_backfill_[a-z_]+/) || [])[0] || 'see the database log';
    fail(`RPC refused with HTTP ${res.status} (${code})`);
  }

  let rows;
  try { rows = JSON.parse(text); } catch { return fail('RPC returned a non-JSON body'); }
  if (!Array.isArray(rows)) return fail('RPC returned an unexpected shape');

  const summary = summarise(rows);
  console.log(JSON.stringify(summary, null, 2));
  for (const r of rows) {
    console.log(`  ${APPLY ? 'applied' : 'would apply'} ${r.post_id} ${r.component}`
      + ` "${r.card_status}" -> "${r.target_status}"`
      + `  deliverable ${r.deliverable_id} since ${r.deliverable_status_at}`);
  }

  if (!APPLY) {
    console.log('\n(dry-run — nothing written. Re-run with --apply to project these.)');
  } else {
    console.log(`\napplied ${rows.length} component projection(s);`
      + ' each wrote one calendar_post_events row with source "native-bridge".');
  }
})().catch(e => fail(e && e.message ? e.message : String(e)));

'use strict';
/*
 * Repair for Calendar cards whose OVERALL status disagrees with their three
 * component statuses (the status bridge used to move a component and leave the
 * overall behind).
 *
 * DRY-RUN IS THE DEFAULT. `--apply` is the only thing that writes.
 *
 * RUN IT FROM ANY DIRECTORY. The path is absolute, so there is no `cd` to work
 * out. Windows PowerShell, as written:
 *
 *   $env:SUPABASE_URL = "https://<project-ref>.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
 *   node "$env:USERPROFILE\client-analytics\scripts\native-calendar-overall-repair.js"
 *   node "$env:USERPROFILE\client-analytics\scripts\native-calendar-overall-repair.js" --apply
 *
 * ORDER: migrations/2026-10-01-calendar-overall-status-bridge.sql must already
 * be applied; the routine this calls is installed by it. Before that, the call
 * is refused and nothing is written.
 *
 * Both modes call ONE routine, `production_native_calendar_overall_status_repair`,
 * with one boolean flipped, so the report cannot describe a set the apply would
 * not touch. With --apply each card is locked, its overall is recomputed from
 * its CURRENT components and written only if it still differs, so a card saved
 * from the Calendar meanwhile is left alone and a second run lists nothing. It
 * writes no component column and no stamp, so no urgent tweak round re-opens.
 *
 * REQUIRED ENV (no default project, deliberately, so an unset variable refuses
 * instead of guessing production):
 *   SUPABASE_URL                https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   the routine is service-role only
 *
 * PUBLIC-SAFETY. Output is by card id and status text plus counts. It never
 * prints a client slug, a client display name, a staff name or a token.
 */

const SUPA_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const APPLY = process.argv.includes('--apply');

function fail(message) {
  console.error('ERROR: ' + message);
  process.exit(1);
}

if (!SUPA_URL) fail('SUPABASE_URL is required; this script has no default project, so that an unset variable refuses rather than guessing production.');
if (!/^https:\/\/[^/]+$/.test(SUPA_URL)) fail('SUPABASE_URL must be an https origin with no path, e.g. https://<project-ref>.supabase.co');
if (!SERVICE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required; production_native_calendar_overall_status_repair is service-role only.');

function summarise(rows) {
  const transitions = {};
  for (const r of rows) {
    const key = `${r.from_status === null || r.from_status === '' ? '(empty)' : r.from_status} -> ${r.to_status}`;
    transitions[key] = (transitions[key] || 0) + 1;
  }
  return {
    cards: rows.length,
    distinct_clients: new Set(rows.map(r => r.client)).size,
    transitions,
  };
}

(async () => {
  console.log(`MODE: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/production_native_calendar_overall_status_repair`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ p_apply: APPLY }),
  });
  const text = await res.text();
  if (!res.ok) fail(`RPC refused with HTTP ${res.status}; has the 2026-10-01 calendar overall status migration been applied?`);
  let rows;
  try { rows = JSON.parse(text); } catch { return fail('RPC returned a non-JSON body'); }
  if (!Array.isArray(rows)) return fail('RPC returned an unexpected shape');

  console.log(JSON.stringify(summarise(rows), null, 2));
  for (const r of rows) {
    console.log(`  ${APPLY ? (r.applied ? 'fixed' : 'skipped') : 'would fix'} ${r.post_id}`
      + ` "${r.from_status === null ? '' : r.from_status}" -> "${r.to_status}"`);
  }
  if (!APPLY) console.log('\n(dry-run: nothing written. Re-run with --apply to fix these.)');
  else console.log(`\nfixed ${rows.filter(r => r.applied).length} card(s); each wrote one calendar_post_events row (action overall_status_change, source native-bridge).`);
})().catch(e => fail(e && e.message ? e.message : String(e)));

'use strict';
/*
 * rename-propagation-drain.js — runs public.rename_propagation_drain once.
 *
 * The drain applies recorded card <-> sub-issue renames to the other side
 * (migrations/2026-09-23-rename-propagation.sql). The browser also pokes it
 * after every rename; this scheduled run is the backstop for retries,
 * deferred rows and renames made where no browser is open.
 *
 * Prints state counts only -- never a name, title or id.
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!url || !key) {
  console.error('rename-propagation-drain: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

(async () => {
  let total = {};
  // Up to five passes of 200 so a backlog clears in one run without one
  // statement holding row locks for long.
  for (let pass = 0; pass < 5; pass++) {
    const res = await fetch(url + '/rest/v1/rpc/rename_propagation_drain', {
      method: 'POST',
      headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ p_limit: 200 }),
    });
    if (!res.ok) {
      console.error('rename-propagation-drain: HTTP ' + res.status);
      process.exit(1);
    }
    const counts = await res.json();
    const processed = Object.values(counts || {}).reduce((a, b) => a + Number(b || 0), 0);
    for (const [state, n] of Object.entries(counts || {})) total[state] = (total[state] || 0) + Number(n || 0);
    if (processed < 200) break;
  }
  console.log('rename-propagation-drain: ' + JSON.stringify(total));
  if (total.failed) console.log('::warning::' + total.failed + ' rename(s) gave up after retries; see the WR-101 logbook');
})().catch((e) => {
  console.error('rename-propagation-drain: ' + (e && e.message ? e.message : 'failed'));
  process.exit(1);
});

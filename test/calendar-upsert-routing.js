'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const RECON = fs.readFileSync(path.join(ROOT, 'scripts/linear-sync-reconcile.js'), 'utf8');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL calendar-upsert-routing:', msg);
    process.exit(1);
  }
}

/* The count is the point: every calendar write must go through this ONE
   routing helper, so a new call site has to be a deliberate edit here rather
   than something that slips in. The ninth is _calFillWriteCardLink, which
   writes ONLY the two link columns of the component a card just gained --
   partial by key presence, so a fill cannot disturb the scheduled date,
   caption or the other component on a card that already carries real work.
   2026-09-20 (LINEAR_EXIT_STEP26_NATIVE_WORKLOAD.md): one call site dropped
   out of 10 -- _writeLinearVideoCardsToCalendar's own per-card write loop was
   retired outright in favor of an all-or-nothing hold, so it no longer calls
   _calUpsertFetch at all. 2026-09-22 (EXECUTION_LOG.md, "Kasper video tweak
   comments were self-conflicting out of the Calendar row"): back to 10 -- a
   NEW call site inside _kasperPersistPostWrite, a single bounded retry (never
   a loop) issued only when calendar-upsert's own conflict guard refused a
   write that this same action's native status push had just made stale out
   from under it. */
const frontendCalls = (INDEX.match(/_calUpsertFetch\(/g) || []).length;
ok(frontendCalls === 10, 'expected _calUpsertFetch definition plus nine frontend call sites including native Submit materialization, deliverable-link adoption, component fill, and the Kasper self-conflict retry, got ' + frontendCalls);
ok(!/fetch\(CALENDAR_UPSERT_URL/.test(INDEX), 'frontend must not fetch CALENDAR_UPSERT_URL directly');
ok(/CALENDAR_UPSERT_N8N_URL/.test(INDEX), 'frontend n8n fallback URL constant missing');
ok(/CALENDAR_UPSERT_EF_URL/.test(INDEX), 'frontend EF URL constant missing');
ok(/CALENDAR_UPSERT_FLAG_KEY = 'calendar_upsert_ef_clients'/.test(INDEX), 'frontend runtime flag key missing');
ok(/syncview_runtime_flags\?select=value/.test(INDEX), 'frontend must read runtime flag table once');
ok(/_calUpsertFlagPromise/.test(INDEX), 'frontend runtime flag must be cached');
ok(/postgres_changes'[\s\S]*table: 'syncview_runtime_flags'/.test(INDEX), 'frontend runtime flag must refresh via realtime');
ok(/_calUpsertUrlForClient/.test(INDEX) && /_calUpsertUseEf/.test(INDEX), 'frontend per-client router missing');
ok(/X-Syncview-Actor/.test(INDEX) && /X-Syncview-Role/.test(INDEX) && /X-Syncview-Source/.test(INDEX),
  'frontend upsert headers missing actor/role/source');

ok(!/fetch\(UPSERT_URL/.test(RECON), 'reconciler must not fetch UPSERT_URL directly');
ok(/UPSERT_N8N_URL/.test(RECON), 'reconciler n8n fallback URL constant missing');
ok(/UPSERT_EF_URL/.test(RECON), 'reconciler EF URL constant missing');
ok(/UPSERT_FLAG_URL/.test(RECON) && /calendar_upsert_ef_clients/.test(RECON), 'reconciler runtime flag read missing');
ok(/loadUpsertEfClients/.test(RECON) && /await loadUpsertEfClients\(\)/.test(RECON), 'reconciler must load flag once per run');
ok(/upsertUrlForClient\(card\.client\)/.test(RECON), 'reconciler must route by card client');
ok(/X-Syncview-Source': 'reconcile'/.test(RECON), 'reconciler source header missing');
ok(/SYNCVIEW_STAFF_KEY/.test(RECON)
  && /headers\['X-Syncview-Key'\] = SYNCVIEW_STAFF_KEY/.test(RECON)
  && /if \(url === UPSERT_EF_URL\)/.test(RECON),
  'reconciler must attach its staff key only to EF writes and fail closed when absent');

console.log('calendar-upsert routing source checks passed');

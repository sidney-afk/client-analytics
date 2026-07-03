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

const frontendCalls = (INDEX.match(/_calUpsertFetch\(/g) || []).length;
ok(frontendCalls === 7, 'expected _calUpsertFetch definition plus six frontend call sites, got ' + frontendCalls);
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

console.log('calendar-upsert routing source checks passed');

'use strict';
/*
 * Native intake reconciliation runner. DRY-RUN BY DEFAULT.
 *
 *   node scripts/native-intake-reconcile/run.js                      # report the backlog, write nothing
 *   node scripts/native-intake-reconcile/run.js --limit=10           # examine/plan at most 10 owed requests
 *   NATIVE_INTAKE_RECONCILE_CONFIRM=RECONCILE_NATIVE_INTAKE_APPLY \
 *   node scripts/native-intake-reconcile/run.js --apply --limit=10   # recover children and materialize cards
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Calls only the four
 * service-role SQL functions installed by
 * migrations/2026-09-05-native-intake-reconcile.sql; every write decision is
 * made in SQL under the request lock. This process never calls Linear.
 *
 * Exit codes: 0 report produced; 1 transport or configuration failure;
 * 3 with --strict when an apply run leaves any conflict or unresolved request.
 */
const { runReconcile } = require('./reconcile-lib');

const args = new Map(process.argv.slice(2).map(a => {
  const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] == null ? '1' : m[2]] : [a, '1'];
}));
const APPLY = args.has('apply');
const STRICT = args.has('strict');
const LIMIT = Number(args.get('limit') || 25);
const REQUEST_IDS = String(args.get('request-id') || '').split(',').map(s => s.trim()).filter(Boolean);
const ACTOR = String(args.get('actor') || process.env.NATIVE_INTAKE_RECONCILE_ACTOR || 'native-intake-reconcile').trim();
const URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

if (!URL || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}
if (APPLY && process.env.NATIVE_INTAKE_RECONCILE_CONFIRM !== 'RECONCILE_NATIVE_INTAKE_APPLY') {
  console.error('refusing --apply without NATIVE_INTAKE_RECONCILE_CONFIRM=RECONCILE_NATIVE_INTAKE_APPLY');
  process.exit(1);
}

async function restRpc(name, params) {
  const response = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`rpc ${name} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

(async () => {
  const report = await runReconcile({
    rpc: restRpc, actor: ACTOR, apply: APPLY, limit: LIMIT, requestIds: REQUEST_IDS,
    onEvent: (stage, entry) => {
      const result = entry[stage] || {};
      // Labels and counts only. Request ids are opaque; no titles, briefs or
      // client display names ever reach this log.
      console.error(`${APPLY ? 'apply' : 'plan '} ${stage.padEnd(8)} ${entry.request_id} -> ${result.outcome}`);
    },
  });
  console.log(JSON.stringify(report, null, 2));
  if (STRICT && APPLY && (report.attention.conflicted > 0 || report.attention.unresolved > 0)) process.exit(3);
})().catch(error => {
  console.error(String(error && error.message || error));
  process.exit(1);
});

'use strict';
/*
 * Native intake reconciliation runner. DRY-RUN BY DEFAULT.
 *
 *   node scripts/native-intake-reconcile/run.js                      # public report of the backlog, write nothing
 *   node scripts/native-intake-reconcile/run.js --limit=10           # examine/plan at most 10 owed requests
 *   NATIVE_INTAKE_RECONCILE_CONFIRM=RECONCILE_NATIVE_INTAKE_APPLY \
 *   node scripts/native-intake-reconcile/run.js --apply --limit=10   # recover children, bind empty-since-creation slots
 *   node scripts/native-intake-reconcile/run.js --private-report=/absolute/path/outside/repo.json
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Calls only the four
 * service-role SQL functions installed by
 * migrations/2026-09-05-native-intake-reconcile.sql; every write decision is
 * made in SQL under the request lock. This process never calls Linear.
 *
 * WHAT THIS PRINTS IS PUBLIC. stdout carries the public report only: aggregate
 * counts, reason codes from a fixed allowlist, and keyed correlation tokens
 * when NATIVE_INTAKE_RECONCILE_HASH_KEY is configured. Request ids, client
 * slugs, deliverable/card ids and raw SQL or HTTP error bodies never reach
 * stdout or stderr. The full report can be written ONLY to a file outside the
 * repository with --private-report; the workflow never uploads it.
 *
 * Exit codes: 0 report produced; 1 transport or configuration failure;
 * 3 with --strict when an apply run leaves any conflict or unresolved request.
 */
const fs = require('fs');
const path = require('path');
const { runReconcile, publicReport } = require('./reconcile-lib');

const ROOT = path.resolve(__dirname, '..', '..');
const args = new Map(process.argv.slice(2).map(a => {
  const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] == null ? '1' : m[2]] : [a, '1'];
}));
const APPLY = args.has('apply');
const STRICT = args.has('strict');
const LIMIT = Number(args.get('limit') || 25);
const REQUEST_IDS = String(args.get('request-id') || '').split(',').map(s => s.trim()).filter(Boolean);
const ACTOR = String(args.get('actor') || process.env.NATIVE_INTAKE_RECONCILE_ACTOR || 'native-intake-reconcile').trim();
const PRIVATE_REPORT = String(args.get('private-report') || '');
const HASH_KEY = String(process.env.NATIVE_INTAKE_RECONCILE_HASH_KEY || '');
const URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

/* Fixed strings only. Nothing derived from input or from a response body. */
function fail(code) {
  console.error(code);
  process.exit(1);
}
if (!URL || !KEY) fail('config_error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
if (APPLY && process.env.NATIVE_INTAKE_RECONCILE_CONFIRM !== 'RECONCILE_NATIVE_INTAKE_APPLY') {
  fail('config_error: --apply requires NATIVE_INTAKE_RECONCILE_CONFIRM=RECONCILE_NATIVE_INTAKE_APPLY');
}
/* The private report may land ANYWHERE except inside this repository, and
   "inside" is decided on real paths: a textual check alone let `<repo>/..private`
   through (it merely begins with two dots) and a symlink from a temp directory
   into the tree would have written through it. The deepest existing ancestor is
   resolved with realpath before the check, and a path that cannot be resolved
   or is itself a symlink is refused rather than trusted. */
function textuallyInside(relative) {
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
function insideRepository(target) {
  const resolved = path.resolve(target);
  let rootReal;
  try { rootReal = fs.realpathSync(ROOT); } catch (_e) { return true; }
  if (textuallyInside(path.relative(ROOT, resolved)) || textuallyInside(path.relative(rootReal, resolved))) return true;
  let probe = resolved;
  const tail = [];
  while (!fs.existsSync(probe)) {
    tail.unshift(path.basename(probe));
    const parent = path.dirname(probe);
    if (parent === probe) return true;
    probe = parent;
  }
  let real;
  try { real = fs.realpathSync(probe); } catch (_e) { return true; }
  if (textuallyInside(path.relative(rootReal, path.join(real, ...tail)))) return true;
  try { if (fs.lstatSync(resolved).isSymbolicLink()) return true; } catch (_e) { /* not present yet */ }
  return false;
}
let privateReportPath = '';
if (PRIVATE_REPORT) {
  privateReportPath = path.resolve(PRIVATE_REPORT);
  if (insideRepository(privateReportPath)) {
    fail('config_error: refusing to write the private report inside the repository');
  }
}

const RPC_NAMES = new Set([
  'production_intake_reconcile_backlog', 'production_intake_reconcile_children',
  'production_intake_reconcile_cards', 'production_intake_reconcile_summary',
]);
class RpcError extends Error {
  constructor(name, status, detail) {
    super(`rpc_failed:${RPC_NAMES.has(name) ? name : 'unknown'}:http_${Number(status) || 0}`);
    this.publicCode = this.message;
    this.detail = detail; // private report only, never printed
  }
}
async function restRpc(name, params) {
  const response = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const text = await response.text();
  if (!response.ok) throw new RpcError(name, response.status, text.slice(0, 2000));
  try { return text ? JSON.parse(text) : null; }
  catch (_e) { throw new RpcError(name, 0, text.slice(0, 2000)); }
}

(async () => {
  let failure = null;
  let report = null;
  try {
    report = await runReconcile({
      rpc: restRpc, actor: ACTOR, apply: APPLY, limit: LIMIT, requestIds: REQUEST_IDS,
      onEvent: (stage, entry) => {
        // Per-request progress only with a correlation key; otherwise the
        // aggregate at the end is the whole public story.
        if (!HASH_KEY) return;
        const { correlation, boundOutcome } = require('./reconcile-lib');
        console.error(`${APPLY ? 'apply' : 'plan '} ${stage.padEnd(8)} ${correlation(entry.request_id, HASH_KEY)} -> ${boundOutcome((entry[stage] || {}).outcome)}`);
      },
    });
  } catch (error) {
    failure = error;
  }
  if (privateReportPath) {
    fs.writeFileSync(privateReportPath, JSON.stringify({
      report,
      failure: failure ? { code: failure.publicCode || 'runner_failed', detail: failure.detail || String(failure && failure.message || '') } : null,
      written_at: new Date().toISOString(),
    }, null, 2), { mode: 0o600 });
    console.error('private report written outside the repository');
  }
  if (failure) fail(String(failure.publicCode || 'runner_failed'));
  const pub = publicReport(report, { hashKey: HASH_KEY });
  console.log(JSON.stringify(pub, null, 2));
  if (STRICT && APPLY && (pub.attention.conflicted > 0 || pub.attention.unresolved > 0)) process.exit(3);
})().catch(() => fail('runner_failed'));

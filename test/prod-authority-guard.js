'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  authorityForTeam,
  legacyMutationPolicy,
  loadAuthority,
  validateAuthority,
} = require('../scripts/prod-authority-guard');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-authority-'));
  const cachePath = path.join(dir, 'authority.json');
  const live = async () => ({
    ok: true,
    status: 200,
    json: async () => [{ value: { video: 'linear', graphics: 'syncview' } }],
  });
  const first = await loadAuthority({ cachePath, fetchImpl: live, retries: 1 });
  ok(first.source === 'live', 'valid live flag wins');
  ok(authorityForTeam(first.authority, 'VID') === 'linear', 'VID maps to video authority');
  ok(authorityForTeam(first.authority, 'graphic') === 'syncview', 'graphic maps to graphics authority');
  ok(fs.existsSync(cachePath), 'live value is persisted as last-known-good');

  const failed = async () => { throw new Error('fixture network down'); };
  const cached = await loadAuthority({ cachePath, fetchImpl: failed, retries: 2, retryMs: 0 });
  ok(cached.source === 'last-known-good', 'read failure uses validated last-known-good');
  ok(cached.write_safe === false, 'last-known-good is diagnostic only and cannot authorize APPLY');
  ok(cached.warning === 'fixture network down', 'last-known-good use is loud');

  const coldPath = path.join(dir, 'cold.json');
  let coldError = null;
  try { await loadAuthority({ cachePath: coldPath, fetchImpl: failed, retries: 1 }); }
  catch (error) { coldError = error; }
  ok(coldError && coldError.code === 'PROD_AUTHORITY_UNAVAILABLE', 'cold read failure freezes writes');

  let malformed = false;
  try { validateAuthority({ video: 'linear' }); } catch (_) { malformed = true; }
  ok(malformed, 'partial authority objects are rejected rather than defaulted');

  const staleLinear = legacyMutationPolicy({ video: 'linear', graphics: 'linear' }, 'video');
  const staleSyncView = legacyMutationPolicy({ video: 'syncview', graphics: 'linear' }, 'video');
  const staleCold = legacyMutationPolicy(null, 'video');
  const stalePreflipCache = legacyMutationPolicy(cached.authority, 'video', { writeSafe: cached.write_safe });
  ok(staleLinear.allowed === true && staleLinear.http_status === 200, 'stale legacy queue request is allowed while its team is Linear-authoritative');
  ok(staleSyncView.allowed === false && staleSyncView.http_status === 409, 'same stale queue request is rejected after that team flips to SyncView');
  ok(staleCold.allowed === false && staleCold.http_status === 503, 'cold authority state freezes stale queue requests');
  ok(stalePreflipCache.allowed === false && stalePreflipCache.http_status === 503, 'pre-flip Linear last-known-good cannot authorize APPLY during a flag outage');

  const calendar = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'linear-sync-reconcile.js'), 'utf8');
  const samples = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sample-linear-reconcile.js'), 'utf8');
  for (const [name, source] of [['calendar', calendar], ['samples', samples]]) {
    ok(source.includes("require('./prod-authority-guard')"), `${name} reconciler uses shared authority reader`);
    ok(source.includes('const actionable = corrections.filter(c => !c.gated)'), `${name} filters gated corrections before apply`);
    ok(source.includes("authorityState.write_safe !== true || authority === 'syncview'"), `${name} freezes APPLY when only last-known-good is available`);
    ok(source.includes('for (const c of actionable)'), `${name} never iterates gated corrections in write loop`);
    ok(source.includes('if (!gated) ledger[key] = led'), `${name} does not advance gated ledger clocks`);
    ok(source.includes('freshAuthority = await loadAuthority') && source.indexOf('freshAuthority = await loadAuthority') < source.indexOf("if (c.winner === 'card')"), `${name} rechecks live authority immediately before each mutation`);
    ok(source.includes('if (fail) break;'), `${name} aborts the remaining apply set when a fresh authority check or mutation fails`);
    ok(source.includes('if (authorityFrozen)') && source.indexOf('if (authorityFrozen)') < source.lastIndexOf('saveLedger(ledger)'), `${name} refuses to persist ledger clocks after a mid-run authority freeze`);
  }

  const b1 = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'b1-linear-backfill.js'), 'utf8');
  ok(b1.includes('const allowedBatches = batchCandidates.filter(batchAllowed)'), 'B1 filters gated batch writes');
  ok(b1.includes('const allowedDeliverables = deliverableWriteCandidates.filter(deliverableAllowed)'), 'B1 filters gated deliverable writes');
  ok(b1.includes('authorityState.write_safe === true') && b1.includes('state.write_safe !== true'), 'B1 requires a live authority read for incremental and full APPLY');
  ok(b1.includes("full B1 apply is frozen unless a live flag read confirms both production teams are Linear-authoritative"), 'full B1 rerun fails closed after a team flip or flag outage');
  ok(b1.includes('linear_archive: archive.filter'), 'B1 retains archive-only refresh while live writes are gated');
  ok((b1.match(/await assertFreshLinearAuthority\(/g) || []).length >= 5, 'B1 rechecks authority before every incremental/full authoritative write family');
  ok(b1.indexOf('await assertFreshLinearAuthority(batch.team') < b1.indexOf("await supabaseRpc('batch_write'"), 'B1 rechecks batch authority immediately before its RPC');
  ok(b1.indexOf('await assertFreshLinearAuthority(deliverable.team)') < b1.indexOf("await supabaseRpc('deliverable_write'"), 'B1 rechecks deliverable authority immediately before its RPC');

  if (failures) process.exit(1);
  console.log('\nProduction authority guard checks passed');
}

run().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});

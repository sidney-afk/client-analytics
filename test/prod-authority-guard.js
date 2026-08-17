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
    /* F50 (2026-08-10): a syncview team with a LIVE outbound mirror is
     * reconciled pull-only instead of frozen. The two properties these pins
     * protect are preserved, and pinned in their new form:
     *   - gated corrections still never reach apply — the filter is strictly
     *     NARROWER (it also drops card-side wins on pull-only components,
     *     which belong to the outbound mirror, not the legacy webhook);
     *   - a last-known-good cache still cannot authorize ANY write —
     *     pullOnly itself requires write_safe === true, so write_safe=false
     *     forces gated exactly as before. */
    ok(source.includes("const actionable = corrections.filter(c => !c.gated && !(c.pullOnly && c.winner === 'card'))"), `${name} filters gated corrections before apply (and mirror-owned card wins)`);
    ok(source.includes("authorityState.write_safe !== true || (authority === 'syncview' && !pullOnly)"), `${name} freezes APPLY when only last-known-good is available`);
    ok(source.includes("authorityState.write_safe === true && authority === 'syncview' && outboundMode === 'live'"), `${name} pull-only mode itself demands a live write-safe read plus a live outbound mirror`);
    ok(source.includes("(await loadOutboundMode()) === 'live'"), `${name} re-proves the outbound mirror is STILL live immediately before each pull-only mutation`);
    ok(source.includes('for (const c of actionable)'), `${name} never iterates gated corrections in write loop`);
    ok(source.includes('if (!gated) ledger[key] = led'), `${name} does not advance gated ledger clocks`);
    ok(source.includes('freshAuthority = await loadAuthority') && source.indexOf('freshAuthority = await loadAuthority') < source.indexOf("if (c.winner === 'card')"), `${name} rechecks live authority immediately before each mutation`);
    ok(source.includes('if (fail) break;'), `${name} aborts the remaining apply set when a fresh authority check or mutation fails`);
    ok(source.includes('if (authorityFrozen)') && source.indexOf('if (authorityFrozen)') < source.lastIndexOf('saveLedger(ledger)'), `${name} refuses to persist ledger clocks after a mid-run authority freeze`);
  }

  const b1 = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'b1-linear-backfill.js'), 'utf8');
  ok(b1.includes('const allowedBatches = batchCandidates.filter(batchAllowed)'), 'B1 filters gated batch writes');
  ok(/const allowedDeliverables = deliverableWriteCandidates\s*\n?\s*\.filter\(deliverableAllowed\)/.test(b1),
    'B1 filters gated deliverable writes');
  /*
   * A deliverable must also have a batch to point at. `batchAllowed` requires
   * EVERY issue in a batch to be Linear-authoritative, so after the graphics
   * flip an ordinary mixed week withholds the batch while its video child still
   * passes its own gate -- B1 then inserted the child and Postgres rejected it
   * (23503, deliverables_batch_id_fkey), aborting the entire run. Measured
   * live: every scheduled B1 run failed from 2026-08-17T14:30Z onward, so
   * nothing imported at all. The orphan must be withheld, not attempted.
   */
  ok(/\.filter\(batchResolvable\)/.test(b1)
    && /resolvableBatchIds = new Set\(\[/.test(b1)
    && /\.\.\.existingBatches\.map/.test(b1)
    && /\.\.\.allowedBatches\.map/.test(b1),
    'B1 withholds a deliverable whose batch neither exists nor is being written this run');
  ok(/orphan_batch_deliverables: orphanBatchDeliverables\.length/.test(b1),
    'the withheld-orphan backlog is reported instead of surfacing as a foreign-key crash');
  ok(b1.includes('authorityState.write_safe === true') && b1.includes('state.write_safe !== true'), 'B1 requires a live authority read for incremental and full APPLY');
  ok(b1.includes("full B1 apply is frozen unless a live flag read confirms both production teams are Linear-authoritative"), 'full B1 rerun fails closed after a team flip or flag outage');
  ok(b1.includes('linear_archive: archive.filter'), 'B1 retains archive-only refresh while live writes are gated');
  ok((b1.match(/await assertFreshLinearAuthority\(/g) || []).length >= 4
    && !/supabaseInsert\('clients'/.test(b1),
  'B1 rechecks every remaining batch/deliverable write family and has no client insert family');
  ok(b1.indexOf('await assertFreshLinearAuthority(batch.team') < b1.indexOf("await supabaseRpc('batch_write'"), 'B1 rechecks batch authority immediately before its RPC');
  ok(b1.indexOf('await assertFreshLinearAuthority(deliverable.team)') < b1.indexOf("await supabaseRpc('deliverable_write'"), 'B1 rechecks deliverable authority immediately before its RPC');

  if (failures) process.exit(1);
  console.log('\nProduction authority guard checks passed');
}

run().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});

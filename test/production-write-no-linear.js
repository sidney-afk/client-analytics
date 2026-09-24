'use strict';
/*
 * B2 SLICE 8 — production-write makes no Linear call of any kind.
 *
 * Both teams are permanently SyncView-authoritative, the outbound flag is off,
 * and the `linear-outbound` Edge Function is being deleted. This suite pins
 * the source-level invariants that keep production-write from reaching Linear
 * again: no api.linear.app transport, no Linear API key read, no invocation of
 * the linear-outbound function, constant syncview authority, and every mirror
 * leg reported as the static not-applicable result. mirror_outbox receipts are
 * deliberately still written (the owner kept them as idempotency/reconcile
 * receipts), so the outbound objects and receipt readers must remain.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const edge = fs.readFileSync(path.join(ROOT, 'supabase/functions/production-write/index.ts'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('  FAIL  ' + message); }
}

ok(!/api\.linear\.app/.test(edge), 'no api.linear.app transport');
ok(!/LINEAR_READ_API_KEY|LINEAR_API_KEY|LINEAR_MIRROR_API_KEY/.test(edge), 'no Linear API key is read');
ok(!/functions\/v1\/linear-outbound/.test(edge), 'the linear-outbound Edge Function is never invoked');
ok(!/\b(targetedDrain|outboundLiveForDrain|scheduleSyncviewLiveDrains|linearRead|linearReadKey|readLinearProject|validateLinearBatchParent|linearStateIdForCreate|assigneeProviderPool|linearLabelsRequest|linearLabelCatalog|linearLabelSnapshot|assertLegacyParityEnabled)\b/.test(edge)
    && !/\bLINEAR_URL\b/.test(edge),
  'every retired Linear helper and drain helper is gone');

const authority = edge.slice(edge.indexOf('async function authorityFor('), edge.indexOf('async function f27WriteAuthorizationGeneration('));
ok(/Promise<"syncview">/.test(authority) && /return "syncview";/.test(authority)
    && /\.eq\("key", "prod_authority"\)/.test(authority) && !/return "linear"/.test(authority)
    && authority.trim().endsWith('throw new GatewayError(503, "authority_unavailable");\n}'),
  'authority reads prod_authority live, passes only exactly syncview, never returns linear, and fails closed otherwise');
ok(/f27WriteAuthorizationGeneration\(supabase, team\)/.test(edge),
  'the F27 write-authorization generation fence is still enforced');
ok(/if \(requestedParity\) throw new GatewayError\(409, "legacy_parity_not_allowed"\);/.test(edge),
  'a legacy parity request is refused');

ok(/function notApplicableMirror\(\): JsonMap \{\s*return \{ attempted: false, acknowledged: true, not_applicable: true \};/.test(edge)
    && !/mirror_pending: mirrorPending,[\s\S]{0,4}\}, targetedFailure/.test(edge)
    && !/targetedFailure|awaitedDrain|syncviewLiveDrain/.test(edge),
  'mirror legs are the static acknowledged not-applicable result and mirror_pending never waits on a drain');

// Owner decision: receipts stay. These must survive the removal.
ok(/async function findOutboxId\(/.test(edge)
    && /async function nativeOrdinaryReceipt\(/.test(edge)
    && /async function providerDrainPlans\(/.test(edge)
    && /outbox_checkpoint_missing/.test(edge)
    && /legacy_parity: false/.test(edge),
  'mirror_outbox receipt readers and literal legacy_parity:false payload tokens are kept');
ok(/B4_TEST_PROJECT_IDS/.test(edge) && /B4_TEST_PROJECT_BY_TEAM/.test(edge)
    && /function configuredTestProjectIds\(/.test(edge) && /function configuredTestProjectForTeam\(/.test(edge),
  'the test-client project helpers are kept');
ok(/function teamIdFor\(/.test(edge), 'the env-only teamIdFor mapping is kept');

if (failures) {
  console.error(`\n${failures} production-write no-Linear check(s) failed`);
  process.exit(1);
}
console.log('\nProduction-write no-Linear checks passed');

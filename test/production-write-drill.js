'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  assertFlipTolerantStance,
  classifyFailure,
  descriptionReadbackMatches,
  descriptionReadbackScopes,
  nativeCreateReceiptOk,
  nativeIntakeEnabled,
  nativeIntakeLanes,
  nativeMirrorRowSettled,
  reconcilableAssets,
  stableJson,
  unsettledNativeMirrorRows,
  writePrivateFailure,
} = require('../scripts/production-write-drill');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

ok(stableJson({ b: 2, a: 1 }) === stableJson({ a: 1, b: 2 }), 'flag comparison is key-order independent');
const stance = (authority, mode) => ({
  prod_authority: { value: authority, updated_at: 'one' },
  linear_outbound_enabled: { value: { mode }, updated_at: 'two' },
  linear_inbound_enabled: { value: { enabled: true }, updated_at: 'three' },
  auth_enforcement: { value: { mode: 'enforced' }, updated_at: 'four' },
});
let mixedAccepted = true;
try { assertFlipTolerantStance(stance({ video: 'syncview', graphics: 'linear' }, 'live')); } catch (_) { mixedAccepted = false; }
ok(mixedAccepted, 'daily TEST drill accepts mixed authority and live outbound without changing them');
let malformedRejected = false;
try { assertFlipTolerantStance(stance({ video: 'unknown', graphics: 'linear' }, 'live')); } catch (_) { malformedRejected = true; }
ok(malformedRejected, 'daily TEST drill still rejects a malformed authority stance');
const expectedDescription = '  # F202 drill\n\n- Markdown  \n';
ok(descriptionReadbackMatches(
  { video: 'linear' }, 'video',
  { brief: expectedDescription.trim() }, { description: expectedDescription }, expectedDescription,
), 'Linear-authoritative readback requires exact Linear bytes but tolerates native re-projection');
ok(!descriptionReadbackMatches(
  { video: 'linear' }, 'video',
  { brief: expectedDescription }, { description: expectedDescription.trim() }, expectedDescription,
), 'Linear-authoritative readback still rejects changed Linear bytes');
ok(descriptionReadbackMatches(
  { graphics: 'syncview' }, 'graphics',
  { brief: expectedDescription }, { description: expectedDescription }, expectedDescription,
), 'native-authoritative readback requires exact native and Linear bytes');
ok(!descriptionReadbackMatches(
  { graphics: 'supabase' }, 'graphics',
  { brief: expectedDescription }, { description: expectedDescription }, expectedDescription,
), 'F55: the retired supabase alias is no longer treated as a native-authoritative lane');
ok(!descriptionReadbackMatches(
  { graphics: 'syncview' }, 'graphics',
  { brief: expectedDescription.trim() }, { description: expectedDescription }, expectedDescription,
) && !descriptionReadbackMatches(
  { graphics: 'syncview' }, 'graphics',
  { brief: expectedDescription }, { description: expectedDescription.trim() }, expectedDescription,
), 'native-authoritative readback rejects drift on either side');
ok(stableJson(descriptionReadbackScopes(['video', 'graphics'], [
  { team: 'video', descriptionReadbackScope: 'native_and_linear' },
])) === stableJson({
  video: 'native_and_linear',
  graphics: 'not_verified',
}), 'description readback scope marks an uncompleted configured team not_verified');
ok(stableJson(descriptionReadbackScopes(['video', 'graphics'], [
  { team: 'video', descriptionReadbackScope: 'linear_only_authority_linear' },
  { team: 'graphics', descriptionReadbackScope: 'native_and_linear' },
])) === stableJson({
  video: 'linear_only_authority_linear',
  graphics: 'native_and_linear',
}), 'description readback scope preserves only per-asset completed proof');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'production-write-drill.js'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'production-write-drill.yml'), 'utf8');
for (const token of [
  "operation: 'intake_create'",
  "request('status'",
  "request('comment'",
  "request('due'",
  "request('assignee'",
  "test_override: true",
  "confirm: 'B4_TEST_ONLY'",
  'skip_graphic_generation',
]) ok(source.includes(token), `drill uses real gateway contract: ${token}`);
ok(!source.includes('legacy_parity'), 'normal service TEST drill does not impersonate legacy-parity traffic');
ok(source.includes('expected exactly one active TEST client'), 'drill discovers the sole active TEST client server-side');
ok(!source.includes('PRODUCTION_WRITE_TEST_'), 'drill adds no unavailable GitHub TEST secrets');
ok(source.includes('production_comments?select=id'), 'drill verifies exactly-once native comment storage');
ok(source.includes("audience: 'internal'") && !source.includes("audience: 'staff'"), 'drill uses the gateway comment-audience vocabulary');
/*
 * Re-pinned 2026-08-20. This asserted the `Video 1` fallback brief, which the
 * 2026-08-17 generator retirement deleted — so the drill has been FAILING
 * nightly (error_class graphics_fallback_description) on 18 and 19 Aug. The
 * drill sends skip_graphic_generation for its graphics fixture and the restored
 * generator returns nothing for that flag, so the correct expectation is an
 * empty brief mirrored as an empty Linear description. Asserting empty rather
 * than dropping the check keeps the drill able to catch a generator that fires
 * when it was told not to.
 */
ok(source.includes("assert(!clean(row.brief), 'graphics brief should be empty when generation is skipped')")
  && source.includes('skipped graphics generation should leave the Linear description empty'),
'drill verifies the skipped-generation graphics brief is empty in native and Linear');
ok(source.includes('PRODUCTION_WRITE_DRILL_REAL_GRAPHIC_GENERATION')
  && source.includes("row.brief !== 'Video 1'")
  && source.includes('issue.description === row.brief'),
'one-shot mode omits the skip path and proves the generated graphics title round-trips');
ok(source.includes("brief: team === 'video'")
  && source.includes('REAL_GRAPHIC_GENERATION ? GRAPHICS_DRILL_NOTE : undefined')
  && source.includes('THUMBNAIL_TEXT_AI_LABEL'),
'real generation also exercises a caller-supplied graphics note (Codex round 1 on #1361)');
ok(source.includes('const expectedPrefix = `${GRAPHICS_DRILL_NOTE}\\n${labelMatch[1]}`')
  && source.includes('row.brief.startsWith(expectedPrefix)')
  && source.includes('row.brief.length > expectedPrefix.length'),
'the E2E drill asserts the EXACT note-newline-label prefix plus real title text after it, not just relative ' +
  'ordering — a bare label with no title, or a space-joined note, must fail this path (Codex round 2 on #1361)');
ok(source.includes("if (team === 'graphics' && !REAL_GRAPHIC_GENERATION) request.skip_graphic_generation = true"),
  'real generation request omits the skip flag instead of sending false');
ok(source.includes('PRODUCTION_WRITE_DRILL_TEAMS') && source.includes('for (const team of DRILL_TEAMS)'),
  'one-shot drill can scope mutations to graphics only');
ok(source.includes('PROD_AUTHORITY = assertFlipTolerantStance(before).authority')
  && source.includes("operation: 'description'")
  && !source.includes('if (descriptionReadbackMatches')
  && source.includes('descriptionReadbackMatches('),
  'F202 description mutation is unconditional and only its readback follows prod_authority');
// The round-trip is gated (F203) because it depends on an undeployed Edge
// Function revision, but the invariant it protected is unchanged: the recorded
// scope must come from what the poll ACTUALLY did, never be assumed. Enforce
// mode awaits the poll before claiming the scope; observe mode claims it only
// when the poll resolved, and reports `parked_pending_deploy` when it did not.
ok(/if \(DESCRIPTION_ROUNDTRIP_ENFORCED\) \{\r?\n\s*await poll\(`\$\{asset\.team\} description round-trip`, readback\);\r?\n\s*asset\.descriptionReadbackScope = provedScope;/.test(source),
  'enforce mode records the description proof only after its round-trip poll completes');
ok(/asset\.descriptionReadbackScope = observed \? provedScope : 'parked_pending_deploy';/.test(source),
  'observe mode records the proved scope only when the round-trip actually resolved');
ok(source.includes('description_readback_scope: descriptionReadbackScopes(DRILL_TEAMS, assets)'),
  'the per-team description scope is reported for every drilled team');
ok(source.includes("reconcileArgs.push(`--team=${DRILL_TEAMS[0]}`)"),
  'one-shot reconciliation is scoped to the exercised team');
ok(source.includes('foreign_write_detected'), 'drill checks for echo/foreign-write storms');
/*
 * The echo check survived the flip only because it now subtracts the drill's
 * OWN comment coming home. Post-F1 every inbound Linear webhook for a
 * SyncView-authoritative team is recorded as a detect-only foreign write, so
 * an unfiltered count can never be 0 again -- that is what reddened run
 * 32039053391. These pins keep the exclusion narrow: it may drop only events
 * carrying a comment id the drill itself created, and the assertion must still
 * gate on what is LEFT, not on a constant.
 */
ok(/const ownCommentIds = new Set\(ownLinearComments\.map/.test(source),
  'the echo exclusion is built from the drill\'s own Linear comment ids, not a blanket skip');
ok(/event\.payload && event\.payload\.linear_comment_id/.test(source)
  && /ownCommentIds\.has\(commentId\)/.test(source),
  'only events whose linear_comment_id is one of ours are treated as own echo');
ok(/asset\.echoUnexpected = foreign\.length - ownEcho\.length;/.test(source),
  'the assertion counts the foreign writes left after removing our own echo');
ok(source.includes('assert(asset.echoUnexpected === 0'),
  'a residual foreign write still fails the drill');
ok(source.includes('asset.echoOwnComment = ownEcho.length;'),
  'the absorbed own-echo count is reported, so a green run never hides it');
ok(source.includes('--test-authority-client='), 'drill runs the TEST-only authority reconciler');
ok(source.includes('diff_count') && source.includes('repair_list_size') && source.includes('linkage_actionable'), 'drill requires final 0/0/0 reconciliation');
ok(source.includes("operation: 'archive'") && source.includes("test_override: { client_slug: TEST_CLIENT, mode: 'live', authority: 'syncview' }"), 'cleanup archives through the TEST-only outbox path');
ok(source.includes('stableJson(flagsBefore) === stableJson(flagsAfter)'), 'drill proves runtime flags unchanged');
ok(source.includes('select=key,value,updated_at'), 'flag proof detects a flip-away-and-back during the drill');
ok(!source.includes('production authority must remain linear/linear')
  && !source.includes('production outbound must remain off'),
'drill no longer hard-codes the pre-flip production stance');
ok(source.includes("action: 'production_write_drill'"), 'drill emits the pager summary event');
ok(source.includes('error_code:') && !source.includes('clean(failure.message).slice'), 'public drill telemetry reports an aggregate stage code, never a raw failure body');
const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'production-write-drill-private-'));
const privateLog = path.join(privateDir, 'failure.json');
ok(writePrivateFailure(new Error('private fixture detail'), 'video_mutations', privateLog), 'private failure detail can be written to a caller-supplied path');
const privatePayload = JSON.parse(fs.readFileSync(privateLog, 'utf8'));
ok(privatePayload.stage === 'video_mutations' && privatePayload.message === 'private fixture detail' && privatePayload.stack.includes('private fixture detail'), 'private log preserves the failure stage, message, and stack');
let repoPathRejected = false;
try { writePrivateFailure(new Error('must not land in repo'), 'fixture', path.join(__dirname, 'private-failure.json')); } catch (_) { repoPathRejected = true; }
ok(repoPathRejected && !fs.existsSync(path.join(__dirname, 'private-failure.json')), 'private failure log is refused inside the public repository');
ok(!source.includes('console.log(privatePayload)') && !source.includes('error: failure ?'), 'raw private failure detail is absent from console and public payload wiring');
ok(!/Sidney Laruel|Test Project|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(source), 'drill contains no client/project names or private ids');
ok(/cron: '17 4 \* \* \*'/.test(workflow) && /workflow_dispatch:/.test(workflow), 'drill has daily and manual triggers');
ok(/secrets\.SUPABASE_SERVICE_ROLE_KEY/.test(workflow) && /secrets\.LINEAR_API_KEY/.test(workflow), 'drill uses existing service/read secrets');
ok(!/PRODUCTION_WRITE_TEST_/.test(workflow), 'drill workflow introduces no missing TEST secret dependency');

/*
 * NATIVE INTAKE LANE (2026-09-18, run 35327383049).
 *
 * The drill drove all ten gateway operations successfully and then died at
 * `video_verification` / `linear_linkage_timeout`, because it polled for a
 * `linear_issue_uuid` on a card native intake had deliberately created without
 * one. These lock the lane decision, the receipt shape it must accept, and the
 * follow-up rows it must refuse to call settled.
 */
{
  const lanes = nativeIntakeLanes({
    video: { enabled: true, epoch: 'f27.native.2026-09-15' },
    graphics: { enabled: false, epoch: null },
  });
  ok(lanes.video === 'f27.native.2026-09-15' && lanes.graphics === '',
    'an enabled team resolves to its epoch and a disabled one to the provider lane');
  ok(nativeIntakeEnabled(lanes, 'video') && !nativeIntakeEnabled(lanes, 'graphics'),
    'the lane decision is per team, exactly as the flag is');
  ok(nativeIntakeEnabled(lanes, 'VIDEO'),
    'the lane decision is case-insensitive, matching the team keys the drill passes');
}
{
  // Mirrors production_native_intake_epochs(): malformed is an error, never a
  // silent fall back to the provider lane the drill would then mis-assert.
  const malformed = [
    { video: { enabled: true, epoch: null }, graphics: { enabled: false, epoch: null } },
    { video: { enabled: true, epoch: 'has spaces' }, graphics: { enabled: false, epoch: null } },
    { video: { enabled: 'yes', epoch: 'e1' }, graphics: { enabled: false, epoch: null } },
    { video: { enabled: false, epoch: null } },
    {},
  ];
  let rejected = 0;
  for (const value of malformed) {
    try { nativeIntakeLanes(value); } catch (_) { rejected++; }
  }
  ok(rejected === malformed.length, 'every malformed native_intake_epochs shape is refused, none defaults to provider');
  ok(classifyFailure(new Error('native_intake_epochs is malformed for video')) === 'native_intake_flag_invalid',
    'a malformed lane flag is classified rather than reported as unclassified');
}
{
  const epoch = 'f27.native.2026-09-15';
  const receipt = {
    status: 'skipped',
    payload: { _native_intake_epoch: epoch, _native_intake_request: 'req-1' },
    linear_result: { native_only: true, epoch },
  };
  ok(nativeCreateReceiptOk(receipt, epoch), 'a native-only create receipt for the accepted epoch is accepted');
  ok(!nativeCreateReceiptOk({ ...receipt, status: 'pending' }, epoch),
    'a create receipt still pending is not a native receipt, whatever its payload says');
  ok(!nativeCreateReceiptOk({ ...receipt, linear_result: { native_only: true, epoch: 'other' } }, epoch),
    'a receipt sealed under a different epoch is refused');
  ok(!nativeCreateReceiptOk({ ...receipt, linear_result: { epoch } }, epoch),
    'a skipped row without the native_only marker is refused: skipped alone is not native');
  ok(!nativeCreateReceiptOk({ ...receipt, payload: { _native_intake_epoch: epoch } }, epoch),
    'the payload must carry both the epoch and the request marker, as the recognizer requires');
  ok(!nativeCreateReceiptOk(null, epoch), 'a missing receipt is never accepted');
}
{
  // Follow-up rows. Each native capability stamps its own marker; a provider
  // row on a card with no Linear issue can only fail, and must be named.
  ok(nativeMirrorRowSettled({ status: 'skipped', linear_result: { native_ordinary: true } }),
    'an ordinary native receipt settles the row');
  ok(nativeMirrorRowSettled({ status: 'skipped', linear_result: { native_assignment: true } }),
    'a native assignment receipt settles the row');
  ok(nativeMirrorRowSettled({ status: 'skipped', linear_result: { native_labels: true } }),
    'a native label receipt settles the row');
  ok(!nativeMirrorRowSettled({ status: 'failed', operation: 'status', linear_result: {} }),
    'a failed provider row is never settled');
  ok(!nativeMirrorRowSettled({ status: 'written', operation: 'status', linear_result: { issue_id: 'x' } }),
    'a row that reached Linear is not a native settlement');
  ok(!nativeMirrorRowSettled({ status: 'skipped', linear_result: { conflict: { decision: 'stale' } } }),
    'skipped for some other reason is not a native settlement');

  const rows = [
    { operation: 'status', status: 'failed', linear_result: {} },
    { operation: 'comment', status: 'pending', linear_result: {} },
    { operation: 'due', status: 'skipped', linear_result: { native_ordinary: true } },
  ];
  const unsettled = unsettledNativeMirrorRows(rows);
  ok(unsettled.length === 2 && unsettled.join(' ') === 'comment:pending status:failed',
    'the unsettled report names operation and status, sorted and deduplicated of nothing else');
  ok(!/payload|body|client|slug|dedup/i.test(unsettled.join(' ')),
    'the unsettled report is public-safe: operation and status only');
  ok(unsettledNativeMirrorRows(rows.slice(2)).length === 0, 'a fully native card reports nothing unsettled');
  ok(classifyFailure(new Error('video native card left non-native mirror rows behind: status:failed'))
    === 'native_intake_provider_mirror_rows',
    'follow-up rows stuck on the provider lane get their own classified code');
}
{
  ok(classifyFailure(new Error('video native intake produced a Linear issue'))
    === 'native_intake_linear_issue_present',
    'a native lane that leaked a Linear issue is classified, not unclassified');
  ok(classifyFailure(new Error('video Linear linkage timed out')) === 'linear_linkage_timeout',
    'the provider lane keeps its own linkage classification');
}
{
  const assets = [
    { team: 'video', nativeIntake: { epoch_present: true } },
    { team: 'graphics', linear: { id: 'i', identifier: 'GRA-1' } },
  ];
  const reconcilable = reconcilableAssets(assets);
  ok(reconcilable.length === 1 && reconcilable[0].team === 'graphics',
    'only the Linear-lane fixture is reconciled: a native card has no counterpart to compare');
  ok(reconcilableAssets([assets[0]]).length === 0,
    'an all-native run reconciles no fixture rather than failing for a missing identifier');
}
{
  const scopes = descriptionReadbackScopes(['video'], [
    { team: 'video', descriptionReadbackScope: 'native_intake_no_mirror' },
  ]);
  ok(scopes.video === 'native_intake_no_mirror',
    'the native description readback reports the scope it proved, not not_verified');
}
{
  // The source-level guarantees: the branch exists and the native path never
  // reaches the Linear readers.
  const nativePath = source.slice(source.indexOf('async function verifyNativeFixture'),
    source.indexOf('async function verifyFixture'));
  ok(/if \(nativeIntakeEnabled\(NATIVE_INTAKE, asset\.team\)\) return verifyNativeFixture\(asset\);/.test(source),
    'verifyFixture dispatches on the lane before any Linear read');
  ok(nativePath.length > 0 && !/\blinear\(/.test(nativePath) && !/linkedRow\(/.test(nativePath),
    'the native verification never calls Linear or polls for a linkage that cannot arrive');
  ok(/linear_issue_uuid[\s\S]{0,200}?native intake produced a Linear issue/.test(nativePath),
    'the native verification refuses a Linear issue rather than merely not requiring one');
  ok(/intake_lane_by_team/.test(source),
    'the report states which intake lane each team drilled');
  ok(/linear_reconcile_native_intake/.test(source),
    'a green native run names the reconcile it did not perform');
}

if (failures) process.exit(1);
console.log('\nProduction write drill scaffold checks passed');

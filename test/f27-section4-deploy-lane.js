'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const workflowPath = path.join(ROOT, '.github', 'workflows', 'deploy-f27-section4-closures.yml');
const inboundWorkflowPath = path.join(ROOT, '.github', 'workflows', 'deploy-f27-linear-inbound.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const inboundWorkflow = fs.readFileSync(inboundWorkflowPath, 'utf8');
const rollbackLibrary = fs.readFileSync(path.join(ROOT, 'scripts', 'f27-edge-source-rollback-lib.js'), 'utf8');
const manifestGenerator = fs.readFileSync(path.join(ROOT, 'scripts', 'ef-deploy-manifest.js'), 'utf8');
const manifest = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'EF_DEPLOY_MANIFEST.md'), 'utf8');
const runbook = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'F27_INSTALL_RUNBOOK.md'), 'utf8');

const EXACT_SLUGS = [
  'linear-outbound',
  'production-write',
  'deliverable-write',
  'batch-write',
];
const CANDIDATES = new Map([
  ['batch-write', {
    source: '86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a',
    entrypoint: '15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5',
    files: 2,
  }],
  ['deliverable-write', {
    source: '78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575',
    entrypoint: '74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68',
    files: 2,
  }],
  // Re-pinned 2026-08-19 (ninth release): the mirror stops vetoing its own
  // writes. The stale guard read the issue clock our OWN just-delivered
  // comment had bumped as "a human edited Linear" and dropped the paired
  // status row -- 81/81 audited drops carried a veto clock byte-identical to
  // an own written row's acknowledged updated_at receipt, and Kasper's
  // GRA-6808 tweak was stranded in Linear for 20 hours. decideConflict now
  // discounts an issue clock at or before our own latest acknowledged write
  // to the same issue (context.own_write_clocks, receipts the drainer already
  // records); per-field webhook clocks and genuinely newer issue clocks veto
  // exactly as before, and no receipts means the old guard byte-for-byte.
  //
  // Supersedes the 2026-08-18 eighth release (ONE PARENT PER CARD, carrying
  // the seventh's exact team-parent resolution and terminal parent-conflict
  // receipt). Entrypoint hash is unchanged because it hashes the PATH, not
  // the file, and the file count is unchanged because no file entered or left
  // the closure. The other three are untouched and deploy byte-identical.
  ['linear-outbound', {
    source: 'd83f0d7c08ec39ad8897ab8323b3896235e8a39c6ea7c6cdde96f6b25ed4480b',
    entrypoint: '606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684',
    files: 5,
  }],
  // Re-pinned 2026-08-18 (eleventh release): a graphics creative may attach or
  // replace the canonical file on any GRAPHICS row -- `attachment` left the
  // assignee-bound set by owner ruling after the designer could not repair her
  // own mis-attach. Staff-only, graphics-only and same-team all still hold.
  //
  // Re-pinned 2026-08-18 (tenth release): ONE PARENT PER CARD -- the gateway
  // plans a single primary-team parent per card and points every child at it,
  // records the served-team list so the drain can link it for both, and keeps
  // a legacy split batch on its own distinct parent when appending.
  //
  // Re-pinned 2026-08-17 (ninth release): no AI-written thumbnail brief, and
  // the graphics child is titled `Thumbnail N` instead of `Video N`. Owner
  // ruling after his test post produced an invented brief about a real client.
  // Permission/content change only; no authority or write-path change.
  //
  // Re-pinned 2026-08-17 (eighth release): the owner retired F136's creative
  // status state machine -- every current status now offers every status, in
  // policy.mjs and in the browser table that mirrors it. Permission widening
  // only; no write-path, authority or artifact-gate change.
  // (Previous pin: 034704bc... -- next.frame.io on the asset host allowlist.)
  //
  // Re-pinned 2026-08-17 (seventh release): next.frame.io added to the asset
  // host allowlist. An f.io/<id> short link 302s there, so without the host the
  // probe's redirect allowlist refused the hop and EVERY Frame.io artifact
  // resolved 'unavailable' — the sixth release's widening was inert for the
  // exact case it was built for. Proved live against the owner's card link.
  // (Previous pin: 5bbde691… — folders/Frame.io accepted + the card fallback.)
  //
  // Re-pinned 2026-08-19 (eighth release): samples titles. The intake title
  // prefix ('Sample ' on the sxr lane) rides intakePurpose in the row builder,
  // and the append planner takes the BATCH's purpose. Pairs with owner-run
  // migrations/2026-08-19-production-intake-append-v6.sql -- apply it BEFORE
  // this deploy, or samples appends will compose 'Sample Video N' titles the
  // live v5 RPC refuses as invalid_intake_append_order. Calendar appends are
  // unaffected in either order.
  // (Previous pin: 3471be0c… -- the seventh release, samples lanes 1-3.)
  //
  // Re-pinned 2026-08-19 (seventh release): samples native create, layers 1-2.
  // The sxr lane admits intake_create, and the intake derives ONE value from
  // the surface that drives both the batch's `purpose` and every row's
  // `origin`. Legacy parity is deliberately NOT widened alongside it, so a
  // samples intake writes the native leg only.
  //
  // Pairs with two owner-run migrations: 2026-08-19-samples-batch-purpose.sql
  // (the column) and 2026-08-19-samples-batch-write-purpose.sql (batch_write
  // inserts through an explicit column list, so without it `purpose` is
  // dropped silently and every samples batch lands as 'calendar'). Apply BOTH
  // before this deploy; the gateway stamping a column nothing persists is the
  // failure mode this ordering exists to avoid.
  // (Previous pin: 18735baf… — the sixth release, Graphics approval artifact.)
  //
  // Re-pinned 2026-08-16 (sixth release): production-write's Graphics approval
  // gate stops demanding one concrete FILE with fetchable media bytes, and
  // stops looking only at deliverables.file_url. Measured on flip day, that
  // strict reading would have refused SMM approval to essentially the whole
  // Deploy #14: batch appends never worked — the Jul 13 intake-append
  // migration was never applied (500 on a missing function), the planner
  // hard-required pairs (blocking the 2026-08-17 single modes), and titles
  // predated the Thumbnail ruling. The gateway half ships here; the owner
  // runs migrations/2026-08-18-production-intake-append-v2.sql alongside.
  // Either order is safe. The other three deploy byte-identical.
  // (Previous pin: fdf03014… — the graphics canonical-file front door.)
  // Re-pinned 2026-08-20 (ninth release): submit-tab thumbnail text restored,
  // narrowed. The unconditional generator retired on 2026-08-17 is deleted;
  // submissionThumbnailText replaces it behind eight gates -- submit surface
  // only, new batches only, graphics children with no human brief, a
  // server-resolved AND substantive filming plan, output grounded in that
  // plan's own words, a thumbnail-length cap, and no throw path, so it can
  // never fail a submission. The parent issue and the video child are
  // structurally unreachable from the expression that consumes it.
  // (Previous pin: f91973ee... -- the eighth release, samples titles.)
  //
  // Re-pinned 2026-08-21 (twelfth release): interrupted intake submissions
  // converge on retry instead of dead-ending. When the B1 mirror wins the
  // race against a crashed submission and materializes the missing rows from
  // Linear under its own batch, both the planning pre-check and
  // ensureDeliverable now treat that drift as the resume case for rows
  // authored by linear-backfill only: the rows are adopted back into the
  // deterministic batch and the mirror's emptied shell is archived, never
  // deleted. Identity (client/team/title/card linkage) still hard-conflicts
  // for everyone; no authority, role, or artifact gate changes. Second
  // review round: replay suppresses only the duplicate CREATE, never the
  // filing repair (the outbox intent predates the row write, so the real
  // incident retry arrives as a replay), repaired via a narrow direct
  // update with no event and no outbox. Entrypoint hash is unchanged
  // because it hashes the PATH, and the file count is unchanged because no
  // file entered or left the closure.
  // (Previous pin: 721028df... -- the eleventh release, graphics attach.)
  // Re-pinned 2026-08-24 (tenth release): the Production tab creates nothing.
  // Owner ruling -- neither top-level nor sub-issue creation happens there,
  // because the create insert hardcodes card_id: null for BOTH modes, so
  // nothing born in that dialog is on anyone's calendar. handleProductionCreate
  // now throws 403 production_create_closed, placed AFTER productionCreateReplay
  // so a create that already committed is still returned to its author.
  // File count is unchanged at 5 -- no file entered or left the closure -- and
  // the entrypoint hash is unchanged because it hashes the PATH, not the file.
  // The other three deploy byte-identical. Re-pinned in the SAME commit as the
  // change: this suite reads the closure from git HEAD, not the working tree,
  // so a pin fixed afterwards passes locally and fails CI on identical code.
  //
  // Re-pinned 2026-08-24 (eleventh release): the Submit link works for people
  // who are not staff. Owner decision -- clients and videographers send footage
  // through ?intake=1 and are not staff, and since the 2026-08-14 full-roster
  // enrollment none of them could submit at all. `intake_create` on the
  // `submission` surface now accepts a caller with NO credentials, and nothing
  // else on the gateway does: the public principal is minted at that one call
  // site rather than inside authenticate(), so every other handler stays
  // closed, and a caller who DID present a credential is judged on it and can
  // never fall through. Bounded by a default-OFF runtime flag that fails closed
  // on a missing/unreadable/malformed value, a lower item cap than an
  // authenticated caller gets, and per-client plus overall rate limits counted
  // from the service-role-only public_intake_log. Accepted rows are stamped
  // created_by = 'public-intake'.
  //
  // SHIPS INERT. The flag is seeded off by
  // migrations/2026-08-24-public-intake-log.sql, so deploying this changes no
  // behaviour until the owner turns it on (docs/ops/PUBLIC_SUBMIT_LINK.md).
  // Apply that migration before enabling; deploying first is safe either way.
  //
  // File count is unchanged at 5 -- no file entered or left the closure -- and
  // the entrypoint hash is unchanged because it hashes the PATH, not the file.
  // The other three deploy byte-identical.
  //
  // AND THE SAME-COMMIT RULE ABOVE WAS BROKEN GETTING HERE. The gateway change
  // was committed first and this pin followed in the next commit, so CI went
  // red on the in-between SHA -- exactly the failure the tenth release wrote
  // that rule to prevent, on the very next release. The rule is not about
  // tidiness: a red intermediate commit is indistinguishable at a glance from
  // a real closure drift, which is the one signal this pin exists to give.
  // Pin and source belong in ONE commit.
  //
  // Re-pinned 2026-08-24 (twelfth release, SAME COMMIT this time): new work can
  // no longer be created already started, enforced on the server. #1073 fixed
  // four browser call sites on 2026-08-17 and its own comment promised the
  // gateway's matching `|| "in_progress"` default would be corrected "on the
  // next deploy"; three deploys later it had not been, and a second person
  // reported the identical symptom -- 30 rows born In Progress from a tab
  // holding pre-#1073 code. A client-side default is a suggestion; this app is
  // one 4.6 MB index.html that people leave open for days, so the invariant now
  // lives where it cannot be out of date. Started statuses at create are
  // NORMALISED to todo rather than refused (owner decision -- a submission is
  // often someone's whole shoot) and every correction is counted back in the
  // response so a stale client stays visible. The TEST drill keeps its
  // deliberate started state, gated on the authenticated principal.
  // File count unchanged at 5; entrypoint hash unchanged (it hashes the PATH).
  //
  // Amended in review: an idempotent retry that committed under the PREVIOUS
  // gateway holds in_progress while the new plan says todo, and
  // intakeExistingRowConflict compares status -- so a retry across this exact
  // deploy boundary would have returned 409 intake_id_conflict, reporting a
  // failed submission for work that already exists. The plan now ADOPTS a
  // stored started status instead of planning over it. Adopting rather than
  // correcting is deliberate: the plan is written to the row, so correcting
  // would drag a genuinely started deliverable back to To Do on any retry.
  //
  // Re-pinned 2026-08-27 (seventeenth release): the sixteenth release's parent
  // read asked the deliverables TABLE for raw_issue_parent_id, a column that
  // exists only on the production_deliverables_browser_v1 VIEW. PostgREST
  // answers 42703, and because that read degrades to an empty parent set BY
  // DESIGN, the freest-editor correction attested live as v55 was silently
  // inert -- every count ran uncorrected while the deploy readback said PASS.
  // Found when the SAME wrong column killed the B1 import lane, which does not
  // degrade. The read now goes to the view; the degradation path is unchanged
  // and still covered by test/editor-count-excludes-parents. One identifier
  // changed plus the comment recording this, no new import, file count
  // unchanged at 5.
  // (Previous pin: 77a00199... -- the sixteenth release, the freest-editor
  // parent exclusion.)
  //
  // Re-pinned 2026-08-27 (sixteenth release): the freest-editor count stops
  // charging editors for batch parents. 75 of 535 open rows were parent
  // containers, ~30 assigned, so the suggestion drifted toward whoever held
  // fewer BRIEFS. A row is a parent when another row names its issue as
  // raw_issue_parent_id; a failed parent read degrades to the uncorrected
  // count. Browser half counts identically (test/editor-count-excludes-parents).
  // One extra bounded read, no new import, file count unchanged at 5.
  // (Previous pin: 52d0f156... -- the fifteenth release, the team veto removal.)
  //
  // Re-pinned 2026-08-26 (fifteenth release): the batch team veto is gone. A
  // batch's `team` column describes its existing CHILDREN, not the teams it can
  // file, so `batch_team_mismatch` refused appends whose parents resolve
  // perfectly -- 143 of 397 active batches, two SMM reports in one day. What
  // decides now is the parent route, which was always the thing that knew.
  // Paired with migrations/2026-08-26-production-intake-append-v7.sql, which
  // must be applied BEFORE this closure is deployed. One condition removed, no
  // new import, so file count is unchanged at 5.
  // (Previous pin: e72ab6a2... -- the fourteenth release, the public item cap.)
  //
  // Re-pinned 2026-08-26 (fourteenth release): the public submission item cap.
  // MAX_PUBLIC_INTAKE_ITEMS moves 25 -> 50 after a videographer on the client
  // link was refused eleven times in 45 minutes by a limit that was 25 ITEMS
  // and therefore twelve videos, video+thumbnail sending two deliverables per
  // video. Owner instruction; still half the authenticated cap, with every
  // surrounding rate limit, the public-intake stamp and the ledger-before-work
  // ordering unchanged. Constant and comment only -- no new import, so file
  // count is unchanged at 5 and closure membership did not move.
  // (Previous pin: 0deb6b81... -- the thirteenth release, the Create Post editor picker.)
  // Re-pinned 2026-08-31 (eighteenth release): a VIDEO deliverable may carry a
  // canonical artifact -- both artifact guards test one shared ARTIFACT_TEAMS
  // set, the mirrored attachment title names the row's own team, and a creative
  // may attach on their OWN team with the confining team match untouched. Paired
  // with migrations/2026-08-30-artifact-video-projection.sql (applied
  // 2026-08-30), without which the widened guards roll every attach back on
  // artifact_card_projection_scope_invalid. No new import: file count unchanged
  // at 5, so closure membership did not move.
  //
  // This suite is the reason the miss was caught. PR #1182 moved the source
  // without moving either pin, and a pinned-closure lane that deploys an
  // unreviewed source is the one thing it exists to prevent -- so it went red on
  // main the moment the merge landed.
  // Re-pinned 2026-08-31 (nineteenth release): the `batch_asset` operation --
  // the first write path for batches.footage_folder_url and
  // delivery_folder_url. Paired with migrations/2026-08-31-batch-asset-write.sql,
  // whose absence makes the operation answer 500 write_failed. No new import:
  // file count unchanged at 5.
  // Re-pinned 2026-08-31 (twentieth release): the bound-card fallback in the
  // asset snapshot, and batch_files_read for the sub-issue file pills. Both
  // read-only, staff-only, scope-authenticated before id resolution. File count
  // unchanged at 5.
  // Re-pinned 2026-08-31 (twenty-first release): asset_access_read announces
  // ASSET_READ_CAPABILITIES so a page ahead of this deploy asks for nothing it
  // has not been offered. Read-only; file count unchanged at 5.
  // Re-pinned 2026-08-31 (twenty-second release): batch_files_read batches its
  // bound-card lookups into one query per surface. Read-only; file count
  // unchanged at 5.
  // Re-pinned 2026-08-31 (twenty-third release): the batch_asset event stops
  // carrying an `outbound` object. It never had a Linear mirror to enqueue --
  // ROLLBACK.md says so -- but that key IS the enqueue signal, so every batch
  // asset write requested a mirror intent with no authority fence and died on
  // f27_authority_generation_stale, answering 500 write_failed to three
  // separate people over two days. Fix is gateway-only: no migration, no
  // schema, no new import; file count unchanged at 5. (Shipped ahead of this
  // branch and merged as #1196; the pin below now covers it AND the release
  // beneath, which is why neither of their hashes appears here.)
  // Re-pinned 2026-08-31 (twenty-fourth release): the `component_fill`
  // operation -- the only write that can complete a card carrying half a post
  // (measured that day: 67 cards with a video and no thumbnail, 60 the
  // reverse). Allowed from the calendar and samples surfaces and refused from
  // `production`, so a component cannot be created anywhere it could be born
  // without a card. Paired with
  // migrations/2026-08-31-production-component-fill.sql, whose absence makes
  // the operation answer 500 native_write_failed. No new import: file count
  // unchanged at 5. Amended twice on the same branch before merge, for the two
  // Codex findings: the card is read and locked, and the parent route is
  // inherited from the sibling on a single-team batch. File count still 5.
  ['production-write', {
    // Re-pinned 2026-09-01 (twenty-fifth release): asset access opens across
    // teams -- staffAssetReadAllowed drops the creative team match, and
    // `attachment` moves above it beside `batch_asset`. See the workflow note
    // for the ruling and for why the filming plan is untouched. (Numbered
    // twenty-FOURTH when first written, colliding with the component_fill
    // release above; corrected so the sequence still counts releases.)
    // Amended before merge for the Codex P2: the comment above
    // CREATIVE_ASSIGNEE_BOUND_OPERATIONS still said attachment stays
    // team-bound, sitting directly above the set it describes. Comment-only
    // inside the closure, but it moves the hash, so the pin moves with it.
    // Re-pinned 2026-09-01 (twenty-sixth release): the filming plan slot falls
    // back to the CLIENT's plan when the batch column is empty -- which it is
    // for every batch not made through the intake path. Read-only, no
    // migration, and the filming plan stays unwritable at all three layers.
    // No new import: file count unchanged at 5.
    source: 'PLACEHOLDER',
    entrypoint: '7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5',
    files: 5,
  }],
]);

let failures = 0;
function ok(condition, message) {
  if (condition) console.log(`  ok  ${message}`);
  else {
    failures += 1;
    console.error(`FAIL  ${message}`);
  }
}

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)];
}

const trigger = workflow.slice(workflow.indexOf('on:'), workflow.indexOf('permissions:'));
ok(/^on:\n  workflow_dispatch:\n/m.test(trigger)
  && !/^\s{2}(?:push|pull_request|schedule):/m.test(trigger)
  && /commit_sha:[\s\S]*?required: true[\s\S]*?type: string/.test(trigger)
  && /operation:[\s\S]*?type: choice[\s\S]*?- deploy-reviewed-release\n\s*- restore-captured-prior-four/.test(trigger)
  && /confirm:[\s\S]*?required: true[\s\S]*?type: string/.test(trigger)
  && /rollback_bundle_sha256:[\s\S]*?required: true[\s\S]*?type: string/.test(trigger)
  && /rollback_bundle_byte_length:[\s\S]*?required: true[\s\S]*?type: string/.test(trigger),
'the Section 4 lane is dispatch-only with a bounded operation and mandatory reviewed-release/source-bundle inputs');

const validationAt = workflow.indexOf('- name: Validate the reviewed Section 4 release and operation');
const firstSecretAt = workflow.search(/secrets\./);
const privateFetchAt = workflow.indexOf('- name: Fetch and independently verify the sealed prior-four source');
const priorInspectAt = workflow.indexOf('- name: Inspect the exact sealed prior-four rollback set');
const releaseCheckoutAt = workflow.indexOf('- name: Check out exactly the reviewed release');
const dockerGateAt = workflow.indexOf('- name: Verify exact Supabase CLI and Docker bundler');
const providerGateAt = workflow.indexOf('- name: Bind the sealed restore provider target and CLI');
const importGateAt = workflow.indexOf('- name: Prove exact imports, lock applicability, and candidate closures');
const firstDeployAt = workflow.indexOf('supabase functions deploy linear-outbound');
const restoreAt = workflow.indexOf('node scripts/f27-edge-source-rollback.js restore');
ok(validationAt >= 0
  && validationAt < firstSecretAt
  && validationAt < privateFetchAt
  && privateFetchAt < priorInspectAt
  && priorInspectAt < releaseCheckoutAt
  && releaseCheckoutAt < dockerGateAt
  && dockerGateAt < firstDeployAt
  && providerGateAt > dockerGateAt && providerGateAt < firstDeployAt
  && importGateAt < firstDeployAt
  && privateFetchAt < restoreAt && providerGateAt < restoreAt,
'trusted-main validation, private round-trip, exact prior-set inspection, CLI/Docker, and candidate gates all precede mutation');
const priorInspectBlock = workflow.slice(priorInspectAt, releaseCheckoutAt);
const forwardGateBlock = workflow.slice(importGateAt, firstDeployAt);
ok(priorInspectBlock.includes("typeof row.verify_jwt !== 'boolean'")
  && !priorInspectBlock.includes('row.verify_jwt !== false')
  && forwardGateBlock.includes('"$F27_PRIVATE_DIR/prior-inspect.json"')
  && forwardGateBlock.includes('row.verify_jwt !== false')
  && forwardGateBlock.includes('Captured forward JWT arguments: PASS (4 at `--no-verify-jwt`)'),
'the sealed capture retains arbitrary exact JWT booleans for restore while forward deploy binds all four captured arguments to --no-verify-jwt');
ok(workflow.includes('if [ "$GITHUB_SHA" != "$current_main_sha" ]')
  && workflow.includes('if [ "$DEPLOY_COMMIT" != "$GITHUB_SHA" ]')
  && workflow.includes('git -C operator merge-base --is-ancestor "$DEPLOY_COMMIT" "$GITHUB_SHA"')
  && workflow.indexOf('if [ "$DEPLOY_COMMIT" != "$GITHUB_SHA" ]')
    < workflow.indexOf("expected_confirmation='DEPLOY_REVIEWED_F27_SECTION4_CLOSURES'")
  && workflow.indexOf('git -C operator merge-base --is-ancestor')
    < workflow.indexOf("expected_confirmation='RESTORE_CAPTURED_F27_SECTION4_CLOSURES'")
  && workflow.includes('ref: ${{ github.sha }}')
  && workflow.includes('ref: ${{ inputs.commit_sha }}')
  && workflow.includes("expected_confirmation='DEPLOY_REVIEWED_F27_SECTION4_CLOSURES'")
  && workflow.includes("expected_confirmation='RESTORE_CAPTURED_F27_SECTION4_CLOSURES'"),
'forward is bound to the trusted current-main release, while restore accepts its recorded reviewed ancestor under current trusted operator code');
ok(workflow.includes('F27_PROJECT_REF=$project_ref')
  && workflow.includes('echo "::add-mask::$project_ref"')
  && workflow.includes('assertCaptureProviderContract')
  && rollbackLibrary.includes("provider.adapter !== 'supabase-management-readback-cli-docker-deploy'")
  && rollbackLibrary.includes("provider.restore_adapter !== 'local-docker-provider-source-redeploy'")
  && rollbackLibrary.includes('provider.project_ref !== expectedProjectRef')
  && rollbackLibrary.includes('provider.supabase_cli_version !== expectedCliVersion'),
'the sealed undo is privately bound to the masked reviewed project, exact CLI, and both approved adapters before either operation mutates');

ok(/^  deploy:\n(?:    [^\n]*\n)*    environment: production\n/m.test(workflow)
  && !/^    env:\n(?:      [^\n]*\n)*      (?:SUPABASE_ACCESS_TOKEN|F27_PRIVATE_SHARED_DRIVE_ROOT_ID|TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON):/m.test(workflow)
  && occurrences(workflow, /F27_PRIVATE_SHARED_DRIVE_ROOT_ID: \$\{\{ secrets\.F27_PRIVATE_SHARED_DRIVE_ROOT_ID \}\}/g).length === 1
  && occurrences(workflow, /TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON: \$\{\{ secrets\.TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON \}\}/g).length === 1
  && occurrences(workflow, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/g).length === 6
  && validationAt < firstSecretAt,
'production credentials are protected-Environment, step-scoped, and unavailable before trusted validation');

ok(/uses: supabase\/setup-cli@v1\n\s*with:\n\s*version: 2\.109\.0/.test(workflow)
  && workflow.includes('if [ "$cli_version" != "$EXPECTED_CLI_VERSION" ]')
  && workflow.includes("docker info --format '{{.ServerVersion}}'")
  && occurrences(workflow, /--use-docker --yes/g).length === 4
  && !/--use-api/.test(workflow),
'the lane pins Supabase CLI 2.109.0 and requires Docker for every forward deployment');

const deployMatches = occurrences(workflow, /\bsupabase functions deploy ([a-z0-9-]+) \\\n/g);
ok(deployMatches.map(match => match[1]).join(',') === EXACT_SLUGS.join(',')
  && deployMatches.length === 4
  && !/supabase functions deploy "\$/.test(workflow)
  && !/for\s+(?:fn|slug)\s+in\b/.test(workflow)
  && !/function_slug:|slugs?:\n\s*description:/i.test(trigger),
'exactly four literal deploy commands exist in the mandated order, with no arbitrary slug input or deployment loop');

let serialReadbacks = true;
for (let index = 0; index < EXACT_SLUGS.length; index += 1) {
  const slug = EXACT_SLUGS[index];
  const deploy = workflow.indexOf(`supabase functions deploy ${slug}`);
  const capture = workflow.indexOf(`--slugs=${slug} \\`, deploy);
  const fingerprint = workflow.indexOf(`--slugs=${slug} --format=json`, capture);
  const nextDeploy = index + 1 < EXACT_SLUGS.length
    ? workflow.indexOf(`supabase functions deploy ${EXACT_SLUGS[index + 1]}`)
    : workflow.indexOf('- name: Verify the final exact four-function release');
  serialReadbacks = serialReadbacks
    && deploy >= 0 && capture > deploy && fingerprint > capture && nextDeploy > fingerprint
    && workflow.slice(deploy, nextDeploy).includes(`row.slug === '${slug}'`)
    && workflow.slice(deploy, nextDeploy).includes('entrypoint_match !== true')
    && workflow.slice(deploy, nextDeploy).includes('verify_jwt !== false')
    && workflow.slice(deploy, nextDeploy).includes("status !== 'ACTIVE'")
    && workflow.slice(deploy, nextDeploy).includes("!/^[0-9]+$/.test(String(captureRow.captured_version))");
}
ok(serialReadbacks,
'each literal deploy is followed by source/entrypoint/JWT/status/version readback before the next deploy can start');

const finalForwardAt = workflow.indexOf('- name: Verify the final exact four-function release');
const finalRestoreCaptureAt = workflow.indexOf('final-restored-four-capture.json');
ok(finalForwardAt > firstDeployAt
  && workflow.indexOf('--bundle="$F27_PRIVATE_DIR/final-four-live.sourcebundle"', finalForwardAt) > finalForwardAt
  && workflow.includes('String(finalCaptured.captured_version) !== String(row.version)')
  && workflow.includes('String(stepCaptured.captured_version) !== String(row.version)')
  && workflow.includes('stepLive.bundle_fingerprint !== row.bundle_fingerprint')
  && finalRestoreCaptureAt > restoreAt
  && workflow.includes('String(finalRow.captured_version) !== String(row.restored_active_version)')
  && workflow.includes('finalRow.source_closure_sha256 !== captured.source_closure_sha256')
  && workflow.includes('finalRow.entrypoint_sha256 !== captured.entrypoint_sha256')
  && workflow.includes('finalRow.verify_jwt !== captured.verify_jwt'),
'final forward and restore receipts re-capture all four and bind versions, provider/source, entrypoint, and JWT to the serial receipts');

/*
 * F51: the forward receipt must say WHAT IS RUNNING, not merely that it passed.
 *
 * It used to end at "PASS" for all four while only the restore path printed
 * per-slug versions, so after a deploy nothing attested which version of each
 * function was live. On 2026-08-05 that cost two full diagnosis cycles: an
 * unfollowed 303 on the artifact probe and an attribution stamp that proved
 * ABSENT rather than partial were both investigated against source that was
 * not the source running.
 */
{
  const forward = workflow.slice(finalForwardAt, restoreAt);
  ok(/const attestation = rows\.map/.test(forward)
    && /syncview_f27_section4_deployed_versions_v1/.test(forward),
  'the forward receipt emits a machine-readable deployed-version attestation');
  ok(/active_version/.test(forward)
    && /source_closure_sha256/.test(forward)
    && /entrypoint_sha256/.test(forward)
    && /provider_bundle_sha256/.test(forward)
    && /verify_jwt/.test(forward),
  'and it records version, source closure, entrypoint, provider bundle and JWT posture per function');
  ok(/Deployed versions/.test(forward) && /EXECUTION_LOG/.test(forward),
    'and it tells the operator where the record has to land');
  ok(!/expected_fingerprint: *row\.live_fingerprint[\s\S]{0,200}client_slug/.test(forward),
    'and it carries no client identity');
}
{
  const log = fs.readFileSync(path.join(ROOT, 'EXECUTION_LOG.md'), 'utf8');
  ok(/syncview_f27_section4_deployed_versions_v1/.test(log),
    'EXECUTION_LOG.md holds the slot the attestation is pasted into');
}

const head = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: ROOT, encoding: 'utf8', timeout: 30_000,
});
const fingerprint = spawnSync(process.execPath, [
  path.join(ROOT, 'scripts', 'ef-fingerprint.js'),
  (head.stdout || '').trim(),
  `--slugs=${EXACT_SLUGS.join(',')}`,
  '--expected-only',
  '--format=json',
], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
let currentCandidatesMatch = head.status === 0 && fingerprint.status === 0;
if (currentCandidatesMatch) {
  const receipt = JSON.parse(fingerprint.stdout);
  currentCandidatesMatch = receipt.results.length === 4 && receipt.results.every(row => {
    const expected = CANDIDATES.get(row.slug);
    return expected
      && row.expected_fingerprint === expected.source
      && row.expected_files === expected.files
      && row.expected_entrypoint === `functions/${row.slug}/index.ts`
      && workflow.includes(expected.source)
      && workflow.includes(expected.entrypoint);
  });
}
ok(currentCandidatesMatch,
`the hardcoded candidate source/file/entrypoint contracts match the exact reviewed repository closure (${(fingerprint.stderr || '').trim()})`);

const exactImport = 'npm:@supabase/supabase-js@2.49.8';
const sourceFiles = [
  'supabase/functions/_shared/b4-write.ts',
  'supabase/functions/linear-outbound/index.ts',
  'supabase/functions/production-write/index.ts',
];
const actualImportSites = sourceFiles.flatMap(file => {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return [...source.matchAll(/npm:@supabase\/supabase-js@[0-9A-Za-z.+-]+/g)]
    .map(match => [file, match[0]]);
});
const lockFiles = EXACT_SLUGS.flatMap(slug => ['deno.json', 'deno.lock']
  .map(name => path.join(ROOT, 'supabase', 'functions', slug, name)))
  .filter(file => fs.existsSync(file));
ok(JSON.stringify(actualImportSites) === JSON.stringify(sourceFiles.map(file => [file, exactImport]))
  && lockFiles.length === 0
  && workflow.includes('a Section 4 Deno config/lock appeared and needs a separately reviewed frozen-lock gate'),
'the exact 2.49.8 imports are proven and zero current lockfiles is an explicit fail-on-appearance contract');

ok(workflow.includes('--slugs=linear-outbound,production-write,deliverable-write,batch-write')
  && workflow.includes('F27_EDGE_ROLLBACK_CONFIRM: RESTORE_CAPTURED_SOURCE_SET:batch-write,deliverable-write,linear-outbound,production-write')
  && workflow.includes('--expected-bundle-sha256="$ROLLBACK_BUNDLE_SHA256"')
  && workflow.includes('--apply')
  && rollbackLibrary.includes('for (const captured of capture.functions) functions.push(await restoreOne(adapter, captured));')
  && !/Promise\.all\s*\([^)]*restore/i.test(rollbackLibrary)
  && workflow.includes("row.entrypoint_sha256 !== captured.entrypoint_sha256")
  && workflow.includes("row.verify_jwt !== captured.verify_jwt")
  && workflow.includes("row.deployed_source_readback !== 'PASS'"),
'restore consumes the exact four-function sealed capture and performs serial source/entrypoint/JWT readback without workstation dependence');

ok(!/upload-artifact/.test(workflow)
  && !/\$\{\{ vars\./.test(workflow)
  && !/\bproject_ref:\s*[a-z0-9]{20}\b/.test(workflow)
  && !/TRACK_B_BACKUP_DRIVE_FOLDER_ID/.test(workflow)
  && occurrences(workflow, /if: always\(\)/g).length === 1
  && workflow.indexOf('- name: Delete private source and raw receipts') > firstDeployAt
  && workflow.indexOf('- name: Delete private source and raw receipts') > restoreAt,
'public receipts expose only safe aggregates/hashes/versions and private files have one bounded always-cleanup step');

ok(!workflow.includes('supabase functions deploy linear-inbound')
  && !workflow.includes('supabase functions deploy production-comments')
  && !workflow.includes('supabase functions deploy production-archive')
  && !/\bsupabase functions deploy (?:calendar-upsert|sample-review-upsert)\b/.test(workflow)
  && occurrences(inboundWorkflow, /\bsupabase functions deploy\b/g).length === 1
  && inboundWorkflow.includes('supabase functions deploy linear-inbound'),
'the new lane cannot deploy inbound, frozen writers, or comment/archive readers, and the P.3 single-slug lane remains separate');

const reviewedOwnerBlock = manifestGenerator.match(/const REVIEWED_MULTI_OWNER = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
ok(reviewedOwnerBlock
  && occurrences(reviewedOwnerBlock[1], /^\s*'[^']+':/gm).map(match => match[0].trim().slice(1, -2)).sort().join(',')
    === 'linear-outbound,production-write'
  && manifestGenerator.includes('has an unreviewed multiple-workflow deploy owner set')
  && manifestGenerator.includes('is missing its exact reviewed multiple-workflow deploy owner set')
  && manifest.includes('| `batch-write` | [deploy-f27-section4]')
  && manifest.includes('| `deliverable-write` | [deploy-f27-section4]')
  && manifest.includes('| `linear-outbound` | [deploy-f27-section4]')
  && manifest.includes('[deploy-onboarding]')
  && manifest.includes('| `production-write` | [deploy-f27-section4]'),
'the generated ownership manifest permits only the two exact reviewed onboarding overlaps and rejects every other duplicate owner set');

ok(runbook.includes('This Node-only Section 1 operation, not the Section 4 deploy workflow, produces')
  && runbook.includes('four `PRIOR_*_VERSION` values')
  && runbook.includes('The Section 4 lane only')
  && runbook.includes('but needs no Docker,')
  && runbook.includes('and must finish before DDL')
  && runbook.includes('Require public `provider_contract=PASS` before')
  && runbook.includes('requires all four to be')
  && runbook.includes('Restore')
  && runbook.includes('always uses each exact captured')
  && runbook.includes('prior_four_source_bundle_sha256=')
  && runbook.includes('prior_four_source_bundle_byte_length=')
  && runbook.includes('restore accepts the recorded')
  && runbook.includes('install `RELEASE_SHA` only when it remains an ancestor')
  && runbook.includes('deploy-f27-section4-closures.yml')
  && runbook.includes('DEPLOY_REVIEWED_F27_SECTION4_CLOSURES')
  && runbook.includes('RESTORE_CAPTURED_F27_SECTION4_CLOSURES')
  && runbook.includes('must never substitute for this exact-four lane'),
'the runbook says plainly that §0/§1 prior-version capture is separate and the reviewed §4 lane is the only install deploy/restore mechanism');

if (failures) {
  console.error(`\n${failures} F27 Section 4 deploy-lane check(s) failed`);
  process.exit(1);
}
console.log('\nF27 Section 4 deploy-lane checks passed');

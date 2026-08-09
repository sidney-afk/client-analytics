'use strict';

/*
 * Locks what the daily write drill covers.
 *
 * The drill failed 22 consecutive nights (2026-07-14 .. 2026-08-04), every one
 * of them at `video_verification`, on a description round-trip that depends on
 * an undeployed Edge Function revision. Because Video runs first, Graphics was
 * never reached — so the only end-to-end proof that GRAPHICS comments and
 * status changes still flow was silently absent for three weeks.
 *
 * Two properties are enforced here:
 *   1. the blocked assertion is PARKED, not deleted — it still runs, still
 *      reports its real outcome, and re-arms with one env flag;
 *   2. a green run states what it did not prove, so coverage cannot shrink
 *      behind an unchanged `ok:true`.
 */

const fs = require('fs');
const path = require('path');
const { descriptionReadbackScopes } = require('../scripts/production-write-drill');

let failures = 0;
function ok(condition, message) {
  if (!condition) {
    console.error('FAIL production-write-drill-coverage:', message);
    failures++;
  }
}

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'production-write-drill.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'production-write-drill.yml'), 'utf8');

// --- parked, not deleted --------------------------------------------------
ok(/PRODUCTION_WRITE_DRILL_DESCRIPTION_ROUNDTRIP/.test(source),
  'the round-trip must be behind a named gate, so re-arming it is one env change');
ok(/DESCRIPTION_ROUNDTRIP_ENFORCED\s*\?/.test(source) || /if \(DESCRIPTION_ROUNDTRIP_ENFORCED\)/.test(source),
  'enforce mode must restore the blocking assertion');
ok(/await poll\([\s\S]{0,200}?readback\)/.test(source),
  'enforce mode must still be a hard poll, not a softened one');
ok(/readback[\s\S]{0,300}?DESCRIPTION_ROUNDTRIP_OBSERVE_MS/.test(source),
  'observe mode must still ATTEMPT the round-trip — parking is not deleting');
ok(/parked_pending_deploy/.test(source),
  'observe mode must record the real outcome per team rather than claiming a scope it did not prove');

// --- the assertion that still works must stay hard ------------------------
ok(/descriptionResponse\.row\.brief === description/.test(source),
  'the description gateway echo is real, working coverage and must remain a blocking assertion');

// --- a green run must be honest -------------------------------------------
ok(/parked_assertions/.test(source),
  'the report must name the assertions a green run did not make');
{
  const scopes = descriptionReadbackScopes(['video', 'graphics'], [
    { team: 'video', descriptionReadbackScope: 'parked_pending_deploy' },
    { team: 'graphics', descriptionReadbackScope: 'linear_only_authority_linear' },
  ]);
  ok(scopes.video === 'parked_pending_deploy',
    'a parked team must report as parked, not silently as verified');
  ok(scopes.graphics === 'linear_only_authority_linear',
    'a team that did prove the round-trip must still report the scope it proved');

  const missing = descriptionReadbackScopes(['video'], []);
  ok(missing.video === 'not_verified',
    'a team that never ran must report not_verified — parked and never-ran are different claims');
}

// --- the Graphics approval-artifact gate is parked, not dropped -----------
ok(/PRODUCTION_WRITE_DRILL_GRAPHICS_ARTIFACT_URL/.test(source),
  'supplying a canonical TEST artifact must restore the graphics smm_approval transition');
ok(/graphics_approval_artifact/.test(source),
  'a parked graphics approval must be named in the report, never silently skipped');
ok(/HTTP 409 code=artifact_not_resolvable/.test(source),
  'only the documented artifact refusal may be parked');
ok(/client_slug: TEST_CLIENT, file_url: GRAPHICS_ARTIFACT_URL/.test(source),
  'the attachment call must send client_slug — the gateway requires it on every production-surface operation');
ok(/graphicsArtifactRejected = classifyFailure\(error\)/.test(source),
  'a rejected owner-supplied artifact must degrade to the parked state, not fail the whole both-teams proof');
ok(/graphics_artifact_rejected/.test(source),
  'the report must say WHY an artifact URL was refused, so the owner can fix the actual mistake');
{
  // The park must be narrow: one team, one transition, one error code.
  const block = /const parkable = [\s\S]*?\n  \}/.exec(source);
  ok(block && /asset\.team === 'graphics'/.test(block[0]) && /status === 'smm_approval'/.test(block[0]),
    'the park must be scoped to the graphics smm_approval transition only');
  ok(block && /throw error;/.test(block[0]),
    'any failure other than the documented artifact refusal must still fail the drill');
}

// --- the TEST gate may only use client-scoped metrics ---------------------
/*
 * `--client` filters the deliverables and batches behind `diff_count` and
 * `repair_list_size`. It does NOT filter `linkage_actionable`, which
 * planLinkageBackfill derives from the unfiltered calendar_posts,
 * sample_reviews and allDeliverables. Gating the TEST drill on it meant the
 * drill could only pass while every client's linkage residue was zero.
 */
{
  const reconcileSrc = fs.readFileSync(path.join(root, 'scripts', 'linear-deliverables-reconcile.js'), 'utf8');
  ok(/allDeliverables: deliverables/.test(reconcileSrc),
    'the premise still holds: linkage input is the unfiltered deliverables set');
  ok(/calendarPosts: data\.calendarPosts \|\| \[\]/.test(reconcileSrc),
    'the premise still holds: linkage input is the unfiltered calendar posts');

  ok(/counts\.settled = counts\.diff_count === 0 && counts\.repair_count === 0;/.test(source),
    'the TEST gate must use only the counts --client actually scopes');
  // Narrower still: the TEST client is shared with enrollment proofs and
  // standing fixtures, so the gate is this drill's own rows, by identifier.
  ok(/--identifier=\$\{identifier\}/.test(source),
    'each drilled fixture must be reconciled by its own Linear identifier');
  ok(/settled: perFixture\.every\(row => row\.settled\)/.test(source),
    'the gate must be every drilled fixture settling, not the whole client');
  ok(/reconcile_client_scope_settled/.test(source) && /reconcile_per_fixture/.test(source),
    'the whole-client figure must still be reported as context alongside what actually gated');
  // A count says the row disagrees; the field says whether that is the parked
  // description write behaving exactly as expected, or a real write that failed.
  ok(/readDiffFields/.test(source) && /--details-json=/.test(source),
    'a per-fixture diff must be attributable to a field, not just counted');
  {
    const extractor = /function readDiffFields[\s\S]*?\n}/.exec(source);
    ok(extractor && !/expected/.test(extractor[0]) && !/\bactual\b/.test(extractor[0]),
      'the extractor must never read diff values — those are row content and this report is public');
    // `attribution_claim_mismatch` alone cost a whole drill cycle on
    // 2026-08-05: it says the stamp disagrees but not which of twelve keys
    // moved, so diagnosing it needed another TEST run. Key names are schema,
    // not row content.
    ok(extractor && /changed_claim_fields/.test(extractor[0]),
      'an attribution claim mismatch must name the fields that moved, not just that one did');
    ok(extractor && /rmSync/.test(extractor[0]),
      'the details file must be deleted after reading');
    ok(/os\.tmpdir\(\)/.test(source),
      'the details file must live outside the repository');
  }
  ok(!/linkage_actionable === 0/.test(source),
    'a whole-estate linkage figure must never gate a client-scoped TEST drill');
  ok(/reconcile_linkage_actionable/.test(source) && /linkage_scope/.test(source),
    'the linkage figure must still be reported, and labelled as whole-estate');
}

// --- both teams, every run ------------------------------------------------
ok(/PRODUCTION_WRITE_DRILL_TEAMS: video,graphics/.test(workflow),
  'the scheduled drill must cover Video and Graphics explicitly, not by relying on a default');
ok(/PRODUCTION_WRITE_DRILL_DESCRIPTION_ROUNDTRIP: observe/.test(workflow),
  'the scheduled drill must run with the round-trip parked until the Edge Function is deployed');
{
  // The loop is ordered, so a hard failure in the first team hides the second.
  // That is exactly how Graphics coverage vanished; keep the ordering visible.
  const loop = /for \(const team of DRILL_TEAMS\)[\s\S]*?reconciliation = await reconcileDrilledFixtures\(assets\)/.exec(source);
  ok(loop, 'the drill must still iterate every configured team before reconciling');
}

// --- failures must be diagnosable, without publishing a raw body ----------
{
  const { classifyFailure } = require('../scripts/production-write-drill');
  ok(/error_class/.test(source),
    'a red run must name WHICH check failed — the stage alone told 22 red runs apart not at all');
  ok(classifyFailure(new Error('video description round-trip timed out')) === 'description_roundtrip_timeout',
    'the exact failure that blocked the drill for three weeks must classify');
  ok(classifyFailure(new Error('graphics Linear comment is missing or duplicated')) === 'linear_comment_exactly_once',
    'the graphics comment-flow failure must classify — that is the check the cutover depends on');
  // A gateway rejection is the likeliest unknown, and its operation, status
  // and machine code are all public-safe — the raw body stays unpublished.
  ok(classifyFailure(new Error('production-write status HTTP 409 code=stale_row: {"ok":false}'))
    === 'production_write_status_http_409_stale_row',
    'a backend rejection must classify by operation, status and machine code');
  ok(classifyFailure(new Error('production-write comment HTTP 500: boom'))
    === 'production_write_comment_http_500',
    'a backend rejection without a machine code must still classify');
  /*
   * `artifact_not_resolvable` alone is not actionable: it covers a file that is
   * not shared, a file whose bytes never arrived, and a URL shape that was
   * refused. On 2026-08-05 that identical code came back BEFORE and AFTER a
   * deploy meant to fix it, and the report could not say which case it was —
   * so it could not distinguish "the deploy missed" from "this runtime cannot
   * reach the host the way the checker can".
   */
  ok(classifyFailure(new Error('production-write attachment HTTP 409 code=artifact_not_resolvable asset_state=permission_denied: {"ok":false}'))
    === 'production_write_attachment_http_409_artifact_not_resolvable_permission_denied',
    'an asset rejection must carry the gateway verdict, not just the code');
  ok(classifyFailure(new Error('production-write attachment HTTP 409 code=artifact_not_resolvable asset_state=unavailable: {"ok":false}'))
    === 'production_write_attachment_http_409_artifact_not_resolvable_unavailable',
    'and the verdicts must be told apart from each other');
  // Fixed vocabulary only: the state is echoed from a gateway body, so an
  // unrecognised value must be dropped rather than concatenated into a label.
  ok(classifyFailure(new Error('production-write attachment HTTP 409 code=artifact_not_resolvable asset_state=acme_corp_secret: {"ok":false}'))
    === 'production_write_attachment_http_409_artifact_not_resolvable',
    'an unrecognised asset state must be dropped, never passed through');
  // Public safety: the classifier emits a code, so an unrecognised message
  // degrades to a label rather than leaking a row route or client slug.
  const leaky = classifyFailure(new Error('Supabase REST deliverables?client=some-real-client HTTP 500'));
  ok(leaky === 'unclassified' && !String(leaky).includes('some-real-client'),
    'an unrecognised failure must degrade to a code, never carry the raw message through');
  const prose = classifyFailure(new Error('production-write status HTTP 200: {"ok":false,"error":"gated for client acme-corp"}'));
  ok(prose === 'production_write_status_http_200' && !prose.includes('acme'),
    'only a machine-shaped code may be lifted out of a response body — never prose');
  ok(!/failure\.message/.test(source.replace(/writePrivateFailure[\s\S]*?\n}/, '')),
    'the raw assertion message must not reach the public artifact or the event ledger');
  ok(/public-safe aggregate/.test(workflow),
    'the uploaded artifact must stay aggregate-only (F122)');

  /* F12's switch must be REACHABLE, not merely read.
   *
   * scripts/production-write-drill.js has read
   * PRODUCTION_WRITE_DRILL_REAL_GRAPHIC_GENERATION since the drill was written,
   * and forces `skip_graphic_generation` whenever it is unset — but the
   * workflow never passed it and declared no inputs. GitHub does not inject
   * repository variables as env, so neither the cron nor a dispatch could turn
   * real generation on, and every artifact ever produced reads
   * `graphic_generation_verified: false`. The gate was structurally
   * unsatisfiable while looking like a one-variable change, and the plan
   * written for it on 2026-07-28 would have produced another green skipped run.
   *
   * Two properties, both load-bearing:
   *   1. the workflow passes the name the script reads; and
   *   2. it defaults OFF, so the nightly lane never spends a billed provider
   *      call and only one explicitly authorized dispatch drills it.
   */
  ok(/PRODUCTION_WRITE_DRILL_REAL_GRAPHIC_GENERATION:\s*\$\{\{\s*inputs\.real_graphic_generation/.test(workflow),
    'the workflow must pass the real-generation switch the drill script reads (F12 was unsatisfiable without it)');
  ok(/real_graphic_generation:[\s\S]{0,400}?type:\s*boolean[\s\S]{0,120}?default:\s*false/.test(workflow),
    'the real-generation input must default to false, so the scheduled lane keeps skipping and never spends a billed call');
  ok(/REAL_GRAPHIC_GENERATION\s*\|\|\s*DRILL_TEAMS\.includes\('graphics'\)/.test(source),
    'real generation must still refuse to run unless the graphics team is in scope');
}

console.log(failures ? `production-write-drill-coverage: ${failures} check(s) failed` : 'production-write-drill-coverage checks passed');
process.exit(failures ? 1 : 0);

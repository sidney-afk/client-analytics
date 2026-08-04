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
{
  // The park must be narrow: one team, one transition, one error code.
  const block = /const parkable = [\s\S]*?\n  \}/.exec(source);
  ok(block && /asset\.team === 'graphics'/.test(block[0]) && /status === 'smm_approval'/.test(block[0]),
    'the park must be scoped to the graphics smm_approval transition only');
  ok(block && /throw error;/.test(block[0]),
    'any failure other than the documented artifact refusal must still fail the drill');
}

// --- both teams, every run ------------------------------------------------
ok(/PRODUCTION_WRITE_DRILL_TEAMS: video,graphics/.test(workflow),
  'the scheduled drill must cover Video and Graphics explicitly, not by relying on a default');
ok(/PRODUCTION_WRITE_DRILL_DESCRIPTION_ROUNDTRIP: observe/.test(workflow),
  'the scheduled drill must run with the round-trip parked until the Edge Function is deployed');
{
  // The loop is ordered, so a hard failure in the first team hides the second.
  // That is exactly how Graphics coverage vanished; keep the ordering visible.
  const loop = /for \(const team of DRILL_TEAMS\)[\s\S]*?reconciliation = await reconcile\(\)/.exec(source);
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
}

console.log(failures ? `production-write-drill-coverage: ${failures} check(s) failed` : 'production-write-drill-coverage checks passed');
process.exit(failures ? 1 : 0);

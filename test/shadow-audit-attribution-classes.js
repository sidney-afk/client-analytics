'use strict';
/*
 * The shadow audit must distinguish "this row predates the stamps" from "this
 * row's stamp is WRONG" — and its telemetry must say WHY, not merely how many.
 *
 * WHAT THIS FIXES (2026-08-08 reset audit).
 *
 * The production shadow audit had NEVER passed: zero green runs in its entire
 * history, ~4,100 "unexpected divergences" on every daily run since
 * 2026-07-24. The classifier was written before the attribution work landed
 * and allowlisted exactly one category, so when the reconciler's comparison —
 * which the audit reuses — began emitting `attribution_stamp_absent` for every
 * row written before stamps existed, the whole class fell into "unexpected".
 * The by-team split (video 2316 / graphics 1780 on the 2026-08-07 run) matches
 * the reconciler's own non-gating stamp counters to within the day's activity.
 *
 * A red that never changes reads as background: the count was visible in every
 * telemetry event for weeks and nobody could see, from the event, that one
 * reason explained nearly all of it — the by-reason map lived only in a
 * 14-day CI artifact. Both halves are fixed and pinned here.
 *
 * The line that must NOT move: `attribution_claim_mismatch` stays unexpected.
 * An absent stamp is history; a WRONG stamp means two writers computed
 * different ownership and one of them is lying. The labels were split on
 * 2026-08-05 exactly so this distinction could be made; folding both into the
 * allowlist would hide the drift this lane exists to catch.
 */
const path = require('node:path');
const fs = require('node:fs');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const shadowSource = fs.readFileSync(path.join(ROOT, 'scripts', 'b4-outbound-shadow-audit.js'), 'utf8');
const wrapperSource = fs.readFileSync(path.join(ROOT, 'scripts', 'production-shadow-audit.js'), 'utf8');

// --- 1. The classifier, exercised directly ----------------------------------
// classifyDiff is module-internal; extract it with its exact source so the test
// runs the real logic rather than a re-implementation.
const start = shadowSource.indexOf('function classifyDiff');
const end = shadowSource.indexOf('function classifyRepair');
ok(start > -1 && end > start, 'classifyDiff still exists ahead of classifyRepair');
const clean = value => String(value == null ? '' : value).trim();
// eslint-disable-next-line no-eval
const classifyDiff = eval(`(${shadowSource.slice(start, end).replace('function classifyDiff', 'function')})`);

const linked = new Set(['del_linked']);
const cases = [
  ['an absent stamp is expected-explainable (the ~4,100 that kept the lane red)',
    { id: 'del_x' }, { reason: 'attribution_stamp_absent' },
    'expected_explainable', 'attribution_stamp_backfill_pending'],
  ['a WRONG stamp stays unexpected — the drift this lane exists to catch',
    { id: 'del_x' }, { reason: 'attribution_claim_mismatch' },
    'unexpected', 'attribution_claim_mismatch'],
  ['sample-clamped state is still expected (the original allowlist entry)',
    { id: 'del_linked' }, { reason: 'outbound_state_mismatch', actual: 'Scheduled' },
    'expected_explainable', 'sample_clamped_state'],
  ['an ordinary state mismatch on an unlinked row is still unexpected',
    { id: 'del_x' }, { reason: 'outbound_state_mismatch', actual: 'Scheduled' },
    'unexpected', 'outbound_state_mismatch'],
  ['an unknown reason fails toward unexpected, never toward expected',
    { id: 'del_x' }, { reason: 'some_future_reason' },
    'unexpected', 'some_future_reason'],
];
for (const [label, result, diff, disposition, category] of cases) {
  const got = classifyDiff(result, diff, linked);
  ok(got.disposition === disposition && got.category === category, label);
}

// --- 2. The telemetry event must carry the by-reason maps -------------------
ok(/unexpected_divergences_by_reason: topReasons\(report\.divergences && report\.divergences\.unexpected_by_reason\)/.test(wrapperSource),
  'the event payload carries the unexpected-divergence reasons, not only the count');
ok(/unexpected_intents_by_operation: topReasons\(/.test(wrapperSource)
  && /expected_divergences_by_reason: topReasons\(/.test(wrapperSource),
'intent operations and the expected side are carried too, so a shifted classification stays visible');

// topReasons is the bound: largest first, capped, garbage-tolerant.
const tStart = wrapperSource.indexOf('function topReasons');
const tEnd = wrapperSource.indexOf('function publicPayload');
ok(tStart > -1 && tEnd > tStart, 'topReasons is defined ahead of publicPayload');
// eslint-disable-next-line no-eval
const topReasons = eval(`(${wrapperSource.slice(tStart, tEnd).replace('function topReasons', 'function')})`);
ok(JSON.stringify(topReasons({ b: 2, a: 5, c: 1 })) === JSON.stringify({ a: 5, b: 2, c: 1 }),
  'reasons are ordered largest-first, so a truncated read still sees the dominant cause');
ok(Object.keys(topReasons(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`r${i}`, i + 1])))).length === 8,
  'the map is capped at 8 entries — a pathological fan-out cannot bloat the event');
ok(JSON.stringify(topReasons(null)) === '{}' && JSON.stringify(topReasons('x')) === '{}'
  && JSON.stringify(topReasons({ a: 0, b: -1, c: 'NaN' })) === '{}',
'null, non-objects, zeros and garbage counts all collapse to an empty map rather than throwing');

// --- 2b. The unexpected-row sample names rows without leaking them ----------
// The by-reason map answered WHY (4,100 → one dominant cause); the first
// reclassified run (2026-08-09, 14 unexpected) recreated the same blindness one
// level down: a count whose members only exist in the runner-local private
// artifact. The sample must name them — and must stay bounded and stripped.
const publicPayloadFn = require(path.join(ROOT, 'scripts', 'production-shadow-audit.js')).publicPayload;
const sampled = publicPayloadFn({
  divergences: {
    unexpected: 25,
    unexpected_sample: Array.from({ length: 25 }, (_, i) => ({
      entity: 'deliverable',
      team: i % 2 ? 'video' : 'graphics',
      identifier: `XXX-${1000 + i}`,
      client_slug: 'must-not-survive',
      actual: 'must-not-survive-either',
      reasons: ['outbound_parent_mismatch'],
    })),
  },
});
ok(Array.isArray(sampled.unexpected_divergence_sample)
  && sampled.unexpected_divergence_sample.length === 20,
'the sample is capped at 20 rows — a pathological run cannot bloat the event');
ok(sampled.unexpected_divergence_sample.every(row =>
  JSON.stringify(Object.keys(row).sort()) === JSON.stringify(['entity', 'identifier', 'reasons', 'team'])),
'ONLY entity/team/identifier/reasons survive the pass-through — client slugs and field values are stripped, not forwarded');
ok(sampled.unexpected_divergence_sample[0].identifier === 'XXX-1000'
  && sampled.unexpected_divergence_sample[0].reasons[0] === 'outbound_parent_mismatch',
'identifier and reasons pass through intact — the residue is an investigable list, not a count');
ok(JSON.stringify(publicPayloadFn({ divergences: {} }).unexpected_divergence_sample) === '[]',
  'a report with no sample yields an empty list rather than throwing');
ok(/unexpectedSample\.length < 20/.test(shadowSource)
  && !/unexpectedSample\.push\(\{[^}]*client_slug/s.test(shadowSource),
'the auditor side is also bounded at 20 and never pushes a client slug into the sample');

// --- 3. The gate itself is unchanged ----------------------------------------
// Re-classification must not weaken the PASS condition: ok still requires zero
// unexpected across all three families plus the zero-write proof.
ok(/ok: n\(report\.divergences && report\.divergences\.unexpected\) === 0\s*&& n\(report\.intended_writes && report\.intended_writes\.unexpected\) === 0\s*&& n\(report\.repairs && report\.repairs\.unexpected\) === 0\s*&& zeroWrite,/.test(wrapperSource),
  'the ok gate still demands zero unexpected everywhere plus the zero-write proof — nothing was loosened');

if (failures) {
  console.error(`\n${failures} shadow-audit attribution class check(s) failed`);
  process.exit(1);
}
console.log('\nShadow audit attribution classification checks passed');

'use strict';
/*
 * The F40 readiness gate runs in CI on a PUBLIC repository, and it queries a
 * projection full of client-identifying columns. Two things about it must stay
 * true, and neither is visible by reading its output on a good day:
 *
 *   1. It never prints a client name or slug (rule F64). It has to SELECT
 *      client_slug — the browser's native-target proof requires a nonempty one —
 *      so "it doesn't fetch it" is not available as a defence. It must fetch it
 *      and never emit it.
 *   2. It stays read-only. A gate that can write is a gate that can be the
 *      outage it was built to prevent.
 *
 * It also has to keep measuring what the browser actually requires. If the two
 * proofs drift, the gate reports READY for a page that will fail.
 */
const path = require('node:path');
const fs = require('node:fs');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(ROOT, 'scripts', 'f40-workload-readiness.js'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// --- 1. No client identity may reach stdout, a log, or a summary -----------
const emitters = [...script.matchAll(/console\.(log|error)\(([\s\S]*?)\);\n/g)].map(match => match[2]);
ok(emitters.length > 0, 'the script has extractable output statements');
for (const emitter of emitters) {
  ok(!/client_slug|client_name|clientSlug|clientName/.test(emitter),
    'no output statement emits a client field: ' + emitter.replace(/\s+/g, ' ').slice(0, 72));
}
// The JSON mode prints a whole result object, so the object itself must carry
// no client field — counts and Linear identifiers only.
const resultKeys = script.slice(script.indexOf('const unprovable ='), script.indexOf('async function main'));
ok(!/client_slug|client_name/.test(resultKeys),
  'the result object the --json mode serialises contains no client field');
ok(/identifierById\.get\(id\)/.test(script),
  'samples are reported as Linear identifiers, which are not client identity');
ok(/client_slug/.test(script),
  'client_slug is still SELECTed — the native-target proof needs it, it just never leaves the process');

// --- 2. Read-only ----------------------------------------------------------
ok(!/method:\s*'(POST|PATCH|PUT|DELETE)'/i.test(script), 'the gate issues no write method');
/* Assert the property rather than a token blocklist: every request must be a
 * bare GET. A bare `upsert` substring test read the flag NAME
 * `calendar_upsert_ef_clients` as a write call — a false positive that would
 * have trained the next reader to ignore this suite. */
ok(!/\bbody\s*:/.test(script), 'no request carries a body, so nothing can be written');
const fetchCalls = [...script.matchAll(/fetch\(([\s\S]*?)\n\s*\}\);/g)].map(match => match[1]);
ok(fetchCalls.length > 0, 'the gate has extractable fetch calls');
for (const call of fetchCalls) {
  ok(!/method\s*:/.test(call), 'a fetch call specifies no method, so it is a GET');
}
ok(!/\brpc\/|\bupsert\s*\(|\.insert\(|\.update\(|\.delete\(/.test(script),
  'the gate calls no write endpoint');
ok(!/SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE/.test(script),
  'the gate never asks for the service-role key — it reads exactly what a browser can read');

// --- 3. The proof must match the browser's -------------------------------
/* wlNativeMetadataRow is the function whose failure this gate predicts. If it
 * starts requiring a field the gate does not check, the gate goes quietly
 * optimistic — which is the one failure mode a pre-flight must not have. */
const proofStart = app.indexOf('function wlNativeMetadataRow(');
ok(proofStart > -1, 'the browser proof wlNativeMetadataRow is present');
const proof = app.slice(proofStart, app.indexOf('\n    }', proofStart));
for (const [field, label] of [
  ['client_slug', 'a nonempty client slug'],
  ['updated_at', 'a valid RFC3339 cursor'],
  ['workload_labels_complete', 'a complete label relation'],
]) {
  ok(proof.includes(field) === script.includes(field),
    `the gate and the browser agree that ${label} (${field}) is part of the proof`);
}
/* The team test must be EQUALITY with the audited team, not "one of the two".
 * wlAdoptLinearMetadata rejects a target whose team differs from the mirrored
 * issue's, and wlDueWriteRoute withholds the route on the same mismatch — so a
 * mislinked or mid-move row is unprovable to the page. A membership test here
 * would call it provable and report READY for a row the page will refuse. */
ok(/String\(row\.team \|\| ''\) !== team/.test(script),
  'the gate requires the projection row to be on the audited team, not merely on a known team');
ok(!/\['video', 'graphics'\]\.includes\(String\(row\.team \|\| ''\)\)/.test(script),
  'the weaker membership test is gone, so a cross-team row cannot read as provable');
ok(/nativeTeam !== team/.test(app),
  'the browser really does reject a cross-team native target — the rule being mirrored is real');

/* The audited population must be the one the page loads. wlFetchLinearMetadata
 * filters through wlIsActiveStatus and wlIsAllowedClient before anything
 * reaches the native reader, so counting a parked or off-roster issue produces
 * a permanent nonzero reading for work no designer can see — a gate nobody can
 * satisfy, which is exactly what PRE_FLIP_HEALTH_CHECK.md exists to prevent. */
ok(/wlIsActiveStatus\(issue\)/.test(app) && /wlIsAllowedClient\(issue\.clientName\)/.test(app),
  'the browser really does apply both pre-fetch filters — the population being mirrored is real');
ok(/WL_PARKED_STATUSES/.test(script) && /WL_CLIENT_NAMES/.test(script),
  'the gate reads both filter lists out of the shipped app rather than restating them');
/* Pin the ASSIGNMENTS, not the predicates. Both predicates also appear in the
 * negated `parked`/`offRoster` lines that exist only to report the exclusions,
 * so a substring pin stayed green when the real filter was deleted. Verified by
 * mutation: removing either filter must fail here. */
ok(/const working = onTeam\.filter\(row => isActiveStatus\(row\.status_type, row\.status\)\);/.test(script),
  'the audited set is filtered to non-parked, non-terminal issues, as the page filters them');
ok(/const mine = working\.filter\(row => allowedClients\.has\(normalizeClient\(row\.client_name\)\)\);/.test(script),
  'the audited set is filtered to roster clients, as the page filters them');
ok(/const ids = \[\.\.\.new Set\(mine\./.test(script),
  'the audited ids come from the filtered set, so neither filter can be computed and then ignored');
ok(/excluded_parked_or_terminal/.test(script) && /excluded_off_roster/.test(script),
  'both exclusions are REPORTED, so the audited population is explainable rather than asserted');
/* The roster union must be a superset of the browser's allowlist: the sheet
 * half of WL_CLIENT_NAMES is unreachable from here, so erring wide keeps the
 * gate conservative. Under-reporting is the one failure a pre-flight cannot
 * have. */
ok(/CONTRACT\.seedClients\.map\(normalizeClient\)/.test(script)
  && /allowedClients\.add\(slug\)/.test(script),
'the allowlist is the union of the shipped seed and the live rosters, never one of them alone');
ok(/workload_labels_complete !== true/.test(script) && /workload_labels_complete !== true/.test(proof),
  'both use the same strict !== true test, so a null column is not read as complete');

// --- 4. The gate must actually gate ---------------------------------------
ok(/process\.exit\(1\)/.test(script), 'a nonzero unprovable count exits nonzero');
ok(/unprovable_total > 0/.test(script), 'the reporting is driven by the unprovable total, not by a sample length');

// --- 5. The floor is the OWNER'S ruling, applied where the exit code lives --
/* Before 2026-08-12 the script exited 1 (red ❌) at graphics=5, the exact state
 * the owner ruled PASS on 2026-08-11 (PRE_FLIP_HEALTH_CHECK.md item 10). A gate
 * whose symbol contradicts its own canonical ruling trains the reader to
 * discount it — on flip night, of all nights. These pins keep the floor, its
 * provenance, and the exit comparison from drifting apart. */
ok(/const ACCEPTED_FLOORS = \{ graphics: 5 \};/.test(script),
  'the graphics floor is exactly 5 — the 2026-08-11 owner ruling, no more, no less');
ok(/OWNER RULING 2026-08-11/.test(script) && /PRE_FLIP_HEALTH_CHECK\.md/.test(script),
  'the floor cites its ruling and the canonical document, so it cannot become an unexplained number');
ok(/unprovable_total > \(ACCEPTED_FLOORS\[result\.team\] \|\| 0\)/.test(script),
  'the FAILING filter compares against the floor — above it is red, at or under it is not');
ok(/GRA-4260/.test(script),
  'the floor names its five accepted identifiers, so a DIFFERENT set of 5 failures cannot hide under it by count alone (public-safe: Linear IDs only, per F64)');

if (failures) {
  console.error(`\n${failures} F40 readiness-gate source check(s) failed`);
  process.exit(1);
}
console.log('\nF40 readiness-gate source checks passed');

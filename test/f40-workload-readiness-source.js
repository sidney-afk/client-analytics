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
ok(!/\brpc\/|upsert|\.insert\(|\.update\(|\.delete\(/.test(script), 'the gate calls no write endpoint');
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
ok(/\['video', 'graphics'\]\.includes\(String\(row\.team \|\| ''\)\)/.test(script),
  'the gate requires a recognised team bucket, exactly as wlMetadataTeamBucket does');
ok(/workload_labels_complete !== true/.test(script) && /workload_labels_complete !== true/.test(proof),
  'both use the same strict !== true test, so a null column is not read as complete');

// --- 4. The gate must actually gate ---------------------------------------
ok(/process\.exit\(1\)/.test(script), 'a nonzero unprovable count exits nonzero');
ok(/unprovable_total > 0/.test(script), 'the exit is driven by the unprovable total, not by a sample length');

if (failures) {
  console.error(`\n${failures} F40 readiness-gate source check(s) failed`);
  process.exit(1);
}
console.log('\nF40 readiness-gate source checks passed');

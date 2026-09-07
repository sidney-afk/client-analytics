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
const os = require('node:os');
const vm = require('node:vm');
const { spawnSync, execFileSync } = require('node:child_process');
const { extractFunction } = require('./helpers/extract-function');

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

/* Native population ownership has changed. Preserve the historical cohort
 * assertions, but require a fail-closed CLI guard instead of pretending a
 * mirror/UUID census covers native-only work. Test the real delegated client
 * predicate, including its retained legacy branch, rather than dead code. */
const metadataReader = extractFunction(app, 'wlFetchLinearMetadata');
const nativeReader = extractFunction(app, 'wlFetchNativeSnapshot');
ok([metadataReader, nativeReader].every(body => /wlIsActiveStatus\(issue\)/.test(body) && /wlIssueClientAllowed\(issue\)/.test(body)),
  'actual readers retain active-status and authority-aware client filters');
const clientContext = { wlIsAllowedClient: name => name === 'synthetic-legacy-allowed' };
vm.createContext(clientContext);
vm.runInContext(extractFunction(app, 'wlIssueClientAllowed'), clientContext);
ok(clientContext.wlIssueClientAllowed({ workloadSource: 'native', nativeClientActive: true, clientName: 'synthetic-unmapped' }) === true,
  'native active-client membership does not require the historical name allowlist');
ok(clientContext.wlIssueClientAllowed({ workloadSource: 'native', nativeClientActive: false, clientName: 'synthetic-legacy-allowed' }) === false,
  'the legacy allowlist cannot rescue an inactive native client');
ok(clientContext.wlIssueClientAllowed({ workloadSource: 'legacy', clientName: 'synthetic-legacy-allowed' }) === true
  && clientContext.wlIssueClientAllowed({ workloadSource: 'legacy', clientName: 'synthetic-unmapped' }) === false,
  'legacy membership still enforces the original allowlist');
ok(/WL_PARKED_STATUSES/.test(script) && /WL_CLIENT_NAMES/.test(script),
  'the gate reads both filter lists out of the shipped app rather than restating them');
/* Pin the ASSIGNMENTS, not the predicates. Both predicates also appear in the
 * negated `parked`/`offRoster` lines that exist only to report the exclusions,
 * so a substring pin stayed green when the real filter was deleted. Verified by
 * mutation: removing either filter must fail here. */
ok(/const working = onTeam\.filter\(row => isActiveStatus\(row\.status_type, row\.status\)\);/.test(script),
  'the retained historical cohort excludes parked and terminal issues');
ok(/const mine = working\.filter\(row => allowedClients\.has\(normalizeClient\(row\.client_name\)\)\);/.test(script),
  'the retained historical cohort is still filtered to roster clients');
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
/* Retired 2026-08-23: the ruling's own stated basis was that the five have no
 * due date, so the only cost was losing the ability to ADD one from the Workload
 * page. Backlog then left Workload entirely, so the page stops loading them, the
 * gate stops auditing them, and they can no longer reach `unprovable_total` --
 * measured the same day at graphics 6 -> 0 and video 2 -> 0, all 8 of them
 * Backlog. What is left is an empty allowance, which is a hiding place for five
 * FUTURE failures counted against a premise that no longer exists. */
ok(/const ACCEPTED_FLOORS = \{\};/.test(script),
  'there is no accepted floor — an allowance whose members the gate no longer audits can only hide new failures');
ok(/FLOOR RETIRED 2026-08-23/.test(script),
  'and the retirement says why, so the number is not simply gone from the record');
ok(/OWNER RULING 2026-08-11/.test(script) && /PRE_FLIP_HEALTH_CHECK\.md/.test(script),
  'the floor cites its ruling and the canonical document, so it cannot become an unexplained number');
ok(/unprovable_total > \(ACCEPTED_FLOORS\[result\.team\] \|\| 0\)/.test(script),
  'the FAILING filter compares against the floor — above it is red, at or under it is not');
ok(/GRA-4260/.test(script),
  'the floor names its five accepted identifiers, so a DIFFERENT set of 5 failures cannot hide under it by count alone (public-safe: Linear IDs only, per F64)');

// --- 6. Full CLI controls, with every fetch replaced before module startup --
// The old full entry is compiled at its original path; no function is extracted
// or rewritten for that baseline. Fixture logs store only a request counter.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'f40-contract-'));
try {
  const originalPath = path.join(ROOT, 'scripts/f40-workload-readiness.js');
  const preload = path.join(scratch, 'preload.cjs');
  const calls = path.join(scratch, 'calls');
  const legacyApp = path.join(scratch, 'legacy.html');
  const baselineScript = path.join(scratch, 'baseline.cjs');
  const baselineDriver = path.join(scratch, 'baseline-driver.cjs');
  fs.writeFileSync(legacyApp, execFileSync('git', ['show', '99d31c815de3e1a46deeb01c45c09bf2937040ad:index.html'], { cwd: ROOT, maxBuffer: 8e6 }));
  // This main-ancestor file is byte-identical to the failing integration's
  // checker; avoid depending on an eventual squashed draft commit for replay.
  fs.writeFileSync(baselineScript, execFileSync('git', ['show', '99d31c815de3e1a46deeb01c45c09bf2937040ad:scripts/f40-workload-readiness.js'], { cwd: ROOT, maxBuffer: 1e6 }));
  fs.writeFileSync(preload, `const fs=require('node:fs'),path=require('node:path');
const read=fs.readFileSync.bind(fs);
if(process.env.F40_TEST_APP)fs.readFileSync=function(file,...rest){return read(path.resolve(String(file))===process.env.F40_TEST_INDEX?process.env.F40_TEST_APP:file,...rest);};
globalThis.fetch=async url=>{fs.appendFileSync(process.env.F40_TEST_CALLS,'x');
 const target=new URL(url), table=target.pathname.split('/').pop();
 if(target.hostname!=='fixture.invalid')throw Error('Non-fixture transport refused');
 let rows=[];if(table==='syncview_runtime_flags')rows=[{value:['Synthetic F40 Fixture']}];
 else if(table==='workload_issues')rows=process.env.F40_TEST_MISSING==='1'?[{id:'synthetic-f40',identifier:'F40-SYNTHETIC',team_key:'VID',team_name:'Video',client_name:'Synthetic F40 Fixture',status:'Todo',status_type:'unstarted'}]:[];
 else if(table!=='production_deliverables_browser_v1')throw Error('Unexpected fixture endpoint');
 return {ok:true,status:200,json:async()=>rows};};
`);
  fs.writeFileSync(baselineDriver, `const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');const name=process.env.F40_TEST_ORIGINAL;const entry=new Module(name,module);entry.filename=name;entry.paths=Module._nodeModulePaths(path.dirname(name));entry._compile(fs.readFileSync(process.env.F40_TEST_BASELINE,'utf8'),name);`);
  const run = (entry, extra = {}) => {
    fs.writeFileSync(calls, '');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^F40_TEST_/.test(key)));
    const result = spawnSync(process.execPath, ['--require', preload, entry, '--json', '--team=video'], {
      cwd: ROOT, env: { ...env, SUPABASE_URL: 'https://fixture.invalid', SUPABASE_ANON_KEY: 'synthetic-publishable',
        F40_TEST_CALLS: calls, F40_TEST_INDEX: path.join(ROOT, 'index.html'), F40_TEST_ORIGINAL: originalPath,
        F40_TEST_BASELINE: baselineScript, ...extra }, encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    return { ...result, calls: fs.readFileSync(calls, 'utf8').length };
  };
  const current = run(originalPath);
  ok(current.status === 2 && /UNPROVEN: F40 covers only/.test(current.stderr) && current.calls === 0,
    'actual current CLI refuses unsupported native population before every request');
  const baseline = run(baselineDriver);
  ok(baseline.status === 0 && baseline.calls > 0 && /every active sub-issue/.test(baseline.stdout),
    'exact baseline negative control falsely certifies an empty mirror on native-default source');
  const legacyEmpty = run(originalPath, { F40_TEST_APP: legacyApp });
  ok(legacyEmpty.status === 0 && legacyEmpty.calls > 0 && /every audited legacy mirror sub-issue/.test(legacyEmpty.stdout),
    'the exact older browser contract retains its historical cohort computation');
  const legacyMissing = run(originalPath, { F40_TEST_APP: legacyApp, F40_TEST_MISSING: '1' });
  ok(legacyMissing.status === 1 && /"unprovable_total": 1/.test(legacyMissing.stdout),
    'a missing legacy projection still fails against the unchanged zero floor');
} finally {
  const resolved = fs.realpathSync(scratch);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('f40-contract-')) throw new Error('Refusing cleanup outside owned temporary child');
  fs.rmSync(resolved, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} F40 readiness-gate source check(s) failed`);
  process.exit(1);
}
console.log('\nF40 readiness-gate source checks passed');

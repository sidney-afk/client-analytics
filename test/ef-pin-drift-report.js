'use strict';
/*
 * DOES EACH DEPLOY LANE'S PINNED CLOSURE DIGEST STILL NAME ITS OWN SOURCE?
 *
 * OPEN_REPAIRS 106. `test/ef-deploy-provenance.js` asserts that a deploy
 * workflow CONTAINS the expected literal strings. That is a spelling test: a
 * pin can drift arbitrarily far from the function it claims to describe and the
 * suite stays green for as long as the literal is still spelled the same way
 * somewhere in the YAML. `deploy-f27-linear-inbound.yml` had been stale since
 * `d9fbc2e7` (2026-08-30) and nothing in CI had ever said so.
 *
 * The digest is DERIVABLE -- `scripts/ef-fingerprint.js` already derives it --
 * so this suite compares rather than matches.
 *
 * WHY THIS REPORTS AND DOES NOT FAIL (yet).
 *
 * A hard gate fails the moment it is written, because the pin it first examines
 * is already stale, and the only ways to green it are to weaken the gate or to
 * move `REVIEWED_RELEASE_SHA` -- a human-review gate no agent may self-certify.
 * That is OPEN_REPAIRS 103's ordering hazard in a different costume: the
 * detector has to land WITH, or AFTER, the repair it detects. So this lands
 * first as reporting, naming every drifted lane in CI, and flips to a failure
 * in the same change that re-pins the backlog. A reporting check that names the
 * stale lanes beats a hard gate nobody can merge.
 *
 * To flip it: set HARD_GATE to true. Nothing else changes.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HARD_GATE = true;

const ROOT = path.resolve(__dirname, '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

/* Every pin that is supposed to describe the source IN THIS TREE. Keyed by the
   env var so the coverage check below can prove the table is complete. */
const PINS = [
  { workflow: 'deploy-f27-linear-inbound.yml', slug: 'linear-inbound', digestKey: 'CANDIDATE_SOURCE_SHA256', countKey: 'CANDIDATE_FILE_COUNT' },
  { workflow: 'deploy-f27-section4-closures.yml', slug: 'batch-write', digestKey: 'BATCH_WRITE_SOURCE_SHA256', countKey: 'BATCH_WRITE_FILE_COUNT' },
  { workflow: 'deploy-f27-section4-closures.yml', slug: 'deliverable-write', digestKey: 'DELIVERABLE_WRITE_SOURCE_SHA256', countKey: 'DELIVERABLE_WRITE_FILE_COUNT' },
  { workflow: 'deploy-f27-section4-closures.yml', slug: 'linear-outbound', digestKey: 'LINEAR_OUTBOUND_SOURCE_SHA256', countKey: 'LINEAR_OUTBOUND_FILE_COUNT' },
  { workflow: 'deploy-f27-section4-closures.yml', slug: 'production-write', digestKey: 'PRODUCTION_WRITE_SOURCE_SHA256', countKey: 'PRODUCTION_WRITE_FILE_COUNT' },
];

/* A ROLLBACK pin names code that is deliberately NOT in this tree -- it seals
   what was live before a release so a failed deploy can be put back. Comparing
   it against HEAD would report drift on a value that is correct precisely
   because it disagrees. Excluded by name, not by pattern, so a new rollback pin
   has to be considered rather than silently swept up. */
const NOT_TREE_PINS = new Set(['CAPTURED_V39_SOURCE_SHA256']);

let failures = 0;
const notes = [];

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures += 1; console.error('FAIL  ' + message); }
}

function readWorkflow(name) {
  return fs.readFileSync(path.join(WORKFLOWS, name), 'utf8');
}

function envValue(source, key) {
  const m = new RegExp('^\\s+' + key + ':\\s*[\'"]?([^\'"\\s#]+)', 'm').exec(source);
  return m ? m[1] : '';
}

/* ---- coverage: no pin may exist that this suite does not consider ---------- */

const declared = new Set(PINS.map(p => p.digestKey));
const unconsidered = [];
for (const file of fs.readdirSync(WORKFLOWS).filter(f => /^deploy-.*\.ya?ml$/.test(f)).sort()) {
  const source = readWorkflow(file);
  for (const m of source.matchAll(/^\s+([A-Z0-9_]*SOURCE_SHA256):/gm)) {
    const key = m[1];
    if (declared.has(key) || NOT_TREE_PINS.has(key)) continue;
    unconsidered.push(file + ' -> ' + key);
  }
}
ok(unconsidered.length === 0,
  'every closure pin in a deploy workflow is either compared here or named as a rollback pin'
  + (unconsidered.length ? ' (unconsidered: ' + unconsidered.join(', ') + ')' : ''));

/* ---- compute the real closures once, from the commit ---------------------- */

const head = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
const sha = head.status === 0 ? String(head.stdout || '').trim() : '';

/* `ef-fingerprint.js` reads with `git show`, so it describes the COMMIT and not
   the working tree. Say so when they differ rather than reporting drift the
   next commit will erase. */
const dirty = spawnSync('git', ['-C', ROOT, 'status', '--porcelain', '--', 'supabase/functions'], { encoding: 'utf8' });
const dirtyFunctions = dirty.status === 0 && String(dirty.stdout || '').trim() !== '';

const computed = new Map();
let computeError = '';
if (!/^[0-9a-f]{40}$/.test(sha)) {
  computeError = 'could not resolve HEAD to a 40-character commit SHA';
} else {
  const slugs = [...new Set(PINS.map(p => p.slug))].sort();
  const run = spawnSync(process.execPath,
    [path.join(ROOT, 'scripts', 'ef-fingerprint.js'), sha, '--slugs=' + slugs.join(','), '--expected-only'],
    { encoding: 'utf8' });
  const stdout = String(run.stdout || '');
  for (const m of stdout.matchAll(/^EXPECTED (\S+) source=([0-9a-f]{64}) files=(\d+)$/gm)) {
    computed.set(m[1], { digest: m[2], files: m[3] });
  }
  if (!computed.size) {
    computeError = 'ef-fingerprint.js produced no EXPECTED lines'
      + (run.status === 0 ? '' : ' (exit ' + run.status + ': ' + String(run.stderr || '').trim().split('\n')[0] + ')');
  }
}

/* A tree this suite cannot measure is not a tree with no drift. Reporting-only
   still prints the reason; the hard gate treats it as a failure, because a gate
   that cannot compute must not pass. */
if (computeError) {
  ok(!HARD_GATE, 'closure digests could be computed for the pinned lanes (' + computeError + ')');
  if (!HARD_GATE) notes.push('NOT MEASURED: ' + computeError);
}

/* ---- compare ------------------------------------------------------------- */

const drifted = [];
if (!computeError) {
  for (const pin of PINS) {
    const source = readWorkflow(pin.workflow);
    const pinnedDigest = envValue(source, pin.digestKey);
    const pinnedCount = envValue(source, pin.countKey);
    const real = computed.get(pin.slug);
    if (!real) {
      drifted.push({ ...pin, pinnedDigest, pinnedCount, realDigest: '(not computed)', realCount: '(not computed)' });
      continue;
    }
    if (pinnedDigest !== real.digest || pinnedCount !== real.files) {
      drifted.push({ ...pin, pinnedDigest, pinnedCount, realDigest: real.digest, realCount: real.files });
    }
  }
  for (const pin of PINS) {
    const stale = drifted.some(d => d.digestKey === pin.digestKey);
    if (!stale) console.log('  ok  ' + pin.slug + ' pin in ' + pin.workflow + ' matches its closure at HEAD');
  }
}

if (drifted.length) {
  const lines = drifted.map(d =>
    '  ' + d.slug + '  (' + d.workflow + ' ' + d.digestKey + ')\n'
    + '      pinned:   ' + d.pinnedDigest + '  files=' + d.pinnedCount + '\n'
    + '      at HEAD:  ' + d.realDigest + '  files=' + d.realCount + '\n'
    + '      re-pin:   node scripts/ef-fingerprint.js ' + sha + ' --slugs=' + d.slug + ' --expected-only');
  const banner = drifted.length + ' deploy lane pin(s) no longer describe their own source at ' + sha.slice(0, 8);
  if (HARD_GATE) {
    ok(false, banner + '\n' + lines.join('\n'));
  } else {
    notes.push('DRIFT (reporting only, see OPEN_REPAIRS 106):\n' + banner + '\n' + lines.join('\n'));
  }
}

if (dirtyFunctions) {
  notes.push('NOTE: supabase/functions has uncommitted changes; digests above describe the COMMIT, not the working tree.');
}

for (const note of notes) console.log('\n' + note);

if (failures) {
  console.error('\nEdge Function pin drift checks FAILED');
  process.exit(1);
}
console.log('\nEdge Function pin drift checks passed'
  + (drifted.length ? ' (' + drifted.length + ' lane(s) reported as drifted, not failing yet)' : ''));

'use strict';
/*
 * Linear's markdown ESCAPING must not read as a create-intent mismatch.
 *
 * THE DEFECT (measured 2026-09-15 on live issues VID-13912 and VID-13919).
 *
 * The sibling of the 2026-08-07 auto-link orphan in
 * test/linear-autolink-parent-linkage.js, and the more dangerous one, because
 * the trigger is a string SyncView writes ITSELF rather than one a user
 * happened to paste.
 *
 * The chain, established from live data:
 *   1. A batch created with no filming plan gets the app's own template
 *      description: "[SyncView] FILMING PLAN MISSING - ...".
 *   2. Linear escapes the markdown-significant brackets when it stores the
 *      issue, and hands back "\[SyncView\] FILMING PLAN MISSING - ...".
 *   3. Post-create verification byte-compared sent vs kept, saw a difference it
 *      had not made, and recorded a `description` mismatch.
 *   4. The outbox row terminalized as `idempotency_conflict`, so
 *      `applyCreateLinkage` never ran and the issue sat in Linear owned by
 *      nobody. The children skipped with `parent_create_idempotency_conflict`.
 *
 * WHAT MAKES IT WORSE THAN THE AUTO-LINK CASE, and what this suite pins:
 * verification reads back after EVERY create, so this fires on the FIRST
 * attempt. It is not retry damage. Recreating the post by hand reproduced it in
 * seventeen seconds and produced a second orphan. A batch whose description was
 * a bare filming-plan URL passed in the same minute, which isolated the cause
 * to the character class rather than to the outage that surfaced it.
 */
const fs = require('node:fs');
const path = require('node:path');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..', 'supabase', 'functions', 'linear-outbound');
const mappingSource = fs.readFileSync(path.join(ROOT, 'mapping.mjs'), 'utf8');

(async () => {
  const mapping = await import(require('node:url').pathToFileURL(path.join(ROOT, 'mapping.mjs')).href
    + '?description-escape-test');
  const { collapseLinearEscapes, canonicalLinearDescription, decideConflict } = mapping;

  // --- 1. The exact live strings that produced the orphans ------------------
  const SENT = '[SyncView] FILMING PLAN MISSING - submission accepted; SMM follow-up required.';
  const KEPT = '\\[SyncView\\] FILMING PLAN MISSING - submission accepted; SMM follow-up required.';

  // The defect condition itself, so this suite evidences the bug and not only
  // the fix: the raw comparison the code used to perform DOES differ, on the
  // exact strings read back from VID-13912.
  ok(KEPT !== SENT,
    'PRE-FIX BEHAVIOUR: a raw byte comparison of sent vs kept DOES differ — the false mismatch that orphaned VID-13912');
  ok(canonicalLinearDescription(KEPT) === canonicalLinearDescription(SENT),
    "Linear's escaped form of the app's own template compares equal to what we sent (the live orphan string)");
  ok(collapseLinearEscapes(KEPT) === SENT,
    'the escaped form collapses back to the exact original text');

  // --- 2. It must stay narrow ----------------------------------------------
  ok(collapseLinearEscapes('a \\\\ b') === 'a \\ b',
    'an escaped backslash collapses to one backslash');
  ok(collapseLinearEscapes('C:\\path\\to\\file') === 'C:\\path\\to\\file',
    'a backslash before a LETTER is not an escape and is left untouched');
  ok(collapseLinearEscapes('plain text') === 'plain text'
    && collapseLinearEscapes('') === ''
    && collapseLinearEscapes(null) === null
    && collapseLinearEscapes(undefined) === undefined,
  'plain text, empty, null and undefined pass through unchanged');
  ok(canonicalLinearDescription('one [a] two') !== canonicalLinearDescription('one [b] two'),
    'two genuinely different descriptions still compare as different (create idempotency is not weakened)');

  // --- 3. Composed with the auto-link collapse, in that order ---------------
  const PLAN = 'https://docs.google.com/document/d/1u9JPDZomzUD1pWHMDi5n2wSjGjni0CeNSv1TCQnOycI/edit';
  ok(canonicalLinearDescription(`Filming Plan: [${PLAN}](<${PLAN}>)`) === `Filming Plan: ${PLAN}`,
    'the auto-link case still collapses through the composed normalizer (no regression on the 2026-08-07 fix)');
  ok(canonicalLinearDescription(`\\[SyncView\\] see [${PLAN}](<${PLAN}>)`) === `[SyncView] see ${PLAN}`,
    'an escaped bracket and an auto-link in one description both normalize');

  // --- 4. decideConflict itself must accept the live case -------------------
  const context = { team_id: 'team-1', project_id: 'proj-1', state_id: 'state-1' };
  const row = {
    operation: 'create',
    payload: { title: 'Example Client · 15 Sept 2026', description: SENT, project_id: 'proj-1', status: 'todo' },
  };
  const keptIssue = {
    team: { id: 'team-1' },
    project: { id: 'proj-1' },
    title: 'Example Client · 15 Sept 2026',
    description: KEPT,
    state: { id: 'state-1' },
  };
  const verdict = decideConflict(row, keptIssue, context);
  ok(verdict.decision === 'already_exists',
    'decideConflict ADOPTS the issue Linear escaped, instead of orphaning it (decision: ' + verdict.decision + ')');
  ok(!(verdict.mismatched_fields || []).includes('description'),
    'no description mismatch is reported for Linear\'s own escaping');

  // A genuinely foreign description must still refuse adoption.
  const foreign = { ...keptIssue, description: 'someone else wrote this' };
  const foreignVerdict = decideConflict(row, foreign, context);
  ok(foreignVerdict.decision === 'idempotency_conflict'
    && (foreignVerdict.mismatched_fields || []).includes('description'),
  'a genuinely different description still refuses adoption (the gate is not disarmed)');

  // --- 5. The comparison must use the composed normalizer -------------------
  ok(/canonicalLinearDescription\(actualDescription\)\s*!==\s*canonicalLinearDescription\(expectedDescription\)/
    .test(mappingSource),
  'createIntentMismatches compares descriptions through the composed normalizer on BOTH sides');

  if (failures) {
    console.error(`\n${failures} Linear description-escape check(s) failed`);
    process.exit(1);
  }
  console.log('\nLinear description-escape checks passed');
})().catch(error => { console.error(error); process.exit(1); });

'use strict';
/*
 * Linear's URL auto-linking must not read as a create-intent mismatch, and a
 * create that declared a parent dependency must never be sent without a parent.
 *
 * THE DEFECT (2026-08-07; live for five days, since the 2026-08-02 deploy).
 *
 * Calendar "Create Post" on the gateway lane creates a batch parent and a child
 * in Linear. Every such child came out UNPARENTED — floating at the top level of
 * the project instead of nested under its batch.
 *
 * The chain, established from live data:
 *   1. The parent's description carries the filming-plan link as a BARE URL.
 *   2. Linear stores it as its own auto-link form, `[URL](<URL>)`. Verified on
 *      the live issue: we sent `Filming Plan: https://docs.google.com/...` and
 *      Linear kept `Filming Plan: [https://docs.google.com/...](<https://...>)`.
 *   3. Post-create verification byte-compared sent vs kept, saw a difference it
 *      had not made, and recorded a `description` mismatch.
 *   4. The parent's outbox row therefore terminalized as an idempotency conflict
 *      rather than `written`, even though the issue existed in Linear.
 *   5. `applyCreateLinkage` never ran, so `batches.linear_parent_ids` stayed null
 *      and the dependency envelope carried no issue id.
 *   6. The child resolved an EMPTY parent and was created at top level — the
 *      guard that should have refused was gated on `planned_linear_issue_id`,
 *      which intake children do not carry.
 *
 * Five days of green daily drills missed it because the drill asserts the issues
 * EXIST and never that they are NESTED — the same shape as the monitor that
 * reads a heartbeat and never the ok flag it stores.
 *
 * Both halves are guarded here. They must ship together: the fail-closed guard
 * alone would turn silent mis-nesting into a hard failure of every Create Post.
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
const indexSource = fs.readFileSync(path.join(ROOT, 'index.ts'), 'utf8');

(async () => {
  const mapping = await import(require('node:url').pathToFileURL(path.join(ROOT, 'mapping.mjs')).href
    + '?autolink-test');
  const { collapseLinearAutolinks } = mapping;

  // --- 1. The exact live string that caused the outage ----------------------
  const PLAN = 'https://docs.google.com/document/d/161ZA_D9fwihCiYD3yR9kLNYMsZgRqO0xx_mniY_Q_kA/edit';
  const sent = `Filming Plan: ${PLAN}`;
  const kept = `Filming Plan: [${PLAN}](<${PLAN}>)`;
  // The defect condition itself, asserted directly so this suite evidences the
  // bug rather than merely the fix: the RAW comparison the code used to perform
  // does differ, on the exact strings taken from the live issue.
  ok(kept !== sent,
    'PRE-FIX BEHAVIOUR: a raw byte comparison of sent vs kept DOES differ — the false mismatch that caused the outage');
  ok(collapseLinearAutolinks(kept) === collapseLinearAutolinks(sent),
    "Linear's auto-linked form of a bare URL compares equal to what we sent (the live outage string)");
  ok(collapseLinearAutolinks(kept) === sent,
    'the auto-link collapses back to the exact original text');

  // --- 2. It must stay narrow: a REAL markdown link is not a mismatch to hide
  const realLink = `see [the filming plan](<${PLAN}>)`;
  ok(collapseLinearAutolinks(realLink) === realLink,
    'a genuine markdown link whose label differs from its target is left untouched');
  ok(collapseLinearAutolinks(`[one](<${PLAN}>)`) !== collapseLinearAutolinks(`[two](<${PLAN}>)`),
    'two different link labels still compare as different (create idempotency is not weakened)');
  ok(collapseLinearAutolinks('plain text') === 'plain text'
    && collapseLinearAutolinks('') === ''
    && collapseLinearAutolinks(null) === null
    && collapseLinearAutolinks(undefined) === undefined,
  'plain text, empty, null and undefined pass through unchanged');

  // --- 3. Multiple links in one description ---------------------------------
  const two = `A: [${PLAN}](<${PLAN}>) and B: [http://x.test](<http://x.test>)`;
  ok(collapseLinearAutolinks(two) === `A: ${PLAN} and B: http://x.test`,
    'every auto-link in a description is collapsed, not just the first');

  // --- 4. The comparison itself must use it ---------------------------------
  ok(/collapseLinearAutolinks\(actualDescription\)\s*!==\s*collapseLinearAutolinks\(expectedDescription\)/
    .test(mappingSource),
  'createIntentMismatches compares descriptions through the normalizer on BOTH sides');

  // --- 5. The fail-closed guard ---------------------------------------------
  ok(/outbound_parent_dependency_unresolved/.test(indexSource),
    'a create that resolved no parent throws instead of silently creating an orphan');
  const guard = indexSource.slice(
    indexSource.indexOf('const context = await resolveContext'),
    indexSource.indexOf('outbound_parent_dependency_unresolved') + 60);
  ok(/row\.operation === "create"/.test(guard)
    && /Number\(row\.depends_on_id \|\| 0\) > 0/.test(guard),
  'the guard fires only for creates that actually declared a dependency');
  ok(/!clean\(parseJson\(row\.payload\)\.parent_linear_issue_id\)/.test(guard),
    'a create using the DIRECT parent route (parent id in the payload) is never blocked');
  ok(guard.indexOf('outbound_parent_dependency_unresolved') > guard.indexOf('resolveContext'),
    'the guard runs after the parent has had its chance to resolve, not before');

  // --- 6. Both halves must ship together ------------------------------------
  ok(/collapseLinearAutolinks/.test(mappingSource) && /outbound_parent_dependency_unresolved/.test(indexSource),
    'normalization and fail-closed guard are both present (shipping the guard alone breaks every Create Post)');

  if (failures) {
    console.error(`\n${failures} Linear autolink / parent-linkage check(s) failed`);
    process.exit(1);
  }
  console.log('\nLinear autolink + parent linkage checks passed');
})().catch(error => { console.error(error); process.exit(1); });

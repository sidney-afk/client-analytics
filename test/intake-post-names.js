'use strict';

/*
 * intake-post-names.js — naming the batch and naming the sub-issues.
 *
 * Owner request 2026-09-07: "when they create a new batch, they should be able
 * to choose the name, which would change the name in sync linear ... so that
 * will be the name of the parent issue and if they add to a previous batch so
 * they will be adding a sub-issue they should be able to name that sub-issue
 * also."
 *
 * Two halves, and only one of them was a code change everywhere:
 *
 *   BATCH NAME -> the Linear PARENT title. `batch.name` has always travelled
 *   from the browser to `batches.name` and on into the parent create payload
 *   verbatim, so this half is a dialog change and nothing else. What is pinned
 *   here is that the dialog still falls back to the generated title, because an
 *   SMM who clears the box must not create a nameless parent.
 *
 *   POST NAME -> a SUFFIX on both sub-issue titles: 'Video 4 — Launch hook'
 *   and 'Thumbnail 4 — Launch hook'. Three layers had the old exact shape
 *   built in (browser, gateway, RPC) and all three had to learn the suffix.
 *
 * WHY A SUFFIX rather than a free-form title, which is the thing this suite
 * exists to stop anyone from "simplifying" it into:
 *
 *   1. THE NUMBER IS THE ONLY RECORD OF THE ORDINAL. `deliverables` has no
 *      column for it. planAppendIntakeItems and production_intake_append both
 *      re-derive the next number by reading it back out of the titles already
 *      in the batch. Erase it and the next append reissues a used number --
 *      which is exercised below, not merely asserted.
 *   2. THE KIND HAS TO STAY VISIBLE. Owner ruling 2026-08-17: the graphics
 *      child used to read `Video N` like its sibling and he read his own test
 *      post as "two video sub-issues". One typed name becoming both titles
 *      rebuilds exactly that.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const vm = require('vm');
/* Comments in these functions legitimately NAME the thing they avoid calling
   ("a surgical rebuild rather than _calRenderNativePostChoice()"), so the
   avoidance assertions below read code with the prose stripped out. The house
   helper, not the raw regex OPEN_REPAIRS 145 is about: that one opens a
   comment at any "/" + "*", a glob or a MIME type included, and deletes to the
   next closing delimiter anywhere in the file -- which turns a negative
   assertion into one that passes because its subject was erased. */
const { stripComments } = require('./helpers/strip-comments.js');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const source = read('index.html');
const edge = read('supabase/functions/production-write/index.ts');
const policySource = read('supabase/functions/production-write/policy.mjs');
const migration = read('migrations/2026-09-07-production-intake-append-v8.sql');
const v7 = read('migrations/2026-08-26-production-intake-append-v7.sql');

let failures = 0;
function ok(condition, label) {
  if (condition) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

// Comment-aware brace matcher, same shape as test/native-intake-ui-source.js.
function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (comment === 'line') { if (ch === '\n') comment = ''; continue; }
    if (comment === 'block') { if (ch === '*' && next === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { comment = 'line'; i++; continue; }
    if (ch === '/' && next === '*') { comment = 'block'; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

(async () => {
  const policy = await import(pathToFileURL(path.join(
    ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs',
  )).href);

  /* ---- 1. The composer ------------------------------------------------- */

  ok(policy.intakeChildTitle('calendar', 'video', 4, 'Launch hook') === 'Video 4 — Launch hook'
    && policy.intakeChildTitle('calendar', 'graphics', 4, 'Launch hook') === 'Thumbnail 4 — Launch hook',
  'a named post keeps its kind and number in front of the name');
  ok(policy.intakeChildTitle('calendar', 'video', 4, '') === 'Video 4'
    && policy.intakeChildTitle('calendar', 'graphics', 4, '   ') === 'Thumbnail 4',
  'an unnamed post is titled exactly as it was before naming existed');
  ok(policy.intakeChildTitle('samples', 'video', 4, 'Launch hook') === 'Sample Video 4 — Launch hook'
    && policy.intakeChildTitle('samples', 'graphics', 4, '') === 'Sample Thumbnail 4',
  'the samples prefix rides the batch purpose and survives a name (2026-08-19 ruling)');
  ok(policy.intakeChildName('  Launch \n  hook  ') === 'Launch hook',
    'a name pasted out of a filming plan is flattened rather than refused');

  /* ---- 2. Reading the ordinal back out --------------------------------- */
  /* This is the load-bearing half. Every one of these titles has consumed its
     number, and a reader that cannot see that hands the number out twice. */

  const parts = title => policy.intakeTitleParts(title);
  ok(parts('Video 4').ordinal === 4 && parts('Video 4').name === ''
    && parts('Video 4 — Launch hook').ordinal === 4
    && parts('Video 4 — Launch hook').name === 'Launch hook'
    && parts('Sample Thumbnail 12 — a — b').ordinal === 12
    && parts('Sample Thumbnail 12 — a — b').name === 'a — b',
  'a named title still yields its ordinal, and the name may itself contain the separator');
  ok(parts('Video 02') === null && parts('Client Name | Jun. 29 - Jul. 5 | Reel 4') === null
    && parts('Video 4 — ') === null && parts('Video 4 —') === null,
  'a zero-padded number, a Linear-era human title and a bare trailing separator are all NOT ours');

  /* ---- 3. The number is never reissued --------------------------------- */

  const named = [
    { id: 'a-v', team: 'video', card_id: 'card-a', title: 'Video 1 — First', sort_key: 0 },
    { id: 'a-g', team: 'graphics', card_id: 'card-a', title: 'Thumbnail 1 — First', sort_key: 0 },
  ];
  const afterNamed = policy.planAppendIntakeItems(named, [
    { team: 'video', card_id: 'card-b' },
    { team: 'graphics', card_id: 'card-b' },
  ], ['b-v', 'b-g'], 'calendar');
  ok(afterNamed[0]._intake_ordinal === 2 && afterNamed[0].title === 'Video 2'
    && afterNamed[1].title === 'Thumbnail 2',
  'THE REGRESSION THIS GUARDS: appending after a NAMED post allocates 2, not 1');

  const mixed = policy.planAppendIntakeItems(named.concat([
    { id: 'b-v', team: 'video', card_id: 'card-b', title: 'Video 2', sort_key: 1 },
  ]), [{ team: 'video', card_id: 'card-c', name: 'Third' }], ['c-v'], 'calendar');
  ok(mixed[0]._intake_ordinal === 3 && mixed[0].title === 'Video 3 — Third',
    'named and unnamed rows share one ascending sequence');

  /* ---- 4. One name per CARD, never per team ---------------------------- */
  /* A post is one card and two sub-issues. A name on only one half reads as
     two unrelated pieces of work, which is the 2026-08-17 complaint again. */

  const halfNamed = policy.planAppendIntakeItems(named, [
    { team: 'video', card_id: 'card-b', name: 'Launch hook' },
    { team: 'graphics', card_id: 'card-b' },
  ], ['b-v', 'b-g'], 'calendar');
  ok(halfNamed[0].title === 'Video 2 — Launch hook'
    && halfNamed[1].title === 'Thumbnail 2 — Launch hook',
  'naming one half of a post names the pair');
  ok(/intakeNameByCard/.test(edge)
    && /if \(!intakeNameByCard\.has\(cardKey\)\) intakeNameByCard\.set\(cardKey, named\)/.test(edge),
  'the create path resolves the same one-name-per-card rule before it builds any row');

  /* ---- 5. A filled-in second half inherits the name -------------------- */

  ok(policy.componentFillTitle('Video 4 — Launch hook', 'graphics', 'calendar') === 'Thumbnail 4 — Launch hook'
    && policy.componentFillTitle('Thumbnail 4 — Launch hook', 'video', 'samples') === 'Sample Video 4 — Launch hook',
  'component_fill carries the name to the half it creates');
  ok(policy.componentFillTitle('Video 6 - Before Coming To Us', 'graphics', 'calendar')
      === 'Video 6 - Before Coming To Us',
  'a hyphen is not the separator, so a Linear-era human title still mirrors verbatim');

  /* ---- 6. The two layers agree on the separator and the cap ------------ */
  /* A drift here is silent and expensive: the browser would compose or verify
     one shape while the gateway counted another, and every named title would
     stop advancing the ordinal. */

  const browserSeparator = /const CAL_NATIVE_TITLE_SEPARATOR = '([^']*)';/.exec(source);
  const browserMax = /const CAL_NATIVE_NAME_MAX = (\d+);/.exec(source);
  ok(!!browserSeparator && browserSeparator[1] === policy.INTAKE_TITLE_SEPARATOR,
    'index.html and policy.mjs use the same separator');
  ok(!!browserMax && Number(browserMax[1]) === policy.INTAKE_NAME_MAX,
    'index.html and policy.mjs cap the name at the same length');
  ok(/INTAKE_TITLE_SEPARATOR \+ "\(\.\+\)\)\?\$"/.test(policySource)
    && !/Video\|Thumbnail\) \(\[1-9\]\[0-9\]\*\) — /.test(policySource),
  'the title regex is BUILT from the separator constant rather than restating it');

  /* ---- 7. The gateway refuses rather than truncates --------------------- */

  ok(/intakeChildName\(item\.name\)\.length > INTAKE_NAME_MAX/.test(edge)
    && /invalid_intake_item_name/.test(edge),
  'an over-long name is refused with its own code, never silently shortened');
  ok(/const title = appendToBatch\s*\n(?:\s*\/\*[\s\S]*?\*\/\s*\n)?\s*\? clean\(item\.title\)/.test(edge),
    'on an append the gateway trusts the title planAppendIntakeItems already composed');
  ok(/\? intakeChildTitle\(intakePurpose, team, videoNumber, intakeName\)/.test(edge)
    && /: \(team === "graphics" \? `\$\{intakeTitlePrefix\}Thumbnail \$\{videoNumber\}` : clean\(item\.title\) \|\| fallbackTitle\)/.test(edge),
  'an UNNAMED create takes the byte-identical path it took before naming existed');

  /* ---- 8. The RPC ------------------------------------------------------ */
  /* v8 widens exactly two predicates. Everything that protects the batch --
     ordinal, sort key, card pairing, team vocabulary, parents, dedup -- is
     untouched, and this suite fails if the file grows a schema change. */

  ok(/\^\(\?:Sample \)\?\(\?:Video\|Thumbnail\) \(\[1-9\]\[0-9\]\*\)\(\?: — \.\+\)\?\$/.test(migration)
    && /and d\.title ~ '\^\(\?:Sample \)\?\(\?:Video\|Thumbnail\) \[1-9\]\[0-9\]\*\(\?: — \.\+\)\?\$'/.test(migration),
  'v8 counts a NAMED child toward the next ordinal');
  ok(/\|\| ' — _%'/.test(migration),
    'and the suffix it accepts must be non-empty -- a bare trailing separator is still refused');
  ok(/invalid_intake_append_order/.test(migration)
    && /_intake_ordinal'\)::integer is distinct from v_expected_ordinal/.test(migration)
    && /invalid_intake_append_pair/.test(migration)
    && /production_batch_parent_ids_for_team/.test(migration)
    && /raise exception 'write_conflict'/.test(migration),
  'every ordering, pairing, parent and CAS guard v7 carried is still there');
  ok(!/\balter table\b|\bcreate table\b|\bdrop (table|column|policy)\b/i.test(migration)
    && !/syncview_runtime_flags|prod_authority\s*=|linear_outbound_enabled\s*=/.test(migration),
  'v8 moves no table, column or runtime flag');
  ok(/SUPERSEDES migrations\/2026-08-26-production-intake-append-v7\.sql/.test(migration),
    'v8 names what it supersedes');

  /* ---- 8b. THE ROLLBACK BLOCK IS SAFE FROM ITS FIRST LINE ---------------- */
  /*
   * Codex raised this twice on #1340, and the second time was because of how
   * the first fix was written. The correction ("do not re-run v7") had been
   * APPENDED BELOW a "Re-run v7 ... and redeploy the prior Edge version"
   * instruction that still stood at the top of the block -- so an operator
   * reading top-down follows the unsafe path several paragraphs before
   * reaching the warning. A warning under the fold is not a fix.
   *
   * The first assertion here was also vacuous: it searched the WHOLE file for
   * `DO NOT RE-RUN v7`, which passed happily while the instruction it was
   * meant to retire sat above it. These read the block itself, and where in
   * it each thing appears.
   */
  const rollbackBlock = migration.slice(migration.indexOf('-- OWNER-ONLY ROLLBACK'));
  ok(/^-- OWNER-ONLY ROLLBACK: ROLL THE GATEWAY BACK\. DO NOT RE-RUN v7\./m.test(rollbackBlock),
    'the block states the safe procedure in its own heading, where a reader cannot miss it');
  ok(!/\bRe-run v7\b/.test(rollbackBlock) && !/\bRe-run v6\b/.test(rollbackBlock),
    'and carries no surviving imperative to re-run an older RPC version');
  ok(rollbackBlock.indexOf('Restore `production-write`') < rollbackBlock.indexOf('HISTORY, NOT AN INSTRUCTION')
    && rollbackBlock.indexOf('Restore `production-write`') < rollbackBlock.indexOf('UNSAFE DIRECTION'),
  'the procedure comes FIRST -- before the rationale and before the history, which is what the second finding was about');
  ok(/LEAVE THIS MIGRATION APPLIED/.test(rollbackBlock)
    && /backward compatible with the older gateway/.test(rollbackBlock),
  'and it says v8 stays applied, with the reason a v68 gateway runs correctly in front of it');
  ok(!/\(\?: — \.\+\)\?/.test(v7),
    'and v7 genuinely lacks the suffix, so the migration is required rather than cosmetic');

  /* ---- 9. The dialog --------------------------------------------------- */

  const choice = extract('_calRenderNativePostChoice');
  const setName = extract('_calSetNativePostName');
  const setBatchName = extract('_calSetNativeBatchName');
  const setCount = extract('_calSetNativePostCount');
  const namesFor = extract('_calNativePostNamesFor');
  const items = extract('_linearIntakeItems');
  const submit = extract('_calSubmitNativePost');

  ok(choice.includes('id="calNativePostNames"')
    && choice.includes('_calNativePostNamesHtml(state, postCount, mode)')
    && choice.includes('id="calNativeBatchName"'),
  'the dialog renders a name field per post and one for the new batch');
  ok(/oninput="_calSetNativePostName\(\$\{index\}, this\.value\)"/.test(extract('_calNativePostNamesHtml')),
    'every post gets its own field rather than one shared name');
  /* A keystroke must not re-render: _calRenderNativePostChoice rebuilds the
     whole modal body, which drops focus and the caret. Both setters are state
     only, and the count stepper rebuilds ONLY the list. */
  ok(!stripComments(setName, ' ').includes('_calRenderNativePostChoice')
    && !stripComments(setBatchName, ' ').includes('_calRenderNativePostChoice'),
  'typing a name never re-renders the dialog out from under the caret');
  ok(setCount.includes("document.getElementById('calNativePostNames')")
    && setCount.includes('_calNativePostNamesHtml(state, state.postCount, mode)')
    && !stripComments(setCount, ' ').includes('_calRenderNativePostChoice'),
  'stepping the count rebuilds only the name list, so a held-down stepper cannot throw the dialog away');
  ok(namesFor.includes('state.postNames') && namesFor.includes('_calNativeCleanName'),
    'names live in state, so stepping 3 -> 1 -> 3 gives the third name back');
  ok(choice.includes('onmousedown="_calNativeNewBatchPick(); event.stopPropagation();"')
    && choice.includes('onfocus="_calNativeNewBatchPick()"'),
  'typing a batch name selects the new-batch card, which a <label> does not do for an input');

  /* The samples parent must still say it is a sample (owner 2026-08-19). A
     typed name would drop the marker the generated title carries, so the
     resolver puts it back -- otherwise this change would quietly undo a ruling
     nobody asked to revisit. */
  const nameFor = extract('_calNativeBatchNameFor');
  ok(/surface === 'sxr' && !\/sample\/i\.test\(typed\)/.test(nameFor)
    && nameFor.includes("typed + ' · Samples'"),
  'a typed SAMPLES batch name still says Samples, and a name that already does is left alone');

  ok(items.includes('const postName = String(video && video.name || \'\').trim()')
    && items.includes('...(postName ? { name: postName } : {})'),
  'the name rides BOTH halves of the post to the gateway, and nothing is added when there is none');
  ok(submit.includes('const postNames = _calNativePostNamesFor(state, postCount);')
    && submit.includes('post_names: postNames, batch_name:'),
  'the names are part of the intent signature, so a saved job cannot resume under a different name');
  ok(submit.includes('const namesLanded = !askedNames.length || askedNames.every(name =>')
    && submit.includes("title.endsWith(CAL_NATIVE_TITLE_SEPARATOR + name)")
    && /but the names were not applied/.test(submit),
  'the dialog checks the response and says so out loud when a name did not land');
  /* And it prescribes NOTHING the reader could act on wrongly. Codex caught
     "rename in Linear" on #1336: both teams are SyncView-authoritative, so
     linear-inbound takes its detect-only branch and returns BEFORE the title
     write -- the rename never reaches `deliverables.title`, the column this
     surface reads -- and `production-write` has no title operation either, so
     there is no SyncView-side rename to point at instead. */
  /* Read the CODE, not the prose: the comment above the check in index.html
     explains the mistake by quoting it, and an explanation is not a use --
     the same distinction test/comment-strip-is-honest.js draws about itself. */
  ok(!/[Rr]ename in Linear|\bLinear\b[^']{0,40}rename/i.test(stripComments(submit, ' ')),
    'and it never sends the reader to a rename that cannot reach the row');

  console.log(failures === 0
    ? '\nintake post-name checks passed'
    : '\n' + failures + ' intake post-name check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
})();

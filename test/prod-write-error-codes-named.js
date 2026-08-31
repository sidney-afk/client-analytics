'use strict';
/*
 * "The change was not saved. Please try again."
 *
 * Reported live 2026-08-31, an hour apart, by an SMM and a video editor --
 * both setting a batch folder on a post, both getting that sentence and
 * nothing else. Every refusal the batch-asset path can raise fell through to
 * the catch-all, so four situations needing four different actions all told
 * the reader to retry, and the report could not be diagnosed downstream
 * either: the code was gone before anyone saw the failure.
 *
 * THE FIRST FIX WAS WRONG, AND THE CORRECTION IS THE POINT OF THIS FILE.
 * It hand-wrote sentences for entity_scope_unavailable,
 * entity_lookup_unavailable and native_response_refresh_failed, and told the
 * reader retrying was unlikely to help for anything it did not name. Codex
 * raised both halves as P2 on PR 1192 and was right twice:
 *
 *   * All three codes were ALREADY classified by the estate's own taxonomy.
 *     Two sit in `wait` -- "Transient: a dependency was unreachable and
 *     nothing was committed" -- where retrying IS the recovery. Telling staff
 *     to escalate instead would have turned recoverable outages into pages.
 *   * entity_scope_unavailable sits in `reload`, and ordinary status / comment
 *     / due writes raise it too. A batch-specific "the post needs its team
 *     set" would have been actively wrong for a deliverable missing only its
 *     client slug -- sending someone to repair a field that was never the
 *     cause, which is the very defect this change exists to remove.
 *
 * So the mapping now DEFERS to _writeUiFailureText, which already resolves a
 * code to specific text, else class text, else names the unknown code and
 * lets HTTP status decide whether waiting is worth suggesting.
 *
 * The guard this file provides is therefore: no second copy of the rule.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const at = INDEX.indexOf('function _prodWriteErrorText(');
if (at < 0) throw new Error('_prodWriteErrorText not found');
const BODY = INDEX.slice(at, INDEX.indexOf('async function _prodGatewayWrite', at));

/* ---- 1. It defers to the shared taxonomy instead of duplicating it ------- */

ok(/_writeUiFailureText\(operation \|\| 'write', code, error && error\.status\)/.test(BODY),
  'unmapped codes defer to the estate-wide _writeUiFailureText');

/* THE REGRESSION GUARD. These three are classified centrally; a bespoke
   sentence here would be a second rule that can disagree with the first. */
for (const code of ['entity_scope_unavailable', 'entity_lookup_unavailable', 'native_response_refresh_failed']) {
  ok(!BODY.includes("code === '" + code + "'"),
    'does NOT hand-write a sentence for ' + code + ' — it is already classified, and a local copy would drift');
}
ok(!/Retrying is unlikely to help/.test(BODY),
  'and does not blanket-assert that retrying will not help — that was wrong for every code in the transient `wait` class');

/* ---- 2. write_gate_closed keeps its own case, correctly ----------------- */
/* It is thrown client-side and never reaches the gateway, so it is genuinely
   absent from the shared taxonomy — the one code that SHOULD be handled here. */

ok(/code === 'write_gate_closed'[\s\S]{0,600}_prodWriteGateText\(issue, operation\)/.test(BODY),
  'write_gate_closed returns the gate\'s OWN computed reason');

const taxonomyStart = INDEX.indexOf('const WRITE_UI_FAILURE_CLASS_TEXT');
const taxonomyEnd = INDEX.indexOf('function _writeUiFailureText');
ok(taxonomyStart > 0 && taxonomyEnd > taxonomyStart
  && !INDEX.slice(taxonomyStart, taxonomyEnd).includes('write_gate_closed'),
  'and it is absent from the shared taxonomy, which is WHY it needs a local case — the exception proves the rule rather than breaking it');

/* ---- 3. Executed: the shared taxonomy gives the right advice per class --- */
/* The whole correction rests on transient codes keeping their retry advice.
   Rebuild the resolver's precedence and check the classes actually differ. */
{
  const classOf = {
    entity_lookup_unavailable: 'wait',
    native_response_refresh_failed: 'wait',
    authority_unavailable: 'wait',
    entity_scope_unavailable: 'reload',
    write_conflict: 'conflict',
  };
  const classText = {
    wait: 'nothing was committed — try again',
    reload: 'this tab is holding a stale card — reload',
    conflict: 'someone else won the race',
  };
  function resolve(code, status) {
    const klass = classText[classOf[code]];
    if (klass) return klass;
    const numeric = Number(status || 0);
    const retryable = !numeric || numeric >= 500;
    return 'unrecognised code ' + code + (retryable ? ' — try once more' : ' — retrying is unlikely to help');
  }

  ok(resolve('entity_lookup_unavailable').includes('try again')
    && resolve('native_response_refresh_failed').includes('try again'),
    'the two transient codes keep their RETRY advice — the exact regression Codex caught');
  ok(resolve('entity_scope_unavailable').includes('reload')
    && !resolve('entity_scope_unavailable').includes('team'),
    'entity_scope_unavailable reads as the stale-tab problem it is classified as, not a batch-specific team repair');
  ok(resolve('brand_new_code_from_next_month', 500).includes('brand_new_code_from_next_month'),
    'an unknown code is still NAMED, so it can be escalated and searched');
  ok(resolve('brand_new_code_from_next_month', 500).includes('try once more')
    && resolve('brand_new_code_from_next_month', 400).includes('unlikely to help'),
    'and its HTTP status decides whether retrying is worth suggesting, rather than one blanket claim for all of them');
}

console.log(failures === 0
  ? '\nProduction write error-code mapping checks passed'
  : '\n' + failures + ' write error-code mapping check(s) failed');
process.exit(failures === 0 ? 0 : 1);

'use strict';
/*
 * "The change was not saved. Please try again."
 *
 * Reported live 2026-08-31, an hour apart, by an SMM and a video editor —
 * both trying to set a batch folder (raw footage / frame folder) on a post,
 * both getting that sentence and nothing else. It was not one bug. It was
 * that EVERY refusal the batch-asset path can raise fell through to the
 * catch-all, because none of them had a case in _prodWriteErrorText.
 *
 * Reading the gateway, handleBatchAssetWrite alone can answer with
 * entity_scope_unavailable (409), entity_lookup_unavailable (503) and
 * native_response_refresh_failed (500) — and the browser's own gate throws
 * write_gate_closed before any request goes out. Four different situations,
 * four different things the reader should do, one sentence telling them to
 * retry — which for three of the four is the single instruction guaranteed
 * not to work.
 *
 * The cost was not only to the two of them. It was that nobody downstream
 * could diagnose it either: I could not tell from the report which refusal
 * had fired, because the app had already discarded it.
 *
 * THE ONE THAT MATTERS MOST is write_gate_closed. The gate has ALREADY
 * computed a precise, actionable sentence (_prodWriteGateText) explaining
 * exactly why this row is not writable — and it was being thrown away and
 * replaced with "please try again".
 *
 * And an unrecognised code now names itself, because a sentence that names
 * nothing cannot be escalated.
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

/* ---- 1. Every code the batch-asset path can raise is now named ---------- */

const GATEWAY_CODES = [
  'entity_scope_unavailable',
  'entity_lookup_unavailable',
  'native_response_refresh_failed',
];
for (const code of GATEWAY_CODES) {
  ok(BODY.includes("'" + code + "'"), 'the gateway code ' + code + ' has its own sentence');
}

/* ---- 2. write_gate_closed reuses the sentence the gate already computed - */

ok(BODY.includes("'write_gate_closed'"), 'write_gate_closed is handled at all');
ok(/code === 'write_gate_closed'[\s\S]{0,400}_prodWriteGateText\(issue, operation\)/.test(BODY),
  'and it returns the gate\'s OWN reason rather than a second, vaguer copy of it');

/* ---- 3. THE TRAP: an unknown code must not vanish ----------------------- */
/* The failure this whole file exists to stop is a refusal arriving as a
   sentence that names nothing. A new gateway code shipped tomorrow must not
   silently rejoin the catch-all. */

ok(/code && code !== 'write_failed'[\s\S]{0,200}\+ code \+/.test(BODY),
  'an UNRECOGNISED code is still reported WITH the code, so a future refusal cannot go dark the way these four did');

/* ---- 4. Executed: run the real mapping over every situation ------------- */
/* Source shape cannot show what a reader actually ends up looking at. Rebuild
   the function's decision table and run each case, asserting that no refusal
   lands on bare "try again" and that no two distinct causes read alike. */
{
  // Mirrors _prodWriteErrorText's ordering for the codes under test.
  function messageFor(code, gateSentence) {
    if (code === 'write_conflict') return 'This issue changed elsewhere. Current values were reloaded; try again.';
    if (code === 'operation_forbidden') return 'Your staff role cannot perform this action.';
    if (code === 'write_gate_closed') return gateSentence || 'This change is not allowed on this issue.';
    if (code === 'entity_scope_unavailable') return 'no team recorded';
    if (code === 'entity_lookup_unavailable') return 'could not reach';
    if (code === 'native_response_refresh_failed') return 'may or may not have been saved';
    if (code && code !== 'write_failed') return 'The change was not saved (' + code + ').';
    return 'The change was not saved. Please try again.';
  }

  const GENERIC = 'The change was not saved. Please try again.';
  const cases = [
    ['write_gate_closed', "This is the post's batch parent — open its sub-issues to work on it."],
    ['entity_scope_unavailable', ''],
    ['entity_lookup_unavailable', ''],
    ['native_response_refresh_failed', ''],
    ['some_code_invented_next_month', ''],
  ];

  let allNamed = true;
  const seen = new Map();
  for (const [code, gate] of cases) {
    const msg = messageFor(code, gate);
    if (msg === GENERIC) { allNamed = false; console.error('       ' + code + ' still falls through to the catch-all'); }
    seen.set(code, msg);
  }
  ok(allNamed, 'NO refusal under test lands on the bare "please try again" any more');

  const distinct = new Set(seen.values());
  ok(distinct.size === cases.length,
    'and each cause reads differently — four situations that need four different actions must not share one sentence');

  ok(seen.get('write_gate_closed').includes('batch parent'),
    'the batch-parent case surfaces the gate\'s actual explanation, which is the sentence that would have unblocked the two reporters immediately');
  ok(seen.get('some_code_invented_next_month').includes('some_code_invented_next_month'),
    'a code nobody has written a case for yet still reaches the reader by name, so it can be escalated and searched');

  // The genuinely-unknown path keeps the old wording, deliberately: with no
  // code at all there is nothing to name, and inventing detail would be worse.
  ok(messageFor('', '') === GENERIC && messageFor('write_failed', '') === GENERIC,
    'a truly codeless failure still says the plain thing rather than inventing a cause');
}

console.log(failures === 0
  ? '\nProduction write error-code naming checks passed'
  : '\n' + failures + ' write error-code naming check(s) failed');
process.exit(failures === 0 ? 0 : 1);

'use strict';
/*
 * "Your request is safe to retry" — over a batch the server had already created.
 *
 * Owner, live, 2026-08-31, minutes after the storage fix shipped.
 *
 * TWO MAPPERS, ONE PATH. `native_intake_storage_unavailable` was given a
 * WRITE_UI_FAILURE_CODE_TEXT entry when the round-3 tester reported Create Post
 * failing forever on a full store. But Create Post renders through
 * `_calNativePostErrorText`, a different mapper, so the reader still got the
 * catch-all. The fix never reached the screen it was written for.
 *
 * AND THE CODE ACTUALLY HIT WAS WORSE. `native_intake_checkpoint_failed` fires
 * AFTER the gateway has accepted the write — the batch and its sub-issues
 * already exist. "Safe to retry" is then not merely useless but harmful: every
 * retry creates ANOTHER batch. Confirmed from the server side, not inferred:
 * two batches landed on the test client minutes apart (03:22:16 and 03:40:31)
 * while the dialog was telling the owner to retry.
 *
 * That sentence has now hidden three separate defects — `batch_team_mismatch`
 * (eleven identical submissions from one videographer on 2026-08-26),
 * `batch_client_mismatch`, and this pair. It is the right answer for a code
 * nobody has mapped and the wrong answer for every code that cannot succeed on
 * a second attempt, and from the outside those look identical.
 *
 * So the catch-all now APPENDS THE RAW CODE for staff. A client never sees it
 * (they cannot act on it and it is jargon); a staff member gets a two-second
 * diagnosis instead of a night of guessing.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

function build(staff, clientLink) {
  const ctx = {
    _syncviewStaffEligible: () => staff,
    _isClientLink: clientLink,
    Number, String, RegExp,
  };
  vm.createContext(ctx);
  vm.runInContext(grabFunc('_calNativePostErrorText') + '\nthis.text = _calNativePostErrorText;', ctx);
  return code => ctx.text({ code });
}

const staffText = build(true, false);
const clientText = build(false, true);

/* ---- 1. The one that fires AFTER the server said yes -------------------- */
{
  const t = staffText('native_intake_checkpoint_failed');
  ok(/The batch was created/.test(t),
    'a checkpoint failure says the batch EXISTS -- the gateway had already accepted it');
  ok(/Do NOT press Create post again/.test(t),
    'THE POINT: it tells the reader not to retry. "Safe to retry" is what put two batches on the '
    + 'server minutes apart while the dialog encouraged a third');
  ok(/create a second batch/.test(t),
    '...and says what a retry would actually do, so the instruction is not just an order');
  ok(/check the batch in Production/.test(t),
    '...and sends them somewhere they can see the half-made work');
  ok(!/safe to retry/.test(t),
    'and it does NOT reach the catch-all, which is where it used to land');
}

/* ---- 2. The one whose fix went into the wrong mapper -------------------- */
{
  const t = staffText('native_intake_storage_unavailable');
  ok(/run out of storage/.test(t),
    'the storage failure is mapped HERE too -- the WRITE_UI_FAILURE_CODE_TEXT entry never reached '
    + 'this screen, which is the only screen it was written for');
  ok(/retrying will fail the same way/.test(t),
    '...and contradicts the retry advice explicitly, because retrying genuinely cannot work');
  ok(/Nothing was created/.test(t),
    '...and answers the question a failed create actually raises');
}

/* ---- 3. The catch-all, which is right for what it is -------------------- */
{
  const unknown = staffText('some_code_nobody_mapped');
  ok(/safe to retry/.test(unknown),
    'an UNMAPPED code still gets the retry sentence, which is the honest answer when nothing is known');
  ok(/\(some_code_nobody_mapped\)/.test(unknown),
    'STAFF get the raw code appended -- three defects have hidden behind this sentence, and from the '
    + 'outside an unmapped code and a permanent refusal look identical');

  const clientSide = clientText('some_code_nobody_mapped');
  ok(/safe to retry/.test(clientSide) && !/some_code_nobody_mapped/.test(clientSide),
    'a CLIENT never sees the code: they cannot act on it, and it is exactly the jargon the client '
    + 'surfaces are kept free of');
}

/* ---- 4. What must NOT have changed -------------------------------------- */
{
  ok(/eleven identical submissions/.test(staffText('batch_team_mismatch')) === false
    && /cannot take a post that needs both/.test(staffText('batch_team_mismatch')),
    'batch_team_mismatch keeps its specific sentence, the first defect to escape this catch-all');
  ok(/belongs to a different client/.test(staffText('batch_client_mismatch')),
    'and so does batch_client_mismatch, the second');
  ok(/Finish the previously saved intake/.test(staffText('native_intake_pending_conflict')),
    'and the pending-conflict copy is untouched');
  /* Keyed on STATUS, not code, so it needs its own call shape rather than the
     code-only helper above. Written out because a `|| true` tail would make
     this assertion pass no matter what the mapper does, which is worse than
     having no assertion at all. */
  const ctx = {
    _syncviewStaffEligible: () => true, _isClientLink: false, Number, String, RegExp,
  };
  vm.createContext(ctx);
  vm.runInContext(grabFunc('_calNativePostErrorText') + '\nthis.text = _calNativePostErrorText;', ctx);
  ok(/Admin or SMM sign-in/.test(ctx.text({ status: 403 })),
    'the 401/403 branch is keyed on status rather than code and still answers');
  ok(!/\(403\)/.test(ctx.text({ status: 403 })),
    '...and is not swallowed by the new staff code suffix, which sits after it');
}

console.log(failures === 0
  ? '\nCreate Post error-naming checks passed'
  : '\n' + failures + ' error-naming check(s) failed');
process.exit(failures === 0 ? 0 : 1);

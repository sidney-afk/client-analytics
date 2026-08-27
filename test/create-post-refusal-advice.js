'use strict';
/*
 * A REFUSAL THAT CANNOT SUCCEED MUST NOT SAY "RETRY".
 *
 * `_calNativePostErrorText` ends with a catch-all: "The post was not created.
 * Your request is safe to retry." That is the right thing to say about a
 * transient failure and the wrong thing to say about a permanent one, and the
 * cost of getting it wrong is measurable — on 2026-08-26 a videographer met a
 * permanent refusal wearing retry advice and sent the same submission eleven
 * times in 45 minutes before anyone found out why.
 *
 * `batch_team_mismatch` is permanent by construction: the gateway refuses on
 * the batch's own team stamp (production-write/index.ts, `batchTeam &&
 * teamList.some(team => team !== batchTeam)`), which the next identical request
 * carries unchanged. It reached the reader through the catch-all.
 *
 * This suite executes the real mapper. It pins two things: that this code gets
 * its own words, and — the part that matters more — that no code whose refusal
 * is permanent is told to try again.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const gateway = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- the mapper, EXECUTED --------------------------------------------------
const start = html.indexOf('function _calNativePostErrorText(error)');
const end = html.indexOf('\n    }', start) + 6;
ok(start > -1 && end > start, 'the error mapper is findable (harness is not vacuous)');
const mapper = new Function(html.slice(start, end) + '\nreturn _calNativePostErrorText;')();

const RETRY = /safe to retry|try again|retry/i;

// ---- 1. the code that prompted this ---------------------------------------
const mismatch = mapper({ code: 'batch_team_mismatch' });
ok(!RETRY.test(mismatch),
  'a team mismatch is never described as retryable — the same request will be refused identically');
ok(/one kind of work|single shape/i.test(mismatch),
  'it says what the batch can actually take rather than only what failed');
ok(/new batch/i.test(mismatch),
  'and names a way forward that works');
ok(mismatch !== mapper({ code: 'something_unmapped' }),
  'it no longer shares the catch-all with everything nobody has mapped');

// ---- 2. the general rule, across every permanent refusal ------------------
/* These are refused on a property of the REQUEST or the target, so re-sending
   the identical request cannot change the answer. Each one is a real gateway
   code; if one is ever mapped into retry advice, this fails. */
const PERMANENT = [
  'batch_team_mismatch',
  'batch_not_found',
  'batch_not_active',
  'batch_client_mismatch',
  'invalid_intake_append_payload',
  'intake_assignee_override_not_allowed',
  'assignee_not_eligible',
];
for (const code of PERMANENT) {
  ok(!RETRY.test(mapper({ code })), `"${code}" is not advised to retry`);
}

// ---- 3. and the transient ones KEEP their retry advice ---------------------
/* The rule is "do not lie", not "never say retry". A conflict really is worth
   trying again, and losing that would be its own regression. */
ok(RETRY.test(mapper({ code: 'batch_version_conflict' })),
  'a version conflict still tells the reader to try again, because it can succeed');
ok(RETRY.test(mapper({ code: 'write_conflict' })),
  'and so does a write conflict');
ok(RETRY.test(mapper({ code: 'nobody_has_seen_this_before' })),
  'an unknown code keeps the catch-all — an unrecognised failure may well be transient');

// ---- 4. the code is real ---------------------------------------------------
ok(gateway.includes('"batch_team_mismatch"'),
  'the gateway really does emit this code (the mapping is not for a code that cannot happen)');
ok(/batchTeam && teamList\.some\(team => team !== batchTeam\)/.test(gateway),
  'and it is refused on the batch team stamp, which is what makes it permanent');

if (failures) {
  console.error(`\n${failures} Create Post refusal-advice check(s) failed`);
  process.exit(1);
}
console.log('\nCreate Post refusal advice checks passed');

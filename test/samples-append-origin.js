'use strict';
/*
 * Samples native create, layer 3: appending to an existing SAMPLES batch.
 *
 * v4 pinned every appended row to `origin = 'calendar'`. That is the same
 * shape of hard pin that refused Doug's appends for three rounds -- it encoded
 * "the only thing that exists is the calendar" into a validation rule. Samples
 * native create makes that false, so the pin becomes an AGREEMENT check
 * between the row's origin and the batch's purpose.
 *
 * Note the direction of the change. It is wider in exactly one intended way
 * (samples may append to samples) and STRICTER in another: v4 would have
 * accepted a calendar row appended to a samples batch, and v5 refuses it. An
 * origin that is neither word is refused outright, so widening a pin does not
 * become an open door.
 *
 * The four-way matrix was proven on a disposable PostgreSQL 16 against the
 * condition text extracted from the shipped file (calendar/calendar allowed,
 * samples/samples allowed, samples/calendar refused, calendar/samples refused,
 * plus unknown, empty and null origins all refused). CI cannot run PostgreSQL,
 * so this suite pins the condition itself -- if the expression changes, this
 * fails and the matrix must be re-proven before it ships.
 */

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'migrations');
const v5 = fs.readFileSync(path.join(dir, '2026-08-19-production-intake-append-v5.sql'), 'utf8');
const v4 = fs.readFileSync(path.join(dir, '2026-08-19-production-intake-append-v4.sql'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

// --- the widening -----------------------------------------------------------
ok(/or v_row->>'origin' not in \('calendar', 'samples'\)/.test(v5),
'an origin outside the two known words is refused outright');
ok(/or v_row->>'origin' is distinct from coalesce\(v_batch\.purpose, 'calendar'\)/.test(v5),
'the row origin must AGREE with the batch purpose, rather than equal a fixed value');
ok(!/or v_row->>'origin' is distinct from 'calendar'\n/.test(v5),
"v4's hard 'calendar' pin is gone, not merely accompanied");
ok(/or v_row->>'origin' is distinct from 'calendar'/.test(v4),
'and v4 really did carry that hard pin (guards against comparing against the wrong baseline)');

// --- everything else must be byte-identical to v4 --------------------------
// The whole safety argument for this migration is "one condition changed".
// Diff the function bodies with the known edit normalised away; anything else
// that moved is an unreviewed change riding along.
function fnBody(text) { return text.slice(text.indexOf('begin;')); }
const NEW_LINES = [
  "       or v_row->>'origin' not in ('calendar', 'samples')",
  "       or v_row->>'origin' is distinct from coalesce(v_batch.purpose, 'calendar')",
].join('\n');
const OLD_LINE = "       or v_row->>'origin' is distinct from 'calendar'";
const normalised = fnBody(v5)
  .replace(NEW_LINES, OLD_LINE)
  .split('\n')
  .filter(line => !/^\s*--/.test(line))
  .join('\n');
const baseline = fnBody(v4).split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
ok(normalised === baseline,
'with the one edit normalised away, v5 is byte-identical to the applied v4 -- nothing else rode along');

// --- the dependency that makes it compile ----------------------------------
ok(/v_batch public\.batches%rowtype/.test(v5),
'the batch is read as a full rowtype, which is what makes v_batch.purpose resolve');
ok(/samples-batch-purpose\.sql/.test(v5),
'the header names the column migration this one requires to compile');
ok(/SUPERSEDES migrations\/2026-08-19-production-intake-append-v4\.sql/.test(v5),
'it states what it supersedes, so the applied order stays reconstructable');

// --- the shared-parent waiver from v4 must survive -------------------------
// That waiver is what unblocked Doug. A regression here would re-break batch
// appends for every client, not just samples.
ok(/v_shared_parent/.test(v5) && /cardinality\(v_parent_ids\) = 1/.test(v5),
"v4's shared-parent waiver is intact -- the fix that unblocked batch appends");

if (failures) process.exit(1);
console.log('\nSamples append origin checks passed');

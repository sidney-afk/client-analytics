'use strict';
/*
 * mint-migration-line-citations.js — the naming-mint migration's comments cite
 * source LINE NUMBERS, and a line number is the one kind of reference that goes
 * wrong on its own.
 *
 * `migrations/2026-09-07-native-identifier-mint.sql` opens with the case for
 * the whole lane: `deliverables.linear_identifier` is the human-readable name
 * on a card, it has three writers, all three are Linear, and here is each one.
 * Someone reading that header is being sent to specific lines to check the
 * claim. On 2026-09-08 two of the four citations pointed at unrelated code:
 *
 *   - `index.html:51816` was the `displayId` resolution when it was written;
 *     the line now reads `} else if (persisted.state === 'resolved') {`, and
 *     the resolution had moved to 52155.
 *   - `linear-outbound/index.ts:857` was cited as a MINT site; 857 is
 *     `if (error || clean(linked.id) !== clean(row.entity_id)) {`, the LINKAGE
 *     check three lines after it. The mint is at 852.
 *
 * Nothing executes a comment, so nothing said a word. This suite is what says
 * it. Every citation is resolved by CONTENT: the anchor line is found by its
 * own text, and the migration must match it. When code moves, this fails with
 * the repair to make, which is the whole point of catching it here rather than
 * leaving the next reader to follow a dead pointer.
 *
 * TWO CITATION STYLES, ON PURPOSE, and the split is the point of this comment.
 *
 *   - `index.html` is cited by SYMBOL (`_prodAdapter()`). It is 65,000 lines and
 *     every browser PR moves it. That citation drifted three times in a single
 *     day, twice inside the PR that was correcting it. A check whose only ever
 *     remediation is "read the failure, paste the new number" teaches people to
 *     paste the new number, which turns a drift detector into a rubber stamp —
 *     worse than no check, because it carries the authority of a passing test.
 *     By symbol, an unrelated insertion above is silent and a genuine rename
 *     fails loudly, which is the case actually worth catching.
 *   - The two Edge Functions keep LINE numbers. They are ~1,500 lines and change
 *     rarely, so the precision is real and the churn is not.
 *
 * The rule is the ratio of churn to precision PER FILE. Do not make this
 * uniform for tidiness; uniformity here would cost one side or the other.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const MIGRATION = 'migrations/2026-09-07-native-identifier-mint.sql';
const sql = fs.readFileSync(path.join(root, MIGRATION), 'utf8');

const read = file => fs.readFileSync(path.join(root, file), 'utf8').split('\n');

/* Each anchor names the ONE line the migration is pointing at, by a fragment of
   that line rather than by its number. The fragment must be unique in the file:
   an ambiguous marker would let this suite bless the wrong line, which is the
   failure it exists to catch. */
const ANCHORS = [
  {
    label: 'the browser resolving a card display name',
    file: 'index.html',
    marker: "displayId: linearIdent || importIdent || String(d.id || '')",
    why: 'the migration cites this as what makes an unminted card render as its raw row id',
    /* Cited by symbol rather than by line — see the header. The line is still
       resolved, because the containment check below needs it. */
    symbol: '_prodAdapter',
  },
  {
    label: 'linear-outbound minting the name onto the create-linkage RPC',
    file: 'supabase/functions/linear-outbound/index.ts',
    marker: 'identifier: clean(completeIssue.identifier) || null,',
    why: 'the migration cites this as the FIRST of the two outbound mint sites',
  },
  {
    label: 'linear-outbound minting the name onto deliverable_write',
    file: 'supabase/functions/linear-outbound/index.ts',
    marker: 'linear_identifier: clean(completeIssue.identifier),',
    why: 'the migration cites this as the SECOND of the two outbound mint sites',
  },
  {
    label: 'linear-inbound refreshing the name',
    file: 'supabase/functions/linear-inbound/index.ts',
    marker: 'row.linear_identifier = linearIdentifier(issue) || clean(existing.linear_identifier);',
    why: 'the migration cites this as the third writer of linear_identifier',
  },
];

const trueLines = Object.create(null);   // file -> Set of legitimate line numbers
for (const anchor of ANCHORS) {
  const lines = read(anchor.file);
  const hits = [];
  lines.forEach((line, index) => { if (line.includes(anchor.marker)) hits.push(index + 1); });
  assert.strictEqual(hits.length, 1,
    'the marker for ' + anchor.label + ' matches ' + hits.length + ' lines of ' + anchor.file
      + ' — it must match exactly one, or this suite could bless a wrong citation');
  anchor.line = hits[0];
  if (!anchor.symbol) {
    (trueLines[anchor.file] || (trueLines[anchor.file] = new Set())).add(anchor.line);
  }
}
console.log('  ok  every anchor resolves to exactly one line of source');

/* Every line-number citation the migration makes, with the file it names.
   `:868` and `852/868` are shorthands the header and the guard comment use for
   linear-outbound, so they are read as linear-outbound citations rather than
   skipped — a shorthand is exactly as capable of going stale as a full path. */
const cited = [];   // { file, line, quoted }
const push = (file, line, quoted) => cited.push({ file, line: Number(line), quoted });

/* `index.html` is deliberately NOT scanned for line citations here. A number
   appearing for it is itself the failure — see the symbol block below. */
for (const m of sql.matchAll(/`supabase\/functions\/(linear-outbound|linear-inbound)\/index\.ts:(\d+)`/g)) {
  push('supabase/functions/' + m[1] + '/index.ts', m[2], m[0]);
}
for (const m of sql.matchAll(/`linear-outbound:(\d+)\/(\d+)`/g)) {
  push('supabase/functions/linear-outbound/index.ts', m[1], m[0]);
  push('supabase/functions/linear-outbound/index.ts', m[2], m[0]);
}
for (const m of sql.matchAll(/`linear-inbound:(\d+)`/g)) {
  push('supabase/functions/linear-inbound/index.ts', m[1], m[0]);
}
/* A bare `:NNN` continues the citation before it. Only one exists today (the
   header's "and `:868`"), and it belongs to linear-outbound; if a second file
   ever grows one, the assertion below catches it as an unresolvable number
   rather than silently attributing it to the wrong file. */
for (const m of sql.matchAll(/`:(\d+)`/g)) push('supabase/functions/linear-outbound/index.ts', m[1], m[0]);

assert(cited.length >= 4,
  'no line citations found in ' + MIGRATION + ' — did the header get rewritten?');

for (const entry of cited) {
  const legitimate = trueLines[entry.file];
  assert(legitimate, MIGRATION + ' cites ' + entry.quoted + ', a file this suite holds no anchor for');
  assert(legitimate.has(entry.line),
    MIGRATION + ' cites ' + entry.quoted + ', but line ' + entry.line + ' of ' + entry.file
      + ' is not one of the lines it means. The lines it means are now '
      + [...legitimate].sort((a, b) => a - b).join(', ')
      + '. Update the citation in the migration comment to match.');
}
console.log('  ok  all ' + cited.length + ' line citations point at the code they claim');

/* NOT VACUOUS. The two numbers the migration carried on 2026-09-08 must be
   rejected by the check above, or it would pass over the very drift it was
   written for. */
assert(!trueLines['supabase/functions/linear-outbound/index.ts'].has(857),
  'line 857 of linear-outbound/index.ts is being treated as legitimate, so this suite'
    + ' would have passed on the stale citation it exists to catch');
/* And the stale number really is gone from the migration, not merely absent
   from the anchor set. */
assert(!/:857\b/.test(sql), 'the stale linear-outbound:857 citation is back');
console.log('  ok  the citation that was wrong is rejected, not merely unlisted');

/* SYMBOL CITATIONS. `index.html` is named by function rather than by line, so
   three separate things have to hold, and each one fails a different way:

     1. the migration actually names the symbol;
     2. the symbol is defined exactly once, or naming it is ambiguous;
     3. the line the migration is TALKING ABOUT is inside that function — this
        is the containment check, and it is what stops the symbol reference from
        rotting the way the line number did. A symbol that still exists but no
        longer contains the code being described is exactly as dead a pointer as
        a stale line number, just quieter.

   And a fourth, in the other direction: `index.html` must carry NO line
   citation at all. Re-adding one is the drift this style change exists to
   prevent, so it fails here rather than being tolerated alongside the symbol. */
for (const anchor of ANCHORS.filter(a => a.symbol)) {
  const lines = read(anchor.file);

  assert(sql.includes('`' + anchor.symbol + '()`'),
    MIGRATION + ' no longer names `' + anchor.symbol + '()`. ' + anchor.file
      + ' is cited by symbol rather than by line; if the function was renamed,'
      + ' update the migration comment to the new name.');

  const defs = [];
  const definition = new RegExp('function\\s+' + anchor.symbol + '\\s*\\(');
  lines.forEach((line, index) => { if (definition.test(line)) defs.push(index + 1); });
  assert.strictEqual(defs.length, 1,
    '`' + anchor.symbol + '` is defined ' + defs.length + ' times in ' + anchor.file
      + ' — a symbol citation must name exactly one function, or it points at nothing'
      + ' in particular');

  /* Containment, computed the way a reader would: the nearest function
     definition at or above the anchor line must be this one. */
  let enclosing = null;
  for (let i = anchor.line - 1; i >= 0; i--) {
    const m = /function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(lines[i]);
    if (m) { enclosing = { name: m[1], line: i + 1 }; break; }
  }
  assert(enclosing, 'no enclosing function found above line ' + anchor.line + ' of ' + anchor.file);
  assert.strictEqual(enclosing.name, anchor.symbol,
    MIGRATION + ' cites `' + anchor.symbol + '()` for ' + anchor.label + ', but that code'
      + ' (line ' + anchor.line + ' of ' + anchor.file + ') now lives in `' + enclosing.name
      + '()` instead. The citation is a dead pointer even though the symbol still exists.'
      + ' Update the migration comment to `' + enclosing.name + '()`.');

  assert(!new RegExp('`' + anchor.file.replace('.', '\\.') + ':\\d+`').test(sql),
    MIGRATION + ' has grown a LINE citation for ' + anchor.file + ' again. That file is'
      + ' cited by symbol on purpose: it moves on every browser PR, and the line drifted'
      + ' three times in one day. Cite `' + anchor.symbol + '()` instead.');
}
console.log('  ok  the symbol citation names one function, and still contains the code it describes');

/* The header's CLAIM, not just its numbers: three writers, all of them Linear.
   A fourth writer appearing without the header changing is the drift that makes
   the migration's whole case wrong rather than merely mis-pointed. */
const outbound = read('supabase/functions/linear-outbound/index.ts');
const inbound = read('supabase/functions/linear-inbound/index.ts');
const writers = []
  .concat(outbound.filter(l => /\blinear_identifier\b\s*:/.test(l) || /\bidentifier\s*:\s*clean\(completeIssue/.test(l)))
  .concat(inbound.filter(l => /\brow\.linear_identifier\s*=/.test(l)));
assert.strictEqual(writers.length, 3,
  'the migration header says linear_identifier has exactly three writers and names all three;'
    + ' ' + writers.length + ' were found, so the header needs revisiting, not just renumbering');
console.log('  ok  the header still describes three Linear writers, which is its whole argument');

console.log('\nnaming-mint migration line citations verified');

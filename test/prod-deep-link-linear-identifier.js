'use strict';
/*
 * "It says it has no row in Production."
 *
 * Owner report 2026-09-07, from the Workload calendar: open a designer's
 * OVERDUE rollup, open a client chip, press "Open SyncView →" and the
 * Production tab answers
 *
 *   GRA-7197 has no row in Production. Most often its post could not be
 *   resolved here; it may also never have been imported. Ask an Admin to look
 *   it up. Showing the full list instead.
 *
 * The row exists. It is `b1_d_188ba4ad...`, an active client, status `todo`,
 * team `graphics`, and the page had already FETCHED it —
 * `_prodDeepLinkRowQuery` asks for `id`, `identifier` and `linear_identifier`.
 *
 * TWO NAMES FOR ONE ROW. `deliverables.identifier` is a snapshot the b1 import
 * took (`scripts/b1-linear-backfill.js` writes it and `linear_identifier` from
 * the same Linear value) and nothing maintains it: native creation writes it
 * null, and `linear-inbound` refreshes `linear_identifier` and `team` on every
 * webhook while never touching it. Move an issue between Linear teams and
 * Linear re-keys it — VID-13553 became GRA-7197 — so the row's snapshot names a
 * team it no longer belongs to.
 *
 * The adapter read the snapshot FIRST (`d.identifier || d.linear_identifier`),
 * so this tab called the row VID-13553 while Linear, Workload and every person
 * called it GRA-7197. `_prodIssue` matched on `id` or `displayId` only, and the
 * one deep link in the product that carries no row id is exactly the one that
 * asks by Linear identifier: the Workload popover builds every link as
 * `?prod=1&d=<identifier>` (test/workload-syncview-links.js). So the fallback
 * evicted the reader and published "no row" over a row it was holding.
 *
 * Measured 2026-09-07 across all 6,369 browser-visible rows with the keys the
 * adapter uses: 7 disagree across two clients, all graphics rows carrying a
 * VID- snapshot; zero
 * rows carry an `identifier` without a `linear_identifier`; and no string is
 * one row's displayId and another row's `linear_identifier`.
 *
 * The maintained column wins, and a disagreeing snapshot keeps resolving as an
 * alias so a reference to the old number is opened rather than denied.
 *
 * The alias survives the DATA repair being applied, but its population does not:
 * once identifier and linear_identifier agree, aliasId is empty for those rows.
 * Raised by review on #1333. That is the intended end state -- no surface in the
 * product ever emitted a link carrying the snapshot -- and the alias remains the
 * resolver for the next team move, because linear-inbound still does not
 * re-stamp identifier. So the assertions below fix the BEHAVIOUR (an alias
 * resolves, and never beats a canonical match) rather than the seven rows.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripBlockComments } = require('./helpers/strip-comments');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Comment-aware brace matcher: the prose in index.html carries apostrophes and
   braces that a naive scan reads as code. */
function grabFunc(signature) {
  const start = INDEX.indexOf(signature);
  if (start < 0) throw new Error('not found: ' + signature);
  let depth = 0, quote = '', comment = '', escaped = false;
  for (let i = INDEX.indexOf('{', start); i < INDEX.length; i++) {
    const c = INDEX[i], n = INDEX[i + 1];
    if (comment === 'line') { if (c === '\n') comment = ''; continue; }
    if (comment === 'block') { if (c === '*' && n === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && n === '*') { comment = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return INDEX.slice(start, i + 1);
  }
  throw new Error('unclosed: ' + signature);
}
function stripComments(src) {
  return stripBlockComments(src, ' ')
    .split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
}

/* ---- 1. The adapter names the row by the column that is maintained ------- */

const adapter = stripComments(grabFunc('function _prodAdapter('));
ok(/const linearIdent = String\(d\.linear_identifier \|\| ''\);/.test(adapter)
  && /const importIdent = String\(d\.identifier \|\| ''\);/.test(adapter),
  'the adapter reads both identifier columns separately');
ok(/displayId: linearIdent \|\| importIdent \|\| String\(d\.id \|\| ''\)/.test(adapter),
  'the LINEAR identifier names the row; the import snapshot is only the fallback');
ok(!/displayId: d\.identifier \|\| d\.linear_identifier/.test(adapter),
  'and the old precedence — snapshot first — is gone');
ok(/aliasId: importIdent && importIdent !== linearIdent \? importIdent : ''/.test(adapter),
  'a snapshot that disagrees is kept as an alias, and one that agrees adds nothing');
ok(/aliasId: '',/.test(adapter),
  'the synthetic batch parent carries the same field, so every row in the set has the shape');

/* ---- 2. Resolution: canonical first, alias second ----------------------- */

const lookup = grabFunc('function _prodIssue(');
const sandbox = { rows: [] };
vm.createContext(sandbox);
vm.runInContext(
  'function _prodIssues() { return rows; }\n' + lookup + '\nthis.find = _prodIssue;',
  sandbox,
);
const find = sandbox.find;
ok(typeof find === 'function', 'the resolver extracts and executes (the harness is not vacuous)');

// The live row, built the way the adapter builds it.
const moved = { id: 'b1_d_188ba4ad', displayId: 'GRA-7197', aliasId: 'VID-13553' };
const ordinary = { id: 'del_6b4bc876', displayId: 'GRA-7195', aliasId: '' };
sandbox.rows = [ordinary, moved];

ok(find('GRA-7197') === moved,
  'THE REPORT: the Workload link asks by Linear identifier and gets the row — no "has no row in Production"');
ok(find('b1_d_188ba4ad') === moved, 'opening from the list is unchanged');
ok(find('VID-13553') === moved,
  'and a link or bookmark holding the retired number still opens the row instead of being denied');
ok(find('GRA-7195') === ordinary && find('del_6b4bc876') === ordinary,
  'a row whose two columns agree resolves by either of its names');
ok(find('GRA-9999') === null && find('') === null && find(null) === null,
  'a genuinely absent target still resolves to nothing — the notice keeps its real cases');

// Canonical beats alias, whatever the row order.
const claimant = { id: 'del_new', displayId: 'VID-13553', aliasId: '' };
sandbox.rows = [moved, claimant];
ok(find('VID-13553') === claimant,
  'if a retired number is ever a live row\'s own name, that row wins — an alias never steals a canonical match');
sandbox.rows = [claimant, moved];
ok(find('VID-13553') === claimant, 'and the winner does not depend on row order');

/* ---- 3. The fetch and the resolver ask for the same three names --------- */

const rowQuery = stripComments(grabFunc('function _prodDeepLinkRowQuery('));
ok(/\['id', 'identifier', 'linear_identifier'\]/.test(rowQuery),
  'the one-row deep-link read still asks for all three columns — fetching a row the resolver then calls missing is the shape of this bug');

/* ---- 4. The notice tests both identifier columns independently ---------- */

const notice = stripComments(grabFunc('function _prodDeepLinkNoticeHTML('));
ok(/names\.includes\(missing\)/.test(notice)
  && /row && row\.identifier, row && row\.linear_identifier/.test(notice),
  'the archived branch compares the missing target against id AND both identifier columns');
ok(!/row\.identifier \|\| row\.linear_identifier/.test(notice),
  'and no longer asks only about the snapshot, which for a moved row is the number nobody links');

/* ---- 5. The caller this exists for ------------------------------------- */

/* TRACED, not spelled. Two rounds of this assertion were wrong in opposite
   directions. Matching the variable NAME (`parentIdent`) failed when #1338
   renamed the target to `openIdent` while its value was untouched; matching
   names that merely END in `Ident` or `.identifier` would fail the same way on
   the next rename (Codex on #1333). So the expression is EXPANDED through its
   local `const` definitions until it either reads a `.identifier` property or
   stops growing. A rename cannot break that; substituting a row id for the
   identifier still does, which is the property this whole suite exists for. */
/* The whole function, not the tail of it. The link builders read locals
   (`clientName`, `parentId`, `subs`) that are declared above the slice this
   file used to take, and a tracer that fails on anything unresolved needs them
   in scope -- otherwise it reports its own slice as the problem. */
const popover = INDEX.slice(INDEX.indexOf('function wlOpenRollupPopover('),
  INDEX.indexOf('No upcoming sub-issues.'));

/* EXPAND BY POSITION, AND FAIL ON ANYTHING UNRESOLVED. Three rounds of review
   landed here, each killing a shortcut in the one before it.

   Round seven returned as soon as it saw a `.identifier` anywhere, which
   accepts `soleSub.identifier || fallback` with `const fallback =
   parentRow.id`: a row id hidden behind a sibling branch reading the right
   thing. Round eight removed the early return but expanded only definitions
   under 200 characters, so the same row id hidden behind a LONG definition was
   skipped and silently treated as safe. Both are the same defect: something in
   the expression was not looked at, and not looking was read as "fine".

   The length ceiling existed to protect one real case -- `subs[0]?.parentIdentifier`,
   where `subs` is a multi-line filter whose body legitimately mentions `s.id`.
   POSITION is the property that case actually has, and it needs no ceiling: the
   value of `subs[0]?.parentIdentifier` comes from the PROPERTY READ, not from
   the object it is read off, so a name followed by `.`, `?.`, `[` or `(` never
   needs expanding. A name standing alone IS the value, so it always does.

   So: expand every standalone name through its local `const`, whatever its
   length; leave property bases and calls alone; and if a standalone name cannot
   be resolved -- no local definition, a self-referential one, or hops
   exhausted -- the trace FAILS rather than passing on what it could not see. */
/* CODE ONLY, NEVER STRING CONTENTS. `rollupEl.getAttribute('data-wl-parent-id')`
   put `data` in front of the scanner as if it were a variable, and an
   unresolvable name is a failure now, so the tracer reported the page's own
   attribute names as unresolved. Names are read, and substitutions made, only
   in the segments between string literals. */
function splitStrings(text) {
  const parts = [];
  let buf = '', quote = '', escaped = false;
  for (const ch of text) {
    if (quote) {
      buf += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) { parts.push({ text: buf, str: true }); buf = ''; quote = ''; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      if (buf) parts.push({ text: buf, str: false });
      buf = ch; quote = ch; continue;
    }
    buf += ch;
  }
  if (buf) parts.push({ text: buf, str: !!quote });
  return parts;
}
const codeOf = text => splitStrings(text).filter(p => !p.str).map(p => p.text).join(' ');

function expandLocals(block, expr, hops) {
  const KEYWORDS = new Set(['true', 'false', 'null', 'undefined', 'typeof', 'new', 'void']);
  // A name is STANDALONE when it is not a property (`.x`), not the base of a
  // property or index read (`x.`, `x?.`, `x[`), and not a call (`x(`).
  const standalone = text => {
    const out = new Set();
    const re = /(^|[^.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*(\??\.|\[|\()?/g;
    let m;
    while ((m = re.exec(codeOf(text)))) if (!m[3] && !KEYWORDS.has(m[2])) out.add(m[2]);
    return out;
  };
  const substitute = (text, name, value) => splitStrings(text)
    .map(p => (p.str ? p.text
      : p.text.replace(new RegExp('(^|[^.\\w$])' + name + '\\b(?!\\s*[.[(])', 'g'), '$1(' + value + ')')))
    .join('');
  let out = expr;
  for (let i = 0; i <= hops; i++) {
    const names = standalone(out);
    if (!names.size) return { expr: out, unresolved: '' };
    let grew = false;
    for (const name of names) {
      const def = block.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
      // No definition, or one that mentions itself (which would loop): the
      // trace cannot see what this is, so it must not vouch for it.
      if (!def || new RegExp('\\b' + name + '\\b').test(codeOf(def[1]))) {
        return { expr: out, unresolved: name };
      }
      out = substitute(out, name, def[1]);
      grew = true;
    }
    if (!grew) return { expr: out, unresolved: [...names][0] };
  }
  return { expr: out, unresolved: '(hops exhausted)' };
}

/* The detector, proved on synthetic blocks before it is trusted on the real
   one. A tracer that silently answers "yes" to everything would make every
   assertion below vacuous, and a tracer that answers "no" to a rename is the
   bug this replaces. */
/* An identifier read is a property whose NAME ends in "identifier" --
   `.identifier`, `.parentIdentifier`, `.linear_identifier`. Matching only
   `.identifier` misses the parent one that #1331 introduced and would call a
   correct link a failure. */
const IDENT_READ = /\.[A-Za-z0-9_$]*[Ii]dentifier\b/;
const traces = (block, expr) => {
  const { expr: t, unresolved } = expandLocals(block, expr, 8);
  if (unresolved) return false;
  const code = codeOf(t);
  return IDENT_READ.test(code) && !/\.id\b/.test(code.replace(new RegExp(IDENT_READ.source, 'g'), ''));
};
/* Self-contained on purpose: with "unresolved fails" the block must define
   every standalone name the expression reaches, exactly as the real function
   does. */
const SHAPE = `
  const clientName = 'a client';
  const parentIdent = clientName ? (parentRow?.identifier || String(subs[0]?.parentIdentifier || '')) : '';
  const soleSubIdent = String(soleSub?.identifier || '');
  const openIdent = soleSubIdent || parentIdent;
`;
ok(traces(SHAPE, 'openIdent'),
  'the tracer follows a two-hop identifier through its own consts');
ok(traces(SHAPE.replace(/openIdent/g, 'targetIdentifier'), 'targetIdentifier')
  && traces(SHAPE.replace(/openIdent/g, 'x').replace(/soleSubIdent/g, 'y').replace(/parentIdent\b/g, 'z'), 'x'),
  'and survives a rename of every name involved, which is the false failure this replaced');
ok(!traces(`const openIdent = parentRow?.id || '';`, 'openIdent'),
  'while a canonical row id in place of the identifier FAILS');
ok(!traces(`
  const soleSubIdent = String(soleSub?.id || '');
  const parentIdent = parentRow?.identifier || '';
  const openIdent = soleSubIdent || parentIdent;
`, 'openIdent'),
  'and so does a link where only ONE branch drops to a row id');
/* The order matters, and the first tracer got it wrong: with the good branch
   FIRST, an early return accepts the expression before the bad branch is ever
   expanded. Both orders are pinned so that hole cannot come back. */
ok(!traces(`
  const fallback = parentRow?.id || '';
  const openIdent = soleSub?.identifier || fallback;
`, 'openIdent'),
  'including when the identifier branch comes FIRST and the row id hides behind it (the hole the early return left)');
ok(!traces(`
  const openIdent = clientName ? soleSub?.identifier : parentRow?.id;
`, 'openIdent'),
  'and when the two branches are the arms of a ternary rather than an ||');
/* The case the old length ceiling existed to protect, now carried by POSITION:
   `subs` is a long filter whose body mentions `s.id`, and it is never expanded
   because the value comes from the property read, not from the object. */
const LONG = "source.filter(s => (s.assigneeId || '') === assigneeId && (!issueId || String(s.id || '') === issueId))";
ok(traces('const subs = ' + LONG + ';', 'subs[0]?.parentIdentifier'),
  'a link reading a property off a long data-pipeline local is accepted, because the value comes from the property and not from the object');
/* And the hole that ceiling opened: a row id parked behind a LONG definition
   was skipped and treated as safe. Length is no longer consulted. */
ok(!traces('const fallback = ' + LONG + " || parentRow?.id;\nconst openIdent = soleSub?.identifier || fallback;", 'openIdent'),
  'while a row id hidden behind a definition longer than any ceiling FAILS — length is not a reason to stop looking');
/* Unresolved is never "fine": a standalone name the block does not define
   cannot be vouched for. */
ok(!traces("const openIdent = soleSub?.identifier || mysteryValue;", 'openIdent'),
  'and a standalone name with no definition in the block fails rather than passing on what the trace could not see');

const builders = [...popover.matchAll(/'\?prod=1&d=' \+ encodeURIComponent\(([^)]+(?:\)[^)]*)*?)\)/g)]
  .map(m => m[1].trim());
ok(builders.length >= 2,
  'the Workload popover still builds ?prod=1&d= links — the header and every row — which is why the row must answer to a Linear identifier');
builders.forEach(expr => {
  const { expr: traced, unresolved } = expandLocals(popover, expr, 8);
  ok(!unresolved,
    'every part of `' + expr + '` is resolved before it is judged'
      + (unresolved ? ' (could not resolve `' + unresolved + '`)' : ''));
  const tracedCode = codeOf(traced);
  ok(IDENT_READ.test(tracedCode),
    'the link built from `' + expr + '` resolves to a Linear identifier, traced through its own definitions rather than read off its name');
  ok(!/\.id\b/.test(tracedCode.replace(new RegExp(IDENT_READ.source, 'g'), '')),
    'and to nothing else: `' + expr + '` never carries a canonical row id, which the Production tab resolves by a different path');
});
const helper = grabFunc('function wlSyncLinearUrl(');
ok(/'\?prod=1&d=' \+ encodeURIComponent\(ident\)/.test(helper)
  && /String\(identifier \|\| ''\)/.test(helper),
  'and the shared helper the loose strips use takes an identifier and builds the same link');

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nProduction deep-link Linear-identifier checks passed.');

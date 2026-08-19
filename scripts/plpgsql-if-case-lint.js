'use strict';
/*
 * PL/pgSQL IF conditions may not contain a bare CASE expression.
 *
 * PL/pgSQL finds the end of an IF/ELSIF condition by scanning forward for the
 * first THEN. A CASE brings its own THEN, so an unparenthesised CASE inside the
 * condition truncates the expression there and the function fails to compile
 * with "syntax error at end of input" -- pointing at the CASE, which looks
 * perfectly valid, so the real cause is easy to miss.
 *
 * This is not hypothetical: the 2026-08-18 append migration shipped with two
 * of them and could not be applied at all. Nobody noticed because a migration
 * is only ever executed by hand, in production, by the owner -- the one place
 * where discovering a syntax error is most expensive. Wrapping the CASE in
 * parentheses fixes it, because then the scanner counts balanced parens.
 *
 * NOT a CI gate, deliberately. Line-based scanning cannot parse PL/pgSQL
 * reliably -- run against the existing migrations it reports several valid
 * files (CASE in an UPDATE SET, CASE as a statement, CASE in an assignment),
 * and a gate that cries wolf on good code is worse than no gate. It stays as
 * a diagnostic for a migration under review. The real guard is compiling the
 * migration against a throwaway PostgreSQL 16 before it is ever handed over,
 * which is what caught the 2026-08-18 defect.
 */

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'migrations');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

// Strip line comments and string literals so keywords inside them never count.
function scrub(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      out += ' ';
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; out += ' '; continue; }
    if (ch === '-' && line[i + 1] === '-') break;
    out += ch;
  }
  return out;
}

// Walk one file and return every offending "bare CASE inside an IF condition".
function offences(text) {
  const found = [];
  const lines = text.split('\n');
  let inCondition = false;
  let depth = 0;          // paren depth measured from the start of the condition
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = scrub(lines[i]);
    const words = line.toLowerCase();
    let cursor = 0;
    if (!inCondition) {
      // "end if" closes a block, it does not open a condition -- treating it
      // as one leaves the scanner stuck in condition mode for the rest of the
      // file and flags the next CASE it meets, wherever that is.
      const m = /(^|[^a-z_])(if|elsif|elseif)([^a-z_]|$)/.exec(words.replace(/(^|[^a-z_])end\s+if/g, '$1endif'));
      if (!m) continue;
      inCondition = true;
      depth = 0;
      startLine = i + 1;
      cursor = m.index + m[0].length;
    }
    // Scan the rest of this line for parens, a bare CASE, or the closing THEN.
    for (let c = cursor; c < line.length; c++) {
      const ch = line[c];
      if (ch === '(') { depth++; continue; }
      if (ch === ')') { depth--; continue; }
      const rest = words.slice(c);
      if (/^(^|[^a-z_])?case([^a-z_]|$)/.test(rest.slice(0, 5)) && /^case([^a-z_]|$)/.test(rest)) {
        const prev = c === 0 ? ' ' : words[c - 1];
        if (!/[a-z_]/.test(prev) && depth === 0) {
          found.push({ line: i + 1, opened: startLine, text: lines[i].trim() });
        }
        c += 3;
        continue;
      }
      if (/^then([^a-z_]|$)/.test(rest)) {
        const prev = c === 0 ? ' ' : words[c - 1];
        if (!/[a-z_]/.test(prev) && depth === 0) { inCondition = false; break; }
      }
    }
  }
  return found;
}

// --- self-check: the rule must actually catch the shape that broke --------
const BAD = "begin\n  if t is distinct from case when t = 'g' then 'a' else 'b' end then\n    null;\n  end if;\nend";
const GOOD = "begin\n  if t is distinct from (case when t = 'g' then 'a' else 'b' end) then\n    null;\n  end if;\nend";
ok(offences(BAD).length === 1, 'the rule flags an unparenthesised CASE inside an IF condition');
ok(offences(GOOD).length === 0, 'the rule accepts the same CASE once parenthesised');
ok(offences("-- if x is distinct from case when y then z end then\nselect 1;").length === 0,
'a CASE inside a comment is not flagged');
ok(offences("begin\n  if a then null; end if;\n  x := case when b then 1 else 2 end;\nend").length === 0,
'a CASE after "end if" is not flagged: end-if must not open a new condition');

// --- the real migrations --------------------------------------------------
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  : [];
ok(files.length > 0, 'migrations directory has SQL files to check');

for (const f of files) {
  const hits = offences(fs.readFileSync(path.join(dir, f), 'utf8'));
  ok(hits.length === 0, 'no bare CASE in an IF condition: ' + f
    + (hits.length ? ' -> line ' + hits[0].line + ': ' + hits[0].text.slice(0, 70) : ''));
}

if (failures) process.exit(1);
console.log('\nPL/pgSQL IF-condition CASE checks passed (' + files.length + ' migration files)');

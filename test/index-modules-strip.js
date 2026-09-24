'use strict';
/*
 * index-modules-strip.js -- the build's module strip rule (scripts/index-modules.js).
 *
 * Phase C step C3 writes some src/index/ fragments as ES modules: an import
 * header at column 0, the original bytes, an export footer at column 0. The
 * page is still one classic script, so build-index.js and check-index.js
 * serve such a fragment WITHOUT the header and footer. If the rule ever took
 * a byte too many or too few the served page would change, so its edges are
 * pinned here, offline and dependency-free. (The full proof that the served
 * page equals main's is `node scripts/check-modules.js --against=origin/main`.)
 */
const fs = require('fs');
const path = require('path');
const { splitModuleFragment, servedBytes, readModuleList } = require('../scripts/index-modules');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
const b = (s) => Buffer.from(s, 'utf8');
const body = '    /* banner */\n    function f() { return 1; }\n    window.f = f;\n\n';

// 1. A fragment with no header or footer is served whole.
{
  const parts = splitModuleFragment(b(body));
  ok(parts.header.length === 0 && parts.footer.length === 0 && parts.body.equals(b(body)),
    'no header and no footer: the whole fragment is served');
}

// 2. Single-line and wrapped imports, plus a wrapped export list, strip exactly.
{
  const header = "import { a, b } from './040-shared-briefs.js';\nimport {\n  c,\n  d\n} from './070-workload-source.js';\n";
  const footer = 'export {\n  f\n};\n';
  const parts = splitModuleFragment(b(header + body + footer));
  ok(parts.header.toString() === header, 'the header is every import statement at the top, wrapped ones included');
  ok(parts.body.equals(b(body)), 'the served body is the original bytes exactly');
  ok(parts.footer.toString() === footer, 'the footer runs from the first column-0 export list to the end');
}

// 3. A module with exports but no imports.
{
  const parts = splitModuleFragment(b(body + 'export { f };\n'));
  ok(parts.header.length === 0 && parts.body.equals(b(body)), 'exports only: header empty, body exact');
}

// 4. Indented import/export text is ordinary code and is never stripped.
{
  const tricky = '    const s = `\n    import { x } from "y";\n    export { x };\n    `;\n';
  const parts = splitModuleFragment(b(tricky));
  ok(parts.body.equals(b(tricky)), 'indented import/export text inside the body is left alone');
}

// 5. An import statement that never ends is refused, not half-stripped.
{
  let threw = false;
  try { splitModuleFragment(b("import {\n  a\n")); } catch (e) { threw = true; }
  ok(threw, 'an unterminated import in the header throws');
}

// 6. Only fragments listed as modules are stripped.
{
  const text = b("import { a } from './040-shared-briefs.js';\n" + body);
  ok(servedBytes('x.js.part', text, new Set()).equals(text), 'a fragment not listed in modules.txt is served untouched');
  ok(servedBytes('x.js.part', text, new Set(['x.js.part'])).equals(b(body)), 'a listed fragment is served without its header');
}

// 7. The real module list names real fragments, each with a column-0 header or footer.
{
  const srcDir = path.join(__dirname, '..', 'src', 'index');
  const manifest = fs.readFileSync(path.join(srcDir, 'manifest.txt'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (const m of readModuleList(srcDir)) {
    ok(manifest.includes(m), `modules.txt entry ${m} is in the manifest`);
    const parts = splitModuleFragment(fs.readFileSync(path.join(srcDir, m)));
    ok(parts.header.length + parts.footer.length > 0, `${m} carries an import header or an export footer`);
  }
}

if (failures) {
  console.error(`\n${failures} module strip check(s) failed`);
  process.exit(1);
}
console.log('\nmodule strip rule checks passed');

'use strict';
/*
 * index-modules.js -- the "strip rule" of phase C step C3
 * (docs/plans/2026-09-24-modularization-c3-plan.md, "The mechanism").
 *
 * A fragment listed in src/index/modules.txt is written as an ES module:
 *
 *   - an IMPORT HEADER: zero or more `import { a, b } from './040-shared-briefs.js';`
 *     statements at the very top of the fragment, each starting at column 0
 *     (a statement may wrap over several lines and ends at the line whose last
 *     non-space character is `;`);
 *   - the fragment's original bytes, untouched;
 *   - an EXPORT FOOTER: from the first line that starts at column 0 with
 *     `export {` to the end of the file, one or more `export { ... };` lists.
 *
 * The page is still ONE classic script, so the build removes exactly those
 * header and footer lines and keeps everything between them byte for byte.
 * Existing fragment code is indented inside the page's <script>, so a
 * column-0 `import`/`export` line cannot be ordinary code; and whatever this
 * strips, `node scripts/check-modules.js --against=<base>` proves the served
 * page did not change.
 *
 * Dependency-free on purpose: build-index.js and check-index.js use it, and
 * the `unit` CI job installs nothing.
 */

const fs = require('fs');
const path = require('path');

const MODULES_FILE = 'modules.txt';
const NL = 0x0a;

function readModuleList(srcDir) {
  const file = path.join(srcDir, MODULES_FILE);
  if (!fs.existsSync(file)) return new Set();
  return new Set(fs.readFileSync(file, 'utf8')
    .split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')));
}

// Returns { header: Buffer, body: Buffer, footer: Buffer }; body is what the page gets.
function splitModuleFragment(buf) {
  let pos = 0;
  const lineAt = (start) => {
    const nl = buf.indexOf(NL, start);
    const end = nl === -1 ? buf.length : nl + 1;
    return { text: buf.slice(start, end).toString('utf8'), end };
  };
  // Header: consecutive import statements from the top.
  while (pos < buf.length) {
    let line = lineAt(pos);
    if (!/^import[\s{]/.test(line.text)) break;
    let end = line.end;
    while (!/;\s*$/.test(line.text)) {
      if (end >= buf.length) throw new Error('unterminated import statement in module header');
      line = lineAt(end);
      end = line.end;
    }
    pos = end;
  }
  const headerEnd = pos;
  // Footer: the first column-0 `export {` line to the end of the file.
  let footerStart = buf.length;
  if (buf.slice(headerEnd, headerEnd + 8).toString('utf8') === 'export {') footerStart = headerEnd;
  else {
    const at = buf.indexOf('\nexport {', headerEnd);
    if (at !== -1) footerStart = at + 1;
  }
  return {
    header: buf.slice(0, headerEnd),
    body: buf.slice(headerEnd, footerStart),
    footer: buf.slice(footerStart),
  };
}

function servedBytes(name, buf, modules) {
  return modules.has(name) ? splitModuleFragment(buf).body : buf;
}

module.exports = { MODULES_FILE, readModuleList, splitModuleFragment, servedBytes };

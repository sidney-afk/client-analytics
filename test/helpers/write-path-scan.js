'use strict';
/* write-path-scan.js -- finds every place the page's own code sends something
 * other than a plain read (a fetch with a method other than GET, an XMLHttpRequest
 * open, a sendBeacon) and the function it sits in.
 *
 * Used by test/write-path-refusal-coverage.js (Priority 4, failed-saves log):
 * every such place must be accounted for in test/fixtures/write-path-inventory.json,
 * so a new save cannot be added without deciding how its refusals are recorded.
 * A heuristic on purpose: it reads the fragments as text, the way the other
 * source checks do, and the inventory is keyed the same way the scan keys.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'src', 'index');

function fragments() {
  return fs.readdirSync(SRC).filter(f => /\.part$/.test(f) && !/\.css\.part$/.test(f)).sort();
}
function read(fragment) { return fs.readFileSync(path.join(SRC, fragment), 'utf8'); }

function functionName(line, previous) {
  let m = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line);
  if (m) return m[1];
  m = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/.exec(line);
  if (m && line.length - line.trimStart().length <= 8) return m[1];
  return previous;
}

function scan() {
  const sites = [];
  for (const fragment of fragments()) {
    const lines = read(fragment).split('\n');
    let fn = '(top level)';
    lines.forEach((line, index) => {
      fn = functionName(line, fn);
      const block = lines.slice(index, index + 10).map(l => l.trim()).join(' ');
      let method = null, target = '';
      if (/\bfetch\(/.test(line)) {
        let m = /method\s*:\s*['"](\w+)['"]/.exec(block);
        // fetch(url, options): the options object was built a few lines above.
        if (!m && /\bfetch\(\s*[^,)]+,\s*[A-Za-z_$][\w$]*\s*\)/.test(line)) {
          m = /method\s*:\s*['"](\w+)['"]/.exec(lines.slice(Math.max(0, index - 30), index).join(' '));
        }
        method = m ? m[1].toUpperCase() : (/\bmethod\b/.test(block) ? 'VAR' : 'GET');
        const t = /fetch\(\s*([^,)\s]{1,60})/.exec(line);
        target = t ? t[1] : '';
      } else if (/\b\w*[xX]hr\.open\(/.test(line)) {
        const m = /open\(\s*['"](\w+)['"]\s*,\s*([^,)\s]{1,60})/.exec(line);
        method = m ? m[1].toUpperCase() : 'VAR'; target = m ? m[2] : '';
      } else if (/navigator\.sendBeacon\(/.test(line)) {
        method = 'BEACON';
        const t = /sendBeacon\(\s*([^,)\s]{1,60})/.exec(line);
        target = t ? t[1] : '';
      }
      if (!method || method === 'GET' || method === 'HEAD') return;
      sites.push({ fragment, line: index + 1, fn, target, method });
    });
  }
  return sites;
}
const keyOf = s => `${s.fragment}|${s.fn}|${s.target}|${s.method}`;

// The source of one named function across all fragments (brace matching).
function functionSource(name) {
  const re = new RegExp(`(?:^|\\n)([ \\t]*(?:export\\s+)?(?:async\\s+)?function\\s+${name.replace(/\$/g, '\\$')}\\s*\\()`);
  for (const fragment of fragments()) {
    const text = read(fragment);
    const m = re.exec(text);
    if (!m) continue;
    let i = text.indexOf('{', m.index + m[0].length);
    let depth = 0;
    const start = m.index;
    let quote = null;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (!quote && c === '/' && text[j + 1] === '/') { j = text.indexOf('\n', j); if (j < 0) break; continue; }
      if (!quote && c === '/' && text[j + 1] === '*') { j = text.indexOf('*/', j + 2); if (j < 0) break; j++; continue; }
      if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
      if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return text.slice(start, j + 1); }
    }
  }
  return null;
}

module.exports = { scan, keyOf, functionSource, fragments, read };

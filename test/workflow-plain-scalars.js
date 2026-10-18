'use strict';
/*
 * Every workflow file must stay readable by GitHub. A step name written as a
 * plain (unquoted) value that contains ": " is not valid YAML, and GitHub then
 * runs NONE of that workflow's jobs. That failure shows no failed check on the
 * pull request, so nothing stopped it: on 2026-10-18 one such step name in
 * calendar-unit-tests.yml (from a merged PR) left main with no unit or browser
 * tests at all. This catches that class without a YAML library (the unit lane
 * installs nothing): a `name:`, `run:` or `if:` value that is a plain scalar
 * and contains ": " or " #" fails here. Quote the value instead.
 */
const fs = require('fs');
const path = require('path');
const dir = path.resolve(__dirname, '..', '.github', 'workflows');
const files = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f));
let bad = 0;
for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    const m = line.match(/^\s*(?:-\s+)?(name|run|if):\s+(.*)$/);
    if (!m) return;
    const v = m[2].trim();
    if (!v || /^['"|>{[&*!]/.test(v) || /^\$\{\{.*\}\}$/.test(v)) return;
    if (/: /.test(v) || / #/.test(v)) {
      bad++;
      console.log(`FAIL ${f}:${i + 1} plain ${m[1]} value contains ": " or " #"; quote it`);
    }
  });
}
if (bad) { console.log(`workflow-plain-scalars: ${bad} problem(s)`); process.exit(1); }
console.log(`workflow-plain-scalars: ${files.length} workflow files, all plain values safe`);

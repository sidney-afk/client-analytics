'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  BEGIN,
  END,
  extractChecklist,
  renderChecklist,
  run,
  sha256,
} = require('../scripts/f27-install-checklist');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log(`  ok  ${message}`);
  else {
    failures++;
    console.error(`FAIL  ${message}`);
  }
}

function throws(fn, pattern, message) {
  try {
    fn();
    ok(false, message);
  } catch (error) {
    ok(pattern.test(String(error && error.message || error)), message);
  }
}

const fixture = Buffer.from([
  '# Runbook',
  '',
  BEGIN,
  '## Operator checklist',
  '',
  '- [ ] One exact gate.',
  END,
  '',
].join('\n'));

const rendered = renderChecklist(fixture);
ok(extractChecklist(fixture.toString()).includes('One exact gate'),
  'the marked runbook block is the only checklist source');
ok(rendered.includes(`Complete-runbook SHA-256: \`${sha256(fixture)}\``),
  'the generated checklist binds the complete runbook bytes');
ok(!rendered.includes(BEGIN) && !rendered.includes(END),
  'generator markers do not leak into the operator artifact');
throws(() => extractChecklist('# missing'), /exactly one ordered/, 'missing markers fail closed');
throws(() => extractChecklist(`${BEGIN}\nnot a checklist\n${END}`), /incomplete/,
  'an incomplete source block fails closed');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f27-install-checklist-'));
try {
  const runbook = path.join(root, 'runbook.md');
  const checklist = path.join(root, 'checklist.md');
  fs.writeFileSync(runbook, fixture);
  const written = run('--write', runbook, checklist);
  ok(written.status === 'PASS' && fs.readFileSync(checklist, 'utf8') === rendered,
    'write mode creates the deterministic artifact');
  ok(run('--check', runbook, checklist).status === 'PASS',
    'check mode accepts an exact generated artifact');
  fs.appendFileSync(checklist, 'tamper\n');
  throws(() => run('--check', runbook, checklist), /stale/,
    'check mode rejects manual or stale edits');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (failures) process.exit(1);
console.log('f27 install checklist tests: PASS');

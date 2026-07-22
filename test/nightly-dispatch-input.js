'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  NIGHTLY_PROBES_ENV,
  NIGHTLY_SCENARIO_ENV,
  parseProbeSelection,
  parseScenarioFilter,
} = require('../qa/nightly-input.js');

const ROOT = path.resolve(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

assert.deepEqual(
  parseProbeSelection('p30_linear_client p36_full_sync.js'),
  ['p30_linear_client.js', 'p36_full_sync.js'],
  'calendar dispatch selection is split inside Node',
);
assert.equal(
  parseScenarioFilter('kasper_undo, resolve_via'),
  'kasper_undo,resolve_via',
  'samples dispatch filter is normalized inside Node',
);

for (const fixture of [
  'p30_linear_client;node injection-marker.js',
  'p30_linear_client && node injection-marker.js',
  'p30_linear_client$(node injection-marker.js)',
  '../../injection-marker',
]) {
  assert.throws(() => parseProbeSelection(fixture), /Invalid nightly probe selection/);
}
for (const fixture of [
  'clean_both;node injection-marker.js',
  'clean_both,$(node injection-marker.js)',
  'clean_both,../../injection-marker',
]) {
  assert.throws(() => parseScenarioFilter(fixture), /Invalid nightly scenario filter/);
}

const marker = path.join(os.tmpdir(), `syncview-dispatch-injection-${process.pid}-${Date.now()}`);
try { fs.rmSync(marker, { force: true }); } catch {}
const modulePath = path.join(ROOT, 'qa/nightly-input.js');
const injection = `p30_linear_client;${process.execPath} -e "require('fs').writeFileSync(${JSON.stringify(marker)},'owned')"`;
const childScript = `
  const fs = require('node:fs');
  const {
    NIGHTLY_PROBES_ENV,
    NIGHTLY_SCENARIO_ENV,
    parseProbeSelection,
    parseScenarioFilter,
  } = require(${JSON.stringify(modulePath)});
  let rejected = 0;
  try { parseProbeSelection(process.env[NIGHTLY_PROBES_ENV]); } catch (error) { if (error.message === 'Invalid nightly probe selection') rejected++; }
  try { parseScenarioFilter(process.env[NIGHTLY_SCENARIO_ENV]); } catch (error) { if (error.message === 'Invalid nightly scenario filter') rejected++; }
  if (fs.existsSync(${JSON.stringify(marker)})) process.exit(9);
  process.stdout.write('rejected=' + rejected + '\\n');
  process.exit(rejected === 2 ? 0 : 8);
`;
const child = spawnSync(process.execPath, ['-e', childScript], {
  cwd: ROOT,
  encoding: 'utf8',
  shell: false,
  env: {
    ...process.env,
    [NIGHTLY_PROBES_ENV]: injection,
    [NIGHTLY_SCENARIO_ENV]: `clean_both;${injection}`,
  },
});
assert.equal(child.status, 0, child.stderr || child.stdout);
assert.match(child.stdout, /rejected=2/);
assert.equal(fs.existsSync(marker), false, 'dispatch metacharacters remain inert data and cannot execute');

const actualRunnerCases = [
  {
    label: 'calendar probe runner',
    command: path.join(ROOT, 'qa', 'run-probes.js'),
    args: [],
    env: { [NIGHTLY_PROBES_ENV]: injection },
  },
  {
    label: 'samples master runner',
    command: path.join(ROOT, 'qa', 'master.js'),
    args: ['--lane=unit'],
    env: { [NIGHTLY_SCENARIO_ENV]: `clean_both;${injection}` },
  },
];
for (const runner of actualRunnerCases) {
  const result = spawnSync(process.execPath, [runner.command, ...runner.args], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    timeout: 15000,
    env: { ...process.env, ...runner.env },
  });
  assert.equal(result.status, 2, `${runner.label} did not reject dispatch input:\n${result.stderr || result.stdout}`);
  assert.equal(fs.existsSync(marker), false, `${runner.label} executed the dispatch marker`);
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(output.includes(injection), false, `${runner.label} echoed the untrusted dispatch payload`);
}

const partialSelection = spawnSync(
  process.execPath,
  [path.join(ROOT, 'qa', 'run-probes.js')],
  {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    timeout: 15000,
    env: {
      ...process.env,
      [NIGHTLY_PROBES_ENV]: 'p94_nav_full_quota synthetic_missing_probe',
    },
  },
);
assert.equal(partialSelection.status, 2, partialSelection.stderr || partialSelection.stdout);
assert.match(
  `${partialSelection.stdout || ''}\n${partialSelection.stderr || ''}`,
  /Unknown probe selection: synthetic_missing_probe\.js/,
  'the actual runner rejects a mixed valid-plus-missing selection instead of running partially green',
);

const calendarWorkflow = read('.github/workflows/calendar-e2e-nightly.yml');
assert.ok(
  calendarWorkflow.includes(`SYNCVIEW_NIGHTLY_PROBES: \${{ github.event.inputs.probes || '' }}`),
  'calendar dispatch input enters through a step environment variable',
);
assert.equal(
  (calendarWorkflow.match(/github\.event\.inputs\.probes/g) || []).length,
  1,
  'calendar dispatch input appears only in its safe step environment binding',
);
assert.match(calendarWorkflow, /run:\s*node qa\/run-probes\.js\s*$/m);
assert.equal(
  /run:[^\n]*\$\{\{\s*github\.event\.inputs\.probes/.test(calendarWorkflow),
  false,
  'calendar dispatch input is never interpolated into a shell command',
);

const samplesWorkflow = read('.github/workflows/samples-e2e-nightly.yml');
assert.ok(
  samplesWorkflow.includes(`SYNCVIEW_NIGHTLY_SCN: \${{ github.event.inputs.scn || '' }}`),
  'samples dispatch input enters through a step environment variable',
);
assert.equal(
  (samplesWorkflow.match(/github\.event\.inputs\.scn/g) || []).length,
  1,
  'samples dispatch input appears only in its safe step environment binding',
);
assert.match(samplesWorkflow, /run:\s*node qa\/master\.js --lane=unit,parity,realtime,scenarios,tree\s*$/m);
assert.equal(
  /run:[^\n]*\$\{\{\s*github\.event\.inputs\.scn/.test(samplesWorkflow),
  false,
  'samples dispatch input is never interpolated into a shell command',
);

assert.ok(
  read('qa/run-probes.js').includes('parseProbeSelection(process.env[NIGHTLY_PROBES_ENV])'),
  'calendar runner parses the environment value inside Node',
);
assert.ok(
  read('qa/master.js').includes('parseScenarioFilter(envSource[NIGHTLY_SCENARIO_ENV])'),
  'samples master parses the environment value inside Node',
);

console.log('Nightly dispatch input checks: ok');

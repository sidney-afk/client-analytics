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
const { base: flatScenarioBase } = require('../qa/scenarios.js');
const { base: treeScenarioBase } = require('../qa/scenario_tree.js');
const {
  ScenarioSelectionError,
  buildScenarioCatalogs,
  selectScenarioLane,
  selectScenarioLanes,
} = require('../qa/scenario-selection.js');

const ROOT = path.resolve(__dirname, '..');
const scenarioCatalogs = buildScenarioCatalogs(flatScenarioBase(), treeScenarioBase());

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

const TREE_ONLY_SCENARIO = 'video__smm_approve__kasper_request__finish';
const flatOnly = selectScenarioLanes('resolve_via', scenarioCatalogs);
assert.equal(flatOnly.flat.skipped, false);
assert.equal(flatOnly.flat.specs.length, 5, 'flat-only selector keeps its real visible route scenarios');
assert.equal(flatOnly.tree.skipped, true, 'flat-only selector safely skips the tree lane');
assert.equal(flatOnly.visual.catalogLane, 'flat', 'visual selection maps to the flat scenario catalog');
assert.deepEqual(
  flatOnly.visual.specs.map(spec => spec.key),
  flatOnly.flat.specs.map(spec => spec.key),
  'visual selection executes the same visible flat scenarios',
);

const treeOnly = selectScenarioLanes(TREE_ONLY_SCENARIO, scenarioCatalogs);
assert.equal(treeOnly.flat.skipped, true, 'tree-only selector safely skips the flat lane');
assert.deepEqual(treeOnly.tree.specs.map(spec => spec.key), [TREE_ONLY_SCENARIO]);
assert.equal(treeOnly.visual.skipped, true, 'tree-only selector safely skips visual capture');

const mixedCatalogs = selectScenarioLanes(`resolve_via,${TREE_ONLY_SCENARIO}`, scenarioCatalogs);
assert.equal(mixedCatalogs.flat.specs.length, 5, 'mixed selector runs its flat-local OR subset');
assert.deepEqual(mixedCatalogs.tree.specs.map(spec => spec.key), [TREE_ONLY_SCENARIO]);
const sharedSelector = selectScenarioLanes('client_approve', scenarioCatalogs);
assert.ok(sharedSelector.flat.specs.length > 0, 'shared substring selects flat scenarios');
assert.ok(sharedSelector.tree.specs.length > 0, 'shared substring selects tree scenarios');

for (const blank of [null, undefined, '', '   ']) {
  const all = selectScenarioLanes(blank, scenarioCatalogs);
  assert.equal(all.flat.specs.length, scenarioCatalogs.flat.length, 'blank selector means all flat scenarios');
  assert.equal(all.tree.specs.length, scenarioCatalogs.tree.length, 'blank selector means all tree scenarios');
  assert.equal(all.flat.skipped, false);
  assert.equal(all.tree.skipped, false);
}
assert.throws(
  () => selectScenarioLane(null, 'tree', buildScenarioCatalogs([{ key: 'flat_ok' }], [])),
  error => error instanceof ScenarioSelectionError && error.code === 'empty-catalog',
  'blank/all fails closed when its approved local catalog is unexpectedly empty',
);
assert.equal(
  buildScenarioCatalogs([{ key: 'one' }, { key: 'one' }], []).flat.length,
  1,
  'catalog construction deduplicates scenario keys before execution',
);
assert.equal(
  new Set(mixedCatalogs.flat.specs.map(spec => spec.key)).size,
  mixedCatalogs.flat.specs.length,
  'lane-local scenario execution contains no duplicate keys',
);

for (const unknown of ['synthetic_missing_scenario', 'resolve_via,synthetic_missing_scenario']) {
  assert.throws(
    () => selectScenarioLane(unknown, 'flat', scenarioCatalogs),
    error => error instanceof ScenarioSelectionError
      && error.code === 'unknown'
      && !error.message.includes(unknown),
    'unknown and mixed-unknown selectors fail globally with a sanitized error',
  );
}
for (const duplicate of ['resolve_via,resolve_via', 'resolve_via,client_approve,resolve_via']) {
  assert.throws(
    () => selectScenarioLane(duplicate, 'flat', scenarioCatalogs),
    error => error instanceof ScenarioSelectionError
      && error.code === 'duplicate'
      && !error.message.includes(duplicate),
    'duplicate selector components fail closed before execution',
  );
}
for (const malformed of ['resolve_via,', ',', 'resolve_via,$(marker)', 'resolve_via;marker']) {
  assert.throws(
    () => selectScenarioLane(malformed, 'flat', scenarioCatalogs),
    error => error instanceof ScenarioSelectionError
      && error.code === 'invalid'
      && !error.message.includes(malformed),
    'malformed selectors fail with a sanitized error',
  );
}

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
  'kasper_undo,',
  ',',
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

for (const treeArgs of [[], ['--tree']]) {
  for (const scenarioInput of [
    'kasper_undo,synthetic_missing_scenario',
    'kasper_undo,kasper_undo',
    'kasper_undo,',
    ',',
  ]) {
    const scenarioSelection = spawnSync(
      process.execPath,
      [path.join(ROOT, 'qa', 'probes', 'run_scenarios.js'), scenarioInput, ...treeArgs],
      {
        cwd: ROOT,
        encoding: 'utf8',
        shell: false,
        timeout: 15000,
        env: { ...process.env },
      },
    );
    const lane = treeArgs.length ? 'tree' : 'flat';
    const scenarioOutput = `${scenarioSelection.stdout || ''}\n${scenarioSelection.stderr || ''}`;
    assert.equal(
      scenarioSelection.status,
      2,
      `${lane} scenario runner accepted an unsafe selector set:\n${scenarioOutput}`,
    );
    assert.match(
      scenarioOutput,
      /(?:one or more scenario selectors are unknown|duplicate scenario selectors are not allowed|invalid scenario selector input)/,
      `${lane} scenario runner did not report a fail-closed selection error`,
    );
    assert.equal(
      scenarioOutput.includes(scenarioInput),
      false,
      `${lane} scenario runner echoed the untrusted selector text`,
    );
  }
}

const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncview-scenario-selection-'));
const guardPreload = path.join(guardDir, 'preload.js');
const guardMarker = path.join(guardDir, 'guard-called.txt');
fs.writeFileSync(guardPreload, String.raw`
'use strict';
const fs = require('node:fs');
const Module = require('node:module');
const marker = process.env.SYNCVIEW_SCENARIO_GUARD_MARKER;
function trip(kind) {
  if (marker) fs.appendFileSync(marker, kind + '\n');
  throw new Error('blocked scenario side effect');
}
const originalLoad = Module._load;
Module._load = function guardedLoad(request, parent, isMain) {
  if (process.env.SYNCVIEW_EMPTY_SCENARIO_CATALOG === 'tree'
      && /(?:^|[\\/])scenario_tree(?:\.js)?$/.test(String(request))) {
    return { base: () => [] };
  }
  if (/(?:^|[\\/])(?:sxr_courier_lib|scenario_engine)(?:\.js)?$/.test(String(request))) {
    trip('live-loader');
  }
  return originalLoad.call(this, request, parent, isMain);
};
if (process.env.SYNCVIEW_BLOCK_CHILD_PROCESSES === '1') {
  const childProcess = require('node:child_process');
  childProcess.spawn = function blockedSpawn() { trip('spawn'); };
  childProcess.spawnSync = function blockedSpawnSync() { trip('spawnSync'); };
}
`);

function guardedNode(args, extraEnv = {}) {
  try { fs.rmSync(guardMarker, { force: true }); } catch {}
  const nodeOptions = [process.env.NODE_OPTIONS, `--require=${guardPreload}`].filter(Boolean).join(' ');
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    timeout: 15000,
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      SYNCVIEW_SCENARIO_GUARD_MARKER: guardMarker,
      ...extraEnv,
    },
  });
}

for (const fixture of [
  { selector: 'resolve_via', args: ['--tree'], lane: 'tree' },
  { selector: TREE_ONLY_SCENARIO, args: [], lane: 'flat' },
]) {
  const result = guardedNode([
    path.join(ROOT, 'qa/probes/run_scenarios.js'),
    fixture.selector,
    ...fixture.args,
  ]);
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(result.status, 0, output);
  assert.match(
    output,
    new RegExp(`SCENARIO_SELECTION_SKIP lane=${fixture.lane} reason=no-local-match`),
    'valid union selector emits a stable lane-local skip marker',
  );
  assert.equal(fs.existsSync(guardMarker), false, 'lane-local skip imports no live courier or scenario engine');
}

for (const fixture of [
  'synthetic_missing_scenario',
  'resolve_via,synthetic_missing_scenario',
  'resolve_via,resolve_via',
  'resolve_via,',
  'resolve_via,$(marker)',
]) {
  const result = guardedNode([path.join(ROOT, 'qa/probes/run_scenarios.js'), fixture]);
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(result.status, 2, output);
  assert.equal(output.includes(fixture), false, 'rejected selector is never echoed');
  assert.equal(fs.existsSync(guardMarker), false, 'rejected selector imports no live courier or scenario engine');
}
{
  const result = guardedNode(
    [path.join(ROOT, 'qa/probes/run_scenarios.js'), '--tree'],
    { SYNCVIEW_EMPTY_SCENARIO_CATALOG: 'tree' },
  );
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(result.status, 2, output);
  assert.match(output, /RUNNER ERROR: approved scenario catalog is empty/);
  assert.equal(fs.existsSync(guardMarker), false, 'empty all-catalog failure imports no live courier or scenario engine');
}
for (const fixtureArgs of [
  ['--synthetic_missing_scenario'],
  ['resolve_via', 'synthetic_missing_scenario'],
]) {
  const result = guardedNode([path.join(ROOT, 'qa/probes/run_scenarios.js'), ...fixtureArgs]);
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(result.status, 2, output);
  for (const value of fixtureArgs) assert.equal(output.includes(value), false, 'invalid runner grammar is never echoed');
  assert.equal(fs.existsSync(guardMarker), false, 'invalid runner grammar imports no live courier or scenario engine');
}
for (const fixtureArgs of [
  ['--lane=tree', '--scn', 'resolve_via'],
  ['--lane=tree', '--scn'],
  ['--lane=tree', '--synthetic_missing_scenario'],
  ['--lane=tree', 'resolve_via'],
  ['--lane=tree', '--scn=resolve_via', '--scn=client_approve'],
]) {
  const result = guardedNode(
    [path.join(ROOT, 'qa/master.js'), ...fixtureArgs],
    { SYNCVIEW_BLOCK_CHILD_PROCESSES: '1' },
  );
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(result.status, 2, output);
  assert.match(output, /MASTER ERROR: invalid scenario selector input/);
  for (const value of fixtureArgs.slice(1)) {
    assert.equal(output.includes(value), false, 'invalid master selector grammar is never echoed');
  }
  assert.equal(fs.existsSync(guardMarker), false, 'invalid master selector grammar starts no server or child harness');
}

function snapshot(relative) {
  const absolute = path.join(ROOT, relative);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute) : null;
}
const artifactPaths = [
  'qa/MASTER_REPORT.md',
  'qa/visual/manifest.json',
  'qa/visual/VISUAL_REVIEW.md',
];
const artifactBefore = new Map(artifactPaths.map(relative => [relative, snapshot(relative)]));
const reportsDir = path.join(ROOT, 'qa/reports');
const reportsBefore = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir).sort() : [];
const shotDir = path.join(guardDir, 'shots');

for (const fixture of [
  { lane: 'tree', selector: 'resolve_via', extraArgs: ['--until=1s'] },
  { lane: 'visual', selector: TREE_ONLY_SCENARIO, extraArgs: [] },
]) {
  const result = guardedNode([
    path.join(ROOT, 'qa/master.js'),
    `--lane=${fixture.lane}`,
    `--scn=${fixture.selector}`,
    ...fixture.extraArgs,
  ], {
    SYNCVIEW_BLOCK_CHILD_PROCESSES: '1',
    SXR_SCN_SHOTS: shotDir,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(result.status, 0, output);
  assert.match(output, new RegExp(`SCENARIO_SELECTION_SKIP lane=${fixture.lane} reason=no-local-match`));
  assert.equal(output.includes('Starting static server'), false, 'all-skipped master lane does not start a server');
  assert.equal(output.includes('ITERATION 2'), false, 'an all-skipped repeated master plan terminates after one truthful skip');
  assert.equal(fs.existsSync(guardMarker), false, 'all-skipped master lane starts no browser or child harness');
}
assert.equal(fs.existsSync(shotDir), false, 'visual skip creates no screenshot directory');
for (const relative of artifactPaths) {
  assert.deepEqual(snapshot(relative), artifactBefore.get(relative), `${relative} is untouched by all-skipped lanes`);
}
assert.deepEqual(
  fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir).sort() : [],
  reportsBefore,
  'all-skipped master lanes create no report artifacts',
);
fs.rmSync(guardDir, { recursive: true, force: true });

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

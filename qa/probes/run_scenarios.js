// run_scenarios.js — runs the scenario library against the live backend.
// Usage: node qa/probes/run_scenarios.js [keyFilter] [--shots]
// --tree sources specs from the branching scenario tree (compiled to flat paths);
// otherwise the flat scenario library. Both yield the same {key,title,seed,steps}.
const runnerArgs = process.argv.slice(2);
const knownFlags = new Set(['--tree', '--shots']);
const unknownFlags = runnerArgs.filter(value => value.startsWith('--') && !knownFlags.has(value));
const positionalFilters = runnerArgs.filter(value => !value.startsWith('--'));
if (unknownFlags.length || positionalFilters.length > 1) {
  console.error('RUNNER ERROR: invalid scenario selector input');
  process.exit(2);
}
const useTree = runnerArgs.includes('--tree');
const lane = useTree ? 'tree' : 'flat';
const rawFilter = positionalFilters.length ? positionalFilters[0] : null;
const { base: flatBase } = require('../scenarios.js');
const { base: treeBase } = require('../scenario_tree.js');
const {
  ScenarioSelectionError,
  buildScenarioCatalogs,
  selectScenarioLane,
} = require('../scenario-selection.js');

let selection;
try {
  selection = selectScenarioLane(
    rawFilter,
    lane,
    buildScenarioCatalogs(flatBase(), treeBase()),
  );
} catch (error) {
  const message = error instanceof ScenarioSelectionError
    ? error.message
    : 'scenario selection failed';
  console.error(`RUNNER ERROR: ${message}`);
  process.exit(2);
}
if (selection.skipped) {
  console.log(`SCENARIO_SELECTION_SKIP lane=${lane} reason=no-local-match`);
  process.exit(0);
}
const forceShots = process.argv.includes('--shots');
const SHOT_DIR = process.env.SXR_SCN_SHOTS || '/tmp/qa/scn';

(async () => {
  const ts = Date.now();
  let specs = [...selection.specs];
  // Load the live harness only after the complete selector set is known-safe.
  // Invalid manual-dispatch input therefore fails without opening a browser or
  // touching a credential-bearing transport.
  const { launch } = require('../sxr_courier_lib.js');
  const { runScenario } = require('../scenario_engine.js');
  // stamp unique id + name per scenario
  specs = specs.map((s, i) => ({ ...s, id: 'sr_scn_' + s.key + '_' + ts + '_' + i, name: 'SCN ' + s.key + ' ' + ts }));

  console.log(`Running ${specs.length} scenarios against the LIVE backend...\n`);
  const browser = await launch();
  const results = [];
  try {
    for (const scn of specs) {
      const t0 = Date.now();
      const r = await runScenario(browser, scn, SHOT_DIR, forceShots || !!scn.shots);
      r.ms = Date.now() - t0;
      results.push(r);
      const status = r.fail === 0 ? 'PASS' : 'FAIL';
      console.log(`[${status}] ${r.key.padEnd(22)} ${r.ok}/${r.ok + r.fail}  (${(r.ms / 1000).toFixed(0)}s)`);
      if (r.fail > 0) r.log.filter(l => !l.pass).forEach(l => console.log(`        ✗ ${l.msg}${l.extra ? '  [' + l.extra + ']' : ''}`));
    }
  } finally { await browser.close(); }

  const totalOk = results.reduce((n, r) => n + r.ok, 0), totalFail = results.reduce((n, r) => n + r.fail, 0);
  const scnPass = results.filter(r => r.fail === 0).length;
  console.log('\n================ SUMMARY ================');
  console.log(`scenarios: ${scnPass}/${results.length} fully green`);
  console.log(`assertions: ${totalOk}/${totalOk + totalFail} passed`);
  console.log(forceShots || specs.some(s => s.shots) ? `screenshots: ${SHOT_DIR}/` : '');
  process.exit(totalFail ? 1 : 0);
})().catch(e => { console.error('RUNNER ERROR', e && e.stack || e); process.exit(2); });

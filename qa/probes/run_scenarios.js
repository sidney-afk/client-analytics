// run_scenarios.js — runs the scenario library against the live backend.
// Usage: node qa/probes/run_scenarios.js [keyFilter] [--shots]
const L = require('../sxr_courier_lib.js');
const { launch } = L;
const { runScenario } = require('../scenario_engine.js');
const { base } = require('../scenarios.js');

const filter = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const forceShots = process.argv.includes('--shots');
const SHOT_DIR = '/tmp/qa/scn';

(async () => {
  const ts = Date.now();
  let specs = base();
  if (filter) { const parts = filter.split(','); specs = specs.filter(s => parts.some(p => s.key.includes(p))); }
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

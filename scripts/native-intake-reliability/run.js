#!/usr/bin/env node
'use strict';
/*
 * Native-intake reliability proof: orchestrator.
 *
 * Three lanes, one disposable database, one JSON report:
 *   sql      real RPC contracts, including a two-session race in PostgreSQL
 *   gateway  the real production-write handler through the test seam
 *   browser  the real index.html intake job machinery in a vm context
 *
 * Every check is CURRENT (what the code does today; must pass) or READINESS
 * (what the Linear-exit gates G2/G3 require; expected red until the mapped
 * change ships). The unit suite fails on a red CURRENT check always, and on a
 * red READINESS check only under NATIVE_INTAKE_READINESS_STRICT=1, so known
 * defects stay visibly red without turning the suite red.
 *
 *   node scripts/native-intake-reliability/run.js               run and print
 *   node scripts/native-intake-reliability/run.js --write-results
 *       also refresh docs/audits/2026-09-05-native-intake-reliability-results.json
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./harness.js');

const RESULTS = path.join(H.ROOT, 'docs', 'audits', '2026-09-05-native-intake-reliability-results.json');

function gitHead() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: H.ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function runGatewayLane(cluster) {
  const env = Object.assign({}, process.env, H.connectionEnv(cluster));
  const r = spawnSync(process.execPath,
    ['--experimental-strip-types', '--no-warnings', path.join(__dirname, 'gateway-lane.mjs')],
    { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const stderr = (r.stderr || '').split('\n').filter(line => !/filming-plan lookup failed|production-write failed injected/.test(line)).join('\n');
  process.stderr.write(stderr);
  const match = /NIR_RESULT_BEGIN\n([\s\S]*?)\nNIR_RESULT_END/.exec(r.stdout || '');
  if (r.status !== 0 || !match) {
    throw new Error('gateway lane did not complete (exit ' + r.status + ')\n' + (r.stdout || '').slice(-2000) + '\n' + (r.stderr || '').slice(-2000));
  }
  return JSON.parse(match[1]);
}

async function run(options = {}) {
  const requirePostgres = process.env.F63_REQUIRE_POSTGRES === '1' || options.requirePostgres === true;
  const postgres = H.have('initdb') && H.have('psql') || !!(process.env.PGHOST || process.env.F42_REHEARSAL_SOCKET);
  const report = {
    generated_at: new Date().toISOString(),
    source_sha: gitHead(),
    node: process.version,
    lanes: {},
    checks: [],
  };

  if (postgres) {
    const cluster = H.bootCluster();
    try {
      report.lanes.sql = 'executed';
      const sql = await require('./sql-lane.js').run(cluster);
      report.checks.push(...sql.checks);
      report.lanes.gateway = 'executed';
      const gateway = runGatewayLane(cluster);
      report.checks.push(...gateway.checks);
      report.gateway_inventory = gateway.inventory;
    } finally {
      cluster.stop();
    }
  } else if (requirePostgres) {
    throw new Error('PostgreSQL 16 is required (F63_REQUIRE_POSTGRES=1) and no initdb/psql or PGHOST is available');
  } else {
    report.lanes.sql = 'skipped_no_postgres';
    report.lanes.gateway = 'skipped_no_postgres';
    console.log('[native-intake-reliability] SKIP sql + gateway lanes: PostgreSQL 16 server binaries not available here');
  }

  report.lanes.browser = 'executed';
  const browser = await require('./browser-lane.js').run();
  report.checks.push(...browser.checks);

  const by = kind => report.checks.filter(c => c.kind === kind);
  report.summary = {
    current: { pass: by('current').filter(c => c.pass).length, fail: by('current').filter(c => !c.pass).length },
    readiness: { pass: by('readiness').filter(c => c.pass).length, fail: by('readiness').filter(c => !c.pass).length },
  };
  if (options.writeResults) {
    fs.writeFileSync(RESULTS, JSON.stringify(report, null, 2) + '\n');
    console.log('[native-intake-reliability] wrote ' + path.relative(H.ROOT, RESULTS));
  }
  return report;
}

function printSummary(report) {
  console.log('\nnative-intake reliability : ' + (report.source_sha || 'unknown sha'));
  for (const lane of Object.keys(report.lanes)) console.log('  lane ' + lane.padEnd(8) + ' ' + report.lanes[lane]);
  console.log('  current   ' + report.summary.current.pass + ' pass / ' + report.summary.current.fail + ' fail');
  console.log('  readiness ' + report.summary.readiness.pass + ' pass / ' + report.summary.readiness.fail + ' fail (expected red until the mapped changes ship)');
  const failedCurrent = report.checks.filter(c => c.kind === 'current' && !c.pass);
  if (failedCurrent.length) {
    console.log('\nCURRENT-BEHAVIOR FAILURES:');
    for (const c of failedCurrent) console.log('  ' + c.id + ' : ' + c.label + '\n      ' + JSON.stringify(c.evidence));
  }
}

if (require.main === module) {
  run({ writeResults: process.argv.includes('--write-results') })
    .then(report => { printSummary(report); process.exit(report.summary.current.fail ? 1 : 0); })
    .catch(error => { console.error('[native-intake-reliability] FAIL ' + (error && error.stack || error)); process.exit(1); });
}

module.exports = { run, printSummary, RESULTS };

'use strict';
// Always offline: actual config/DB-launch adapter plus source scope controls.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), os = require('os');
const cp = require('child_process');
const lane = require('../scripts/track-b-recovery-rehearsal');
const { failureResponse, OUTCOMES } = require('../scripts/track-b-recovery-reconstruct');
const checks = [], check = (name, fn) => { fn(); checks.push(name); };
const env = { TRACK_B_RECOVERY_TEST_CONFIRM: 'LOCAL_DISPOSABLE_ONLY', TRACK_B_RECOVERY_TEST_PGHOST: '127.0.0.1',
  TRACK_B_RECOVERY_TEST_PGPORT: '55599', TRACK_B_RECOVERY_TEST_PGUSER: 'synthetic', TRACK_B_RECOVERY_TEST_PGPASSWORD: 'synthetic',
  TRACK_B_RECOVERY_TEST_PSQL: process.execPath, TRACK_B_RECOVERY_TEST_PG_DUMP: process.execPath,
  TRACK_B_RECOVERY_TEST_OUTPUT: path.join(os.tmpdir(), 'schema-v7-offline-config') };
check('explicit owned-loopback config validates without launching or creating files', () => {
  const result = lane.config(env); assert.equal(result.host, '127.0.0.1'); assert.equal(result.port, '55599');
  assert.equal(result.psql, fs.realpathSync.native(process.execPath));
});
check('every required field refuses absence', () => {
  for (const key of Object.keys(env)) { const bad = { ...env }; delete bad[key]; assert.throws(() => lane.config(bad)); }
});
check('host, port, tool and repository-output misbinding refuse before any transport', () => {
  for (const host of ['localhost', 'example.invalid', '::1']) assert.throws(() => lane.config({ ...env, TRACK_B_RECOVERY_TEST_PGHOST: host }), /loopback/);
  for (const port of ['1', '70000', '5432;select']) assert.throws(() => lane.config({ ...env, TRACK_B_RECOVERY_TEST_PGPORT: port }), /loopback/);
  assert.throws(() => lane.config({ ...env, TRACK_B_RECOVERY_TEST_PSQL: 'psql' }), /absolute_tool/);
  assert.throws(() => lane.config({ ...env, TRACK_B_RECOVERY_TEST_OUTPUT: path.resolve(__dirname, '..', 'private') }), /repository_output/);
});
check('actual SQL adapter strips inherited libpq overrides and binds owned args with no password prompt', () => {
  const keys = ['PGHOSTADDR', 'PGSERVICE', 'PgServiceFile', 'PGOPTIONS', 'NIR_PGHOST', 'CARD_MATERIALIZATION_PHASE'];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]])), original = cp.spawnSync;
  let observed;
  try {
    for (const key of keys) process.env[key] = 'synthetic-unsafe-override';
    cp.spawnSync = (...args) => { observed = args; return { status: 0, stdout: '1', stderr: '' }; };
    const db = new lane.DB(lane.config(env)); assert.equal(db.query('select 1'), '1');
    const [tool, args, opts] = observed; assert.equal(tool, fs.realpathSync.native(process.execPath)); assert.equal(args[0], '-w');
    assert.equal(args[args.indexOf('-h') + 1], '127.0.0.1'); assert.equal(args[args.indexOf('-p') + 1], '55599');
    assert.ok(args.includes(db.name)); assert.equal(opts.env.PGPASSWORD, 'synthetic'); assert.equal(opts.env.PGOPTIONS, '');
    for (const key of keys.filter(key => key !== 'PGOPTIONS')) assert.ok(!Object.keys(opts.env).some(k => k.toLowerCase() === key.toLowerCase()));
  } finally {
    cp.spawnSync = original; for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]; }
  }
});
check('all source pins exist and staged label migration is excluded', () => {
  for (const file of lane.SOURCES) assert.ok(fs.statSync(path.resolve(__dirname, '..', file)).isFile(), file);
  assert.ok(!lane.SOURCES.some(file => file.includes('native-label')));
});
check('prepared37 rehearsal retains failure evidence and never manages a database server or drops a database', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../scripts/track-b-recovery-rehearsal.js'), 'utf8');
  assert.doesNotMatch(source, /\.drop\(|pg_ctl|initdb|drop database|rmSync/);
  assert.match(source, /retained: true/); assert.match(source, /post-COMMIT verification transport refusal/);
  assert.match(source, /late37th-table COPY refusal/); assert.match(source, /restored canonical add receipt/);
  assert.match(source, /2026-09-05-workload-native-membership\.sql/);
});
check('failure guidance only grants empty-target retry when the observed rollback receipt does', () => {
  const unknown = failureResponse(new Error('synthetic validation failure'));
  assert.equal(unknown.outcome, 'failed'); assert.match(unknown.operator_action, /no rollback or retry-in-place claim/);
  for (const receipt of [undefined, { retry_in_place_allowed: false }]) {
    const value = failureResponse({ message: 'refusal', outcome: OUTCOMES.ROLLED_BACK, receipt });
    assert.match(value.operator_action, /retry in place is not authorized/);
  }
  const yes = failureResponse({ message: 'refusal', outcome: OUTCOMES.ROLLED_BACK, receipt: { retry_in_place_allowed: true } });
  assert.match(yes.operator_action, /rollback and empty target confirmed/);
  const committed = failureResponse({ message: 'refusal', outcome: OUTCOMES.COMMITTED_UNVERIFIED });
  assert.equal(committed.quarantine_required, true); assert.match(committed.operator_action, /may hold committed data/);
});
check('actual CLI missing-target and malformed-package refusals make no SQL call or rollback claim', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-v7-cli-'));
  const trap = path.join(dir, 'refuse-child.cjs'), packet = path.join(dir, 'malformed.recovery');
  fs.writeFileSync(trap, "const cp=require('child_process');for(const key of ['spawnSync','spawn','execSync','execFileSync'])cp[key]=()=>{throw Error('FORBIDDEN_SQL_TRANSPORT')};\n");
  fs.writeFileSync(packet, 'synthetic malformed package');
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^TRACK_B|^PG|^NODE_OPTIONS$/i.test(key)));
  try {
    for (const [extra, pattern] of [[{}, /TARGET_URL is required/], [{
      TRACK_B_RECOVERY_TARGET_URL: 'postgresql://synthetic:synthetic@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',
      TRACK_B_RESTORE_EXPECTED_PROJECT_REF: 'abcdefghijklmnopqrst', TRACK_B_RECOVERY_CONFIRM: 'EMPTY_SCRATCH_ONLY',
      TRACK_B_BACKUP_HMAC_KEY: Buffer.alloc(32, 7).toString('base64') }, /recovery package|package is truncated/i]]) {
      const r = cp.spawnSync(process.execPath, ['-r', trap, path.resolve(__dirname, '../scripts/track-b-recovery-reconstruct.js'), packet],
        { encoding: 'utf8', timeout: 10000, windowsHide: true, env: { ...clean, ...extra } });
      assert.equal(r.status, 1); const value = JSON.parse(r.stderr.trim()); assert.match(value.message, pattern);
      assert.equal(value.outcome, 'failed'); assert.match(value.operator_action, /no rollback or retry-in-place claim/);
      assert.doesNotMatch(r.stderr, /FORBIDDEN_SQL_TRANSPORT/);
    }
  } finally { for (const file of [trap, packet]) fs.unlinkSync(file); fs.rmdirSync(dir); }
});
console.log(JSON.stringify({ status: 'PASS', passed: checks.length, checks, proof: 'OFFLINE_CONFIG_AND_INTERCEPTED_PROCESS_ONLY' }));

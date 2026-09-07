'use strict';
// Actual outcome module, intercepted subprocesses only. No database/network.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), Module = require('module');
const crypto = require('crypto');
const filename = path.resolve(__dirname, '../scripts/track-b-recovery-reconstruct.js');
const candidate = fs.readFileSync(filename, 'utf8');
// Optional private negative control uses exact preserved266 bytes; CI needs no
// unpublished commit, network fetch, or baseline artifact to run all new guards.
const baseline = process.env.TRACK_B_RECOVERY_OUTCOME_BASELINE ? fs.readFileSync(process.env.TRACK_B_RECOVERY_OUTCOME_BASELINE, 'utf8') : null;
if (baseline !== null) assert.equal(crypto.createHash('sha256').update(baseline).digest('hex'), '73a688109b77cf44d9733fdcb226e4909bf2ac950ba7c50d4464097a7d752ba6');
const counts = (relations = 0, functions = 0, types = 0) => ({ public_relations: relations, public_functions: functions, public_types: types });
const result = value => ({ status: 0, stdout: JSON.stringify(value) });
function load(source, observations) {
  const instance = new Module(filename, module), calls = [];
  instance.filename = filename; instance.paths = module.paths;
  instance.require = id => id === 'child_process' ? { spawnSync(tool, args) {
    calls.push(args);
    if (args.includes('--command')) {
      const next = observations.shift();
      if (next && Object.hasOwn(next, 'status')) return next;
      // Preserve the real baseline query's narrower observed relation count.
      return { status: 0, stdout: args.at(-1).includes('json_build_object') ? JSON.stringify(next) : String(next.public_relations) };
    }
    assert.ok(args.some(arg => /[\\/]reconstruct\.sql$/.test(arg)));
    return { status: 3, stderr: 'synthetic target prerequisite refusal' };
  } } : id === './track-b-recovery-package' ? {
    reconstructSql: () => 'begin; select 1; commit;', verificationSql: () => 'select 1;',
  } : module.require(id);
  instance._compile(source, filename);
  return { api: instance.exports, calls };
}
function attempt(source, before, after = before) {
  const fixture = load(source, [before, after]); let error;
  try { fixture.api.reconstruct({ manifest: {} }, {}, { psql: 'INTERCEPTED_ONLY' }); } catch (e) { error = e; }
  assert.ok(error && error.receipt); assert.equal(fixture.calls.length, 3);
  return { ...fixture, error, response: fixture.api.failureResponse(error) };
}
const checks = [], check = (name, fn) => { fn(); checks.push(name); };
if (baseline !== null) check('preserved baseline falsely grants empty-target retry for function-only and type-only targets', () => {
  for (const state of [counts(0, 1, 0), counts(0, 0, 1)]) {
    const { error, response } = attempt(baseline, state);
    assert.equal(error.receipt.retry_in_place_allowed, true); assert.match(response.operator_action, /empty target confirmed/);
  }
});
check('function-only and type-only targets retain rollback classification without empty retry permission', () => {
  for (const state of [counts(0, 1, 0), counts(0, 0, 1)]) {
    const { error, response } = attempt(candidate, state);
    assert.equal(error.outcome, 'rolled_back'); assert.equal(error.receipt.retry_in_place_allowed, false);
    assert.equal(error.receipt.target_was_empty_before, false); assert.match(response.operator_action, /not authorized/);
    assert.equal(error.receipt.target_public_relations, 0);
    assert.equal(error.receipt.target_public_functions, state.public_functions); assert.equal(error.receipt.target_public_types, state.public_types);
  }
});
check('genuinely empty observed rollback retains retry permission', () => {
  const { error, response } = attempt(candidate, counts());
  assert.equal(error.receipt.retry_in_place_allowed, true); assert.match(response.operator_action, /empty target confirmed/);
});
check('ordinary populated target stays nonretryable and metrics remain separate', () => {
  const { error } = attempt(candidate, counts(3, 2, 1));
  assert.equal(error.receipt.retry_in_place_allowed, false); assert.equal(error.receipt.target_public_relations, 3);
  assert.equal(error.receipt.target_public_functions, 2); assert.equal(error.receipt.target_public_types, 1);
});
check('appearance of a function or type after ambiguous apply failure requires quarantine', () => {
  for (const state of [counts(0, 1, 0), counts(0, 0, 1)]) {
    const { error } = attempt(candidate, counts(), state);
    assert.equal(error.outcome, 'committed_unverified'); assert.equal(error.receipt.quarantine_required, true);
    assert.equal(error.receipt.retry_in_place_allowed, false);
  }
});
check('missing, malformed, unsafe and string counters never establish an empty observation', () => {
  const bad = ['', '0', 'null', '[]', '{}', '{bad', JSON.stringify({ ...counts(), public_types: null }),
    JSON.stringify({ ...counts(), public_functions: '0' }), JSON.stringify({ ...counts(), public_relations: -1 }),
    JSON.stringify({ ...counts(), public_relations: 9007199254740992 })];
  for (const stdout of bad) {
    const observed = load(candidate, [{ status: 0, stdout }]).api.observeTargetState({}, 'INTERCEPTED_ONLY');
    assert.equal(observed.known, false); assert.equal(observed.public_relations, null);
  }
});
check('failed or unreadable before/after observations never grant retry', () => {
  for (const failed of [{ status: 1, stderr: 'synthetic' }, { status: 0, stdout: '' }]) {
    for (const [before, after] of [[failed, counts()], [counts(), failed]]) {
      const { error } = attempt(candidate, before, after);
      assert.equal(error.outcome, 'committed_unverified'); assert.equal(error.receipt.retry_in_place_allowed, false);
    }
  }
});
check('observation uses the same public relation/type categories and all functions as the SQL admission guard', () => {
  const fixture = load(candidate, [counts()]); fixture.api.observeTargetState({}, 'INTERCEPTED_ONLY');
  const query = fixture.calls[0].at(-1), engine = require('../scripts/track-b-recovery-package');
  const guard = engine.targetPrerequisiteSql({});
  for (const text of ["('r','p','v','m','S','f','c','i','I','t')", "('e','d','r','c')", "pronamespace='public'::regnamespace"])
    assert.ok(query.includes(text) && guard.includes(text));
});
console.log(JSON.stringify({ status: 'PASS', passed: checks.length, checks, baseline_control: baseline === null ? 'NOT_RUN' : 'PASS', proof: 'OFFLINE_ACTUAL_OUTCOME_MODULE_INTERCEPTED_SUBPROCESSES' }));

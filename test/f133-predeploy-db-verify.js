'use strict';

const assert = require('assert');
const { GATE, SQL, main } = require('../scripts/f133-predeploy-db-verify.js');

function spawnReceipt(receipt) {
  return () => ({ status: 0, stdout: `${JSON.stringify(receipt)}\n`, stderr: '' });
}

assert.strictEqual((SQL.match(/begin isolation level repeatable read read only/gi) || []).length, 1);
assert.strictEqual((SQL.match(/^commit;/gim) || []).length, 1);
assert.doesNotMatch(SQL, /^\s*(?:insert|update|delete|alter|drop|create|grant|revoke|truncate|call)\b/im);
assert.match(SQL, /operation='title' and status in \('pending','failed','shadow_ok'\)/);
assert.match(SQL, /value='\{"enabled":false\}'::jsonb/);

const priorExit = process.exitCode;
function run(observed) {
  process.exitCode = 0;
  return main({ F133_DATABASE_URL: 'postgresql://fixture.invalid/db' }, {
    spawnSync: spawnReceipt(observed),
  });
}
for (const flagState of ['absent', 'off']) {
  const receipt = run({ transaction_exact: true, flag_state: flagState, open_title_intent_count: 0 });
  assert.deepStrictEqual(receipt, {
    status: 'PASS', gate: GATE, flag_state: flagState,
    open_title_intent_count: 0, transaction: 'PASS',
  });
  assert.strictEqual(process.exitCode, 0);
}
for (const observed of [
  { transaction_exact: true, flag_state: 'invalid', open_title_intent_count: 0 },
  { transaction_exact: true, flag_state: 'off', open_title_intent_count: 1 },
  { transaction_exact: false, flag_state: 'off', open_title_intent_count: 0 },
  { transaction_exact: true, flag_state: 'off', open_title_intent_count: 0, unexpected: true },
]) {
  const receipt = run(observed);
  assert.strictEqual(receipt.status, 'FAIL');
  assert.strictEqual(process.exitCode, 1);
}
process.exitCode = priorExit;

console.log(JSON.stringify({ status: 'PASS', test: 'f133-predeploy-db-verify' }));

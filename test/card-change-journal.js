'use strict';
const assert = require('assert/strict');
const { localConfig } = require('../scripts/card-change-journal-rehearsal');
assert.throws(() => localConfig({}), /confirmation_required/);
for (const host of ['localhost', 'db.example.invalid', '127.0.0.1.example.invalid', 'https://127.0.0.1', '0.0.0.0']) {
  assert.throws(() => localConfig({ CARD_HISTORY_TEST_CONFIRM: 'LOCAL_DISPOSABLE_ONLY', CARD_HISTORY_PGHOST: host }), /loopback/);
}
for (const port of ['1;drop database x', '99999', '5432/other']) {
  assert.throws(() => localConfig({ CARD_HISTORY_TEST_CONFIRM: 'LOCAL_DISPOSABLE_ONLY', CARD_HISTORY_PGPORT: port }), /port_invalid/);
}
assert.equal(localConfig({ CARD_HISTORY_TEST_CONFIRM: 'LOCAL_DISPOSABLE_ONLY' }).host, '127.0.0.1');
console.log('PASS card-change-journal local target boundary (11 checks); database semantics run separately in the CI SQL rehearsal.');

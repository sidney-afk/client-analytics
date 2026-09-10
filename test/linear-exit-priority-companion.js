'use strict';
const assert = require('assert/strict');
const crypto = require('crypto');
const companion = require('../scripts/linear-exit-priority-companion');
const key = Buffer.alloc(32, 7).toString('base64');
const parent = { package_sha256: 'a'.repeat(64), schema_fingerprint: 'b'.repeat(32) };
const tables = Object.fromEntries(companion.schema().tables.map(t => [t.name, {
  columns: t.columns, primary_key: t.primary_key,
  rows: [t.columns.map(c => c.not_null ? 'synthetic' : null)],
}]));
const noPk = tables.batches_parent_claim_backup_20260824;
noPk.rows = [['9007199254740993', null, 'null'], ['9007199254740993', null, 'null'], ['9007199254740993', 'null', null]];
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
const clone = value => JSON.parse(JSON.stringify(value));
const bytes = companion.encode(tables, parent, key);
check('exact nine-table textual/null round trip including duplicate multiset', () => assert.deepEqual(companion.decode(bytes, parent, key).tables, tables));
check('missing table refused', () => { const t = clone(tables); delete t.workload_issues; assert.throws(() => companion.encode(t, parent, key), /SHAPE/); });
check('extra table refused', () => assert.throws(() => companion.encode({ ...tables, unexpected: {} }, parent, key), /SHAPE/));
check('column contract drift refused', () => { const t = clone(tables); t.workload_issues.columns[0].type = 'bigint'; assert.throws(() => companion.encode(t, parent, key), /TABLE_SCHEMA_MISMATCH/); });
check('key contract drift refused', () => { const t = clone(tables); t.workload_issues.primary_key = []; assert.throws(() => companion.encode(t, parent, key), /TABLE_SCHEMA_MISMATCH/); });
check('numeric cells refused before precision loss', () => { const t = clone(tables); t.workload_issues.rows[0][0] = 1; assert.throws(() => companion.encode(t, parent, key), /CELL_TYPE/); });
check('missing cell refused', () => { const t = clone(tables); t.workload_issues.rows[0].pop(); assert.throws(() => companion.encode(t, parent, key), /ROW_SHAPE/); });
check('sparse nullable cell refused during encoding', () => { const t = clone(tables); delete t.batches_parent_claim_backup_20260824.rows[0][1]; assert.throws(() => companion.encode(t, parent, key), /ROW_SHAPE/); });
check('nonnull and primary key null refused', () => { const t = clone(tables); const i = t.workload_issues.columns.findIndex(c => c.name === 'id'); t.workload_issues.rows[0][i] = null; assert.throws(() => companion.encode(t, parent, key), /NULLABILITY|PRIMARY_KEY_NULL/); });
check('duplicate composite key refused', () => { const t = clone(tables); t.content_samples.rows.push([...t.content_samples.rows[0]]); assert.throws(() => companion.encode(t, parent, key), /PRIMARY_KEY_DUPLICATE/); });
check('parent package mismatch refused', () => assert.throws(() => companion.decode(bytes, { ...parent, package_sha256: 'c'.repeat(64) }, key), /PARENT_MISMATCH/));
check('parent schema mismatch refused', () => assert.throws(() => companion.decode(bytes, { ...parent, schema_fingerprint: 'c'.repeat(32) }, key), /PARENT_MISMATCH/));
check('wrong authentication key refused', () => assert.throws(() => companion.decode(bytes, parent, Buffer.alloc(32, 8).toString('base64')), /AUTHENTICATION/));
check('tamper refused before inner JSON parsing', () => { const b = Buffer.from(bytes); b[b.indexOf(123)] = 33; assert.throws(() => companion.decode(b, parent, key), /AUTHENTICATION/); });
check('truncation refused', () => assert.throws(() => companion.decode(bytes.subarray(0, -1), parent, key), /AUTHENTICATION/));
check('duplicate removal changes authenticated bytes', () => { const t = clone(tables); t.batches_parent_claim_backup_20260824.rows.shift(); assert.notDeepEqual(companion.encode(t, parent, key), bytes); });
check('authenticated schema hash drift refused', () => {
  const unsigned = Buffer.from(bytes.subarray(0, -32).toString().replace(companion.SCHEMA_SHA256, 'd'.repeat(64)));
  const signed = Buffer.concat([unsigned, crypto.createHmac('sha256', Buffer.from(key, 'base64')).update(unsigned).digest()]);
  assert.throws(() => companion.decode(signed, parent, key), /SCHEMA_MISMATCH/);
});
console.log(JSON.stringify({ marker: 'LINEAR_EXIT_PRIORITY_COMPANION_OK', checks, tables: 9, offline_encoding_validation_only: true, postgres_capture_restore_proven: false, complete_schema_proven: false, object_custody_proven: false, parent_package_validation_proven: false }));

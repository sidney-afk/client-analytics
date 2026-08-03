'use strict';

const {
  assertFetchReceipt,
  assertRoundTripReceipts,
} = require('../scripts/f133-private-artifact-gate.js');

const SHA = 'a'.repeat(64);
const ROOT_HASH = '9d1480048b17bcd038650c4d3191e12cb94b65938374ab335b955a9cab2df042';
const EXPECTED = { sha256: SHA, byteLength: 1234, rootHash: ROOT_HASH };
let failures = 0;

function ok(value, message) {
  if (value) console.log(`  ok  ${message}`);
  else { failures += 1; console.error(`FAIL  ${message}`); }
}

function receipt(fetch = false) {
  return {
    status: 'PASS',
    artifact_kind: 'f133-title-inventory',
    f133_title_inventory_sha256: SHA,
    byte_length: 1234,
    folder_id_sha256: ROOT_HASH,
    independent_private_readback: 'PASS',
    ...(fetch ? { local_private_readback: 'PASS' } : {}),
  };
}

function errorOf(fn) {
  try { fn(); return null; } catch (error) { return error; }
}

ok(assertRoundTripReceipts(receipt(), receipt(true), EXPECTED).status === 'PASS',
'the exact store plus independent fetch receipt pair passes');
ok(assertFetchReceipt(receipt(true), EXPECTED).status === 'PASS',
'the exact apply/verify inventory fetch receipt passes');

for (const target of ['store', 'fetch']) {
  const store = receipt();
  const fetch = receipt(true);
  (target === 'store' ? store : fetch).folder_id_sha256 = 'b'.repeat(64);
  const error = errorOf(() => assertRoundTripReceipts(store, fetch, EXPECTED));
  ok(error && error.code === 'F133_PRIVATE_ARTIFACT_RECEIPT_MISMATCH'
    && error.field === `${target}.folder_id_sha256`,
  `a wrong Shared Drive root hash in the ${target} receipt makes the round trip red`);
}

const wrongFetch = receipt(true);
wrongFetch.folder_id_sha256 = 'c'.repeat(64);
const fetchError = errorOf(() => assertFetchReceipt(wrongFetch, EXPECTED));
ok(fetchError && fetchError.code === 'F133_PRIVATE_ARTIFACT_RECEIPT_MISMATCH'
  && fetchError.field === 'fetch.folder_id_sha256',
'a wrong root hash makes an apply/verify fetch-only gate red');

for (const field of ['status', 'artifact_kind', 'f133_title_inventory_sha256', 'byte_length',
  'independent_private_readback', 'local_private_readback']) {
  const fetch = receipt(true);
  fetch[field] = field === 'byte_length' ? 1235 : 'WRONG';
  const error = errorOf(() => assertFetchReceipt(fetch, EXPECTED));
  ok(error && error.code === 'F133_PRIVATE_ARTIFACT_RECEIPT_MISMATCH',
  `${field} drift makes the private fetch gate red`);
}

if (failures) {
  console.error(`\n${failures} F133 private-artifact gate check(s) failed`);
  process.exit(1);
}
console.log('\nF133 private-artifact gate checks passed');

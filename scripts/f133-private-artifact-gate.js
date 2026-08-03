#!/usr/bin/env node
'use strict';

// Public-safe receipt predicate for F133 private title inventories/journals.
// It never reads an artifact body and never emits a private Drive identity.

const fs = require('fs');

const ARTIFACT_KIND = 'f133-title-inventory';
const HASH_FIELD = 'f133_title_inventory_sha256';
const HASH_RE = /^[0-9a-f]{64}$/;

class F133PrivateArtifactGateError extends Error {
  constructor(code, field) {
    super(code);
    this.name = 'F133PrivateArtifactGateError';
    this.code = code;
    this.field = field;
  }
}

function fail(field) {
  throw new F133PrivateArtifactGateError('F133_PRIVATE_ARTIFACT_RECEIPT_MISMATCH', field);
}

function expectedContract(expected) {
  const sha256 = String(expected && expected.sha256 || '');
  const byteLength = Number(expected && expected.byteLength);
  const rootHash = String(expected && expected.rootHash || '');
  if (!HASH_RE.test(sha256) || !Number.isSafeInteger(byteLength) || byteLength < 1
    || !HASH_RE.test(rootHash)) fail('expected_contract');
  return { sha256, byteLength, rootHash };
}

function assertCommon(receipt, expected, label) {
  if (!receipt || receipt.status !== 'PASS') fail(`${label}.status`);
  if (receipt.artifact_kind !== ARTIFACT_KIND) fail(`${label}.artifact_kind`);
  if (receipt[HASH_FIELD] !== expected.sha256) fail(`${label}.${HASH_FIELD}`);
  if (receipt.byte_length !== expected.byteLength) fail(`${label}.byte_length`);
  if (receipt.folder_id_sha256 !== expected.rootHash) fail(`${label}.folder_id_sha256`);
  if (receipt.independent_private_readback !== 'PASS') fail(`${label}.independent_private_readback`);
}

function assertFetchReceipt(fetchReceipt, rawExpected) {
  const expected = expectedContract(rawExpected);
  assertCommon(fetchReceipt, expected, 'fetch');
  if (fetchReceipt.local_private_readback !== 'PASS') fail('fetch.local_private_readback');
  return {
    status: 'PASS',
    gate: 'f133_private_artifact_fetch_exact',
    artifact_kind: ARTIFACT_KIND,
    [HASH_FIELD]: expected.sha256,
    byte_length: expected.byteLength,
    folder_id_sha256: expected.rootHash,
  };
}

function assertRoundTripReceipts(storeReceipt, fetchReceipt, rawExpected) {
  const expected = expectedContract(rawExpected);
  assertCommon(storeReceipt, expected, 'store');
  const fetchResult = assertFetchReceipt(fetchReceipt, expected);
  return {
    ...fetchResult,
    gate: 'f133_private_artifact_round_trip_exact',
    store_readback: 'PASS',
    fetch_readback: 'PASS',
  };
}

function parseArgs(argv) {
  const operation = String(argv[0] || '');
  const values = {};
  for (const arg of argv.slice(1)) {
    const match = arg.match(/^(--[a-z-]+)=(.+)$/);
    if (!match || Object.prototype.hasOwnProperty.call(values, match[1])) fail('arguments');
    values[match[1]] = match[2];
  }
  return { operation, values };
}

function readReceipt(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { fail(`${label}.json`); }
}

function main(argv = process.argv.slice(2)) {
  const { operation, values } = parseArgs(argv);
  const expected = {
    sha256: values['--expected-sha256'],
    byteLength: values['--expected-byte-length'],
    rootHash: values['--expected-root-id-sha256'],
  };
  if (operation === 'fetch'
    && Object.keys(values).sort().join(',') === '--expected-byte-length,--expected-root-id-sha256,--expected-sha256,--fetch-receipt') {
    return assertFetchReceipt(readReceipt(values['--fetch-receipt'], 'fetch'), expected);
  }
  if (operation === 'round-trip'
    && Object.keys(values).sort().join(',') === '--expected-byte-length,--expected-root-id-sha256,--expected-sha256,--fetch-receipt,--store-receipt') {
    return assertRoundTripReceipts(
      readReceipt(values['--store-receipt'], 'store'),
      readReceipt(values['--fetch-receipt'], 'fetch'),
      expected,
    );
  }
  fail('arguments');
}

function publicFailure(error) {
  return error instanceof F133PrivateArtifactGateError
    ? { status: 'FAIL', code: error.code, field: error.field }
    : { status: 'FAIL', code: 'F133_PRIVATE_ARTIFACT_GATE_UNEXPECTED', field: 'unknown' };
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main())}\n`); }
  catch (error) {
    process.stderr.write(`${JSON.stringify(publicFailure(error))}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ARTIFACT_KIND,
  F133PrivateArtifactGateError,
  HASH_FIELD,
  assertFetchReceipt,
  assertRoundTripReceipts,
  publicFailure,
};

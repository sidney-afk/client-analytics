'use strict';

const path = require('path');
const {
  EXACT_IMPORT,
  EXACT_SLUGS,
  assertExactCandidateImports,
  comparePriorToLive,
  discoverImportRows,
} = require('../scripts/f133-edge-deploy-gate.js');

const ROOT = path.resolve(__dirname, '..');
const HASH = '1'.repeat(64);
let failures = 0;

function ok(value, message) {
  if (value) console.log(`  ok  ${message}`);
  else { failures += 1; console.error(`FAIL  ${message}`); }
}

function row(slug, index) {
  return {
    slug,
    captured_version: String(40 + index),
    verify_jwt: false,
    source_closure_sha256: String(index + 2).repeat(64),
    entrypoint_sha256: String(index + 5).repeat(64),
    function_manifest_sha256: String(index + 7).repeat(64),
    file_count: 5,
    provider_source_file_count: 5,
  };
}

function receipts() {
  const rows = EXACT_SLUGS.map(row);
  return {
    prior: {
      result: 'PASS', operation: 'inspect', rollback_standard: 'source-exact-readback',
      provider_source_exactness: 'PASS', function_count: 3,
      sealed_bundle_sha256: HASH, functions: rows.map(item => ({ ...item })),
    },
    live: {
      result: 'PASS', operation: 'capture', rollback_standard: 'source-exact-readback',
      provider_contract: 'PASS', function_count: 3,
      functions: rows.map(item => ({ ...item })),
    },
  };
}

function failure(fn) {
  try { fn(); return null; } catch (error) { return error; }
}

const clean = receipts();
const pass = comparePriorToLive(clean.prior, clean.live, HASH);
ok(pass.status === 'PASS' && pass.function_count === 3
  && pass.compared_fields.includes('captured_version')
  && pass.compared_fields.includes('source_closure_sha256')
  && pass.compared_fields.includes('entrypoint_sha256')
  && pass.compared_fields.includes('verify_jwt'),
'a fresh exact-three provider readback passes all sealed version/source/entrypoint/JWT predicates');

for (const slug of EXACT_SLUGS) {
  const fixture = receipts();
  fixture.live.functions.find(item => item.slug === slug).source_closure_sha256 = 'f'.repeat(64);
  const error = failure(() => comparePriorToLive(fixture.prior, fixture.live, HASH));
  ok(error && error.code === 'F133_PREDEPLOY_PRIOR_DRIFT'
    && error.descriptor.slug === slug && error.descriptor.field === 'source_closure_sha256',
  `a byte-level source drift in ${slug} makes the predeploy gate red`);
}

for (const field of ['captured_version', 'entrypoint_sha256', 'verify_jwt']) {
  const fixture = receipts();
  const target = fixture.live.functions[0];
  target[field] = field === 'captured_version' ? '99'
    : field === 'verify_jwt' ? true : 'e'.repeat(64);
  const error = failure(() => comparePriorToLive(fixture.prior, fixture.live, HASH));
  ok(error && error.code === 'F133_PREDEPLOY_PRIOR_DRIFT'
    && error.descriptor.slug === 'linear-inbound' && error.descriptor.field === field,
  `${field} drift independently makes the predeploy gate red`);
}

const candidateRows = discoverImportRows(ROOT);
const importPass = assertExactCandidateImports(candidateRows);
ok(importPass.status === 'PASS' && importPass.function_count === 3
  && importPass.functions.every(item => item.exact_import_count === 1),
'the current reviewed dependency closure of every exact slug has one pinned 2.49.8 import');

for (const slug of EXACT_SLUGS) {
  const fixture = EXACT_SLUGS.map(name => ({
    slug: name,
    source_file_count: 1,
    sources: [`import { createClient } from "${name === slug ? 'npm:@supabase/supabase-js@2.50.0' : EXACT_IMPORT}";`],
  }));
  const error = failure(() => assertExactCandidateImports(fixture));
  ok(error && error.code === 'F133_CANDIDATE_IMPORT_DRIFT'
    && error.descriptor.slug === slug,
  `a Supabase import drift in ${slug} makes the candidate gate red`);
}

const duplicateImport = EXACT_SLUGS.map(name => ({
  slug: name,
  source_file_count: name === 'production-write' ? 2 : 1,
  sources: name === 'production-write'
    ? [`import "${EXACT_IMPORT}";`, `import "${EXACT_IMPORT}";`]
    : [`import "${EXACT_IMPORT}";`],
}));
const duplicateError = failure(() => assertExactCandidateImports(duplicateImport));
ok(duplicateError && duplicateError.code === 'F133_CANDIDATE_IMPORT_DRIFT'
  && duplicateError.descriptor.slug === 'production-write'
  && duplicateError.descriptor.import_count === 2,
'a duplicate exact import also fails closed');

if (failures) {
  console.error(`\n${failures} F133 Edge deploy-gate check(s) failed`);
  process.exit(1);
}
console.log('\nF133 Edge deploy-gate checks passed');

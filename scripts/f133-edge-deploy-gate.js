#!/usr/bin/env node
'use strict';

/*
 * Offline/public-safe predicates for the F133 exact-three deploy lane.
 *
 * `prior-live` compares a fresh provider capture against the exact sealed
 * pre-deploy receipt. Source equality is byte-exact through the closure hash;
 * entrypoint, JWT posture, and active version are compared independently.
 * `candidate-imports` walks each reviewed repository-local import closure and
 * requires one exact Supabase client import per function.
 */

const fs = require('fs');
const path = require('path');

const EXACT_SLUGS = Object.freeze([
  'linear-inbound',
  'linear-outbound',
  'production-write',
]);
const EXACT_IMPORT = 'npm:@supabase/supabase-js@2.49.8';
const HASH_RE = /^[0-9a-f]{64}$/;

class F133EdgeDeployGateError extends Error {
  constructor(code, descriptor = {}) {
    super(code);
    this.name = 'F133EdgeDeployGateError';
    this.code = code;
    this.descriptor = descriptor;
  }
}

function fail(code, descriptor) {
  throw new F133EdgeDeployGateError(code, descriptor);
}

function exactRows(receipt, operation) {
  const rows = Array.isArray(receipt && receipt.functions) ? receipt.functions : [];
  if (!receipt || receipt.result !== 'PASS' || receipt.operation !== operation
    || receipt.function_count !== EXACT_SLUGS.length || rows.length !== EXACT_SLUGS.length) {
    fail('F133_PREDEPLOY_RECEIPT_INVALID', { receipt: operation });
  }
  const sorted = [...rows].sort((a, b) => String(a && a.slug).localeCompare(String(b && b.slug)));
  for (let index = 0; index < EXACT_SLUGS.length; index += 1) {
    const row = sorted[index] || {};
    if (row.slug !== EXACT_SLUGS[index]
      || !/^[0-9]+$/.test(String(row.captured_version))
      || typeof row.verify_jwt !== 'boolean'
      || !HASH_RE.test(String(row.source_closure_sha256))
      || !HASH_RE.test(String(row.entrypoint_sha256))
      || !Number.isSafeInteger(row.file_count) || row.file_count < 1
      || row.provider_source_file_count !== row.file_count) {
      fail('F133_PREDEPLOY_RECEIPT_INVALID', { receipt: operation, slug: EXACT_SLUGS[index] });
    }
  }
  return sorted;
}

function comparePriorToLive(prior, live, expectedBundleSha256) {
  if (!HASH_RE.test(String(expectedBundleSha256 || ''))
    || String(prior && prior.sealed_bundle_sha256 || '') !== expectedBundleSha256
    || String(prior && prior.provider_source_exactness || '') !== 'PASS'
    || String(live && live.provider_contract || '') !== 'PASS') {
    fail('F133_PREDEPLOY_RECEIPT_INVALID', { receipt: 'binding' });
  }
  const priorRows = exactRows(prior, 'inspect');
  const liveRows = exactRows(live, 'capture');
  const comparedFields = [
    'captured_version',
    'source_closure_sha256',
    'entrypoint_sha256',
    'verify_jwt',
    'file_count',
    'provider_source_file_count',
  ];
  for (let index = 0; index < EXACT_SLUGS.length; index += 1) {
    const expected = priorRows[index];
    const observed = liveRows[index];
    for (const field of comparedFields) {
      if (observed[field] !== expected[field]) {
        fail('F133_PREDEPLOY_PRIOR_DRIFT', {
          slug: EXACT_SLUGS[index],
          field,
          expected: expected[field],
          observed: observed[field],
        });
      }
    }
  }
  return {
    status: 'PASS',
    gate: 'f133_predeploy_prior_three_exact',
    function_count: EXACT_SLUGS.length,
    compared_fields: comparedFields,
    rollback_bundle_sha256: expectedBundleSha256,
    functions: priorRows.map(row => ({
      slug: row.slug,
      version: String(row.captured_version),
      source_closure_sha256: row.source_closure_sha256,
      entrypoint_sha256: row.entrypoint_sha256,
      verify_jwt: row.verify_jwt,
    })),
  };
}

function localSpecifiers(source) {
  const found = [];
  const pattern = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const value = match[1] || match[2] || match[3];
    if (value.startsWith('.')) found.push(value);
  }
  return [...new Set(found)];
}

function resolveLocal(fromFile, specifier, functionsRoot) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const relative = path.relative(functionsRoot, base);
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) {
    fail('F133_CANDIDATE_IMPORT_CLOSURE_INVALID', { reason: 'outside_functions' });
  }
  const candidates = [
    base, `${base}.ts`, `${base}.js`, `${base}.mjs`,
    path.join(base, 'index.ts'), path.join(base, 'index.js'), path.join(base, 'index.mjs'),
  ];
  const found = candidates.find(file => {
    try { return fs.statSync(file).isFile(); } catch (_) { return false; }
  });
  if (!found) fail('F133_CANDIDATE_IMPORT_CLOSURE_INVALID', { reason: 'unresolved_relative_import' });
  return found;
}

function discoverImportRows(repoRoot) {
  const functionsRoot = path.join(repoRoot, 'supabase', 'functions');
  return EXACT_SLUGS.map(slug => {
    const entrypoint = path.join(functionsRoot, slug, 'index.ts');
    const pending = [entrypoint];
    const visited = new Set();
    const sources = [];
    while (pending.length) {
      const file = pending.pop();
      if (visited.has(file)) continue;
      visited.add(file);
      let source;
      try { source = fs.readFileSync(file, 'utf8'); } catch (_) {
        fail('F133_CANDIDATE_IMPORT_CLOSURE_INVALID', { slug, reason: 'source_absent' });
      }
      sources.push(source);
      for (const specifier of localSpecifiers(source)) {
        pending.push(resolveLocal(file, specifier, functionsRoot));
      }
    }
    return { slug, source_file_count: visited.size, sources };
  });
}

function assertExactCandidateImports(rows) {
  const sorted = [...(rows || [])].sort((a, b) => String(a && a.slug).localeCompare(String(b && b.slug)));
  if (sorted.length !== EXACT_SLUGS.length) {
    fail('F133_CANDIDATE_IMPORT_CLOSURE_INVALID', { reason: 'function_set' });
  }
  const receiptRows = [];
  for (let index = 0; index < EXACT_SLUGS.length; index += 1) {
    const row = sorted[index] || {};
    if (row.slug !== EXACT_SLUGS[index] || !Array.isArray(row.sources)
      || !Number.isSafeInteger(row.source_file_count) || row.source_file_count !== row.sources.length) {
      fail('F133_CANDIDATE_IMPORT_CLOSURE_INVALID', { slug: EXACT_SLUGS[index], reason: 'inventory' });
    }
    const imports = row.sources.flatMap(source =>
      [...String(source).matchAll(/npm:@supabase\/supabase-js@[0-9A-Za-z.+-]+/g)].map(match => match[0]));
    if (imports.length !== 1 || imports[0] !== EXACT_IMPORT) {
      fail('F133_CANDIDATE_IMPORT_DRIFT', {
        slug: EXACT_SLUGS[index],
        import_count: imports.length,
        exact_import_count: imports.filter(value => value === EXACT_IMPORT).length,
      });
    }
    receiptRows.push({ slug: row.slug, source_file_count: row.source_file_count, exact_import_count: 1 });
  }
  return {
    status: 'PASS',
    gate: 'f133_candidate_exact_supabase_imports',
    exact_import: EXACT_IMPORT,
    function_count: EXACT_SLUGS.length,
    functions: receiptRows,
  };
}

function parseOptions(args) {
  const operation = String(args[0] || '');
  const values = {};
  for (const raw of args.slice(1)) {
    const match = raw.match(/^(--[a-z-]+)=(.+)$/);
    if (!match || Object.prototype.hasOwnProperty.call(values, match[1])) {
      fail('F133_DEPLOY_GATE_ARGUMENT_REJECTED', {});
    }
    values[match[1]] = match[2];
  }
  return { operation, values };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {
    fail('F133_PREDEPLOY_RECEIPT_INVALID', { receipt: 'json' });
  }
}

function publicFailure(error) {
  if (error instanceof F133EdgeDeployGateError) {
    return { status: 'FAIL', code: error.code, descriptor: error.descriptor };
  }
  return { status: 'FAIL', code: 'F133_DEPLOY_GATE_UNEXPECTED', descriptor: {} };
}

function main(argv = process.argv.slice(2)) {
  const { operation, values } = parseOptions(argv);
  if (operation === 'prior-live'
    && Object.keys(values).sort().join(',') === '--expected-bundle-sha256,--live-receipt,--prior-receipt') {
    return comparePriorToLive(
      readJson(values['--prior-receipt']),
      readJson(values['--live-receipt']),
      values['--expected-bundle-sha256'],
    );
  }
  if (operation === 'candidate-imports'
    && Object.keys(values).sort().join(',') === '--repo-root') {
    const root = path.resolve(values['--repo-root']);
    return assertExactCandidateImports(discoverImportRows(root));
  }
  fail('F133_DEPLOY_GATE_ARGUMENT_REJECTED', {});
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main())}\n`); }
  catch (error) {
    process.stderr.write(`${JSON.stringify(publicFailure(error))}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXACT_IMPORT,
  EXACT_SLUGS,
  F133EdgeDeployGateError,
  assertExactCandidateImports,
  comparePriorToLive,
  discoverImportRows,
  publicFailure,
};

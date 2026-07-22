'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  PACKAGE_MAGIC,
  SCHEMA_VERSION,
  ThrowawayEdgeAdapter,
  assertUnixPrivateMode,
  captureFunctions,
  closureFingerprint,
  loadCapture,
  restoreFunctions,
  runHermeticRehearsal,
  validatePrivateBundlePath,
} = require('../scripts/f27-edge-source-rollback-lib.js');
const { F27_EDGE_SLUGS, exactAllowedSlugs, formatCliFailure } = require('../scripts/f27-edge-source-rollback.js');
const {
  functionSource,
  materialize,
  versionStableFunctionSource,
} = require('../scripts/f27-edge-source-rollback-supabase-adapter.js');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures += 1; console.error('FAIL  ' + message); }
}

async function rejects(fn, pattern) {
  try { await fn(); } catch (error) { return pattern.test(String(error && error.message || error)); }
  return false;
}

function sourceFiles(slug, marker = slug) {
  return new Map([
    [`functions/${slug}/index.ts`, Buffer.from([
      `import { marker } from "./marker.ts";`,
      `export const functionMarker = ${JSON.stringify(marker)} + marker;`,
      '',
    ].join('\n'))],
    [`functions/${slug}/marker.ts`, Buffer.from('export const marker = "-provider-source";\n')],
  ]);
}

function seedF27(adapter) {
  for (let index = 0; index < F27_EDGE_SLUGS.length; index += 1) {
    const slug = F27_EDGE_SLUGS[index];
    adapter.seed({
      slug,
      version: String(40 + index),
      status: 'ACTIVE',
      verifyJwt: index % 2 === 0,
      entrypointPath: `functions/${slug}/index.ts`,
      files: sourceFiles(slug),
    });
  }
  return adapter;
}

function multipartFixture(boundary) {
  return Buffer.from([
    `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n`,
    '{"deno2_entrypoint_path":"source/index.ts"}',
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="index.ts"\r\nSupabase-Path: source/index.ts\r\n\r\n`,
    'export const fixture = true;\n',
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="helper.ts"\r\nSupabase-Path: source/helper.ts\r\n\r\n`,
    'export const helper = true;\n',
    `\r\n--${boundary}--\r\n`,
  ].join(''), 'utf8');
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'f27-edge-source-test-'));
  try {
    const firstFile = path.join(temp, 'first.f27src');
    const secondFile = path.join(temp, 'second.f27src');
    const firstAdapter = seedF27(new ThrowawayEdgeAdapter());
    const first = await captureFunctions({
      adapter: firstAdapter,
      slugs: F27_EDGE_SLUGS,
      bundleFile: firstFile,
      capturedAt: '2026-07-22T00:00:00.000Z',
    });
    const second = await captureFunctions({
      adapter: seedF27(new ThrowawayEdgeAdapter()),
      slugs: [...F27_EDGE_SLUGS].reverse(),
      bundleFile: secondFile,
      capturedAt: '2026-07-22T00:00:00.000Z',
    });
    const loaded = loadCapture(firstFile, { expectedBundleSha256: first.sealed_bundle_sha256 });
    ok(SCHEMA_VERSION === 2 && PACKAGE_MAGIC.equals(Buffer.from('F27_EDGE_SOURCE_SET_V2\n'))
      && first.rollback_standard === 'source-exact-readback'
      && first.provider_source_exactness === 'PASS'
      && first.function_count === F27_EDGE_SLUGS.length
      && first.functions.every(row => row.rollback_standard === 'source-exact-readback'
        && row.file_count === 2 && row.provider_source_file_count === 2
        && /^[0-9a-f]{64}$/.test(row.source_closure_sha256))
      && loaded.functions.every(row => row.files.size === 2
        && row.manifest.rollback_standard === 'source-exact-readback'),
    'capture schema seals only exact provider source inventory, entrypoint, JWT, and source hashes');
    const manifestText = loaded.manifestBytes.toString('utf8');
    const publicReceipt = JSON.stringify(first);
    ok(!/dependency|vendor|deno[_-]?(?:lock|config)|deployment_closure/i.test(manifestText)
      && !/dependency|vendor|deno[_-]?(?:lock|config)|deployment_closure/i.test(publicReceipt)
      && !publicReceipt.includes(temp)
      && !publicReceipt.includes('export const')
      && !publicReceipt.includes('SUPABASE_ACCESS_TOKEN'),
    'sealed manifest and public receipt contain no dependency, vendor, local Deno, source-body, path, or secret claims');
    ok(first.sealed_bundle_sha256 === second.sealed_bundle_sha256
      && first.aggregate_source_sha256 === second.aggregate_source_sha256
      && fs.readFileSync(firstFile).equals(fs.readFileSync(secondFile)),
    'sealed source packing is deterministic across requested slug order');
    ok(fs.statSync(firstFile).isFile()
      && fs.readdirSync(temp).filter(name => name.startsWith('first')).length === 1,
    'capture emits one uploadable sealed file without sidecars');

    const fakeRepository = path.join(temp, 'containing-repository');
    const fakePrivateParent = path.join(fakeRepository, 'private');
    fs.mkdirSync(path.join(fakeRepository, '.git'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(fakePrivateParent, { recursive: true, mode: 0o700 });
    const realPrivateParent = path.join(temp, 'real-private-parent');
    const linkedPrivateParent = path.join(temp, 'linked-private-parent');
    fs.mkdirSync(realPrivateParent, { mode: 0o700 });
    fs.symlinkSync(realPrivateParent, linkedPrivateParent, process.platform === 'win32' ? 'junction' : 'dir');
    ok(await rejects(async () => validatePrivateBundlePath('relative.f27src', { operation: 'capture' }), /explicit and absolute/)
      && await rejects(async () => validatePrivateBundlePath(
        path.join(ROOT, `.f27-private-${process.pid}.f27src`), { operation: 'capture' },
      ), /outside every Git worktree/)
      && await rejects(async () => validatePrivateBundlePath(
        path.join(fakePrivateParent, 'capture.f27src'), { operation: 'capture' },
      ), /outside every Git worktree/)
      && await rejects(async () => validatePrivateBundlePath(
        path.join(linkedPrivateParent, 'capture.f27src'), { operation: 'capture' },
      ), /symlink or junction/)
      && await rejects(async () => validatePrivateBundlePath(firstFile, { operation: 'capture' }), /must not already exist/)
      && await rejects(async () => validatePrivateBundlePath(realPrivateParent, { operation: 'restore' }), /regular file/),
    'private bundle boundary rejects relative, worktree, containing-repository, linked, overwrite, and non-file paths');
    ok(await rejects(async () => assertUnixPrivateMode(0o640), /group or other/)
      && (() => { assertUnixPrivateMode(0o600); return true; })(),
    'Unix private-mode guard rejects every group/other permission bit');
    const injectedFailure = formatCliFailure(new Error(`token=top-secret source=private ${temp}`));
    ok(injectedFailure === 'f27-edge-source-rollback: F27_EDGE_ROLLBACK_FAILED: operation failed closed without publishing private details'
      && !injectedFailure.includes('top-secret') && !injectedFailure.includes(temp),
    'top-level CLI failure formatting discards injected secret, source, and path text');

    let mutationAttempts = 0;
    const mutationProbe = {
      async deployFunction() { mutationAttempts += 1; },
      async readFunction() { throw new Error('readback must not run'); },
    };
    ok(await rejects(() => restoreFunctions({ adapter: mutationProbe, bundleFile: firstFile }), /exact sealed bundle sha256/)
      && await rejects(() => restoreFunctions({
        adapter: mutationProbe,
        bundleFile: firstFile,
        expectedBundleSha256: '0'.repeat(64),
      }), /does not match the captured receipt/)
      && mutationAttempts === 0,
    'restore requires the operator-provided capture hash and rejects mismatch before mutation');

    for (const slug of F27_EDGE_SLUGS) {
      await firstAdapter.deployFunction({
        slug,
        verifyJwt: true,
        entrypointPath: `functions/${slug}/index.ts`,
        files: new Map([[`functions/${slug}/index.ts`, Buffer.from('export const candidate = true;\n')]]),
      });
    }
    const restored = await restoreFunctions({
      adapter: firstAdapter,
      bundleFile: firstFile,
      expectedBundleSha256: first.sealed_bundle_sha256,
    });
    ok(restored.result === 'PASS' && restored.function_count === 5
      && restored.rollback_standard === 'source-exact-readback'
      && restored.deployed_source_readback === 'PASS'
      && restored.functions.every(row => row.deployed_source_readback === 'PASS'
        && row.file_count === row.provider_source_file_count),
    'restore redeploys and independently reads back exact provider source path/bytes, entrypoint, and JWT');
    ok(restored.aggregate_source_sha256 === first.aggregate_source_sha256
      && restored.sealed_bundle_sha256 === first.sealed_bundle_sha256,
    'restore evidence remains bound to the source aggregate and sealed bundle');

    const tamperedFile = path.join(temp, 'tampered.f27src');
    const tampered = Buffer.from(fs.readFileSync(firstFile));
    tampered[Math.floor(tampered.length / 2)] ^= 0x01;
    fs.writeFileSync(tamperedFile, tampered, { mode: 0o600 });
    ok(await rejects(async () => loadCapture(tamperedFile), /sealed capture hash mismatch/),
      'one-byte bundle tampering fails before restore');

    async function driftCase(name, transform, pattern) {
      const file = path.join(temp, `${name}.f27src`);
      const adapter = seedF27(new ThrowawayEdgeAdapter({ readTransform: transform }));
      const capture = await captureFunctions({
        adapter, slugs: F27_EDGE_SLUGS, bundleFile: file, capturedAt: '2026-07-22T00:00:00.000Z',
      });
      return rejects(() => restoreFunctions({
        adapter, bundleFile: file, expectedBundleSha256: capture.sealed_bundle_sha256,
      }), pattern);
    }
    ok(await driftCase('source-drift', record => {
      record.files.set(record.entrypointPath, Buffer.from('export const drift = true;\n'));
      return record;
    }, /post-deploy source-exact readback failed/),
    'post-deploy provider source byte drift fails closed');
    ok(await driftCase('jwt-drift', record => { record.verifyJwt = !record.verifyJwt; return record; }, /verify_jwt/),
      'post-deploy JWT drift fails closed');
    ok(await driftCase('entrypoint-drift', record => {
      const alternate = `functions/${record.slug}/alternate.ts`;
      record.files.set(alternate, record.files.get(record.entrypointPath));
      record.entrypointPath = alternate;
      return record;
    }, /post-deploy source-exact readback failed/),
    'post-deploy entrypoint and path-inventory drift fails closed');

    const floating = new ThrowawayEdgeAdapter();
    floating.seed({
      slug: 'linear-inbound', version: '39', status: 'ACTIVE', verifyJwt: false,
      entrypointPath: 'functions/linear-inbound/index.ts',
      files: new Map([[
        'functions/linear-inbound/index.ts',
        Buffer.from('import "https://esm.sh/@supabase/supabase-js@2";\n'),
      ]]),
      dependencyFiles: new Map([[
        'functions/linear-inbound/deno.lock', Buffer.from('must never enter provider source capture'),
      ]]),
    });
    const v39File = path.join(temp, 'v39-provider-source.f27src');
    const v39Capture = await captureFunctions({
      adapter: floating,
      slugs: ['linear-inbound'],
      bundleFile: v39File,
      capturedAt: '2026-07-22T00:00:00.000Z',
    });
    const v39Loaded = loadCapture(v39File, { expectedBundleSha256: v39Capture.sealed_bundle_sha256 });
    const v39Restore = await restoreFunctions({
      adapter: floating,
      capture: v39Loaded,
      expectedBundleSha256: v39Capture.sealed_bundle_sha256,
    });
    ok(v39Capture.rollback_standard === 'source-exact-readback'
      && v39Restore.rollback_standard === 'source-exact-readback'
      && v39Restore.deployed_source_readback === 'PASS'
      && v39Loaded.functions[0].files.size === 1
      && !fs.readFileSync(v39File).includes(Buffer.from('deno.lock'))
      && !/weak|exception|non-exact|dependency/i.test(JSON.stringify(v39Capture)),
    'v39 provider-returned source uses the same source-exact standard and excludes every local companion');

    const rehearsal = await runHermeticRehearsal();
    ok(rehearsal.result === 'PASS' && rehearsal.network_calls === 0
      && rehearsal.live_provider_calls === 0
      && rehearsal.hermetic_provider_reads === 3
      && rehearsal.hermetic_provider_deploys === 2
      && rehearsal.deployed_source_readback === 'PASS' && rehearsal.jwt_readback === 'PASS'
      && !Object.keys(rehearsal).some(key => /dependency|deno|lock|vendor/i.test(key)),
    'offline rehearsal seals and restores provider source/JWT without dependency provenance claims');

    const boundary = 'f27-source-readback-fixture';
    const multipart = multipartFixture(boundary);
    const originalFetch = global.fetch;
    let readMethod = '';
    global.fetch = async (_url, options) => {
      readMethod = options.method;
      return new Response(multipart, { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
    };
    try {
      const providerRead = await functionSource('a'.repeat(20), 'linear-inbound', 'fixture-token', {
        entrypoint_path: 'file:///tmp/source/index.ts',
      });
      ok(readMethod === 'GET'
        && providerRead.entrypointPath === 'functions/linear-inbound/index.ts'
        && [...providerRead.files.keys()].join(',')
          === 'functions/linear-inbound/index.ts,functions/linear-inbound/helper.ts',
      'Management body read canonicalizes and preserves the exact provider source path inventory');
    } finally {
      global.fetch = originalFetch;
    }

    const stableMetadata = {
      slug: 'linear-inbound', version: 39, status: 'ACTIVE', verify_jwt: false,
      ezbr_sha256: 'a'.repeat(64), entrypoint_path: 'file:///tmp/source/index.ts',
    };
    const metadataResponse = metadata => new Response(JSON.stringify([metadata]), {
      headers: { 'content-type': 'application/json' },
    });
    const bodyResponse = () => new Response(multipart, {
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    const stableReads = [];
    global.fetch = async (url, options) => {
      stableReads.push({ url: String(url), method: options.method });
      return String(url).endsWith('/body') ? bodyResponse() : metadataResponse(stableMetadata);
    };
    try {
      const stable = await versionStableFunctionSource('a'.repeat(20), 'linear-inbound', 'fixture-token');
      ok(stableReads.length === 3 && stableReads.every(read => read.method === 'GET')
        && !stableReads[0].url.endsWith('/body') && stableReads[1].url.endsWith('/body')
        && !stableReads[2].url.endsWith('/body') && stable.metadata.version === 39,
      'Management source read brackets the unversioned body with stable metadata reads');
    } finally {
      global.fetch = originalFetch;
    }
    const generationRaces = [
      ['version', 40], ['status', 'UPDATING'], ['verify_jwt', true], ['ezbr_sha256', 'b'.repeat(64)],
    ];
    let allGenerationRacesRejected = true;
    for (const [field, changedValue] of generationRaces) {
      let metadataReads = 0;
      let requestCount = 0;
      global.fetch = async url => {
        requestCount += 1;
        if (String(url).endsWith('/body')) return bodyResponse();
        metadataReads += 1;
        return metadataResponse(metadataReads === 1
          ? stableMetadata : { ...stableMetadata, [field]: changedValue });
      };
      try {
        allGenerationRacesRejected = allGenerationRacesRejected
          && await rejects(() => versionStableFunctionSource(
            'a'.repeat(20), 'linear-inbound', 'fixture-token',
          ), /metadata changed during source body readback/)
          && requestCount === 3;
      } finally {
        global.fetch = originalFetch;
      }
    }
    ok(allGenerationRacesRejected,
      'capture and post-deploy readback reject version, status, JWT, or provider-hash races');

    let materializedSourceOnly = true;
    for (const slug of F27_EDGE_SLUGS) {
      const materializedRoot = path.join(temp, `materialized-${slug}`);
      const files = new Map([[`functions/${slug}/index.ts`, Buffer.from('export const fixture = true;\n')]]);
      materialize({
        slug, files, verifyJwt: false, entrypointPath: `functions/${slug}/index.ts`,
      }, 'a'.repeat(20), materializedRoot);
      const config = fs.readFileSync(path.join(materializedRoot, 'supabase', 'config.toml'), 'utf8');
      materializedSourceOnly = materializedSourceOnly
        && fs.readFileSync(path.join(materializedRoot, 'supabase', 'functions', slug, 'index.ts'))
          .equals(files.get(`functions/${slug}/index.ts`))
        && !/static_files|deno\.(?:json|lock)|vendor|dependency/i.test(config)
        && !fs.existsSync(path.join(materializedRoot, 'supabase', 'functions', slug, 'deno.json'))
        && !fs.existsSync(path.join(materializedRoot, 'supabase', 'functions', slug, 'deno.lock'));
    }
    ok(materializedSourceOnly,
      'restore materialization writes only sealed provider source plus generated entrypoint/JWT deploy config');

    const adapterSource = fs.readFileSync(path.join(ROOT, 'scripts', 'f27-edge-source-rollback-supabase-adapter.js'), 'utf8');
    const librarySource = fs.readFileSync(path.join(ROOT, 'scripts', 'f27-edge-source-rollback-lib.js'), 'utf8');
    ok(adapterSource.includes("method: 'GET'")
      && adapterSource.includes("'--use-docker'")
      && !adapterSource.includes("'--use-api'")
      && adapterSource.includes('versionStableFunctionSource')
      && adapterSource.includes('captured.project_ref !== projectRef')
      && adapterSource.includes('captured.supabase_cli_version !== cliVersion')
      && !/dependencyCompanion|preparedDependenc|FROZEN_LOCK|static_files|deno\.lock|deno\.json|vendor/i.test(adapterSource)
      && !/dependencyAttestation|dependencyPin|FROZEN_LOCK|SUPABASE_DENO_LOCK|deployment_closure|preparatory-source-text|vendor/i.test(librarySource),
    'production capture/restore code has no local dependency provenance path and retains target/CLI/readback fences');

    ok(exactAllowedSlugs(['linear-inbound']).join(',') === 'linear-inbound'
      && exactAllowedSlugs(['linear-outbound', 'batch-write', 'production-write', 'deliverable-write']).join(',')
        === 'batch-write,deliverable-write,linear-outbound,production-write'
      && await rejects(async () => exactAllowedSlugs(['calendar-upsert']), /allowlist/)
      && await rejects(async () => exactAllowedSlugs(['linear-inbound', 'linear-inbound']), /allowlist/),
    'operator CLI accepts strict inbound-only or four-function subsets and rejects frozen/duplicate slugs');

    const cliPath = path.join(ROOT, 'scripts', 'f27-edge-source-rollback.js');
    const missingApply = spawnSync(process.execPath, [
      cliPath, 'restore', `--slugs=${F27_EDGE_SLUGS.join(',')}`, `--bundle=${firstFile}`,
      `--expected-bundle-sha256=${first.sealed_bundle_sha256}`,
    ], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
    const wrongConfirmation = spawnSync(process.execPath, [
      cliPath, 'restore', `--slugs=${F27_EDGE_SLUGS.join(',')}`, `--bundle=${firstFile}`,
      `--expected-bundle-sha256=${first.sealed_bundle_sha256}`, '--apply',
    ], {
      cwd: ROOT, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, F27_EDGE_ROLLBACK_CONFIRM: 'RESTORE_CAPTURED_SOURCE_SET:linear-inbound' },
    });
    const missingExpectedHash = spawnSync(process.execPath, [
      cliPath, 'restore', `--slugs=${F27_EDGE_SLUGS.join(',')}`, `--bundle=${firstFile}`, '--apply',
    ], {
      cwd: ROOT, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, F27_EDGE_ROLLBACK_CONFIRM: `RESTORE_CAPTURED_SOURCE_SET:${F27_EDGE_SLUGS.join(',')}` },
    });
    const mismatchedExpectedHash = spawnSync(process.execPath, [
      cliPath, 'restore', `--slugs=${F27_EDGE_SLUGS.join(',')}`, `--bundle=${firstFile}`,
      `--expected-bundle-sha256=${'0'.repeat(64)}`, '--apply',
    ], {
      cwd: ROOT, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, F27_EDGE_ROLLBACK_CONFIRM: `RESTORE_CAPTURED_SOURCE_SET:${F27_EDGE_SLUGS.join(',')}` },
    });
    const retiredMode = spawnSync(process.execPath, [
      cliPath, 'capture', '--slugs=linear-inbound', `--bundle=${path.join(temp, 'retired-mode.f27src')}`,
      '--preparatory-source-text-only',
    ], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
    const relativeCapture = spawnSync(process.execPath, [
      cliPath, 'capture', '--slugs=linear-inbound', '--bundle=relative.f27src',
    ], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
    const worktreeCapture = spawnSync(process.execPath, [
      cliPath, 'capture', '--slugs=linear-inbound', `--bundle=${path.join(ROOT, `.f27-cli-${process.pid}.f27src`)}`,
    ], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
    ok(missingApply.status === 1 && /RESTORE_APPLY_REQUIRED/.test(missingApply.stderr)
      && wrongConfirmation.status === 1 && /RESTORE_CONFIRMATION_REQUIRED/.test(wrongConfirmation.stderr)
      && missingExpectedHash.status === 1 && /RESTORE_BUNDLE_SHA256_REQUIRED/.test(missingExpectedHash.stderr)
      && mismatchedExpectedHash.status === 1 && /RESTORE_BUNDLE_SHA256_MISMATCH/.test(mismatchedExpectedHash.stderr)
      && retiredMode.status === 1 && /F27_EDGE_ROLLBACK_FAILED/.test(retiredMode.stderr)
      && relativeCapture.status === 1 && /BUNDLE_PATH_NOT_ABSOLUTE/.test(relativeCapture.stderr)
      && worktreeCapture.status === 1 && /BUNDLE_PATH_WORKTREE/.test(worktreeCapture.stderr),
    'operator CLI enforces one source-exact mode, sealed hash, authority, and private path before provider access');

    const cli = spawnSync(process.execPath, [cliPath, 'rehearse'], {
      cwd: ROOT, encoding: 'utf8', timeout: 30_000,
    });
    ok(cli.status === 0 && /"result": "PASS"/.test(cli.stdout)
      && /"live_provider_calls": 0/.test(cli.stdout)
      && /"deployed_source_readback": "PASS"/.test(cli.stdout),
    'operator CLI runs the offline source-exact rehearsal end to end');
  } finally {
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) {}
  }

  if (failures) {
    console.error(`\n${failures} F27 Edge source rollback check(s) failed`);
    process.exit(1);
  }
  console.log('\nF27 Edge source rollback checks passed');
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});

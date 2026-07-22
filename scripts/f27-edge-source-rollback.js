#!/usr/bin/env node
'use strict';

/*
 * Operator entrypoint for private, source-exact Edge Function rollback.
 *
 * Capture is read-only. Restore is mutating and requires both --apply and an
 * exact per-slug environment confirmation. All stdout is public-safe evidence:
 * source bytes, tokens, project references, and private bundle paths are never
 * printed.
 *
 *   node scripts/f27-edge-source-rollback.js rehearse
 *   node scripts/f27-edge-source-rollback.js capture --slugs=A,B --bundle=PATH
 *   F27_EDGE_ROLLBACK_CONFIRM=RESTORE_CAPTURED_SOURCE_SET:A,B \
 *     node scripts/f27-edge-source-rollback.js restore --slugs=A,B --bundle=PATH \
 *       --expected-bundle-sha256=CAPTURE_RECEIPT_SHA256 --apply
 */

const {
  captureFunctions,
  loadCapture,
  operatorError,
  publicFailure,
  restoreFunctions,
  runHermeticRehearsal,
  validatePrivateBundlePath,
} = require('./f27-edge-source-rollback-lib.js');

const F27_EDGE_SLUGS = Object.freeze([
  'batch-write',
  'deliverable-write',
  'linear-inbound',
  'linear-outbound',
  'production-write',
]);

function parseArgs(argv) {
  const options = {
    command: '', bundle: '', expectedBundleSha256: '', slugs: [], apply: false,
    adapter: 'supabase',
  };
  for (const arg of argv) {
    if (!options.command && !arg.startsWith('-')) options.command = arg;
    else if (arg === '--apply') options.apply = true;
    else if (arg.startsWith('--bundle=')) options.bundle = arg.slice('--bundle='.length).trim();
    else if (arg.startsWith('--expected-bundle-sha256=')) {
      options.expectedBundleSha256 = arg.slice('--expected-bundle-sha256='.length).trim();
    }
    else if (arg.startsWith('--slugs=')) {
      options.slugs = arg.slice('--slugs='.length).split(',').map(value => value.trim()).filter(Boolean);
    }
    else if (arg.startsWith('--adapter=')) options.adapter = arg.slice('--adapter='.length).trim();
    else if (arg === '--help' || arg === '-h') options.command = 'help';
    else throw new Error('unsupported argument');
  }
  return options;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/f27-edge-source-rollback.js rehearse',
    '  node scripts/f27-edge-source-rollback.js capture --slugs=NAME[,NAME] --bundle=PRIVATE_FILE',
    '  F27_EDGE_ROLLBACK_CONFIRM=RESTORE_CAPTURED_SOURCE_SET:NAME[,NAME] node scripts/f27-edge-source-rollback.js restore --slugs=NAME[,NAME] --bundle=PRIVATE_FILE --expected-bundle-sha256=CAPTURE_RECEIPT_SHA256 --apply',
    '',
    'The production adapter requires PROJECT_REF and SUPABASE_ACCESS_TOKEN.',
  ].join('\n');
}

function providerAdapter(name) {
  if (name !== 'supabase') throw new Error('unsupported provider adapter');
  return require('./f27-edge-source-rollback-supabase-adapter.js').createAdapter();
}

function publicEvidence(value) {
  return JSON.stringify(value, null, 2);
}

function formatCliFailure(error) {
  const failure = publicFailure(error);
  return `f27-edge-source-rollback: ${failure.code}: ${failure.message}`;
}

function exactAllowedSlugs(values) {
  const slugs = [...new Set(values)].sort();
  if (!slugs.length || slugs.length !== values.length || slugs.some(slug => !F27_EDGE_SLUGS.includes(slug))) {
    throw new Error('slugs must be a unique nonempty subset of the F27 Edge allowlist');
  }
  return slugs;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.command === 'help' || !options.command) {
    console.log(usage());
    return;
  }
  if (options.command === 'rehearse') {
    if (argv.length !== 1 || options.apply || options.bundle || options.expectedBundleSha256
      || options.slugs.length
      || options.adapter !== 'supabase') throw new Error('rehearse accepts no options');
    console.log(publicEvidence(await runHermeticRehearsal()));
    return;
  }
  const requestedSlugs = exactAllowedSlugs(options.slugs);
  if (options.command === 'capture') {
    validatePrivateBundlePath(options.bundle, { operation: 'capture' });
    if (options.apply) throw operatorError('CAPTURE_APPLY_FORBIDDEN');
    if (options.expectedBundleSha256) throw new Error('capture does not accept an expected bundle sha256');
    const result = await captureFunctions({
      adapter: providerAdapter(options.adapter),
      slugs: requestedSlugs,
      bundleFile: options.bundle,
    });
    console.log(publicEvidence(result));
    return;
  }
  if (options.command === 'restore') {
    validatePrivateBundlePath(options.bundle, { operation: 'restore' });
    const capture = loadCapture(options.bundle, { expectedBundleSha256: options.expectedBundleSha256 });
    if (!options.apply) throw operatorError('RESTORE_APPLY_REQUIRED');
    const capturedSlugs = capture.functions.map(item => item.slug).sort();
    if (JSON.stringify(capturedSlugs) !== JSON.stringify(requestedSlugs)) {
      throw new Error('sealed capture does not match the requested F27 function set');
    }
    const expectedConfirmation = `RESTORE_CAPTURED_SOURCE_SET:${capturedSlugs.join(',')}`;
    if (String(process.env.F27_EDGE_ROLLBACK_CONFIRM || '') !== expectedConfirmation) {
      throw operatorError('RESTORE_CONFIRMATION_REQUIRED');
    }
    const result = await restoreFunctions({
      adapter: providerAdapter(options.adapter),
      capture,
      expectedBundleSha256: options.expectedBundleSha256,
    });
    console.log(publicEvidence(result));
    return;
  }
  throw new Error('command must be capture, restore, or rehearse');
}

if (require.main === module) {
  main().catch(error => {
    console.error(formatCliFailure(error));
    process.exit(1);
  });
}

module.exports = { F27_EDGE_SLUGS, exactAllowedSlugs, formatCliFailure, main, parseArgs, publicEvidence, usage };

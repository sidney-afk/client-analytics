'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  closureFingerprint,
  dispositionValue,
  multipartBoundary,
  normalizeLivePath,
  parseMultipart,
} = require('../scripts/ef-fingerprint.js');

const ROOT = path.resolve(__dirname, '..');
const fingerprintSource = fs.readFileSync(path.join(ROOT, 'scripts', 'ef-fingerprint.js'), 'utf8');
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-onboarding-edge-functions.yml'), 'utf8');
const manifest = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'EF_DEPLOY_MANIFEST.md'), 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures += 1; console.error('FAIL  ' + message); }
}

function throws(fn) {
  try { fn(); } catch (_) { return true; }
  return false;
}

ok(normalizeLivePath('functions/pto/index.ts', 'pto', 'functions/pto/index.ts') === 'functions/pto/index.ts'
  && normalizeLivePath('linear-outbound/mapping.mjs', 'linear-outbound', 'linear-outbound/index.ts') === 'functions/linear-outbound/mapping.mjs'
  && normalizeLivePath('source/index.ts', 'onboarding-capture', 'source/index.ts') === 'functions/onboarding-capture/index.ts'
  && normalizeLivePath('index.ts', 'fixture', 'index.ts') === 'functions/fixture/index.ts',
'live source paths normalize across modern, slug-root, legacy-root, and plain multipart layouts');
ok(throws(() => normalizeLivePath('../outside.ts', 'fixture', 'fixture/index.ts'))
  && throws(() => normalizeLivePath('/absolute.ts', 'fixture', 'fixture/index.ts'))
  && throws(() => normalizeLivePath('unknown/index.ts', 'fixture', 'fixture/index.ts')),
'live source path normalization rejects traversal, absolute, and unmapped files');

const boundary = 'syncview-fingerprint-fixture';
const multipart = Buffer.from([
  `--${boundary}\r\n`,
  'Content-Disposition: form-data; name="metadata"\r\n\r\n',
  '{"deno2_entrypoint_path":"source/index.ts"}',
  `\r\n--${boundary}\r\n`,
  'Content-Disposition: form-data; name="index.ts"; filename="index.ts"\r\n',
  'Supabase-Path: source/index.ts\r\n',
  'Content-Type: text/plain\r\n\r\n',
  `const embedded = "\r\n--${boundary}-not-a-delimiter";\n`,
  `\r\n--${boundary}--\r\n`,
].join(''), 'utf8');
const parts = parseMultipart(multipart, multipartBoundary(`multipart/form-data; boundary="${boundary}"`));
ok(parts.length === 2
  && parts[1].headers.get('supabase-path') === 'source/index.ts'
  && parts[1].body.toString('utf8').includes('-not-a-delimiter'),
'multipart parser preserves source bytes/headers and ignores boundary prefixes inside a file');
ok(dispositionValue(parts[1].headers.get('content-disposition'), 'name') === 'index.ts'
  && dispositionValue(parts[1].headers.get('content-disposition'), 'filename') === 'index.ts',
'multipart parser supports official source parts whose field name is the filename');

const lf = new Map([['functions/example/index.ts', Buffer.from('one\ntwo\n')]]);
const crlf = new Map([['functions/example/index.ts', Buffer.from('one\r\ntwo\r\n')]]);
ok(closureFingerprint(lf) !== closureFingerprint(crlf),
'source fingerprints retain exact deployed bytes instead of hiding line-ending drift');

ok(/method:\s*['"]GET['"]/.test(fingerprintSource)
  && !/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/.test(fingerprintSource)
  && fingerprintSource.includes("const API_ORIGIN = 'https://api.supabase.com'")
  && fingerprintSource.includes("redirect: 'error'"),
'fingerprint readback is pinned to redirect-free GET requests on the official Management API');

ok(/- name: Attest pinned manual release[\s\S]*if: always\(\) && github\.event_name == 'workflow_dispatch'/.test(workflow)
  && workflow.includes('Fingerprint scope: 10 functions deployed by this workflow')
  && workflow.includes('Drill outcome: \\`PENDING\\`')
  && workflow.includes('--format=markdown | tee -a "$GITHUB_STEP_SUMMARY"'),
'manual dispatch appends a scoped public-safe fingerprint attestation and drill placeholder');

const providerAt = workflow.indexOf('for fn in linear-outbound production-write');
const attestationAt = workflow.indexOf('- name: Attest pinned manual release');
const attestorPreflightAt = workflow.indexOf('node scripts/ef-fingerprint.js "$DEPLOY_COMMIT" --expected-only');
ok(attestorPreflightAt >= 0 && attestorPreflightAt < providerAt
  && providerAt >= 0 && attestationAt > providerAt,
'attestor readiness fails before mutation and live fingerprints follow the provider-before-gateway deployment step');

const manifestCheck = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ef-deploy-manifest.js'), '--check'], {
  cwd: ROOT,
  encoding: 'utf8',
});
const slugRows = manifest.split(/\r?\n/).filter(line => /^\| `[a-z0-9-]+` \|/.test(line));
ok(manifestCheck.status === 0 && slugRows.length === 29,
`generated deploy manifest is current and contains all 29 slugs (${(manifestCheck.stderr || '').trim()})`);
ok(/\| `client-review-link` \| NONE \| \*\*NO CI DEPLOY PATH - DELIBERATE-MANUAL\.\*\* Live v2 deployed by operator on 2026-07-15\./.test(manifest),
'client-review-link is explicitly recorded as the operator-deployed v2 deliberate-manual exception');
ok(/\| `workload-linear` \| NONE \| \*\*NO CI DEPLOY PATH - DELIBERATE-MANUAL\.\*\* Source-only Workload Linear metadata\/deadline gateway/.test(manifest),
'workload-linear is explicitly recorded as a source-only deliberate-manual exception');

if (failures) {
  console.error(`\n${failures} Edge Function deploy provenance check(s) failed`);
  process.exit(1);
}
console.log('\nEdge Function deploy provenance checks passed');

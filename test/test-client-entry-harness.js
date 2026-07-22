'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseProbeSelection } = require('../qa/nightly-input.js');
const CLIENT_ENTRY = require('../qa/test-client-entry.js');
const {
  CLIENT_ENTRY_PROBE_FILES,
  ISSUER_URL,
  STAFF_KEY_ENV,
  TEST_CLIENT,
  clientEntryProbeChildEnv,
  clientEntrySafeChildEnv,
  createCurrentTestClientTokenResolver,
  probeNeedsClientEntry,
  requireTestClientToken,
  resolveCurrentTestClientToken,
  testClientEntryPath,
} = CLIENT_ENTRY;

const ROOT = path.resolve(__dirname, '..');
const SYNTHETIC_TOKEN = 'synthetic-test-client-token';

function manifestProbeFiles() {
  return fs.readFileSync(path.join(ROOT, 'qa/probes/nightly-manifest.txt'), 'utf8')
    .split(/\r?\n/)
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map(name => name.endsWith('.js') ? name : `${name}.js`);
}

function workflowDirectProbeFiles(source) {
  const block = source.match(/SYNCVIEW_NIGHTLY_PROBES:\s*>-\s*\r?\n((?:\s{12,}[^\r\n]*\r?\n?)+)/);
  assert.ok(block, 'Samples workflow retains a parseable direct probe block');
  return parseProbeSelection(block[1]);
}

function actuallyCallsStrictClientEntrySource(rawSource) {
  const source = String(rawSource)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[\t ])\/\/.*$/gm, '$1');
  if (/\.(?:currentTestClientToken|gotoTestClientEntry|clientPage|clientCal|clientSamples)\s*\(/.test(source)) return true;
  if (/\b(?:currentTestClientToken|gotoTestClientEntry)\s*\(/.test(source)) return true;

  function destructureCallsClient(bindings, remainder) {
    for (const binding of bindings.split(',').map(part => part.trim())) {
      const pair = binding.match(/^(client|clientCal|clientSamples)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
      if (pair && new RegExp(`\\b${pair[2] || pair[1]}\\s*\\(`).test(remainder)) return true;
    }
    return false;
  }

  // Client openers are otherwise too generic to scan globally. Count them
  // only when called through, or destructured from, the strict courier module.
  const directDestructure = /\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(['"]\.\.\/sxr_courier_lib\.js['"]\)\s*;/g;
  for (const match of source.matchAll(directDestructure)) {
    if (destructureCallsClient(match[1], source.slice(match.index + match[0].length))) return true;
  }
  const courierAliases = [...source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(['"]\.\.\/sxr_courier_lib\.js['"]\)/g,
  )].map(match => match[1]);
  for (const alias of courierAliases) {
    if (new RegExp(`\\b${alias}\\.(?:client|clientCal|clientSamples)\\s*\\(`).test(source)) return true;
    const destructure = new RegExp(`\\b(?:const|let|var)\\s*\\{([^}]+)\\}\\s*=\\s*${alias}\\s*;`, 'g');
    for (const match of source.matchAll(destructure)) {
      if (destructureCallsClient(match[1], source.slice(match.index + match[0].length))) return true;
    }
  }
  return false;
}

function actuallyCallsStrictClientEntry(file) {
  return actuallyCallsStrictClientEntrySource(
    fs.readFileSync(path.join(ROOT, 'qa/probes', file), 'utf8'),
  );
}

assert.equal(
  actuallyCallsStrictClientEntrySource("// clientPage(browser)\nconst value = 'staff-only';"),
  false,
  'comments cannot manufacture a strict-client capability',
);
assert.equal(
  actuallyCallsStrictClientEntrySource(
    "const { client: openClient } = require('../sxr_courier_lib.js');\nopenClient(browser);",
  ),
  true,
  'direct courier destructuring with an aliased call is detected',
);

assert.equal(
  Object.hasOwn(CLIENT_ENTRY, 'exportTokenToGitHubEnv'),
  false,
  'shared helper must not expose a cross-process token exporter',
);
assert.equal(Object.isFrozen(CLIENT_ENTRY_PROBE_FILES), true, 'exported probe capability registry is immutable');
assert.equal(CLIENT_ENTRY_PROBE_FILES.length, 39, 'registry covers 37 manifest probes, one workflow-direct probe, and one temporal probe');
assert.equal(Object.hasOwn(CLIENT_ENTRY, 'CLIENT_ENTRY_PROBE_FILE_SET'), false, 'mutable lookup Set stays private');
assert.throws(() => CLIENT_ENTRY_PROBE_FILES.push('synthetic.js'), TypeError);
assert.equal(probeNeedsClientEntry('p30_linear_client.js'), true, 'client probe receives the issuer capability');
assert.equal(probeNeedsClientEntry('qa/probes/ot_temporal_client_combo.js'), true, 'client temporal probe receives the issuer capability');
assert.equal(probeNeedsClientEntry('sxr_client_persist_guard.js'), true, 'scheduled Samples client persistence guard receives the issuer capability');
assert.equal(probeNeedsClientEntry('parity_logic.js'), false, 'synthetic parity probe never receives the issuer key');
assert.equal(probeNeedsClientEntry('p89_cal_create_via_ui.js'), false, 'staff-only probe never receives the issuer key');
assert.equal(probeNeedsClientEntry('synthetic_unknown_probe.js'), false, 'unknown manual probe fails credential-free');
const probeSourceEnv = {
  PATH: '/synthetic/bin',
  [STAFF_KEY_ENV]: 'synthetic-issuer-key',
  SYNCVIEW_TEST_CLIENT_TOKEN: SYNTHETIC_TOKEN,
};
assert.deepEqual(
  clientEntryProbeChildEnv('p30_linear_client.js', probeSourceEnv),
  { PATH: '/synthetic/bin', [STAFF_KEY_ENV]: 'synthetic-issuer-key' },
  'capable probe receives only the issuer key in its exact Node process',
);
for (const file of ['parity_logic.js', 'p89_cal_create_via_ui.js', 'synthetic_unknown_probe.js']) {
  assert.deepEqual(
    clientEntryProbeChildEnv(file, probeSourceEnv),
    { PATH: '/synthetic/bin' },
    `${file} stays credential-free`,
  );
}

function queryFor(view) {
  const url = new URL(testClientEntryPath(view, TEST_CLIENT.name, SYNTHETIC_TOKEN), 'https://fixture.invalid');
  assert.equal(url.hash, '');
  assert.equal(url.searchParams.getAll('c').length, 1);
  assert.equal(url.searchParams.getAll('t').length, 1);
  assert.equal(url.searchParams.get('c'), TEST_CLIENT.name);
  assert.equal(url.searchParams.get('t'), SYNTHETIC_TOKEN);
  assert.equal(url.searchParams.has('v2debug'), false);
  assert.equal(url.searchParams.has('Kasper'), false);
  assert.equal(url.searchParams.has('prod'), false);
  return url.searchParams;
}

const priorLegacyToken = process.env.SYNCVIEW_TEST_CLIENT_TOKEN;
process.env.SYNCVIEW_TEST_CLIENT_TOKEN = SYNTHETIC_TOKEN;
assert.throws(
  () => requireTestClientToken(),
  /explicit current TEST-client token is required/,
  'live client routes must reject even a legacy inherited token',
);
if (priorLegacyToken === undefined) delete process.env.SYNCVIEW_TEST_CLIENT_TOKEN;
else process.env.SYNCVIEW_TEST_CLIENT_TOKEN = priorLegacyToken;

const calendar = queryFor('calendar');
assert.deepEqual([...calendar.keys()].sort(), ['c', 't', 'v']);
assert.equal(calendar.get('v'), 'calendar');

const brief = queryFor('brief');
assert.deepEqual([...brief.keys()].sort(), ['c', 't', 'v']);
assert.equal(brief.get('v'), 'brief');

const analytics = queryFor('analytics');
assert.deepEqual([...analytics.keys()].sort(), ['c', 't']);

const samples = queryFor('sample-reviews');
assert.deepEqual([...samples.keys()].sort(), ['c', 'sxr', 't', 'v']);
assert.equal(samples.get('v'), 'sample-reviews');
assert.equal(samples.get('sxr'), '1');

assert.throws(
  () => testClientEntryPath('calendar', 'A Real Client', SYNTHETIC_TOKEN),
  /restricted to the TEST client/,
  'live harness URL construction must stay scoped to the TEST client',
);

(async () => {
  const calls = [];
  const resolved = await resolveCurrentTestClientToken({
    staffKey: 'synthetic-staff-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, client: TEST_CLIENT.slug, token: SYNTHETIC_TOKEN }),
      };
    },
  });
  assert.equal(resolved, SYNTHETIC_TOKEN);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ISSUER_URL);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['X-Syncview-Key'], 'synthetic-staff-key');
  assert.deepEqual(JSON.parse(calls[0].options.body), { client: TEST_CLIENT.slug });

  await assert.rejects(
    resolveCurrentTestClientToken({ staffKey: '' }),
    new RegExp(`${STAFF_KEY_ENV} is required`),
  );
  for (const fixture of [
    { response: { ok: false, status: 401, json: async () => ({ error: 'secret-body-marker' }) }, pattern: /HTTP 401/ },
    { response: { ok: false, status: 500, json: async () => ({ error: 'secret-body-marker' }) }, pattern: /HTTP 500/ },
    { response: { ok: true, status: 200, json: async () => ({ ok: true, client: 'wrong-client', token: 'secret-body-marker' }) }, pattern: /invalid contract/ },
    { response: { ok: true, status: 200, json: async () => ({ ok: true, client: TEST_CLIENT.slug }) }, pattern: /invalid contract/ },
  ]) {
    await assert.rejects(
      resolveCurrentTestClientToken({
        staffKey: 'synthetic-staff-key',
        fetchImpl: async () => fixture.response,
      }),
      error => fixture.pattern.test(error.message) && !error.message.includes('secret-body-marker'),
    );
  }

  let cachedResolverCalls = 0;
  const currentToken = createCurrentTestClientTokenResolver({
    staffKey: 'synthetic-staff-key',
    fetchImpl: async () => {
      cachedResolverCalls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, client: TEST_CLIENT.slug, token: SYNTHETIC_TOKEN }),
      };
    },
  });
  assert.deepEqual(
    await Promise.all([currentToken(), currentToken()]),
    [SYNTHETIC_TOKEN, SYNTHETIC_TOKEN],
  );
  assert.equal(cachedResolverCalls, 1, 'one harness process resolves the current token once');

  const unsafeEnv = {
    PATH: '/synthetic/bin',
    [STAFF_KEY_ENV]: 'synthetic-staff-key',
    SYNCVIEW_TEST_CLIENT_TOKEN: SYNTHETIC_TOKEN,
  };
  assert.deepEqual(
    clientEntrySafeChildEnv(unsafeEnv),
    { PATH: '/synthetic/bin' },
    'browser and unrelated child environments strip client-entry credentials',
  );
  assert.equal(unsafeEnv[STAFF_KEY_ENV], 'synthetic-staff-key', 'source environment is not mutated');

  const qaFiles = [
    'qa/golden_lib.js',
    'qa/probes/lib.js',
    'qa/sxr_courier_lib.js',
    'qa/ef-writepath/lib.js',
    'qa/probes/p30_linear_client.js',
    'qa/probes/p31_caption_gen.js',
    'qa/probes/p36_full_sync.js',
  ];
  for (const relative of qaFiles) {
    const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert.equal(
      /index\.html\?[^`'"\r\n]*\bc=/.test(source),
      false,
      `${relative} must not bypass the strict TEST client URL builder`,
    );
    assert.ok(
      source.includes('currentTestClientToken'),
      `${relative} must resolve the current token inside its own process`,
    );
    assert.ok(source.includes('gotoTestClientEntry'), `${relative} must use redacted client navigation`);
    assert.ok(
      /(?:\btoken\s*,|token:\s*(?:token|currentToken|clientToken)\b)/.test(source),
      `${relative} must pass its local token explicitly to redacted client navigation`,
    );
  }

  for (const relative of [
    'qa/golden_lib.js',
    'qa/sxr_courier_lib.js',
    'qa/ef-writepath/lib.js',
    'qa/probes/p87_kasper_finish_stale_refresh.js',
  ]) {
    const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert.ok(
      /chromium\.launch\(\{[\s\S]*?env:\s*clientEntrySafeChildEnv\(\)/.test(source),
      `${relative} must strip client-entry credentials from Chromium`,
    );
  }

  const pending = [path.join(ROOT, 'qa')];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        const source = fs.readFileSync(absolute, 'utf8');
        if (path.relative(ROOT, absolute) !== path.join('qa', 'test-client-entry.js')) {
          assert.equal(
            source.includes('process.env.SYNCVIEW_TEST_CLIENT_TOKEN'),
            false,
            `${path.relative(ROOT, absolute)} must not consume an inherited client token`,
          );
        }
        assert.equal(
          /index\.html\?[^`'"\r\n]*\bc=/.test(source),
          false,
          `${path.relative(ROOT, absolute)} contains a raw strict client URL`,
        );
        assert.equal(
          /(?:c=[^`'"\r\n]*v2debug|v2debug[^`'"\r\n]*c=)/.test(source),
          false,
          `${path.relative(ROOT, absolute)} mixes a client entry with a forbidden debug key`,
        );
      }
    }
  }

  const samplesWorkflowSource = fs.readFileSync(
    path.join(ROOT, '.github/workflows/samples-e2e-nightly.yml'),
    'utf8',
  );
  const masterSource = fs.readFileSync(path.join(ROOT, 'qa/master.js'), 'utf8');
  assert.ok(
    masterSource.includes('glob: /^ot_temporal_.*\\.js$/'),
    'master retains the scheduled temporal probe glob audited by this census',
  );
  const scheduledManifest = manifestProbeFiles();
  const scheduledWorkflowDirect = workflowDirectProbeFiles(samplesWorkflowSource);
  const scheduledTemporal = fs.readdirSync(path.join(ROOT, 'qa/probes'))
    .filter(file => /^ot_temporal_.*\.js$/.test(file))
    .sort();
  const scheduledUniverse = [
    ...scheduledManifest,
    ...scheduledWorkflowDirect,
    ...scheduledTemporal,
  ];
  assert.equal(
    new Set(scheduledUniverse).size,
    scheduledUniverse.length,
    'manifest, workflow-direct, and temporal schedules contain no duplicate probe names',
  );
  for (const file of scheduledUniverse) {
    assert.equal(
      fs.existsSync(path.join(ROOT, 'qa/probes', file)),
      true,
      `scheduled probe exists: ${file}`,
    );
  }

  const manifestClientCallers = scheduledManifest.filter(actuallyCallsStrictClientEntry);
  const workflowDirectClientCallers = scheduledWorkflowDirect.filter(actuallyCallsStrictClientEntry);
  const temporalClientCallers = scheduledTemporal.filter(actuallyCallsStrictClientEntry);
  assert.equal(manifestClientCallers.length, 37, '37 nightly-manifest probes actually call a strict client opener');
  assert.deepEqual(
    workflowDirectClientCallers,
    ['sxr_client_persist_guard.js'],
    'the visible Samples persistence guard is the sole workflow-direct strict client caller',
  );
  assert.deepEqual(
    temporalClientCallers,
    ['ot_temporal_client_combo.js'],
    'one master temporal probe actually calls a strict client opener',
  );

  const expectedRegistry = [
    ...manifestClientCallers,
    ...workflowDirectClientCallers,
    ...temporalClientCallers,
  ].sort();
  assert.equal(
    new Set(CLIENT_ENTRY_PROBE_FILES).size,
    CLIENT_ENTRY_PROBE_FILES.length,
    'capability registry contains no duplicate entries',
  );
  assert.deepEqual(
    [...CLIENT_ENTRY_PROBE_FILES].sort(),
    expectedRegistry,
    'capability registry has no missing or excess scheduled strict-client callers',
  );
  for (const file of CLIENT_ENTRY_PROBE_FILES) {
    assert.equal(
      fs.existsSync(path.join(ROOT, 'qa/probes', file)),
      true,
      `capability registry entry exists: ${file}`,
    );
  }
  for (const file of scheduledWorkflowDirect) {
    const childEnv = clientEntryProbeChildEnv(file, probeSourceEnv);
    assert.equal(
      Object.hasOwn(childEnv, STAFF_KEY_ENV),
      file === 'sxr_client_persist_guard.js',
      `${file} receives the issuer key only when it drives the strict client entry`,
    );
    assert.equal(
      Object.hasOwn(childEnv, 'SYNCVIEW_TEST_CLIENT_TOKEN'),
      false,
      `${file} never receives an inherited client token`,
    );
  }

  const workflowStaffKeyUses = {
    'calendar-e2e-nightly.yml': 1,
    'samples-e2e-nightly.yml': 2,
  };
  for (const [workflow, expectedStaffKeyUses] of Object.entries(workflowStaffKeyUses)) {
    const source = fs.readFileSync(path.join(ROOT, '.github/workflows', workflow), 'utf8');
    assert.equal(source.includes('--export-github-env'), false, `${workflow} must not export a token across steps`);
    assert.equal(source.includes('GITHUB_ENV'), false, `${workflow} must not persist a token in the job environment`);
    assert.equal(source.includes('SYNCVIEW_TEST_CLIENT_TOKEN'), false, `${workflow} must not expose a client token to child processes`);
    assert.equal(source.includes('exportTokenToGitHubEnv'), false, `${workflow} must not call the removed token exporter`);
    assert.equal(source.includes('SUPABASE_SERVICE_ROLE_KEY'), false, `${workflow} token resolution must not expose service-role credentials`);
    assert.equal(
      (source.match(/SYNCVIEW_STAFF_KEY:\s*\$\{\{\s*secrets\.SYNCVIEW_STAFF_KEY\s*\}\}/g) || []).length,
      expectedStaffKeyUses,
      `${workflow} must scope the issuer credential to every operative harness step`,
    );
    if (workflow === 'samples-e2e-nightly.yml') {
      assert.ok(
        /Samples probes[\s\S]*?run: node qa\/run-probes\.js/.test(source)
          && !source.includes('python3 -m http.server'),
        'samples nightly must delegate static-server ownership and credential stripping to the shared runner',
      );
    }
  }

  const runProbes = fs.readFileSync(path.join(ROOT, 'qa/run-probes.js'), 'utf8');
  assert.ok(
    /spawn\('python3'[\s\S]*?env:\s*clientEntrySafeChildEnv\(\)/.test(runProbes),
    'calendar runner must strip client-entry credentials from its static server',
  );
  assert.ok(
    /const probeEnv = clientEntryProbeChildEnv\(f\);[\s\S]*?spawnSync/.test(runProbes),
    'calendar runner must pass the issuer key only to an explicit client-entry probe capability',
  );

  const master = masterSource;
  assert.ok(
    /needsClientEntry[\s\S]*?clientEntrySafeChildEnv\(mergedEnv\)[\s\S]*?childEnv\[STAFF_KEY_ENV\]/.test(master),
    'master must give the issuer key only to client-entry lanes',
  );
  assert.ok(
    (master.match(/needsClientEntry:\s*probeNeedsClientEntry\(f\)/g) || []).length === 2,
    'master probe and temporal lanes must restore the issuer key only for explicit client-entry probes',
  );
  assert.ok(
    /spawn\(py,[\s\S]*?env:\s*clientEntrySafeChildEnv\(\)/.test(master),
    'master must strip client-entry credentials from its static server',
  );

  const quotaProbe = fs.readFileSync(path.join(ROOT, 'qa/probes/p94_nav_full_quota.js'), 'utf8');
  assert.ok(
    !quotaProbe.includes('execSync(')
      || /execSync\([\s\S]*?env:\s*clientEntrySafeChildEnv\(\)/.test(quotaProbe),
    'any remaining direct probe child process must strip client-entry credentials',
  );

  const overnightSkill = fs.readFileSync(
    path.join(ROOT, '.claude/skills/overnight-test/SKILL.md'),
    'utf8',
  );
  const targetBinding = overnightSkill.match(/## 3\. Target binding[\s\S]*?(?=\n## 4\. The loop)/);
  assert.ok(targetBinding, 'overnight skill must retain its operative target-binding section');
  const operative = targetBinding[0];
  assert.ok(
    operative.includes('const clientToken = await resolveCurrentTestClientToken();'),
    'overnight client entry must resolve the current protected TEST token into local memory',
  );
  assert.ok(
    /gotoTestClientEntry\(page,\s*\{[\s\S]*?view:\s*'sample-reviews',[\s\S]*?token:\s*clientToken,/.test(operative),
    'overnight client entry must pass the local token to redacted navigation',
  );
  assert.equal(
    /process\.env(?:\s*\[[^\]]+\]|\.[A-Za-z_$][\w$]*)\s*=/.test(operative),
    false,
    'overnight client entry must not expose the resolved token through inherited process state',
  );
  assert.ok(
    operative.includes('The harness resolves the current token inside its own Node process'),
    'overnight scheduled instructions must keep token resolution inside each harness',
  );
  assert.equal(
    operative.includes('--export-github-env'),
    false,
    'overnight skill must not prescribe a cross-process token exporter',
  );
  assert.ok(
    operative.includes('Client-entry URLs must always contain the current `t` credential'),
    'overnight client entry must explicitly forbid missing-token navigation',
  );
  assert.ok(
    /must never\s+contain `v2debug`/.test(operative),
    'overnight client entry must explicitly forbid the staff debug key',
  );
  assert.equal(
    /\/index\.html\?[^`'"\r\n]*\bc=/.test(operative),
    false,
    'overnight target binding must not prescribe a hand-built strict client URL',
  );

  assert.ok(
    /view:\s*'sample-reviews'/.test(operative),
    'overnight target binding must drive the documented client surface through redacted navigation',
  );
  queryFor('sample-reviews');

  console.log('TEST client entry harness checks: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});

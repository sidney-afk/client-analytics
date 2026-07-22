'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'qa', 'vision_judge.js');
const SHOT_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'syncview-vision-shot-'));
const RESIDUE_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'syncview-vision-fileless-'));
const SHOT = path.join(SHOT_TMP, 'synthetic.png');
const HEADER_MARKER = 'synthetic-vision-header-secret "quoted" \\ slash\tvalue';
const BODY_MARKER = '@synthetic-vision-body-secret "quoted" \\ slash\nline\rreturn\ttab\vvertical';
const URL_MARKER = 'synthetic-vision-url-secret';
const calls = [];
const cliCalls = [];
let mode = 'success';

fs.writeFileSync(SHOT, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]));

function decodeCurlValue(raw) {
  assert.equal(raw.startsWith('"') && raw.endsWith('"'), true, `curl config value is not quoted: ${raw}`);
  const inner = raw.slice(1, -1);
  let value = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== '\\') { value += inner[i]; continue; }
    i += 1;
    assert.ok(i < inner.length, 'curl config value ends with a bare escape');
    const map = { '\\': '\\', '"': '"', t: '\t', n: '\n', r: '\r', v: '\v' };
    assert.ok(Object.prototype.hasOwnProperty.call(map, inner[i]), `unexpected curl escape: \\${inner[i]}`);
    value += map[inner[i]];
  }
  return value;
}

function parseConfig(config) {
  const options = {};
  for (const line of String(config).split('\n').filter(Boolean)) {
    const separator = line.indexOf('=');
    if (separator < 0) {
      (options[line.trim()] ||= []).push(true);
      continue;
    }
    const name = line.slice(0, separator).trim();
    const value = decodeCurlValue(line.slice(separator + 1).trim());
    (options[name] ||= []).push(value);
  }
  return options;
}

function recordCall(command, args, options) {
  const config = Buffer.isBuffer(options && options.input)
    ? options.input.toString('utf8')
    : String(options && options.input || '');
  const parsed = parseConfig(config);
  const writeOut = parsed['write-out'] && parsed['write-out'][0];
  const markerMatch = /^(__SYNCVIEW_VISION_META_[a-f0-9]{36}__)%\{http_code\}\t%\{content_type\}\1$/.exec(writeOut || '');
  assert.ok(markerMatch, 'vision curl metadata trailer must be random and self-delimiting');
  const call = { command, args: args.slice(), options: parsed, spawnOptions: options, marker: markerMatch[1] };
  calls.push(call);
  return call;
}

function responseOutput(call) {
  const verdict = {
    verdict: 'ok',
    looks_right: true,
    does_right_thing: true,
    issues: [],
    summary: 'synthetic fileless response',
  };
  const payload = mode === 'api-error'
    ? { type: 'error', error: { message: `${HEADER_MARKER} ${BODY_MARKER} ${URL_MARKER}` } }
    : { content: [{ type: 'text', text: JSON.stringify(verdict) }] };
  const body = Buffer.from(JSON.stringify(payload));
  return Buffer.concat([
    body,
    Buffer.from(`${call.marker}200\tapplication/json${call.marker}`, 'utf8'),
  ]);
}

const originalKey = process.env.ANTHROPIC_API_KEY;
const originalTmp = process.env.SXR_TMP;
const originalStaffKey = process.env.SYNCVIEW_STAFF_KEY;
const originalLegacyToken = process.env.SYNCVIEW_TEST_CLIENT_TOKEN;
const originalVisionMode = process.env.MASTER_VISION;
const originalSpawnSync = childProcess.spawnSync;
process.env.ANTHROPIC_API_KEY = HEADER_MARKER;
process.env.SXR_TMP = RESIDUE_TMP;
process.env.SYNCVIEW_STAFF_KEY = 'synthetic-unrelated-staff-key';
process.env.SYNCVIEW_TEST_CLIENT_TOKEN = 'synthetic-unrelated-client-token';
let judge;
try {
  childProcess.spawnSync = (command, args, options) => {
    if (String(command).toLowerCase().includes('claude')) {
      const call = { command, args: args.slice(), spawnOptions: options };
      cliCalls.push(call);
      if (args.includes('--version')) {
        return { status: 0, signal: null, error: null, stdout: 'synthetic claude 1.0\n', stderr: '' };
      }
      if (mode === 'cli-error') {
        return {
          status: 1,
          signal: null,
          error: new Error(`${HEADER_MARKER} ${URL_MARKER}`),
          stdout: '',
          stderr: `${HEADER_MARKER} ${URL_MARKER}`,
        };
      }
      const verdict = JSON.stringify({
        verdict: 'ok',
        looks_right: true,
        does_right_thing: true,
        issues: [],
        summary: 'synthetic cli response',
      });
      return {
        status: 0,
        signal: null,
        error: null,
        stdout: JSON.stringify({ result: verdict }),
        stderr: '',
      };
    }
    const call = recordCall(command, args, options);
    if (mode === 'throw') throw new Error(`${HEADER_MARKER} ${BODY_MARKER} ${URL_MARKER}`);
    if (mode === 'return-error') {
      return {
        status: null,
        signal: null,
        error: new Error(`${HEADER_MARKER} ${BODY_MARKER} ${URL_MARKER}`),
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(`${HEADER_MARKER} ${BODY_MARKER} ${URL_MARKER}`),
      };
    }
    return {
      status: 0,
      signal: null,
      error: null,
      stdout: responseOutput(call),
      stderr: Buffer.alloc(0),
    };
  };
  delete require.cache[require.resolve(MODULE)];
  judge = require(MODULE);
} finally {
  childProcess.spawnSync = originalSpawnSync;
}

try {
  const source = fs.readFileSync(MODULE, 'utf8');
  for (const forbidden of [/_vision_req_/, /execSync\s*\([^)]*curl/s, /-d\s+@/, /curl failed.*e\.message/]) {
    assert.doesNotMatch(source, forbidden, `vision API retained forbidden protected transport: ${forbidden}`);
  }

  const shot = { scenario: 'synthetic', step: 1, label: 'fileless', path: SHOT };
  mode = 'success';
  const success = judge.judgeShot(shot, 'api', BODY_MARKER, 'synthetic-model');
  assert.deepEqual(success, {
    verdict: 'ok',
    looks_right: true,
    does_right_thing: true,
    issues: [],
    summary: 'synthetic fileless response',
  });

  const rawSuccess = judge.__test.visionApiRequest(
    `https://fixture.invalid/vision?token=${URL_MARKER}`,
    { 'x-api-key': HEADER_MARKER, 'x-synthetic': HEADER_MARKER },
    BODY_MARKER,
  );
  assert.equal(rawSuccess.status, 200);
  assert.ok(rawSuccess.body.length > 0, 'vision helper must return its response in memory');

  mode = 'api-error';
  const apiFailure = judge.judgeShot(shot, 'api', BODY_MARKER, 'synthetic-model');
  assert.deepEqual(apiFailure, {
    verdict: 'warn',
    looks_right: false,
    does_right_thing: false,
    issues: ['vision api returned an error'],
    summary: 'api error',
  });

  mode = 'return-error';
  const returnedFailure = judge.judgeShot(shot, 'api', BODY_MARKER, 'synthetic-model');
  assert.deepEqual(returnedFailure, {
    verdict: 'warn',
    looks_right: false,
    does_right_thing: false,
    issues: ['vision api request failed'],
    summary: 'api call failed',
  });

  mode = 'throw';
  let thrownFailure = null;
  try {
    judge.__test.visionApiRequest(
      `https://fixture.invalid/vision-throw?token=${URL_MARKER}`,
      { 'x-api-key': HEADER_MARKER },
      BODY_MARKER,
    );
  } catch (error) {
    thrownFailure = error;
  }
  assert.ok(thrownFailure, 'synchronously thrown vision curl failure must surface');
  assert.equal(thrownFailure.message, 'vision api request failed');

  assert.equal(calls.length, 5, 'exact vision API path and raw helper need success/failure coverage');
  for (const call of calls) {
    assert.deepEqual(call.args, ['--config', '-'], 'vision curl argv must contain only the config-stdin selector');
    const commandText = [call.command, ...call.args].join(' ');
    for (const marker of [HEADER_MARKER, BODY_MARKER, URL_MARKER]) {
      assert.equal(commandText.includes(marker), false, 'vision curl argv exposed a protected marker');
    }
    assert.equal(call.spawnOptions.env.ANTHROPIC_API_KEY, undefined, 'vision curl child must not inherit the API key');
    assert.equal(call.spawnOptions.env.SYNCVIEW_STAFF_KEY, undefined, 'vision curl child must not inherit the staff issuer key');
    assert.equal(call.spawnOptions.env.SYNCVIEW_TEST_CLIENT_TOKEN, undefined, 'vision curl child must not inherit a legacy client token');
    assert.equal(call.options.silent[0], true);
    assert.equal(call.options['show-error'][0], true);
    assert.equal(call.options.request[0], 'POST');
    assert.equal(call.options.output, undefined, 'vision response must remain on stdout');
    assert.equal(call.options['data-binary'], undefined, 'vision body must not use @file syntax');
  }

  const exactCall = calls[0];
  assert.equal(exactCall.options.url[0], 'https://api.anthropic.com/v1/messages');
  assert.equal(exactCall.options.header.includes(`x-api-key: ${HEADER_MARKER}`), true);
  const exactBody = JSON.parse(exactCall.options['data-raw'][0]);
  assert.equal(exactBody.model, 'synthetic-model');
  assert.equal(exactBody.messages[0].content[0].source.data, fs.readFileSync(SHOT).toString('base64'));
  assert.equal(exactBody.messages[0].content[1].text.includes(BODY_MARKER), true);

  const syntheticCall = calls[1];
  assert.equal(syntheticCall.options.url[0].includes(URL_MARKER), true);
  assert.equal(syntheticCall.options.header.includes(`x-synthetic: ${HEADER_MARKER}`), true);
  assert.equal(syntheticCall.options['data-raw'][0], BODY_MARKER);

  process.env.MASTER_VISION = 'auto';
  mode = 'success';
  assert.equal(judge.selectBackend(), 'cli', 'auto discovery drives the direct CLI probe');
  const cliSuccess = judge.judgeShot(shot, 'cli', 'synthetic-cli-change', 'synthetic-model');
  assert.deepEqual(cliSuccess, {
    verdict: 'ok',
    looks_right: true,
    does_right_thing: true,
    issues: [],
    summary: 'synthetic cli response',
  });
  mode = 'cli-error';
  const cliFailure = judge.judgeShot(shot, 'cli', 'synthetic-cli-change', 'synthetic-model');
  assert.deepEqual(cliFailure, {
    verdict: 'warn',
    looks_right: false,
    does_right_thing: false,
    issues: ['vision cli request failed'],
    summary: 'cli call failed',
  });
  assert.equal(cliCalls.length, 3, 'CLI discovery, success, and forced failure are all driven');
  for (const call of cliCalls) {
    assert.equal(call.spawnOptions.env.ANTHROPIC_API_KEY, undefined, 'vision CLI child must not inherit the API key');
    assert.equal(call.spawnOptions.env.SYNCVIEW_STAFF_KEY, undefined, 'vision CLI child must not inherit the staff issuer key');
    assert.equal(call.spawnOptions.env.SYNCVIEW_TEST_CLIENT_TOKEN, undefined, 'vision CLI child must not inherit a legacy client token');
  }
  assert.equal(JSON.stringify(cliFailure).includes(HEADER_MARKER), false, 'vision CLI failure is generic');
  assert.equal(JSON.stringify(cliFailure).includes(URL_MARKER), false, 'vision CLI failure omits child error detail');

  for (const rendered of [
    JSON.stringify(apiFailure),
    JSON.stringify(returnedFailure),
    `${thrownFailure.name}: ${thrownFailure.message}`,
  ]) {
    for (const marker of [HEADER_MARKER, BODY_MARKER, URL_MARKER]) {
      assert.equal(rendered.includes(marker), false, 'vision failure surfaced a protected marker');
    }
  }
  assert.deepEqual(fs.readdirSync(RESIDUE_TMP), [], 'vision request must leave no URL/header/body/response residue');
  console.log('Vision judge fileless credential transport guard: ok');
} finally {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
  if (originalTmp === undefined) delete process.env.SXR_TMP;
  else process.env.SXR_TMP = originalTmp;
  if (originalStaffKey === undefined) delete process.env.SYNCVIEW_STAFF_KEY;
  else process.env.SYNCVIEW_STAFF_KEY = originalStaffKey;
  if (originalLegacyToken === undefined) delete process.env.SYNCVIEW_TEST_CLIENT_TOKEN;
  else process.env.SYNCVIEW_TEST_CLIENT_TOKEN = originalLegacyToken;
  if (originalVisionMode === undefined) delete process.env.MASTER_VISION;
  else process.env.MASTER_VISION = originalVisionMode;
  fs.rmSync(SHOT_TMP, { recursive: true, force: true });
  fs.rmSync(RESIDUE_TMP, { recursive: true, force: true });
}

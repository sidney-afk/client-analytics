'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'qa', 'ef-writepath', 'lib.js');
const DRIFT_MODULE = path.join(ROOT, 'qa', 'ef-writepath', '21-drift-check.js');
const SETTINGS_MODULE = path.join(ROOT, 'qa', 'ef-writepath', '13-settings.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'syncview-efwp-fileless-'));
const HEADER_MARKER = 'synthetic-ef-header-secret "quoted" \\ slash\tvalue';
const BODY_MARKER = '@synthetic-ef-body-secret "quoted" \\ slash\nline\rreturn\ttab\vvertical';
const URL_MARKER = 'synthetic-ef-url-secret';
const RESPONSE_BYTES = Buffer.from([0x00, 0xff, 0x7f, 0x45, 0x46, 0x0a]);
const calls = [];
let actualServer = null;
let forcedFailurePath = '';

function within(promise, label, ms = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function decodeCurlValue(raw) {
  assert.equal(raw.startsWith('"') && raw.endsWith('"'), true, `curl config value is not quoted: ${raw}`);
  const inner = raw.slice(1, -1);
  let value = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== '\\') {
      value += inner[i];
      continue;
    }
    i += 1;
    assert.ok(i < inner.length, 'curl config value ends with a bare escape');
    const escaped = inner[i];
    const map = { '\\': '\\', '"': '"', t: '\t', n: '\n', r: '\r', v: '\v' };
    assert.ok(Object.prototype.hasOwnProperty.call(map, escaped), `unexpected curl escape: \\${escaped}`);
    value += map[escaped];
  }
  return value;
}

function parseConfig(config) {
  const options = {};
  const rawLines = String(config).split('\n').filter(Boolean);
  for (const line of rawLines) {
    const separator = line.indexOf('=');
    if (separator < 0) {
      (options[line.trim()] ||= []).push(true);
      continue;
    }
    const name = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    (options[name] ||= []).push(decodeCurlValue(raw));
  }
  return { options, rawLines };
}

function recordCall(command, args, input) {
  const parsed = parseConfig(Buffer.isBuffer(input) ? input.toString('utf8') : String(input || ''));
  const writeOut = parsed.options['write-out'] && parsed.options['write-out'][0];
  const markerMatch = /^(__SYNCVIEW_CURL_META_[a-f0-9]{36}__)%\{http_code\}\t%\{content_type\}\1$/.exec(writeOut || '');
  assert.ok(markerMatch, 'curl write-out trailer is not random and self-delimiting');
  const call = {
    command,
    args: args.slice(),
    options: parsed.options,
    rawLines: parsed.rawLines,
    marker: markerMatch[1],
  };
  calls.push(call);
  return call;
}

function responseOutput(call, body, status, ctype) {
  return Buffer.concat([
    body,
    Buffer.from(`${call.marker}${status}\t${ctype}${call.marker}`, 'utf8'),
  ]);
}

function requestUrl(call) {
  return call.options.url && call.options.url[0] || '';
}

function loadLibWithoutBrowser() {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'playwright' || /[\\/]playwright$/.test(String(request))) return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(MODULE)];
    return require(MODULE);
  } finally {
    Module._load = originalLoad;
  }
}

const originalTmp = process.env.EFWP_TMP;
const originalSpawnSync = childProcess.spawnSync;
const originalSpawn = childProcess.spawn;
process.env.EFWP_TMP = TMP;
let lib;
let drift;
let settings;
try {
  childProcess.spawnSync = (command, args, options) => {
    const call = recordCall(command, args, options && options.input);
    const url = requestUrl(call);
    if (forcedFailurePath && url.includes(forcedFailurePath)) {
      return {
        status: null,
        signal: null,
        error: new Error(`${HEADER_MARKER} ${BODY_MARKER} ${URL_MARKER}`),
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(`${HEADER_MARKER} ${BODY_MARKER} ${URL_MARKER}`),
      };
    }
    if (url.includes('fail-throw')) {
      throw new Error(`${HEADER_MARKER} ${BODY_MARKER} ${URL_MARKER}`);
    }
    if (url.includes('fail-')) {
      return {
        status: null,
        signal: null,
        error: new Error(`${HEADER_MARKER} ${BODY_MARKER} ${URL_MARKER}`),
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(`${HEADER_MARKER} ${BODY_MARKER} ${URL_MARKER}`),
      };
    }
    let body = RESPONSE_BYTES;
    let ctype = 'application/octet-stream';
    if (url.includes('/rest/v1/syncview_runtime_flags?')) {
      body = Buffer.from(JSON.stringify([{ value: { clients: [URL_MARKER] } }]));
      ctype = 'application/json';
    } else if (url.includes('/rest/v1/')) {
      body = Buffer.from(JSON.stringify([{ ok: 'read' }]));
      ctype = 'application/json';
    } else if (url.includes('/calendar-upsert-post')) {
      body = Buffer.from(JSON.stringify({ ok: 'calendar' }));
      ctype = 'application/json';
    } else if (url.includes('/sample-review-upsert')) {
      body = Buffer.from(JSON.stringify({ ok: 'sample' }));
      ctype = 'application/json';
    } else if (url.includes('/caption-prompts-save')) {
      body = Buffer.from(JSON.stringify({ ok: 'restore' }));
      ctype = 'application/json';
    }
    return {
      status: 0,
      signal: null,
      error: null,
      stdout: responseOutput(call, body, 200, ctype),
      stderr: Buffer.alloc(0),
    };
  };
  lib = loadLibWithoutBrowser();
  delete require.cache[require.resolve(DRIFT_MODULE)];
  delete require.cache[require.resolve(SETTINGS_MODULE)];
  drift = require(DRIFT_MODULE);
  settings = require(SETTINGS_MODULE);
} finally {
  childProcess.spawnSync = originalSpawnSync;
}

(async () => {
  try {
    const source = fs.readFileSync(MODULE, 'utf8');
    for (const forbidden of [
      /\bexecSync\b/,
      /\bwriteFileSync\b/,
      /--data-binary/,
      /_pd_/,
      /_resp_/,
    ]) {
      assert.doesNotMatch(source, forbidden, `EF write-path courier retained forbidden transport: ${forbidden}`);
    }

    const headers = {
      'Content-Type': 'application/json',
      'X-Syncview-Client-Token': HEADER_MARKER,
    };
    const success = lib.__test.courierFetch(
      'POST',
      `https://fixture.invalid/success?token=${URL_MARKER}`,
      headers,
      BODY_MARKER,
    );
    assert.equal(success.status, 200);
    assert.equal(success.ctype, 'application/octet-stream');
    assert.deepEqual(success.body, RESPONSE_BYTES, 'courier must preserve exact binary response bytes in memory');

    const failure = lib.__test.courierFetch(
      'POST',
      `https://fixture.invalid/fail-courier?token=${URL_MARKER}`,
      headers,
      BODY_MARKER,
    );
    assert.deepEqual(
      { status: failure.status, ctype: failure.ctype, body: failure.body.toString('utf8') },
      { status: 502, ctype: 'text/plain', body: 'courier-failed' },
    );

    assert.deepEqual(
      lib.supaGet(`fixture_${URL_MARKER}`, `select=${encodeURIComponent(BODY_MARKER)}`),
      [{ ok: 'read' }],
    );
    assert.deepEqual(lib.calUpN8n({ id: URL_MARKER, caption: BODY_MARKER }, HEADER_MARKER), { ok: 'calendar' });
    assert.deepEqual(lib.sampleUpN8n({ id: URL_MARKER, caption: BODY_MARKER }, HEADER_MARKER), { ok: 'sample' });
    assert.deepEqual(drift.flaggedClients(), [URL_MARKER], 'drift roster helper must parse the fileless runtime-flag read');
    assert.deepEqual(
      drift.get(`drift_${URL_MARKER}`, `select=${encodeURIComponent(BODY_MARKER)}`),
      [{ ok: 'read' }],
      'drift table helper must parse its fileless protected read',
    );
    assert.deepEqual(settings.restorePrompt(BODY_MARKER), { ok: 'restore' });

    const exactHelperFailures = [
      ['drift.flaggedClients', '/syncview_runtime_flags?', () => drift.flaggedClients()],
      ['drift.get', `/rest/v1/drift_forced_${URL_MARKER}?`, () => drift.get(`drift_forced_${URL_MARKER}`, 'select=*')],
      ['settings.restorePrompt', '/caption-prompts-save', () => settings.restorePrompt(BODY_MARKER)],
    ].map(([name, failurePath, invoke]) => {
      let error = null;
      forcedFailurePath = failurePath;
      try { invoke(); } catch (caught) { error = caught; }
      finally { forcedFailurePath = ''; }
      assert.ok(error, `${name} forced failure must throw`);
      assert.equal(error.message, 'curl request failed', `${name} failure must be generic`);
      return error;
    });

    let helperFailure = null;
    try {
      lib.supaGet(`fail-helper-${URL_MARKER}`, 'select=*');
    } catch (error) {
      helperFailure = error;
    }
    assert.ok(helperFailure, 'direct read helper failure must throw');
    assert.equal(helperFailure.message, 'curl request failed', 'helper failure must be generic');

    let thrownHelperFailure = null;
    try {
      lib.supaGet(`fail-throw-${URL_MARKER}`, `select=${encodeURIComponent(BODY_MARKER)}`);
    } catch (error) {
      thrownHelperFailure = error;
    }
    assert.ok(thrownHelperFailure, 'synchronously thrown child-process failure must surface');
    assert.equal(thrownHelperFailure.message, 'curl request failed', 'thrown failure must be generic');

    const rejectedHeader = lib.__test.courierFetch(
      'POST',
      `https://fixture.invalid/rejected?token=${URL_MARKER}`,
      { 'X-Unsafe': `line\n${HEADER_MARKER}` },
      BODY_MARKER,
    );
    assert.equal(rejectedHeader.status, 502, 'invalid header must fail closed before spawning curl');

    assert.equal(calls.length, 13, 'every protected probe helper must reach fileless curl and invalid headers must stop before spawn');
    for (const call of calls) {
      assert.deepEqual(call.args, ['--config', '-'], 'curl argv must contain only the config-stdin selector');
      const commandText = [call.command, ...call.args].join(' ');
      for (const marker of [HEADER_MARKER, BODY_MARKER, URL_MARKER, lib.KEY]) {
        assert.equal(commandText.includes(marker), false, 'curl argv exposed a protected value');
      }
      assert.equal(call.options.silent[0], true);
      assert.equal(call.options['show-error'][0], true);
      assert.equal(call.options.location[0], true);
      assert.equal(call.options['max-time'][0], '60');
      assert.equal(call.options.output, undefined, 'response must remain on stdout');
      assert.equal(call.options['dump-header'], undefined, 'response headers must not use a file');
      assert.equal(call.options['data-binary'], undefined, 'request body must not use @file syntax');
    }

    const successCall = calls.find(call => requestUrl(call).includes('/success?'));
    assert.equal(successCall.options.header.includes(`X-Syncview-Client-Token: ${HEADER_MARKER}`), true);
    assert.equal(successCall.options['data-raw'][0], BODY_MARKER, 'protected body must round-trip through stdin config');
    const dataLine = successCall.rawLines.find(line => line.startsWith('data-raw = '));
    for (const escaped of ['\\"', '\\\\', '\\n', '\\r', '\\t', '\\v']) {
      assert.equal(dataLine.includes(escaped), true, `body config omitted ${escaped} escaping`);
    }

    const readCall = calls.find(call => requestUrl(call).includes(`/rest/v1/fixture_${URL_MARKER}`));
    assert.equal(readCall.options.request[0], 'GET');
    assert.equal(readCall.options['data-raw'], undefined, 'GET must remain bodyless');
    assert.equal(readCall.options.header.includes(`apikey: ${lib.KEY}`), true);
    assert.equal(readCall.options.header.includes(`Authorization: Bearer ${lib.KEY}`), true);

    const calendarCall = calls.find(call => requestUrl(call).includes('/calendar-upsert-post'));
    const sampleCall = calls.find(call => requestUrl(call).includes('/sample-review-upsert'));
    assert.deepEqual(JSON.parse(calendarCall.options['data-raw'][0]), {
      client: 'sidneylaruel',
      post: { id: URL_MARKER, caption: BODY_MARKER },
      comments_base_at: HEADER_MARKER,
    });
    assert.deepEqual(JSON.parse(sampleCall.options['data-raw'][0]), {
      client: 'sidneylaruel',
      sample: { id: URL_MARKER, caption: BODY_MARKER },
      comments_base_at: HEADER_MARKER,
    });

    const rosterCalls = calls.filter(call => requestUrl(call).includes('/rest/v1/syncview_runtime_flags?'));
    assert.equal(rosterCalls.length, 2, 'drift roster helper needs success and forced-failure coverage');
    const driftCalls = calls.filter(call => /\/rest\/v1\/drift_(?:forced_)?/.test(requestUrl(call)));
    assert.equal(driftCalls.length, 2, 'drift table helper needs success and forced-failure coverage');
    for (const call of [...rosterCalls, ...driftCalls]) {
      assert.equal(call.options.request[0], 'GET');
      assert.equal(call.options['data-raw'], undefined, 'drift reads must remain bodyless');
      assert.equal(call.options.header.includes(`apikey: ${lib.KEY}`), true);
      assert.equal(call.options.header.includes(`Authorization: Bearer ${lib.KEY}`), true);
    }
    const restoreCalls = calls.filter(call => requestUrl(call).includes('/caption-prompts-save'));
    assert.equal(restoreCalls.length, 2, 'settings restore helper needs success and forced-failure coverage');
    for (const call of restoreCalls) {
      assert.equal(call.options.request[0], 'POST');
      assert.deepEqual(call.options.header, ['Content-Type: application/json']);
      assert.deepEqual(JSON.parse(call.options['data-raw'][0]), { client: 'sidneylaruel', prompt: BODY_MARKER });
    }

    for (const rendered of [
      `${failure.status} ${failure.ctype} ${failure.body.toString('utf8')}`,
      `${helperFailure.name}: ${helperFailure.message}`,
      `${thrownHelperFailure.name}: ${thrownHelperFailure.message}`,
      `${rejectedHeader.status} ${rejectedHeader.ctype} ${rejectedHeader.body.toString('utf8')}`,
      ...exactHelperFailures.map(error => `${error.name}: ${error.message}`),
    ]) {
      for (const marker of [HEADER_MARKER, BODY_MARKER, URL_MARKER, lib.KEY]) {
        assert.equal(rendered.includes(marker), false, 'failure surfaced a protected value');
      }
    }

    // Exercise the generated stdin config through the installed curl. The
    // fixture runs in a child process so the synchronous request cannot block
    // the server event loop.
    const serverCode = `
      const http = require('node:http');
      const body = Buffer.from([0, 255, 127, 69, 70, 10]);
      const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          process.send({
            type: 'proof',
            method: req.method,
            token: req.headers['x-syncview-client-token'] || '',
            body: Buffer.concat(chunks).toString('base64'),
          });
          res.writeHead(208, { 'content-type': 'application/x-ef-fileless' });
          res.end(body);
          server.close(() => process.exit(0));
        });
      });
      server.listen(0, '127.0.0.1', () => process.send({ type: 'ready', port: server.address().port }));
      setTimeout(() => process.exit(3), 15000).unref();
    `;
    actualServer = originalSpawn(process.execPath, ['-e', serverCode], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    });
    const exitPromise = once(actualServer, 'exit');
    const [ready] = await within(once(actualServer, 'message'), 'local curl fixture startup');
    assert.equal(ready.type, 'ready');
    const proofPromise = once(actualServer, 'message');
    const realLib = loadLibWithoutBrowser();
    const actual = realLib.__test.courierFetch(
      'POST',
      `http://127.0.0.1:${ready.port}/write?token=${URL_MARKER}`,
      headers,
      BODY_MARKER,
    );
    assert.equal(actual.status, 208);
    assert.equal(actual.ctype, 'application/x-ef-fileless');
    assert.deepEqual(actual.body, RESPONSE_BYTES);
    const [proof] = await within(proofPromise, 'local curl request proof');
    assert.deepEqual(
      {
        method: proof.method,
        token: proof.token,
        body: Buffer.from(proof.body, 'base64').toString('utf8'),
      },
      { method: 'POST', token: HEADER_MARKER, body: BODY_MARKER },
      'installed curl must receive the exact escaped method/header/body',
    );
    const [exitCode] = await within(exitPromise, 'local curl fixture shutdown');
    assert.equal(exitCode, 0);
    actualServer = null;

    assert.deepEqual(fs.readdirSync(TMP), [], 'fileless harness must leave no request/header/body/response residue');
    console.log('EF write-path fileless credential transport guard: ok');
  } finally {
    if (actualServer && !actualServer.killed) {
      try { actualServer.kill(); } catch {}
    }
    if (originalTmp === undefined) delete process.env.EFWP_TMP;
    else process.env.EFWP_TMP = originalTmp;
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});

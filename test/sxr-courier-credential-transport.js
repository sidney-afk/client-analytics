'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');
const { PassThrough } = require('node:stream');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'qa', 'sxr_courier_lib.js');
const P94_MODULE = path.join(ROOT, 'qa', 'probes', 'p94_nav_full_quota.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'syncview-courier-fileless-'));
const HEADER_MARKER = 'synthetic-header-secret-marker "quoted" \\ slash\tvalue';
const BODY_MARKER = '@synthetic-body-secret-marker "quoted" \\ slash\nline\rreturn\ttab\vvertical snowman=☃';
const URL_MARKER = 'synthetic-url-secret-marker';
const SYNC_BODY = Buffer.from([0x00, 0xff, 0x7f, 0x41, 0x0a, 0x42]);
const ASYNC_BODY = Buffer.from([0xfe, 0x00, 0x42, 0x0d, 0x0a, 0x43]);
const calls = [];
let actualServer = null;
let protectedKey = '';

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

function recordCall(kind, command, args, input) {
  const config = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  const parsed = parseConfig(config);
  const writeOut = parsed.options['write-out'] && parsed.options['write-out'][0];
  const markerMatch = /^(__SYNCVIEW_CURL_META_[a-f0-9]{36}__)%\{http_code\}\t%\{content_type\}\1$/.exec(writeOut || '');
  assert.ok(markerMatch, 'curl write-out trailer is not random and self-delimiting');
  const call = {
    kind,
    command,
    args: args.slice(),
    config,
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

function loadCourierWithoutBrowser() {
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

const originalTmp = process.env.SXR_TMP;
const originalSpawnSync = childProcess.spawnSync;
const originalSpawn = childProcess.spawn;
process.env.SXR_TMP = TMP;
let courier;
let p94;
try {
  childProcess.spawnSync = (command, args, options) => {
    const call = recordCall('sync', command, args, options && options.input);
    const url = requestUrl(call);
    if (url.includes('fail-helper-throw')) {
      throw new Error(`${HEADER_MARKER} ${BODY_MARKER} ${URL_MARKER} ${protectedKey}`);
    }
    if (url.includes('fail-sync') || url.includes('fail-helper')) {
      return {
        status: null,
        signal: null,
        error: new Error(`${HEADER_MARKER} ${BODY_MARKER} ${URL_MARKER} ${protectedKey}`),
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(`${HEADER_MARKER} ${BODY_MARKER} ${URL_MARKER} ${protectedKey}`),
      };
    }
    const isNodePost = url.includes('node-post');
    const restMatch = /\/rest\/v1\/([^?]+)/.exec(url);
    const body = isNodePost
      ? Buffer.from(JSON.stringify({ ok: true }))
      : restMatch
        ? Buffer.from(JSON.stringify([{ table: restMatch[1] }]))
        : SYNC_BODY;
    const status = isNodePost || restMatch ? 200 : 206;
    const ctype = isNodePost || restMatch ? 'application/json' : 'application/octet-stream';
    return {
      status: 0,
      signal: null,
      error: null,
      stdout: responseOutput(call, body, status, ctype),
      stderr: Buffer.alloc(0),
    };
  };
  childProcess.spawn = (command, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new PassThrough();
    const input = [];
    child.stdin.on('data', chunk => input.push(Buffer.from(chunk)));
    child.stdin.on('finish', () => {
      const call = recordCall('async', command, args, Buffer.concat(input));
      setImmediate(() => {
        if (requestUrl(call).includes('fail-async')) {
          child.emit('error', new Error(`${HEADER_MARKER} ${BODY_MARKER}`));
          child.emit('close', 2, null);
          return;
        }
        child.stdout.end(responseOutput(call, ASYNC_BODY, 207, 'application/x-fixture'));
        child.emit('close', 0, null);
      });
    });
    child.kill = () => {
      setImmediate(() => child.emit('close', null, 'SIGKILL'));
      return true;
    };
    return child;
  };
  courier = loadCourierWithoutBrowser();
  protectedKey = courier.KEY;
  delete require.cache[require.resolve(P94_MODULE)];
  p94 = require(P94_MODULE);
} finally {
  childProcess.spawnSync = originalSpawnSync;
  childProcess.spawn = originalSpawn;
}

(async () => {
  try {
    const source = fs.readFileSync(MODULE, 'utf8');
    assert.doesNotMatch(
      source,
      /_exec\s*\(\s*`curl|curl\s+-s\s+https?:/,
      'protected HTTP helpers must not bypass the stdin-config transport',
    );

    const headers = {
      'Content-Type': 'application/json',
      'X-Syncview-Client-Token': HEADER_MARKER,
    };
    const syncUrl = `https://fixture.invalid/sync-success?token=${URL_MARKER}`;
    const syncResult = courier.__test.courierFetch('POST', syncUrl, headers, BODY_MARKER);
    assert.equal(syncResult.status, 206);
    assert.equal(syncResult.ctype, 'application/octet-stream');
    assert.deepEqual(syncResult.body, SYNC_BODY, 'sync transport must preserve exact binary response bytes');

    const postUrl = `https://fixture.invalid/node-post?token=${URL_MARKER}`;
    const postResult = courier.__test.nodePost(postUrl, { marker: BODY_MARKER });
    assert.deepEqual(postResult, { ok: true });

    const syncFailure = courier.__test.courierFetch(
      'POST',
      `https://fixture.invalid/fail-sync?token=${URL_MARKER}`,
      headers,
      BODY_MARKER,
    );
    assert.equal(syncFailure.status, 502);
    assert.equal(syncFailure.ctype, 'text/plain');
    assert.equal(syncFailure.body.toString('utf8'), 'courier-failed');

    const asyncResult = await courier.__test.courierFetchAsync(
      'POST',
      `https://fixture.invalid/async-success?token=${URL_MARKER}`,
      headers,
      BODY_MARKER,
    );
    assert.equal(asyncResult.status, 207);
    assert.equal(asyncResult.ctype, 'application/x-fixture');
    assert.deepEqual(asyncResult.body, ASYNC_BODY, 'async transport must preserve exact binary response bytes');

    const asyncFailure = await courier.__test.courierFetchAsync(
      'POST',
      `https://fixture.invalid/fail-async?token=${URL_MARKER}`,
      headers,
      BODY_MARKER,
    );
    assert.equal(asyncFailure.status, 502);
    assert.equal(asyncFailure.ctype, 'text/plain');
    assert.equal(asyncFailure.body.toString('utf8'), 'courier-failed');

    const bodylessGet = courier.__test.courierFetch(
      'GET',
      `https://fixture.invalid/bodyless-get?token=${URL_MARKER}`,
      { Accept: 'application/octet-stream' },
      null,
    );
    assert.equal(bodylessGet.status, 206);
    assert.equal(bodylessGet.ctype, 'application/octet-stream');
    assert.deepEqual(bodylessGet.body, SYNC_BODY);

    const p94Success = p94.forwardExternal(
      'POST',
      `https://fixture.invalid/p94-success?token=${URL_MARKER}`,
      headers,
      BODY_MARKER,
    );
    assert.equal(p94Success.status, 200, 'p94 must preserve its historical upstream-status normalization');
    assert.equal(p94Success.ctype, 'application/octet-stream');
    assert.deepEqual(p94Success.body, SYNC_BODY);
    const p94Failure = p94.forwardExternal(
      'POST',
      `https://fixture.invalid/fail-sync-p94?token=${URL_MARKER}`,
      headers,
      BODY_MARKER,
    );
    assert.deepEqual(
      { status: p94Failure.status, ctype: p94Failure.ctype, body: p94Failure.body.toString('utf8') },
      { status: 502, ctype: 'text/plain', body: 'x' },
      'p94 must surface only its generic courier failure',
    );

    const readQuery = `select=*&proof=${encodeURIComponent(URL_MARKER)}`;
    assert.deepEqual(courier.supa(readQuery), [{ table: 'sample_reviews' }]);
    assert.deepEqual(courier.supaEvents(readQuery), [{ table: 'sample_review_events' }]);
    assert.deepEqual(courier.supaCal(readQuery), [{ table: 'calendar_posts' }]);

    const helperFailures = [
      ['supa', () => courier.supa(`fail-helper=${URL_MARKER}`)],
      ['supaEvents', () => courier.supaEvents(`fail-helper-throw=${URL_MARKER}`)],
      ['supaCal', () => courier.supaCal(`fail-helper=${URL_MARKER}`)],
    ].map(([name, invoke]) => {
      let error = null;
      try { invoke(); } catch (caught) { error = caught; }
      assert.ok(error, `${name} forced failure must throw`);
      assert.equal(error.message, 'curl request failed', `${name} failure must be generic`);
      return error;
    });

    const rejectedControl = courier.__test.courierFetch(
      'POST',
      `https://fixture.invalid/rejected-control?token=${URL_MARKER}`,
      headers,
      `unsafe\u0000${BODY_MARKER}`,
    );
    assert.equal(rejectedControl.status, 502, 'unrepresentable config bytes must fail closed before spawning curl');

    assert.equal(calls.length, 14, 'all protected helpers must use curl and rejected controls must stop before spawn');
    for (const call of calls) {
      assert.deepEqual(call.args, ['--config', '-'], `${call.kind} curl argv must contain only the config-stdin selector`);
      const commandText = [call.command, ...call.args].join(' ');
      for (const marker of [HEADER_MARKER, BODY_MARKER, URL_MARKER, courier.KEY]) {
        assert.equal(commandText.includes(marker), false, `${call.kind} argv exposed a protected marker`);
      }
      assert.equal(call.options.url[0].includes(URL_MARKER), true, `${call.kind} stdin config lost the protected URL`);
      assert.equal(call.options['silent'][0], true);
      assert.equal(call.options['show-error'][0], true);
      assert.equal(call.options['max-time'][0], '60');
      assert.equal(call.rawLines.some(line => /(?:^|=)\s*[^"]*@[^"]*$/.test(line)), false, `${call.kind} config must not use @file body syntax`);
    }
    const bodylessCall = calls.find(call => requestUrl(call).includes('bodyless-get'));
    assert.equal(bodylessCall.options.request[0], 'GET');
    assert.equal(bodylessCall.options['data-raw'], undefined, 'bodyless GET must not acquire a synthetic request body');

    const courierCalls = calls.filter(call =>
      requestUrl(call).includes('fixture.invalid') &&
      !requestUrl(call).includes('node-post') &&
      !requestUrl(call).includes('bodyless-get'));
    for (const call of courierCalls) {
      assert.equal(call.options.request[0], 'POST');
      assert.equal(call.options['data-raw'].length, 1, `${call.kind} stdin config must contain exactly one literal body`);
      assert.equal(call.options.header.includes(`X-Syncview-Client-Token: ${HEADER_MARKER}`), true);
      assert.equal(call.options['data-raw'][0], BODY_MARKER, `${call.kind} body escaping changed protected bytes`);
      const dataLine = call.rawLines.find(line => line.startsWith('data-raw = '));
      for (const escaped of ['\\"', '\\\\', '\\n', '\\r', '\\t', '\\v']) {
        assert.equal(dataLine.includes(escaped), true, `${call.kind} body config omitted ${escaped} escaping`);
      }
      assert.equal(/[\r\t\v]/.test(dataLine), false, `${call.kind} body controls leaked into the line-oriented config`);
    }

    const nodePostCall = calls.find(call => requestUrl(call).includes('node-post'));
    assert.deepEqual(nodePostCall.options.header, ['Content-Type: application/json']);
    assert.equal(
      nodePostCall.options['data-raw'][0],
      JSON.stringify({ marker: BODY_MARKER }),
      'nodePost JSON must round-trip through the same fileless config',
    );

    const protectedReadCalls = calls.filter(call => requestUrl(call).includes('/rest/v1/'));
    assert.equal(protectedReadCalls.length, 6, 'each protected read helper needs success and forced-failure coverage');
    for (const call of protectedReadCalls) {
      assert.equal(call.options.request[0], 'GET');
      assert.equal(call.options['data-raw'], undefined, 'protected read helper must remain bodyless');
      assert.equal(call.options.header.includes(`apikey: ${courier.KEY}`), true);
      assert.equal(call.options.header.includes(`Authorization: Bearer ${courier.KEY}`), true);
    }
    for (const table of ['sample_reviews', 'sample_review_events', 'calendar_posts']) {
      assert.equal(
        protectedReadCalls.filter(call => requestUrl(call).includes(`/rest/v1/${table}?`)).length,
        2,
        `${table} helper must use fileless curl on success and failure`,
      );
    }

    const renderedFailures = [
      `${syncFailure.status} ${syncFailure.ctype} ${syncFailure.body.toString('utf8')}`,
      `${asyncFailure.status} ${asyncFailure.ctype} ${asyncFailure.body.toString('utf8')}`,
      `${p94Failure.status} ${p94Failure.ctype} ${p94Failure.body.toString('utf8')}`,
      `${rejectedControl.status} ${rejectedControl.ctype} ${rejectedControl.body.toString('utf8')}`,
      ...helperFailures.map(error => `${error.name}: ${error.message}`),
    ];
    for (const rendered of renderedFailures) {
      assert.equal(rendered.includes(HEADER_MARKER), false, 'generic failure echoed the header credential');
      assert.equal(rendered.includes(BODY_MARKER), false, 'generic failure echoed the request body');
      assert.equal(rendered.includes(URL_MARKER), false, 'generic failure echoed the protected URL');
      assert.equal(rendered.includes(courier.KEY), false, 'generic failure echoed the Supabase credential');
    }

    // Exercise the generated config through the installed curl as well as the
    // hermetic child-process doubles above. The HTTP server is a separate local
    // process so the synchronous courier cannot block its event loop.
    const serverCode = `
      const http = require('node:http');
      const responses = [
        { status: 208, type: 'application/x-sync-fileless', body: Buffer.from([0, 255, 127, 65, 10, 66]) },
        { status: 209, type: 'application/x-async-fileless', body: Buffer.from([254, 0, 66, 13, 10, 67]) },
      ];
      let seen = 0;
      const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          const index = seen++;
          process.send({
            type: 'proof',
            index,
            method: req.method,
            token: req.headers['x-syncview-client-token'] || '',
            body: Buffer.concat(chunks).toString('base64'),
          });
          const fixture = responses[index];
          res.writeHead(fixture.status, { 'content-type': fixture.type });
          res.end(fixture.body);
          if (seen === responses.length) server.close(() => process.exit(0));
        });
      });
      server.listen(0, '127.0.0.1', () => {
        process.send({ type: 'ready', port: server.address().port });
      });
      setTimeout(() => process.exit(3), 15000).unref();
    `;
    actualServer = originalSpawn(process.execPath, ['-e', serverCode], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    });
    const readyPromise = once(actualServer, 'message');
    const exitPromise = once(actualServer, 'exit');
    const [ready] = await within(readyPromise, 'local curl fixture startup');
    assert.equal(ready.type, 'ready');
    const proofs = [];
    const proofPromise = new Promise(resolve => {
      actualServer.on('message', message => {
        if (message && message.type === 'proof') {
          proofs.push(message);
          if (proofs.length === 2) resolve(proofs);
        }
      });
    });
    const realCourier = loadCourierWithoutBrowser();
    const actualSync = realCourier.__test.courierFetch(
      'POST',
      `http://127.0.0.1:${ready.port}/sync?token=${URL_MARKER}`,
      headers,
      BODY_MARKER,
    );
    assert.equal(actualSync.status, 208);
    assert.equal(actualSync.ctype, 'application/x-sync-fileless');
    assert.deepEqual(actualSync.body, SYNC_BODY);
    const actualAsync = await realCourier.__test.courierFetchAsync(
      'POST',
      `http://127.0.0.1:${ready.port}/async?token=${URL_MARKER}`,
      headers,
      BODY_MARKER,
    );
    assert.equal(actualAsync.status, 209);
    assert.equal(actualAsync.ctype, 'application/x-async-fileless');
    assert.deepEqual(actualAsync.body, ASYNC_BODY);
    await within(proofPromise, 'local curl request proof');
    const [exitCode] = await within(exitPromise, 'local curl fixture shutdown');
    assert.equal(exitCode, 0);
    actualServer = null;
    assert.deepEqual(
      proofs.map(proof => ({
        method: proof.method,
        token: proof.token,
        body: Buffer.from(proof.body, 'base64').toString('utf8'),
      })),
      [
        { method: 'POST', token: HEADER_MARKER, body: BODY_MARKER },
        { method: 'POST', token: HEADER_MARKER, body: BODY_MARKER },
      ],
      'installed curl must receive the exact escaped method/header/body on both transports',
    );
    assert.deepEqual(fs.readdirSync(TMP), [], 'fileless courier must create no request/header/response temp files');

    console.log('SXR courier fileless credential transport guard: ok');
  } finally {
    if (actualServer && !actualServer.killed) {
      try { actualServer.kill(); } catch {}
    }
    if (originalTmp === undefined) delete process.env.SXR_TMP;
    else process.env.SXR_TMP = originalTmp;
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});

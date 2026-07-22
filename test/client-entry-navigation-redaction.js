'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const {
  TEST_CLIENT,
  gotoTestClientEntry,
} = require('../qa/test-client-entry.js');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = 'synthetic-navigation-token-A&B';

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

(async () => {
  let attemptedUrl = '';
  let failure = null;
  const page = {
    goto: async url => {
      attemptedUrl = url;
      throw new Error(`Playwright page.goto failed at ${url}`);
    },
  };

  try {
    await gotoTestClientEntry(page, {
      origin: 'https://fixture.invalid',
      view: 'sample-reviews',
      name: TEST_CLIENT.name,
      token: TOKEN,
      gotoOptions: { waitUntil: 'domcontentloaded' },
    });
  } catch (error) {
    failure = error;
  }

  assert.equal(new URL(attemptedUrl).searchParams.get('t'), TOKEN, 'fixture drives a real token-bearing navigation attempt');
  assert.ok(failure, 'synthetic Playwright failure reaches the redaction boundary');
  assert.equal(failure.name, 'TestClientNavigationError');
  assert.equal(failure.message, 'TEST client sample-reviews navigation failed before boot');
  const serializedFailure = [
    String(failure),
    failure.stack || '',
    JSON.stringify(failure),
  ].join('\n');
  assert.equal(serializedFailure.includes(TOKEN), false, 'error object omits the raw token');
  assert.equal(serializedFailure.includes(encodeURIComponent(TOKEN)), false, 'error object omits the encoded token');
  assert.equal(/[?&]t=/.test(serializedFailure), false, 'error object omits the credential-bearing URL');

  const modulePath = path.join(ROOT, 'qa/test-client-entry.js');
  const childScript = `
    const { TEST_CLIENT, gotoTestClientEntry } = require(${JSON.stringify(modulePath)});
    const token = ${JSON.stringify(TOKEN)};
    const page = { goto: async url => { throw new Error('playwright leaked url ' + url); } };
    (async () => {
      try {
        await gotoTestClientEntry(page, {
          origin: 'https://fixture.invalid',
          view: 'calendar',
          name: TEST_CLIENT.name,
          token,
        });
      } catch (error) {
        const serialized = [String(error), error.stack || '', JSON.stringify(error)].join('\\n');
        if (serialized.includes(token) || serialized.includes(encodeURIComponent(token)) || /[?&]t=/.test(serialized)) process.exit(9);
        process.stdout.write(error.message + '\\n');
        process.stderr.write((error.stack || String(error)) + '\\n');
      }
    })().catch(() => process.exit(8));
  `;
  const child = spawnSync(process.execPath, ['-e', childScript], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const runnerOutput = `${child.stdout || ''}\n${child.stderr || ''}`;
  assert.match(runnerOutput, /TEST client calendar navigation failed before boot/);
  assert.equal(runnerOutput.includes(TOKEN), false, 'runner stdout/stderr omit the raw token');
  assert.equal(runnerOutput.includes(encodeURIComponent(TOKEN)), false, 'runner stdout/stderr omit the encoded token');
  assert.equal(/[?&]t=/.test(runnerOutput), false, 'runner stdout/stderr omit the client URL');

  const qaRoot = path.join(ROOT, 'qa');
  const pending = [qaRoot];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name.endsWith('.js') && absolute !== modulePath) {
        const source = fs.readFileSync(absolute, 'utf8');
        assert.equal(
          source.includes('testClientEntryPath'),
          false,
          `${path.relative(ROOT, absolute)} must not bypass redacted client navigation`,
        );
      }
    }
  }

  for (const relative of [
    'qa/golden_lib.js',
    'qa/probes/lib.js',
    'qa/sxr_courier_lib.js',
    'qa/ef-writepath/lib.js',
    'qa/probes/p30_linear_client.js',
    'qa/probes/p31_caption_gen.js',
    'qa/probes/p36_full_sync.js',
    'qa/probes/parity_logic.js',
  ]) {
    assert.ok(read(relative).includes('gotoTestClientEntry'), `${relative} must use the redacted navigation boundary`);
  }

  const samplesWorkflow = read('.github/workflows/samples-e2e-nightly.yml');
  assert.match(
    samplesWorkflow,
    /Samples probes[\s\S]*?SYNCVIEW_NIGHTLY_PROBES:[\s\S]*?run: node qa\/run-probes\.js/,
    'samples nightly probes must use the owned silent-server runner',
  );
  assert.equal(
    samplesWorkflow.includes('python3 -m http.server'),
    false,
    'samples workflow must not launch an unverified static server directly',
  );
  const overnightRunner = read('qa/overnight_runner.sh');
  assert.match(
    overnightRunner,
    /http\.server\.test\([\s\S]*?\n' "\$PORT" >\/dev\/null 2>&1 &/,
    'operative overnight runner must discard static-server access and error output',
  );
  assert.equal(
    overnightRunner.includes('syncview_overnight_http.log'),
    false,
    'overnight runner must not persist token-bearing access logs',
  );
  assert.match(
    overnightRunner,
    /if port_ready; then[\s\S]*?REFUSE port[\s\S]*?return 1/,
    'overnight runner must reject a pre-existing unowned server',
  );
  assert.match(
    overnightRunner,
    /kill -0 "\$SRV_PID"[\s\S]*?port_ready && return 0/,
    'overnight runner must prove its silent server child remains alive before readiness',
  );
  assert.match(
    overnightRunner,
    /env -u SYNCVIEW_STAFF_KEY -u SYNCVIEW_TEST_CLIENT_TOKEN "\$PYTHON_BIN" -c/,
    'overnight runner must scrub both client-entry credentials before launching Python',
  );
  assert.match(
    overnightRunner,
    /os\.environ\.get\("SYNCVIEW_STAFF_KEY"\)[\s\S]*?os\.environ\.get\("SYNCVIEW_TEST_CLIENT_TOKEN"\)[\s\S]*?raise SystemExit\(78\)/,
    'the actual overnight server child must dynamically fail if either protected value survives',
  );

  const runnerSource = read('qa/run-probes.js');
  assert.match(
    runnerSource,
    /if \(await serverUp\(\)\) \{[\s\S]*?refusing to send protected client URLs to an unowned server/,
    'probe runner must fail closed when port 8000 is already occupied',
  );
  assert.match(
    runnerSource,
    /waitForOwnedServer\(srv, \(\) => serverFailed\)/,
    'probe runner must bind readiness to the server child it launched',
  );
  const masterSource = read('qa/master.js');
  assert.match(
    masterSource,
    /if \(await serverUp\(\)\) \{[\s\S]*?refusing to send protected client URLs to an unowned server/,
    'master must fail closed when its default server port is already occupied',
  );
  assert.match(
    masterSource,
    /waitForOwnedServer\(srv, \(\) => serverFailed\)/,
    'master must bind readiness to the server child it launched',
  );

  const blockerScript = `
    const http = require('node:http');
    const server = http.createServer((request, response) => {
      process.stdout.write('request=' + request.url + '\\n');
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><title>unowned fixture</title>');
    });
    server.on('error', error => {
      process.stderr.write('server-error=' + error.code + '\\n');
      process.exit(error.code === 'EADDRINUSE' ? 17 : 18);
    });
    server.listen(8000, () => process.stdout.write('ready\\n'));
  `;
  const blocker = spawn(process.execPath, ['-e', blockerScript], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  let blockerOutput = '';
  blocker.stdout.on('data', chunk => { blockerOutput += chunk.toString('utf8'); });
  blocker.stderr.on('data', chunk => { blockerOutput += chunk.toString('utf8'); });
  const blockerReady = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`unowned server fixture did not start: ${blockerOutput}`)), 10000);
    const inspect = () => {
      if (blockerOutput.includes('ready\n')) {
        clearTimeout(timeout);
        resolve(true);
      } else if (blockerOutput.includes('server-error=EADDRINUSE')) {
        clearTimeout(timeout);
        resolve(false);
      }
    };
    blocker.stdout.on('data', inspect);
    blocker.stderr.on('data', inspect);
    blocker.once('exit', code => {
      if (code !== 17 && !blockerOutput.includes('ready\n')) {
        clearTimeout(timeout);
        reject(new Error(`unowned server fixture exited ${code}: ${blockerOutput}`));
      }
    });
  });
  try {
    const protectedEnv = {
      ...process.env,
      SYNCVIEW_STAFF_KEY: 'synthetic-unowned-server-staff-key',
      SYNCVIEW_TEST_CLIENT_TOKEN: TOKEN,
      SYNCVIEW_NIGHTLY_PROBES: 'p94_nav_full_quota',
    };
    const probeRunner = spawnSync(process.execPath, [path.join(ROOT, 'qa', 'run-probes.js')], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: false,
      timeout: 15000,
      env: protectedEnv,
    });
    assert.equal(probeRunner.status, 2, probeRunner.stderr || probeRunner.stdout);
    assert.match(
      `${probeRunner.stdout || ''}\n${probeRunner.stderr || ''}`,
      /refusing to send protected client URLs to an unowned server|Owned static server never came up/,
    );

    const masterRunner = spawnSync(process.execPath, [path.join(ROOT, 'qa', 'master.js'), '--lane=parity'], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: false,
      timeout: 15000,
      env: protectedEnv,
    });
    assert.equal(masterRunner.status, 2, masterRunner.stderr || masterRunner.stdout);
    assert.match(
      `${masterRunner.stdout || ''}\n${masterRunner.stderr || ''}`,
      /refusing to send protected client URLs to an unowned server|Owned static server never came up/,
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    for (const output of [
      blockerOutput,
      probeRunner.stdout || '',
      probeRunner.stderr || '',
      masterRunner.stdout || '',
      masterRunner.stderr || '',
    ]) {
      assert.equal(output.includes(TOKEN), false, 'unowned-server refusal exposed the synthetic token');
      assert.equal(/[?&]t=/.test(output), false, 'unowned-server refusal opened or printed a client-entry URL');
    }
    if (blockerReady) {
      assert.match(blockerOutput, /request=\/index\.html/);
      assert.equal(blockerOutput.includes('?'), false, 'ownership preflight sent only a credential-free readiness path');
    }
  } finally {
    if (blocker.exitCode === null) blocker.kill();
  }

  console.log('Client-entry navigation redaction checks: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});

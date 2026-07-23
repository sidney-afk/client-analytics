'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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
  console.log('Client-entry navigation redaction checks: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});

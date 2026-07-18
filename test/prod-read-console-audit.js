'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { installReadConsoleAudit } = require('../docs/syncview-design/tests/prod-test-utils');

const readUrl = 'https://example.supabase.co/rest/v1/items?select=id&token=private-value';
const otherUrl = 'https://example.supabase.co/rest/v1/other?select=id';

function request(url = readUrl, { failure = '', navigation = false, frame = null } = {}) {
  return {
    method: () => 'GET',
    url: () => url,
    failure: () => failure ? { errorText: failure } : null,
    isNavigationRequest: () => navigation,
    frame: () => frame,
  };
}

function resourceError(url = readUrl) {
  return {
    type: () => 'error',
    text: () => 'Failed to load resource: the server responded with a status of 500 ()',
    location: () => ({ url }),
  };
}

function respond(page, req, status, withConsole = false) {
  page.emit('response', { request: () => req, status: () => status });
  if (withConsole) page.emit('console', resourceError(req.url()));
  page.emit('requestfinished', req);
}

async function auditCase(build) {
  const page = new EventEmitter();
  const frame = {};
  const timers = [];
  let now = 1000;
  const realNow = Date.now;
  Date.now = () => now;
  page.mainFrame = () => frame;
  page.at = value => { now = value; };
  page.schedule = (at, fn) => timers.push({ at, fn });
  page.waitForTimeout = async ms => {
    const target = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const timer = timers[0];
      if (!timer || timer.at > target) break;
      timers.shift();
      now = timer.at;
      timer.fn();
    }
    now = target;
  };

  try {
    const audit = installReadConsoleAudit(page);
    build(page, frame);
    return await audit.settle(2500);
  } finally {
    Date.now = realNow;
  }
}

async function main() {
  const exactRecovery = await auditCase(page => {
    const failed = request();
    const recovered = request();
    page.emit('request', failed);
    respond(page, failed, 500, true);
    page.emit('request', recovered);
    respond(page, recovered, 200);
  });
  assert.equal(exactRecovery.ok, true);
  assert.equal(exactRecovery.recoveredReadAttempts, 1);

  const duplicateResourceError = await auditCase(page => {
    const failed = request();
    const recovered = request();
    page.emit('request', failed);
    page.emit('response', { request: () => failed, status: () => 500 });
    page.emit('console', resourceError());
    page.emit('console', resourceError());
    page.emit('requestfinished', failed);
    page.emit('request', recovered);
    respond(page, recovered, 200);
  });
  assert.equal(duplicateResourceError.ok, false);

  const unrelatedConsole = await auditCase(page => {
    const failed = request();
    const recovered = request();
    page.emit('request', failed);
    page.emit('response', { request: () => failed, status: () => 500 });
    page.emit('console', resourceError(otherUrl));
    page.emit('requestfinished', failed);
    page.emit('request', recovered);
    respond(page, recovered, 200);
  });
  assert.equal(unrelatedConsole.ok, false);

  const nonRetryable = await auditCase(page => {
    const failed = request();
    const later = request();
    page.emit('request', failed);
    respond(page, failed, 404, true);
    page.emit('request', later);
    respond(page, later, 200);
  });
  assert.equal(nonRetryable.ok, false);
  assert.match(nonRetryable.error, /404/);

  const redirectOnly = await auditCase(page => {
    const failed = request();
    const redirected = request();
    page.emit('request', failed);
    respond(page, failed, 500, true);
    page.emit('request', redirected);
    respond(page, redirected, 302);
  });
  assert.equal(redirectOnly.ok, false);

  const unprovenAbort = await auditCase(page => {
    const aborted = request(readUrl, { failure: 'net::ERR_ABORTED' });
    page.emit('request', aborted);
    page.emit('requestfailed', aborted);
  });
  assert.equal(unprovenAbort.ok, false);

  const navigationAbort = await auditCase((page, frame) => {
    const oldRead = request(readUrl, { failure: 'net::ERR_ABORTED' });
    page.emit('request', oldRead);
    page.at(1001);
    const navigation = request('http://localhost/', { navigation: true, frame });
    page.emit('request', navigation);
    page.at(1002);
    page.emit('requestfailed', oldRead);
    page.at(1003);
    page.emit('framenavigated', frame);
    respond(page, navigation, 200);
    page.at(1004);
    const newRead = request();
    page.emit('request', newRead);
    respond(page, newRead, 200);
  });
  assert.equal(navigationAbort.ok, true);
  assert.equal(navigationAbort.navigationAborts, 1);
  assert.equal(navigationAbort.recoveredReadAttempts, 0);

  const productAbort = await auditCase((page, frame) => {
    const navigation = request('http://localhost/', { navigation: true, frame });
    page.emit('request', navigation);
    respond(page, navigation, 200);
    page.at(1001);
    page.emit('framenavigated', frame);
    page.at(1002);
    const aborted = request(readUrl, { failure: 'net::ERR_ABORTED' });
    page.emit('request', aborted);
    page.at(1003);
    page.emit('requestfailed', aborted);
  });
  assert.equal(productAbort.ok, false);

  const pending = await auditCase(page => {
    page.emit('request', request());
  });
  assert.equal(pending.ok, false);
  assert.match(pending.error, /pending read requests/);
  assert.ok(!pending.error.includes('private-value'), 'diagnostics must omit query values');

  const lateFailure = await auditCase(page => {
    const late = request();
    page.emit('request', late);
    page.schedule(1700, () => respond(page, late, 500, true));
  });
  assert.equal(lateFailure.ok, false);

  const lateRecovery = await auditCase(page => {
    const failed = request();
    const recovered = request();
    page.emit('request', failed);
    page.schedule(1200, () => respond(page, failed, 500, true));
    page.schedule(1500, () => page.emit('request', recovered));
    page.schedule(1600, () => respond(page, recovered, 200));
  });
  assert.equal(lateRecovery.ok, true);
  assert.equal(lateRecovery.recoveredReadAttempts, 1);

  for (const [file, settleNeedle, writeNeedle] of [
    ['behav-wired.js', 'const readConsole = await readConsoleAudit.settle()', "await ok('noWriteRequests'"],
    ['prod-a11y-focus.js', 'const readConsole = await readConsoleAudit.settle()', 'const writes = requests.filter'],
    ['prod-layout-polish.js', 'const readConsole = await readConsoleAudit.settle()', 'const writes = requests.filter'],
    ['prod-structure-subset.js', 'const readConsole = await readConsoleAudit.settle()', 'await assertNoWriteRequests(requests)'],
  ]) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'syncview-design', 'tests', file), 'utf8');
    assert.ok(source.indexOf(settleNeedle) !== -1, `${file} must settle the read audit`);
    assert.ok(source.indexOf(settleNeedle) < source.indexOf(writeNeedle),
      `${file} must evaluate zero-write requests after the bounded settle`);
  }

  console.log('Production read/console audit fail-closed matrix passed');
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});

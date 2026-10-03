'use strict';
// Exercise the actual parity relay with synthetic requests and no network.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../../../qa/client-phone/desktop-parity.js'), 'utf8');
const code = source.slice(source.indexOf('async function liveRelay('), source.indexOf('async function shoot('));
let calls = 0;
const context = vm.createContext({ Buffer, URL, CORS: {}, LIVE_POST_READS: new Set(['/functions/v1/client-token-verify', '/functions/v1/thumbnail-revision-read']),
  fetch: async url => {
    calls++;
    if (url.endsWith('/failed-image')) throw Error('Synthetic media read failure');
    return { status: 200, headers: new Map([['content-type', 'application/json']]), arrayBuffer: async () => Buffer.from('snapshot-' + calls) };
  } });
vm.runInContext(code + '\nthis.relay = liveRelay;', context);
function route(method, pathname, body = '') {
  let reply, aborted = false;
  const url = 'https://fixture.supabase.co' + pathname;
  const request = { method: () => method, url: () => url, headers: () => ({}), postData: () => body, postDataBuffer: () => Buffer.from(body) };
  return { request: () => request, fulfill: async value => { reply = value; }, abort: async () => { aborted = true; },
    result: () => ({ reply, aborted }), key: method + ' ' + url + '  ' + body };
}
(async () => {
  const snapshot = new Map();
  const a = route('GET', '/rest/v1/calendar_posts'), b = route('GET', '/rest/v1/calendar_posts');
  await context.relay(a, snapshot); await context.relay(b, snapshot);
  assert.equal(calls, 1, 'the two builds must receive one live read snapshot');
  assert.deepEqual(a.result().reply.body, b.result().reply.body, 'replayed body changed');
  const first = route('GET', '/failed-image'), second = route('GET', '/failed-image');
  await context.relay(first, snapshot); await context.relay(second, snapshot);
  assert(first.result().aborted && second.result().aborted, 'failed media input must also be identical');
  assert.equal(calls, 2, 'failed media read was retried on only one side');
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const denied = route(method, '/functions/v1/calendar-upsert', '{}');
    snapshot.set(denied.key, Promise.resolve({ status: 200, body: Buffer.from('must not be used') }));
    await context.relay(denied, snapshot);
    assert.equal(denied.result().reply.status, 403, 'cached response bypassed write refusal');
  }
  assert.equal(calls, 2, 'a forbidden write reached the network');
  const verified = route('POST', '/functions/v1/client-token-verify', '{}');
  await context.relay(verified, snapshot);
  assert.equal(verified.result().reply.status, 200, 'existing read-only token verification was lost');
  assert.equal(calls, 3);
  console.log('desktop-parity-relay: OK (same read bytes and failures on both sides; cached writes refused; read-only verification retained).');
})().catch(e => { console.error(e); process.exitCode = 1; });

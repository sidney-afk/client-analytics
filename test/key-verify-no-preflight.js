'use strict';
/*
 * The staff sign-in check (key-verify) is sent as a "simple" cross-origin request, so the
 * browser posts it at once instead of first sending an OPTIONS preflight.
 *
 * Measured 2026-10-01: every new tab waits for key-verify before any staff data is read. The
 * call carried a custom header (X-Syncview-Key) and application/json, so the browser sent an
 * OPTIONS preflight first: a full extra round trip and an Edge Function call (server time
 * median 157 ms for a handler that does nothing), and a preflight is cached for only 5 s when
 * the function sends no Access-Control-Max-Age. In the page, against the live function:
 * median 736 ms with the preflight, 507 ms without (12 interleaved pairs). The function
 * already reads the key from the body when no header carries it, so no deploy is needed.
 * Nothing about WHO may sign in moves: the same function checks the same key against the same
 * secrets and the same member row.
 * Fails on the code before this change: the call carried the custom header.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const FN = fs.readFileSync(path.join(ROOT, 'supabase/functions/key-verify/index.ts'), 'utf8');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok  ' + m); };

ok(/const key = clean\(req\.headers\.get\("x-syncview-key"\) \|\| body\.key\);/.test(FN),
  'the deployed function reads the key from the body when no header carries it (so the page needs no deploy)');
ok(/const body = await req\.json\(\)\.catch\(\(\) => \(\{\}\)\)/.test(FN),
  'and parses the body whatever its content type, so text/plain works');

function grab(name) {
  const at = INDEX.search(new RegExp('function\\s+' + name + '\\s*\\('));
  assert.ok(at >= 0, 'function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}' && --depth === 0) return INDEX.slice(at - (INDEX.slice(at - 6, at) === 'async ' ? 6 : 0), j + 1);
  }
  throw new Error('unbalanced ' + name);
}

(async () => {
  const calls = [];
  const sb = {
    String, JSON, Date, Error, Promise,
    STAFF_KEY_VERIFY_URL: 'https://example.invalid/functions/v1/key-verify',
    _syncviewTakeEarlyKeyVerify: () => null,
    fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ ok: true, role: 'admin', member: { id: 'm1', name: 'N', role: 'admin', team: null } }) }; }
  };
  vm.createContext(sb);
  vm.runInContext(grab('_syncviewVerifyStaffIdentity') + '\nthis.v = _syncviewVerifyStaffIdentity;', sb);
  const identity = await sb.v({ key: 'secret-key', member: { id: 'm1' } }, 'staff-login');
  const call = calls[0];
  const headers = Object.keys(call.opts.headers).map(h => h.toLowerCase());
  ok(call.opts.method === 'POST' && headers.length === 1 && headers[0] === 'content-type' && /^text\/plain/i.test(call.opts.headers['Content-Type']),
    'the app\'s own sign-in check is a simple request: text/plain and no custom header');
  const body = JSON.parse(call.opts.body);
  ok(body.key === 'secret-key' && body.member.id === 'm1' && body.surface === 'staff-login', 'the key, member and surface travel in the body');
  ok(identity.key === 'secret-key' && identity.role === 'admin' && identity.member.id === 'm1', 'the answer is read exactly as before');

  const head = INDEX.slice(INDEX.indexOf("var svVerify = fetch("), INDEX.indexOf("svVerify.catch"));
  ok(/headers: \{ 'Content-Type': 'text\/plain;charset=UTF-8' \}/.test(head) && /key: String\(svId\.key\)/.test(head) && !/X-Syncview-Key/.test(head),
    'the head script\'s early check is the same simple request');
  console.log('\nkey-verify-no-preflight: ' + passed + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });

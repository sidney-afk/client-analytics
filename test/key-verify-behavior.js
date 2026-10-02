'use strict';
/*
 * key-verify, executed against a fake database: the same answers as before, with the flag read and the member
 * read running together, and the audit row still written (and still gating sign-in) before the answer.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');
const ROOT = path.resolve(__dirname, '..');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok  ' + m); };
const eq = (a, b, m) => { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m + ' (got ' + JSON.stringify(a) + ')'); passed++; console.log('  ok  ' + m); };

const tsSrc = fs.readFileSync(path.join(ROOT, 'supabase/functions/key-verify/index.ts'), 'utf8')
  .replace(/^import .*$/gm, '');
const js = stripTypeScriptTypes(tsSrc);

const ADMIN_KEY = 'fixture-admin-key';
function boot(opts) {
  const o = opts || {};
  const log = { selects: [], flagStarted: 0, memberStarted: 0, order: [], inserts: [] };
  const timeline = [];
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const member = { id: 'm1', name: 'Fixture Admin', email: null, role: 'admin', team: null, active: true };
  const fakeClient = {
    from(table) {
      const q = { table, filters: [] };
      const chain = {
        select(cols) { q.cols = cols; log.selects.push(table + ':' + cols); return chain; },
        eq(k, v) { q.filters.push([k, v]); return chain; },
        limit() { return chain; },
        maybeSingle() { return run(true); },
        then(res, rej) { return run(false).then(res, rej); },
        insert(row) {
          log.order.push('insert-start');
          return delay(5).then(() => {
            if (o.auditThrows) throw new Error('audit unreachable');
            if (o.auditFails) return { error: new Error('audit down') };
            log.inserts.push(row); log.order.push('insert-done'); return { error: null };
          });
        },
      };
      async function run(single) {
        if (table === 'syncview_runtime_flags') {
          log.flagStarted++; timeline.push('flag-start'); await delay(20); timeline.push('flag-end');
          return { data: { value: { mode: 'enforced' } }, error: null };
        }
        log.memberStarted++; timeline.push('member-start'); await delay(20); timeline.push('member-end');
        if (o.memberFails) return { data: null, error: new Error('db') };
        return { data: o.noMember ? [] : [member], error: null };
      }
      return chain;
    },
  };
  const secrets = { SUPABASE_URL: 'https://x.invalid', SUPABASE_SERVICE_ROLE_KEY: 'svc', ROLE_KEY_ADMIN: ADMIN_KEY };
  let handler = null;
  const sandbox = {
    Deno: { env: { get: n => secrets[n] }, serve: h => { handler = h; } },
    createClient: () => fakeClient,
    matchingRoleForKey: k => (k === ADMIN_KEY ? 'admin' : null),
    Response, Request, JSON, String, Promise, console: { error() {} }, setTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox);
  const call = async (body, headers) => {
    const res = await handler(new Request('https://x.invalid/functions/v1/key-verify', { method: 'POST', headers: headers || {}, body: JSON.stringify(body) }));
    return { status: res.status, json: await res.json() };
  };
  return { call, log, timeline };
}

(async () => {
  let t = boot();
  let r = await t.call({ surface: 'staff-boot', key: ADMIN_KEY, member: { id: 'm1' } }, { 'content-type': 'text/plain' });
  ok(r.status === 200 && r.json.ok === true && r.json.role === 'admin' && r.json.mode === 'enforced' && r.json.member.id === 'm1', 'a valid key answers 200 with the role, the mode and the member, exactly as before');
  eq(Object.keys(r.json.member).sort(), ['email', 'id', 'name', 'role', 'team'], 'the answer carries the same member fields');
  eq(t.timeline.slice(0, 2).sort(), ['flag-start', 'member-start'], 'the flag read and the member read both start before either has finished');
  ok(t.log.selects.every(s => s === 'syncview_runtime_flags:value' || s === 'team_members:id,name,email,role,team,active'), 'the member read selects only the columns the answer uses');
  eq(t.log.order, ['insert-start', 'insert-done'], 'the audit row is written before the answer returns');
  eq(t.log.inserts[0].reason, 'valid', 'and records the reason');

  t = boot();
  r = await t.call({ surface: 'staff-boot', key: 'wrong', member: { id: 'm1' } });
  ok(r.status === 401 && r.json.error === 'key_not_valid' && r.json.reason === 'invalid_key', 'a wrong key still answers 401 invalid_key');
  ok(t.log.memberStarted === 0, 'and never reads the member row');
  eq(t.log.inserts.length, 1, 'but is still audited');

  t = boot({ noMember: true });
  r = await t.call({ surface: 'staff-boot', key: ADMIN_KEY, member: { id: 'nobody' } });
  ok(r.status === 401 && r.json.reason === 'member_not_found', 'a right key with no such member still answers 401 member_not_found');

  t = boot({ auditThrows: true });
  r = await t.call({ surface: 'staff-boot', key: ADMIN_KEY, member: { id: 'm1' } });
  ok(r.status === 500 && r.json.error === 'verify_failed', 'if the audit write cannot be made at all (the call throws) the sign-in still fails (500 verify_failed): the write is awaited before the answer');

  /* UNCHANGED, and worth knowing: supabase-js reports a refused insert as a returned { error }, not a throw,
     and logAuth has never looked at it, so a refused (as opposed to unreachable) audit insert has never
     blocked a sign-in. This change keeps that exactly as it was. */
  t = boot({ auditFails: true });
  r = await t.call({ surface: 'staff-boot', key: ADMIN_KEY, member: { id: 'm1' } });
  ok(r.status === 200, 'a refused audit insert (a returned error object) is ignored, exactly as before this change');

  t = boot({ memberFails: true });
  r = await t.call({ surface: 'staff-boot', key: ADMIN_KEY, member: { id: 'm1' } });
  ok(r.status === 500 && r.json.error === 'verify_failed', 'if the member read fails the check still answers 500 verify_failed');

  t = boot();
  r = await t.call({ surface: 'staff-boot', member: { id: 'm1' } }, { 'x-syncview-key': ADMIN_KEY });
  ok(r.status === 200 && r.json.ok === true, 'the key is still accepted from the header, as older pages send it');
  console.log('\nkey-verify-behavior: ' + passed + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });

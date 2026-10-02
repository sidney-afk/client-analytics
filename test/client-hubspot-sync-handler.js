'use strict';
// The client-hubspot-sync Edge Function's handler (supabase/functions/_shared/client-hubspot-sync.mjs),
// run for real in Node against a fake database and a fake HubSpot. Read only toward HubSpot (three
// calls, nothing that writes), refused before the body is read, off unless the switch is on and the
// client is named, and nothing secret (token, email, HubSpot id) ever comes back.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let passed = 0; let failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ok  ' + msg); } else { failed++; console.error('FAIL  ' + msg); } }

const TOKEN = 'pat-na1-SECRET-TOKEN-VALUE';
const TIMER = 'timer-key-0123456789-0123456789-0123456789';
const NOW = Date.parse('2026-10-02T12:00:00Z');
const ADMIN = { id: 'm-admin', name: 'Fixture Admin', role: 'admin', active: true };

function fakeDb(state) {
  const calls = { rpcs: [], selects: [] };
  function query(table) {
    const q = { table, filters: [] };
    const api = {
      select() { return api; },
      eq(c, v) { q.filters.push([c, v]); return api; },
      maybeSingle() { q.single = true; return api; },
      then(resolve, reject) {
        calls.selects.push(q);
        let rows = (state.tables[table] || []).slice();
        for (const [c, v] of q.filters) rows = rows.filter((r) => r[c] === v);
        return Promise.resolve({ data: q.single ? (rows[0] || null) : rows, error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return {
    calls, from: query,
    rpc(name, args) {
      calls.rpcs.push({ name, args });
      const fn = state.rpc[name];
      return Promise.resolve(fn ? fn(args) : { data: null, error: null });
    },
  };
}

function fakeHubspot(plan) {
  const log = [];
  return {
    log,
    async contactsByEmail(email) { log.push(['contacts', email]); if (plan.err) throw plan.err(); return plan.contacts || []; },
    async dealIdsForContact(id) { log.push(['deals', id]); return plan.dealIds || []; },
    async dealsByIds(ids) { log.push(['batch', ids]); return plan.deals || []; },
  };
}

function req(headers, body, spy) {
  const r = new Request('https://example.test/functions/v1/client-hubspot-sync', { method: 'POST', headers, body: JSON.stringify(body || {}) });
  if (spy) { const o = r.text.bind(r); r.text = () => { spy.read = true; return o(); }; }
  return r;
}
const ADMIN_HDR = { 'x-syncview-key': 'admin-key', 'content-type': 'application/json' };
const TIMER_HDR = { 'x-hubspot-sync-key': TIMER, 'content-type': 'application/json' };

(async () => {
  const mod = await import(path.join(ROOT, 'supabase/functions/_shared/client-hubspot-sync.mjs'));

  // ---- pure rules ----
  ok(JSON.stringify(mod.contractPayment({ contract_signed: 'true', first_invoice_paid: 'true' })) === '{"contract":"signed","payment":"paid"}', 'true and true is signed and paid');
  ok(JSON.stringify(mod.contractPayment({ contract_signed: 'false', first_invoice_paid: 'false' })) === '{"contract":"unsigned","payment":"unpaid"}', 'false and false is unsigned and unpaid');
  ok(JSON.stringify(mod.contractPayment({ contract_signed: '', first_invoice_paid: null })) === '{"contract":"unknown","payment":"unknown"}', 'empty is unknown, never unpaid');
  ok(JSON.stringify(mod.contractPayment({})) === '{"contract":"unknown","payment":"unknown"}', 'no properties is unknown');
  ok(mod.pickDeal([]).match === 'no_deal', 'no deal');
  ok(mod.pickDeal([{ id: '1', properties: { dealstage: 'x' } }]).match === 'matched', 'one deal matches');
  ok(mod.pickDeal([{ id: '1', properties: { dealstage: 'x' } }, { id: '2', properties: { dealstage: 'y' } }]).match === 'ambiguous_deal', 'two deals and none won is ambiguous');
  const won = mod.pickDeal([{ id: '1', properties: { dealstage: 'x' } }, { id: '2', properties: { dealstage: mod.CLOSED_WON_STAGE } }]);
  ok(won.match === 'matched' && won.deal.id === '2', 'two deals with exactly one Closed Won picks it');
  ok(mod.pickDeal([{ id: '1', properties: { dealstage: mod.CLOSED_WON_STAGE } }, { id: '2', properties: { dealstage: mod.CLOSED_WON_STAGE } }]).match === 'ambiguous_deal', 'two Closed Won deals is ambiguous');

  const good = { contacts: [{ id: 'C9', properties: { contract_signed: 'true', first_invoice_paid: 'false' } }], dealIds: ['D9'], deals: [{ id: 'D9', properties: { dealstage: 'stage_q' } }] };
  let hs = fakeHubspot(good);
  let found = await mod.lookupClient(hs, '  Person@Example.TEST ');
  ok(found.match === 'matched' && found.contactId === 'C9' && found.dealId === 'D9' && found.stage === 'stage_q' && found.contract === 'signed' && found.payment === 'unpaid', 'a unique contact and deal match');
  ok(hs.log[0][1] === 'person@example.test', 'the email is trimmed and lower-cased');
  hs = fakeHubspot(good);
  ok((await mod.lookupClient(hs, '   ')).match === 'no_email' && hs.log.length === 0, 'a blank email makes no HubSpot call');
  ok((await mod.lookupClient(fakeHubspot({ contacts: [] }), 'a@b.test')).match === 'no_contact', 'no contact');
  ok((await mod.lookupClient(fakeHubspot({ contacts: [{ id: '1' }, { id: '2' }] }), 'a@b.test')).match === 'ambiguous_contact', 'two contacts is ambiguous');
  ok((await mod.lookupClient(fakeHubspot({ contacts: [{ id: '1', properties: {} }], dealIds: [] }), 'a@b.test')).match === 'no_deal', 'a contact with no deal');

  // ---- the only HubSpot calls (read only) ----
  const sent = [];
  const fakeFetch = async (url, init) => {
    sent.push({ url, init });
    if (url.endsWith('/contacts/search')) return { ok: true, json: async () => ({ results: [{ id: '7', properties: {} }] }) };
    if (url.includes('/associations/deals')) return { ok: true, json: async () => ({ results: [{ toObjectId: 11 }, { toObjectId: 12 }] }) };
    if (url.endsWith('/deals/batch/read')) return { ok: true, json: async () => ({ results: [] }) };
    return { ok: false, status: 404 };
  };
  const real = mod.makeHubspot(fakeFetch, TOKEN);
  await real.contactsByEmail('a@b.test'); const ids = await real.dealIdsForContact('7'); await real.dealsByIds(ids);
  ok(JSON.stringify(sent.map((s) => s.init.method + ' ' + s.url.replace(mod.HUBSPOT, ''))) === JSON.stringify(['POST /crm/v3/objects/contacts/search', 'GET /crm/v4/objects/contacts/7/associations/deals', 'POST /crm/v3/objects/deals/batch/read']), 'exactly three HubSpot calls, none that writes');
  ok(sent.every((s) => s.init.headers.Authorization === 'Bearer ' + TOKEN && s.init.redirect === 'error' && s.url.startsWith('https://api.hubapi.com/')), 'bearer token, no redirects, HubSpot host only');
  ok(JSON.stringify(ids) === '["11","12"]', 'deal ids come back as text');
  const bad = mod.makeHubspot(async () => ({ ok: false, status: 429 }), TOKEN);
  ok(await bad.contactsByEmail('a@b.test').then(() => false, (e) => e instanceof mod.HubspotError && e.status === 429), 'a HubSpot error carries its status only');
  const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/client-hubspot-sync.mjs'), 'utf8');
  ok(!/['"`](PATCH|PUT|DELETE)['"`]/.test(src), 'the module never names a write method');
  ok((src.match(/call\('(GET|POST)'/g) || []).length === 3, 'the module makes exactly three calls');

  // ---- the handler ----
  const baseState = (flagValue, extra) => ({
    tables: {
      team_members: [ADMIN, { id: 'm-smm', name: 'S', role: 'smm', active: true }],
      syncview_runtime_flags: flagValue === undefined ? [] : [{ key: 'client_hubspot_sync', value: flagValue }],
    },
    rpc: Object.assign({
      client_hubspot_sync_targets: (a) => ({ data: a.p_slug ? [{ client_slug: a.p_slug, email: 'p@example.test', synced_at: null }] : [{ client_slug: 'alpha', email: 'a@example.test', synced_at: null }, { client_slug: 'beta', email: 'b@example.test', synced_at: null }], error: null }),
      client_sales_state_apply: (a) => ({ data: { client_slug: a.p_slug, match: a.p_match, changed: true, contract_state: a.p_contract_state || 'unknown', payment_state: a.p_payment_state || 'unknown', synced_at: '2026-10-02T12:00:00Z' }, error: null }),
    }, extra || {}),
  });
  function make(state, hsPlan, opts = {}) {
    const db = fakeDb(state); const hub = fakeHubspot(hsPlan || good); let made = 0;
    const handler = mod.buildHandler({
      authorize: (key) => (key === 'admin-key' ? { ok: true, role: 'admin' } : key === 'smm-key' ? { ok: false, role: 'smm' } : { ok: false, role: null }),
      tickKeyOk: (r) => r.headers.get('x-hubspot-sync-key') === TIMER,
      makeClient: () => { made++; return opts.noDb ? null : db; },
      makeHubspot: () => (opts.noHubspot ? null : hub),
      newId: () => 'req-1', now: () => NOW,
    });
    return { handler, db, hub, made: () => made };
  }
  const textOf = async (res) => res.text();
  const on = (clients, extra) => Object.assign({ mode: 'on', clients }, extra || {});

  // access, refused before the body is read
  for (const [label, headers, status] of [['no key', { 'content-type': 'application/json' }, 401], ['an SMM key', { 'x-syncview-key': 'smm-key' }, 403], ['an unknown key', { 'x-syncview-key': 'nope' }, 401], ['a wrong timer key', { 'x-hubspot-sync-key': 'wrong' }, 401]]) {
    const spy = {}; const t = make(baseState(on(['alpha'])));
    const res = await t.handler(req(headers, { action: 'refresh', slug: 'alpha', member_id: 'm-admin' }, spy));
    ok(res.status === status && !spy.read && t.made() === 0 && t.hub.log.length === 0, label + ' is ' + status + ' before the body is read or any client is made');
  }
  ok((await make(baseState(on(['alpha']))).handler(new Request('https://example.test/x', { method: 'GET' }))).status === 405, 'GET is refused');
  ok((await make(baseState()).handler(new Request('https://example.test/x', { method: 'OPTIONS' }))).status === 204, 'OPTIONS answers');
  ok((await make(baseState(on(['alpha']))).handler(req(TIMER_HDR, { action: 'refresh', slug: 'alpha' }))).status === 400, 'the timer key cannot refresh one client');
  ok((await make(baseState(on(['alpha']))).handler(req(ADMIN_HDR, { action: 'tick', member_id: 'm-admin' }))).status === 400, 'an admin key cannot run the sweep');

  // the switch
  let t = make(baseState(undefined));
  let res = await t.handler(req(ADMIN_HDR, { action: 'refresh', slug: 'alpha', member_id: 'm-admin' }));
  ok((await res.json()).skipped === 'off' && t.hub.log.length === 0 && t.db.calls.rpcs.length === 0, 'no switch row means off: nothing looked up, nothing written');
  t = make(baseState({ mode: 'off', clients: ['alpha'] }));
  ok((await (await t.handler(req(TIMER_HDR, { action: 'tick' }))).json()).skipped === 'off', 'mode off skips the sweep too');
  t = make(baseState(on(['beta'])));
  res = await t.handler(req(ADMIN_HDR, { action: 'refresh', slug: 'alpha', member_id: 'm-admin' }));
  ok((await res.json()).skipped === 'not_enabled' && t.hub.log.length === 0, 'a client that is not named is not looked up');

  // refresh
  t = make(baseState(on(['alpha'])));
  res = await t.handler(req(ADMIN_HDR, { action: 'refresh', slug: 'alpha', member_id: 'm-smm' }));
  ok(res.status === 403 && t.hub.log.length === 0, 'an SMM member id is refused');
  res = await t.handler(req(ADMIN_HDR, { action: 'refresh', slug: 'alpha' }));
  ok(res.status === 403, 'a missing member id is refused');
  res = await t.handler(req(ADMIN_HDR, { action: 'refresh', member_id: 'm-admin' }));
  ok(res.status === 400, 'a missing client is 400');
  t = make(baseState(on(['alpha'])));
  res = await t.handler(req(ADMIN_HDR, { action: 'refresh', slug: 'alpha', member_id: 'm-admin' }));
  let body = await res.text();
  ok(res.status === 200 && JSON.parse(body).match === 'matched' && JSON.parse(body).contract_state === 'signed', 'refresh answers the match and states');
  ok(!body.includes('C9') && !body.includes('D9') && !body.includes('example.test') && !body.includes(TOKEN), 'the answer holds no HubSpot id, email or token');
  const applied = t.db.calls.rpcs.find((c) => c.name === 'client_sales_state_apply');
  ok(applied && applied.args.p_slug === 'alpha' && applied.args.p_match === 'matched' && applied.args.p_deal_id === 'D9' && applied.args.p_contact_id === 'C9' && applied.args.p_actor === 'Fixture Admin' && applied.args.p_request_id === 'req-1', 'the save names the admin and carries the match');
  ok(t.db.calls.rpcs[0].name === 'client_hubspot_sync_targets' && t.db.calls.rpcs[0].args.p_slug === 'alpha', 'the client is read through the targets function');
  t = make(baseState(on(['alpha']), { client_hubspot_sync_targets: () => ({ data: [{ client_slug: 'alpha', email: 'a@example.test', synced_at: '2026-10-02T11:55:00Z' }], error: null }) }));
  res = await t.handler(req(ADMIN_HDR, { action: 'refresh', slug: 'alpha', member_id: 'm-admin' }));
  ok((await res.json()).skipped === 'fresh' && t.hub.log.length === 0, 'synced five minutes ago: skipped, no HubSpot call');
  t = make(baseState(on(['alpha']), { client_hubspot_sync_targets: () => ({ data: [{ client_slug: 'alpha', email: 'a@example.test', synced_at: '2026-10-02T11:40:00Z' }], error: null }) }));
  res = await t.handler(req(ADMIN_HDR, { action: 'refresh', slug: 'alpha', member_id: 'm-admin' }));
  ok((await res.json()).match === 'matched', 'synced twenty minutes ago: looked up again');
  t = make(baseState(on(['alpha']), { client_hubspot_sync_targets: () => ({ data: [], error: null }) }));
  ok((await t.handler(req(ADMIN_HDR, { action: 'refresh', slug: 'alpha', member_id: 'm-admin' }))).status === 404, 'an unknown or inactive client is 404');
  t = make(baseState(on(['alpha'])), { err: () => new mod.HubspotError(429) });
  res = await t.handler(req(ADMIN_HDR, { action: 'refresh', slug: 'alpha', member_id: 'm-admin' }));
  ok(res.status === 502 && (await res.json()).error === 'hubspot_rate_limited' && !t.db.calls.rpcs.some((c) => c.name === 'client_sales_state_apply'), 'a HubSpot rate limit is 502 and nothing is saved');
  t = make(baseState(on(['alpha'])), good, { noHubspot: true });
  ok((await t.handler(req(ADMIN_HDR, { action: 'refresh', slug: 'alpha', member_id: 'm-admin' }))).status === 500, 'no HubSpot token set is a clear 500');
  t = make(baseState(on(['alpha']), { client_sales_state_apply: () => ({ data: null, error: { message: 'boom secret detail' } }) }));
  res = await t.handler(req(ADMIN_HDR, { action: 'refresh', slug: 'alpha', member_id: 'm-admin' }));
  body = await res.text();
  ok(res.status === 500 && !body.includes('boom') && !body.includes('secret'), 'a database error never leaks its text');
  t = make(baseState(on(['alpha'])), good, { noDb: true });
  ok((await t.handler(req(ADMIN_HDR, { action: 'refresh', slug: 'alpha', member_id: 'm-admin' }))).status === 500, 'no database is a 500');

  // tick
  t = make(baseState(on([], { all: true, batch: 2 })));
  res = await t.handler(req(TIMER_HDR, { action: 'tick' }));
  body = await res.json();
  ok(res.status === 200 && body.looked_up === 2 && body.changed === 2 && body.errors === 0 && body.rate_limited === false, 'the sweep looks up the batch and reports counts');
  ok(t.db.calls.rpcs[0].args.p_slug === null && t.db.calls.rpcs[0].args.p_limit === 2, 'all: true asks for the next batch of clients');
  ok(t.db.calls.rpcs.filter((c) => c.name === 'client_sales_state_apply').every((c) => c.args.p_actor === 'hubspot-sync'), 'the sweep is recorded as hubspot-sync');
  ok(!JSON.stringify(body).includes('example.test') && !JSON.stringify(body).includes('alpha'), 'the sweep answer holds no client name');
  t = make(baseState(on(['alpha', 'gamma'], { batch: 5 })));
  body = await (await t.handler(req(TIMER_HDR, { action: 'tick' }))).json();
  ok(body.looked_up === 2 && t.db.calls.rpcs.filter((c) => c.name === 'client_hubspot_sync_targets').map((c) => c.args.p_slug).join() === 'alpha,gamma', 'without all, only the named clients are swept');
  t = make(baseState(on(['alpha'], { batch: 5 }), { client_hubspot_sync_targets: () => ({ data: [{ client_slug: 'alpha', email: 'a@example.test', synced_at: '2026-10-02T06:00:00Z' }], error: null }) }));
  body = await (await t.handler(req(TIMER_HDR, { action: 'tick' }))).json();
  ok(body.looked_up === 0, 'a client synced six hours ago is left alone by the sweep');
  t = make(baseState(on([], { all: true, batch: 99 })));
  await t.handler(req(TIMER_HDR, { action: 'tick' }));
  ok(t.db.calls.rpcs[0].args.p_limit === mod.MAX_BATCH, 'the batch is capped');
  t = make(baseState(on([], { all: true })), { err: () => new mod.HubspotError(429) });
  body = await (await t.handler(req(TIMER_HDR, { action: 'tick' }))).json();
  ok(body.rate_limited === true && body.looked_up === 0 && t.hub.log.length === 1, 'a rate limit stops the sweep at once');
  let n = 0;
  t = make(baseState(on([], { all: true })), good);
  t.hub.contactsByEmail = async (e) => { n++; if (n === 1) throw new mod.HubspotError(500); return good.contacts; };
  body = await (await t.handler(req(TIMER_HDR, { action: 'tick' }))).json();
  ok(body.errors === 1 && body.looked_up === 1, 'one client failing does not stop the others');

  // ping: proves deployment and the timer key, touches nothing
  t = make(baseState(undefined), good, { noDb: true });
  res = await t.handler(req(TIMER_HDR, { action: 'ping' }));
  ok(res.status === 200 && (await res.json()).pong === 'client-hubspot-sync' && t.made() === 0 && t.hub.log.length === 0, 'a signed ping answers without a database, a switch or HubSpot');
  t = make(baseState(on(['alpha'])));
  ok((await t.handler(req(ADMIN_HDR, { action: 'ping', member_id: 'm-admin' }))).status === 400, 'an admin key cannot ping (only the timer key proves the timer)');
  t = make(baseState(on(['alpha'])));
  res = await t.handler(req({ 'x-hubspot-sync-key': 'wrong' }, { action: 'ping' }));
  ok(res.status === 401, 'a ping with the wrong timer key is 401');

  // a sweep with failures must not look healthy to the timer's status check
  t = make(baseState(on([], { all: true })), good);
  t.hub.contactsByEmail = async () => { throw new mod.HubspotError(500); };
  res = await t.handler(req(TIMER_HDR, { action: 'tick' }));
  body = await res.json();
  ok(res.status === 502 && body.ok === false && body.errors === 2 && body.error === 'some_clients_failed', 'every client failing is 502, ok false, counts kept');
  t = make(baseState(on([], { all: true })), { err: () => new mod.HubspotError(429) });
  res = await t.handler(req(TIMER_HDR, { action: 'tick' }));
  ok(res.status === 429 && (await res.json()).error === 'hubspot_rate_limited', 'a rate-limited sweep is 429');
  t = make(baseState(on([], { all: true }), { client_sales_state_apply: () => ({ data: null, error: { message: 'boom' } }) }));
  res = await t.handler(req(TIMER_HDR, { action: 'tick' }));
  ok(res.status === 502, 'a failed save is 502 too');
  t = make(baseState(on([], { all: true })));
  ok((await t.handler(req(TIMER_HDR, { action: 'tick' }))).status === 200, 'a clean sweep is 200');

  // wiring
  const index = fs.readFileSync(path.join(ROOT, 'supabase/functions/client-hubspot-sync/index.ts'), 'utf8');
  ok(index.includes('HUBSPOT_READ_TOKEN') && index.includes('HUBSPOT_SYNC_KEY') && !/pat-[a-z0-9-]{8,}/i.test(index), 'the token and the timer key are read from secrets, never written in the file');
  ok(index.includes('timingSafeEqual') && /length >= 32/.test(index), 'the timer key is compared in constant time and must be 32+ characters');
  const config = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
  ok(/\[functions\.client-hubspot-sync\]\s*\nverify_jwt = false/.test(config), 'config.toml registers it (JWT off like the other key-gated functions)');

  console.log(`client-hubspot-sync-handler: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

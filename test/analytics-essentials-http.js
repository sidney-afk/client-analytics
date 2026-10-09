'use strict';

// A failed Sheets fallback must leave the last good analytics copy intact.
// Run the actual readers and parsers, with every transport fulfilled locally.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./helpers/extract-function');

const source = fs.readFileSync(path.resolve(__dirname, '../src/index/040-shared-briefs.js.part'), 'utf8');
const names = ['parseCSV', '_clientsInfoPublicRows', '_blankAnalyticsRow', '_applyEssentialRows',
  '_applyEssentialTexts', 'fetchEssentials', '_syncviewClientEssentials'];
const code = names.map(name => (name === 'fetchEssentials' ? 'async ' : '') + extractFunction(source, name)).join('\n');
const CLIENT = 'Fixture Client';
const METRICS = 'client_name,date,ig_followers\n' + CLIENT + ',2026-10-02,100';
const ROSTER = 'client_name\n' + CLIENT;
let checks = 0;
function check(label, fn) { fn(); checks++; console.log('ok ' + checks + ' - ' + label); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

function harness(opts = {}) {
  const saved = { metrics: 'last good metrics', clients: [{ client_name: CLIENT }], at: 100 };
  let current = true;
  const bodies = [];
  const writes = [];
  const replies = { metrics: { status: 200, body: METRICS }, roster: { status: 200, body: ROSTER } };
  const ctx = {
    console: { log() {}, warn() {} },
    METRICS_URL: 'https://example.invalid/metrics', CLIENTS_URL: 'https://example.invalid/roster',
    CLIENTS_INFO_FORBIDDEN_FIELDS: new Set(['client_review_token']),
    _analyticsLiveEssentials: false, _analyticsAppliedFp: { ess: 'last good fingerprint' },
    allData: [{ client_name: CLIENT, date: '2026-10-01', ig_followers: '99' }],
    clientMap: { [CLIENT]: { client_name: CLIENT } },
    _clientEssentialsLoad: { promise: null, status: 'idle', run: null },
    _analyticsMirrorRead: async () => opts.mirror || null, _analyticsStaffMirrorRead: async () => opts.staff || null,
    _analyticsRosterFromDatabase: async () => !!opts.roster,
    _analyticsCacheRead: () => (opts.noSaved ? null : plain(saved)),
    _analyticsFp: parts => JSON.stringify(parts), wlMergeClientsFromSheet() {}, svAreaApi: () => null,
    _syncviewClientEntryRunCurrent: () => current,
    _syncviewStaleClientEntryError: () => new Error('stale_client_entry'),
    _analyticsCacheWrite(partial) { writes.push(plain(partial)); Object.assign(saved, plain(partial)); },
    async fetch(url, options) {
      const key = url.endsWith('/metrics') ? 'metrics' : 'roster';
      const reply = replies[key];
      return { ok: reply.status >= 200 && reply.status < 300, status: reply.status,
        async text() { bodies.push(key); if (reply.beforeText) reply.beforeText(); return reply.body; } };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const snapshot = () => plain({ data: ctx.allData, roster: ctx.clientMap, fresh: ctx._analyticsLiveEssentials,
    fingerprint: ctx._analyticsAppliedFp, saved });
  return { ctx, saved, replies, bodies, writes, snapshot, revoke() { current = false; } };
}

(async () => {
  for (const lane of ['metrics', 'roster']) {
    for (const status of [403, 503]) {
      const h = harness();
      const before = h.snapshot();
      h.replies[lane] = { status, body: '<html>Request failed</html>' };
      await assert.rejects(h.ctx.fetchEssentials(), /analytics_essentials_http/);
      check(lane + ' HTTP ' + status + ' preserves data, cache, freshness and fingerprint', () => {
        assert.deepStrictEqual(h.snapshot(), before);
        assert.strictEqual(h.writes.length, 0);
        assert.strictEqual(h.bodies.length, 0, 'read neither body when either required response failed');
      });
    }
  }

  const client = harness();
  const run = { slug: 'fixture-client', signal: new AbortController().signal };
  client.replies.roster.status = 503;
  await assert.rejects(client.ctx._syncviewClientEssentials(run), /analytics_essentials_http/);
  check('a current client entry records failed essentials as error', () => {
    assert.strictEqual(client.ctx._clientEssentialsLoad.status, 'error');
  });
  client.replies.roster.status = 200;
  await client.ctx._syncviewClientEssentials(run);
  check('Retry on the same client run fetches again and becomes ready with fresh data', () => {
    assert.strictEqual(client.ctx._clientEssentialsLoad.status, 'ready');
    assert.strictEqual(client.ctx._analyticsLiveEssentials, true);
    assert.strictEqual(client.ctx.allData[0].ig_followers, '100');
    assert.deepStrictEqual(Object.keys(client.ctx.clientMap), [CLIENT]);
    assert.strictEqual(client.writes.length, 1);
    assert.strictEqual(client.writes[0].metrics, METRICS);
  });

  const staff = harness();
  await staff.ctx.fetchEssentials();
  check('two successful responses apply and cache the complete staff overview', () => {
    assert.strictEqual(staff.ctx._analyticsLiveEssentials, true);
    assert.strictEqual(staff.ctx.allData[0].ig_followers, '100');
    assert.deepStrictEqual(Object.keys(staff.ctx.clientMap), [CLIENT]);
    assert.deepStrictEqual(staff.writes, [{ metrics: METRICS, clients: [{ client_name: CLIENT }] }]);
  });

  const revoked = harness();
  const before = revoked.snapshot();
  revoked.replies.roster.beforeText = revoked.revoke;
  await assert.rejects(revoked.ctx._syncviewClientEssentials(run), /stale_client_entry/);
  check('an entry revoked while response bodies arrive applies and caches nothing', () => {
    assert.deepStrictEqual(revoked.snapshot(), before);
    assert.strictEqual(revoked.writes.length, 0);
    assert.strictEqual(revoked.ctx._clientEssentialsLoad.status, 'idle');
  });
  // ---- the roster switch: the client list never comes from the Sheet ----
  const DB_CLIENTS = [{ client_name: 'Database Client' }];
  const rStaff = harness({ roster: true, staff: { metrics: null, clients: DB_CLIENTS } });
  await rStaff.ctx.fetchEssentials();
  check('roster on, stale staff numbers: Metrics from the Sheet, clients from the database, roster tab never read', () => {
    assert.deepStrictEqual(rStaff.bodies, ['metrics']);
    assert.deepStrictEqual(Object.keys(rStaff.ctx.clientMap), ['Database Client']);
    assert.deepStrictEqual(rStaff.writes, [{ metrics: METRICS, clients: DB_CLIENTS }]);
  });
  const rSaved = harness({ roster: true });
  await rSaved.ctx.fetchEssentials();
  check('roster on, staff read failed: this browser\'s saved client list, roster tab never read', () => {
    assert.deepStrictEqual(rSaved.bodies, ['metrics']);
    assert.deepStrictEqual(Object.keys(rSaved.ctx.clientMap), [CLIENT]);
  });
  const rNone = harness({ roster: true, noSaved: true });
  const noneBefore = rNone.snapshot();
  await assert.rejects(rNone.ctx.fetchEssentials(), /analytics_roster_unavailable/);
  check('roster on, no database answer and no saved copy: refuses and changes nothing, no Sheet read', () => {
    assert.deepStrictEqual(rNone.snapshot(), noneBefore);
    assert.strictEqual(rNone.bodies.length, 0);
    assert.strictEqual(rNone.writes.length, 0);
  });
  const rLink = harness({ roster: true, mirror: { ess: null, ext: null, clients: [{ client_name: CLIENT }] } });
  await rLink.ctx._syncviewClientEssentials(run);
  check('roster on, client link without a numbers copy: its own database row, Metrics from the Sheet, nothing saved', () => {
    assert.deepStrictEqual(rLink.bodies, ['metrics']);
    assert.deepStrictEqual(Object.keys(rLink.ctx.clientMap), [CLIENT]);
    assert.strictEqual(rLink.writes.length, 0);
  });
  const rLinkFail = harness({ roster: true });
  await assert.rejects(rLinkFail.ctx._syncviewClientEssentials(run), /analytics_roster_unavailable/);
  check('roster on, client link with no database answer: refuses, never the whole Clients Info tab', () => {
    assert.strictEqual(rLinkFail.bodies.length, 0);
  });
  console.log('analytics-essentials-http: ' + checks + ' checks passed');
})().catch(err => { console.error(err); process.exitCode = 1; });

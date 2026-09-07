'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { assess } = require('../scripts/client-continuity-independent');
const { run } = require('../scripts/client-continuity-heartbeat');
const checkout = path.resolve(__dirname, '..');
const H = require(path.join(checkout, 'scripts/client-continuity-hosted'));
const O = require(path.join(checkout, 'scripts/client-continuity-observer'));
const sha = 'a'.repeat(40), binding = { pageSourceSha: 'b'.repeat(40), pageBlobSha: 'c'.repeat(40), pageSha256: 'd'.repeat(64) };
let groups = 0;

async function scenario(kind) {
  const now = Date.now(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'independent-receipt-test-'));
  const healthy = lane => ({ version: 1, lane, code: 'healthy', count: 1, ok: true });
  const githubRun = id => ({ id, head_sha: sha, event: 'schedule', status: 'completed', conclusion: 'success', created_at: new Date(now - 180000).toISOString(), updated_at: new Date(now - 1000).toISOString() });
  let reads = 0, downloads = 0, pings = 0;
  const fetchImpl = async (url, init) => {
    reads++;
    assert.equal(init.redirect, 'error');
    assert.ok(!init.method || init.method === 'GET', 'all source transports are reads');
    if (kind === 'github_api_down') throw Error('synthetic outage');
    const observer = String(url).includes('hosted-observer');
    const record = githubRun(observer ? 2 : 1);
    if (kind === 'failed_observer_run' && observer) record.conclusion = 'failure';
    return { ok: true, json: async () => ({ workflow_runs: [record] }) };
  };
  const write = (dir, name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const download = async (record, name, dir) => {
    downloads++; fs.mkdirSync(dir, { recursive: true });
    if (name === 'continuity-receipts') {
      if (kind === 'missing_view_artifact') throw Error('missing');
      for (const lane of ['calendar', 'samples']) {
        const id = randomUUID();
        const start = { version: 1, releaseSha: sha, ...binding, lane, runId: id, startedAt: now - 180000 };
        if (kind === 'wrong_release') start.releaseSha = 'e'.repeat(40);
        if (kind === 'wrong_document') start.pageSha256 = 'e'.repeat(64);
        if (kind === 'unbound_historical') for (const key of Object.keys(binding)) delete start[key];
        write(dir, `${lane}-${id}.start.json`, start);
        if (kind === 'missing_terminal' && lane === 'samples') continue;
        const terminal = { ...start, finishedAt: now - 1000, code: 'healthy', count: 1, denialReasons: [] };
        if (kind === 'denial') terminal.denialReasons = ['realtime_transport_blocked'];
        if (kind === 'bad_denial') terminal.denialReasons = ['unknown'];
        if (kind === 'failed_view') terminal.code = 'read_failed';
        write(dir, `${lane}-${id}.terminal.json`, terminal);
        if (kind === 'orphan') {
          const orphan = { ...start, runId: randomUUID(), startedAt: now - 240000 };
          write(dir, `${lane}-${orphan.runId}.start.json`, orphan);
        }
      }
      return;
    }
    if (kind === 'missing_observer_artifact') throw Error('missing');
    const state = { version: 1, releaseSha: sha, lanes: {} };
    if (['n8n_delivery_unknown', 'slack_delivery_unknown', 'prepared_delivery', 'confirmed_unrecovered'].includes(kind)) {
      state.lanes.samples = { id: randomUUID(), openedAt: now - 200000,
        status: kind === 'prepared_delivery' ? 'prepared' : kind === 'confirmed_unrecovered' ? 'confirmed' : 'attempted',
        result: { ...healthy('samples'), code: 'false_empty', ok: false } };
    }
    write(dir, 'observer-state.json', state);
    if (kind === 'missing_observer_terminal') return;
    const terminal = { version: 1, releaseSha: sha, observedAt: now - 1000,
      pendingDelivery: false, results: ['calendar', 'samples'].map(healthy) };
    if (kind === 'pending_delivery') terminal.pendingDelivery = true;
    if (kind === 'stale_observer') terminal.observedAt = now - 600001;
    write(dir, 'observer-terminal.json', terminal);
  };
  try {
    const result = await assess(H, O, { releaseSha: sha, activatedAt: now - 3600000 }, { GH_TOKEN: 'synthetic' }, temp, binding, { fetchImpl, download, now: () => now });
    const expected = kind === 'healthy';
    assert.equal(result.ok, expected, kind);
    const wrapped = await run({ CONTINUITY_HEARTBEAT_ACTIVATION: 'OWNER_APPROVED_SENTINEL_HEARTBEAT',
      CONTINUITY_CHECKOUT: checkout, CONTINUITY_HEALTHCHECKS_PING_URL: 'https://hc-ping.com/11111111-1111-4111-8111-111111111111' }, {
      execute: () => ({ status: result.ok ? 0 : 2, stdout: JSON.stringify(result) }),
      fetchImpl: async () => { pings++; return { status: 200, text: async () => 'OK' }; },
    });
    assert.equal(wrapped.ok, expected, kind);
    assert.equal(pings, expected ? 1 : 0, kind + ': no healthy ping on unknown/failed evidence');
    assert.ok(reads > 0); if (kind !== 'github_api_down') assert.ok(downloads > 0);
    groups++;
  } finally {
    if (path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('independent-receipt-test-')) fs.rmSync(temp, { recursive: true, force: true });
  }
}
(async () => {
  for (const kind of ['healthy', 'missing_view_artifact', 'missing_terminal', 'orphan', 'denial', 'bad_denial', 'failed_view', 'wrong_release', 'wrong_document', 'unbound_historical', 'missing_observer_artifact', 'missing_observer_terminal', 'pending_delivery', 'stale_observer', 'n8n_delivery_unknown', 'slack_delivery_unknown', 'prepared_delivery', 'confirmed_unrecovered', 'github_api_down', 'failed_observer_run']) await scenario(kind);
  console.log(`PASS ${groups} actual collect/receipts/evaluate/sentinel groups; synthetic downloaded artifacts; zero external requests/messages`);
})().catch(error => { console.error(error); process.exitCode = 1; });

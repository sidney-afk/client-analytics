'use strict';

const {
  LIVE_PRECONDITION,
  NAMES,
  WATCH_BLOCK,
  assertLivePrecondition,
  sha,
  transformWorkflow,
  verify,
} = require('../scripts/write-ui-soak-pager');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function edge(name) { return { node: name, type: 'main', index: 0 }; }
function http(name, url = 'https://example.invalid') {
  return { id: name, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, parameters: { method: 'GET', url }, credentials: { httpHeaderAuth: { id: 'fixture', name: 'fixture' } }, position: [0, 0] };
}

ok(LIVE_PRECONDITION.versionId === '16a436c6-5b49-4baa-9630-978cee2854a2', 'exact live pager version is pinned');
ok(/^[0-9a-f]{64}$/.test(LIVE_PRECONDITION.checkHash), 'exact live pager condition hash is pinned');
ok(LIVE_PRECONDITION.active === true, 'pager active-state precondition is pinned');

const fixture = {
  id: 'qllIDZPkdNAPRj0b',
  name: LIVE_PRECONDITION.name,
  active: true,
  nodes: [
    http(NAMES.v2),
    http(NAMES.outbound),
    http(NAMES.incremental),
    { id: 'check', name: NAMES.check, type: 'n8n-nodes-base.code', parameters: { jsCode: `const incremental = first('${NAMES.incremental}');\nreturn out.filter(Boolean);` }, position: [0, 0] },
  ],
  connections: {
    [NAMES.v2]: { main: [[edge(NAMES.outbound)]] },
    [NAMES.outbound]: { main: [[edge(NAMES.incremental)]] },
  },
  settings: { executionOrder: 'v1' },
};
const transformed = transformWorkflow(fixture);
ok(transformed.nodes.length === fixture.nodes.length + 2, 'transform adds only two aggregate summary readers');
ok(transformed.connections[NAMES.outbound].main[0][0].node === NAMES.writeDrill, 'write-drill summary follows outbound');
ok(transformed.connections[NAMES.writeDrill].main[0][0].node === NAMES.shadow, 'shadow summary follows write drill');
ok(transformed.connections[NAMES.shadow].main[0][0].node === NAMES.incremental, 'existing chain resumes at incremental');
ok(verify(transformed, true) === transformed, 'transformed pager verifies');
const wrongUrl = JSON.parse(JSON.stringify(transformed));
wrongUrl.nodes.find(item => item.name === NAMES.shadow).parameters.url = 'https://example.invalid/wrong';
let wrongUrlRejected = false;
try { verify(wrongUrl, true); } catch (_) { wrongUrlRejected = true; }
ok(wrongUrlRejected, 'pager readback verification rejects a changed summary URL');
let compiles = true;
try { new Function(transformed.nodes.find(item => item.name === NAMES.check).parameters.jsCode); } catch (_) { compiles = false; }
ok(compiles, 'transformed pager condition code compiles');
ok(transformWorkflow(transformed).nodes.length === transformed.nodes.length, 'pager transform is idempotent');
for (const token of ['production_write_drill_stale', 'production_write_drill_integrity', 'production_shadow_audit_stale', 'production_shadow_audit_integrity']) {
  ok(WATCH_BLOCK.includes(token), `pager contains ${token}`);
}
ok(!/client_slug|client_name|project_id/.test(WATCH_BLOCK), 'pager messages contain team/aggregates only');
ok(WATCH_BLOCK.includes('36 * 60 * 60 * 1000'), 'initial deployment has a bounded no-summary grace window');

const liveFixture = {
  ...fixture,
  versionId: LIVE_PRECONDITION.versionId,
  nodes: fixture.nodes.map(item => item.name === NAMES.check
    ? { ...item, parameters: { jsCode: 'not-the-live-code' } }
    : item),
};
let rejected = false;
try { assertLivePrecondition(liveFixture); } catch (_) { rejected = true; }
ok(rejected, 'live precondition rejects a changed pager condition node');
ok(sha('fixture') !== LIVE_PRECONDITION.checkHash, 'hash check is content-sensitive');

if (failures) process.exit(1);
console.log('\nWrite-UI soak pager transform checks passed');

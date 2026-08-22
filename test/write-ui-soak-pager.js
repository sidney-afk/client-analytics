'use strict';

const {
  RETIRED,
  applyTransform,
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

/*
 * RETIRED, NOT DELETED (OPEN_REPAIRS 10, 2026-08-22).
 *
 * The #1041 dead-man's switch already covers both halves of what these watchers
 * were for, through a channel proven to deliver twice in live traversals, and
 * the pinned precondition no longer matches the live workflow -- it moved again
 * on 2026-08-21 when the v2_nonzero alert was muted. So the transform must not
 * be applied, and a dry run is no safer: it reads a production workflow and
 * prints a plan nobody should carry out.
 *
 * The code stays importable and its transform stays covered, because that is
 * what makes a deliberate revival possible. What is pinned here is that the CLI
 * refuses, in BOTH modes, and says why.
 */
const { execFileSync } = require('child_process');
const nodePath = require('path');
const scriptPath = nodePath.join(__dirname, '..', 'scripts', 'write-ui-soak-pager.js');

ok(typeof RETIRED === 'string' && /retired/i.test(RETIRED), 'the retirement states itself in one place');
ok(/dead-man/i.test(RETIRED) && /OPEN_REPAIRS item 10/.test(RETIRED),
  'and points at what replaced it and where the decision is recorded');

for (const argv of [[], ['--apply']]) {
  let exitCode = 0;
  let output = '';
  try {
    output = execFileSync(process.execPath, [scriptPath, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    exitCode = typeof error.status === 'number' ? error.status : 1;
    output = String(error.stdout || '') + String(error.stderr || '');
  }
  const mode = argv.length ? '--apply' : 'dry run';
  ok(exitCode !== 0, 'the retired CLI fails rather than proceeding (' + mode + ')');
  ok(/retired/i.test(output), 'and says it is retired (' + mode + ')');
  ok(!/dry_run/.test(output), 'a dry run no longer prints a plan against the live workflow (' + mode + ')');
}

// The revival path has to stay real, or "retired, not deleted" is a fiction.
ok(typeof applyTransform === 'function', 'the original apply path is kept, exported, for a deliberate revival');
ok(typeof transformWorkflow === 'function' && transformWorkflow(fixture).nodes.length > fixture.nodes.length,
  'and the transform itself still works, so re-pinning is all a revival needs');

if (failures) process.exit(1);
console.log('\nWrite-UI soak pager transform checks passed');

'use strict';
/* Native intake project ids are evidence only for a persisted native intake
 * stamp. They never join the Linear project resolver. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/extract-function.js');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '2026-09-09-native-attribution-browser-projection.sql'), 'utf8');
const sandbox = { Map, Set, String, Array, Object, JSON, Boolean, RegExp };
vm.createContext(sandbox);
for (const name of [
  '_prodHasOwn', '_prodLinearRaw', '_prodConfiguredProjectIds', '_prodNativeProjectIdForTeam',
  '_prodRawProjectId', '_prodRawAttribution', '_prodResolveAttributions',
]) vm.runInContext(extractFunction(source, name), sandbox);
vm.runInContext('this.resolve = _prodResolveAttributions;', sandbox);
const resolve = sandbox.resolve;

const VIDEO = 'svproj_video_0123456789abcdef0123456789abcdef';
const GRAPHICS = 'svproj_graphics_fedcba9876543210fedcba9876543210';
const client = { slug: 'fixture-native', active: true, kind: 'client', linear_project_ids: {}, native_project_ids: { video: VIDEO, graphics: GRAPHICS } };
function row(extra = {}) {
  return Object.assign({
    id: 'native-row', client_slug: 'fixture-native', team: 'video', raw_project_id: '',
    raw_attribution_schema: 'syncview_attribution_v1', raw_attribution_state: 'resolved',
    raw_attribution_client_slug: 'fixture-native', raw_attribution_owner_kind: 'client',
    raw_attribution_source: 'native_intake_project', raw_attribution_project_id: VIDEO,
    raw_attribution_native_epoch: 'native-v1', raw_attribution_reason: 'native_intake_project_mapped',
  }, extra);
}
function outcome(extra, clients = [client]) { return resolve([row(extra)], clients, new Map()).get('native-row'); }

assert.equal(outcome({}).state, 'resolved', 'exact persisted native evidence resolves');
assert.equal(outcome({}).source, 'native_intake_project');
assert.equal(outcome({ raw_attribution_native_epoch: '' }).state, 'needs_attribution', 'missing accepted epoch is refused');
assert.equal(outcome({ raw_attribution_project_id: GRAPHICS }).state, 'needs_attribution', 'wrong team mapping is refused');
assert.equal(outcome({ raw_attribution_client_slug: 'other-client' }).state, 'needs_attribution', 'row/client ownership mismatch is refused');
assert.equal(outcome({ raw_attribution_source: 'direct_project', raw_attribution_project_id: VIDEO }).state, 'needs_attribution', 'synthetic ids do not enter direct Linear attribution');
assert.equal(outcome({}, [client, { ...client, slug: 'other-client' }]).state, 'needs_attribution', 'duplicate native mapping is refused');
assert.match(source, /native_project_ids/, 'browser roster select must include native map');
assert.match(source, /native_intake_project/, 'browser owns an explicit native source path');
assert.match(migration, /'native_intake_project'::text/, 'view source allowlist admits only the named native source');
assert.match(migration, /raw_attribution_native_epoch/, 'view carries bounded epoch evidence');
assert.match(migration, /\^svproj_\(video\|graphics\)_\[a-f0-9\]\{32\}\$/, 'view bounds native project values');
console.log('ok native intake attribution ownership');

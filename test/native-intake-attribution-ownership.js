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
  '_prodHasOwn', '_prodLinearRaw', '_prodConfiguredProjectIds', '_prodNativeProjectIdForTeam', '_prodLinearProjectIdsForTeam',
  '_prodRawProjectId', '_prodRawAttribution', '_prodResolveAttributions',
]) vm.runInContext(extractFunction(source, name), sandbox);
vm.runInContext('this.resolve = _prodResolveAttributions;', sandbox);
const resolve = sandbox.resolve;

const VIDEO = 'svproj_video_0123456789abcdef0123456789abcdef';
const GRAPHICS = 'svproj_graphics_fedcba9876543210fedcba9876543210';
const LEGACY_VIDEO = 'legacy-video-project';
const LEGACY_GRAPHICS = 'legacy-graphics-project';
const client = { slug: 'fixture-native', active: true, kind: 'client', linear_project_ids: { video: LEGACY_VIDEO, graphics: LEGACY_GRAPHICS }, native_project_ids: { video: VIDEO, graphics: GRAPHICS } };
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

function legacyOutcome(team = 'video', extra = {}, clients = [client]) {
  const projectId = team === 'graphics' ? LEGACY_GRAPHICS : LEGACY_VIDEO;
  return resolve([row({
    team,
    raw_attribution_source: 'native_intake_legacy_project',
    raw_attribution_project_id: projectId,
    raw_attribution_native_epoch: 'accepted-native-v1',
    raw_attribution_reason: 'native_intake_legacy_project_mapped',
    ...extra,
  })], clients, new Map()).get('native-row');
}
assert.equal(legacyOutcome('video').state, 'resolved', 'native epoch preserves an existing video project as browser evidence');
assert.equal(legacyOutcome('graphics').state, 'resolved', 'native epoch preserves an existing graphics project as browser evidence');
assert.equal(legacyOutcome('video', { raw_attribution_native_epoch: '' }).state, 'needs_attribution', 'provider-era legacy stamp stays unverifiable');
assert.equal(legacyOutcome('video', { raw_project_id: LEGACY_VIDEO }).state, 'resolved', 'matching direct provider evidence corroborates the native stamp');
assert.equal(legacyOutcome('video', {}, [client, { ...client, slug: 'other-client' }]).state, 'needs_attribution', 'duplicate per-team legacy ownership is refused');
const crossTeamCollision = { slug: 'other-client', active: true, kind: 'client', linear_project_ids: { graphics: LEGACY_VIDEO } };
assert.equal(legacyOutcome('video', {}, [client, crossTeamCollision]).state, 'needs_attribution', 'team-blind legacy project collision is refused');
const ambiguousClient = { ...client, linear_project_ids: [
  { team: 'video', id: LEGACY_VIDEO }, { team: 'video', id: 'second-video-project' },
] };
assert.equal(legacyOutcome('video', {}, [ambiguousClient]).state, 'needs_attribution', 'ambiguous per-team mapping is refused rather than choosing the first id');
const stampedChild = row({
  id: 'child', raw_issue_parent_id: 'parent', raw_attribution_source: 'native_intake_legacy_project',
  raw_attribution_project_id: LEGACY_VIDEO, raw_attribution_native_epoch: 'accepted-native-v1',
  raw_attribution_reason: 'native_intake_legacy_project_mapped',
});
const sameParent = row({ id: 'parent', raw_project_id: LEGACY_VIDEO, raw_attribution_state: '' });
assert.equal(resolve([stampedChild, sameParent], [client], new Map([['child', 'parent']])).get('child').state, 'resolved', 'matching mapped ancestor corroborates the native stamp');
const otherClient = { slug: 'other-client', active: true, kind: 'client', linear_project_ids: { video: 'other-project' } };
const conflictingParent = row({ id: 'parent', client_slug: 'other-client', raw_project_id: 'other-project', raw_attribution_state: '' });
assert.equal(resolve([stampedChild, conflictingParent], [client, otherClient], new Map([['child', 'parent']])).get('child').state, 'needs_attribution', 'different-client ancestor evidence is refused');

// Execute the production writer's actual attribution function body (with only
// TypeScript annotations erased) and feed its projection-shaped result into
// the actual browser resolver above.
const gateway = fs.readFileSync(path.join(root, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');
const intakeSource = extractFunction(gateway, 'intakeAttribution')
  .replace(/client: ClientRow/g, 'client').replace(/team: string/g, 'team')
  .replace(/projectId: string/g, 'projectId').replace(/nativeEpoch = ""/g, 'nativeEpoch = ""')
  .replace(/\): JsonMap/g, ')').replace(/const base: JsonMap/g, 'const base');
const makeStamp = vm.runInNewContext('(' + intakeSource + ')', {
  nativeIntakeProjectIdsForTeam: (owner, team) => owner.native_project_ids && owner.native_project_ids[team] ? [owner.native_project_ids[team]] : [],
  attributionProjectIds: value => Object.values(value || {}).map(entry => typeof entry === 'string' ? entry : entry && entry.id).filter(Boolean),
  clean: value => String(value == null ? '' : value).trim(), lower: value => String(value == null ? '' : value).trim().toLowerCase(),
});
function projectedStamp(stamp) {
  return Object.fromEntries(Object.entries(stamp).map(([key, value]) => ['raw_attribution_' + key, value]));
}
for (const [team, projectId] of [['video', LEGACY_VIDEO], ['graphics', LEGACY_GRAPHICS]]) {
  const nativeStamp = makeStamp(client, team, projectId, 'accepted-native-v1');
  assert.equal(nativeStamp.source, 'native_intake_legacy_project');
  assert.equal(resolve([row({ team, ...projectedStamp(nativeStamp) })], [client], new Map()).get('native-row').state, 'resolved');
  const providerStamp = makeStamp(client, team, projectId, '');
  assert.equal(providerStamp.source, 'direct_project');
  assert.equal(resolve([row({ team, ...projectedStamp(providerStamp) })], [client], new Map()).get('native-row').state, 'needs_attribution');
}
const newClientStamp = makeStamp(client, 'video', VIDEO, 'accepted-native-v1');
assert.equal(newClientStamp.source, 'native_intake_project');
assert.equal(resolve([row(projectedStamp(newClientStamp))], [client], new Map()).get('native-row').state, 'resolved');
assert.match(source, /native_project_ids/, 'browser roster select must include native map');
assert.match(source, /native_intake_project/, 'browser owns an explicit native source path');
assert.match(migration, /'native_intake_project'::text/, 'view source allowlist admits the synthetic native source');
assert.match(migration, /'native_intake_legacy_project'::text/, 'view admits the native epoch legacy-project source');
assert.match(migration, /raw_attribution_native_epoch/, 'view carries bounded epoch evidence');
assert.match(migration, /\^svproj_\(video\|graphics\)_\[a-f0-9\]\{32\}\$/, 'view bounds native project values');
console.log('ok native intake attribution ownership');

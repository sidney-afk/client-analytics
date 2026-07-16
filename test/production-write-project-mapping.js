'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildInventory,
  configuredProjectIds,
  parseArgs,
  privatePlan,
  projectIdsForTeam,
  publicReport,
  writePrivatePlan,
} = require('../scripts/production-write-project-mapping');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const clients = [
  { slug: 'alpha-private', display_name: 'Alpha Example', kind: 'client', active: true, linear_project_ids: [] },
  { slug: 'beta-private', display_name: 'Beta Example', kind: 'client', active: true, linear_project_ids: null },
  {
    slug: 'gamma-private', display_name: 'Gamma Example', kind: 'client', active: true,
    linear_project_ids: { video: 'project-gamma-video', graphics: { id: 'project-gamma-graphics' } },
  },
  {
    slug: 'delta-private', display_name: 'Delta Example', kind: 'client', active: true,
    linear_project_ids: ['project-does-not-exist'],
  },
  { slug: 'inactive-private', display_name: 'Inactive Example', kind: 'client', active: false, linear_project_ids: [] },
  { slug: 'test-private', display_name: 'Test Example', kind: 'test', active: true, linear_project_ids: [] },
];

const projects = [
  { id: 'project-alpha', name: 'Alpha Example', teams: { nodes: [{ key: 'VID' }, { key: 'GRA' }] } },
  { id: 'project-beta-v1', name: 'Beta Example', teams: { nodes: [{ key: 'VID' }] } },
  { id: 'project-beta-v2', name: 'Beta Example', teams: { nodes: [{ key: 'VID' }] } },
  { id: 'project-gamma-video', name: 'Renamed Gamma Video', teams: { nodes: [{ key: 'VID' }] } },
  { id: 'project-gamma-graphics', name: 'Renamed Gamma Graphics', teams: { nodes: [{ key: 'GRA' }] } },
  { id: 'project-delta', name: 'Delta Example', teams: { nodes: [{ key: 'VID' }, { key: 'GRA' }] } },
];

const inventory = buildInventory(clients, projects);
ok(inventory.rows.length === 4, 'default scope is active real-client rows only');
ok(projectIdsForTeam({ video: { backup: 'metadata-project' } }, 'video').length === 0
  && JSON.stringify(projectIdsForTeam({ video: { id: 'project-safe', note: 'metadata-project' } }, 'video')) === JSON.stringify(['project-safe'])
  && JSON.stringify(projectIdsForTeam({ video: { id: 'project-a', linear_project_id: 'project-b' } }, 'video')) === JSON.stringify(['project-a', 'project-b'])
  && JSON.stringify(projectIdsForTeam({ team: 'video', id: 'project-a', project_id: 'project-b' }, 'video')) === JSON.stringify(['project-a', 'project-b'])
  && projectIdsForTeam({ team: 'video', metadata: 'metadata-project' }, 'video').length === 0,
'hostile nested metadata is ignored and conflicting aliases remain ambiguous');
ok(JSON.stringify(configuredProjectIds(['legacy-a', { project_id: 'legacy-b' }])) === JSON.stringify(['legacy-a', 'legacy-b'])
  && configuredProjectIds({ notes: { old_video: 'project-gamma-video', old_graphics: 'project-gamma-graphics' } }).length === 0,
'untagged discovery accepts documented legacy entries but ignores arbitrary nested metadata');

const hostileInventory = buildInventory([{
  slug: 'hostile-private', display_name: 'No Matching Project', kind: 'client', active: true,
  linear_project_ids: { notes: { old_video: 'project-gamma-video', old_graphics: 'project-gamma-graphics' } },
}], projects);
const hostilePlan = privatePlan(hostileInventory, { generatedAt: '2026-07-12T00:00:00.000Z' }).clients[0];
ok(hostilePlan.team_resolution.every(result => result.status === 'missing')
  && hostilePlan.review_state === 'manual_review_required'
  && hostilePlan.planned_patch === null,
'project-looking metadata remains manual-review-only and never produces a proposed patch');

const alpha = inventory.rows.find(row => row.slug === 'alpha-private');
ok(alpha.teams.every(result => result.status === 'exact_match'), 'one exact name project attached to both teams resolves both lanes');

const beta = inventory.rows.find(row => row.slug === 'beta-private');
ok(beta.teams.find(result => result.team === 'video').status === 'ambiguous', 'duplicate exact team projects are ambiguous');
ok(beta.teams.find(result => result.team === 'graphics').status === 'missing', 'absent exact team project is missing');

const gamma = inventory.rows.find(row => row.slug === 'gamma-private');
ok(gamma.teams.every(result => result.status === 'configured'), 'valid configured IDs resolve even after a project rename');

const delta = inventory.rows.find(row => row.slug === 'delta-private');
ok(delta.teams.every(result => result.status === 'missing'), 'an invalid configured mapping does not fall back to exact-name discovery');

const report = publicReport(inventory, {
  generatedAt: '2026-07-12T00:00:00.000Z',
  hashKey: 'fixture-private-hash-key',
});
ok(report.by_team.video.tagged_ready === 1
  && report.by_team.video.untagged_candidate === 0
  && report.by_team.video.exact_candidate === 1
  && report.by_team.video.ambiguous === 1
  && report.by_team.video.missing === 1,
'video aggregates preserve every readiness class');
ok(report.by_team.graphics.tagged_ready === 1
  && report.by_team.graphics.untagged_candidate === 0
  && report.by_team.graphics.exact_candidate === 1
  && report.by_team.graphics.ambiguous === 0
  && report.by_team.graphics.missing === 2,
'graphics aggregates preserve every readiness class');
ok(report.total_team_mappings === 8
  && report.production_ready_team_mappings === 2
  && report.candidate_team_mappings === 2
  && report.unresolved_discovery_team_mappings === 4
  && report.not_production_ready_team_mappings === 6
  && report.production_ready === false,
'readiness totals distinguish persisted tags from candidates and unresolved discovery');
ok(report.rows.length === 8 && report.rows.every(row => /^client_[a-f0-9]{20}$/.test(row.client_ref)), 'optional row evidence uses keyed stable pseudonyms');
ok(report.rows.filter(row => row.production_ready).length === 2, 'only persisted team-tagged rows are production-ready');

const publicText = JSON.stringify(report);
for (const forbidden of ['alpha-private', 'Alpha Example', 'project-alpha', 'project-gamma-video']) {
  ok(!publicText.includes(forbidden), `public evidence redacts ${forbidden}`);
}
ok(report.safety.linear_mutations === 0 && report.safety.supabase_mutations === 0, 'public evidence declares the zero-write boundary');

const aggregateOnly = publicReport(inventory, { generatedAt: '2026-07-12T00:00:00.000Z' });
ok(aggregateOnly.rows.length === 0 && aggregateOnly.stable_pseudonyms_included === false, 'no hash key produces aggregate-only public output');

const plan = privatePlan(inventory, { generatedAt: '2026-07-12T00:00:00.000Z' });
const alphaPlan = plan.clients.find(row => row.slug === 'alpha-private');
const betaPlan = plan.clients.find(row => row.slug === 'beta-private');
const gammaPlan = plan.clients.find(row => row.slug === 'gamma-private');
ok(alphaPlan.review_state === 'safe_exact_plan'
  && alphaPlan.planned_patch.values.linear_project_ids.video === 'project-alpha'
  && alphaPlan.planned_patch.values.linear_project_ids.graphics === 'project-alpha',
'private plan emits an explicit team-tagged cross-team mapping');
ok(betaPlan.review_state === 'manual_review_required' && betaPlan.planned_patch === null, 'ambiguous clients never receive an automatic patch plan');
ok(gammaPlan.review_state === 'already_configured' && gammaPlan.planned_patch === null, 'unchanged configured clients are no-op plans');

let writeModeRejected = false;
try { parseArgs(['--apply']); } catch (error) { writeModeRejected = /not supported/.test(error.message); }
ok(writeModeRejected, 'CLI rejects an apply mode');

let repoPrivatePlanRejected = false;
try { writePrivatePlan(path.join(__dirname, 'private-plan.json'), plan); } catch (error) { repoPrivatePlanRejected = /inside the repository/.test(error.message); }
ok(repoPrivatePlanRejected, 'private plan cannot be written into the repository');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'production-write-project-mapping.js'), 'utf8');
ok(!/method:\s*['"](?:PATCH|PUT|DELETE)['"]/.test(source), 'tool contains no Supabase mutation request method');
ok(!/\bmutation\s+[A-Za-z]/.test(source), 'tool contains no Linear GraphQL mutation operation');
ok(/method:\s*'GET'/.test(source) && /query ProjectMappingReadiness/.test(source), 'live sources are a Supabase GET and Linear query');

if (failures) process.exit(1);
console.log('\nProduction-write project-mapping readiness checks passed');

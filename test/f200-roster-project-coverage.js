'use strict';

/*
 * The roster project-coverage audit runs against the live `clients` and
 * `deliverables` tables in a PUBLIC repository's run log. Two things have to
 * hold: it must find the gap the TEST client demonstrated, and it must be
 * incapable of naming who has it.
 */

const {
  buildReport,
  projectIdsByTeam,
  normalizeTeam,
  assertAggregateOnly,
} = require('../scripts/f200-roster-project-coverage');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

const VIDEO_PROJECT = '11111111-1111-1111-1111-111111111111';
const GRAPHICS_PROJECT = '22222222-2222-2222-2222-222222222222';
const OTHER_PROJECT = '33333333-3333-3333-3333-333333333333';

function deliverable(slug, team, projectId) {
  return {
    client_slug: slug,
    team,
    linear_raw: JSON.stringify({ issue: { project: projectId ? { id: projectId } : null } }),
  };
}

console.log('project ids are split by the team key they sit under');
{
  const split = projectIdsByTeam({ video: VIDEO_PROJECT, graphics: GRAPHICS_PROJECT });
  ok(split.byTeam.video.has(VIDEO_PROJECT) && split.byTeam.graphics.has(GRAPHICS_PROJECT),
    'the simple documented shape is read');
  const aliased = projectIdsByTeam({ vid: VIDEO_PROJECT, gra: { id: GRAPHICS_PROJECT } });
  ok(aliased.byTeam.video.has(VIDEO_PROJECT) && aliased.byTeam.graphics.has(GRAPHICS_PROJECT),
    'the accepted aliases and the object form are read too');
  const bare = projectIdsByTeam({ id: OTHER_PROJECT });
  ok(bare.all.has(OTHER_PROJECT) && bare.unteamed.has(OTHER_PROJECT),
    'an id under no team key counts as registered but is tracked as unteamed');
  ok(projectIdsByTeam(null).all.size === 0, 'an empty cell is not a crash');
}

console.log('team keys normalise to the two real teams');
{
  ok(normalizeTeam('VID') === 'video' && normalizeTeam('gra') === 'graphics'
    && normalizeTeam('graphics') === 'graphics',
    'VID/gra/graphics all resolve');
}

console.log('the TEST client shape is exactly what the audit reports as a gap');
{
  // One client fully mapped; one with Graphics work and no Graphics entry --
  // the defect found on the TEST client, reproduced structurally.
  const clients = [
    { slug: 'mapped-both', kind: 'client', active: true,
      linear_project_ids: { video: VIDEO_PROJECT, graphics: GRAPHICS_PROJECT } },
    { slug: 'missing-graphics', kind: 'client', active: true,
      linear_project_ids: { video: OTHER_PROJECT } },
  ];
  const deliverables = [
    deliverable('mapped-both', 'video', VIDEO_PROJECT),
    deliverable('mapped-both', 'graphics', GRAPHICS_PROJECT),
    deliverable('missing-graphics', 'video', OTHER_PROJECT),
    deliverable('missing-graphics', 'graphics', GRAPHICS_PROJECT),
  ];
  const report = buildReport(clients, deliverables);
  ok(report.by_team.graphics.clients_with_work === 2, 'both clients have graphics work');
  ok(report.by_team.graphics.clients_with_work_and_no_registered_project === 1,
    'exactly one client has graphics work and no graphics project registered');
  ok(report.by_team.video.clients_with_work_and_no_registered_project === 0,
    'video is clean, so the counter is not just counting everything');
  ok(report.by_team.graphics.clients_with_work_whose_issues_name_an_unregistered_project === 1
    && report.by_team.graphics.unregistered_project_ids_seen === 1,
    'the unregistered project its issues actually name is counted');
  ok(report.by_team.graphics.deliverables_on_unregistered_projects === 1,
    'and so is the affected deliverable count');
  ok(report.clients_with_at_least_one_gap === 1, 'one client carries a gap');
  ok(report.active_clients === 2 && report.active_clients_by_kind.client === 2,
    'the roster totals are reported');
}

console.log('a gap on the TEST row is never reported as a gap on a real client');
{
  /*
   * The distinction the whole audit exists to make. "One client is affected" is
   * a different sentence depending on whether that row is the shared TEST
   * client or somebody paying for the work.
   */
  const clients = [
    { slug: 'the-test-row', kind: 'test', active: true,
      linear_project_ids: { video: VIDEO_PROJECT } },
    { slug: 'a-real-client', kind: 'client', active: true,
      linear_project_ids: { video: OTHER_PROJECT, graphics: GRAPHICS_PROJECT } },
  ];
  const deliverables = [
    deliverable('the-test-row', 'graphics', GRAPHICS_PROJECT),
    deliverable('a-real-client', 'video', OTHER_PROJECT),
    deliverable('a-real-client', 'graphics', GRAPHICS_PROJECT),
  ];
  const report = buildReport(clients, deliverables);
  const graphics = report.by_team.graphics;
  ok(graphics.clients_with_work_and_no_registered_project === 1,
    'the raw count still sees the gap');
  ok(graphics.clients_with_work_and_no_registered_project_by_kind.test === 1
    && !graphics.clients_with_work_and_no_registered_project_by_kind.client,
    'but it is attributed to kind=test, and no real client is implicated');
  ok(report.clients_with_at_least_one_gap_by_kind.test === 1
    && !report.clients_with_at_least_one_gap_by_kind.client,
    'and the headline gap count is split the same way');
}

console.log('a real client naming an unregistered project is a finding');
{
  const clients = [
    { slug: 'a-real-client', kind: 'client', active: true,
      linear_project_ids: { video: VIDEO_PROJECT, graphics: GRAPHICS_PROJECT } },
  ];
  const deliverables = [
    deliverable('a-real-client', 'graphics', OTHER_PROJECT),
    deliverable('a-real-client', 'graphics', OTHER_PROJECT),
  ];
  const report = buildReport(clients, deliverables);
  const graphics = report.by_team.graphics;
  ok(graphics.clients_with_work_whose_issues_name_an_unregistered_project_by_kind.client === 1,
    'a real client whose issues name an unregistered project is counted as kind=client');
  ok(graphics.deliverables_on_unregistered_projects_by_kind.client === 2,
    'and its affected deliverables are counted by kind too');
  ok(report.clients_with_at_least_one_gap_by_kind.client === 1,
    'so the headline says a real client is affected');
}

console.log('a client with no work in a team is not reported as missing it');
{
  const clients = [{ slug: 'video-only', kind: 'client', active: true,
    linear_project_ids: { video: VIDEO_PROJECT } }];
  const report = buildReport(clients, [deliverable('video-only', 'video', VIDEO_PROJECT)]);
  ok(report.by_team.graphics.clients_with_work === 0
    && report.by_team.graphics.clients_with_work_and_no_registered_project === 0,
    'no graphics work means no graphics gap — the audit is evidence-driven, not structural');
  ok(report.clients_with_at_least_one_gap === 0, 'and it is not flagged');
}

console.log('inactive clients are out of scope');
{
  const clients = [{ slug: 'gone', kind: 'client', active: false, linear_project_ids: {} }];
  const report = buildReport(clients, [deliverable('gone', 'graphics', GRAPHICS_PROJECT)]);
  ok(report.active_clients === 0, 'an inactive client is not on the roster');
  ok(report.deliverables_whose_client_is_not_on_the_active_roster === 1,
    'its rows are counted as off-roster rather than silently dropped');
}

console.log('the report cannot name anyone');
{
  const clients = [{ slug: 'missing-graphics', kind: 'client', active: true,
    linear_project_ids: { video: OTHER_PROJECT } }];
  const deliverables = [deliverable('missing-graphics', 'graphics', GRAPHICS_PROJECT)];
  const rendered = JSON.stringify(buildReport(clients, deliverables), null, 2);
  ok(!rendered.includes('missing-graphics') && !rendered.includes(GRAPHICS_PROJECT)
    && !rendered.includes(OTHER_PROJECT),
    'no slug and no project id appears in the rendered report');

  let threw = false;
  try {
    assertAggregateOnly(rendered, clients, deliverables);
  } catch (_error) {
    threw = true;
  }
  ok(!threw, 'the aggregate-only guard passes a clean report');

  threw = false;
  try {
    assertAggregateOnly(`${rendered}\n"leaked": "missing-graphics"`, clients, deliverables);
  } catch (_error) {
    threw = true;
  }
  ok(threw, 'and refuses to emit one that leaked a slug');

  threw = false;
  try {
    assertAggregateOnly(`${rendered}\n"leaked": "${GRAPHICS_PROJECT}"`, clients, deliverables);
  } catch (_error) {
    threw = true;
  }
  ok(threw, 'and one that leaked a Linear project id');
}

console.log('the script writes nothing');
{
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'scripts', 'f200-roster-project-coverage.js'), 'utf8');
  ok(!/method:\s*['"](POST|PATCH|PUT|DELETE)/i.test(source), 'it issues no mutating HTTP method');
  // The literal string appears in a comment saying there is no apply mode;
  // what must not exist is code that reads one off argv.
  ok(!/argv[\s\S]{0,80}--apply|includes\(\s*['"]--apply/.test(source),
    'and it parses no apply flag to reach for');
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nroster project-coverage audit: all checks passed');

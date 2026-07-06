'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/b1-linear-dry-run.js');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL b1-linear-dry-run:', msg);
    process.exit(1);
  }
}

function writeJson(dir, name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function issue({
  id,
  identifier,
  team,
  createdAt,
  stateType = 'started',
  stateName = 'For SMM approval',
  project = 'Alpha Client',
  completedAt = null,
  archivedAt = null,
  canceledAt = null,
}) {
  return {
    id,
    identifier,
    title: `${identifier} title`,
    description: `${identifier} description`,
    url: `https://linear.app/synchro-social/issue/${identifier}`,
    priority: 0,
    createdAt,
    updatedAt: createdAt,
    completedAt,
    archivedAt,
    canceledAt,
    team: { id: `${team}-team`, key: team, name: team },
    state: { id: `${stateName}-id`, name: stateName, type: stateType },
    project: project ? { id: `${project}-project`, name: project, state: 'In Progress', targetDate: null, archivedAt: null } : null,
    assignee: null,
    parent: null,
    children: { nodes: [] },
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syncview-b1-dry-run-'));
const issues = [
  issue({ id: '1', identifier: 'VID-1', team: 'VID', createdAt: '2026-06-01T00:00:00.000Z' }),
  issue({ id: '2', identifier: 'GRA-2', team: 'GRA', createdAt: '2026-06-02T00:00:00.000Z', project: null }),
  issue({ id: '3', identifier: 'VID-OLD', team: 'VID', createdAt: '2024-01-01T00:00:00.000Z' }),
  issue({ id: '4', identifier: 'GRA-OLD', team: 'GRA', createdAt: '2024-01-02T00:00:00.000Z', project: null }),
  issue({ id: '5', identifier: 'CON-1', team: 'CON', createdAt: '2026-06-03T00:00:00.000Z' }),
  issue({ id: '6', identifier: 'STR-1', team: 'STR', createdAt: '2026-06-04T00:00:00.000Z' }),
  issue({
    id: '7',
    identifier: 'VID-DONE',
    team: 'VID',
    createdAt: '2026-03-01T00:00:00.000Z',
    stateType: 'completed',
    stateName: 'Approved',
    completedAt: '2026-06-15T00:00:00.000Z',
  }),
];
const projects = [
  { id: 'alpha', name: 'Alpha Client', state: 'In Progress', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', completedAt: null, archivedAt: null, targetDate: null, lead: null, teams: { nodes: [] } },
  { id: 'terrinamar-a', name: 'Terrina Mar', state: 'In Progress', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', completedAt: null, archivedAt: null, targetDate: null, lead: null, teams: { nodes: [] } },
  { id: 'terrinamar-b', name: 'Terrina-mar', state: 'In Progress', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', completedAt: null, archivedAt: null, targetDate: null, lead: null, teams: { nodes: [] } },
];
const workload = [
  { team_key: 'VID', active: true },
  { team_key: 'VID', active: false },
  { team_key: 'GRA', active: true },
  { team_key: 'CON', active: true },
  { team_key: 'STR', active: false },
];

const issuesFile = writeJson(tmp, 'issues.json', issues);
const projectsFile = writeJson(tmp, 'projects.json', projects);
const linkedFile = writeJson(tmp, 'linked.json', ['VID-OLD']);
const clientsInfoFile = writeJson(tmp, 'clients-info.json', [
  { client_name: 'Alpha Client', slack_channel_id: 'C123' },
  { client_name: 'Coleman', slack_channel_id: '' },
]);
const smmsFile = writeJson(tmp, 'smms.json', [
  { client_name: 'Morgan Burch' },
]);
const seedFile = writeJson(tmp, 'seed.json', ['Sidney Laruel', 'Kasper Hytonen']);
const workloadFile = writeJson(tmp, 'workload.json', workload);
const outFile = path.join(tmp, 'report.md');
const jsonOut = path.join(tmp, 'report.json');

const env = {
  ...process.env,
  LINEAR_API_KEY: '',
  LINEAR_API_TOKEN: '',
  LINEAR_KEY: '',
  LINEAR_TOKEN: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
};
const result = spawnSync(process.execPath, [
  SCRIPT,
  '--issues-json', issuesFile,
  '--projects-json', projectsFile,
  '--linked-identifiers-json', linkedFile,
  '--clients-info-json', clientsInfoFile,
  '--smms-json', smmsFile,
  '--seed-clients-json', seedFile,
  '--workload-issues-json', workloadFile,
  '--skip-supabase',
  '--as-of', '2026-07-05T00:00:00.000Z',
  '--out', outFile,
  '--json-out', jsonOut,
], { cwd: ROOT, env, encoding: 'utf8' });

ok(result.status === 0, `script exited ${result.status}: ${result.stderr || result.stdout}`);
const report = fs.readFileSync(outFile, 'utf8');
const json = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));

ok(json.open.trackTotal === 4, 'VID/GRA open total must exclude CON/STR');
ok(json.open.allTotal === 6, 'all open total must include CON/STR');
ok(json.open.trackNoProject === 2, 'track no-project count must include only open VID/GRA');
ok(json.cutoffs[0].operational === 3, '3-month operational must include recent VID/GRA plus linked old card');
ok(json.cutoffs[0].open_createdAt_within_cutoff === 2, '3-month createdAt count must not include linked old card');
ok(json.cutoffs[0].linked_live_card_included === 1, 'linked live-card inclusion must be counted separately');
ok(json.cutoffs[0].completedAt_within_cutoff === 1, 'recent closed issue must count by completedAt');
ok(json.workloadIssues.all.VID === 2 && json.workloadIssues.active.VID === 1, 'workload VID all/active split wrong');
ok(json.workloadIssues.all.CON === 1 && json.workloadIssues.active.CON === 1, 'workload CON split wrong');
ok(json.clients.ownerReview.some(r => r.slug === 'morganburch'), 'D-16 owner review should include Morgan Burch');
ok(json.clients.ownerReview.some(r => r.slug === 'sidneylaruel'), 'D-16 owner review should include Sidney Laruel');
ok(report.includes('Open Track total (VID+GRA)'), 'report must label Track total clearly');
ok(report.includes('D-11 CON/STR Scope Check'), 'report must include D-11 section');
ok(report.includes('Card linkage: card-to-deliverable resolution uses'), 'report must include card-linkage confirmation');

console.log('b1-linear-dry-run fixture checks passed');

'use strict';
/*
 * native_link_required (OPEN_REPAIRS 39/89): a legacy card whose Linear link
 * points at an issue that is ALREADY CLOSED, and that never got a deliverable
 * row at all. Neither sanctioned tool reaches it — b3-linkage-backfill.js only
 * stamps a card onto a deliverable that already exists, and B1's own stray
 * insert path (test/b1-stray-catcher-mode.js) requires isOpenIssue. Confirmed
 * live 2026-09-08 on Video 3 / GRA-6384: a stray-catcher run with the window
 * rewound to before the issue's completion still wrote nothing for it.
 *
 * B1_ALLOW_CLOSED_IDENTIFIERS is the narrow, explicit escape hatch: a human
 * names specific Linear identifiers, and ONLY those closed issues pass the
 * isOpenIssue gate. Three properties under test, mirroring the stray-catcher
 * suite's structure:
 *
 *  1. SCOPE: a closed issue named in the allowlist becomes a write. A closed
 *     issue NOT named stays excluded, even sitting right beside it in the
 *     same fixture — the override never widens past what was asked for.
 *  2. EVERY OTHER GUARD SURVIVES: an allowlisted closed issue that already
 *     has a deliverable row produces no write and is counted in
 *     skipped_existing, exactly like any other stray candidate.
 *  3. OFF BY DEFAULT: with the env var unset, both closed issues are excluded
 *     and the public count is zero — a standing run is unaffected.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b1-allow-closed-'));
process.env.LINEAR_API_KEY = 'test-only-not-a-credential';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-credential';
process.env.SUPABASE_URL = 'https://example.invalid';
process.env.PROD_AUTHORITY_CACHE_PATH = path.join(tmp, 'authority.json');
process.env.B1_STRAY_CATCHER = '1';

const SCRIPT = path.join(__dirname, '..', 'scripts', 'b1-linear-backfill.js');

function freshModule(allowClosed) {
  for (const key of Object.keys(require.cache)) {
    if (/b1-linear-backfill|prod-authority-guard|public-b1-artifact/.test(key)) delete require.cache[key];
  }
  if (allowClosed) process.env.B1_ALLOW_CLOSED_IDENTIFIERS = allowClosed;
  else delete process.env.B1_ALLOW_CLOSED_IDENTIFIERS;
  return require(SCRIPT);
}

function setAuthority() {
  fs.writeFileSync(process.env.PROD_AUTHORITY_CACHE_PATH, JSON.stringify({
    authority: { video: 'syncview', graphics: 'syncview' },
    write_safe: true,
    captured_at: '2026-09-08T00:00:00.000Z',
  }));
}

function issueFixture(id, identifier, title, { closed }) {
  return {
    id, identifier, title,
    url: 'https://linear.app/fixture/issue/' + identifier + '/x',
    description: '', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-23T00:00:00.000Z',
    dueDate: null, priority: 0,
    completedAt: closed ? '2026-06-23T00:00:00.000Z' : null,
    canceledAt: null, archivedAt: null,
    state: closed ? { name: 'Approved', type: 'completed' } : { name: 'Todo', type: 'unstarted' },
    team: { key: 'GRA', name: 'Graphics' },
    parent: null, project: { id: 'proj-fixture-2' },
    assignee: null,
    labels: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  };
}
// Two closed graphics issues in the same fixture: only ALLOWED is named.
const allowedIssue = issueFixture('uuid-allowed-closed', 'GRA-9001', 'Fixture Video 3', { closed: true });
const otherClosedIssue = issueFixture('uuid-other-closed', 'GRA-9002', 'Fixture Video 4', { closed: true });
// A THIRD closed issue, allowlisted, but its deliverable already exists —
// property 2 (every other guard still applies to an allowlisted issue).
const existingClosedIssue = issueFixture('uuid-existing-closed', 'GRA-9003', 'Fixture Video 5', { closed: true });

const existingDeliverable = {
  id: 'b1_d_uuidexistingclosed', identifier: 'GRA-9003', batch_id: 'batch_fixture_native',
  client_slug: 'fixture-brand', team: 'graphics', kind: 'thumbnail',
  title: 'Fixture Video 5', status: 'approved', assignee_id: null,
  due_date: null, priority: 0, origin: 'calendar', card_id: 'card-5',
  created_by: 'member:fixture', created_at: '2026-06-01T00:00:00.000Z',
  linear_issue_uuid: 'uuid-existing-closed', linear_identifier: 'GRA-9003',
  linear_issue_url: existingClosedIssue.url, linear_raw: {},
};
const nativeBatch = {
  id: 'batch_fixture_native', client_slug: 'fixture-brand', team: 'graphics',
  name: 'Fixture native batch', description: '', status: 'active',
  created_by: 'member:fixture', linear_parent_ids: {},
};

global.fetch = async (url) => {
  const href = String(url);
  let body = [];
  if (href.includes('linear.app')) {
    body = { data: { issues: { nodes: [allowedIssue, otherClosedIssue, existingClosedIssue], pageInfo: { hasNextPage: false, endCursor: null } } } };
  } else if (href.includes('syncview_runtime_flags')) {
    body = [{ key: 'prod_authority', value: { video: 'syncview', graphics: 'syncview' } }];
  } else if (href.includes('/rest/v1/clients')) {
    body = [{ slug: 'fixture-brand', display_name: 'Fixture Brand', kind: 'client', active: true, source: 'test', linear_project_ids: ['proj-fixture-2'] }];
  } else if (href.includes('/rest/v1/deliverables')) {
    body = [existingDeliverable];
  } else if (href.includes('/rest/v1/batches')) {
    body = [nativeBatch];
  }
  return {
    ok: true, status: 200, headers: { get: () => null },
    json: async () => body, text: async () => JSON.stringify(body),
  };
};

(async () => {
  // ---------- Scenario A: allowlist names ONE of two closed issues ---------
  setAuthority();
  const allowed = freshModule('GRA-9001, GRA-9003');
  const planA = await allowed.buildIncrementalPlan();

  const wroteAllowed = planA.writes.deliverables.some(r => r.linear_issue_uuid === 'uuid-allowed-closed');
  ok(wroteAllowed, 'SCOPE: the named closed issue becomes a write');
  const wroteOther = planA.writes.deliverables.some(r => r.linear_issue_uuid === 'uuid-other-closed');
  ok(!wroteOther, 'SCOPE: a closed issue NOT named stays excluded, even from the same fetch');
  ok(planA.closed_identifiers_allowed === 2,
    'the plan counts every closed issue the allowlist actually let through the gate (both named ones, whether or not they end up written)');

  const wroteExisting = planA.writes.deliverables.some(r => r.linear_issue_uuid === 'uuid-existing-closed');
  ok(!wroteExisting,
    'EVERY OTHER GUARD SURVIVES: an allowlisted closed issue with an existing deliverable still produces no write');
  const skippedExisting = planA.skipped_existing.deliverables >= 1;
  ok(skippedExisting, 'and it is still counted in skipped_existing like any other stray candidate');

  // ---------- Scenario B: flag unset -> both closed issues excluded --------
  const off = freshModule(null);
  const planB = await off.buildIncrementalPlan();
  ok(!planB.writes.deliverables.some(r => r.linear_issue_uuid === 'uuid-allowed-closed'),
    'OFF BY DEFAULT: with the env var unset, the same closed issue is excluded again');
  ok(planB.closed_identifiers_allowed === 0,
    'OFF BY DEFAULT: the public count is zero on a standing run');

  fs.rmSync(tmp, { recursive: true, force: true });
  if (failures) {
    console.error(`\n${failures} b1 allow-closed-identifiers check(s) failed`);
    process.exit(1);
  }
  console.log('\nB1 allow-closed-identifiers checks passed');
})().catch(err => { console.error(err); process.exit(1); });

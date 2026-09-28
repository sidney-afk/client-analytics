'use strict';

/*
 * WORKLOAD TEST CLIENTS (Vigil's hand test, 2026-09-28).
 *
 * The test client's work never reached Workload: almost all of it is in
 * Backlog, which the 2026-08-23 ruling keeps off the board, so there was
 * nothing to hand-test or to move. Now:
 *   - by default a test client's cards are never on the board (the team does
 *     not see test data), Backlog or not;
 *   - a browser opened with ?wltest=1 sees them, Backlog included, and keeps
 *     that choice until ?wltest=0;
 *   - a real client's Backlog stays off the board either way.
 *
 * Invented names only; the network is refused by workload-harness-lib.js.
 * Run: node docs/syncview-design/tests/workload-test-clients-browser.js
 */

const { launchWorkloadHarness, issueRow, parentRow, WED, FRI } = require('./workload-harness-lib.js');

const TEST_SLUG = 'fixture-test-client';
const ROWS = [
  parentRow({}),
  issueRow({ id: 'real-todo', status: 'To Do', status_type: 'unstarted', due_date: WED, client_name: 'Client A' }),
  issueRow({ id: 'real-backlog', status: 'Backlog', status_type: 'backlog', due_date: WED, client_name: 'Client A' }),
  issueRow({ id: 'test-todo', status: 'To Do', status_type: 'unstarted', due_date: FRI, client_name: 'Client B' }),
  issueRow({ id: 'test-backlog', status: 'Backlog', status_type: 'backlog', due_date: FRI, client_name: 'Client B' }),
];

let failures = 0;
function expect(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL workload-test-clients-browser: ' + message); }
}

// Load the rows the way a completed read does, marking two of them as the
// test client's (by slug), and report which cards the board kept.
async function boardIds(page) {
  return page.evaluate(({ rows, slug }) => {
    wlState.testClientKeys = new Set([slug.replace(/[^a-z0-9]+/g, '')]);
    wlState.testClientKeysLoaded = true;
    const issues = rows.map(_wlV2MapRow).filter(Boolean)
      .map(issue => ({ ...issue, clientSlug: issue.id.startsWith('test-') ? slug : 'client-a' }));
    wlApplyData(issues, Date.now());
    return [...wlState.planned, ...wlState.nowWorking, ...wlState.undated, ...wlState.unassigned,
      ...(wlState.allActiveSubs || [])].map(issue => issue.id);
  }, { rows: ROWS, slug: TEST_SLUG });
}

(async () => {
  for (const query of ['', 'wltest=1', 'wltest=0']) {
    const h = await launchWorkloadHarness({ issues: [], query });
    try {
      await h.page.waitForFunction(() => typeof wlStaffMayView === 'function' && wlStaffMayView(), null, { timeout: 15000 });
      const ids = new Set(await boardIds(h.page));
      const on = query === 'wltest=1';
      expect(ids.has('real-todo'), `[${query || 'default'}] a real client's To Do card is on the board`);
      expect(!ids.has('real-backlog'), `[${query || 'default'}] a real client's Backlog stays off the board`);
      expect(ids.has('test-todo') === on, `[${query || 'default'}] the test client's To Do card is ${on ? 'shown' : 'hidden'}`);
      expect(ids.has('test-backlog') === on, `[${query || 'default'}] the test client's Backlog card is ${on ? 'shown' : 'hidden'}`);
      if (on) {
        // Before the test-client list loads (or when it fails), no Backlog
        // card is admitted, even in test mode.
        const early = await h.page.evaluate(({ rows }) => {
          wlState.testClientKeys = new Set();
          wlState.testClientKeysLoaded = false;
          wlApplyData(rows.map(_wlV2MapRow).filter(Boolean), Date.now());
          return [...wlState.planned, ...wlState.nowWorking, ...wlState.undated, ...wlState.unassigned,
            ...(wlState.allActiveSubs || [])].map(issue => issue.id);
        }, { rows: ROWS });
        expect(!early.includes('test-backlog') && !early.includes('real-backlog'),
          'unclassified Backlog stays off the board until the test-client list loads');
        // The choice is remembered for this browser, then cleared by ?wltest=0.
        expect(await h.page.evaluate(() => localStorage.getItem('syncview_workload_test_clients_v1')) === '1',
          '?wltest=1 is remembered in this browser');
      }
    } finally { await h.close(); }
  }

  if (failures) { console.error(`\nworkload-test-clients-browser: ${failures} check(s) failed`); process.exit(1); }
  console.log('\nworkload-test-clients-browser: all checks passed');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });

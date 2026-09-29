'use strict';

/*
 * WORKLOAD SIGNED OUT: NO BOARD DATA ON SCREEN (Vigil's hand test, 2026-09-28).
 *
 * After signing out, Workload still showed the whole team board, with people's
 * names, behind the staff sign-in prompt, and it came back after a reload. A
 * signed-out browser must see no Workload data at all. Two phases:
 *
 *   1. A signed-out browser that still holds a board copy from an earlier
 *      signed-in visit: nothing from it is drawn, the copy is deleted, and the
 *      page never reads `workload_issues`.
 *   2. A signed-in board, then sign-out: the cards, names and saved copy go.
 *
 * Everything is mocked by workload-harness-lib.js (invented clients and
 * editors, a catch-all that refuses the network). Nothing here touches the
 * live database.
 *
 * Run: node docs/syncview-design/tests/workload-signed-out-browser.js
 */

const {
  launchWorkloadHarness, issueRow, parentRow, WED, FRI,
} = require('./workload-harness-lib.js');

const MARKER = 'Signed-out privacy marker';
const ISSUES = [
  parentRow({}),
  issueRow({ id: 's1', identifier: 'VID-101', title: MARKER, due_date: WED, client_name: 'Client A' }),
  issueRow({ id: 's2', identifier: 'VID-102', title: MARKER, due_date: FRI, client_name: 'Client B' }),
];

let failures = 0;
function expect(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL workload-signed-out-browser: ' + message); }
}

// The whole page, not just the board: whatever is behind the sign-in gate
// counts too.
async function boardText(page) {
  return page.evaluate(() => document.body ? document.body.innerText + ' ' + document.body.textContent : '');
}

(async () => {
  // 1. Signed out, with a stale board copy in this browser.
  {
    const h = await launchWorkloadHarness({ issues: ISSUES, signedOut: true });
    try {
      await h.page.waitForTimeout(3000);
      const text = await boardText(h.page);
      expect(!text.includes(MARKER), 'a signed-out page draws no card from the saved board copy');
      expect(!text.includes('editor-1'), 'a signed-out page shows no staff name');
      const mounted = await h.page.locator('.workload-view').count();
      expect(!mounted || await h.page.locator('[data-wl-signed-out]').count() === 1,
        'if the board mounts at all, it says a staff sign-in is needed');
      expect(await h.page.evaluate(() => localStorage.getItem('syncview_workloadBoardCache_v2')) === null,
        'the saved board copy is deleted');
      expect(h.state.issueReads === 0, 'a signed-out page never reads workload_issues (got ' + h.state.issueReads + ')');
      expect(!h.state.pageErrors.length, 'no page errors (' + h.state.pageErrors.slice(0, 2).join(' | ') + ')');
    } finally { await h.close(); }
  }

  // 2. Signed in, then sign out.
  {
    const h = await launchWorkloadHarness({ issues: ISSUES });
    try {
      // Load the fixture rows straight into the board (and its saved copy), the
      // way a completed read does, so this phase does not depend on which
      // live read the board uses.
      await h.page.waitForFunction(() => typeof wlStaffMayView === 'function' && wlStaffMayView(), null, { timeout: 15000 });
      await h.page.evaluate(rows => {
        const issues = rows.map(_wlV2MapRow).filter(Boolean);
        wlApplyData(issues, Date.now());
        wlWriteCache({ issues, fetchedAt: Date.now() });
        wlState.client = 'Client A';
        renderWorkloadAll();
      }, ISSUES);
      expect(await h.page.evaluate(() => wlState.issueSnapshot.length > 0), 'the signed-in board holds the fixture cards first');
      expect(await h.page.evaluate(() => !!localStorage.getItem('syncview_workloadBoardCache_v2')), 'and a saved browser copy');
      await h.page.evaluate(() => _syncviewStaffSignOut());
      await h.page.waitForTimeout(500);
      const text = await boardText(h.page);
      expect(!text.includes(MARKER), 'after sign-out no card remains on screen');
      expect(!text.includes('editor-1'), 'after sign-out no staff name remains on screen');
      expect(await h.page.evaluate(() => localStorage.getItem('syncview_workloadBoardCache_v2')) === null,
        'sign-out deletes the saved board copy');
      expect(await h.page.evaluate(() => wlState.issueSnapshot.length === 0 && wlState.fetchedAt === null),
        'sign-out empties the board held in memory');
      expect(await h.page.locator('[data-wl-signed-out]').count() === 1, 'after sign-out the board says a staff sign-in is needed');
      expect(await h.page.evaluate(() => wlState.client === 'all'), 'after sign-out the client filter is forgotten');
      expect(!(await h.page.evaluate(() => { const v = document.querySelector('.workload-view'); return v ? v.innerText : ''; })).includes('Client A'), 'after sign-out no client name remains on the Workload view');
    } finally { await h.close(); }
  }

  if (failures) { console.error(`\nworkload-signed-out-browser: ${failures} check(s) failed`); process.exit(1); }
  console.log('\nworkload-signed-out-browser: all checks passed');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });

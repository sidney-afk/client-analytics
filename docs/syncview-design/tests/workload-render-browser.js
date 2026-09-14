'use strict';

/*
 * WORKLOAD WORKDAY CALENDAR — structure / render / read-only semantics.
 *
 * Sibling of `workload-board-browser.js`, which owns the INTERACTIONS (drags,
 * pins, refused writes). The split is by cost, not by taste: everything here is
 * decided by one render of one fixture snapshot, so each phase is a boot plus a
 * DOM read, while every phase there is a write round trip. Both share
 * `workload-harness-lib.js` (the server, the pinned clock, the mocks, the
 * invented roster) and both are fully offline — no live Supabase, no Linear, no
 * credentials, nothing but loopback.
 *
 * Run: node docs/syncview-design/tests/workload-render-browser.js
 */

const {
  launchWorkloadHarness, waitForPlanSettled, readBoard, dayOf,
  issueRow, parentRow,
  MON, TUE, WED, THU, FRI,
  EDITOR_1, EDITOR_2, DESIGNER_1,
} = require('./workload-harness-lib.js');

const PHASES = [
  'week_structure', 'capacity_at_cap', 'capacity_over', 'weights',
  'labels_auto_shifted_manual', 'label_loading', 'label_fallback',
  'failclosed_401', 'failclosed_403',
  'exclusions', 'filters', 'permissions_readonly', 'permissions_admin',
];
let currentPhase = PHASES[0];
let passes = 0;
const summary = [];
function phase(name) {
  if (!PHASES.includes(name)) throw new Error('workload-render-browser: undeclared phase');
  currentPhase = name;
  summary.push({ name, passes: 0 });
  console.log(`--- phase: ${name} ---`);
}
function expect(value, message) {
  if (!value) throw new Error(`WLR_PHASE_${currentPhase.toUpperCase()} ${message}`);
  passes++;
  summary[summary.length - 1].passes++;
}

const sub = (id, over) => issueRow({ id, identifier: 'VID-' + id.toUpperCase(), title: 'Card ' + id, ...over });

(async () => {
  // ── 1. The week renders Mon–Fri, cards group under the right editor, each
  //       day shows its unit total. ───────────────────────────────────────
  phase('week_structure');
  {
    const h = await launchWorkloadHarness({
      issues: [
        parentRow({}),
        sub('s1', { due_date: WED, client_name: 'Client A' }),
        sub('s2', { due_date: THU, client_name: 'Client B' }),
        sub('s3', { due_date: THU, client_name: 'Client C', assignee_id: EDITOR_2.id, assignee_name: EDITOR_2.name }),
      ],
      plans: [
        { issue_id: 's1', plan_date: MON },
        { issue_id: 's2', plan_date: WED },
        { issue_id: 's3', plan_date: WED },
      ],
    });
    try {
      await waitForPlanSettled(h.page);
      const board = await readBoard(h.page);
      expect(board.days.length === 5, 'the week grid must render exactly five day cells');
      expect(board.days.map(d => d.iso).join(',') === [MON, TUE, WED, THU, FRI].join(','),
        'the five cells must be Monday through Friday of the pinned week, in order');
      expect(dayOf(board, 's1') === MON && dayOf(board, 's2') === WED && dayOf(board, 's3') === WED,
        'each pinned card must render on its saved day');
      const wed = board.days.find(d => d.iso === WED);
      expect(wed.count === 2, "the day's count badge must count the cards on it");
      expect(wed.totals.length === 2, 'two editors with work on one day must render as two editor cards');
      const ed1 = wed.totals.find(t => t.editor === EDITOR_1.name);
      const ed2 = wed.totals.find(t => t.editor === EDITOR_2.name);
      expect(!!ed1 && ed1.clients.join() === 'Client B', "a card must group under its own editor's chip");
      expect(!!ed2 && ed2.clients.join() === 'Client C', "the other editor's card must carry only its own client");
      expect(ed1.total === '1' && ed2.total === '1', 'each editor card must show that day unit total');
      expect(board.days.find(d => d.iso === TUE).count === 0, 'a day with no work must show no count');
      expect(h.state.pageErrors.length === 0, 'the board must render with no page error');
    } finally { await h.close(); }
  }

  // ── 2. Capacity: 4/4 is NOT over; 5/4 is. Graphics carries its own cap. ──
  phase('capacity_at_cap');
  {
    const issues = [parentRow({})];
    for (let i = 1; i <= 4; i++) issues.push(sub('c' + i, { due_date: THU }));
    // Five graphics cards on the same day: five units against a 15-unit cap.
    for (let i = 1; i <= 5; i++) {
      issues.push(sub('g' + i, {
        due_date: THU, team_key: 'GRA', team_name: 'Graphics',
        assignee_id: DESIGNER_1.id, assignee_name: DESIGNER_1.name, client_name: 'Client B',
      }));
    }
    const plans = issues.filter(row => row.is_sub_issue).map(row => ({ issue_id: row.id, plan_date: TUE }));
    const h = await launchWorkloadHarness({ issues, plans });
    try {
      await waitForPlanSettled(h.page);
      const tue = (await readBoard(h.page)).days.find(d => d.iso === TUE);
      const video = tue.totals.find(t => t.editor === EDITOR_1.name);
      const graphics = tue.totals.find(t => t.editor === DESIGNER_1.name);
      expect(video.total === '4', 'four 1-unit video cards must total 4');
      expect(video.over === false, 'exactly at the 4-unit video cap is NOT over capacity');
      expect(tue.overCapacity === false, 'a day at capacity must not take the over-capacity class');
      expect(graphics.total === '5' && graphics.over === false,
        'five graphics units are well inside the 15-unit graphics cap');
    } finally { await h.close(); }
  }

  phase('capacity_over');
  {
    const issues = [parentRow({})];
    for (let i = 1; i <= 5; i++) issues.push(sub('c' + i, { due_date: THU }));
    const plans = issues.filter(row => row.is_sub_issue).map(row => ({ issue_id: row.id, plan_date: TUE }));
    const h = await launchWorkloadHarness({ issues, plans });
    try {
      await waitForPlanSettled(h.page);
      const tue = (await readBoard(h.page)).days.find(d => d.iso === TUE);
      const video = tue.totals.find(t => t.editor === EDITOR_1.name);
      expect(video.total === '5/4 · 1 over', 'one unit past the cap must be named exactly, not just flagged');
      expect(video.over === true, 'the editor total must carry the over-capacity badge');
      expect(tue.overCapacity === true, 'the day cell must be marked over capacity');
    } finally { await h.close(); }
  }

  // ── 3. Weights: a 2× item consumes two units, and is what tips the day. ──
  phase('weights');
  {
    const issues = [parentRow({})];
    for (let i = 1; i <= 3; i++) issues.push(sub('w' + i, { due_date: THU }));
    const plans = issues.filter(row => row.is_sub_issue).map(row => ({ issue_id: row.id, plan_date: TUE }));
    // Three cards, one of them 2×: 4 units, exactly at the cap.
    const atCap = await launchWorkloadHarness({ issues, plans, weights: { w3: 2 } });
    try {
      await waitForPlanSettled(atCap.page);
      const board = await readBoard(atCap.page);
      const tue = board.days.find(d => d.iso === TUE);
      expect(tue.totals[0].total === '4', 'a 2× card must consume two units of the day total');
      expect(tue.totals[0].over === false, 'three cards weighing 4 units are at the cap, not over it');
      const heavy = board.cards.find(c => c.id === 'w3');
      expect(heavy.weightBadge === '2×', 'a weighted card must render its weight badge');
      expect(board.cards.filter(c => c.weightBadge).length === 1, 'unweighted cards must carry no badge');
    } finally { await atCap.close(); }

    // Same three cards, the heavy one now 3×: 5 units — the weight is what
    // tips the day over, with no extra card added.
    const over = await launchWorkloadHarness({ issues, plans, weights: { w3: 3 } });
    try {
      await waitForPlanSettled(over.page);
      const tue = (await readBoard(over.page)).days.find(d => d.iso === TUE);
      expect(tue.totals[0].total === '5/4 · 1 over' && tue.totals[0].over === true,
        'raising one card from 2× to 3× must be what puts the day over capacity');
    } finally { await over.close(); }
  }

  // ── 4. Placement modes and their labels. ────────────────────────────────
  phase('labels_auto_shifted_manual');
  {
    const h = await launchWorkloadHarness({
      issues: [
        parentRow({}),
        // Ideal day = one working day before the deadline = Monday = the
        // earliest day in the window, so it lands ON its ideal day: "auto".
        sub('p_auto', { due_date: TUE, client_name: 'Client A' }),
        // Ideal day = Thursday, but Monday has room, so it is placed earlier.
        sub('p_shift', { due_date: FRI, client_name: 'Client B' }),
        sub('p_pin', { due_date: FRI, client_name: 'Client C' }),
      ],
      plans: [{ issue_id: 'p_pin', plan_date: WED }],
    });
    try {
      await waitForPlanSettled(h.page);
      const board = await readBoard(h.page);
      const auto = board.cards.find(c => c.id === 'p_auto');
      const shifted = board.cards.find(c => c.id === 'p_shift');
      const pinned = board.cards.find(c => c.id === 'p_pin');
      expect(auto.day === MON && auto.mode === 'auto' && auto.label === 'Automatically planned',
        'a card on its ideal day is automatically planned and says so');
      expect(shifted.day === MON && shifted.mode === 'shifted'
        && shifted.label === 'Planned on the earliest day with room',
        'a card placed before its ideal day must say it took the earliest day with room');
      expect(pinned.day === WED && pinned.mode === 'manual' && pinned.label === 'Manually planned',
        'a pinned card is manually planned and holds its exact day');
      expect(board.cards.every(c => c.label !== 'Deadline fallback'),
        'no card may claim a deadline fallback once the plan snapshot is authoritative');
    } finally { await h.close(); }
  }

  phase('label_loading');
  {
    // The saved-plan read is held open, so the board sits in its fast first
    // paint: the day is the automatic estimate but the label must NOT claim
    // the plan snapshot proved anything.
    const h = await launchWorkloadHarness({
      issues: [parentRow({}), sub('l1', { due_date: WED })],
      plans: [{ issue_id: 'l1', plan_date: FRI }],
      holdMetadata: true,
    });
    try {
      await h.page.waitForFunction(
        () => document.querySelectorAll('.workload-view .wl-plan-origin.is-loading').length > 0,
        null, { timeout: 15000 },
      );
      const loading = await readBoard(h.page);
      const card = loading.cards.find(c => c.id === 'l1');
      expect(card.mode === 'loading' && card.label === 'Planning…',
        'while plans are still loading the label must say Planning…, not automatic');
      expect(card.day === TUE, 'the loading estimate is the automatic day, one working day before the deadline');
      h.state.releaseMetadata();
      await waitForPlanSettled(h.page);
      const settled = await readBoard(h.page);
      const after = settled.cards.find(c => c.id === 'l1');
      expect(after.mode === 'manual' && after.day === FRI,
        'once the saved plan lands, the hidden pin settles the card onto its saved day');
    } finally { await h.close(); }
  }

  phase('label_fallback');
  {
    // A genuine plan-read failure (not an auth refusal): the board must show
    // the raw due date and say it is a fallback rather than claim a plan.
    const h = await launchWorkloadHarness({
      issues: [parentRow({}), sub('f1', { due_date: WED })],
      planListStatus: 500,
    });
    try {
      await waitForPlanSettled(h.page);
      const board = await readBoard(h.page);
      const card = board.cards.find(c => c.id === 'f1');
      expect(card.mode === 'fallback' && card.label === 'Deadline fallback',
        'a failed plan read must be labelled a deadline fallback');
      expect(card.day === WED, 'the fallback is the raw due date, not the automatic estimate');
      expect(/Saved work days are unavailable/.test(board.planStatus),
        'the board must say saved work days are unavailable');
      expect(board.cards.every(c => c.draggable === false) && board.groupHandles === 0,
        'editing must be off while the plan snapshot is unavailable');
    } finally { await h.close(); }
  }

  // ── 5. Fail-closed on a refused plan read: no pins, no editing, no leak. ─
  for (const status of [401, 403]) {
    phase(status === 401 ? 'failclosed_401' : 'failclosed_403');
    const h = await launchWorkloadHarness({
      issues: [parentRow({}), sub('k1', { due_date: WED })],
      plans: [{ issue_id: 'k1', plan_date: FRI }],
      planListStatus: status,
    });
    try {
      await waitForPlanSettled(h.page);
      const board = await readBoard(h.page);
      expect(board.cards.every(c => c.mode !== 'manual'), `no pin may be shown after a ${status} plan read`);
      expect(dayOf(board, 'k1') !== FRI, `a saved pin must not leak onto the board after a ${status}`);
      expect(await h.page.evaluate(() => wlState.planByIssueId.size) === 0,
        'no saved pin may be retained in memory');
      expect(board.cards.every(c => c.draggable === false) && board.groupHandles === 0,
        'no drag handle may be offered when planning is refused');
      const refused = await h.page.evaluate(() => wlSetPlanDate('k1', '2026-09-17'));
      expect(refused === false, 'a plan write must be refused, not silently accepted');
      expect(h.state.planWrites.length === 0, 'a refused board must send no plan write');
    } finally { await h.close(); }
  }

  // ── 6. Exclusions, and the board saying what it is not showing. ─────────
  phase('exclusions');
  {
    const h = await launchWorkloadHarness({
      issues: [
        parentRow({}),
        sub('v1', { due_date: WED, client_name: 'Client A' }),
        // Past-due and still To Do: belongs to the Overdue lane, not the week.
        sub('x_overdue', { due_date: '2026-09-11', client_name: 'Client B' }),
        // No assignee and no date of any kind.
        sub('x_nodate', { assignee_id: null, assignee_name: null, client_name: 'Client C' }),
        // A graphics person holding a VIDEO-team row.
        sub('x_offteam', {
          due_date: THU, client_name: 'Client C',
          assignee_id: DESIGNER_1.id, assignee_name: DESIGNER_1.name,
        }),
      ],
    });
    try {
      await waitForPlanSettled(h.page);
      const board = await readBoard(h.page);
      const ids = board.cards.map(c => c.id);
      expect(ids.join() === 'v1', 'only the one datable, assigned, on-team card may reach the calendar');
      expect(await h.page.textContent('#wlOverdueTotal') === '1',
        'past-due To Do work must be counted in the Overdue lane');
      expect(/2 sub-issues are not shown here/.test(board.planStatus),
        'the board must say how many rows it is not showing');
      expect(/no assignee and no work day or deadline/.test(board.planStatus)
        && /not on that issue team/.test(board.planStatus),
        'the banner must name both exclusion reasons');
    } finally { await h.close(); }
  }

  // ── 7. Filters change what is VISIBLE, never where a card sits. ─────────
  phase('filters');
  {
    const h = await launchWorkloadHarness({
      issues: [
        parentRow({}),
        sub('t_v1', { due_date: FRI, client_name: 'Client A' }),
        sub('t_v2', { due_date: FRI, client_name: 'Client B', assignee_id: EDITOR_2.id, assignee_name: EDITOR_2.name }),
        sub('t_g1', {
          due_date: FRI, client_name: 'Client C', team_key: 'GRA', team_name: 'Graphics',
          assignee_id: DESIGNER_1.id, assignee_name: DESIGNER_1.name,
        }),
      ],
      plans: [
        { issue_id: 't_v1', plan_date: WED },
        { issue_id: 't_v2', plan_date: WED },
        { issue_id: 't_g1', plan_date: WED },
      ],
    });
    try {
      await waitForPlanSettled(h.page);
      const all = await readBoard(h.page);
      expect(all.cards.length === 3 && all.cards.every(c => c.day === WED),
        'all three cards start visible on their pinned day');

      await h.page.click('[data-wl-team="video"]');
      const video = await readBoard(h.page);
      expect(video.cards.map(c => c.id).sort().join() === 't_v1,t_v2',
        'the team filter must hide the graphics card');
      expect(video.cards.every(c => c.day === WED), 'filtering must not move a card off its day');

      await h.page.click('[data-wl-team="all"]');
      await h.page.click('[data-wl-dropdown-trigger="editor"]');
      await h.page.click(`[data-wl-dropdown-item="editor"][data-wl-value="${EDITOR_2.id}"]`);
      const byEditor = await readBoard(h.page);
      expect(byEditor.cards.map(c => c.id).join() === 't_v2', 'the editor filter must show only that editor');
      expect(byEditor.cards[0].day === WED, 'the editor filter must not move the card');

      await h.page.click('[data-wl-dropdown-trigger="editor"]');
      await h.page.click('[data-wl-dropdown-item="editor"][data-wl-value="all"]');
      await h.page.fill('#wlClientSearchInput', 'Client A');
      await h.page.press('#wlClientSearchInput', 'Enter');
      const byClient = await readBoard(h.page);
      expect(byClient.cards.map(c => c.id).join() === 't_v1', 'the client filter must show only that client');
      expect(byClient.cards[0].day === WED, 'the client filter must not move the card');
      expect(await h.page.evaluate(() => wlState.calendarByDate.get('2026-09-16').length) === 3,
        'the underlying placement must still hold all three cards on that day');
    } finally { await h.close(); }
  }

  // ── 8. Who may plan. ────────────────────────────────────────────────────
  const permissionFixture = {
    issues: [parentRow({}), sub('r1', { due_date: WED })],
    plans: [{ issue_id: 'r1', plan_date: THU }],
  };
  phase('permissions_readonly');
  {
    // Creative reads the shared calendar but may not plan on it.
    const h = await launchWorkloadHarness({ ...permissionFixture, role: 'creative' });
    try {
      await waitForPlanSettled(h.page);
      const board = await readBoard(h.page);
      expect(dayOf(board, 'r1') === THU, 'a read-only role still sees the saved plan');
      expect(board.cards.every(c => c.draggable === false),
        'a read-only role must not be offered a card drag handle');
      expect(board.groupHandles === 0, 'a read-only role must not be offered a group drag handle');
      expect(await h.page.evaluate(() => wlPlanEditingEnabled()) === false,
        'plan editing must be reported as unavailable for a read-only role');
    } finally { await h.close(); }
  }

  phase('permissions_admin');
  {
    const h = await launchWorkloadHarness({ ...permissionFixture, role: 'admin' });
    try {
      await waitForPlanSettled(h.page);
      const board = await readBoard(h.page);
      expect(board.cards.every(c => c.draggable === true), 'an admin must get a card drag handle');
      expect(board.groupHandles > 0, 'an admin must get a client-group drag handle');
    } finally { await h.close(); }
  }

  console.log('\n--- workload-render-browser summary ---');
  for (const row of summary) console.log(`  ${row.name.padEnd(28)} ${row.passes} assertions`);
  console.log(`\nworkload-render-browser: ${passes} assertions passed across ${summary.length} phases`);
})().catch(error => {
  console.error('\nworkload-render-browser FAILED');
  console.error(error && error.stack || error);
  process.exit(1);
});

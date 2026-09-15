'use strict';

/*
 * WORKLOAD WORKDAY CALENDAR — interactions and persistence.
 *
 * The real `index.html`, in a real headless Chromium, with every backend call
 * mocked by `workload-harness-lib.js` (loopback static server, pinned clock,
 * invented clients and editors, a catch-all route that aborts anything not
 * deliberately mocked). Nothing here touches the live database, and it can be
 * re-run as often as you like.
 *
 * Its sibling `workload-render-browser.js` owns structure, capacity, labels,
 * exclusions, filters and permissions — everything one render can prove. This
 * file owns what only a drag can prove: where a card lands, what got written,
 * and what happens when the write is refused.
 *
 * Run: node docs/syncview-design/tests/workload-board-browser.js
 */

const {
  launchWorkloadHarness, waitForPlanSettled, waitForPlanIdle, waitForWrites,
  readBoard, dayOf, dragIssueToDay, dragGroupToDay, notices, clearNotices,
  issueRow, parentRow,
  MON, TUE, WED, THU, FRI, SAT, NEXT_MON,
  EDITOR_1,
} = require('./workload-harness-lib.js');

const PHASES = [
  'boot', 'drag_move', 'pin_frees_room', 'no_churn',
  'refuse_single_401', 'refuse_single_403', 'refuse_single_500',
  'reported_lost_drag_401', 'reported_lost_drag_403', 'reported_lost_drag_500',
  'refuse_group_401', 'refuse_group_403', 'refuse_group_500',
  'group_drag', 'handle_only', 'use_automatic_plan',
  'drag_outside_week', 'drag_same_day',
  'refresh_short_payload', 'refresh_complete_payload',
];
let currentPhase = PHASES[0];
let passes = 0;
const summary = [];
function phase(name) {
  if (!PHASES.includes(name)) throw new Error('workload-board-browser: undeclared phase');
  currentPhase = name;
  summary.push({ name, passes: 0 });
  console.log(`--- phase: ${name} ---`);
}
function expect(value, message) {
  if (!value) throw new Error(`WLB_PHASE_${currentPhase.toUpperCase()} ${message}`);
  passes++;
  summary[summary.length - 1].passes++;
}

const sub = (id, over) => issueRow({ id, identifier: 'VID-' + id.toUpperCase(), title: 'Card ' + id, ...over });

(async () => {
  // ── 1. Boot on a mocked issue snapshot + a mocked saved-plan snapshot. ──
  phase('boot');
  {
    const h = await launchWorkloadHarness({
      issues: [
        parentRow({}),
        sub('b1', { due_date: WED, client_name: 'Client A' }),
        sub('b2', { due_date: FRI, client_name: 'Client B' }),
      ],
      plans: [{ issue_id: 'b2', plan_date: THU }],
    });
    try {
      await waitForPlanSettled(h.page);
      const board = await readBoard(h.page);
      expect(await h.page.evaluate(() => wlState.planStatus) === 'ready',
        'the saved-plan snapshot must be authoritative after boot');
      expect(dayOf(board, 'b1') === MON && board.cards.find(c => c.id === 'b1').mode !== 'manual',
        'an unpinned card is placed automatically');
      expect(dayOf(board, 'b2') === THU && board.cards.find(c => c.id === 'b2').mode === 'manual',
        'a card with a saved plan renders on its saved day as manually planned');
      expect(h.state.planWrites.length === 0, 'merely loading the board must write nothing');
      expect(h.state.pageErrors.length === 0, 'the board must boot with no page error');
    } finally { await h.close(); }
  }

  // ── 2. Drag a card to another day. ─────────────────────────────────────
  phase('drag_move');
  {
    const h = await launchWorkloadHarness({
      issues: [parentRow({}), sub('d1', { due_date: FRI, client_name: 'Client A' })],
    });
    try {
      await waitForPlanSettled(h.page);
      expect(dayOf(await readBoard(h.page), 'd1') === MON, 'the card starts on its automatic day');
      const dragged = await dragIssueToDay(h.page, 'd1', WED);
      expect(dragged.ok === true, 'the card must expose a drag handle to drag from');
      const write = await waitForWrites(h.state, 1, 'the dropped card');
      expect(write.action === 'set' && write.issue_id === 'd1' && write.plan_date === WED
        && write.client === 'Client A',
        'the plan write must carry the action, the issue, its client and the dropped day');
      await waitForPlanIdle(h.page);
      const board = await readBoard(h.page);
      expect(dayOf(board, 'd1') === WED, 'the card must land on the day it was dropped on');
      expect(board.cards.find(c => c.id === 'd1').mode === 'manual',
        'a dropped card must render as manually planned');
      expect(h.state.planWrites.length === 1, 'one drag is one write');
    } finally { await h.close(); }
  }

  // ── 3. The owner's report: pinning a card AWAY from a full day frees room
  //       there, and a later card moves up in the SAME interaction. ───────
  phase('pin_frees_room');
  {
    const issues = [parentRow({})];
    // Four 1-unit cards due Tuesday: ideal day Monday, and Monday holds
    // exactly four units — the editor's whole daily capacity.
    for (let i = 1; i <= 4; i++) issues.push(sub('m' + i, { due_date: TUE, client_name: 'Client A' }));
    // Due Wednesday, so its ideal day is Tuesday; Monday is full, so this is
    // the card that should move up the moment Monday has room again.
    issues.push(sub('later', { due_date: WED, client_name: 'Client B' }));
    const h = await launchWorkloadHarness({ issues });
    try {
      await waitForPlanSettled(h.page);
      const before = await readBoard(h.page);
      expect(['m1', 'm2', 'm3', 'm4'].every(id => dayOf(before, id) === MON),
        'the four cards fill Monday to the cap');
      expect(dayOf(before, 'later') === TUE, 'the fifth card is pushed to Tuesday by a full Monday');
      expect(before.days.find(d => d.iso === MON).totals[0].total === '4', 'Monday is exactly at capacity');

      await dragIssueToDay(h.page, 'm4', THU);
      await waitForWrites(h.state, 1, 'the pinned-away card');
      await waitForPlanIdle(h.page);

      const after = await readBoard(h.page);
      expect(dayOf(after, 'm4') === THU && after.cards.find(c => c.id === 'm4').mode === 'manual',
        'the pinned card holds the day it was pinned to');
      expect(dayOf(after, 'later') === MON,
        'the later card must move up into the room the pin freed — in the same interaction, with no reload');
      expect(after.cards.find(c => c.id === 'later').mode !== 'manual',
        'the card that moved up is still automatically planned — nothing was pinned on its behalf');
      expect(h.state.planWrites.length === 1,
        'reclaiming freed room is a re-derivation, not a write: only the deliberate pin is saved');
    } finally { await h.close(); }
  }

  // ── 4. No churn: a new, heavier sub-issue must not move settled cards. ──
  phase('no_churn');
  {
    const issues = [parentRow({})];
    for (let i = 1; i <= 3; i++) issues.push(sub('n' + i, { due_date: FRI, client_name: 'Client A' }));
    const h = await launchWorkloadHarness({ issues });
    try {
      await waitForPlanSettled(h.page);
      const before = await readBoard(h.page);
      expect(['n1', 'n2', 'n3'].every(id => dayOf(before, id) === MON),
        'three settled cards share Monday');

      // A heavier newcomer arrives in the next snapshot. It sorts ahead of the
      // incumbents (same deadline, more weight), so without the settled-day
      // anchor it would take Monday and push three settled cards off it.
      await h.page.evaluate(newRow => {
        const mapped = _wlV2MapRow(newRow);
        wlState.workloadByIssueId.set(newRow.id, { weight: 3, label: '3× Workload', color: '' });
        wlApplyData(wlState.issueSnapshot.concat([mapped]), wlState.fetchedAt);
        renderWorkloadAll();
      }, sub('n_heavy', { due_date: FRI, client_name: 'Client C' }));

      const after = await readBoard(h.page);
      expect(['n1', 'n2', 'n3'].every(id => dayOf(after, id) === MON),
        'already-settled cards must not move when a new sub-issue is added');
      expect(dayOf(after, 'n_heavy') === TUE,
        'the newcomer takes the next day with room for its weight instead of displacing anyone');
      expect(h.state.planWrites.length === 0, 're-rendering a snapshot must write nothing');
    } finally { await h.close(); }
  }

  /* ── 5-6. A refused write must never leave the optimistic move standing.
   *
   * WHAT "PUT BACK" MEANS DEPENDS ON THE STATUS, and the difference is the
   * fail-closed rule rather than an inconsistency:
   *   500 — the board keeps its session, so the card returns to the EXACT day
   *         it held and its pin survives.
   *   401/403 — the refusal also ends this browser's right to see saved plans,
   *         so the whole pin set is purged (`_syncviewStaffIdentityClear` /
   *         `wlPurgePlanSensitiveState`). The card therefore cannot sit on its
   *         previous PINNED day -- it falls back to the deadline placement
   *         every unpinned card gets. What must still hold is that the dropped
   *         day does not stand, that no pin is retained, and that the user is
   *         told. (The 401 copy claims "It was put back" while the pin is
   *         purged and the card lands on a third day; that is reported as a
   *         defect, not asserted as correct.)
   * Each status gets its own harness so one refusal's purge cannot colour the
   * next. ─────────────────────────────────────────────────────────────── */
  for (const status of [401, 403, 500]) {
    phase(`refuse_single_${status}`);
    const h = await launchWorkloadHarness({
      issues: [parentRow({}), sub('r1', { due_date: FRI, client_name: 'Client A' })],
      plans: [{ issue_id: 'r1', plan_date: TUE }],
    });
    try {
      await waitForPlanSettled(h.page);
      expect(dayOf(await readBoard(h.page), 'r1') === TUE, 'the card starts on its saved day');
      await clearNotices(h.page);
      h.state.planWriteStatus = status;
      await dragIssueToDay(h.page, 'r1', THU);
      await waitForWrites(h.state, 1, `the ${status} refusal`);
      await waitForPlanIdle(h.page);
      const board = await readBoard(h.page);
      expect(dayOf(board, 'r1') !== THU,
        `a ${status} must not leave the card sitting on the day the refused drag dropped it`);
      if (status === 500) {
        expect(dayOf(board, 'r1') === TUE, 'a 500 must put the card back on its previous day');
        expect(board.cards.find(c => c.id === 'r1').mode === 'manual',
          'and it must still be the manual pin it was before the drag');
      } else {
        expect(await h.page.evaluate(() => wlState.planByIssueId.size) === 0,
          `a ${status} must retain no saved pin at all`);
        expect(await h.page.evaluate(() => wlPlanEditingEnabled()) === false,
          `a ${status} must leave planning disabled rather than silently editable`);
      }
      const told = await notices(h.page);
      expect(told.some(n => /Couldn't save the work day/.test(n.title)),
        `a ${status} must tell the user the save failed`);
      expect(told.some(n => n.body && n.body.length > 0),
        `a ${status} notice must say what happened to the card`);
    } finally { await h.close(); }
  }

  /* ── 5b. THE REPORTED SYMPTOM, end to end.
   *
   * Owner report 2026-09-14: social media managers drag a card, it looks
   * moved, they refresh, and it is back where it was. Reproduced here as the
   * exact shape rather than argued about: a refused write (their sign-in had
   * lapsed) used to leave the optimistic move standing on screen with nothing
   * saved, so the board lied until the next load told the truth.
   *
   * The decisive assertion is what the user SEES before any refresh. If the
   * dropped day stands while the server holds the old one, the board is
   * telling them the drag worked. Run against the pre-2026-09-14 page this
   * phase fails on exactly that line.
   * ─────────────────────────────────────────────────────────────────────── */
  for (const status of [401, 403, 500]) {
    phase(`reported_lost_drag_${status}`);
    const h = await launchWorkloadHarness({
      issues: [parentRow({}), sub('s1', { due_date: FRI, client_name: 'Client A' })],
      plans: [{ issue_id: 's1', plan_date: TUE }],
    });
    try {
      await waitForPlanSettled(h.page);
      await clearNotices(h.page);
      h.state.planWriteStatus = status;
      await dragIssueToDay(h.page, 's1', THU);
      await waitForWrites(h.state, 1, `the ${status} refusal`);
      await waitForPlanIdle(h.page);

      const seen = dayOf(await readBoard(h.page), 's1');
      const stored = h.state.plans.get('s1') || null;
      expect(stored === TUE,
        `a ${status} must not change what the server holds (it still holds ${TUE}, saw ${stored})`);
      expect(seen !== THU,
        `THE REPORTED BUG: after a ${status} the board showed the card on ${THU} while the server `
        + `still held ${TUE} — a drag that looks saved and is gone on the next refresh`);
      const told = await notices(h.page);
      expect(told.some(n => /Couldn't save the work day/.test(n.title)),
        `a ${status} must say the save failed rather than leave the user to find out on refresh`);
    } finally { await h.close(); }
  }

  // ── 6. The quiet path: a refused GROUP drag restores every card too. ────
  for (const status of [401, 403, 500]) {
    phase(`refuse_group_${status}`);
    const h = await launchWorkloadHarness({
      issues: [
        parentRow({}),
        sub('q1', { due_date: FRI, client_name: 'Client A' }),
        sub('q2', { due_date: FRI, client_name: 'Client A' }),
      ],
      plans: [{ issue_id: 'q1', plan_date: TUE }, { issue_id: 'q2', plan_date: TUE }],
    });
    try {
      await waitForPlanSettled(h.page);
      await clearNotices(h.page);
      h.state.planWriteStatus = status;
      const dragged = await dragGroupToDay(h.page, TUE, EDITOR_1.id, 'Client A', THU);
      expect(dragged.ok === true, 'the client group must expose its own drag handle');
      await waitForWrites(h.state, 1, `the group ${status} refusal`);
      await waitForPlanIdle(h.page);
      const board = await readBoard(h.page);
      expect(dayOf(board, 'q1') !== THU && dayOf(board, 'q2') !== THU,
        `a ${status} on a group drag must not leave any card on the dropped day`);
      if (status === 500) {
        expect(dayOf(board, 'q1') === TUE && dayOf(board, 'q2') === TUE,
          'a 500 on a group drag must put every card back on its previous day');
      } else {
        expect(await h.page.evaluate(() => wlState.planByIssueId.size) === 0,
          `a ${status} on a group drag must retain no saved pin`);
      }
      const told = await notices(h.page);
      expect(told.length > 0,
        `a ${status} on the quiet path must still tell the user something went wrong`);
      /* The summary must describe what actually happened to the cards. After a
         401/403 the pins are purged, so they do NOT keep their previous work
         day — they fall to the deadline placement. The summary claimed
         otherwise until 2026-09-14. */
      const summary = told.map(n => (n.title || '') + ' ' + (n.body || '')).join(' ');
      if (status === 500) {
        expect(/kept its previous work day/.test(summary),
          'a 500 group refusal did keep every previous day, and may say so');
      } else {
        expect(!/kept its previous work day/.test(summary),
          `a ${status} group refusal must not claim the cards kept their previous work day: the pins were purged`);
        /* 401 and 403 both purge, so the summary cannot infer the reason from
           the purged state — and the two need opposite advice. */
        if (status === 401) {
          expect(/sign in again/i.test(summary),
            'a 401 group refusal must tell the user to sign in again');
          expect(!/cannot edit/i.test(summary),
            'a 401 is an expired session, not a permission problem');
        } else {
          expect(/cannot edit saved work days/i.test(summary),
            'a 403 group refusal must say the account may not edit work days');
          expect(!/sign in again/i.test(summary),
            'a 403 is not fixed by signing in again with the same account, so it must not say so');
        }
      }
    } finally { await h.close(); }
  }

  // ── 7. A successful group drag moves the whole group. ──────────────────
  phase('group_drag');
  {
    const h = await launchWorkloadHarness({
      issues: [
        parentRow({}),
        sub('gg1', { due_date: FRI, client_name: 'Client A' }),
        sub('gg2', { due_date: FRI, client_name: 'Client A' }),
        sub('gg3', { due_date: FRI, client_name: 'Client B' }),
      ],
      plans: [
        { issue_id: 'gg1', plan_date: TUE },
        { issue_id: 'gg2', plan_date: TUE },
        { issue_id: 'gg3', plan_date: TUE },
      ],
    });
    try {
      await waitForPlanSettled(h.page);
      await dragGroupToDay(h.page, TUE, EDITOR_1.id, 'Client A', THU);
      await waitForWrites(h.state, 2, 'the group move');
      await waitForPlanIdle(h.page);
      const board = await readBoard(h.page);
      expect(dayOf(board, 'gg1') === THU && dayOf(board, 'gg2') === THU,
        'a client-group drag must move every card in that group');
      expect(dayOf(board, 'gg3') === TUE,
        "another client's group on the same day must not move");
      expect(h.state.planWrites.length === 2 && h.state.planWrites.every(w => w.plan_date === THU),
        'a group move writes one pin per card in the group and nothing else');
    } finally { await h.close(); }
  }

  // ── 8. Only the dedicated handle starts a drag. ────────────────────────
  phase('handle_only');
  {
    const h = await launchWorkloadHarness({
      issues: [parentRow({}), sub('h1', { due_date: FRI, client_name: 'Client A' })],
    });
    try {
      await waitForPlanSettled(h.page);
      const moved = await h.page.evaluate(target => {
        // Same event sequence as a real drag, started from the card BODY
        // instead of its grip.
        const card = document.querySelector('.workload-plan-item[data-wl-issue-id="h1"]');
        const day = document.querySelector(`.workload-view .workload-grid [data-wl-day="${target}"]`);
        card.dispatchEvent(new MouseEvent('dragstart', { bubbles: true, cancelable: true }));
        day.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true }));
        day.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true }));
        day.dispatchEvent(new MouseEvent('dragend', { bubbles: true, cancelable: true }));
        return true;
      }, WED);
      expect(moved === true, 'the card body is there to be dragged from');
      await h.page.waitForTimeout(250);
      expect(h.state.planWrites.length === 0, 'a drag that did not start on the handle must write nothing');
      expect(dayOf(await readBoard(h.page), 'h1') === MON, 'and must not move the card');
    } finally { await h.close(); }
  }

  // ── 9. "Use automatic planning" returns a pinned card to an automatic day.
  phase('use_automatic_plan');
  {
    const h = await launchWorkloadHarness({
      issues: [parentRow({}), sub('ap1', { due_date: FRI, client_name: 'Client A' })],
      plans: [{ issue_id: 'ap1', plan_date: WED }],
    });
    try {
      await waitForPlanSettled(h.page);
      expect(dayOf(await readBoard(h.page), 'ap1') === WED, 'the card starts pinned');
      // Open the day's client group, then the card's popover.
      await h.page.evaluate(() => {
        document.querySelectorAll('.workload-day-client-group').forEach(group => { group.open = true; });
      });
      await h.page.click('.workload-plan-item[data-wl-issue-id="ap1"]');
      await h.page.waitForSelector('[data-wl-plan-clear="ap1"]', { timeout: 10000 });
      await h.page.click('[data-wl-plan-clear="ap1"]');
      const write = await waitForWrites(h.state, 1, 'the cleared pin');
      expect(write.action === 'set' && write.issue_id === 'ap1' && write.plan_date === null,
        'using automatic planning must clear the saved pin rather than write another day');
      await waitForPlanIdle(h.page);
      const board = await readBoard(h.page);
      const card = board.cards.find(c => c.id === 'ap1');
      expect(card.mode !== 'manual', 'the card must stop claiming it is manually planned');
      expect(card.day === MON,
        'and must return to the day automatic planning chooses for it');
    } finally { await h.close(); }
  }

  // ── 10. Drags that must not corrupt anything. ─────────────────────────
  phase('drag_outside_week');
  {
    const h = await launchWorkloadHarness({
      issues: [parentRow({}), sub('o1', { due_date: FRI, client_name: 'Client A' })],
      plans: [{ issue_id: 'o1', plan_date: WED }],
    });
    try {
      await waitForPlanSettled(h.page);
      for (const outside of [SAT, NEXT_MON]) {
        const attempt = await dragIssueToDay(h.page, 'o1', outside);
        expect(attempt.ok === false && attempt.reason === 'no-day',
          `the Mon–Fri grid must offer no drop target on ${outside}`);
      }
      await h.page.waitForTimeout(250);
      expect(h.state.planWrites.length === 0, 'a drag with no target must write nothing');
      const board = await readBoard(h.page);
      expect(dayOf(board, 'o1') === WED && board.cards.find(c => c.id === 'o1').mode === 'manual',
        'the card must keep the exact day and placement it had');
      expect(h.state.pageErrors.length === 0, 'and must not throw');
    } finally { await h.close(); }
  }

  phase('drag_same_day');
  {
    const h = await launchWorkloadHarness({
      issues: [parentRow({}), sub('s1', { due_date: FRI, client_name: 'Client A' })],
      plans: [{ issue_id: 's1', plan_date: WED }],
    });
    try {
      await waitForPlanSettled(h.page);
      await clearNotices(h.page);
      const attempt = await dragIssueToDay(h.page, 's1', WED);
      expect(attempt.ok === true, 'dropping a card on the day it already holds is a real interaction');
      await h.page.waitForTimeout(300);
      expect(h.state.planWrites.length === 0, 'a no-op drop must not write the same day again');
      const board = await readBoard(h.page);
      expect(dayOf(board, 's1') === WED && board.cards.find(c => c.id === 's1').mode === 'manual',
        'the card must stay exactly where it was, still pinned');
      expect((await notices(h.page)).length === 0, 'a no-op drop must not report a failure');
      expect(h.state.pageErrors.length === 0, 'and must not throw');
    } finally { await h.close(); }
  }


  /* ── The Refresh button is the ONE read that bypasses the Supabase mirror
   *    and goes straight to the Linear webhook, so it is the one read whose
   *    payload can come back SHORTER than the board it replaces. Those
   *    sub-issues used to vanish off the calendar with nothing said -- pins
   *    included, the pin still saved and still in memory but its card gone
   *    until the next reload. That is what a refresh "undoing my work" looks
   *    like, and it is reported now. ────────────────────────────────────── */
  const webhookRow = (r) => ({
    id: r.id, identifier: r.identifier, title: r.title, url: r.url,
    isSubIssue: !!r.is_sub_issue, parentId: r.parent_id, parentIdentifier: r.parent_identifier,
    dueDate: r.due_date, status: r.status, statusType: r.status_type,
    teamKey: r.team_key, teamName: r.team_name, assigneeId: r.assignee_id,
    assigneeName: r.assignee_name, assigneeEmail: r.assignee_email, clientName: r.client_name,
    createdAt: r.linear_created_at, updatedAt: r.linear_updated_at,
    syncedAt: r.synced_at, sortOrder: r.sort_order,
  });
  const pinThenRefresh = async (keepCard) => {
    const rows = [parentRow({}), sub('r1', { due_date: FRI, client_name: 'Client A' })];
    const h = await launchWorkloadHarness({ issues: rows });
    await h.context.route('**/webhook/linear-issues**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(rows.filter(r => keepCard || r.id !== 'r1').map(webhookRow)),
    }));
    await waitForPlanSettled(h.page);
    const dragged = await dragIssueToDay(h.page, 'r1', WED);
    expect(dragged.ok === true, 'the card must be draggable before the refresh');
    await waitForWrites(h.state, 1, 'the dropped card');
    await waitForPlanIdle(h.page);
    expect(dayOf(await readBoard(h.page), 'r1') === WED, 'the pin holds before the refresh');
    await h.page.click('[data-wl-nav="refresh"]');
    await h.page.waitForFunction(() => wlState.refreshing === false, null, { timeout: 40000 });
    await waitForPlanIdle(h.page);
    return h;
  };

  phase('refresh_short_payload');
  {
    const h = await pinThenRefresh(false);
    try {
      const board = await readBoard(h.page);
      expect(!board.cards.find(c => c.id === 'r1'),
        'the harness really did drop the card from the refreshed payload (not vacuous)');
      expect(h.state.plans.get('r1') === WED,
        'the saved work day is untouched by a short refresh — nothing was written or deleted');
      const said = await h.page.evaluate(() => {
        const el = document.getElementById('wlPlanStatus');
        return { hidden: !el || el.hidden, text: el ? el.textContent : '' };
      });
      expect(!said.hidden && /fewer sub-issue/.test(said.text),
        'a refresh that returns fewer sub-issues than the board had must SAY so, never drop them in silence');
      expect(/1 of them planned to a work day/.test(said.text),
        'and must name how many of the missing ones were planned to a work day');
      expect(/reload/i.test(said.text), 'and must say what to do about it');
      /* And that instruction has to be TRUE. The forced read wrote the short
         payload into the five-minute issue cache on its way through, so a
         reload would have replayed the same short board and cleared the
         warning with it. The cache is dropped, so the reload misses it and
         reads the complete mirror instead. */
      const cached = await h.page.evaluate(() => localStorage.getItem('syncview_linearIssuesCache_v1'));
      expect(cached === null,
        'the short snapshot must not stay in the issue cache to be replayed by the reload it just advised');
    } finally { await h.close(); }
  }

  phase('refresh_complete_payload');
  {
    const h = await pinThenRefresh(true);
    try {
      const board = await readBoard(h.page);
      const card = board.cards.find(c => c.id === 'r1');
      expect(!!card && dayOf(board, 'r1') === WED && card.mode === 'manual',
        'an ordinary refresh keeps the pinned card exactly where it was pinned');
      const said = await h.page.evaluate(() => {
        const el = document.getElementById('wlPlanStatus');
        return { hidden: !el || el.hidden, text: el ? el.textContent : '' };
      });
      expect(said.hidden || !/fewer sub-issue/.test(said.text),
        'and says nothing about a shortfall when there was none — a banner with nothing to report is its own lie');
      const cached = await h.page.evaluate(() => localStorage.getItem('syncview_linearIssuesCache_v1'));
      expect(typeof cached === 'string' && cached.includes('r1'),
        'and a complete refresh leaves its snapshot cached, so only a SHORT one costs the next boot a network read');
    } finally { await h.close(); }
  }

  console.log('\n--- workload-board-browser summary ---');
  for (const row of summary) console.log(`  ${row.name.padEnd(22)} ${row.passes} assertions`);
  console.log(`\nworkload-board-browser: ${passes} assertions passed across ${summary.length} phases`);
})().catch(error => {
  console.error('\nworkload-board-browser FAILED');
  console.error(error && error.stack || error);
  process.exit(1);
});

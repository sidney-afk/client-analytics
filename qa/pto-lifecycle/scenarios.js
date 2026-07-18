'use strict';

const {
  assert,
  settle,
} = require('./harness');
const {
  selectPtoType,
  pickRange,
  tapInVisualViewport,
  submitRequest,
  refreshStaff,
  refreshAdmin,
  waitStaffReady,
  waitAdminReady,
  requestRow,
  staffRequestRowLocator,
  pendingAdminCard,
  upcomingAdminRowLocator,
  approvePending,
  denyPending,
  cancelOwnPending,
  signOut,
  signIn,
  tabTo,
  chooseDateWithKeyboard,
} = require('./ui');

const DATES = Object.freeze({
  nearStart: '2030-04-15',
  nearEnd: '2030-04-19',
  wellnessStart: '2030-04-15',
  wellnessEnd: '2030-04-16',
  sickPast: '2030-04-08',
  unpaidDenied: '2030-04-18',
  floating: '2030-04-22',
  pendingCancel: '2030-04-23',
  insufficientStart: '2030-04-24',
  insufficientEnd: '2030-04-30',
  inactive: '2030-04-25',
  farStart: '2033-01-03',
  farEnd: '2033-01-07',
  retry500: '2030-05-02',
  connectionDrop: '2030-05-03',
  doubleClick: '2030-05-06',
  twoTab: '2030-05-07',
  mobile: '2030-05-08',
  keyboard: '2030-05-09',
  postCommitLoss: '2030-05-13',
  delayed: '2030-05-14',
  hung: '2030-05-15',
});

const REQUIRED_COVERAGE = Object.freeze([
  'persona_staff_a',
  'persona_staff_b_same_role',
  'persona_admin',
  'wellness_request',
  'sick_backdated_request',
  'floating_holiday_request',
  'unpaid_request',
  'quote_near',
  'quote_far',
  'pending_cancel',
  'approve_with_note',
  'deny_with_note',
  'admin_cancel_future_approved',
  'balance_after_decision',
  'team_snapshot',
  'team_calendar',
  'history_accumulates',
  'floating_second_blocked',
  'insufficient_balance',
  'inactive_approval_blocked',
  'http_500_retry',
  'connection_drop_lock',
  'post_commit_loss_reconcile',
  'delayed_inflight',
  'hung_request_lock',
  'double_click_single_call',
  'two_tab_stale_then_refresh',
  'sign_out_in_mid_flow',
  'desktop',
  'mobile_390',
  'keyboard_only',
  'month_rollover',
  'tenure_rate_change',
  'anniversary_reset',
  'guatemala_evening_boundary',
]);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function wellnessVisible(page, expected) {
  const text = cleanText(await page.locator('.pto-balance-number').textContent());
  const number = Number((text.match(/-?\d+(?:\.\d+)?/) || [])[0]);
  assert(number === Number(expected), `visible wellness balance exactly equals ${expected}; saw ${text}`);
}

async function metricVisible(page, label, expected) {
  const metric = page.locator('.pto-balance-metric', { hasText: label }).first();
  assert(await metric.count() === 1, `${label} metric is visible`);
  const value = cleanText(await metric.locator('strong').textContent());
  const matches = typeof expected === 'number'
    ? Number(value) === expected
    : value === String(expected);
  assert(matches, `${label} visibly equals ${expected}`);
}

function exactBackendRequests(backend, criteria) {
  return backend.requests.filter(row =>
    (criteria.memberId == null || row.member_id === criteria.memberId)
    && (criteria.type == null || row.type === criteria.type)
    && (criteria.start == null || row.start_date === criteria.start)
    && (criteria.end == null || row.end_date === criteria.end)
    && (criteria.days == null || Number(row.days) === Number(criteria.days))
    && (criteria.note == null || row.note === criteria.note)
    && (criteria.status == null || row.status === criteria.status)
    && (criteria.decisionNote == null || row.decision_note === criteria.decisionNote)
  );
}

function exactBackendRequest(backend, criteria) {
  const rows = exactBackendRequests(backend, criteria);
  assert(rows.length === 1, `exactly one backend request matches ${JSON.stringify(criteria)}; found ${rows.length}`);
  return rows[0];
}

function unchangedState(backend, before, label) {
  assert(backend.fingerprint() === before, `${label} changes no PTO rows, balances, or member state`);
}

async function waitForBackendRequest(page, backend, criteria, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matches = exactBackendRequests(backend, criteria);
    if (matches.length === 1) return matches[0];
    assert(matches.length < 2, `backend request wait found a duplicate for ${JSON.stringify(criteria)}`);
    await page.waitForTimeout(50);
  }
  throw new Error(`backend request did not appear: ${JSON.stringify(criteria)}`);
}

async function exactAdminBalanceCells(page, memberName, expected) {
  const card = page.locator('.pto-admin-card.full').filter({
    has: page.locator('.pto-admin-title', { hasText: /^Member balances$/ }),
  });
  const rows = card.locator('.pto-table tbody tr').filter({ hasText: memberName });
  assert(await rows.count() === 1, `one Member balances row exists for ${memberName}`);
  const cells = (await rows.first().locator('td').allTextContents()).map(cleanText);
  assert(cells.length === 8, 'Member balances row has all eight cells');
  const checks = [
    ['granted', 2],
    ['approved', 3],
    ['adjustments', 4],
    ['available', 5],
    ['sick', 6],
  ];
  for (const [key, index] of checks) {
    if (expected[key] == null) continue;
    assert(Number(cells[index].replace('+', '')) === Number(expected[key]),
      `${memberName} ${key} cell exactly equals ${expected[key]}; saw ${cells[index]}`);
  }
  if (expected.enabled != null) {
    assert(cells[7] === expected.enabled, `${memberName} PTO cell exactly equals ${expected.enabled}`);
  }
  return rows.first();
}

async function exactTeamSnapshotCells(page, memberName, expectedAvailable, expectedToday = '—') {
  const card = page.locator('.pto-card').filter({
    has: page.locator('.pto-card-title', { hasText: /^Team snapshot$/ }),
  });
  const rows = card.locator('.pto-table tbody tr').filter({ hasText: memberName });
  assert(await rows.count() === 1, `one Team snapshot row exists for ${memberName}`);
  const cells = (await rows.first().locator('td').allTextContents()).map(cleanText);
  assert(cells.length === 3, 'Team snapshot row has exactly three cells');
  assert(Number(cells[1].match(/-?\d+(?:\.\d+)?/)?.[0]) === Number(expectedAvailable),
    `Team snapshot available cell exactly equals ${expectedAvailable}`);
  assert(cells[2] === expectedToday, `Team snapshot Today cell exactly equals ${expectedToday}`);
  return rows.first();
}

async function openRecentHistory(page) {
  const details = page.locator('.pto-admin-history');
  if (!await details.evaluate(element => element.hasAttribute('open'))) {
    await details.locator('summary').click();
  }
}

async function assertRecentHistoryOrder(page, backend) {
  await openRecentHistory(page);
  const terminal = backend.requests
    .filter(row => row.status !== 'pending')
    .sort((a, b) => String(b.cancelled_at || b.decided_at || b.requested_at || '')
      .localeCompare(String(a.cancelled_at || a.decided_at || a.requested_at || '')))
    .slice(0, 50);
  const rows = page.locator('.pto-history-row');
  assert(await rows.count() === terminal.length,
    `Recent Decisions has exactly ${terminal.length} terminal rows with no duplicates`);
  const rendered = await rows.allTextContents();
  const members = backend.state.members;
  const typeLabels = {
    wellness: 'wellness',
    sick: 'sick',
    floating_holiday: 'floating holiday',
    unpaid: 'unpaid',
  };
  for (let index = 0; index < terminal.length; index += 1) {
    const expected = terminal[index];
    const text = cleanText(rendered[index]).toLowerCase();
    const startDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
      .format(new Date(`${expected.start_date}T12:00:00.000Z`)).toLowerCase();
    const endDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      .format(new Date(`${expected.end_date}T12:00:00.000Z`)).toLowerCase();
    const member = members.find(row => row.id === expected.member_id);
    const memberLabel = member && member.active !== false ? member.name : 'TEST Team member';
    assert(text.includes(memberLabel.toLowerCase()),
      `history row ${index + 1} has the exact rendered member attribution`);
    assert(text.includes(typeLabels[expected.type]),
      `history row ${index + 1} has type ${typeLabels[expected.type]}`);
    assert(text.includes(startDate) && text.includes(endDate),
      `history row ${index + 1} has the exact request range`);
    assert(text.includes(expected.status), `history row ${index + 1} has status ${expected.status}`);
    if (expected.decision_note) {
      assert(text.includes(expected.decision_note.toLowerCase()),
        `history row ${index + 1} has the exact decision note`);
    }
    const attributionTimes = await page.evaluate(values => ({
      decided: values.decided ? _ptoFmtDateTime(values.decided) : '',
      cancelled: values.cancelled ? _ptoFmtDateTime(values.cancelled) : '',
    }), { decided: expected.decided_at, cancelled: expected.cancelled_at });
    if (expected.status === 'cancelled') {
      const cancelledBy = expected.cancelled_by
        ? `cancelled by ${expected.cancelled_by}`.toLowerCase()
        : 'cancellation attribution unavailable';
      assert(text.includes(cancelledBy), `history row ${index + 1} preserves the cancellation actor`);
      if (expected.decided_by) {
        assert(text.includes(`approved by ${expected.decided_by}`.toLowerCase()),
          `history row ${index + 1} preserves the original approval actor`);
      }
      if (expected.decided_by && attributionTimes.decided) {
        assert(text.includes(attributionTimes.decided.toLowerCase()),
          `history row ${index + 1} preserves the approval timestamp`);
      }
      if (attributionTimes.cancelled) {
        assert(text.includes(attributionTimes.cancelled.toLowerCase()),
          `history row ${index + 1} preserves the cancellation timestamp`);
      }
    } else {
      const decidedBy = expected.decided_by
        ? `decided by ${expected.decided_by}`.toLowerCase()
        : 'decision attribution unavailable';
      assert(text.includes(decidedBy), `history row ${index + 1} preserves the decision actor`);
      if (attributionTimes.decided) {
        assert(text.includes(attributionTimes.decided.toLowerCase()),
          `history row ${index + 1} preserves the decision timestamp`);
      }
    }
  }
  assert(new Set(terminal.map(row => row.id)).size === terminal.length,
    'terminal backend history contains no duplicate request ids');
}

function coverageSet() {
  const covered = new Set();
  return {
    covered,
    add(...keys) { keys.forEach(key => covered.add(key)); },
    assertComplete() {
      const missing = REQUIRED_COVERAGE.filter(key => !covered.has(key));
      assert(missing.length === 0, `Lifecycle coverage is complete; missing: ${missing.join(', ')}`);
    },
  };
}

async function runDesktopLifecycle(harness, sessions, coverage) {
  const { backend } = harness;
  const staff = sessions.staffA;
  const staffPage = harness.page(staff);
  const admin = sessions.admin;
  const adminPage = harness.page(admin);
  const staffB = sessions.staffB;
  const staffBPage = harness.page(staffB);
  const staffName = backend.personas.staffA.member.name;
  const staffBName = backend.personas.staffB.member.name;
  const scenario = 'desktop-full-lifecycle';
  const request = {
    wellness: {
      memberId: backend.personas.staffA.member.id,
      type: 'wellness',
      typeLabel: 'Wellness',
      start: DATES.wellnessStart,
      end: DATES.wellnessEnd,
      days: 2,
      note: 'TEST wellness lifecycle request',
    },
    sick: {
      memberId: backend.personas.staffA.member.id,
      type: 'sick',
      typeLabel: 'Sick',
      start: DATES.sickPast,
      end: DATES.sickPast,
      days: 1,
      note: 'TEST backdated sick request',
    },
    unpaid: {
      memberId: backend.personas.staffA.member.id,
      type: 'unpaid',
      typeLabel: 'Unpaid',
      start: DATES.unpaidDenied,
      end: DATES.unpaidDenied,
      days: 1,
      note: 'TEST unpaid denial request',
    },
    floating: {
      memberId: backend.personas.staffA.member.id,
      type: 'floating_holiday',
      typeLabel: 'Floating holiday',
      start: DATES.floating,
      end: DATES.floating,
      days: 1,
      note: 'TEST floating holiday',
    },
    pendingCancel: {
      memberId: backend.personas.staffA.member.id,
      type: 'wellness',
      typeLabel: 'Wellness',
      start: DATES.pendingCancel,
      end: DATES.pendingCancel,
      days: 0.5,
      note: 'TEST pending cancellation',
    },
  };

  await harness.step({
    scenario,
    session: staff,
    label: 'open staff Time Off',
    expected: 'The signed-in staff member sees an enabled balance, request form, own history, team snapshot, and calendar.',
    action: () => harness.openStaff(staff),
    see: async page => {
      await wellnessVisible(page, 3.5);
      assert(await page.locator('#ptoRequestForm').isVisible(), 'request form is visible');
      assert(await page.locator('.pto-calendar-card').isVisible(), 'team calendar is visible');
      assert(backend.calls.some(call => call.action === 'runtime_flag_read' && call.method === 'GET'),
        'normal boot reads pto_v1 before exposing the Time Off menu');
      assert(!backend.calls.some(call => call.action === 'runtime_flag_write'),
        'mocked navigation never writes the runtime flag');
    },
    target: '.pto-head',
  });
  coverage.add('persona_staff_a', 'desktop');

  const beforeNearQuote = backend.fingerprint();
  await harness.step({
    scenario,
    session: staff,
    label: 'open branded request-type menu',
    expected: 'The custom request-type list opens with clear colored options and no native browser dropdown.',
    action: page => page.locator('#ptoRequestTypeBtn').click(),
    see: async page => {
      assert(await page.locator('#ptoRequestTypeBtn').getAttribute('aria-expanded') === 'true',
        'request-type button visibly reports its open state');
      assert(await page.locator('#ptoRequestTypeMenu').isVisible(), 'branded request-type list is visible');
      assert(await page.locator('#ptoRequestForm select').count() === 0, 'request form has no native select');
    },
    target: '#ptoRequestTypeMenu',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'choose unpaid request type',
    expected: 'Unpaid becomes the selected branded option and the menu closes.',
    action: page => page.locator('#ptoRequestTypeMenu [data-value="unpaid"]').click(),
    see: async page => {
      assert(await page.locator('#ptoRequestType').inputValue() === 'unpaid', 'Unpaid is the exact selected value');
      assert(await page.locator('#ptoRequestTypeBtn').getAttribute('aria-expanded') === 'false',
        'request-type menu closes after selection');
    },
    target: '#ptoRequestTypeBtn',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'open branded start-date calendar',
    expected: 'The SyncView calendar opens with month navigation, weekday headers, and a clear date grid.',
    action: async page => {
      await page.locator('#ptoStartDateBtn').click();
      await page.waitForSelector('#svDatePickerPopup');
    },
    see: async page => {
      assert(await page.locator('#svDatePickerPopup').isVisible(), 'branded start-date calendar is visible');
      assert(await page.locator('#svDatePickerPopup [data-dp-day]').count() >= 28,
        'calendar displays a complete date grid');
    },
    target: '#svDatePickerPopup',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'choose near start date',
    expected: 'The selected start date is shown in the branded field and the calendar closes.',
    action: async page => {
      await page.locator(`#svDatePickerPopup [data-dp-day="${DATES.nearStart}"]`).click();
      await page.waitForSelector('#svDatePickerPopup', { state: 'detached' });
    },
    see: async page => {
      assert(await page.locator('#ptoStartDate').inputValue() === DATES.nearStart,
        'near start date is selected exactly');
    },
    target: '#ptoStartDateBtn',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'open branded end-date calendar',
    expected: 'The end-date calendar opens in SyncView style with dates before the selected start disabled.',
    action: async page => {
      await page.locator('#ptoEndDateBtn').click();
      await page.waitForSelector('#svDatePickerPopup');
    },
    see: async page => {
      assert(await page.locator('#svDatePickerPopup').isVisible(), 'branded end-date calendar is visible');
      assert(await page.locator('#svDatePickerPopup [data-dp-day="2030-04-12"]').isDisabled(),
        'dates before the selected start are disabled');
    },
    target: '#svDatePickerPopup',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'quote a near range',
    expected: 'Choosing the end date closes the calendar and the branded day stepper shows the local business-day total.',
    action: async page => {
      await page.locator(`#svDatePickerPopup [data-dp-day="${DATES.nearEnd}"]`).click();
      await page.waitForSelector('#svDatePickerPopup', { state: 'detached' });
      await page.waitForFunction(() => document.getElementById('ptoDays')?.value === '5');
    },
    see: async page => {
      assert(await page.locator('#ptoEndDate').inputValue() === DATES.nearEnd,
        'near end date is selected exactly');
      assert(await page.locator('#ptoDays').inputValue() === '5',
        'near range visibly quotes five business days');
      assert(!backend.calls.some(call => call.action === 'quote'), 'near quote stays in the browser');
      unchangedState(backend, beforeNearQuote, 'near quote');
    },
    target: '#ptoDaysWrap',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'decrease the quoted day count',
    expected: 'The down-arrow changes the count by one half-day and keeps the control visually coherent.',
    action: page => page.locator('#ptoDaysDown').click(),
    see: async page => {
      assert(Number(await page.locator('#ptoDays').inputValue()) === 4.5,
        'day-count down arrow changes five days to four and a half');
    },
    target: '#ptoDaysWrap',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'restore the full quoted day count',
    expected: 'The up-arrow restores the original full-day count without sending a request.',
    action: page => page.locator('#ptoDaysUp').click(),
    see: async page => {
      assert(Number(await page.locator('#ptoDays').inputValue()) === 5,
        'day-count up arrow restores five days');
      unchangedState(backend, beforeNearQuote, 'day-count controls');
    },
    target: '#ptoDaysWrap',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'enter a request note',
    expected: 'The note field visibly accepts plain-language context without submitting a request.',
    action: page => page.locator('#ptoNote').fill('TEST visual control review'),
    see: async page => {
      assert(await page.locator('#ptoNote').inputValue() === 'TEST visual control review',
        'request note accepts the exact draft');
      unchangedState(backend, beforeNearQuote, 'request-note drafting');
    },
    target: '#ptoNote',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'clear the request-note draft',
    expected: 'The note field returns to a clean empty draft without changing PTO state.',
    action: page => page.locator('#ptoNote').fill(''),
    see: async page => {
      assert(await page.locator('#ptoNote').inputValue() === '', 'request note returns to an empty draft');
      unchangedState(backend, beforeNearQuote, 'request-note clearing');
    },
    target: '#ptoNote',
  });
  coverage.add('quote_near');

  const beforeFarQuote = backend.fingerprint();
  const quoteCallsBefore = backend.calls.filter(call => call.action === 'quote').length;
  await harness.step({
    scenario,
    session: staff,
    label: 'quote a far range',
    expected: 'The form waits for the authenticated server quote, then shows a real business-day total without creating a request.',
    action: async page => {
      await selectPtoType(page, 'unpaid');
      await pickRange(page, DATES.farStart, DATES.farEnd);
    },
    see: async page => {
      assert(await page.locator('#ptoDays').inputValue() === '5', 'far range visibly quotes five business days');
      assert(backend.calls.filter(call => call.action === 'quote').length - quoteCallsBefore === 1,
        'far range uses exactly one mocked authenticated quote action');
      unchangedState(backend, beforeFarQuote, 'far quote');
    },
    target: '#ptoRequestForm',
  });
  coverage.add('quote_far');

  await harness.step({
    scenario,
    session: staff,
    label: 'submit wellness request',
    expected: 'The request appears as Pending in My requests while the visible wellness balance stays unchanged.',
    action: page => submitRequest(page, {
      type: 'wellness',
      start: DATES.wellnessStart,
      end: DATES.wellnessEnd,
      note: 'TEST wellness lifecycle request',
    }),
    see: async page => {
      await waitStaffReady(page);
      await requestRow(page, { ...request.wellness, status: 'pending' });
      await wellnessVisible(page, 3.5);
      exactBackendRequest(backend, { ...request.wellness, status: 'pending' });
    },
    target: staffRequestRowLocator(staffPage, { ...request.wellness, status: 'pending' }),
  });
  coverage.add('wellness_request');

  await harness.step({
    scenario,
    session: admin,
    label: 'Kasper opens pending queue',
    expected: 'Kasper sees the submitted request with decision-note, Approve, and Deny controls.',
    action: () => harness.openAdmin(admin),
    see: page => pendingAdminCard(page, {
      memberName: staffName,
      note: request.wellness.note,
      typeLabel: request.wellness.typeLabel,
      start: request.wellness.start,
      end: request.wellness.end,
    }),
    target: '.pto-admin-queue',
  });
  coverage.add('persona_admin');

  await harness.step({
    scenario,
    session: admin,
    label: 'enter wellness approval note',
    expected: 'Kasper can add a plain-English decision note before taking action.',
    action: async page => {
      const card = await pendingAdminCard(page, {
        memberName: staffName,
        note: request.wellness.note,
        typeLabel: request.wellness.typeLabel,
        start: request.wellness.start,
        end: request.wellness.end,
      });
      await card.locator('[data-pto-decision-note]').fill('TEST approval note');
    },
    see: async page => {
      const card = await pendingAdminCard(page, {
        memberName: staffName,
        note: request.wellness.note,
        typeLabel: request.wellness.typeLabel,
        start: request.wellness.start,
        end: request.wellness.end,
      });
      assert(await card.locator('[data-pto-decision-note]').inputValue() === 'TEST approval note',
        'approval note is visibly retained before the decision');
    },
    target: '.pto-admin-queue',
  });

  await harness.step({
    scenario,
    session: admin,
    label: 'approve wellness request',
    expected: 'The request leaves Pending, appears in Upcoming Approved Leave, and the member balance visibly decreases.',
    action: async page => {
      const card = await pendingAdminCard(page, {
        memberName: staffName,
        note: request.wellness.note,
        typeLabel: request.wellness.typeLabel,
        start: request.wellness.start,
        end: request.wellness.end,
      });
      assert(await card.locator('[data-pto-decision-note]').inputValue() === 'TEST approval note',
        'approval uses the exact visible decision note');
      await card.locator('button.approve').click();
      await card.waitFor({ state: 'detached' });
      await waitAdminReady(page);
    },
    see: async page => {
      assert(await upcomingAdminRowLocator(page, {
        memberName: staffName,
        typeLabel: request.wellness.typeLabel,
        start: request.wellness.start,
        end: request.wellness.end,
      }).count() === 1,
        'approved wellness request is visible in upcoming leave');
      exactBackendRequest(backend, {
        ...request.wellness,
        status: 'approved',
        decisionNote: 'TEST approval note',
      });
      await exactAdminBalanceCells(page, staffName, {
        granted: 3.5,
        approved: 2,
        adjustments: 0,
        available: 1.5,
        sick: 3,
        enabled: 'Enabled',
      });
    },
    target: '.pto-upcoming-list',
  });
  coverage.add('approve_with_note', 'balance_after_decision');

  await harness.step({
    scenario,
    session: staff,
    label: 'staff refreshes after approval',
    expected: 'The staff member sees Approved with the decision note and a lower wellness balance.',
    action: refreshStaff,
    see: async page => {
      await wellnessVisible(page, 1.5);
      const row = await requestRow(page, {
        ...request.wellness,
        status: 'approved',
        decisionNote: 'TEST approval note',
      });
      assert(cleanText(await row.textContent()).includes('TEST approval note'), 'decision note is visible in staff history');
    },
    target: staffRequestRowLocator(staffPage, {
      ...request.wellness,
      status: 'approved',
      decisionNote: 'TEST approval note',
    }),
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'inspect approved team calendar',
    expected: 'The approved future leave is visible on the shared team calendar and the Team snapshot shows the updated availability.',
    action: async page => {
      await page.locator('.pto-calendar-card').scrollIntoViewIfNeeded();
    },
    see: async page => {
      assert(await page.locator('.pto-cal-event', { hasText: staffName }).count() >= 1,
        'approved leave visibly renders on the team calendar');
      await exactTeamSnapshotCells(page, staffName, 1.5);
    },
    target: '.pto-calendar-card',
  });
  coverage.add('team_snapshot', 'team_calendar');

  await harness.step({
    scenario,
    session: admin,
    label: 'open approved-leave cancellation confirmation',
    expected: 'Kasper sees a clear confirmation explaining that the calendar block will be removed while history remains.',
    action: async page => {
      const row = upcomingAdminRowLocator(page, {
        memberName: staffName,
        typeLabel: request.wellness.typeLabel,
        start: request.wellness.start,
        end: request.wellness.end,
      });
      assert(await row.count() === 1, 'one exact approved leave row can be cancelled');
      await row.getByRole('button', { name: 'Cancel leave' }).click();
      await page.waitForSelector('#confirmOverlay.active');
    },
    see: async page => {
      const text = cleanText(await page.locator('#confirmOverlay').textContent());
      assert(text.includes('Cancel approved leave') && text.includes('original approval record'),
        'approved-leave confirmation explains the reversible display effect');
    },
    target: '#confirmOverlay',
  });

  await harness.step({
    scenario,
    session: admin,
    label: 'confirm admin cancellation',
    expected: 'The approved block disappears from Upcoming Leave and history preserves both approval and cancellation attribution.',
    action: async page => {
      await page.locator('#confirmYes').click();
      await waitAdminReady(page);
    },
    see: async page => {
      assert(await upcomingAdminRowLocator(page, {
        memberName: staffName,
        typeLabel: request.wellness.typeLabel,
        start: request.wellness.start,
        end: request.wellness.end,
      }).count() === 0,
        'cancelled future leave is removed from upcoming');
      exactBackendRequest(backend, {
        ...request.wellness,
        status: 'cancelled',
        decisionNote: 'TEST approval note',
      });
      await openRecentHistory(page);
      const history = page.locator('.pto-history-row')
        .filter({ hasText: staffName })
        .filter({ hasText: 'Wellness' })
        .filter({ hasText: 'Apr 15' });
      assert(await history.count() === 1, 'one cancelled wellness history row is visible');
      const text = cleanText(await history.textContent());
      assert(text.includes('Approved by') && text.includes('Cancelled by'),
        'history visibly preserves approval and cancellation attribution');
    },
    target: '.pto-admin-history',
  });
  coverage.add('admin_cancel_future_approved');

  await harness.step({
    scenario,
    session: staff,
    label: 'staff refreshes after admin cancellation',
    expected: 'The wellness balance is restored and the cancelled block is gone from the team calendar.',
    action: refreshStaff,
    see: async page => {
      await wellnessVisible(page, 3.5);
      assert(await page.locator('.pto-cal-event', { hasText: staffName }).count() === 0,
        'cancelled leave is no longer visible on the calendar');
    },
    target: '.pto-balance-card',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'submit backdated sick request',
    expected: 'Sick leave accepts the past business date and appears Pending without deducting the sick balance.',
    action: page => submitRequest(page, {
      type: 'sick',
      start: DATES.sickPast,
      end: DATES.sickPast,
      note: 'TEST backdated sick request',
    }),
    see: async page => {
      await waitStaffReady(page);
      await requestRow(page, { ...request.sick, status: 'pending' });
      await metricVisible(page, 'sick days remaining', 3);
      exactBackendRequest(backend, { ...request.sick, status: 'pending' });
    },
    target: '.pto-table',
  });
  coverage.add('sick_backdated_request');

  await harness.step({
    scenario,
    session: admin,
    label: 'approve backdated sick request',
    expected: 'Kasper approves with a note and the visible sick balance decreases after the decision.',
    action: async page => {
      await refreshAdmin(page);
      await approvePending(page, {
        memberName: staffName,
        note: request.sick.note,
        typeLabel: request.sick.typeLabel,
        start: request.sick.start,
        end: request.sick.end,
      }, 'TEST sick approval note');
    },
    see: async page => {
      exactBackendRequest(backend, {
        ...request.sick,
        status: 'approved',
        decisionNote: 'TEST sick approval note',
      });
      await exactAdminBalanceCells(page, staffName, {
        granted: 3.5,
        approved: 0,
        adjustments: 0,
        available: 3.5,
        sick: 2,
        enabled: 'Enabled',
      });
    },
    target: '.pto-table',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'staff sees sick decision',
    expected: 'The sick request is Approved with its note and the sick-days metric visibly reads two.',
    action: refreshStaff,
    see: async page => {
      await metricVisible(page, 'sick days remaining', 2);
      const row = await requestRow(page, {
        ...request.sick,
        status: 'approved',
        decisionNote: 'TEST sick approval note',
      });
      assert(cleanText(await row.textContent()).includes('TEST sick approval note'), 'sick decision note is visible');
    },
    target: '.pto-balance-card',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'submit unpaid request',
    expected: 'The unpaid request appears Pending and neither paid balance changes.',
    action: page => submitRequest(page, {
      type: 'unpaid',
      start: DATES.unpaidDenied,
      end: DATES.unpaidDenied,
      note: 'TEST unpaid denial request',
    }),
    see: async page => {
      await waitStaffReady(page);
      await requestRow(page, { ...request.unpaid, status: 'pending' });
      await wellnessVisible(page, 3.5);
      await metricVisible(page, 'sick days remaining', 2);
      exactBackendRequest(backend, { ...request.unpaid, status: 'pending' });
    },
    target: '.pto-table',
  });
  coverage.add('unpaid_request');

  await harness.step({
    scenario,
    session: admin,
    label: 'enter unpaid denial note',
    expected: 'Kasper can enter the reason for a denial while Approve and Deny remain clearly distinct.',
    action: async page => {
      await refreshAdmin(page);
      const card = await pendingAdminCard(page, {
        memberName: staffName,
        note: request.unpaid.note,
        typeLabel: request.unpaid.typeLabel,
        start: request.unpaid.start,
        end: request.unpaid.end,
      });
      await card.locator('[data-pto-decision-note]').fill('TEST denial note');
    },
    see: async page => {
      const card = await pendingAdminCard(page, {
        memberName: staffName,
        note: request.unpaid.note,
        typeLabel: request.unpaid.typeLabel,
        start: request.unpaid.start,
        end: request.unpaid.end,
      });
      assert(await card.locator('[data-pto-decision-note]').inputValue() === 'TEST denial note',
        'denial note is visibly retained before the decision');
    },
    target: '.pto-admin-queue',
  });

  await harness.step({
    scenario,
    session: admin,
    label: 'deny unpaid request',
    expected: 'The request moves to Recent Decisions as Denied, the note is retained, and balances stay unchanged.',
    action: async page => {
      const card = await pendingAdminCard(page, {
        memberName: staffName,
        note: request.unpaid.note,
        typeLabel: request.unpaid.typeLabel,
        start: request.unpaid.start,
        end: request.unpaid.end,
      });
      assert(await card.locator('[data-pto-decision-note]').inputValue() === 'TEST denial note',
        'denial uses the exact visible decision note');
      await card.locator('button.deny').click();
      await card.waitFor({ state: 'detached' });
      await waitAdminReady(page);
      await openRecentHistory(page);
    },
    see: async page => {
      const exact = exactBackendRequest(backend, {
        ...request.unpaid,
        status: 'denied',
        decisionNote: 'TEST denial note',
      });
      assert(exact.decision_note === 'TEST denial note', 'denial note is retained exactly');
      const rows = page.locator('.pto-history-row')
        .filter({ hasText: staffName })
        .filter({ hasText: 'Unpaid' })
        .filter({ hasText: 'Apr 18' })
        .filter({ hasText: /denied/i });
      assert(await rows.count() === 1, 'one denied unpaid request is visible in recent history');
      await exactAdminBalanceCells(page, staffName, {
        granted: 3.5,
        approved: 0,
        adjustments: 0,
        available: 3.5,
        sick: 2,
        enabled: 'Enabled',
      });
    },
    target: '.pto-admin-history',
  });
  coverage.add('deny_with_note');

  const stalePage = await harness.newPage(staff);
  await harness.openStaff(staff, stalePage);
  await harness.step({
    scenario,
    session: staff,
    page: staffPage,
    label: 'submit floating holiday',
    expected: 'The first floating holiday becomes Pending and visibly reserves the annual allowance.',
    action: page => submitRequest(page, {
      type: 'floating_holiday',
      start: DATES.floating,
      end: DATES.floating,
      note: 'TEST floating holiday',
    }),
    see: async page => {
      await waitStaffReady(page);
      await requestRow(page, { ...request.floating, status: 'pending' });
      await metricVisible(page, 'floating holiday', 'Pending');
      exactBackendRequest(backend, { ...request.floating, status: 'pending' });
    },
    target: '.pto-balance-card',
  });
  coverage.add('floating_holiday_request');

  const beforeDuplicateFloating = backend.fingerprint();
  await harness.step({
    scenario,
    session: staff,
    page: stalePage,
    label: 'stale tab tries a second floating holiday',
    expected: 'The server rejects the stale second request in plain English; no duplicate row is created.',
    action: page => submitRequest(page, {
      type: 'floating_holiday',
      start: '2030-04-24',
      end: '2030-04-24',
      note: 'TEST duplicate floating attempt',
    }),
    see: async page => {
      await page.waitForFunction(() => document.getElementById('ptoFormError')?.textContent);
      const message = cleanText(await page.locator('#ptoFormError').textContent());
      assert(message.includes('already used or awaiting a decision'), 'duplicate floating rejection is visible in plain English');
      unchangedState(backend, beforeDuplicateFloating, 'rejected second floating-holiday request');
      exactBackendRequest(backend, { ...request.floating, status: 'pending' });
      assert(exactBackendRequests(backend, { note: 'TEST duplicate floating attempt' }).length === 0,
        'rejected duplicate attempt creates no row');
    },
    target: '#ptoRequestForm',
  });
  coverage.add('floating_second_blocked', 'two_tab_stale_then_refresh');

  await harness.step({
    scenario,
    session: admin,
    label: 'approve floating holiday',
    expected: 'Kasper approves the reserved floating holiday and it moves to Upcoming Leave.',
    action: async page => {
      await refreshAdmin(page);
      await approvePending(page, {
        memberName: staffName,
        note: request.floating.note,
        typeLabel: request.floating.typeLabel,
        start: request.floating.start,
        end: request.floating.end,
      }, 'TEST floating approval');
    },
    see: async page => {
      assert(await upcomingAdminRowLocator(page, {
        memberName: staffName,
        typeLabel: request.floating.typeLabel,
        start: request.floating.start,
        end: request.floating.end,
      }).count() === 1,
        'floating approval is visible in upcoming leave');
      exactBackendRequest(backend, {
        ...request.floating,
        status: 'approved',
        decisionNote: 'TEST floating approval',
      });
    },
    target: '.pto-upcoming-list',
  });

  await harness.step({
    scenario,
    session: staff,
    page: staffPage,
    label: 'staff sees floating holiday used',
    expected: 'The floating metric reads Used and the approved day renders on the calendar.',
    action: refreshStaff,
    see: async page => {
      await metricVisible(page, 'floating holiday', 'Used');
      assert(await page.locator('.pto-cal-event', { hasText: staffName }).count() >= 1,
        'approved floating holiday is visible on the calendar');
    },
    target: '.pto-balance-card',
  });

  await harness.step({
    scenario,
    session: staff,
    page: staffPage,
    label: 'submit half-day pending request',
    expected: 'A half-day wellness request appears Pending and does not yet reduce the balance.',
    action: page => submitRequest(page, {
      type: 'wellness',
      start: DATES.pendingCancel,
      end: DATES.pendingCancel,
      halfDay: true,
      note: 'TEST pending cancellation',
    }),
    see: async page => {
      await waitStaffReady(page);
      await requestRow(page, { ...request.pendingCancel, status: 'pending' });
      await wellnessVisible(page, 3.5);
      exactBackendRequest(backend, { ...request.pendingCancel, status: 'pending' });
    },
    target: '.pto-table',
  });

  await harness.step({
    scenario,
    session: staff,
    page: staffPage,
    label: 'open pending-request cancellation confirmation',
    expected: 'The staff member sees a clear confirmation before the pending request is cancelled.',
    action: async page => {
      const row = await requestRow(page, { ...request.pendingCancel, status: 'pending' });
      await row.locator('button', { hasText: 'Cancel' }).click();
      await page.waitForSelector('#confirmOverlay.active');
    },
    see: async page => {
      const text = cleanText(await page.locator('#confirmOverlay').textContent());
      assert(text.includes('Cancel request') && text.includes('pending time off request'),
        'pending-request confirmation clearly states the action');
    },
    target: '#confirmOverlay',
  });

  await harness.step({
    scenario,
    session: staff,
    page: staffPage,
    label: 'confirm own pending cancellation',
    expected: 'The pending request becomes Cancelled and the balance/calendar remain unchanged.',
    action: async page => {
      await page.locator('#confirmYes').click();
      await waitStaffReady(page);
    },
    see: async page => {
      await requestRow(page, { ...request.pendingCancel, status: 'cancelled' });
      await wellnessVisible(page, 3.5);
      exactBackendRequest(backend, { ...request.pendingCancel, status: 'cancelled' });
    },
    target: '.pto-table',
  });
  coverage.add('pending_cancel');

  const beforeInsufficient = backend.fingerprint();
  await harness.step({
    scenario,
    session: staff,
    page: staffPage,
    label: 'try request above available balance',
    expected: 'The request is rejected in plain English, the form remains usable, and no row is created.',
    action: page => submitRequest(page, {
      type: 'wellness',
      start: DATES.insufficientStart,
      end: DATES.insufficientEnd,
      note: 'TEST insufficient balance',
    }),
    see: async page => {
      await page.waitForFunction(() => document.getElementById('ptoFormError')?.textContent);
      assert(cleanText(await page.locator('#ptoFormError').textContent()).includes('larger than the available wellness balance'),
        'insufficient-balance message is visible in plain English');
      assert(await page.locator('#ptoSubmit').isEnabled(), 'request form is re-enabled after rejection');
      unchangedState(backend, beforeInsufficient, 'insufficient-balance rejection');
      assert(exactBackendRequests(backend, { note: 'TEST insufficient balance' }).length === 0,
        'insufficient-balance rejection creates no row');
    },
    target: '#ptoRequestForm',
  });
  coverage.add('insufficient_balance');

  const inactiveRequest = {
    memberId: backend.personas.staffB.member.id,
    type: 'unpaid',
    typeLabel: 'Unpaid',
    start: DATES.inactive,
    end: DATES.inactive,
    days: 1,
    note: 'TEST inactive-member decision',
  };
  await harness.step({
    scenario,
    session: staffB,
    label: 'second same-role staff submits unpaid',
    expected: 'A second creative-role persona sees only their own request history and submits one pending unpaid request.',
    action: async page => {
      await harness.openStaff(staffB);
      await submitRequest(page, {
        type: 'unpaid',
        start: DATES.inactive,
        end: DATES.inactive,
        note: 'TEST inactive-member decision',
      });
    },
    see: async page => {
      await waitStaffReady(page);
      await requestRow(page, { ...inactiveRequest, status: 'pending' });
      assert(!cleanText(await page.locator('.pto-table').first().textContent()).includes('TEST wellness lifecycle request'),
        'second same-role member does not see the first member request');
      exactBackendRequest(backend, { ...inactiveRequest, status: 'pending' });
    },
    target: '.pto-table',
  });
  coverage.add('persona_staff_b_same_role');

  await backend.setMemberActive('staffB', false);
  const beforeInactiveApproval = backend.fingerprint();
  await harness.step({
    scenario,
    session: admin,
    label: 'inactive-member approval is blocked',
    expected: 'Kasper sees a plain-English inactive-profile error and the pending card remains available for cleanup.',
    action: async page => {
      await refreshAdmin(page);
      const card = await pendingAdminCard(page, {
        note: inactiveRequest.note,
        typeLabel: inactiveRequest.typeLabel,
        start: inactiveRequest.start,
        end: inactiveRequest.end,
      });
      await card.locator('button.approve').click();
    },
    see: async page => {
      await page.waitForFunction(() => document.querySelector('.sv-toast-msg')?.textContent.includes('inactive staff profile'));
      assert(await page.locator('.sv-toast-msg').textContent().then(cleanText).then(text => text.includes('cannot be approved')),
        'inactive approval error is visible in plain English');
      const card = await pendingAdminCard(page, {
        note: inactiveRequest.note,
        typeLabel: inactiveRequest.typeLabel,
        start: inactiveRequest.start,
        end: inactiveRequest.end,
      });
      assert(await card.locator('button.deny').isEnabled(), 'denial remains enabled for inactive cleanup');
      unchangedState(backend, beforeInactiveApproval, 'blocked inactive-member approval');
      exactBackendRequest(backend, { ...inactiveRequest, status: 'pending' });
    },
    target: '.pto-admin-queue',
  });
  coverage.add('inactive_approval_blocked');

  await harness.step({
    scenario,
    session: admin,
    label: 'deny inactive request for cleanup',
    expected: 'Kasper can deny the inactive member request and Recent Decisions accumulates the terminal row.',
    action: page => denyPending(page, {
      note: inactiveRequest.note,
      typeLabel: inactiveRequest.typeLabel,
      start: inactiveRequest.start,
      end: inactiveRequest.end,
    }, 'TEST inactive cleanup'),
    see: async page => {
      exactBackendRequest(backend, {
        ...inactiveRequest,
        status: 'denied',
        decisionNote: 'TEST inactive cleanup',
      });
      await assertRecentHistoryOrder(page, backend);
    },
    target: '.pto-admin-history',
  });
  coverage.add('history_accumulates');
  await backend.setMemberActive('staffB', true);
}

async function runResilience(harness, sessions, coverage) {
  const { backend } = harness;
  const staff = sessions.staffA;
  const page = harness.page(staff);
  const secondTab = staff.pages[1];
  const scenario = 'resilience-session-and-tabs';

  await page.evaluate(() => navTo('time-off', false));
  await waitStaffReady(page);

  const retry500 = {
    memberId: backend.personas.staffA.member.id,
    type: 'unpaid',
    typeLabel: 'Unpaid',
    start: DATES.retry500,
    end: DATES.retry500,
    days: 1,
    note: 'TEST 500 retry',
  };
  const before500 = backend.fingerprint();
  backend.queueFailure('request', {
    kind: 'http',
    status: 500,
    error: 'temporary_unavailable',
    message: 'Time Off is temporarily unavailable. Try again.',
    memberId: backend.personas.staffA.member.id,
  });
  await harness.step({
    scenario,
    session: staff,
    label: 'server 500 shows retryable error',
    expected: 'A temporary server failure appears in the form and Send request is enabled for an explicit retry.',
    action: p => submitRequest(p, {
      type: 'unpaid',
      start: DATES.retry500,
      end: DATES.retry500,
      note: 'TEST 500 retry',
    }),
    see: async p => {
      await p.waitForFunction(() => document.getElementById('ptoFormError')?.textContent);
      assert(cleanText(await p.locator('#ptoFormError').textContent()).includes('temporarily unavailable'),
        'temporary server error is visible');
      assert(await p.locator('#ptoSubmit').isEnabled(), 'Send request is re-enabled after 500');
      unchangedState(backend, before500, 'HTTP 500 rejection');
      assert(exactBackendRequests(backend, { note: retry500.note }).length === 0,
        'HTTP 500 creates no request row');
    },
    target: '#ptoRequestForm',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'retry succeeds after 500',
    expected: 'The unchanged form retries successfully and the pending row appears once.',
    action: p => p.locator('#ptoSubmit').click(),
    see: async p => {
      await waitStaffReady(p);
      await requestRow(p, { ...retry500, status: 'pending' });
      exactBackendRequest(backend, { ...retry500, status: 'pending' });
    },
    target: '.pto-table',
  });
  coverage.add('http_500_retry');

  const connectionDrop = {
    memberId: backend.personas.staffA.member.id,
    type: 'unpaid',
    typeLabel: 'Unpaid',
    start: DATES.connectionDrop,
    end: DATES.connectionDrop,
    days: 1,
    note: 'TEST pre-commit connection drop',
  };
  const beforeConnectionDrop = backend.fingerprint();
  harness.expectPtoRequestFailure(staff, 'request');
  backend.queueFailure('request', {
    kind: 'connection_drop',
    memberId: backend.personas.staffA.member.id,
  });
  await harness.step({
    scenario,
    session: staff,
    label: 'connection drop locks unknown write outcome',
    expected: 'A dropped mutating connection says SyncView could not confirm the save and requires Refresh before another submission.',
    action: p => submitRequest(p, {
      type: connectionDrop.type,
      start: connectionDrop.start,
      end: connectionDrop.end,
      note: connectionDrop.note,
    }),
    see: async p => {
      await p.waitForFunction(() => document.getElementById('ptoFormError')?.textContent);
      const text = cleanText(await p.locator('#ptoFormError').textContent());
      assert(text.includes('could not confirm') && text.includes('Refresh'),
        'unknown write outcome is explained with an explicit Refresh instruction');
      assert(await p.locator('#ptoSubmit').isDisabled(), 'Send stays disabled while write outcome is unknown');
      assert(cleanText(await p.locator('#ptoSubmit').textContent()) === 'Refresh to verify',
        'locked Send button tells the staff member exactly how to recover');
      unchangedState(backend, beforeConnectionDrop, 'pre-commit connection drop');
      assert(exactBackendRequests(backend, { note: connectionDrop.note }).length === 0,
        'pre-commit connection drop creates no row');
    },
    target: '#ptoRequestForm',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'refresh reconciles connection drop',
    expected: 'Refresh confirms that no request was saved, clears the safety lock, and restores Send request.',
    action: refreshStaff,
    see: async p => {
      assert(await p.evaluate(() => _ptoState.writeOutcomeUnknown === false),
        'successful Refresh clears the unknown-write state flag');
      assert(cleanText(await p.locator('#ptoSubmit').textContent()) === 'Send request',
        'Send request label is restored after reconciliation');
      unchangedState(backend, beforeConnectionDrop, 'connection-drop reconciliation');
      assert(exactBackendRequests(backend, { note: connectionDrop.note }).length === 0,
        'reconciliation confirms zero dropped-request rows');
    },
    target: '#ptoRequestForm',
  });
  coverage.add('connection_drop_lock');

  const postCommitLoss = {
    memberId: backend.personas.staffA.member.id,
    type: 'unpaid',
    typeLabel: 'Unpaid',
    start: DATES.postCommitLoss,
    end: DATES.postCommitLoss,
    days: 1,
    note: 'TEST committed response loss',
  };
  harness.expectPtoRequestFailure(staff, 'request');
  backend.queueFailure('request', {
    kind: 'post_commit_loss',
    memberId: backend.personas.staffA.member.id,
  });
  await harness.step({
    scenario,
    session: staff,
    label: 'saved request loses its response',
    expected: 'Even when the server saved the row before the response disappeared, the UI locks and does not invite a duplicate retry.',
    action: p => submitRequest(p, {
      type: postCommitLoss.type,
      start: postCommitLoss.start,
      end: postCommitLoss.end,
      note: postCommitLoss.note,
    }),
    see: async p => {
      await p.waitForFunction(() => document.getElementById('ptoFormError')?.textContent);
      const text = cleanText(await p.locator('#ptoFormError').textContent());
      assert(text.includes('could not confirm') && text.includes('Refresh'),
        'lost success response has unknown-outcome guidance');
      assert(await p.locator('#ptoSubmit').isDisabled(), 'post-commit response loss locks Send');
      assert(cleanText(await p.locator('#ptoSubmit').textContent()) === 'Refresh to verify',
        'post-commit response loss requires Refresh');
      exactBackendRequest(backend, { ...postCommitLoss, status: 'pending' });
      const requestCalls = backend.calls.filter(call => call.action === 'request').length;
      await p.locator('#ptoNote').focus();
      await p.keyboard.press('Enter');
      await p.waitForTimeout(120);
      assert(backend.calls.filter(call => call.action === 'request').length === requestCalls,
        'unknown-write state blocks a second mutation even from form-key submission');
      assert(exactBackendRequests(backend, { ...postCommitLoss, status: 'pending' }).length === 1,
        'post-commit response loss leaves exactly one saved row');
    },
    target: '#ptoRequestForm',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'refresh finds the saved request once',
    expected: 'Refresh reconciles the uncertain result and reveals exactly one Pending row without resubmission.',
    action: refreshStaff,
    see: async p => {
      const row = await requestRow(p, { ...postCommitLoss, status: 'pending' });
      assert(await p.evaluate(() => _ptoState.writeOutcomeUnknown === false),
        'Refresh clears the lock after finding the saved row');
      exactBackendRequest(backend, { ...postCommitLoss, status: 'pending' });
      await row.scrollIntoViewIfNeeded();
    },
    target: staffRequestRowLocator(page, { ...postCommitLoss, status: 'pending' }),
  });
  coverage.add('post_commit_loss_reconcile');

  const delayed = {
    memberId: backend.personas.staffA.member.id,
    type: 'unpaid',
    typeLabel: 'Unpaid',
    start: DATES.delayed,
    end: DATES.delayed,
    days: 1,
    note: 'TEST delayed request',
  };
  backend.queueFailure('request', {
    kind: 'delay',
    delayMs: 1400,
    memberId: backend.personas.staffA.member.id,
  });
  await harness.step({
    scenario,
    session: staff,
    label: 'slow request stays visibly in flight',
    expected: 'A genuinely delayed response keeps Send disabled with an in-progress label and does not create an early row.',
    action: async p => {
      await selectPtoType(p, delayed.type);
      await pickRange(p, delayed.start, delayed.end);
      await p.locator('#ptoNote').fill(delayed.note);
      await p.locator('#ptoSubmit').click({ noWaitAfter: true });
    },
    see: async p => {
      assert(await p.locator('#ptoSubmit').isDisabled(), 'slow request disables duplicate submission while in flight');
      assert(/Sending/i.test(cleanText(await p.locator('#ptoSubmit').textContent())),
        'slow request has a visible in-progress label');
      assert(exactBackendRequests(backend, { note: delayed.note }).length === 0,
        'delayed response has not committed before the in-flight screenshot');
    },
    target: '#ptoRequestForm',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'slow request completes once',
    expected: 'The delayed response finishes normally and produces exactly one Pending request.',
    action: async p => {
      await waitForBackendRequest(p, backend, { ...delayed, status: 'pending' });
      await p.waitForFunction(() => {
        const button = document.getElementById('ptoSubmit');
        return button && !/sending/i.test(String(button.textContent || ''));
      });
    },
    see: async p => {
      await requestRow(p, { ...delayed, status: 'pending' });
      exactBackendRequest(backend, { ...delayed, status: 'pending' });
    },
    target: staffRequestRowLocator(page, { ...delayed, status: 'pending' }),
  });
  coverage.add('delayed_inflight');

  const hung = {
    memberId: backend.personas.staffA.member.id,
    type: 'unpaid',
    typeLabel: 'Unpaid',
    start: DATES.hung,
    end: DATES.hung,
    days: 1,
    note: 'TEST hung request',
  };
  const beforeHung = backend.fingerprint();
  harness.expectPtoRequestFailure(staff, 'request');
  backend.queueFailure('request', {
    kind: 'hang',
    delayMs: 23000,
    memberId: backend.personas.staffA.member.id,
  });
  await harness.step({
    scenario,
    session: staff,
    label: 'hung request times out into safe lock',
    expected: 'A request that outlives the client timeout becomes an unknown write outcome and remains locked until Refresh.',
    action: p => submitRequest(p, {
      type: hung.type,
      start: hung.start,
      end: hung.end,
      note: hung.note,
    }),
    see: async p => {
      await p.waitForFunction(() => document.getElementById('ptoFormError')?.textContent, null, { timeout: 25000 });
      const text = cleanText(await p.locator('#ptoFormError').textContent());
      assert(text.includes('could not confirm') && text.includes('Refresh'),
        'hung mutating request uses unknown-outcome guidance');
      assert(await p.locator('#ptoSubmit').isDisabled(), 'hung request leaves Send safely locked');
      unchangedState(backend, beforeHung, 'hung request timeout');
      assert(exactBackendRequests(backend, { note: hung.note }).length === 0,
        'hung request creates no synthetic row');
    },
    target: '#ptoRequestForm',
  });

  await harness.step({
    scenario,
    session: staff,
    label: 'refresh clears hung-request lock',
    expected: 'A successful read confirms no row and restores the request form without writing anything.',
    action: refreshStaff,
    see: async p => {
      assert(await p.evaluate(() => _ptoState.writeOutcomeUnknown === false),
        'Refresh clears the hung-request lock');
      unchangedState(backend, beforeHung, 'hung-request reconciliation');
      assert(exactBackendRequests(backend, { note: hung.note }).length === 0,
        'hung-request reconciliation confirms zero rows');
    },
    target: '#ptoRequestForm',
  });
  coverage.add('hung_request_lock');

  const doubleClick = {
    memberId: backend.personas.staffA.member.id,
    type: 'unpaid',
    typeLabel: 'Unpaid',
    start: DATES.doubleClick,
    end: DATES.doubleClick,
    days: 1,
    note: 'TEST double-click guard',
  };
  await harness.step({
    scenario,
    session: staff,
    label: 'double-click Send request',
    expected: 'A human double-click produces one API call and one pending request, with no duplicate row.',
    action: async p => {
      await selectPtoType(p, 'unpaid');
      await pickRange(p, DATES.doubleClick, DATES.doubleClick);
      await p.locator('#ptoNote').fill('TEST double-click guard');
      const before = backend.calls.filter(call => call.action === 'request').length;
      const box = await p.locator('#ptoSubmit').boundingBox();
      assert(box, 'submit button has a clickable box');
      await p.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2, { delay: 20 });
      await waitStaffReady(p);
      const after = backend.calls.filter(call => call.action === 'request').length;
      assert(after - before === 1, 'double-click emitted exactly one request call');
    },
    see: async p => {
      await requestRow(p, { ...doubleClick, status: 'pending' });
      exactBackendRequest(backend, { ...doubleClick, status: 'pending' });
    },
    target: staffRequestRowLocator(page, { ...doubleClick, status: 'pending' }),
  });
  coverage.add('double_click_single_call');

  const twoTabRequest = {
    memberId: backend.personas.staffA.member.id,
    type: 'unpaid',
    typeLabel: 'Unpaid',
    start: DATES.twoTab,
    end: DATES.twoTab,
    days: 1,
    note: 'TEST two-tab convergence',
  };
  await refreshStaff(secondTab);
  await harness.step({
    scenario,
    session: staff,
    page,
    label: 'submit request in first tab',
    expected: 'The first tab shows the new pending request while the already-open second tab stays stale.',
    action: p => submitRequest(p, {
      type: 'unpaid',
      start: DATES.twoTab,
      end: DATES.twoTab,
      note: 'TEST two-tab convergence',
    }),
    see: async p => {
      await waitStaffReady(p);
      await requestRow(p, { ...twoTabRequest, status: 'pending' });
      exactBackendRequest(backend, { ...twoTabRequest, status: 'pending' });
      assert(await staffRequestRowLocator(secondTab, { ...twoTabRequest, status: 'pending' }).count() === 0,
        'second tab remains stale before explicit refresh');
    },
    target: staffRequestRowLocator(page, { ...twoTabRequest, status: 'pending' }),
  });

  await harness.step({
    scenario,
    session: staff,
    page: secondTab,
    label: 'second tab refreshes',
    expected: 'The second tab explicitly refreshes and converges on the new pending request.',
    action: refreshStaff,
    see: async p => {
      await requestRow(p, { ...twoTabRequest, status: 'pending' });
    },
    target: '.pto-table',
  });

  await harness.step({
    scenario,
    session: staff,
    page: secondTab,
    label: 'second tab cancels pending request',
    expected: 'The second tab cancels the request; the first tab remains stale until its own Refresh.',
    action: p => cancelOwnPending(p, twoTabRequest),
    see: async p => {
      await requestRow(p, { ...twoTabRequest, status: 'cancelled' });
      await requestRow(page, { ...twoTabRequest, status: 'pending' });
      exactBackendRequest(backend, { ...twoTabRequest, status: 'cancelled' });
    },
    target: '.pto-table',
  });

  await harness.step({
    scenario,
    session: staff,
    page,
    label: 'first tab refreshes after cancellation',
    expected: 'The first tab converges on the cancelled state after an explicit Refresh.',
    action: refreshStaff,
    see: async p => {
      await requestRow(p, { ...twoTabRequest, status: 'cancelled' });
    },
    target: '.pto-table',
  });
  coverage.add('two_tab_stale_then_refresh');

  await harness.step({
    scenario,
    session: staff,
    page,
    label: 'sign out with a draft in progress',
    expected: 'Signing out immediately removes the private PTO data and the unsent draft from every open tab.',
    action: async p => {
      await selectPtoType(p, 'unpaid');
      await pickRange(p, '2030-05-10', '2030-05-10');
      await p.locator('#ptoNote').fill('TEST draft must not survive sign-out');
      await signOut(p);
    },
    see: async p => {
      assert(await p.locator('#ptoRequestForm').count() === 0, 'signed-out tab no longer contains the PTO form');
      await secondTab.waitForFunction(() => !window._syncviewStaffIdentityForHeaders?.());
      assert(await secondTab.locator('#ptoRequestForm').count() === 0, 'second tab also purges private PTO DOM');
    },
    target: '#ptoRoot',
  });

  await harness.step({
    scenario,
    session: staff,
    page,
    label: 'sign in as second same-role persona',
    expected: 'A different same-role staff member signs in and receives only their own fresh overview; the first draft is gone.',
    action: async p => {
      await signIn(p, backend.personas.staffB);
      if (!await p.locator('#ptoRequestForm').count()) {
        const signInButton = p.getByRole('button', { name: 'Staff sign in' });
        if (await signInButton.count()) await signInButton.click();
        else await p.evaluate(() => _ptoLoadOverview(true));
      }
      await waitStaffReady(p);
    },
    see: async p => {
      assert(await p.locator('#ptoNote').inputValue() === '', 'prior draft note is absent after identity switch');
      assert(!cleanText(await p.locator('.pto-table').first().textContent()).includes('TEST two-tab convergence'),
        'prior member request history is absent after identity switch');
    },
    target: '#ptoRequestForm',
  });
  coverage.add('sign_out_in_mid_flow');
}

function syntheticClockCue(instant, policyDate) {
  const date = new Date(instant);
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Guatemala',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  const policy = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${policyDate}T12:00:00.000Z`));
  return `${clock} Guatemala | policy date ${policy}`;
}

function policyDateForInstant(instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Guatemala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function setSyntheticClockCue(page, instant, policyDate = policyDateForInstant(instant)) {
  const cue = syntheticClockCue(instant, policyDate);
  await page.evaluate(value => {
    document.documentElement.dataset.ptoLifecycleClockCue = value;
  }, cue);
}

async function runTimeTravel(harness, sessions, coverage) {
  const { backend } = harness;
  const session = sessions.staffB;
  const page = harness.page(session);
  const scenario = 'policy-time-travel';
  const points = [
    ['2030-04-30T17:00:00-06:00', 3.5, 'before month rollover'],
    ['2030-05-01T09:00:00-06:00', 4, 'month rollover half-day grant'],
    ['2030-05-31T09:00:00-06:00', 4, 'last day of lower-rate month'],
    ['2030-06-01T09:00:00-06:00', 5, 'first upper-rate monthly grant'],
    ['2030-11-30T09:00:00-06:00', 10, 'last day before anniversary'],
    ['2030-12-01T09:00:00-06:00', 0, 'anniversary reset'],
    ['2031-01-01T09:00:00-06:00', 1, 'first post-reset monthly grant'],
  ];

  await backend.setMemberActive('staffB', true);
  for (const [instant, expected, label] of points) {
    await backend.setInstant(instant);
    await setSyntheticClockCue(page, instant);
    await harness.step({
      scenario,
      session,
      label,
      expected: 'Refresh makes the policy-date balance transition visible using the production accrual engine.',
      action: async p => {
        await p.evaluate(({ identity, key }) => {
          _syncviewStaffIdentityVerified = true;
          _syncviewStaffIdentitySave({ key, role: identity.role, member: identity, verified_at: new Date().toISOString() });
          _ptoSetFlagValue({ mode: 'on' });
          navTo('time-off', false);
        }, { identity: backend.personas.staffB.member, key: backend.personas.staffB.key });
        if (!await p.locator('#ptoRefresh').count()) await harness.openStaff(session, p);
        else await refreshStaff(p);
      },
      see: p => wellnessVisible(p, expected),
      target: '.pto-balance-card',
    });
  }
  coverage.add('month_rollover', 'tenure_rate_change', 'anniversary_reset');

  const boundaryPoints = [
    ['2030-05-02T00:00:00Z', '2030-05-01', '2030-05-02', 'Guatemala 18:00 stays on the local policy date'],
    ['2030-05-02T05:59:59Z', '2030-05-01', '2030-05-02', 'Guatemala 23:59 stays on the local policy date'],
    ['2030-05-02T06:00:00Z', '2030-05-02', '2030-05-03', 'Guatemala midnight advances the policy date'],
  ];
  for (const [instant, policyDate, expectedMin, label] of boundaryPoints) {
    await backend.setInstant(instant);
    await setSyntheticClockCue(page, instant, policyDate);
    await harness.step({
      scenario,
      session,
      label,
      expected: 'The server policy date keeps the request minimum and calendar Today marker on the Guatemala business day.',
      action: async p => {
        await refreshStaff(p);
        for (let guard = 0; guard < 7 && !await p.locator('.pto-cal-day.today').count(); guard += 1) {
          const direction = await p.evaluate(() => {
            const current = _ptoState.month;
            const target = _ptoDate(_ptoState.overview?.as_of_date);
            return target < current ? 'Previous month' : 'Next month';
          });
          const button = p.locator(`.pto-calendar-nav button[aria-label="${direction}"]`);
          assert(await button.isEnabled(), 'calendar can navigate back to the policy-date month');
          await button.click();
          await settle(p);
        }
      },
      see: async p => {
        assert(await p.locator('#ptoStartDate').getAttribute('min') === expectedMin,
          'visible request control uses the expected next-day minimum');
        assert(await p.locator('.pto-cal-day.today').count() === 1, 'calendar has exactly one Today marker');
        const expectedTodayLabel = new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }).format(new Date(`${policyDate}T12:00:00.000Z`));
        assert(cleanText(await p.locator('.pto-cal-day.today .sr-only').textContent()) === expectedTodayLabel,
          `calendar Today marker is exactly ${expectedTodayLabel}`);
      },
      target: '.pto-calendar-card',
    });
  }
  coverage.add('guatemala_evening_boundary');
  await page.evaluate(() => {
    delete document.documentElement.dataset.ptoLifecycleClockCue;
  });
  await backend.setInstant('2030-04-10T12:00:00-06:00');
}

async function runMobileJourney(harness, sessions, coverage) {
  const { backend } = harness;
  const staff = sessions.mobile;
  const page = harness.page(staff);
  const admin = sessions.mobileAdmin;
  const adminPage = harness.page(admin);
  const staffName = backend.personas.staffA.member.name;
  const scenario = 'mobile-390-happy-path';
  const mobileRequest = {
    memberId: backend.personas.staffA.member.id,
    type: 'unpaid',
    typeLabel: 'Unpaid',
    start: DATES.mobile,
    end: DATES.mobile,
    days: 1,
    note: 'TEST mobile happy path',
  };

  await harness.step({
    scenario,
    session: staff,
    profile: 'mobile-390',
    label: 'tap open the mobile staff menu',
    expected: 'The staff menu opens beside its trigger and the Time Off item is visible inside the phone viewport.',
    action: () => harness.openStaffMenu(staff),
    see: async p => {
      const metrics = await p.locator('.staff-account-popover').evaluate(element => {
        const rect = element.getBoundingClientRect();
        const left = visualViewport?.offsetLeft || 0;
        const right = left + (visualViewport?.width || innerWidth);
        return { left: rect.left, right: rect.right, viewportLeft: left, viewportRight: right };
      });
      assert(await p.locator('#headerTimeOffMenuItem').isVisible(),
        'mobile staff menu visibly includes Time Off');
      assert(metrics.left >= metrics.viewportLeft && metrics.right <= metrics.viewportRight,
        'mobile staff menu stays inside the visual viewport');
    },
    target: '.staff-account-popover',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'mobile-390',
    label: 'tap Time Off in the mobile staff menu',
    expected: 'The balance, request form, history, and scrollable calendar fit the mobile viewport without page overflow.',
    action: () => harness.chooseStaffTimeOff(staff),
    see: async p => {
      const metrics = await p.evaluate(() => ({
        viewportLeft: visualViewport?.offsetLeft || 0,
        viewportWidth: visualViewport?.width || innerWidth,
        rootLeft: document.querySelector('.pto-wrap')?.getBoundingClientRect().left || 0,
        rootRight: document.querySelector('.pto-wrap')?.getBoundingClientRect().right || 0,
        offenders: [...document.querySelectorAll('.pto-wrap *')]
          .filter(element => !element.closest('.pto-table-scroll, .pto-calendar-scroll'))
          .filter(element => {
            const rect = element.getBoundingClientRect();
            const viewportLeft = visualViewport?.offsetLeft || 0;
            const viewportRight = viewportLeft + (visualViewport?.width || innerWidth);
            return rect.width > 0
              && (rect.left < viewportLeft - 2 || rect.right > viewportRight + 2);
          }).length,
      }));
      const viewportRight = metrics.viewportLeft + metrics.viewportWidth;
      assert(metrics.viewportWidth === 390
        && metrics.rootLeft >= metrics.viewportLeft - 1
        && metrics.rootRight <= viewportRight + 1
        && metrics.offenders === 0,
        'staff surface stays inside the 390px viewport');
    },
    target: '.pto-head',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'mobile-390',
    label: 'tap open the mobile request-type menu',
    expected: 'The branded type menu opens inside the 390px viewport without a native picker or clipping.',
    action: p => p.locator('#ptoRequestTypeBtn').tap(),
    see: async p => {
      assert(await p.locator('#ptoRequestTypeMenu').isVisible(), 'mobile branded type menu is visible');
      const rect = await p.locator('#ptoRequestTypeMenu').evaluate(element => element.getBoundingClientRect());
      assert(rect.left >= 0 && rect.right <= 390, 'mobile type menu stays inside the viewport');
    },
    target: '#ptoRequestTypeMenu',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'mobile-390',
    label: 'tap the mobile unpaid option',
    expected: 'Unpaid is selected and the touch menu closes cleanly.',
    action: p => p.locator('#ptoRequestTypeMenu [data-value="unpaid"]').tap(),
    see: async p => {
      assert(await p.locator('#ptoRequestType').inputValue() === 'unpaid',
        'mobile type selection stores Unpaid exactly');
      assert(await p.locator('#ptoRequestTypeBtn').getAttribute('aria-expanded') === 'false',
        'mobile type menu closes after selection');
    },
    target: '#ptoRequestTypeBtn',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'mobile-390',
    label: 'tap open the mobile date calendar',
    expected: 'The branded calendar opens as a touch-friendly, viewport-contained panel.',
    action: async p => {
      await p.locator('#ptoStartDateBtn').tap();
      await p.waitForSelector('#svDatePickerPopup');
    },
    see: async p => {
      const rect = await p.locator('#svDatePickerPopup').evaluate(element => element.getBoundingClientRect());
      const viewport = await p.evaluate(() => ({
        left: visualViewport?.offsetLeft || 0,
        top: visualViewport?.offsetTop || 0,
        right: (visualViewport?.offsetLeft || 0) + (visualViewport?.width || innerWidth),
        bottom: (visualViewport?.offsetTop || 0) + (visualViewport?.height || innerHeight),
      }));
      assert(rect.left >= viewport.left && rect.right <= viewport.right
        && rect.top >= viewport.top && rect.bottom <= viewport.bottom,
      'mobile calendar stays inside the visual viewport');
    },
    target: '#svDatePickerPopup',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'mobile-390',
    label: 'tap the mobile calendar next-month arrow',
    expected: 'The calendar advances one month and keeps its touch target and layout visible.',
    action: p => tapInVisualViewport(p, '#svDatePickerPopup [data-dp-nav="1"]'),
    see: async p => {
      assert((await p.locator('#svDatePickerPopup .dp-head-label').textContent()).trim() === 'May 2030',
        'mobile calendar advances to May 2030');
      assert(await p.locator(`#svDatePickerPopup [data-dp-day="${DATES.mobile}"]`).isVisible(),
        'mobile target date is visible in the active month');
      const rect = await p.locator('#svDatePickerPopup').evaluate(element => element.getBoundingClientRect());
      const viewport = await p.evaluate(() => ({
        left: visualViewport?.offsetLeft || 0,
        top: visualViewport?.offsetTop || 0,
        right: (visualViewport?.offsetLeft || 0) + (visualViewport?.width || innerWidth),
        bottom: (visualViewport?.offsetTop || 0) + (visualViewport?.height || innerHeight),
      }));
      assert(rect.left >= viewport.left && rect.right <= viewport.right
        && rect.top >= viewport.top && rect.bottom <= viewport.bottom,
      'calendar month navigation remains inside the current visual viewport');
    },
    target: '#svDatePickerPopup',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'mobile-390',
    label: 'tap the mobile request date',
    expected: 'The selected start day closes the calendar and appears in the branded field.',
    action: async p => {
      await tapInVisualViewport(p, `#svDatePickerPopup [data-dp-day="${DATES.mobile}"]`);
      await p.waitForSelector('#svDatePickerPopup', { state: 'detached' });
    },
    see: async p => {
      assert(await p.locator('#ptoStartDate').inputValue() === DATES.mobile,
        'mobile start date is selected exactly');
      assert(await p.locator('#ptoEndDate').inputValue() === '',
        'mobile end date remains an explicit human choice');
    },
    target: '#ptoStartDateBtn',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'mobile-390',
    label: 'tap open the mobile end-date calendar',
    expected: 'The end-date calendar opens in May with earlier dates disabled and remains inside the phone viewport.',
    action: async p => {
      await p.locator('#ptoEndDateBtn').tap();
      await p.waitForSelector('#svDatePickerPopup');
    },
    see: async p => {
      assert((await p.locator('#svDatePickerPopup .dp-head-label').textContent()).trim() === 'May 2030',
        'mobile end-date calendar opens in May 2030');
      assert(await p.locator('#svDatePickerPopup [data-dp-day="2030-05-07"]').isDisabled(),
        'mobile end-date calendar disables dates before the start');
      const rect = await p.locator('#svDatePickerPopup').evaluate(element => element.getBoundingClientRect());
      const viewport = await p.evaluate(() => ({
        left: visualViewport?.offsetLeft || 0,
        top: visualViewport?.offsetTop || 0,
        right: (visualViewport?.offsetLeft || 0) + (visualViewport?.width || innerWidth),
        bottom: (visualViewport?.offsetTop || 0) + (visualViewport?.height || innerHeight),
      }));
      assert(rect.left >= viewport.left && rect.right <= viewport.right
        && rect.top >= viewport.top && rect.bottom <= viewport.bottom,
      'mobile end-date calendar stays inside the visual viewport');
    },
    target: '#svDatePickerPopup',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'mobile-390',
    label: 'tap the matching mobile end date',
    expected: 'The matching end date closes the calendar and produces the exact one-day quote.',
    action: async p => {
      await tapInVisualViewport(p, `#svDatePickerPopup [data-dp-day="${DATES.mobile}"]`);
      await p.waitForSelector('#svDatePickerPopup', { state: 'detached' });
      await p.waitForFunction(() => document.getElementById('ptoDays')?.value === '1');
    },
    see: async p => {
      assert(await p.locator('#ptoEndDate').inputValue() === DATES.mobile,
        'mobile end date is selected exactly');
      assert(await p.locator('#ptoDays').inputValue() === '1',
        'matching mobile dates visibly quote one business day');
    },
    target: '#ptoDaysWrap',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'mobile-390',
    label: 'tap the mobile half-day arrow',
    expected: 'The touch-friendly down arrow visibly changes the one-day quote to a half day.',
    action: p => p.locator('#ptoDaysDown').tap(),
    see: async p => {
      assert(Number(await p.locator('#ptoDays').inputValue()) === 0.5,
        'mobile decrement changes the quote to a half day');
    },
    target: '#ptoDaysWrap',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'mobile-390',
    label: 'tap the mobile full-day arrow',
    expected: 'The touch-friendly up arrow visibly restores the full one-day quote.',
    action: p => p.locator('#ptoDaysUp').tap(),
    see: async p => {
      assert(Number(await p.locator('#ptoDays').inputValue()) === 1,
        'mobile increment restores the full day');
    },
    target: '#ptoDaysWrap',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'mobile-390',
    label: 'enter the mobile request note',
    expected: 'The mobile note field accepts the request context without horizontal overflow.',
    action: p => p.locator('#ptoNote').fill(mobileRequest.note),
    see: async p => {
      assert(await p.locator('#ptoNote').inputValue() === mobileRequest.note,
        'mobile request note is retained exactly');
    },
    target: '#ptoNote',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'mobile-390',
    label: 'submit mobile unpaid request',
    expected: 'The branded mobile controls submit one unpaid request and the Pending row is readable without native widgets.',
    action: async p => {
      await p.locator('#ptoSubmit').tap();
      await p.waitForFunction(() => {
        const button = document.getElementById('ptoSubmit');
        return button && !/sending/i.test(String(button.textContent || ''));
      }, null, { timeout: 30000 });
    },
    see: async p => {
      await waitStaffReady(p);
      await requestRow(p, { ...mobileRequest, status: 'pending' });
      exactBackendRequest(backend, { ...mobileRequest, status: 'pending' });
      assert(await p.locator('.pto-wrap select').count() === 0, 'mobile PTO has no native select');
    },
    target: staffRequestRowLocator(page, { ...mobileRequest, status: 'pending' }),
  });

  await harness.step({
    scenario,
    session: admin,
    profile: 'mobile-390',
    label: 'Kasper approves on mobile',
    expected: 'Kasper reviews and approves the mobile request with controls contained at 390px.',
    action: async p => {
      await harness.openAdmin(admin);
      await approvePending(p, {
        memberName: staffName,
        note: mobileRequest.note,
        typeLabel: mobileRequest.typeLabel,
        start: mobileRequest.start,
        end: mobileRequest.end,
      }, 'TEST mobile approval');
    },
    see: async p => {
      assert(await upcomingAdminRowLocator(p, {
        memberName: staffName,
        typeLabel: mobileRequest.typeLabel,
        start: mobileRequest.start,
        end: mobileRequest.end,
      }).count() === 1,
        'mobile approval is visible in upcoming leave');
      exactBackendRequest(backend, {
        ...mobileRequest,
        status: 'approved',
        decisionNote: 'TEST mobile approval',
      });
      const right = await p.locator('#kasperContent').evaluate(element => element.getBoundingClientRect().right);
      assert(right <= 391, 'Kasper content stays inside 390px');
    },
    target: '.pto-upcoming-list',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'mobile-390',
    label: 'mobile staff sees approved result',
    expected: 'After Refresh, the mobile history shows Approved and unpaid leave leaves paid balances unchanged.',
    action: refreshStaff,
    see: async p => {
      await requestRow(p, {
        ...mobileRequest,
        status: 'approved',
        decisionNote: 'TEST mobile approval',
      });
      await wellnessVisible(p, 3.5);
    },
    target: staffRequestRowLocator(page, {
      ...mobileRequest,
      status: 'approved',
      decisionNote: 'TEST mobile approval',
    }),
  });
  coverage.add('mobile_390');
}

async function runKeyboardJourney(harness, sessions, coverage) {
  const { backend } = harness;
  const staff = sessions.keyboard;
  const page = harness.page(staff);
  const admin = sessions.keyboardAdmin;
  const adminPage = harness.page(admin);
  const staffName = backend.personas.staffA.member.name;
  const scenario = 'keyboard-only-journey';
  const keyboardRequest = {
    memberId: backend.personas.staffA.member.id,
    type: 'unpaid',
    typeLabel: 'Unpaid',
    start: DATES.keyboard,
    end: DATES.keyboard,
    days: 1,
    note: 'TEST keyboard-only journey',
  };
  const keyboardRow = staffRequestRowLocator(page, keyboardRequest);

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard enters Time Off and reaches request type',
    expected: 'Tab and Enter open the staff menu route, then natural tab order reaches the request-type control with a visible focus ring.',
    action: async p => {
      await harness.openStaff(staff, p, { keyboard: true });
      await tabTo(p, '#ptoRequestTypeBtn');
    },
    see: async p => {
      assert(await p.evaluate(() => document.activeElement?.matches('#ptoRequestTypeBtn:focus-visible')),
        'request-type button has visible keyboard focus');
    },
    target: '#ptoRequestTypeBtn',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard opens request-type menu',
    expected: 'Enter opens the branded option list and keeps focus inside the custom control.',
    action: p => p.keyboard.press('Enter'),
    see: async p => {
      assert(await p.locator('#ptoRequestTypeMenu').isVisible(), 'keyboard-opened type menu is visible');
      assert(await p.locator('#ptoRequestTypeBtn').getAttribute('aria-expanded') === 'true',
        'keyboard-opened type menu reports expanded state');
    },
    target: '#ptoRequestTypeMenu',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard focuses unpaid option',
    expected: 'End moves the visible focus ring to the Unpaid option without selecting it prematurely.',
    action: p => p.keyboard.press('End'),
    see: async p => {
      assert(await p.evaluate(() => document.activeElement?.matches(
        '#ptoRequestTypeMenu [data-value="unpaid"]:focus-visible',
      )), 'Unpaid option has visible keyboard focus');
    },
    target: '#ptoRequestTypeMenu [data-value="unpaid"]',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard selects unpaid type',
    expected: 'Enter selects Unpaid and closes the branded list.',
    action: p => p.keyboard.press('Enter'),
    see: async p => {
      assert(await p.locator('#ptoRequestType').inputValue() === 'unpaid',
        'keyboard type selection stores Unpaid');
      assert(await p.locator('#ptoRequestTypeBtn').getAttribute('aria-expanded') === 'false',
        'type menu closes after keyboard selection');
    },
    target: '#ptoRequestTypeBtn',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard reaches start-date control',
    expected: 'Natural Tab order reaches the branded start-date button with a visible focus ring.',
    action: p => tabTo(p, '#ptoStartDateBtn'),
    see: async p => {
      assert(await p.evaluate(() => document.activeElement?.matches('#ptoStartDateBtn:focus-visible')),
        'start-date button has visible keyboard focus');
    },
    target: '#ptoStartDateBtn',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard opens start-date calendar',
    expected: 'Enter opens the branded calendar and visibly focuses a date.',
    action: p => p.keyboard.press('Enter'),
    see: async p => {
      assert(await p.locator('#svDatePickerPopup').isVisible(), 'keyboard-opened start calendar is visible');
      assert(await p.evaluate(() => document.activeElement?.matches(
        '#svDatePickerPopup [data-dp-day]:focus-visible',
      )), 'a calendar day has visible keyboard focus');
    },
    target: '#svDatePickerPopup',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard chooses start date',
    expected: 'Arrow/Page navigation and Enter select the exact start date and close the calendar.',
    action: p => chooseDateWithKeyboard(p, DATES.keyboard),
    see: async p => {
      assert(await p.locator('#ptoStartDate').inputValue() === DATES.keyboard,
        'keyboard start date is selected exactly');
    },
    target: '#ptoStartDateBtn',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard reaches end-date control',
    expected: 'Natural Tab order reaches the branded end-date button with a visible focus ring.',
    action: p => tabTo(p, '#ptoEndDateBtn'),
    see: async p => {
      assert(await p.evaluate(() => document.activeElement?.matches('#ptoEndDateBtn:focus-visible')),
        'end-date button has visible keyboard focus');
    },
    target: '#ptoEndDateBtn',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard opens end-date calendar',
    expected: 'Enter opens the end-date calendar without losing visible keyboard focus.',
    action: p => p.keyboard.press('Enter'),
    see: async p => {
      assert(await p.locator('#svDatePickerPopup').isVisible(), 'keyboard-opened end calendar is visible');
      assert(await p.evaluate(() => document.activeElement?.matches(
        '#svDatePickerPopup [data-dp-day]:focus-visible',
      )), 'end calendar exposes visible keyboard focus');
    },
    target: '#svDatePickerPopup',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard chooses end date',
    expected: 'Enter chooses the exact end date and the one-day quote becomes available.',
    action: async p => {
      await chooseDateWithKeyboard(p, DATES.keyboard);
      await p.waitForFunction(() => document.getElementById('ptoDays')?.value === '1');
    },
    see: async p => {
      assert(await p.locator('#ptoEndDate').inputValue() === DATES.keyboard,
        'keyboard end date is selected exactly');
      assert(Number(await p.locator('#ptoDays').inputValue()) === 1,
        'keyboard date range produces a one-day quote');
    },
    target: '#ptoDaysWrap',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard reaches request note',
    expected: 'Natural Tab order reaches the note field with a visible focus ring.',
    action: p => tabTo(p, '#ptoNote'),
    see: async p => {
      assert(await p.evaluate(() => document.activeElement?.matches('#ptoNote:focus-visible')),
        'request note has visible keyboard focus');
    },
    target: '#ptoNote',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard types request note',
    expected: 'Typing visibly fills the note field without moving focus.',
    action: p => p.keyboard.type(keyboardRequest.note),
    see: async p => {
      assert(await p.locator('#ptoNote').inputValue() === keyboardRequest.note,
        'keyboard request note is retained exactly');
    },
    target: '#ptoNote',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard reaches send button',
    expected: 'Natural Tab order reaches Send request with a visible focus ring.',
    action: p => tabTo(p, '#ptoSubmit'),
    see: async p => {
      assert(await p.evaluate(() => document.activeElement?.matches('#ptoSubmit:focus-visible')),
        'send button has visible keyboard focus');
    },
    target: '#ptoSubmit',
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard submits request',
    expected: 'Enter sends exactly one request and lands on a visible Pending row.',
    action: async p => {
      await p.keyboard.press('Enter');
      await waitStaffReady(p);
    },
    see: async p => {
      await requestRow(p, { ...keyboardRequest, status: 'pending' });
      exactBackendRequest(backend, { ...keyboardRequest, status: 'pending' });
    },
    target: keyboardRow,
  });

  await harness.step({
    scenario,
    session: admin,
    profile: 'keyboard-only',
    label: 'keyboard enters Kasper decision note',
    expected: 'Tab and Enter open Kasper Time Off, then natural tab order reaches the exact request note with visible focus.',
    action: async p => {
      await harness.openAdmin(admin, p, { keyboard: true });
      const card = await pendingAdminCard(p, {
        memberName: staffName,
        note: keyboardRequest.note,
        typeLabel: keyboardRequest.typeLabel,
        start: keyboardRequest.start,
        end: keyboardRequest.end,
      });
      await card.evaluate(element => { element.dataset.lifecycleKeyboardTarget = 'true'; });
      await tabTo(p, '[data-lifecycle-keyboard-target="true"] [data-pto-decision-note]');
    },
    see: async p => {
      assert(await p.evaluate(() => document.activeElement?.matches(
        '[data-lifecycle-keyboard-target="true"] [data-pto-decision-note]:focus-visible',
      )), 'Kasper decision note has visible keyboard focus');
    },
    target: '[data-lifecycle-keyboard-target="true"] [data-pto-decision-note]',
  });

  await harness.step({
    scenario,
    session: admin,
    profile: 'keyboard-only',
    label: 'keyboard types decision note',
    expected: 'Typing visibly fills the exact Kasper decision-note field without changing state.',
    action: p => p.keyboard.type('TEST keyboard decision'),
    see: async p => {
      assert(await p.locator(
        '[data-lifecycle-keyboard-target="true"] [data-pto-decision-note]',
      ).inputValue() === 'TEST keyboard decision', 'keyboard decision note is retained exactly');
    },
    target: '[data-lifecycle-keyboard-target="true"] [data-pto-decision-note]',
  });

  await harness.step({
    scenario,
    session: admin,
    profile: 'keyboard-only',
    label: 'keyboard reaches Approve',
    expected: 'Tab reaches Approve with a visible focus ring and does not decide yet.',
    action: p => p.keyboard.press('Tab'),
    see: async p => {
      assert(await p.evaluate(() => document.activeElement?.matches(
        '[data-lifecycle-keyboard-target="true"] button.approve:focus-visible',
      )), 'Tab reaches Approve with a visible focus affordance');
    },
    target: '[data-lifecycle-keyboard-target="true"] button.approve',
  });

  await harness.step({
    scenario,
    session: admin,
    profile: 'keyboard-only',
    label: 'keyboard reaches Deny',
    expected: 'A second Tab reaches the distinct Deny action with a visible focus ring.',
    action: p => p.keyboard.press('Tab'),
    see: async p => {
      assert(await p.evaluate(() => document.activeElement?.matches(
        '[data-lifecycle-keyboard-target="true"] button.deny:focus-visible',
      )), 'Tab reaches Deny with a visible focus affordance');
    },
    target: '[data-lifecycle-keyboard-target="true"] button.deny',
  });

  await harness.step({
    scenario,
    session: admin,
    profile: 'keyboard-only',
    label: 'keyboard denies request',
    expected: 'Enter saves exactly one denial and the Recent Decisions count updates.',
    action: async p => {
      await p.keyboard.press('Enter');
      await waitAdminReady(p);
    },
    see: async p => {
      exactBackendRequest(backend, {
        ...keyboardRequest,
        status: 'denied',
        decisionNote: 'TEST keyboard decision',
      });
      assert(await p.locator('.pto-admin-history summary').isVisible(),
        'Recent Decisions summary remains visible after denial');
    },
    target: '.pto-admin-history summary',
  });

  await harness.step({
    scenario,
    session: admin,
    profile: 'keyboard-only',
    label: 'keyboard opens recent decision',
    expected: 'Tab and Enter expand Recent Decisions and reveal the exact denied request and note.',
    action: async p => {
      await tabTo(p, '.pto-admin-history summary');
      await p.keyboard.press('Enter');
    },
    see: async p => {
      const history = p.locator('.pto-history-row')
        .filter({ hasText: staffName })
        .filter({ hasText: 'Unpaid' })
        .filter({ hasText: 'May 9' })
        .filter({ hasText: /denied/i })
        .filter({ hasText: 'TEST keyboard decision' });
      assert(await history.count() === 1, 'exact keyboard decision appears once in Recent Decisions');
    },
    target: adminPage.locator('.pto-history-row')
      .filter({ hasText: staffName })
      .filter({ hasText: 'Unpaid' })
      .filter({ hasText: 'May 9' }),
  });

  await harness.step({
    scenario,
    session: staff,
    profile: 'keyboard-only',
    label: 'keyboard staff sees denial',
    expected: 'After a keyboard-activated Refresh, the staff history shows the Denied result and decision note.',
    action: async p => {
      await tabTo(p, '#ptoRefresh');
      await p.keyboard.press('Enter');
      await waitStaffReady(p);
    },
    see: async p => {
      const row = await requestRow(p, {
        ...keyboardRequest,
        status: 'denied',
        decisionNote: 'TEST keyboard decision',
      });
      assert(cleanText(await row.textContent()).includes('TEST keyboard decision'),
        'keyboard decision note is visible to staff');
    },
    target: staffRequestRowLocator(page, {
      ...keyboardRequest,
      status: 'denied',
      decisionNote: 'TEST keyboard decision',
    }),
  });
  coverage.add('keyboard_only');
}

async function runMockedScenarios(harness) {
  const coverage = coverageSet();
  const staffA = await harness.createSession('staffA');
  const staffB = await harness.createSession('staffB');
  const admin = await harness.createSession('admin');
  const sessions = { staffA, staffB, admin };

  await runDesktopLifecycle(harness, sessions, coverage);
  await runResilience(harness, sessions, coverage);
  await runTimeTravel(harness, sessions, coverage);

  sessions.mobile = await harness.createSession('staffA', {
    sessionKey: 'staffA-mobile',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  sessions.mobileAdmin = await harness.createSession('admin', {
    sessionKey: 'admin-mobile',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await runMobileJourney(harness, sessions, coverage);

  sessions.keyboard = await harness.createSession('staffA', { sessionKey: 'staffA-keyboard' });
  sessions.keyboardAdmin = await harness.createSession('admin', { sessionKey: 'admin-keyboard' });
  await runKeyboardJourney(harness, sessions, coverage);

  coverage.assertComplete();
  harness.assertClean();
  return {
    coverage: [...coverage.covered].sort(),
    requiredCoverage: [...REQUIRED_COVERAGE],
  };
}

module.exports = {
  DATES,
  REQUIRED_COVERAGE,
  runMockedScenarios,
};

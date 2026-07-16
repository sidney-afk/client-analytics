'use strict';

// Browser contract for the staff Time Off page and Kasper's Time Off subtab.
// Every identity, date, balance, and request below is an obviously synthetic
// TEST fixture. All external requests are intercepted; this suite never reads
// or writes live HR data.
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const { serveStatic } = require('./prod-test-utils');

const AS_OF = '2030-04-10';
const ADMIN = Object.freeze({
  id: '00000000-0000-4000-8000-000000000101',
  name: 'TEST Browser Administrator',
  role: 'admin',
  team: 'TEST',
  active: true,
});
const MEMBER = Object.freeze({
  id: '00000000-0000-4000-8000-000000000102',
  name: 'TEST Browser Teammate',
  role: 'creative',
  team: 'TEST',
  active: true,
});
const FUTURE_MEMBER_NAME = 'TEST Future Leave Fixture';
const ADMIN_KEY = 'test-browser-admin-role-key';
const MEMBER_KEY = 'test-browser-creative-role-key';

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log('PASS ' + message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function assertNoSeriousAxe(page, selector, label) {
  let builder = new AxeBuilder({ page });
  for (const include of (Array.isArray(selector) ? selector : [selector])) builder = builder.include(include);
  const result = await builder.analyze();
  const serious = result.violations.filter(violation => ['serious', 'critical'].includes(violation.impact));
  const summary = serious.map(violation => `${violation.id} (${violation.nodes.length}: ${violation.nodes.map(node => node.target.join(' ')).join(' | ')})`).join(', ');
  assert(serious.length === 0, `${label} has no serious or critical Axe violations${summary ? ': ' + summary : ''}`);
}

async function waitForFixture(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  if (!predicate()) throw new Error(`Timed out waiting for ${label}`);
}

function initialOverview() {
  return {
    ok: true,
    as_of_date: AS_OF,
    holiday_date_min: '2029-01-01',
    holiday_date_max: '2031-12-31',
    pto_enabled: true,
    balance: {
      pto_enabled: true,
      pto_start_date: '2029-05-01',
      eligibility_date: '2029-06-30',
      eligible: true,
      wellness_granted: 6,
      wellness_approved_used: 1,
      wellness_adjustment: 0.5,
      wellness_available: 5.5,
      sick_approved_used: 1,
      sick_adjustment: 0,
      sick_available: 2,
      floating_holiday_used: false,
      floating_holiday_pending: true,
      floating_holiday_status: 'pending',
      next_accrual_date: '2030-05-01',
      leave_year_start: '2029-05-01',
      leave_year_end: '2030-04-30',
    },
    holidays: [{ observed_date: '2030-04-19', name: 'TEST observed holiday' }],
    members: [
      { name: ADMIN.name, wellness_available: 5.5, on_leave_today: false },
      { name: MEMBER.name, wellness_available: 4, on_leave_today: false },
    ],
    absences: [{
      member_name: FUTURE_MEMBER_NAME,
      start_date: '2030-05-20',
      end_date: '2030-05-21',
    }],
    my_requests: [],
    pending_requests: [{
      id: 'test-existing-pending',
      member_id: MEMBER.id,
      member_name: MEMBER.name,
      type: 'sick',
      start_date: '2030-04-09',
      end_date: '2030-04-09',
      days: 1,
      status: 'pending',
      note: 'TEST fixture request',
      requested_at: '2030-04-09T12:00:00.000Z',
    }],
    upcoming_approved_requests: [{
      id: 'test-future-approved',
      member_id: MEMBER.id,
      member_name: FUTURE_MEMBER_NAME,
      type: 'wellness',
      start_date: '2030-05-20',
      end_date: '2030-05-21',
      days: 2,
      status: 'approved',
      decided_by: ADMIN.name,
      decided_at: '2030-04-08T12:00:00.000Z',
    }],
    recent_requests: [],
    admin_members: [
      {
        member_id: ADMIN.id,
        name: ADMIN.name,
        role: 'admin',
        team: 'video',
        pto_start_date: '2029-01-15',
        pto_enabled: true,
        wellness_granted: 6,
        wellness_approved_used: 1,
        wellness_adjustment: 0.5,
        wellness_available: 5.5,
        sick_available: 2,
      },
      {
        member_id: MEMBER.id,
        name: MEMBER.name,
        role: 'designer',
        team: 'graphics',
        pto_start_date: '2029-02-15',
        pto_enabled: true,
        wellness_granted: 5,
        wellness_approved_used: 1,
        wellness_adjustment: 0,
        wellness_available: 4,
        sick_available: 3,
      },
      {
        member_id: '00000000-0000-4000-8000-000000000103',
        name: ADMIN.name,
        role: 'smm',
        team: 'video',
        pto_start_date: null,
        pto_enabled: false,
        wellness_granted: 0,
        wellness_approved_used: 0,
        wellness_adjustment: 0,
        wellness_available: 0,
        sick_available: 0,
      },
    ],
  };
}

async function installFixture(page, state) {
  await page.addInitScript(({ identity, key }) => {
    localStorage.setItem('syncview_auth_v1', 'ok');
    localStorage.removeItem('syncview_theme');
    localStorage.setItem('syncview_staff_identity_v1', JSON.stringify({
      key,
      role: identity.role,
      member: identity,
      verified_at: '2030-04-10T12:00:00.000Z',
    }));
    sessionStorage.setItem('syncview_kasper_unlocked', 'ok');
  }, { identity: ADMIN, key: ADMIN_KEY });

  await page.route('**/*', async route => {
    const request = route.request();
    const url = request.url();
    if (/^https?:\/\/127\.0\.0\.1(?::\d+)?\//.test(url)) return route.continue();

    const parsed = new URL(url);
    const headers = request.headers();
    let body = null;
    try { body = request.postDataJSON(); } catch (_) {}

    if (parsed.pathname.endsWith('/rest/v1/syncview_runtime_flags')) {
      state.runtimeFlagReads++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ value: { mode: 'on' } }]) });
    }
    if (parsed.pathname.endsWith('/rest/v1/team_members')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([ADMIN, MEMBER]) });
    }
    if (parsed.pathname.endsWith('/functions/v1/key-verify')) {
      state.keyVerifyCalls.push({ headers, body });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, mode: 'permissive', role: 'admin', member: ADMIN }),
      });
    }
    if (parsed.pathname.endsWith('/functions/v1/pto')) {
      const action = String(parsed.searchParams.get('action') || (body && body.action) || '');
      state.ptoCalls.push({ action, method: request.method(), headers, body: clone(body || {}) });
      if (action === 'overview') {
        if (state.failNextOverview) {
          state.failNextOverview = false;
          return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'test_overview_unavailable' }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(clone(state.overview)) });
      }
      if (action === 'quote') {
        if (body.start_date === '2033-01-03') {
          await new Promise(resolve => setTimeout(resolve, 120));
        }
        if (body.start_date === '2033-01-08') {
          return route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ ok: false, error: 'request_range_too_long' }),
          });
        }
        const start = new Date(body.start_date + 'T12:00:00Z');
        const end = new Date(body.end_date + 'T12:00:00Z');
        let fullDays = 0;
        for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
          if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) fullDays++;
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, full_days: fullDays, partial_day_count: Math.max(0.5, fullDays - 0.5) }),
        });
      }
      if (action === 'request') {
        const row = {
          id: `test-browser-request-${++state.requestSequence}`,
          member_id: body.member_id,
          member_name: body.member_id === MEMBER.id ? MEMBER.name : ADMIN.name,
          type: body.type,
          start_date: body.start_date,
          end_date: body.end_date,
          days: Number(body.days),
          status: 'pending',
          note: body.note || '',
          requested_at: '2030-04-10T13:00:00.000Z',
        };
        state.overview.my_requests.unshift(row);
        state.overview.pending_requests.push(row);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, request: row }) });
      }
      if (action === 'decide') {
        const index = state.overview.pending_requests.findIndex(row => row.id === body.request_id);
        const row = index >= 0 ? state.overview.pending_requests.splice(index, 1)[0] : null;
        if (row) {
          row.status = body.decision;
          row.decided_by = ADMIN.name;
          row.decided_at = '2030-04-10T14:00:00.000Z';
          const mine = state.overview.my_requests.find(item => item.id === row.id);
          if (mine) Object.assign(mine, row);
          if (body.decision === 'approved') state.overview.upcoming_approved_requests.push(row);
          state.overview.recent_requests.unshift(row);
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, request: row }) });
      }
      if (action === 'cancel') {
        const index = state.overview.upcoming_approved_requests.findIndex(row => row.id === body.request_id);
        const row = index >= 0 ? state.overview.upcoming_approved_requests.splice(index, 1)[0] : null;
        if (row) {
          row.status = 'cancelled';
          row.cancelled_by = ADMIN.name;
          row.cancelled_at = '2030-04-10T15:00:00.000Z';
          state.overview.recent_requests.unshift(row);
          state.overview.absences = state.overview.absences.filter(item => !(
            item.member_name === row.member_name && item.start_date === row.start_date && item.end_date === row.end_date
          ));
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, request: row }) });
      }
      if (action === 'adjust' || action === 'set_start_date') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      }
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'unexpected_test_action' }) });
    }

    // The single-file app primes other read-only surfaces during boot. Keep the
    // test hermetic with inert responses; any unrelated external write is a bug.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      state.unexpectedWrites.push({ url, method: request.method() });
    }
    if (parsed.pathname.includes('/rest/v1/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (parsed.hostname.includes('docs.google.com') || parsed.hostname.includes('script.google.com')) {
      return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    }
    if (request.resourceType() === 'font' || request.resourceType() === 'stylesheet' || request.resourceType() === 'script' || request.resourceType() === 'image') {
      return route.abort();
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function openStaffTimeOff(page, port) {
  await page.goto(`http://127.0.0.1:${port}/#time-off`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navTo === 'function' && typeof window._ptoSetFlagValue === 'function');
  await page.evaluate(identity => {
    _syncviewStaffIdentityVerified = true;
    _syncviewStaffIdentitySave({ key: 'test-browser-admin-role-key', role: 'admin', member: identity, verified_at: '2030-04-10T12:00:00.000Z' });
    _ptoSetFlagValue({ mode: 'on' });
    navTo('time-off', false);
  }, ADMIN);
  await page.waitForFunction(() => typeof _ptoState !== 'undefined'
    && !!_ptoState.overview && !_ptoState.loading && !!document.getElementById('ptoRequestTypeBtn'), null, { timeout: 15000 });
  // Direct #time-off restoration and the explicit test mount can overlap by
  // one paint while boot verification settles. Two frames make subsequent
  // focus assertions target the final DOM node, not a soon-to-be-replaced one.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function nativeControlAudit(page, rootSelector) {
  return page.locator(rootSelector).evaluate(root => {
    const visible = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0.01 && style.pointerEvents !== 'none';
    };
    const dates = [...root.querySelectorAll('input[type="date"]')];
    const numbers = [...root.querySelectorAll('input[type="number"]')];
    const spinnerRule = [...document.styleSheets].some(sheet => {
      let rules = [];
      try { rules = [...(sheet.cssRules || [])]; } catch (_) { return false; }
      return rules.some(rule => String(rule.selectorText || '').includes('.sv-stepper-input::-webkit-inner-spin-button')
        && String(rule.style && (rule.style.webkitAppearance || rule.style.getPropertyValue('-webkit-appearance')) || '') === 'none');
    });
    return {
      selects: root.querySelectorAll('select').length,
      visibleDates: dates.filter(visible).length,
      badDateContract: dates.filter(input => input.getAttribute('aria-hidden') !== 'true'
        || input.tabIndex !== -1 || !input.closest('[data-sv-date-picker]')).length,
      rogueNumbers: numbers.filter(input => !input.classList.contains('sv-stepper-input') || !input.closest('.sv-stepper')).length,
      badSteppers: numbers.filter(input => {
        const wrap = input.closest('.sv-stepper');
        return !wrap || !wrap.querySelector('.sv-stepper-btn[id$="Down"]') || !wrap.querySelector('.sv-stepper-btn[id$="Up"]');
      }).length,
      spinnerRule,
    };
  });
}

async function assertNoGlobalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    contentRight: document.getElementById('content')?.getBoundingClientRect().right || 0,
    offenders: [...document.querySelectorAll('body *')].filter(element => !element.closest('#headerNav, .pto-table-scroll, .pto-calendar-scroll, .kasper-subtabs')).map(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { tag: element.tagName, id: element.id, cls: String(element.className || '').slice(0, 90), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), overflowX: style.overflowX };
    }).filter(item => item.right > window.innerWidth + 2 && item.width > 0).sort((a, b) => b.right - a.right).slice(0, 10),
  }));
  // The existing header is intentionally a horizontally scrollable nav rail,
  // and PTO tables have their own scroll containers. Check the new page and
  // controls rather than treating those contained rails as body overflow.
  const contained = metrics.contentRight <= metrics.viewport + 1 && metrics.offenders.length === 0;
  assert(contained, contained
    ? `${label} stays inside the mobile viewport`
    : `${label} stays inside the mobile viewport (${JSON.stringify(metrics)})`);
}

(async () => {
  const state = {
    overview: initialOverview(),
    runtimeFlagReads: 0,
    keyVerifyCalls: [],
    ptoCalls: [],
    unexpectedWrites: [],
    requestSequence: 0,
    failNextOverview: false,
  };
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 980 }, colorScheme: 'light' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installFixture(page, state);

  try {
    await openStaffTimeOff(page, port);
    await waitForFixture(() => state.runtimeFlagReads > 0, 'mocked pto_v1 read');
    await waitForFixture(() => state.keyVerifyCalls.length > 0, 'mocked key verification');
    assert(state.runtimeFlagReads > 0, 'staff surface reads the mocked pto_v1 runtime flag');
    assert(state.keyVerifyCalls.length > 0 && state.keyVerifyCalls[0].headers['x-syncview-key'] === ADMIN_KEY,
      'saved synthetic staff identity is verified through the mocked key verifier');

    const staffNative = await nativeControlAudit(page, '.pto-wrap');
    assert(staffNative.selects === 0 && staffNative.visibleDates === 0 && staffNative.badDateContract === 0
      && staffNative.rogueNumbers === 0 && staffNative.badSteppers === 0 && staffNative.spinnerRule,
    'staff form exposes no browser-native select, calendar, or spinner chrome');
    await assertNoSeriousAxe(page, '.pto-wrap', 'staff Time Off');
    assert((await page.locator('.pto-empty', { hasText: 'No requests yet' }).count()) === 1,
      'staff request history has a clear empty state');
    await page.locator('#ptoRequestForm').evaluate(form => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })));
    assert((await page.locator('#ptoFormError').textContent()).includes('valid start and end date')
      && await page.locator('#ptoStartDateBtn').getAttribute('aria-invalid') === 'true'
      && (await page.locator('#ptoStartDateBtn').getAttribute('aria-describedby') || '').includes('ptoFormError')
      && await page.evaluate(() => document.activeElement?.id) === 'ptoStartDateBtn',
    'staff validation describes, marks, and focuses the first invalid branded control');

    // The date picker is shared with the editable Content Calendar. Exercise
    // that original markup contract without loading or mutating Calendar data.
    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'testSharedCalendarDate';
      fixture.className = 'cal-fld-date-wrap';
      fixture.style.cssText = 'position:fixed;top:80px;left:20px;width:220px;z-index:2000';
      fixture.innerHTML = '<div class="cal-date-chip">TEST calendar date</div><input type="date" value="2030-04-10">';
      fixture.querySelector('input').addEventListener('change', () => { fixture.dataset.changes = String(Number(fixture.dataset.changes || 0) + 1); });
      document.body.appendChild(fixture);
    });
    await page.locator('#testSharedCalendarDate .cal-date-chip').click();
    await assertNoSeriousAxe(page, ['#testSharedCalendarDate .cal-date-chip', '#svDatePickerPopup'], 'shared Calendar date trigger and popup');
    await page.locator('[data-dp-day="2030-04-12"]').click();
    assert(await page.locator('#testSharedCalendarDate input').inputValue() === '2030-04-12'
      && await page.locator('#testSharedCalendarDate').getAttribute('data-changes') === '1',
    'shared picker updates an editable Calendar date and dispatches one change');
    await page.locator('#testSharedCalendarDate .cal-date-chip').click();
    await page.locator('[data-dp-act="clear"]').click();
    assert(await page.locator('#testSharedCalendarDate input').inputValue() === ''
      && await page.locator('#testSharedCalendarDate').getAttribute('data-changes') === '2',
    'shared Calendar date Clear uses the same change plumbing');
    await page.locator('#testSharedCalendarDate').evaluate(fixture => fixture.classList.add('is-readonly'));
    await page.locator('#testSharedCalendarDate .cal-date-chip').click();
    assert(await page.locator('#svDatePickerPopup').count() === 0, 'readonly Calendar date cannot open the shared picker');
    await page.locator('#testSharedCalendarDate').evaluate(fixture => fixture.remove());

    // Custom select: disabled option, full keyboard path, and Escape focus return.
    await page.locator('#ptoRequestTypeBtn').click();
    assert(await page.locator('#ptoRequestTypeBtn').getAttribute('aria-expanded') === 'true', 'staff request type opens as a branded listbox');
    const disabledFloating = page.locator('#ptoRequestTypeMenu [data-value="floating_holiday"]');
    assert(await disabledFloating.getAttribute('aria-disabled') === 'true', 'unavailable floating holiday is exposed as a disabled custom option');
    await disabledFloating.dispatchEvent('click');
    assert(await page.locator('#ptoRequestType').inputValue() === 'wellness'
      && await page.locator('#ptoRequestTypeBtn').getAttribute('aria-expanded') === 'true',
    'clicking a disabled custom option cannot change or close the staff control');
    await page.keyboard.press('Escape');
    assert(await page.locator('#ptoRequestTypeBtn').getAttribute('aria-expanded') === 'false'
      && await page.evaluate(() => document.activeElement?.id) === 'ptoRequestTypeBtn',
    'Escape closes the staff dropdown and restores trigger focus');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert(await page.locator('#ptoRequestType').inputValue() === 'sick', 'arrow keys and Enter select a staff request type');
    await page.locator('#ptoRequestTypeBtn').click();
    await page.locator('#ptoRequestTypeMenu [data-value="wellness"]').click();

    // Help text is available to keyboard users through the styled global tip.
    const infoTip = page.locator('.pto-card .sv-info').first();
    const focusTip = await infoTip.evaluate(element => {
      // focusin paints the shared tooltip synchronously. Read it in this same
      // browser task so a legitimate later refresh cannot replace the card in
      // the one-instruction gap between focus() and a second locator query.
      element.focus();
      const tip = document.querySelector('.global-tip');
      return {
        active: document.activeElement === element,
        text: String(tip && tip.textContent || '').trim(),
        visible: !!(tip && tip.getClientRects().length),
      };
    });
    assert(focusTip.active && focusTip.visible && focusTip.text.length > 20 && !/undefined|null/i.test(focusTip.text),
      'focused help icon shows a plain-English styled tooltip');
    await page.keyboard.press('Escape');
    assert(await page.locator('.global-tip').count() === 0, 'Escape dismisses the focus tooltip');

    // Styled date picker derives today/min/max from the server-provided as-of date.
    assert(await page.locator('#ptoStartDate').getAttribute('min') === '2030-04-11'
      && await page.locator('#ptoStartDate').getAttribute('max') === '',
    'staff start bound follows the server date without blocking a later anniversary year');
    await page.locator('#ptoStartDateBtn').click();
    await page.waitForSelector('#svDatePickerPopup');
    await assertNoSeriousAxe(page, '#svDatePickerPopup', 'custom date picker');
    assert(await page.locator('[data-dp-day="2030-04-10"]').isDisabled()
      && !(await page.locator('[data-dp-day="2030-04-11"]').isDisabled())
      && !(await page.locator('[data-dp-day="2030-05-01"]').isDisabled()),
    'custom start calendar blocks past dates while allowing the next leave year');
    assert(await page.locator('[data-dp-act="today"]').isDisabled(), 'custom calendar Today action respects the server-derived minimum');
    const clearDate = page.locator('[data-dp-act="clear"]');
    await clearDate.focus();
    await page.keyboard.press('ArrowRight');
    assert(await page.evaluate(() => document.activeElement?.getAttribute('data-dp-act')) === 'clear',
      'calendar day keys do not steal focus from its footer controls');
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.querySelector('#svDatePickerPopup')?.contains(document.activeElement))
      && await page.evaluate(() => document.activeElement?.getAttribute('data-dp-nav')) === '-1',
    'calendar Tab wraps inside the open dialog instead of escaping to the page');
    await page.keyboard.press('Shift+Tab');
    assert(await page.evaluate(() => document.activeElement?.getAttribute('data-dp-act')) === 'clear',
      'calendar reverse Tab wraps to the last enabled control');
    await page.keyboard.press('Escape');
    assert(await page.locator('#svDatePickerPopup').count() === 0
      && await page.evaluate(() => document.activeElement?.id) === 'ptoStartDateBtn',
    'Escape closes the custom calendar and restores date-trigger focus');

    await page.locator('#ptoRequestTypeBtn').click();
    await page.locator('#ptoRequestTypeMenu [data-value="unpaid"]').click();
    await page.evaluate(() => {
      const start = document.getElementById('ptoStartDate');
      const end = document.getElementById('ptoEndDate');
      start.value = '2030-04-29';
      start.dispatchEvent(new Event('change', { bubbles: true }));
      end.value = '2030-05-03';
      end.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#ptoRequestTypeBtn').click();
    await page.locator('#ptoRequestTypeMenu [data-value="wellness"]').click();
    assert(await page.locator('#ptoStartDate').inputValue() === '2030-04-29'
      && await page.locator('#ptoEndDate').inputValue() === '',
    'switching from unpaid to paid clears an end date outside the paid leave year');
    await page.evaluate(() => {
      const start = document.getElementById('ptoStartDate');
      start.value = '2030-05-01';
      start.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert(await page.locator('#ptoStartDate').inputValue() === '2030-05-01'
      && await page.locator('#ptoStartDate').getAttribute('max') === ''
      && await page.locator('#ptoEndDate').getAttribute('max') === '2031-04-30',
    'paid requests can start in the next anniversary year and stop at that selected year boundary');
    await page.locator('#ptoRequestTypeBtn').click();
    await page.locator('#ptoRequestTypeMenu [data-value="unpaid"]').click();
    await page.evaluate(() => {
      const start = document.getElementById('ptoStartDate');
      const end = document.getElementById('ptoEndDate');
      start.value = '2033-01-03';
      start.dispatchEvent(new Event('change', { bubbles: true }));
      end.value = '2033-01-03';
      end.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const requestCountBeforePendingQuote = state.ptoCalls.filter(call => call.action === 'request').length;
    const pendingQuoteGuard = await page.evaluate(() => {
      const form = document.getElementById('ptoRequestForm');
      form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
      return {
        submitDisabled: document.getElementById('ptoSubmit').disabled,
        error: document.getElementById('ptoFormError').textContent,
      };
    });
    assert(pendingQuoteGuard.submitDisabled && pendingQuoteGuard.error.includes('count at least one business day')
      && state.ptoCalls.filter(call => call.action === 'request').length === requestCountBeforePendingQuote,
    'a pending server quote disables submission and a programmatic submit cannot send a zero-day request');
    await page.waitForFunction(() => document.getElementById('ptoDays')?.value === '1');
    assert(state.ptoCalls.some(call => call.action === 'quote' && call.body.start_date === '2033-01-03')
      && await page.locator('#ptoStartDate').getAttribute('max') === ''
      && !(await page.locator('#ptoSubmit').isDisabled()),
    'an out-of-window unpaid date uses the server quote without inventing a policy horizon');
    await page.evaluate(() => {
      const start = document.getElementById('ptoStartDate');
      const end = document.getElementById('ptoEndDate');
      start.value = '2033-01-08';
      start.dispatchEvent(new Event('change', { bubbles: true }));
      end.value = '2033-01-08';
      end.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.getElementById('ptoDaysHelp')?.textContent.includes('shorter date ranges'));
    assert(await page.locator('#ptoDays').isDisabled() && await page.locator('#ptoSubmit').isDisabled()
      && state.ptoCalls.filter(call => call.action === 'request').length === requestCountBeforePendingQuote,
    'a failed server quote stays visibly blocked and cannot leak a request');
    await page.evaluate(() => {
      const start = document.getElementById('ptoStartDate');
      const end = document.getElementById('ptoEndDate');
      start.value = '2033-01-09';
      start.dispatchEvent(new Event('change', { bubbles: true }));
      end.value = '2033-01-09';
      end.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.getElementById('ptoDaysHelp')?.textContent.includes('at least one business day'));
    assert(await page.locator('#ptoDays').inputValue() === '' && await page.locator('#ptoDays').isDisabled()
      && await page.locator('#ptoSubmit').isDisabled(),
    'a quoted weekend-only range remains a disabled zero-business-day request');
    await page.locator('#ptoRequestTypeBtn').click();
    await page.locator('#ptoRequestTypeMenu [data-value="wellness"]').click();
    await page.evaluate(() => {
      const start = document.getElementById('ptoStartDate');
      const end = document.getElementById('ptoEndDate');
      start.value = '2030-04-15';
      start.dispatchEvent(new Event('change', { bubbles: true }));
      end.value = '2030-04-20';
      end.dispatchEvent(new Event('change', { bubbles: true }));
      start.value = '2030-04-21';
      start.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert(await page.locator('#ptoEndDate').inputValue() === '',
      'moving the start after the end clears the now-invalid end date');

    await page.locator('#ptoStartDateBtn').click();
    await page.locator('[data-dp-day="2030-04-15"]').click();
    assert(await page.locator('#ptoStartDate').inputValue() === '2030-04-15'
      && await page.locator('#ptoEndDate').getAttribute('min') === '2030-04-15',
    'choosing a custom start date updates its hidden value and the end-date minimum');
    assert((await page.locator('#ptoFormError').textContent()).trim() === ''
      && await page.locator('#ptoStartDateBtn').getAttribute('aria-invalid') === null,
    'correcting the request clears stale validation text and invalid state');
    await page.locator('#ptoEndDateBtn').click();
    assert(await page.locator('[data-dp-day="2030-04-14"]').isDisabled()
      && !(await page.locator('[data-dp-day="2030-04-15"]').isDisabled())
      && await page.locator('[data-dp-day="2030-05-01"]').isDisabled(),
    'end-date calendar enforces the selected start and its anniversary boundary');
    await page.locator('[data-dp-day="2030-04-16"]').click();

    assert(await page.locator('#ptoDays').inputValue() === '2'
      && await page.locator('#ptoDays').getAttribute('min') === '1.5'
      && await page.locator('#ptoDays').getAttribute('max') === '2',
    'business-day range sets full-day and half-day endpoint bounds');
    assert(await page.locator('#ptoDaysUp').isDisabled() && !(await page.locator('#ptoDaysDown').isDisabled()),
      'staff stepper disables only the direction at its current bound');
    await page.locator('#ptoDaysDown').click();
    assert(await page.locator('#ptoDays').inputValue() === '1.5' && await page.locator('#ptoDaysDown').isDisabled(),
      'staff minus control reaches and stops at the half-day lower bound');
    await page.locator('#ptoDaysUp').click();
    assert(await page.locator('#ptoDays').inputValue() === '2' && await page.locator('#ptoDaysUp').isDisabled(),
      'staff plus control returns to and stops at the full-day upper bound');

    await page.locator('#ptoNote').fill('TEST browser request');
    await page.locator('.pto-calendar-nav button[aria-label="Next month"]').click();
    await page.waitForFunction(() => document.activeElement?.closest('.pto-calendar-nav'));
    assert(await page.locator('#ptoRequestType').inputValue() === 'wellness'
      && await page.locator('#ptoStartDate').inputValue() === '2030-04-15'
      && await page.locator('#ptoEndDate').inputValue() === '2030-04-16'
      && await page.locator('#ptoDays').inputValue() === '2'
      && await page.locator('#ptoNote').inputValue() === 'TEST browser request',
    'browsing Team calendar months preserves the in-progress request draft');

    const lightStyle = await page.locator('#ptoRequestTypeBtn').evaluate(element => {
      const style = getComputedStyle(element);
      return [style.backgroundImage, style.backgroundColor, style.color, style.borderColor].join('|');
    });
    await page.evaluate(() => _syncviewApplyTheme('dark'));
    const darkStyle = await page.locator('#ptoRequestTypeBtn').evaluate(element => {
      const style = getComputedStyle(element);
      return [style.backgroundImage, style.backgroundColor, style.color, style.borderColor].join('|');
    });
    assert(lightStyle !== darkStyle && await page.locator('.pto-wrap').isVisible(), 'staff controls remain rendered with distinct light and dark theme tokens');
    await page.locator('#ptoRequestTypeBtn').click();
    await assertNoSeriousAxe(page, '.pto-wrap', 'dark staff Time Off with open dropdown');
    await page.keyboard.press('Escape');
    await page.locator('#ptoStartDateBtn').click();
    await assertNoSeriousAxe(page, '#svDatePickerPopup', 'dark custom date picker');
    await page.keyboard.press('Escape');
    await page.evaluate(() => _syncviewApplyTheme('light'));

    await page.locator('#ptoSubmit').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.pto-table tbody tr')].some(row => row.textContent.includes('Apr 15')));
    const submitCall = state.ptoCalls.find(call => call.action === 'request');
    assert(submitCall && submitCall.body.member_id === ADMIN.id && submitCall.body.type === 'wellness'
      && submitCall.body.start_date === '2030-04-15' && submitCall.body.end_date === '2030-04-16'
      && submitCall.body.days === 2 && submitCall.headers['x-syncview-key'] === ADMIN_KEY,
    'staff submit sends the mocked Edge Function the verified member, dates, type, and day count');

    // Open Kasper directly on Time Off. The same mocked overview now contains
    // the staff submission, making the submit -> approve path end-to-end.
    await page.evaluate(() => {
      _kasperState.tab = 'time-off';
      navTo('kasper', false);
    });
    await page.waitForSelector('#ptoAdminMemberBtn', { timeout: 15000 });
    const adminNative = await nativeControlAudit(page, '.pto-admin');
    assert(adminNative.selects === 0 && adminNative.visibleDates === 0 && adminNative.badDateContract === 0
      && adminNative.rogueNumbers === 0 && adminNative.badSteppers === 0 && adminNative.spinnerRule,
    'Kasper forms expose no browser-native select, calendar, or spinner chrome');
    await assertNoSeriousAxe(page, '.pto-admin', 'Kasper Time Off');
    await page.evaluate(() => _syncviewApplyTheme('dark'));
    await page.locator('#ptoAdminMemberBtn').click();
    await assertNoSeriousAxe(page, '.pto-admin', 'dark Kasper Time Off with open dropdown');
    await page.keyboard.press('Escape');
    await page.evaluate(() => _syncviewApplyTheme('light'));

    // Kasper custom select keyboard and focus behavior.
    await page.locator('#ptoAdminMemberBtn').focus();
    await page.keyboard.press('Enter');
    assert(await page.locator('#ptoAdminMemberBtn').getAttribute('aria-expanded') === 'true', 'Kasper member picker opens from the keyboard');
    const duplicateIdentityOptions = await page.locator('#ptoAdminMemberMenu [data-label^="' + ADMIN.name + '"]').allTextContents();
    assert(duplicateIdentityOptions.some(label => label.includes('Admin')) && duplicateIdentityOptions.some(label => label.includes('SMM')),
      'duplicate member names are disambiguated with public roster context');
    await page.keyboard.press('Escape');
    assert(await page.locator('#ptoAdminMemberBtn').getAttribute('aria-expanded') === 'false'
      && await page.evaluate(() => document.activeElement?.id) === 'ptoAdminMemberBtn',
    'Escape closes the Kasper member picker and restores focus');

    // Custom member setup validation remains explicit despite hidden data inputs.
    await page.locator('#ptoAdminMemberError').locator('xpath=..').locator('button[type="submit"]').click();
    assert((await page.locator('#ptoAdminMemberError').textContent()).trim() === 'Choose a team member.'
      && await page.evaluate(() => document.activeElement?.id) === 'ptoAdminMemberBtn'
      && await page.locator('#ptoAdminMemberBtn').getAttribute('aria-invalid') === 'true'
      && (await page.locator('#ptoAdminMemberBtn').getAttribute('aria-describedby') || '').includes('ptoAdminMemberError'),
    'member setup names and focuses its missing custom member control');
    await page.locator('#ptoAdminMemberBtn').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert(await page.locator('#ptoAdminMember').inputValue() === ADMIN.id
      && (await page.locator('#ptoAdminMemberError').textContent()).trim() === ''
      && await page.locator('#ptoAdminMemberBtn').getAttribute('aria-invalid') === null,
    'Kasper member selection reaches the hidden value and clears stale validation');
    await page.evaluate(() => {
      document.getElementById('ptoAdminStart').value = '';
      _svSyncDateControl('ptoAdminStart');
    });
    await page.locator('#ptoAdminMemberError').locator('xpath=..').locator('button[type="submit"]').click();
    assert((await page.locator('#ptoAdminMemberError').textContent()).trim() === 'Choose a valid PTO start date.'
      && await page.evaluate(() => document.activeElement?.id) === 'ptoAdminStartBtn',
    'member setup names and focuses its missing custom date control');

    await page.locator('#ptoAdminStartBtn').click();
    await page.waitForSelector('#svDatePickerPopup');
    assert(await page.locator('#ptoAdminStart').getAttribute('max') === '2030-04-10'
      && await page.locator('[data-dp-day="2030-04-10"]').getAttribute('aria-current') === 'date'
      && await page.locator('[data-dp-day="2030-04-11"]').isDisabled(),
      'Kasper setup calendar marks Today and blocks future start dates the server would reject');
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => document.activeElement?.id) === 'ptoAdminStartBtn', 'Kasper date Escape restores trigger focus');

    // Adjustment validation + signed half-day control.
    await page.locator('#ptoAdjustDeltaDown').click();
    assert(await page.locator('#ptoAdjustDelta').inputValue() === '-0.5', 'admin adjustment minus control creates a signed half-day debit');
    await page.locator('#ptoAdjustDeltaDown').click();
    await page.locator('#ptoAdjustDeltaUp').click();
    assert(await page.locator('#ptoAdjustDelta').inputValue() === '-0.5', 'admin adjustment controls preserve signed half-day increments in both directions');
    await page.locator('#ptoAdjustReason').fill('TEST browser correction');
    await page.locator('#ptoAdjustError').locator('xpath=..').locator('button[type="submit"]').click();
    assert((await page.locator('#ptoAdjustError').textContent()).trim() === 'Choose a team member.'
      && await page.evaluate(() => document.activeElement?.id) === 'ptoAdjustMemberBtn',
    'adjustment form names and focuses its missing custom member control');
    await page.locator('#ptoAdjustMemberBtn').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.evaluate(() => {
      const input = document.getElementById('ptoAdjustDelta');
      input.value = '0.25';
      input.closest('form').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    });
    assert((await page.locator('#ptoAdjustError').textContent()).trim() === 'Use a non-zero amount in half-day steps.'
      && await page.evaluate(() => document.activeElement?.id) === 'ptoAdjustDelta'
      && await page.locator('#ptoAdjustDelta').getAttribute('aria-invalid') === 'true',
      'adjustment form rejects, marks, and focuses values outside explicit half-day increments');
    await page.locator('#ptoAdjustDelta').fill('-0.5');
    assert((await page.locator('#ptoAdjustError').textContent()).trim() === ''
      && await page.locator('#ptoAdjustDelta').getAttribute('aria-invalid') === null,
      'editing the adjustment clears stale amount validation');
    await page.locator('#ptoAdjustKindBtn').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert(await page.locator('#ptoAdjustKind').inputValue() === 'sick', 'Kasper balance kind is keyboard-selectable');
    await page.locator('#ptoAdjustError').locator('xpath=..').locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('.sv-toast-msg')?.textContent.includes('adjustment'));
    const adjustmentCall = state.ptoCalls.find(call => call.action === 'adjust');
    assert(adjustmentCall && adjustmentCall.body.member_id === ADMIN.id && adjustmentCall.body.kind === 'sick'
      && adjustmentCall.body.delta === -0.5 && adjustmentCall.body.effective_date === AS_OF
      && adjustmentCall.body.actor_member_id === ADMIN.id,
    'signed Kasper adjustment reaches the mocked Edge Function with actor attribution');

    const submittedCard = page.locator('.pto-request-card', { hasText: ADMIN.name });
    await submittedCard.locator('button.approve').click();
    await page.waitForFunction(name => ![...document.querySelectorAll('.pto-request-card')].some(card => card.textContent.includes(name)), ADMIN.name);
    const approveCall = state.ptoCalls.find(call => call.action === 'decide' && call.body.request_id.startsWith('test-browser-request-'));
    assert(approveCall && approveCall.body.decision === 'approved' && approveCall.body.actor_member_id === ADMIN.id,
      'Kasper approves the submitted staff request through the mocked Edge Function');

    const futureRow = page.locator('.pto-upcoming-row', { hasText: FUTURE_MEMBER_NAME });
    const cancelCountBefore = state.ptoCalls.filter(call => call.action === 'cancel').length;
    await futureRow.getByRole('button', { name: 'Cancel leave' }).click();
    await page.waitForSelector('#confirmOverlay.active');
    assert((await page.locator('#confirmTitle').textContent()).trim() === 'Cancel approved leave'
      && (await page.locator('#confirmMsg').textContent()).includes('original approval record')
      && state.ptoCalls.filter(call => call.action === 'cancel').length === cancelCountBefore,
    'future approved leave requires an explicit preservation-aware confirmation before cancellation');
    await page.locator('#confirmYes').click();
    await page.waitForFunction(name => ![...document.querySelectorAll('.pto-upcoming-row')].some(row => row.textContent.includes(name)), FUTURE_MEMBER_NAME);
    const cancelCall = state.ptoCalls.find(call => call.action === 'cancel' && call.body.request_id === 'test-future-approved');
    assert(cancelCall && cancelCall.body.actor_member_id === ADMIN.id,
      'confirmed future cancellation reaches the mocked Edge Function and leaves the upcoming list');
    const cancelledHistory = page.locator('.pto-history-row', { hasText: FUTURE_MEMBER_NAME });
    await page.locator('.pto-admin-history summary').click();
    assert((await cancelledHistory.textContent()).includes('Approved by ' + ADMIN.name)
      && (await cancelledHistory.textContent()).includes('Cancelled by ' + ADMIN.name),
    'cancelled approval history shows both the original decision and the cancellation attribution');

    // Mobile layout checks both admin and staff, in dark and light themes. The
    // custom popovers must stay in the viewport while intentional tables scroll
    // inside their own containers.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => _syncviewApplyTheme('dark'));
    await assertNoGlobalOverflow(page, 'dark Kasper Time Off');
    await page.locator('#ptoAdjustKindBtn').click();
    const mobileMenu = await page.locator('#ptoAdjustKindMenu').boundingBox();
    assert(mobileMenu && mobileMenu.x >= 0 && mobileMenu.x + mobileMenu.width <= 390,
      'Kasper custom dropdown stays inside the mobile viewport');
    await page.keyboard.press('Escape');
    await page.evaluate(() => _syncviewApplyTheme('light'));
    await assertNoGlobalOverflow(page, 'light Kasper Time Off');

    await page.evaluate(() => navTo('time-off', false));
    await page.waitForFunction(() => typeof _ptoState !== 'undefined' && !!_ptoState.overview
      && !_ptoState.loading && !!document.getElementById('ptoRequestTypeBtn'), null, { timeout: 15000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await assertNoGlobalOverflow(page, 'light staff Time Off');
    await page.locator('#ptoStartDateBtn').click();
    const mobileCalendar = await page.locator('#svDatePickerPopup').boundingBox();
    const mobileCalendarContained = mobileCalendar && mobileCalendar.x >= 0 && mobileCalendar.x + mobileCalendar.width <= 390
      && mobileCalendar.y >= 0 && mobileCalendar.y + mobileCalendar.height <= 844;
    assert(mobileCalendarContained, mobileCalendarContained
      ? 'staff custom calendar stays inside the mobile viewport'
      : `staff custom calendar stays inside the mobile viewport (${JSON.stringify(mobileCalendar)})`);
    await page.keyboard.press('Escape');
    await page.locator('#ptoRequestTypeBtn').click();
    const mobileStaffMenu = await page.locator('#ptoRequestTypeMenu').boundingBox();
    assert(mobileStaffMenu && mobileStaffMenu.x >= 0 && mobileStaffMenu.x + mobileStaffMenu.width <= 390,
      'staff custom dropdown stays inside the mobile viewport');
    await page.keyboard.press('Escape');

    // Short mobile landscape / browser zoom must not clip the body-portaled
    // calendar or absolute dropdown. This also exercises the below-fold
    // scroll event that previously raced and closed the picker immediately.
    await page.setViewportSize({ width: 390, height: 360 });
    await page.locator('#ptoStartDateBtn').click();
    const shortCalendar = await page.locator('#svDatePickerPopup').boundingBox();
    assert(shortCalendar && shortCalendar.y >= 0 && shortCalendar.y + shortCalendar.height <= 360,
      'short-height custom calendar is viewport-constrained after below-fold scrolling');
    await page.locator('[data-dp-act="clear"]').scrollIntoViewIfNeeded();
    assert(await page.locator('[data-dp-act="clear"]').isVisible(), 'short-height calendar footer remains reachable');
    await page.keyboard.press('Escape');
    await page.locator('#ptoRequestTypeBtn').click();
    const shortMenu = await page.locator('#ptoRequestTypeMenu').boundingBox();
    assert(shortMenu && shortMenu.y >= 0 && shortMenu.y + shortMenu.height <= 360,
      'short-height custom dropdown flips or scrolls without viewport clipping');
    await page.keyboard.press('Escape');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#ptoRequestTypeBtn').click();
    const reducedMenuMotion = await page.locator('#ptoRequestTypeMenu').evaluate(element => getComputedStyle(element).transitionDuration);
    await page.keyboard.press('Escape');
    await page.locator('#ptoStartDateBtn').click();
    const reducedCalendarMotion = await page.locator('#svDatePickerPopup').evaluate(element => getComputedStyle(element).animationName);
    assert(/^0s(?:, 0s)*$/.test(reducedMenuMotion) && reducedCalendarMotion === 'none',
      'dropdown and calendar disable decorative motion for reduced-motion users');
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'testOrphanDate';
      fixture.dataset.svDatePicker = '';
      fixture.style.cssText = 'position:fixed;top:30px;left:20px;width:220px;z-index:2000';
      fixture.innerHTML = '<button type="button" class="sv-date-trigger" data-sv-date-trigger>TEST orphan date</button><input type="date" value="2030-04-10">';
      document.body.appendChild(fixture);
    });
    await page.locator('#testOrphanDate button').click();
    await page.waitForSelector('#svDatePickerPopup');
    await page.locator('#testOrphanDate').evaluate(fixture => fixture.remove());
    await page.waitForFunction(() => !document.getElementById('svDatePickerPopup'));
    assert(await page.evaluate(() => document.activeElement === document.body || document.contains(document.activeElement)),
      'rerendering away an open date trigger removes its portal without detached focus');
    await page.setViewportSize({ width: 390, height: 844 });

    await page.evaluate(() => _syncviewApplyTheme('dark'));
    await assertNoGlobalOverflow(page, 'dark staff Time Off');

    // The shared UI standard also calls out tablet width explicitly. Exercise
    // both PTO surfaces there so a desktop/mobile-only layout cannot mask an
    // intermediate-width overflow or accessibility regression.
    await page.setViewportSize({ width: 768, height: 900 });
    await assertNoGlobalOverflow(page, 'tablet staff Time Off');
    await assertNoSeriousAxe(page, '.pto-wrap', 'tablet staff Time Off');
    await page.evaluate(() => { _kasperState.tab = 'time-off'; navTo('kasper', false); });
    await page.waitForSelector('#ptoAdminMemberBtn', { timeout: 15000 });
    await assertNoGlobalOverflow(page, 'tablet Kasper Time Off');
    await assertNoSeriousAxe(page, '.pto-admin', 'tablet Kasper Time Off');
    await page.evaluate(() => navTo('time-off', false));
    await page.waitForFunction(() => !!document.getElementById('ptoRequestTypeBtn') && !_ptoState.loading);
    await page.setViewportSize({ width: 390, height: 844 });

    // Exercise the same staff page as an ordinary creative-role member. The
    // private admin subtab must disappear, while requests remain identity-bound.
    const nonAdminCallStart = state.ptoCalls.length;
    await page.evaluate(({ identity, key }) => {
      _syncviewStaffIdentityVerified = true;
      _syncviewStaffIdentitySave({ key, role: identity.role, member: identity, verified_at: '2030-04-10T16:00:00.000Z' });
      _ptoInvalidateOverviewCaches();
      _ptoSetFlagValue({ mode: 'on' });
      navTo('time-off', false);
    }, { identity: MEMBER, key: MEMBER_KEY });
    await page.waitForFunction(() => !!document.getElementById('ptoRequestTypeBtn') && !_ptoState.loading);
    await page.locator('#headerMenuButton').click();
    assert(await page.locator('#headerTimeOffMenuItem').isVisible() && await page.locator('#ptoRequestForm').isVisible(),
      'ordinary staff can open the Time Off menu and overview form');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { _kasperState.tab = 'time-off'; navTo('kasper', false); });
    await page.waitForSelector('.kasper-subtabs');
    const nonAdminKasper = await page.evaluate(() => ({
      role: _syncviewStaffIdentityForHeaders()?.role || '',
      canAdmin: _syncviewStaffCan('pto-admin'),
      activeTab: _kasperState.tab,
      tabHidden: document.querySelector('.kasper-subtab[data-kasper-tab="time-off"]')?.hidden !== false,
      adminControls: document.querySelectorAll('#ptoAdminMemberBtn').length,
    }));
    assert(!nonAdminKasper.canAdmin && nonAdminKasper.tabHidden && nonAdminKasper.activeTab !== 'time-off'
      && nonAdminKasper.adminControls === 0,
      'ordinary staff cannot see or restore the Kasper Time Off admin subtab (' + JSON.stringify(nonAdminKasper) + ')');
    await page.evaluate(() => navTo('time-off', false));
    await page.waitForFunction(() => !!document.getElementById('ptoRequestTypeBtn') && !_ptoState.loading);
    await page.evaluate(() => {
      const start = document.getElementById('ptoStartDate');
      const end = document.getElementById('ptoEndDate');
      start.value = '2030-04-22';
      start.dispatchEvent(new Event('change', { bubbles: true }));
      end.value = '2030-04-22';
      end.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.getElementById('ptoDays')?.value === '1');
    await page.locator('#ptoNote').fill('TEST ordinary staff request');
    await page.locator('#ptoSubmit').click();
    await waitForFixture(() => state.ptoCalls.slice(nonAdminCallStart).some(call => call.action === 'request'), 'ordinary-staff request');
    const memberRequest = state.ptoCalls.slice(nonAdminCallStart).find(call => call.action === 'request');
    assert(memberRequest && memberRequest.body.member_id === MEMBER.id
      && memberRequest.headers['x-syncview-key'] === MEMBER_KEY,
      'ordinary-staff submission is bound to the verified non-admin member and key');
    await page.waitForFunction(() => !_ptoState.loading
      && [...document.querySelectorAll('.pto-table tbody tr')].some(row => row.textContent.includes('Apr 22')));

    state.failNextOverview = true;
    await page.evaluate(() => { _ptoInvalidateOverviewCaches(); _ptoLoadOverview(true); });
    await page.waitForFunction(() => document.querySelector('.pto-signin')?.textContent.includes('Could not load Time Off'));
    assert((await page.locator('.pto-signin').textContent()).includes('test_overview_unavailable'),
      'staff overview failure is visible and does not fall back to another data source');
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.waitForFunction(() => !!document.getElementById('ptoRequestTypeBtn') && !_ptoState.loading);
    assert(await page.locator('#ptoRequestForm').isVisible(), 'staff overview recovers through its explicit retry');

    state.overview.as_of_date = '2032-10-10';
    state.overview.holiday_date_min = '2031-01-01';
    state.overview.holiday_date_max = '2033-12-31';
    await page.evaluate(() => _ptoLoadOverview(true));
    await page.waitForFunction(() => !_ptoState.loading && _ptoState.overview?.as_of_date === '2032-10-10');
    assert(await page.evaluate(() => _ptoIso(_ptoState.month)) === '2032-07-01',
      'a later server date clamps a previously selected Team calendar month back into its data window');

    assert(state.unexpectedWrites.length === 0, 'test triggered no unrelated external writes');
    assert(pageErrors.length === 0, 'browser produced no page errors: ' + pageErrors.join(' | '));
    console.log(`PTO UI polish browser checks passed (${state.ptoCalls.length} mocked PTO calls)`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});

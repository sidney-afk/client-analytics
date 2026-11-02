'use strict';

// Browser contract for Kasper > Time Off > "Log time off" (OPEN_REPAIRS 628):
// an admin records leave for a team member, sees what it uses from their
// balance before saving, logs it, and lands on that day of the team calendar.
// Also checks that "Add adjustment" says it never reaches the calendar, and
// that the member's own view shows a logged entry as approved with no Cancel.
//
// Every person, date and balance is an invented TEST fixture and every
// external request is intercepted: this suite never reads or writes live data.
//   node docs/syncview-design/tests/pto-admin-log-browser.js
const { chromium } = require('playwright');
const { serveStatic } = require('./prod-test-utils');

const AS_OF = '2030-04-10'; // a Wednesday
const ADMIN = Object.freeze({ id: '00000000-0000-4000-8000-000000000201', name: 'TEST Log Administrator', role: 'admin', team: 'TEST', active: true });
const MEMBER = Object.freeze({ id: '00000000-0000-4000-8000-000000000202', name: 'TEST Log Teammate', role: 'creative', team: 'TEST', active: true });
const OFF_MEMBER_ID = '00000000-0000-4000-8000-000000000203';
const OFF_MEMBER_NAME = 'TEST Log Switched Off';
const ADMIN_KEY = 'test-log-admin-role-key';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log('PASS ' + message);
}
const clone = value => JSON.parse(JSON.stringify(value));

function overview() {
  return {
    ok: true,
    as_of_date: AS_OF,
    holiday_date_min: '2029-01-01',
    holiday_date_max: '2031-12-31',
    pto_enabled: true,
    balance: { pto_enabled: true, pto_start_date: '2029-01-15', eligibility_date: '2029-03-16', eligible: true, wellness_available: 5, sick_available: 3, leave_year_start: '2030-01-01', leave_year_end: '2030-12-31' },
    holidays: [],
    members: [],
    absences: [],
    my_requests: [{
      id: 'test-log-mine', member_id: ADMIN.id, member_name: ADMIN.name, type: 'sick',
      start_date: '2030-04-03', end_date: '2030-04-03', days: 1, status: 'approved', note: 'TEST note from the admin',
      decided_by: 'TEST Someone Else', decision_note: '', source: 'admin_log', requested_at: '2030-04-03T12:00:00.000Z',
    }],
    pending_requests: [{
      id: 'test-log-pending', member_id: MEMBER.id, member_name: MEMBER.name, type: 'wellness',
      start_date: '2030-04-16', end_date: '2030-04-16', days: 1, status: 'pending', note: '', requested_at: '2030-04-01T12:00:00.000Z',
    }],
    upcoming_approved_requests: [],
    recent_requests: [],
    admin_members: [
      { member_id: ADMIN.id, name: ADMIN.name, role: 'admin', team: 'video', pto_start_date: '2029-01-15', pto_enabled: true, wellness_available: 5, sick_available: 3 },
      { member_id: MEMBER.id, name: MEMBER.name, role: 'designer', team: 'graphics', pto_start_date: '2029-02-15', pto_enabled: true, wellness_available: 4, sick_available: 3 },
      { member_id: OFF_MEMBER_ID, name: OFF_MEMBER_NAME, role: 'smm', team: 'video', pto_start_date: null, pto_enabled: false, wellness_available: 0, sick_available: 0 },
    ],
  };
}

function businessDays(start, end) {
  let n = 0;
  for (const c = new Date(start + 'T12:00:00Z'); c <= new Date(end + 'T12:00:00Z'); c.setUTCDate(c.getUTCDate() + 1)) {
    if (c.getUTCDay() !== 0 && c.getUTCDay() !== 6) n++;
  }
  return n;
}

async function install(page, state) {
  await page.addInitScript(({ identity, key }) => {
    localStorage.removeItem('syncview_theme');
    localStorage.setItem('syncview_staff_identity_v1', JSON.stringify({ key, role: identity.role, member: identity, verified_at: '2030-04-10T12:00:00.000Z' }));
    sessionStorage.setItem('syncview_kasper_unlocked', 'ok');
  }, { identity: ADMIN, key: ADMIN_KEY });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = request.url();
    if (/^https?:\/\/127\.0\.0\.1(?::\d+)?\//.test(url)) return route.continue();
    const parsed = new URL(url);
    let body = null;
    try { body = request.postDataJSON(); } catch (_) {}
    const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (parsed.pathname.endsWith('/rest/v1/syncview_runtime_flags')) return reply(200, [{ value: { mode: 'on' } }]);
    if (parsed.pathname.endsWith('/rest/v1/team_members')) return reply(200, [ADMIN, MEMBER]);
    if (parsed.pathname.endsWith('/functions/v1/key-verify')) return reply(200, { ok: true, mode: 'permissive', role: 'admin', member: ADMIN });
    if (parsed.pathname.endsWith('/functions/v1/pto')) {
      const action = String(parsed.searchParams.get('action') || (body && body.action) || '');
      state.calls.push({ action, headers: request.headers(), body: clone(body || {}) });
      if (action === 'overview') return reply(200, clone(state.overview));
      if (action === 'log_quote' || action === 'log') {
        const live = state.overview.pending_requests.concat(state.overview.recent_requests.filter(r => r.status === 'approved'));
        const clash = live.find(r => r.member_id === body.member_id && r.start_date <= body.end_date && r.end_date >= body.start_date);
        if (clash) return reply(409, { ok: false, error: 'overlaps_existing' });
        const full = businessDays(body.start_date, body.end_date);
        const partial = Math.max(0.5, full - 0.5);
        const before = body.type === 'sick' ? state.sickLeft : (body.type === 'wellness' ? 4 : (body.type === 'floating_holiday' ? 1 : null));
        const days = action === 'log' ? Number(body.days) : (body.half === true ? partial : full);
        if (before != null && days > before) return reply(409, { ok: false, error: body.type === 'sick' ? 'insufficient_sick_balance' : 'insufficient_balance' });
        const quote = { ok: true, type: body.type, start_date: body.start_date, end_date: body.end_date, full_days: full, partial_day_count: partial, days, available_before: before };
        if (action === 'log_quote') {
          if (state.quoteDelayMs) await new Promise(resolve => setTimeout(resolve, state.quoteDelayMs));
          return reply(200, quote);
        }
        if (state.failNextLog) { const code = state.failNextLog; state.failNextLog = ''; return reply(503, { ok: false, error: code }); }
        const row = {
          id: 'test-log-row-' + (++state.seq), member_id: body.member_id, member_name: MEMBER.name, type: body.type,
          start_date: body.start_date, end_date: body.end_date, days: Number(body.days), note: body.note || '',
          status: 'approved', decided_by: ADMIN.name, decided_at: '2030-04-10T15:00:00.000Z', decision_note: '', source: 'admin_log',
        };
        state.overview.recent_requests.unshift(row);
        state.overview.absences.push({ member_name: row.member_name, start_date: row.start_date, end_date: row.end_date });
        return reply(201, { ok: true, logged: true, request: row });
      }
      return reply(400, { ok: false, error: 'unexpected_test_action' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) state.unexpectedWrites.push(url);
    if (parsed.pathname.includes('/rest/v1/')) return reply(200, []);
    if (['font', 'stylesheet', 'script', 'image'].includes(request.resourceType())) return route.abort();
    return reply(200, {});
  });
}

async function openKasperTimeOff(page, port) {
  await page.goto(`http://127.0.0.1:${port}/#time-off`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navTo === 'function' && typeof window._ptoSetFlagValue === 'function');
  await page.evaluate(identity => {
    _syncviewStaffIdentityVerified = true;
    _syncviewStaffIdentitySave({ key: 'test-log-admin-role-key', role: 'admin', member: identity, verified_at: '2030-04-10T12:00:00.000Z' });
    _ptoSetFlagValue({ mode: 'on' });
    _kasperState.tab = 'time-off';
    navTo('kasper', false);
  }, ADMIN);
  await page.waitForSelector('#ptoLogCard #ptoLogMemberBtn', { timeout: 15000 });
}

async function pick(page, id, value) {
  await page.locator('#' + id + 'Btn').click();
  await page.locator('#' + id + 'Menu [data-value="' + value + '"]').click();
}
async function setDate(page, id, iso) {
  await page.evaluate(([id, iso]) => {
    const input = document.getElementById(id);
    input.value = iso;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, iso]);
}
const quoteText = page => page.locator('#ptoLogQuote').innerText();
async function waitQuote(page, needle) {
  await page.waitForFunction(text => (document.getElementById('ptoLogQuote')?.textContent || '').includes(text), needle, { timeout: 5000 });
}

async function main() {
  const state = { overview: overview(), calls: [], unexpectedWrites: [], seq: 0, quoteDelayMs: 0, failNextLog: '', sickLeft: 3 };
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 980 }, colorScheme: 'light' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await install(page, state);
  try {
    await openKasperTimeOff(page, port);

    // ── The card, beside Add adjustment ──
    const boxes = await page.evaluate(() => {
      const log = document.getElementById('ptoLogCard');
      const next = log && log.nextElementSibling;
      const a = log.getBoundingClientRect(); const b = next.getBoundingClientRect();
      return { nextIsAdjust: !!(next && next.querySelector('[data-pto-explain="add-adjustment"]')), sameRow: Math.abs(a.top - b.top) < 2, sideBySide: b.left > a.right - 1 };
    });
    assert(boxes.nextIsAdjust && boxes.sameRow && boxes.sideBySide, 'Log time off sits beside Add adjustment, in the same row');
    const adjustSub = await page.locator('section.pto-admin-card', { has: page.locator('[data-pto-explain="add-adjustment"]') }).locator('.pto-admin-sub').innerText();
    assert(/balance only/i.test(adjustSub) && /does not put anything on the team calendar/i.test(adjustSub),
      'Add adjustment says plainly that it changes the balance only and never reaches the calendar');
    const memberOptions = await page.locator('#ptoLogMemberMenu [data-sv-select-option]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-value')));
    assert(memberOptions.length === 2 && !memberOptions.includes(OFF_MEMBER_ID), 'only members with Time Off switched on can be picked');
    assert(await page.locator('#ptoLogSubmit').isDisabled(), 'Log waits until a member and type are chosen');
    assert(await page.locator('#ptoLogStart').inputValue() === AS_OF && await page.locator('#ptoLogEnd').inputValue() === AS_OF,
      'dates start on today, one day');

    // ── Quote: skeleton the size of the answer, then what it uses ──
    const emptyHeight = await page.locator('#ptoLogQuote').evaluate(el => el.getBoundingClientRect().height);
    state.quoteDelayMs = 400;
    await pick(page, 'ptoLogMember', MEMBER.id);
    await pick(page, 'ptoLogType', 'sick');
    await page.waitForSelector('#ptoLogQuote .pto-log-quote-skel', { timeout: 2000 });
    const skelHeight = await page.locator('#ptoLogQuote').evaluate(el => el.getBoundingClientRect().height);
    assert(await page.locator('#ptoLogSubmit').isDisabled(), 'Log stays off while the balance check runs');
    await waitQuote(page, 'left after');
    const doneHeight = await page.locator('#ptoLogQuote').evaluate(el => el.getBoundingClientRect().height);
    assert(Math.abs(skelHeight - doneHeight) < 1 && Math.abs(emptyHeight - doneHeight) < 1,
      `the quote skeleton is the same height as the quote (${emptyHeight}/${skelHeight}/${doneHeight})`);
    state.quoteDelayMs = 0;
    assert(/Uses 1\.0 day of sick time\. 3\.0 available, 2\.0 left after\./.test(await quoteText(page)), 'the quote line says what one sick day uses and what is left');
    assert(await page.locator('#ptoLogSubmit').isEnabled(), 'Log is ready once the quote is in');
    const quoteCall = state.calls.filter(c => c.action === 'log_quote').pop();
    assert(quoteCall.body.member_id === MEMBER.id && quoteCall.body.actor_member_id === ADMIN.id && quoteCall.headers['x-syncview-key'] === ADMIN_KEY,
      'the quote asks for the chosen member, signed as the admin');

    // ── Half day, and the end following the start ──
    await page.locator('#ptoLogHalf').check();
    await waitQuote(page, '0.5 days');
    assert(/Uses 0\.5 days of sick time\. 3\.0 available, 2\.5 left after\./.test(await quoteText(page)), 'a half day quotes 0.5');
    await setDate(page, 'ptoLogStart', '2030-04-08');
    assert(await page.locator('#ptoLogEnd').inputValue() === '2030-04-08', 'the end date follows the start until it is picked');
    await setDate(page, 'ptoLogEnd', '2030-04-09');
    await waitQuote(page, 'left after');
    assert(await page.locator('#ptoLogHalfLabel').innerText() === 'The first or last day is a half day', 'over several days the half-day box says which day it means');
    assert(/Uses 1\.5 days/.test(await quoteText(page)), 'two days with a half day quote 1.5');
    await setDate(page, 'ptoLogStart', '2030-04-07');
    assert(await page.locator('#ptoLogEnd').inputValue() === '2030-04-09', 'a picked end date stays put when the start moves before it');
    await page.locator('#ptoLogHalf').uncheck();
    await waitQuote(page, '2.0 days');

    // ── Only half a day left: the full day is refused, the half day is offered ──
    state.sickLeft = 0.5;
    await setDate(page, 'ptoLogStart', '2030-04-11');
    await setDate(page, 'ptoLogEnd', '2030-04-11');
    await waitQuote(page, 'more than their sick balance');
    await page.locator('#ptoLogHalf').check();
    await waitQuote(page, '0.0 left after');
    assert(/Uses 0\.5 days of sick time\. 0\.5 available, 0\.0 left after\./.test(await quoteText(page)) && await page.locator('#ptoLogSubmit').isEnabled(),
      'with half a day left, ticking Half day asks again and the half day can be logged');
    assert(state.calls.filter(c => c.action === 'log_quote').pop().body.half === true, 'the quote is asked with the half-day choice');
    await page.locator('#ptoLogHalf').uncheck();
    state.sickLeft = 3;

    // ── Overlap refusal ──
    await setDate(page, 'ptoLogStart', '2030-04-16');
    await setDate(page, 'ptoLogEnd', '2030-04-16');
    await waitQuote(page, 'already have time off');
    assert(await page.locator('#ptoLogQuote').evaluate(el => el.classList.contains('is-problem')) && await page.locator('#ptoLogSubmit').isDisabled(),
      'leave already on those dates is refused in the quote line and Log stays off');

    // ── Database update missing: says so, nothing logged ──
    await setDate(page, 'ptoLogStart', AS_OF);
    await setDate(page, 'ptoLogEnd', AS_OF);
    await waitQuote(page, 'left after');
    state.failNextLog = 'admin_log_not_ready';
    await page.locator('#ptoLogSubmit').click();
    await page.waitForFunction(() => (document.getElementById('ptoLogError')?.textContent || '').includes('database update'));
    assert(state.overview.recent_requests.length === 0, 'a refused log leaves nothing behind and says why');
    await waitQuote(page, 'left after');

    // ── Log it ──
    await page.locator('#ptoLogNote').fill('TEST called in');
    await page.locator('#ptoLogSubmit').click();
    await page.waitForSelector('#ptoLogCard .pto-log-done', { timeout: 5000 });
    const logCall = state.calls.filter(c => c.action === 'log').pop();
    assert(logCall.body.member_id === MEMBER.id && logCall.body.type === 'sick' && logCall.body.start_date === AS_OF
      && logCall.body.end_date === AS_OF && logCall.body.days === 1 && logCall.body.note === 'TEST called in'
      && logCall.body.actor_member_id === ADMIN.id && logCall.headers['x-syncview-key'] === ADMIN_KEY,
    'Log sends the member, type, dates, day count and note, signed as the admin');
    const doneText = await page.locator('#ptoLogCard .pto-log-done').innerText();
    assert(/Logged\./.test(doneText) && doneText.includes(MEMBER.name) && /on the team calendar/.test(doneText), 'a confirmation names who and says it is on the calendar');
    assert(await page.evaluate(() => document.activeElement && document.activeElement.textContent === 'See it on the calendar'), 'focus lands on the calendar link');
    await page.locator('#ptoLogCard .pto-log-done button').click();
    await page.waitForFunction(iso => _ptoAdminState.selectedDay === iso && !!document.querySelector('.pto-cal-detail'), AS_OF);
    assert((await page.locator('.pto-cal-detail').innerText()).includes(MEMBER.name), 'the link opens the team calendar on that day, showing the logged leave');
    // A day logged more than three months back: the link still reaches its month.
    await pick(page, 'ptoLogMember', MEMBER.id);
    await pick(page, 'ptoLogType', 'unpaid');
    await setDate(page, 'ptoLogStart', '2029-11-05');
    await waitQuote(page, 'balances do not change');
    await page.locator('#ptoLogSubmit').click();
    await page.waitForFunction(() => (document.querySelector('#ptoLogCard .pto-log-done')?.textContent || '').includes('Nov'));
    await page.locator('#ptoLogCard .pto-log-done button').click();
    await page.waitForFunction(() => _ptoAdminState.selectedDay === '2029-11-05' && !!document.querySelector('.pto-cal-detail'));
    assert(await page.evaluate(() => _ptoAdminState.month.getFullYear() === 2029 && _ptoAdminState.month.getMonth() === 10)
      && (await page.locator('.pto-cal-detail').innerText()).includes(MEMBER.name),
    'leave logged five months back opens its own month on the calendar, not the three-month limit');
    await page.locator('details.pto-admin-history summary').click();
    assert((await page.locator('.pto-history-list').innerText()).includes('Logged by ' + ADMIN.name), 'recent history says who logged it');

    // ── Design rules ──
    const edges = await page.evaluate(() => ['#ptoLogCard', '#ptoLogQuote', '#ptoLogCard .pto-log-done'].map(sel => {
      const cs = getComputedStyle(document.querySelector(sel));
      return cs.borderLeftColor === cs.borderTopColor && cs.borderLeftWidth === cs.borderTopWidth;
    }));
    assert(edges.every(Boolean), 'no coloured left edges on the card, the quote or the confirmation');
    await page.locator('#ptoLogSubmit').hover();
    const lit = await page.evaluate(() => {
      const quote = getComputedStyle(document.getElementById('ptoLogQuote'));
      const card = getComputedStyle(document.getElementById('ptoLogCard'));
      return { quote: quote.backgroundColor + quote.borderColor, card: card.backgroundColor + card.borderColor + card.boxShadow };
    });
    await page.mouse.move(2, 2);
    const unlit = await page.evaluate(() => {
      const quote = getComputedStyle(document.getElementById('ptoLogQuote'));
      const card = getComputedStyle(document.getElementById('ptoLogCard'));
      return { quote: quote.backgroundColor + quote.borderColor, card: card.backgroundColor + card.borderColor + card.boxShadow };
    });
    assert(lit.quote === unlit.quote && lit.card === unlit.card, 'hovering Log lights only the button, not the card or the quote');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const overflow = await page.locator('#ptoLogCard').evaluate(el => el.scrollWidth - el.clientWidth);
    assert(overflow <= 1, 'the card fits a phone width without sideways scroll');
    await page.setViewportSize({ width: 1360, height: 980 });

    // ── The member's own view ──
    await page.evaluate(() => navTo('time-off', false));
    await page.waitForFunction(() => !!document.querySelector('.pto-staff-history-table tbody tr'), null, { timeout: 15000 });
    const row = page.locator('.pto-staff-history-table tbody tr', { hasText: 'Apr 3' });
    const rowText = await row.innerText();
    assert(rowText.includes('Logged by TEST Someone Else') && rowText.includes('TEST note from the admin') && /approved/i.test(rowText),
      'the member sees the logged entry as approved, with who logged it and the note');
    assert(await row.locator('button').count() === 0, 'the member has no Cancel on an entry an admin logged');

    assert(state.unexpectedWrites.length === 0, 'no write left the page except to the mocked pto function');
    assert(pageErrors.length === 0, 'no page errors' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));
    console.log(`\npto admin log browser checks passed (${passed})`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(error => { console.error('FAIL ' + (error && error.stack || error)); process.exit(1); });

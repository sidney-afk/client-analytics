'use strict';

const { assert, settle } = require('./harness');

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uiDate(iso, options = {}) {
  const date = new Date(`${iso}T12:00:00.000Z`);
  assert(Number.isFinite(date.getTime()), `valid synthetic UI date ${iso}`);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...options,
  }).format(date);
}

function normalizeRequestCriteria(criteria) {
  if (typeof criteria === 'string') return { memberName: criteria };
  return { ...(criteria || {}) };
}

function staffRequestRowLocator(page, criteria) {
  const match = normalizeRequestCriteria(criteria);
  let rows = page.locator(
    '.pto-staff-history-table tbody tr:visible, '
    + '.pto-request-history-cards .pto-request-history-card:visible',
  );
  if (match.typeLabel) rows = rows.filter({ hasText: match.typeLabel });
  if (match.status) rows = rows.filter({ hasText: new RegExp(String(match.status), 'i') });
  if (match.start) rows = rows.filter({ hasText: uiDate(match.start) });
  if (match.end) rows = rows.filter({ hasText: uiDate(match.end, { year: 'numeric' }) });
  if (match.days != null) rows = rows.filter({ hasText: String(match.days) });
  if (match.decisionNote) rows = rows.filter({ hasText: match.decisionNote });
  return rows;
}

async function requestRow(page, criteria) {
  const rows = staffRequestRowLocator(page, criteria);
  const count = await rows.count();
  assert(count === 1, `exactly one staff request row matches ${JSON.stringify(criteria)}; found ${count}`);
  const row = rows.first();
  assert(await row.isVisible(), 'the exact staff request row is visible');
  return row;
}

function pendingAdminCardLocator(page, criteria) {
  const match = normalizeRequestCriteria(criteria);
  let cards = page.locator('.pto-admin-queue .pto-request-card');
  if (match.memberName) cards = cards.filter({ hasText: match.memberName });
  if (match.note) cards = cards.filter({ hasText: match.note });
  if (match.typeLabel) cards = cards.filter({ hasText: match.typeLabel });
  if (match.start) cards = cards.filter({ hasText: uiDate(match.start) });
  if (match.end) cards = cards.filter({ hasText: uiDate(match.end, { year: 'numeric' }) });
  return cards;
}

async function pendingAdminCard(page, criteria) {
  const cards = pendingAdminCardLocator(page, criteria);
  const count = await cards.count();
  assert(count === 1, `exactly one pending admin card matches ${JSON.stringify(criteria)}; found ${count}`);
  const card = cards.first();
  assert(await card.isVisible(), 'the exact pending request is visible to Kasper');
  return card;
}

function upcomingAdminRowLocator(page, criteria) {
  const match = normalizeRequestCriteria(criteria);
  let rows = page.locator('.pto-upcoming-list .pto-upcoming-row');
  if (match.memberName) rows = rows.filter({ hasText: match.memberName });
  if (match.typeLabel) rows = rows.filter({ hasText: match.typeLabel });
  if (match.start) rows = rows.filter({ hasText: uiDate(match.start) });
  if (match.end) rows = rows.filter({ hasText: uiDate(match.end, { year: 'numeric' }) });
  return rows;
}

async function selectPtoType(page, value) {
  await page.locator('#ptoRequestTypeBtn').click();
  const option = page.locator(`#ptoRequestTypeMenu [data-value="${value}"]`);
  assert(await option.count() === 1, `PTO type option ${value} is present`);
  await option.click();
  await settle(page);
}

function monthIndex(iso) {
  const match = String(iso).match(/^(\d{4})-(\d{2})/);
  if (!match) throw new Error(`Invalid ISO date ${iso}`);
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

async function pickDate(page, controlId, iso) {
  await page.locator(`#${controlId}Btn`).click();
  await page.waitForSelector('#svDatePickerPopup');
  for (let guard = 0; guard < 80; guard += 1) {
    const exact = page.locator(`#svDatePickerPopup [data-dp-day="${iso}"]`);
    if (await exact.count() && await exact.isVisible() && !(await exact.isDisabled())) {
      await exact.click();
      await page.waitForFunction(id => !document.getElementById('svDatePickerPopup')
        && document.getElementById(id)?.value, controlId);
      assert(await page.locator(`#${controlId}`).inputValue() === iso, `${controlId} selected ${iso}`);
      return;
    }
    const current = await page.locator('#svDatePickerPopup .dp-head-label').textContent();
    const parsed = new Date(`${String(current).trim()} 1, 00:00:00`);
    if (!Number.isFinite(parsed.getTime())) throw new Error(`Could not parse date-picker month ${current}`);
    const currentIndex = parsed.getFullYear() * 12 + parsed.getMonth();
    const direction = monthIndex(iso) < currentIndex ? -1 : 1;
    await page.locator(`#svDatePickerPopup [data-dp-nav="${direction}"]`).click();
  }
  throw new Error(`Date picker did not reach ${iso}`);
}

async function pickRange(page, start, end) {
  await pickDate(page, 'ptoStartDate', start);
  const endDisabled = await page.locator('#ptoEndDateBtn').isDisabled();
  const endValue = await page.locator('#ptoEndDate').inputValue();
  if (!(endDisabled && endValue === end)) await pickDate(page, 'ptoEndDate', end);
  await page.waitForFunction(() => {
    const button = document.getElementById('ptoSubmit');
    const days = document.getElementById('ptoDays');
    return button && days && button.dataset.quotePending !== 'true'
      && (days.value || document.getElementById('ptoDaysHelp')?.textContent);
  }, null, { timeout: 10000 });
}

async function tapInVisualViewport(page, selector) {
  const locator = page.locator(selector);
  assert(await locator.count() === 1, `${selector} resolves to one touch target`);
  assert(await locator.isVisible() && !(await locator.isDisabled()), `${selector} is touchable`);
  const point = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const viewportLeft = visualViewport?.offsetLeft || 0;
    const viewportTop = visualViewport?.offsetTop || 0;
    const viewportWidth = visualViewport?.width || innerWidth;
    const viewportHeight = visualViewport?.height || innerHeight;
    const layoutX = rect.left + rect.width / 2;
    const layoutY = rect.top + rect.height / 2;
    return {
      x: layoutX - viewportLeft,
      y: layoutY - viewportTop,
      inside: layoutX >= viewportLeft && layoutX <= viewportLeft + viewportWidth
        && layoutY >= viewportTop && layoutY <= viewportTop + viewportHeight,
    };
  });
  assert(point.inside, `${selector} touch target is inside the visual viewport`);
  await page.touchscreen.tap(point.x, point.y);
}

async function setHalfDay(page) {
  const down = page.locator('#ptoDaysDown');
  assert(await down.isEnabled(), 'half-day decrement is enabled');
  await down.click();
}

async function submitRequest(page, options = {}) {
  if (options.type) await selectPtoType(page, options.type);
  if (options.start && options.end) await pickRange(page, options.start, options.end);
  if (options.halfDay) await setHalfDay(page);
  if (options.note != null) await page.locator('#ptoNote').fill(options.note);
  await page.locator('#ptoSubmit').click();
  if (options.waitForCompletion !== false) {
    await page.waitForFunction(() => {
      const button = document.getElementById('ptoSubmit');
      return button && !/sending/i.test(String(button.textContent || ''));
    }, null, { timeout: 30000 });
  }
}

async function waitStaffReady(page) {
  await page.waitForFunction(() => typeof _ptoState !== 'undefined'
    && !!_ptoState.overview && !_ptoState.loading
    && !!document.getElementById('ptoRequestTypeBtn'), null, { timeout: 15000 });
  await settle(page);
}

async function refreshStaff(page) {
  await page.locator('#ptoRefresh').click();
  await waitStaffReady(page);
}

async function waitAdminReady(page) {
  await page.waitForFunction(() => typeof _ptoAdminState !== 'undefined'
    && !!_ptoAdminState.overview && !_ptoAdminState.loading
    && !!document.getElementById('ptoAdminMemberBtn'), null, { timeout: 15000 });
  await settle(page);
}

async function refreshAdmin(page) {
  await page.locator('.pto-admin > .pto-card-head .pto-refresh').click();
  await waitAdminReady(page);
}

async function approvePending(page, criteria, note = '') {
  const card = await pendingAdminCard(page, criteria);
  if (note) await card.locator('[data-pto-decision-note]').fill(note);
  await card.locator('button.approve').click();
  await card.waitFor({ state: 'detached' });
  await waitAdminReady(page);
}

async function denyPending(page, criteria, note = '') {
  const card = await pendingAdminCard(page, criteria);
  if (note) await card.locator('[data-pto-decision-note]').fill(note);
  await card.locator('button.deny').click();
  await card.waitFor({ state: 'detached' });
  await waitAdminReady(page);
}

async function cancelOwnPending(page, criteria) {
  const row = await requestRow(page, { ...normalizeRequestCriteria(criteria), status: 'pending' });
  await row.locator('button', { hasText: 'Cancel' }).click();
  await page.waitForSelector('#confirmOverlay.active');
  await page.locator('#confirmYes').click();
  await waitStaffReady(page);
}

async function cancelApproved(page, criteria) {
  const rows = upcomingAdminRowLocator(page, criteria);
  const count = await rows.count();
  assert(count === 1, `exactly one upcoming approved row matches ${JSON.stringify(criteria)}; found ${count}`);
  const row = rows.first();
  await row.getByRole('button', { name: 'Cancel leave' }).click();
  await page.waitForSelector('#confirmOverlay.active');
  await page.locator('#confirmYes').click();
  await waitAdminReady(page);
}

async function signOut(page) {
  await page.locator('#headerMenuButton').click();
  await page.locator('#staffIdentitySignOut').click();
  await page.waitForFunction(() => !window._syncviewStaffIdentityForHeaders?.());
  await settle(page);
}

async function signIn(page, persona) {
  await page.locator('#headerMenuButton').click();
  await page.locator('#staffIdentitySignOut').click();
  await page.waitForSelector('#staffIdentityMemberBtn');
  await page.locator('#staffIdentityMemberBtn').click();
  await page.locator(`#staffIdentityMemberMenu [data-value="${persona.member.id}"]`).click();
  await page.locator('#staffIdentityKey').fill(persona.key);
  await page.locator('#staffIdentitySubmit').click();
  await page.waitForFunction(() => !document.getElementById('staffIdentityOverlay')
    && !!window._syncviewStaffIdentityForHeaders?.());
  await settle(page);
}

async function chooseDateWithKeyboard(page, date) {
  for (let guard = 0; guard < 100; guard += 1) {
    const focusedDay = page.locator('#svDatePickerPopup [data-dp-day][tabindex="0"]');
    const current = await focusedDay.getAttribute('data-dp-day');
    if (current === date) {
      await page.keyboard.press('Enter');
      return;
    }
    const monthDistance = monthIndex(date) - monthIndex(current);
    if (monthDistance) {
      await page.keyboard.press(monthDistance < 0 ? 'PageUp' : 'PageDown');
    } else {
      await page.keyboard.press(date < current ? 'ArrowLeft' : 'ArrowRight');
    }
  }
  throw new Error(`Keyboard date navigation did not reach ${date}`);
}

async function tabTo(page, selector, maxTabs = 80) {
  for (let count = 0; count <= maxTabs; count += 1) {
    const matches = await page.evaluate(target =>
      !!document.activeElement && document.activeElement.matches(target), selector);
    if (matches) {
      const focusVisible = await page.evaluate(() =>
        !!document.activeElement && document.activeElement.matches(':focus-visible'));
      assert(focusVisible, `${selector} has a visible keyboard-focus affordance`);
      return page.locator(selector);
    }
    await page.keyboard.press('Tab');
  }
  const active = await page.evaluate(() => document.activeElement && (
    document.activeElement.id || document.activeElement.outerHTML.slice(0, 120)
  ));
  throw new Error(`Keyboard Tab navigation did not reach ${selector}; active=${active}`);
}

async function useKeyboardToSubmitOneDay(page, options) {
  await tabTo(page, '#ptoRequestTypeBtn');
  await page.keyboard.press('Enter');
  assert(await page.locator('#ptoRequestTypeBtn').getAttribute('aria-expanded') === 'true',
    'keyboard opens the branded request-type list');
  if (options.type === 'unpaid') await page.keyboard.press('End');
  else {
    const optionsList = page.locator('#ptoRequestTypeMenu [data-sv-select-option]:not([aria-disabled="true"])');
    const targetIndex = await optionsList.evaluateAll((elements, value) =>
      elements.findIndex(element => element.getAttribute('data-value') === value), options.type);
    assert(targetIndex >= 0, `keyboard request type ${options.type} is enabled`);
    await page.keyboard.press('Home');
    for (let index = 0; index < targetIndex; index += 1) await page.keyboard.press('ArrowDown');
  }
  const focusedType = await page.evaluate(() => document.activeElement?.getAttribute('data-value'));
  assert(focusedType === options.type, `keyboard focus reaches request type ${options.type}`);
  assert(await page.evaluate(() => document.activeElement?.matches(':focus-visible')),
    'custom-select option has a visible keyboard-focus affordance');
  await page.keyboard.press('Enter');
  assert(await page.locator('#ptoRequestType').inputValue() === options.type,
    `keyboard type selection chose ${options.type}`);
  await tabTo(page, '#ptoStartDateBtn');
  await page.keyboard.press('Enter');
  await chooseDateWithKeyboard(page, options.date);
  assert(await page.locator('#ptoStartDate').inputValue() === options.date,
    `keyboard start-date selection chose ${options.date}`);
  await tabTo(page, '#ptoEndDateBtn');
  await page.keyboard.press('Enter');
  await chooseDateWithKeyboard(page, options.date);
  assert(await page.locator('#ptoEndDate').inputValue() === options.date,
    `keyboard end-date selection chose ${options.date}`);
  await tabTo(page, '#ptoNote');
  await page.keyboard.type(options.note || 'TEST keyboard-only request');
  await tabTo(page, '#ptoSubmit');
  await page.keyboard.press('Enter');
}

module.exports = {
  selectPtoType,
  pickDate,
  pickRange,
  tapInVisualViewport,
  setHalfDay,
  submitRequest,
  waitStaffReady,
  refreshStaff,
  waitAdminReady,
  refreshAdmin,
  requestRow,
  staffRequestRowLocator,
  pendingAdminCard,
  pendingAdminCardLocator,
  upcomingAdminRowLocator,
  approvePending,
  denyPending,
  cancelOwnPending,
  cancelApproved,
  signOut,
  signIn,
  tabTo,
  chooseDateWithKeyboard,
  useKeyboardToSubmitOneDay,
};

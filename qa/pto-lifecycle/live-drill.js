'use strict';

/*
 * Opt-in production PTO happy-path drill.
 *
 * This lane is intentionally separate from the default mocked suite. It will
 * not start unless the operator supplies exact private TEST identities, role
 * keys, a service-role cleanup key, and the confirmation phrase. It never
 * prints or commits identities, dates, balances, notes, keys, request IDs, or
 * response bodies. Screenshots stay under .codex-tmp and every overview shown
 * in the browser is a synthetic projection, so no real roster/HR data appears.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, assert, settle } = require('./harness');
const { selectPtoType, pickRange, waitStaffReady, waitAdminReady } = require('./ui');

const PROJECT_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const PTO_URL = `${PROJECT_URL}/functions/v1/pto`;
const PRODUCTION_URL = 'https://syncview.synchrosocial.com';
const PRIVATE_ROOT = path.join(ROOT, '.codex-tmp', 'pto-lifecycle-live');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required private environment variable: ${name}`);
  return value;
}

function configuration() {
  const config = {
    confirm: required('PTO_LIVE_CONFIRM'),
    baseUrl: required('PTO_LIVE_BASE_URL').replace(/\/+$/, ''),
    serviceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    staffKey: required('PTO_LIVE_TEST_ROLE_KEY'),
    adminKey: required('PTO_LIVE_ADMIN_ROLE_KEY'),
    testMember: {
      id: required('PTO_LIVE_TEST_MEMBER_ID'),
      name: required('PTO_LIVE_TEST_MEMBER_NAME'),
      role: required('PTO_LIVE_TEST_MEMBER_ROLE'),
      team: 'TEST',
      active: true,
    },
    testAdmin: {
      id: required('PTO_LIVE_ADMIN_MEMBER_ID'),
      name: required('PTO_LIVE_ADMIN_MEMBER_NAME'),
      role: 'admin',
      team: 'TEST',
      active: true,
    },
  };
  assert(config.confirm === 'DISPOSABLE_UNPAID_ONLY',
    'PTO_LIVE_CONFIRM must equal DISPOSABLE_UNPAID_ONLY');
  assert(config.baseUrl === PRODUCTION_URL, 'Live drill is pinned to the production SyncView origin');
  assert(/^TEST\b/i.test(config.testMember.name) && /^TEST\b/i.test(config.testAdmin.name),
    'Both live drill identities must be dedicated TEST roster rows');
  assert(config.testMember.id !== config.testAdmin.id, 'TEST staff and TEST admin identities must differ');
  return config;
}

function privateHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
    'Cache-Control': 'no-store',
    ...extra,
  };
}

async function privateRest(config, table, query, options = {}) {
  const response = await fetch(`${PROJECT_URL}/rest/v1/${table}?${query}`, {
    ...options,
    headers: privateHeaders(config.serviceKey, options.headers || {}),
  });
  if (!response.ok) throw new Error(`Private live preflight/cleanup failed with HTTP ${response.status}`);
  if (options.method === 'DELETE' || options.method === 'HEAD') return null;
  return response.json();
}

async function exactRows(config, table, filters, select = '*') {
  const query = `${filters}&select=${encodeURIComponent(select)}&limit=2`;
  const rows = await privateRest(config, table, query);
  return Array.isArray(rows) ? rows : [];
}

async function preflight(config) {
  const flagRows = await exactRows(config, 'syncview_runtime_flags', 'key=eq.pto_v1', 'value');
  assert(flagRows.length === 1 && String(flagRows[0]?.value?.mode || '').toLowerCase() === 'on',
    'pto_v1 must already be on');
  const testRows = await exactRows(config, 'team_members',
    `id=eq.${encodeURIComponent(config.testMember.id)}`, 'id,name,role,active');
  const adminRows = await exactRows(config, 'team_members',
    `id=eq.${encodeURIComponent(config.testAdmin.id)}`, 'id,name,role,active');
  assert(testRows.length === 1 && testRows[0].active === true
    && testRows[0].name === config.testMember.name && testRows[0].role === config.testMember.role,
  'dedicated TEST staff identity must match exactly');
  assert(adminRows.length === 1 && adminRows[0].active === true
    && adminRows[0].name === config.testAdmin.name && adminRows[0].role === 'admin',
  'dedicated TEST admin identity must match exactly');
  const ptoRows = await exactRows(config, 'pto_members',
    `member_id=eq.${encodeURIComponent(config.testMember.id)}`, 'member_id,pto_enabled');
  assert(ptoRows.length === 1 && ptoRows[0].pto_enabled === true,
    'dedicated TEST PTO member must already be enabled');
  return JSON.stringify(flagRows[0].value);
}

function addDays(iso, count) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function businessDateFrom(today) {
  let candidate = addDays(today, 21);
  for (let guard = 0; guard < 7; guard += 1) {
    const day = new Date(`${candidate}T12:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) return candidate;
    candidate = addDays(candidate, 1);
  }
  throw new Error('Could not select a disposable future business date');
}

function syntheticBalance(asOf) {
  return {
    pto_enabled: true,
    pto_start_date: '2000-01-01',
    eligibility_date: '2000-03-01',
    eligible: true,
    wellness_granted: 0,
    wellness_approved_used: 0,
    wellness_adjustment: 0,
    wellness_available: 0,
    sick_approved_used: 0,
    sick_adjustment: 0,
    sick_available: 0,
    floating_holiday_used: false,
    floating_holiday_pending: false,
    floating_holiday_status: 'available',
    next_accrual_date: null,
    leave_year_start: `${asOf.slice(0, 4)}-01-01`,
    leave_year_end: `${asOf.slice(0, 4)}-12-31`,
  };
}

function syntheticOverview(config, state, admin = false) {
  const request = state.request ? [{
    id: state.request.id,
    member_id: config.testMember.id,
    member_name: config.testMember.name,
    type: 'unpaid',
    start_date: state.date,
    end_date: state.date,
    days: 1,
    note: 'TEST disposable unpaid drill',
    status: state.status,
    requested_at: state.requestedAt,
    decided_by: state.status === 'approved' ? config.testAdmin.name : null,
    decision_note: '',
    decided_at: state.status === 'approved' ? state.decidedAt : null,
  }] : [];
  const overview = {
    ok: true,
    as_of_date: state.today,
    holiday_date_min: `${Number(state.today.slice(0, 4)) - 1}-01-01`,
    holiday_date_max: `${Number(state.today.slice(0, 4)) + 1}-12-31`,
    pto_enabled: true,
    balance: syntheticBalance(state.today),
    my_balance: syntheticBalance(state.today),
    holidays: [],
    members: [
      { name: config.testMember.name, wellness_available: 0, on_leave_today: false },
      { name: config.testAdmin.name, wellness_available: 0, on_leave_today: false },
    ],
    absences: state.status === 'approved'
      ? [{ member_name: config.testMember.name, start_date: state.date, end_date: state.date }]
      : [],
    my_requests: request,
    requests: request,
  };
  if (admin) {
    overview.pending_requests = request.filter(row => row.status === 'pending');
    overview.upcoming_approved_requests = request.filter(row => row.status === 'approved');
    overview.recent_requests = request.filter(row => row.status !== 'pending');
    overview.admin_members = [
      {
        member_id: config.testMember.id,
        name: config.testMember.name,
        role: config.testMember.role,
        team: 'TEST',
        pto_start_date: '2000-01-01',
        pto_enabled: true,
        wellness_granted: 0,
        wellness_approved_used: 0,
        wellness_adjustment: 0,
        wellness_available: 0,
        sick_available: 0,
      },
      {
        member_id: config.testAdmin.id,
        name: config.testAdmin.name,
        role: 'admin',
        team: 'TEST',
        pto_start_date: '2000-01-01',
        pto_enabled: true,
        wellness_granted: 0,
        wellness_approved_used: 0,
        wellness_adjustment: 0,
        wellness_available: 0,
        sick_available: 0,
      },
    ];
  }
  return overview;
}

function exactObjectKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = expected.slice().sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

async function productionContext(browser, config, identity, state, admin) {
  const context = await browser.newContext({
    viewport: { width: 1360, height: 920 },
    colorScheme: 'light',
    timezoneId: 'America/Guatemala',
  });
  const key = admin ? config.adminKey : config.staffKey;
  await context.addInitScript(({ member, roleKey }) => {
    localStorage.setItem('syncview_auth_v1', 'ok');
    localStorage.setItem('syncview_staff_identity_v1', JSON.stringify({
      key: roleKey,
      role: member.role,
      member,
      verified_at: new Date().toISOString(),
    }));
    sessionStorage.setItem('syncview_kasper_unlocked', 'ok');
  }, { member: identity, roleKey: key });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const block = () => {
      state.ledger.blockedOperations += 1;
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ ok: false, error: 'live_drill_operation_blocked' }),
      });
    };
    if (url.origin === config.baseUrl) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) return block();
      return route.continue();
    }
    let body = {};
    try { body = request.postDataJSON() || {}; } catch (_) {}
    if (url.pathname.endsWith('/rest/v1/syncview_runtime_flags')) {
      if (method === 'OPTIONS') return route.fetch();
      if (method !== 'GET' || url.searchParams.get('key') !== 'eq.pto_v1') return block();
      return route.continue();
    }
    if (url.pathname.endsWith('/rest/v1/team_members')) {
      if (method === 'OPTIONS') return route.fetch();
      if (method !== 'GET') return block();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([config.testMember, config.testAdmin]),
      });
    }
    if (url.pathname.endsWith('/functions/v1/key-verify')) {
      if (method === 'OPTIONS') return route.fetch();
      if (
        method !== 'POST'
        || String(body?.member?.id || '') !== identity.id
        || !exactObjectKeys(body, ['surface', 'member'])
        || !exactObjectKeys(body.member, ['id'])
      ) return block();
      return route.continue();
    }
    if (url.pathname.endsWith('/functions/v1/pto')) {
      const action = String(url.searchParams.get('action') || body.action || '');
      if (method === 'OPTIONS') return route.fetch();
      if (action === 'overview') {
        if (
          method !== 'GET'
          || String(url.searchParams.get('member_id') || '') !== identity.id
        ) return block();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(syntheticOverview(config, state, admin)),
        });
      }
      if (action === 'quote') {
        const exactQuote = !admin
          && method === 'POST'
          && exactObjectKeys(body, ['action', 'member_id', 'type', 'start_date', 'end_date'])
          && body.action === 'quote'
          && body.member_id === config.testMember.id
          && body.type === 'unpaid'
          && body.start_date === state.date
          && body.end_date === state.date;
        if (!exactQuote || state.ledger.quoteAttempts >= 4) return block();
        state.ledger.quoteAttempts += 1;
      } else if (action === 'request') {
        const exactRequest = !admin
          && method === 'POST'
          && exactObjectKeys(body, ['action', 'member_id', 'type', 'start_date', 'end_date', 'days', 'note'])
          && body.action === 'request'
          && body.member_id === config.testMember.id
          && body.type === 'unpaid'
          && body.start_date === state.date
          && body.end_date === state.date
          && Number(body.days) === 1
          && body.note === state.marker;
        if (!exactRequest || state.ledger.requestAttempts !== 0) return block();
        // Consume the sole live-request budget before touching the network. A
        // lost response must fail into marker-based cleanup, never auto-retry.
        state.ledger.requestAttempts += 1;
      } else if (action === 'decide') {
        const exactDecision = admin
          && method === 'POST'
          && exactObjectKeys(body, ['action', 'actor_member_id', 'request_id', 'decision', 'decision_note'])
          && body.action === 'decide'
          && body.actor_member_id === config.testAdmin.id
          && !!state.request?.id
          && body.request_id === state.request.id
          && body.decision === 'approved'
          && body.decision_note === '';
        if (!exactDecision || state.ledger.decideAttempts !== 0) return block();
        state.ledger.decideAttempts += 1;
      } else {
        // cancel, adjust, set_start_date, and every unknown action are outside
        // this disposable unpaid happy-path drill.
        return block();
      }
      const response = await route.fetch();
      let data = {};
      try { data = await response.json(); } catch (_) {}
      if (action === 'quote') {
        return route.fulfill({
          status: response.status(),
          contentType: 'application/json',
          body: JSON.stringify({
            ok: response.ok() && data.ok !== false,
            full_days: Number(data.full_days || 0),
            partial_day_count: Number(data.partial_day_count || 0),
            ...(response.ok() ? {} : { error: 'live_quote_failed' }),
          }),
        });
      }
      if (action === 'request' && response.ok() && data?.request?.id) {
        state.request = { id: String(data.request.id) };
        state.ledger.requestIds.push(state.request.id);
        state.status = 'pending';
        state.requestedAt = new Date().toISOString();
      }
      if (action === 'decide' && response.ok() && data?.request?.status === 'approved') {
        state.status = 'approved';
        state.decidedAt = new Date().toISOString();
      }
      return route.fulfill({
        status: response.status(),
        contentType: 'application/json',
        body: JSON.stringify(response.ok()
          ? { ok: true, request: syntheticOverview(config, state, admin).my_requests[0] || null }
          : { ok: false, error: `live_${action}_failed` }),
      });
    }
    if (['font', 'image', 'stylesheet', 'script'].includes(request.resourceType())) return route.abort();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return block();
  });
  return context;
}

async function screenshot(page, file) {
  const full = path.resolve(file);
  assert(full.startsWith(path.resolve(PRIVATE_ROOT) + path.sep),
    'Live screenshots must stay under the private untracked output root');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  await settle(page);
  await page.screenshot({
    path: full,
    type: 'jpeg',
    quality: 76,
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
  });
}

function exactMarkerFilters(config, state) {
  return [
    `member_id=eq.${encodeURIComponent(config.testMember.id)}`,
    'source=eq.syncview',
    `note=eq.${encodeURIComponent(state.marker)}`,
  ].join('&');
}

async function exactDrillRows(config, state, select = 'id,status') {
  return exactRows(config, 'pto_requests', exactMarkerFilters(config, state), select);
}

async function exactCleanup(config, state) {
  const filters = exactMarkerFilters(config, state);
  const rows = await exactDrillRows(config, state, 'id');
  const duplicateDetected = rows.length > 1;
  const capturedIdMissing = !!state.request?.id
    && !rows.some(row => String(row.id || '') === state.request.id);
  if (rows.length) {
    // The random marker had zero preexisting matches. If a product regression
    // created duplicates, remove every row owned by this one drill before
    // reporting the failure so production is never left dirty.
    await privateRest(config, 'pto_requests', filters, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
  }
  const residue = await exactDrillRows(config, state, 'id');
  assert(residue.length === 0, 'exact disposable request cleanup must leave zero request-row residue');
  assert(!capturedIdMissing, 'captured disposable request must match the exact cleanup marker');
  assert(!duplicateDetected, 'disposable drill must never create duplicate request rows');
}

(async () => {
  const config = configuration();
  fs.mkdirSync(PRIVATE_ROOT, { recursive: true });
  const beforeFlag = await preflight(config);
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guatemala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const state = {
    today,
    date: businessDateFrom(today),
    marker: `TEST PTO lifecycle ${crypto.randomUUID()}`,
    request: null,
    status: '',
    requestedAt: '',
    decidedAt: '',
    ledger: {
      quoteAttempts: 0,
      requestAttempts: 0,
      requestIds: [],
      decideAttempts: 0,
      blockedOperations: 0,
      pendingReadback: false,
      approvedReadback: false,
    },
  };
  const preexisting = await exactRows(config, 'pto_requests',
    `member_id=eq.${encodeURIComponent(config.testMember.id)}&note=eq.${encodeURIComponent(state.marker)}`, 'id');
  assert(preexisting.length === 0, 'unique TEST marker must have zero preexisting rows');

  let browser;
  let staffContext;
  let adminContext;
  let interactionError = null;
  let cleanupError = null;
  let flagError = null;
  try {
    browser = await chromium.launch({ headless: true });
    staffContext = await productionContext(browser, config, config.testMember, state, false);
    const staff = await staffContext.newPage();
    await staff.goto(`${config.baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await staff.waitForFunction(() => typeof navTo === 'function'
      && document.getElementById('headerTimeOffMenuItem')?.hidden === false);
    await staff.locator('#headerMenuButton').click();
    await staff.locator('#headerTimeOffMenuItem').click();
    await waitStaffReady(staff);
    await screenshot(staff, path.join(PRIVATE_ROOT, '01-staff-ready.jpg'));
    await selectPtoType(staff, 'unpaid');
    await pickRange(staff, state.date, state.date);
    assert(await staff.locator('#ptoDays').inputValue() === '1', 'live quote must return one real day');
    await screenshot(staff, path.join(PRIVATE_ROOT, '02-real-quote.jpg'));
    await staff.locator('#ptoNote').fill(state.marker);
    await staff.locator('#ptoSubmit').click();
    await waitStaffReady(staff);
    assert(state.request && state.status === 'pending', 'live request must be captured as pending');
    const pendingRows = await exactDrillRows(config, state, 'id,status');
    assert(
      pendingRows.length === 1
        && String(pendingRows[0].id || '') === state.request.id
        && pendingRows[0].status === 'pending',
      'live request must read back as the exact pending disposable row',
    );
    state.ledger.pendingReadback = true;
    await screenshot(staff, path.join(PRIVATE_ROOT, '03-request-pending.jpg'));

    adminContext = await productionContext(browser, config, config.testAdmin, state, true);
    const admin = await adminContext.newPage();
    await admin.goto(`${config.baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await admin.waitForFunction(() => typeof navTo === 'function'
      && typeof _kasperState !== 'undefined'
      && document.getElementById('navKasper')?.style.display !== 'none');
    await admin.locator('#navKasper').click();
    const moreTrigger = admin.locator('[data-kasper-more-trigger]');
    await moreTrigger.waitFor({ state: 'visible' });
    await moreTrigger.click();
    const timeOffTab = admin.locator(
      '#kasperMoreMenu .kasper-more-item[data-kasper-tab="time-off"]',
    );
    await timeOffTab.waitFor({ state: 'visible' });
    await timeOffTab.click();
    assert(await timeOffTab.getAttribute('aria-current') === 'page'
      || await timeOffTab.evaluate(element => element.classList.contains('active')),
    'live drill opens Kasper Time Off through the released More menu');
    await waitAdminReady(admin);
    const card = admin.locator('.pto-request-card', { hasText: 'TEST disposable unpaid drill' }).first();
    await card.locator('button.approve').click();
    await waitAdminReady(admin);
    assert(state.status === 'approved', 'live request must be approved');
    const approvedRows = await exactDrillRows(config, state, 'id,status');
    assert(
      approvedRows.length === 1
        && String(approvedRows[0].id || '') === state.request.id
        && approvedRows[0].status === 'approved',
      'live request must read back as the exact approved disposable row',
    );
    state.ledger.approvedReadback = true;
    await screenshot(admin, path.join(PRIVATE_ROOT, '04-request-approved.jpg'));
  } catch (error) {
    interactionError = error;
  } finally {
    try {
      await exactCleanup(config, state);
    } catch (error) {
      cleanupError = error;
    }
    try {
      const afterRows = await exactRows(config, 'syncview_runtime_flags', 'key=eq.pto_v1', 'value');
      assert(afterRows.length === 1 && JSON.stringify(afterRows[0].value) === beforeFlag,
        'pto_v1 must remain byte-equal with no flag write');
    } catch (error) {
      flagError = error;
    }
    if (adminContext) await adminContext.close().catch(() => {});
    if (staffContext) await staffContext.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  if (cleanupError) throw new Error('PTO live disposable cleanup failed');
  if (flagError) throw new Error('PTO live runtime-flag readback failed');
  if (interactionError) throw new Error('PTO live disposable interaction failed after guarded cleanup');
  assert(state.ledger.quoteAttempts >= 1 && state.ledger.quoteAttempts <= 4,
    'live drill must make only the bounded exact quote calls');
  assert(state.ledger.requestAttempts === 1 && state.ledger.requestIds.length === 1,
    'live drill must make one exact disposable request write');
  assert(state.ledger.decideAttempts === 1,
    'live drill must make one exact disposable approval write');
  assert(state.ledger.pendingReadback && state.ledger.approvedReadback,
    'live drill must read back both pending and approved states');
  assert(state.ledger.blockedOperations === 0,
    'live drill must not attempt any operation outside its exact allowlist');
  console.log('PTO live disposable lane passed: submit, approve, exact delete, zero request-row residue, runtime flag unchanged.');
})().catch(error => {
  // Error text is intentionally configuration/status-only. No response body,
  // identity, date, balance, note, key, or request identifier is printed.
  console.error(error && error.message ? error.message : 'PTO live disposable lane failed');
  process.exitCode = 1;
});

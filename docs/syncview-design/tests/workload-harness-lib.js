'use strict';

/*
 * SHARED BOOT + MOCK RIG for the two Workload workday-calendar browser suites
 * (`workload-board-browser.js`, `workload-render-browser.js`).
 *
 * Same shape as `prod-write-gateway-browser.js`: the real `index.html` served
 * from a loopback static server, driven in a real headless Chromium, with
 * EVERY backend call answered from this file. Nothing here reaches a network:
 * a catch-all route aborts anything the suites did not deliberately mock, so a
 * forgotten endpoint fails loudly and offline instead of quietly hitting the
 * live project.
 *
 * PUBLIC-SAFETY. The repo is public and `scripts/repo-identity-exposure-check.js`
 * fails on any live client slug or staff full name a change ADDS. So every
 * fixture here is invented -- clients are "Client A/B/C", editors are
 * "editor-1"/"editor-2"/"designer-1" -- and the app's hardcoded rosters are
 * WIDENED at runtime rather than matched. Two of the board's filters are
 * allow-lists (`WL_ALLOWED_EDITORS`/`WL_ALLOWED_GRAPHICS` for people,
 * `WL_CLIENT_CANONICAL` for clients), so an invented name is dropped before it
 * can reach a single strip. `injectRoster()` below adds the fixture names to
 * those in-page sets from an init script; nothing real is referenced.
 *
 * DETERMINISM. `wlWorkloadTodayISO()` reads the wall clock through an
 * America/Guatemala formatter, and EVERY placement rule (the automatic
 * due-1-working-day estimate, the today floor, the today->ideal placement
 * window) is derived from it. So the clock is pinned in an init script before
 * any app code runs; the suites then assert exact ISO days rather than
 * "whatever this week is".
 */

/*
 * HOW TO RUN
 *   node docs/syncview-design/tests/workload-board-browser.js    (interaction)
 *   node docs/syncview-design/tests/workload-render-browser.js   (structure)
 *
 * By path, deliberately, with no npm script alias. package.json is inside the
 * leave-evidence source fingerprint (test/leave-evidence-fingerprint-coupling.js),
 * so adding two script lines invalidates a published evidence packet and, by
 * that test's own warning, costs a human review of every screenshot in it —
 * for aliases that have nothing to do with the leave feature. Not worth it:
 * the sibling browser suites are invoked by path from their workflow lanes
 * anyway.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { seedStaffIdentity } = require('../../../qa/staff-gate-seed.js');

const root = path.resolve(__dirname, '..', '..', '..');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ── The pinned week ──────────────────────────────────────────────────────
// Monday 2026-09-14 .. Friday 2026-09-18, 09:00 in the board's own time zone.
const NOW_EPOCH_MS = Date.parse('2026-09-14T15:00:00.000Z');
const MON = '2026-09-14';
const TUE = '2026-09-15';
const WED = '2026-09-16';
const THU = '2026-09-17';
const FRI = '2026-09-18';
const NEXT_MON = '2026-09-21';
const SAT = '2026-09-19';
const WEEK = [MON, TUE, WED, THU, FRI];

// Invented people. `wlNormalizeEditor` strips separators, so "editor-1"
// normalises to "editor1" -- that is the token the in-page allow-list holds.
const EDITOR_1 = { id: 'ed-1', name: 'editor-1', norm: 'editor1' };
const EDITOR_2 = { id: 'ed-2', name: 'editor-2', norm: 'editor2' };
const DESIGNER_1 = { id: 'des-1', name: 'designer-1', norm: 'designer1' };
// Invented clients.
const CLIENTS = ['Client A', 'Client B', 'Client C'];

/* One fixture sub-issue, in the shape `workload_issues` returns and
 * `_wlV2MapRow` consumes. Everything not named defaults to an active,
 * assigned, video-team row so each suite states only what it is testing. */
function issueRow(overrides) {
  const base = {
    id: 'issue-x',
    identifier: 'VID-000',
    title: 'Fixture sub-issue',
    url: 'https://example.invalid/issue',
    is_sub_issue: true,
    parent_id: 'parent-1',
    parent_identifier: 'VID-PARENT',
    due_date: null,
    status: 'To Do',
    status_type: 'unstarted',
    team_key: 'VID',
    team_name: 'Video',
    assignee_id: EDITOR_1.id,
    assignee_name: EDITOR_1.name,
    assignee_email: null,
    client_name: 'Client A',
    linear_created_at: '2026-09-01T00:00:00.000Z',
    linear_updated_at: '2026-09-01T00:00:00.000Z',
    synced_at: '2026-09-14T14:00:00.000Z',
    sort_order: 1,
  };
  return { ...base, ...(overrides || {}) };
}

function parentRow(overrides) {
  return issueRow({
    id: 'parent-1',
    identifier: 'VID-PARENT',
    title: 'Fixture parent',
    is_sub_issue: false,
    parent_id: null,
    assignee_id: null,
    assignee_name: null,
    ...(overrides || {}),
  });
}

/*
 * The harness. `options`:
 *   issues        array of workload_issues rows (defaults to []).
 *   plans         array of { issue_id, plan_date } saved pins.
 *   weights       { issueId: 2|3 } -- rendered as the exact "2x/3x Workload"
 *                 labels the native metadata read carries.
 *   role          staff role for key-verify ('admin' default; 'creative' is
 *                 the read-only planner).
 *   planListStatus  force the saved-plan LIST read to fail with this status.
 *   holdMetadata  hold the weight/metadata read open, parking the board in its
 *                 fast first paint until `state.releaseMetadata()` is called.
 *   query         extra query string for the boot URL (e.g. 'wl2=0'), before the
 *                 #workload hash.
 *   holdIssues    hold the issue snapshot read open until `state.releaseIssues()`
 *                 is called; `state.holdIssuesRead()` re-arms it before a reload.
 */
async function launchWorkloadHarness(options) {
  const opts = options || {};
  const role = opts.role || 'admin';
  const member = { id: 'qa_staff', name: 'QA Staff', role, team: null };
  const state = {
    issues: (opts.issues || []).slice(),
    plans: new Map((opts.plans || []).map(row => [String(row.issue_id), String(row.plan_date)])),
    weights: { ...(opts.weights || {}) },
    planWrites: [],          // every `set` body the board sent
    planWriteStatus: 200,    // flipped by the refusal phases
    planListStatus: opts.planListStatus || 200,
    blockedRequests: [],     // anything the catch-all had to abort
    pageErrors: [],
    notifications: [],       // showNotify(title, body) calls
    holdMetadata: null,      // a promise the weight/metadata read waits on
    releaseMetadata: null,
    holdIssues: null,        // a promise the issue snapshot read waits on
    releaseIssues: null,
  };
  state.holdIssuesRead = () => { state.holdIssues = new Promise(resolve => { state.releaseIssues = resolve; }); };
  if (opts.holdIssues) state.holdIssuesRead();
  /* HOLDING THE BOARD IN ITS FAST FIRST PAINT.
   * `wlLoadSnapshot` awaits the issues AND the saved-plan read together, then
   * fast-paints with `planLoading` true, and only ADOPTS the plans after the
   * Linear/native weight metadata resolves. So the window where a card is
   * placed at its automatic estimate and labelled "Planning…" is bounded by
   * the METADATA read, not the plan read -- holding the plan read holds the
   * whole board instead, and shows nothing. */
  if (opts.holdMetadata) {
    state.holdMetadata = new Promise(resolve => { state.releaseMetadata = resolve; });
  }

  const server = await serve();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', error => state.pageErrors.push(error.stack || error.message));

  // 1. Pin the clock BEFORE any app script observes it.
  await context.addInitScript(fixedNow => {
    const RealDate = Date;
    function PinnedDate(...args) {
      if (!(this instanceof PinnedDate)) return new RealDate(fixedNow).toString();
      return args.length ? new RealDate(...args) : new RealDate(fixedNow);
    }
    PinnedDate.prototype = RealDate.prototype;
    PinnedDate.now = () => fixedNow;
    PinnedDate.parse = RealDate.parse;
    PinnedDate.UTC = RealDate.UTC;
    // eslint-disable-next-line no-global-assign
    Date = PinnedDate;
  }, NOW_EPOCH_MS);

  // 2. Widen the in-page rosters to the invented fixture names, and record
  //    every showNotify() so the refusal phases can assert the user was told.
  await context.addInitScript(payload => {
    const timer = setInterval(() => {
      if (typeof window.wlMergeClientsFromSheet !== 'function') return;
      clearInterval(timer);
      try { window.wlMergeClientsFromSheet(payload.clients); } catch (e) {}
      try { for (const n of payload.editors) WL_ALLOWED_EDITORS.add(n); } catch (e) {}
      try { for (const n of payload.designers) WL_ALLOWED_GRAPHICS.add(n); } catch (e) {}
    }, 2);
    setTimeout(() => clearInterval(timer), 30000);

    window.__wlNotices = [];
    const notifyTimer = setInterval(() => {
      if (typeof window.showNotify !== 'function') return;
      clearInterval(notifyTimer);
      const real = window.showNotify;
      window.showNotify = function (title, body) {
        window.__wlNotices.push({ title: String(title || ''), body: String(body || '') });
        try { return real.apply(this, arguments); } catch (e) { return undefined; }
      };
    }, 2);
    setTimeout(() => clearInterval(notifyTimer), 30000);
  }, {
    clients: CLIENTS,
    editors: [EDITOR_1.norm, EDITOR_2.norm],
    designers: [DESIGNER_1.norm],
  });

  // 3. Catch-all FIRST (Playwright tries the most recently registered route
  //    first), so every mock below wins and everything else is refused.
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(`http://127.0.0.1:${server.address().port}/`)) return route.continue();
    state.blockedRequests.push(url);
    return route.abort();
  });

  await seedStaffIdentity(context, member);
  await context.route('**/functions/v1/key-verify', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, role, member }),
  }));

  // The board's issue snapshot.
  await context.route('**/rest/v1/workload_issues**', async route => {
    if (state.holdIssues) await state.holdIssues;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.issues) });
  });

  // Per-team due-date authority. Both teams SyncView-authoritative, mirroring
  // the live flag after the 2026-08-28 video flip.
  await context.route('**/rest/v1/syncview_runtime_flags**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ key: 'prod_authority', value: { video: 'syncview', graphics: 'syncview' } }]),
  }));

  /* Native metadata: one row per active sub-issue, carrying the workload
   * label that decides its capacity weight. `workload_labels_complete` must be
   * true and every label node must have a unique id, or `wlNativeMetadataRow`
   * refuses to prove the row (fail-closed) and it loses its due date. */
  await context.route('**/rest/v1/production_deliverables_browser_v1**', async route => {
    if (state.holdMetadata) await state.holdMetadata;
    const rows = state.issues.filter(row => row.is_sub_issue).map(row => {
      const weight = Number(state.weights[row.id]) || 1;
      const labels = weight === 2 || weight === 3
        ? [{ id: `label-${weight}`, name: `${weight}× Workload`, color: '#F59E0B' }]
        : [];
      return {
        id: `native-${row.id}`,
        client_slug: `fixture-${String(row.client_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        team: row.team_name,
        linear_issue_uuid: row.id,
        due_date: row.due_date,
        updated_at: '2026-09-14T14:00:00.000Z',
        workload_labels_complete: true,
        workload_labels: labels,
      };
    });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });

  // The saved-plan sidecar: the only write path this surface has.
  await context.route('**/functions/v1/workload-plan', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.action === 'list') {
      if (state.planListStatus !== 200) {
        return route.fulfill({
          status: state.planListStatus,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'plan_read_refused' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          plans: [...state.plans].map(([issue_id, plan_date]) => ({ issue_id, plan_date })),
        }),
      });
    }
    if (body.action === 'set') {
      state.planWrites.push(body);
      const status = state.planWriteStatus;
      if (status !== 200) {
        return route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'plan_write_refused' }),
        });
      }
      if (body.plan_date == null) state.plans.delete(String(body.issue_id));
      else state.plans.set(String(body.issue_id), String(body.plan_date));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          updated: 1,
          plan: { issue_id: body.issue_id, plan_date: body.plan_date },
        }),
      });
    }
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  });

  const query = opts.query ? '?' + String(opts.query).replace(/^\?/, '') : '';
  await page.goto(`http://127.0.0.1:${server.address().port}/${query}#workload`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.workload-view', { timeout: 20000 });

  const close = async () => {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  };

  return { page, context, browser, server, state, close };
}

/* Wait until the board has an authoritative saved-plan snapshot (or has
 * definitively failed to get one), so a suite never asserts against the fast
 * first paint by accident. */
async function waitForPlanSettled(page) {
  await page.waitForFunction(
    () => typeof wlState === 'object' && wlState.planLoading === false
      && ['ready', 'stale', 'unknown'].includes(wlState.planStatus),
    null, { timeout: 15000 },
  );
}

/* Read the board back as plain data: which day each card sits on, what its
 * placement label claims, and which cards are draggable. */
async function readBoard(page) {
  return page.evaluate(() => {
    const cards = [];
    document.querySelectorAll('.workload-view .workload-grid [data-wl-day]').forEach(day => {
      const iso = day.getAttribute('data-wl-day') || '';
      day.querySelectorAll('.workload-plan-item[data-wl-issue-id]').forEach(item => {
        const origin = item.querySelector('.wl-plan-origin');
        cards.push({
          id: item.getAttribute('data-wl-issue-id') || '',
          day: iso,
          client: item.getAttribute('data-wl-client') || '',
          assigneeId: item.getAttribute('data-wl-assignee-id') || '',
          label: origin ? (origin.getAttribute('aria-label') || '') : '',
          mode: origin ? (origin.className.match(/is-([a-z]+)/) || [, ''])[1] : '',
          weightBadge: (item.querySelector('.wl-workload-badge') || {}).textContent || '',
          draggable: !!item.querySelector('[data-wl-drag-handle="issue"]'),
        });
      });
    });
    const days = [...document.querySelectorAll('.workload-view .workload-grid.week [data-wl-day]')]
      .map(day => ({
        iso: day.getAttribute('data-wl-day') || '',
        overCapacity: day.classList.contains('over-capacity'),
        count: Number((day.querySelector('.workload-day-count') || {}).textContent || 0),
        totals: [...day.querySelectorAll('.workload-day-card')].map(card => ({
          editor: (card.querySelector('.workload-day-card-name') || {}).textContent || '',
          total: (card.querySelector('.workload-day-card-total') || {}).textContent || '',
          over: !!(card.querySelector('.workload-day-card-total.over-capacity')),
          clients: [...card.querySelectorAll('.workload-day-card-chip-name')].map(el => el.textContent),
        })),
      }));
    const status = document.getElementById('wlPlanStatus');
    return {
      cards,
      days,
      planStatus: status && !status.hidden ? status.textContent.trim() : '',
      groupHandles: document.querySelectorAll('.workload-view [data-wl-drag-handle="group"]').length,
    };
  });
}

function dayOf(board, issueId) {
  const hit = board.cards.find(card => card.id === issueId);
  return hit ? hit.day : '';
}

/*
 * A drag, driven through the page's own delegated dragstart/dragover/drop
 * listeners.
 *
 * The cards live inside a collapsed <details>, so Playwright's mouse-driven
 * dragTo cannot reach a handle without first opening every group -- which is a
 * different interaction from the one under test and would make the suite
 * assert on disclosure state instead of planning. The handlers themselves read
 * only `e.target`, `e.clientX` and the root dataset (`e.dataTransfer` is
 * guarded on every use), so dispatching the real event sequence at the real
 * elements exercises the same code path the mouse would.
 */
async function dragIssueToDay(page, issueId, targetISO) {
  const moved = await page.evaluate(({ issueId, targetISO }) => {
    const handle = document.querySelector(`[data-wl-drag-handle="issue"][data-wl-plan-drag="${issueId}"]`);
    const day = document.querySelector(`.workload-view .workload-grid [data-wl-day="${targetISO}"]`);
    if (!handle || !day) return { ok: false, reason: !handle ? 'no-handle' : 'no-day' };
    handle.dispatchEvent(new MouseEvent('dragstart', { bubbles: true, cancelable: true }));
    day.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true }));
    day.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true }));
    day.dispatchEvent(new MouseEvent('dragend', { bubbles: true, cancelable: true }));
    return { ok: true };
  }, { issueId, targetISO });
  return moved;
}

async function dragGroupToDay(page, sourceISO, assigneeId, clientName, targetISO) {
  return page.evaluate(({ sourceISO, assigneeId, clientName, targetISO }) => {
    const handle = [...document.querySelectorAll('[data-wl-drag-handle="group"]')].find(el =>
      el.getAttribute('data-wl-date') === sourceISO
      && el.getAttribute('data-wl-assignee-id') === assigneeId
      && el.getAttribute('data-wl-client') === clientName);
    const day = document.querySelector(`.workload-view .workload-grid [data-wl-day="${targetISO}"]`);
    if (!handle || !day) return { ok: false, reason: !handle ? 'no-handle' : 'no-day' };
    handle.dispatchEvent(new MouseEvent('dragstart', { bubbles: true, cancelable: true }));
    day.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true }));
    day.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true }));
    day.dispatchEvent(new MouseEvent('dragend', { bubbles: true, cancelable: true }));
    return { ok: true };
  }, { sourceISO, assigneeId, clientName, targetISO });
}

// Wait until the board has stopped writing (every in-flight plan save settled).
async function waitForPlanIdle(page) {
  await page.waitForFunction(
    () => _wlPlanWriteInFlight.size === 0,
    null, { timeout: 15000 },
  );
}

async function waitForWrites(state, count, what) {
  const deadline = Date.now() + 15000;
  while (state.planWrites.length < count) {
    if (Date.now() > deadline) throw new Error(`no plan write for ${what} within 15s`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return state.planWrites[state.planWrites.length - 1];
}

async function notices(page) {
  return page.evaluate(() => (window.__wlNotices || []).slice());
}

async function clearNotices(page) {
  await page.evaluate(() => { window.__wlNotices = []; });
}

module.exports = {
  launchWorkloadHarness,
  waitForPlanSettled,
  waitForPlanIdle,
  waitForWrites,
  readBoard,
  dayOf,
  dragIssueToDay,
  dragGroupToDay,
  notices,
  clearNotices,
  issueRow,
  parentRow,
  NOW_EPOCH_MS,
  MON, TUE, WED, THU, FRI, SAT, NEXT_MON, WEEK,
  EDITOR_1, EDITOR_2, DESIGNER_1, CLIENTS,
};

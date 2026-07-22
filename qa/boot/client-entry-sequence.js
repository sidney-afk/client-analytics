'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const INDEX_HTML = fs.readFileSync(INDEX_PATH, 'utf8');
const MAIN_SCRIPT_MARKER = '<script>\n    const SYNCVIEW_THEME_KEY';
const MAIN_SCRIPT_OFFSET = INDEX_HTML.indexOf(MAIN_SCRIPT_MARKER);

assert.notEqual(
  MAIN_SCRIPT_OFFSET,
  -1,
  'stream split marker must stay immediately before the main application script',
);

const STREAM_PREFIX = INDEX_HTML.slice(0, MAIN_SCRIPT_OFFSET);
const STREAM_SUFFIX = INDEX_HTML.slice(MAIN_SCRIPT_OFFSET);
const BFCACHE_INDEX_HTML = INDEX_HTML
  .replace(/^\s*<link rel="preconnect" href="https:\/\/[^"]+"(?: crossorigin)?>\s*$/gm, '')
  .replace(/^\s*<link href="https:\/\/fonts\.googleapis\.com\/[^"]+" rel="stylesheet">\s*$/gm, '')
  .replace(/^\s*<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@[^"]+" defer><\/script>\s*$/gm, '');
const BFCACHE_MAIN_SCRIPT_OFFSET = BFCACHE_INDEX_HTML.indexOf(MAIN_SCRIPT_MARKER);
assert.notEqual(
  BFCACHE_MAIN_SCRIPT_OFFSET,
  -1,
  'BFCache stream split marker must stay immediately before the main application script',
);
const BFCACHE_STREAM_PREFIX = BFCACHE_INDEX_HTML.slice(0, BFCACHE_MAIN_SCRIPT_OFFSET);
const BFCACHE_STREAM_SUFFIX = BFCACHE_INDEX_HTML.slice(BFCACHE_MAIN_SCRIPT_OFFSET);
const CLIENT_A = 'Boot Fixture Client';
const CLIENT_B = 'Residual Fixture Client';
const CLIENT_A_SLUG = 'bootfixtureclient';
const CURRENT_TOKEN = 'synthetic-current-token';
const CALENDAR_LEGACY_OUTBOX_KEY = 'syncview_linear_outbox_v1';
const CALENDAR_CARD_JOBS_KEY = 'syncview_calCardJobs_v1';
let passedGroups = 0;

function passGroup(label) {
  passedGroups += 1;
  console.log(`PASS ${label}`);
}

const METRICS_CSV = [
  'client_name,date,ig_followers,ig_avg_views,ig_views_this_month,ig_views_gained_today',
  `${CLIENT_A},2026-07-19,1234,321,8765,55`,
  `${CLIENT_B},2026-07-19,987,210,6543,34`,
].join('\n');

const CLIENTS_CSV = [
  'client_name,content_description,instagram_handle',
  `${CLIENT_A},Fictional browser-only fixture,boot_fixture`,
  `${CLIENT_B},Fictional residual-preference fixture,residual_fixture`,
].join('\n');

const TOP_VIDEOS_CSV = 'client_name,platform,period,rank,video_url,caption,views,likes,comments,shares\n';
const BRIEFS_CSV = [
  'id,client_name,raw_json',
  `synthetic-brief-1,${CLIENT_A},"{""synthetic"":true}"`,
].join('\n');
const MR_BRIEFS_CSV = 'client_name,brief_name,brief_date,brief_content\n';
const SUMMARIES_CSV = 'client_name,date,bullets\n';

const SAMPLE_ROWS = [{
  id: 'synthetic-sample-a-1',
  client: CLIENT_A_SLUG,
  name: 'Synthetic review card A',
  status: 'Client Approval',
  video_status: 'Client Approval',
  graphic_status: 'In Progress',
  order_index: 1,
  updated_at: '2026-07-19T12:00:00.000Z',
  comments: [],
  graphic_comments: [],
}];
const CALENDAR_ROWS = [{
  id: 'synthetic-calendar-a-1',
  client: CLIENT_A_SLUG,
  name: 'Synthetic revoked Calendar row',
  status: 'Draft',
  scheduled_date: '2026-07-20',
  order_index: 1,
  updated_at: '2026-07-20T12:00:00.000Z',
  comments: [],
  graphic_comments: [],
}];
const LINEAR_LEASE_IDENT = 'VID-9101';
const LINEAR_LEASE_URL = `https://linear.app/synthetic/issue/${LINEAR_LEASE_IDENT}/lease-guard`;
const V1_CALENDAR_ROWS = {
  [CLIENT_A_SLUG]: [{
    ...CALENDAR_ROWS[0],
    id: 'synthetic-v1-linear-a',
    name: 'Synthetic stale Linear A row',
    linear_issue_id: LINEAR_LEASE_URL,
    video_status: 'In Progress',
    status: 'In Progress',
    updated_at: '2020-01-01T00:00:00.000Z',
  }],
  residualfixtureclient: [{
    ...CALENDAR_ROWS[0],
    id: 'synthetic-v1-linear-b',
    client: 'residualfixtureclient',
    name: 'Synthetic current Linear B row',
    linear_issue_id: LINEAR_LEASE_URL,
    video_status: 'In Progress',
    status: 'In Progress',
    updated_at: '2020-01-01T00:00:00.000Z',
  }],
};
const STAFF_BFCACHE_ROWS = [
  [{
    ...CALENDAR_ROWS[0],
    id: 'synthetic-staff-suspended-row',
    name: 'Synthetic suspended staff row',
  }],
  [{
    ...CALENDAR_ROWS[0],
    id: 'synthetic-staff-resumed-row',
    name: 'Synthetic resumed staff row',
  }],
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jsonBody(value) {
  return JSON.stringify(value);
}

function startStreamServer() {
  const pending = [];
  const waiters = [];

  function enqueue(item) {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(item);
    else pending.push(item);
  }

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'HEAD') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        etag: '"synthetic-boot-build"',
      });
      response.end();
      return;
    }
    if (requestUrl.pathname === '/boot-away') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end('<!doctype html><html><body><main data-boot-away>Outside the client entry document</main></body></html>');
      return;
    }
    const isBfcacheDocument = requestUrl.pathname === '/bfcache.html';
    if (requestUrl.pathname !== '/' && requestUrl.pathname !== '/index.html' && !isBfcacheDocument) {
      response.writeHead(204, { 'cache-control': 'no-store' });
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': isBfcacheDocument ? 'private, max-age=0, must-revalidate' : 'no-store',
      'transfer-encoding': 'chunked',
    });
    response.write(isBfcacheDocument ? BFCACHE_STREAM_PREFIX : STREAM_PREFIX);
    enqueue({
      response,
      release() {
        if (response.writableEnded) return;
        response.end(isBfcacheDocument ? BFCACHE_STREAM_SUFFIX : STREAM_SUFFIX);
      },
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        async nextChunk(timeoutMs = 10_000) {
          if (pending.length) return pending.shift();
          return new Promise((resolvePending, rejectPending) => {
            const waiter = {
              resolve(item) {
                clearTimeout(timer);
                resolvePending(item);
              },
            };
            const timer = setTimeout(() => {
              const index = waiters.indexOf(waiter);
              if (index >= 0) waiters.splice(index, 1);
              rejectPending(new Error('timed out waiting for streamed index.html request'));
            }, timeoutMs);
            waiters.push(waiter);
          });
        },
        close() {
          for (const item of pending.splice(0)) item.release();
          return new Promise(resolveClose => server.close(resolveClose));
        },
      });
    });
  });
}

function installBootObserver(config) {
  const storage = config.storage || {};
  for (const [key, value] of Object.entries(storage.local || {})) {
    localStorage.setItem(key, String(value));
  }
  for (const [key, value] of Object.entries(storage.session || {})) {
    sessionStorage.setItem(key, String(value));
  }
  if (config.historyState) {
    history.replaceState(config.historyState, '', location.href);
  }
  const observedStorageKeys = new Set(config.observeStorageKeys || []);
  const nativeStorageGetItem = Storage.prototype.getItem;
  window.__syncviewObservedStorageReads = [];
  window.__syncviewReadStorageWithoutTrace = key => nativeStorageGetItem.call(localStorage, key);
  if (observedStorageKeys.size) {
    Storage.prototype.getItem = function syncviewObservedGetItem(key) {
      if (this === localStorage && observedStorageKeys.has(String(key))) {
        window.__syncviewObservedStorageReads.push({ at: Date.now(), key: String(key) });
      }
      return nativeStorageGetItem.call(this, key);
    };
  }
  if (config.captureLegacyResumeInterval === true) {
    const nativeSetInterval = window.setInterval.bind(window);
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    window.__syncviewCapturedIntervals = [];
    window.__syncviewCapturedLegacyRetryTimeouts = [];
    window.setInterval = function syncviewCapturedSetInterval(callback, delay, ...args) {
      const id = nativeSetInterval(callback, delay, ...args);
      window.__syncviewCapturedIntervals.push({ callback, delay: Number(delay), id });
      return id;
    };
    window.setTimeout = function syncviewCapturedSetTimeout(callback, delay, ...args) {
      const id = nativeSetTimeout(callback, delay, ...args);
      if (Number(delay) === 60 * 1000
        && typeof callback === 'function'
        && String(callback).includes('_linearOutboxFlush(owner)')) {
        window.__syncviewCapturedLegacyRetryTimeouts.push({
          callback,
          delay: Number(delay),
          id,
          cleared: false,
          invoked: false,
        });
      }
      return id;
    };
    window.clearTimeout = function syncviewCapturedClearTimeout(id) {
      const entry = window.__syncviewCapturedLegacyRetryTimeouts.find(item => item.id === id);
      if (entry) entry.cleared = true;
      return nativeClearTimeout(id);
    };
    window.__syncviewInvokeLegacyResumeInterval = () => {
      const entry = window.__syncviewCapturedIntervals.find(item => (
        item.delay === 60 * 1000
        && String(item.callback).includes("_writeUiResumeLegacyQueues('timer')")
      ));
      if (!entry) throw new Error('legacy queue 60-second interval callback was not registered');
      return entry.callback();
    };
    window.__syncviewInvokeLegacyRetryTimeout = index => {
      const entry = window.__syncviewCapturedLegacyRetryTimeouts[index];
      if (!entry) throw new Error(`legacy queue retry timeout ${index} was not registered`);
      if (entry.cleared) return false;
      nativeClearTimeout(entry.id);
      entry.invoked = true;
      entry.callback();
      return true;
    };
    window.__syncviewLegacyRetryTimeoutState = () => (
      window.__syncviewCapturedLegacyRetryTimeouts.map(item => ({
        delay: item.delay,
        cleared: item.cleared,
        invoked: item.invoked,
      }))
    );
  }

  const visible = element => {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const firstVisible = selector => Array.from(document.querySelectorAll(selector)).find(visible) || null;
  const cleanText = element => String(element && element.textContent || '').replace(/\s+/g, ' ').trim();

  window.__syncviewBootSnapshot = () => {
    const staticDataSurface = firstVisible('[data-boot-surface]');
    const entryState = firstVisible('[data-client-entry-state]');
    const extrasState = firstVisible('[data-client-extras-state]');
    const entryLoading = firstVisible('[data-client-entry-loading]');
    const activeClientTab = firstVisible('.view-tab-btn.active');
    const activeSurfaceTab = firstVisible('.cal-view-btn.active');
    const pageTitle = document.getElementById('pageTitle');
    const content = document.getElementById('content');
    const visibleContentText = visible(content) ? cleanText(content) : '';
    const forbiddenClient = (config.forbiddenClients || [])
      .find(name => name && visibleContentText.includes(String(name))) || '';
    let surface = 'other';

    if (extrasState && extrasState.getAttribute('data-client-extras-state') === 'error') surface = 'extras:error';
    else if (entryState) surface = `entry:${entryState.getAttribute('data-client-entry-state')}`;
    else if (entryLoading) surface = `loading:${entryLoading.getAttribute('data-client-entry-loading')}`;
    else if (staticDataSurface) surface = `static:${staticDataSurface.getAttribute('data-boot-surface')}`;
    else if (firstVisible('.boot-skeleton-calendar')) surface = 'static:calendar';
    else if (firstVisible('.boot-skeleton-review')) surface = 'static:sample-reviews';
    else if (firstVisible('.boot-skeleton-analytics')) surface = 'static:analytics';
    else if (firstVisible('#sxrView')) surface = 'mounted:sample-reviews';
    else if (firstVisible('#calView')) surface = 'mounted:calendar';
    else if (activeClientTab) surface = `mounted:client-${cleanText(activeClientTab).toLowerCase().replace(/\s+/g, '-')}`;

    return {
      surface,
      readyState: document.readyState,
      bootNav: document.documentElement.getAttribute('data-boot-nav') || '',
      bootSubtab: document.documentElement.getAttribute('data-boot-subtab') || '',
      bootClient: document.documentElement.classList.contains('boot-client'),
      extrasState: extrasState ? extrasState.getAttribute('data-client-extras-state') : '',
      headerVisible: visible(document.querySelector('header.header')),
      pageTopVisible: visible(document.getElementById('pageTop')),
      passwordVisible: visible(document.getElementById('passwordOverlay')),
      analyticsFlash: Boolean(
        firstVisible('.boot-skeleton-analytics')
        || firstVisible('.analytics-overview-skeleton')
        || firstVisible('.analytics-detail-skeleton')
        || (visible(pageTitle) && /^Client Analytics$/i.test(cleanText(pageTitle)))
      ),
      productionVisible: Boolean(firstVisible('.prod-view')),
      oldSamplesVisible: Boolean(firstVisible('#smView')),
      activeClientTab: cleanText(activeClientTab),
      activeSurfaceTab: cleanText(activeSurfaceTab),
      calendarVisible: Boolean(firstVisible('#calView')),
      calendarLoadingVisible: Boolean(
        firstVisible('#calBody .cal-loader')
        || firstVisible('#calRefreshing:not([hidden])')
      ),
      calendarActiveClient: firstVisible('#calTabs .cal-tab.active')?.getAttribute('data-cal-tab')
        || cleanText(firstVisible('#calView .cal-embed-title strong')),
      calendarFieldValues: Array.from(document.querySelectorAll('#calBody input, #calBody textarea'))
        .filter(visible)
        .map(element => String(element.value || ''))
        .filter(Boolean)
        .slice(0, 12),
      reviewVisible: Boolean(firstVisible('#sxrView')),
      embeddedClient: cleanText(firstVisible('.cal-embed-title strong')),
      sxrEmbeddedClient: cleanText(firstVisible('#sxrView .cal-embed-title strong')),
      sxrGenericVisible: Boolean(firstVisible('#sxrTabs')),
      sxrAddClientVisible: Boolean(firstVisible('#sxrView .cal-tab-add')),
      forbiddenClientVisible: forbiddenClient,
      pageTitle: visible(pageTitle) ? cleanText(pageTitle) : '',
      contentText: visibleContentText.slice(0, 260),
      search: location.search,
      hash: location.hash,
    };
  };

  window.__syncviewBootTrace = [];
  window.__syncviewPageShows = [];
  window.addEventListener('pageshow', event => {
    window.__syncviewPageShows.push({
      at: Math.round(performance.now()),
      href: location.href,
      persisted: event.persisted === true,
    });
  }, true);
  let lastSignature = '';
  window.__syncviewResetBootTrace = () => {
    window.__syncviewBootTrace = [];
    lastSignature = '';
  };
  const capture = () => {
    try {
      const snapshot = window.__syncviewBootSnapshot();
      const signature = JSON.stringify(snapshot);
      if (signature !== lastSignature) {
        lastSignature = signature;
        window.__syncviewBootTrace.push(Object.assign({ at: Math.round(performance.now()) }, snapshot));
      }
    } catch (error) {
      window.__syncviewBootTrace.push({
        at: Math.round(performance.now()),
        observerError: String(error && error.message || error),
      });
    }
    requestAnimationFrame(capture);
  };
  requestAnimationFrame(capture);

  class FakeChart {
    destroy() {}
  }
  FakeChart.defaults = {};
  window.Chart = FakeChart;

  window.__syncviewRealtimeTrace = {
    created: [],
    subscribed: [],
    removed: [],
    unsubscribed: [],
  };
  const makeChannel = name => {
    const channel = {
      name,
      on() { return channel; },
      subscribe(callback) {
        window.__syncviewRealtimeTrace.subscribed.push(name);
        if (typeof callback === 'function') queueMicrotask(() => callback('SUBSCRIBED'));
        return channel;
      },
      unsubscribe() {
        window.__syncviewRealtimeTrace.unsubscribed.push(name);
        return Promise.resolve('ok');
      },
    };
    return channel;
  };
  window.supabase = {
    createClient() {
      return {
        channel(name) {
          window.__syncviewRealtimeTrace.created.push(name);
          return makeChannel(name);
        },
        removeChannel(channel) {
          window.__syncviewRealtimeTrace.removed.push(channel && channel.name || '');
          return Promise.resolve('ok');
        },
      };
    },
  };
}

function installBfcacheSyntheticNetwork(config) {
  if (window.__syncviewBfcacheNetworkInstalled) return;
  window.__syncviewBfcacheNetworkInstalled = true;
  window.__syncviewBfcacheNetwork = {
    requests: [],
    verifierCalls: [],
    verifierResponses: [],
    sensitiveClientReads: [],
    supportReads: [],
    captionBoundaryRequests: [],
    unmocked: [],
    heldAnalyticsRequests: 0,
    analyticsReleased: false,
    analyticsResponsesCompleted: 0,
    heldSampleRequests: 0,
    samplesReleased: false,
    sampleResponsesCompleted: 0,
    heldCalendarRequests: 0,
    calendarResponsesCompleted: 0,
    calendarAbortEvents: 0,
    linearMetaReads: [],
    linearMetaCompleted: 0,
    writeRequests: [],
    heldVerifierRequests: 0,
    writeUiRerouteReads: [],
    heldWriteUiRerouteRequests: 0,
    legacyQueueWrites: [],
  };
  const state = window.__syncviewBfcacheNetwork;
  const heldVerifierResolvers = [];
  window.__syncviewReleaseBfcacheVerifier = index => {
    const resolve = heldVerifierResolvers[index];
    if (!resolve) throw new Error(`held BFCache verifier request ${index} is not pending`);
    heldVerifierResolvers[index] = null;
    resolve();
  };
  const heldAnalyticsResolvers = [];
  window.__syncviewReleaseBfcacheAnalytics = () => {
    state.analyticsReleased = true;
    for (const resolve of heldAnalyticsResolvers.splice(0)) resolve();
  };
  const heldSampleResolvers = [];
  window.__syncviewReleaseBfcacheSamples = () => {
    state.samplesReleased = true;
    for (const resolve of heldSampleResolvers.splice(0)) resolve();
  };
  const heldCalendarResolvers = [];
  window.__syncviewReleaseBfcacheCalendar = index => {
    if (Number.isInteger(index)) {
      const resolve = heldCalendarResolvers[index];
      if (!resolve) throw new Error(`held BFCache Calendar request ${index} is not pending`);
      heldCalendarResolvers[index] = null;
      resolve();
      return;
    }
    heldCalendarResolvers.forEach((resolve, heldIndex) => {
      if (!resolve) return;
      heldCalendarResolvers[heldIndex] = null;
      resolve();
    });
  };
  const heldLinearMetaResolvers = [];
  window.__syncviewReleaseBfcacheLinearMeta = index => {
    const resolve = heldLinearMetaResolvers[index];
    if (!resolve) throw new Error(`held BFCache Linear-meta request ${index} is not pending`);
    heldLinearMetaResolvers[index] = null;
    resolve();
  };
  const heldWriteUiRerouteResolvers = [];
  window.__syncviewReleaseBfcacheWriteUiReroute = index => {
    const resolve = heldWriteUiRerouteResolvers[index];
    if (!resolve) throw new Error(`held BFCache write-UI reroute request ${index} is not pending`);
    heldWriteUiRerouteResolvers[index] = null;
    resolve();
  };
  const nativeFetch = window.fetch.bind(window);
  const sleepBrowser = ms => new Promise(resolve => setTimeout(resolve, ms));
  const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
  const textResponse = (value, contentType = 'text/plain; charset=utf-8') => new Response(value, {
    status: 200,
    headers: { 'content-type': contentType },
  });

  window.fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : String(input && input.url || input);
    const url = new URL(rawUrl, location.href);
    const at = Date.now();
    const method = String(init && init.method || 'GET').toUpperCase();
    state.requests.push({ at, method, url: url.href });
    if (url.origin === location.origin) return nativeFetch(input, init);

    if (url.href === config.verifierUrl) {
      let body = {};
      try { body = JSON.parse(String(init && init.body || '{}')); } catch {}
      state.verifierCalls.push({ at, body, url: url.href });
      const callIndex = state.verifierCalls.length - 1;
      const planned = Array.isArray(config.verifierPlan) ? config.verifierPlan[callIndex] : null;
      if (planned && planned.hold === true) {
        state.heldVerifierRequests += 1;
        await new Promise(resolve => { heldVerifierResolvers[callIndex] = resolve; });
      }
      await sleepBrowser(100);
      const callNumber = state.verifierCalls.length;
      const status = Number(planned && planned.status || 200);
      const validByPlan = planned && Object.prototype.hasOwnProperty.call(planned, 'valid')
        ? planned.valid === true
        : callNumber <= (Number(config.validVerifierCalls) || 1);
      const valid = status >= 200 && status < 300
        && validByPlan
        && body.client === config.client
        && body.slug === config.slug
        && body.token === config.token
        && body.view === config.view
        && body.strict === true;
      state.verifierResponses.push({ at: Date.now(), valid, view: body.view, status });
      if (status < 200 || status >= 300) {
        return jsonResponse({ ok: false, error: `synthetic_verifier_${status}` }, status);
      }
      if (!valid) {
        return jsonResponse({
          ok: true,
          valid: false,
          allowed: false,
          error: 'invalid_client_link',
          view: body.view,
        });
      }
      return jsonResponse({
        ok: true,
        valid: true,
        allowed: true,
        slug: config.slug,
        display_name: config.client,
        view: body.view,
        strict: true,
        active: true,
        protocol: 'syncview-client-entry-v1',
      });
    }

    if (url.hostname === 'docs.google.com' && url.pathname.includes('/spreadsheets/')) {
      const sheet = url.searchParams.get('sheet') || '';
      const read = { at, kind: `sheet:${sheet}`, url: url.href };
      state.sensitiveClientReads.push(read);
      if (config.holdAnalytics) {
        state.heldAnalyticsRequests += 1;
        await new Promise(resolve => heldAnalyticsResolvers.push(resolve));
      }
      read.signalAbortedAfterHold = Boolean(init && init.signal && init.signal.aborted);
      await sleepBrowser(sheet === 'Metrics' || sheet === 'Clients Info' ? 40 : 140);
      if (Object.prototype.hasOwnProperty.call(config.sheets, sheet)) {
        state.analyticsResponsesCompleted += 1;
        return textResponse(config.sheets[sheet], 'text/csv; charset=utf-8');
      }
    }

    if (url.hostname === 'uzltbbrjidmjwwfakwve.supabase.co') {
      if (url.pathname === '/rest/v1/syncview_runtime_flags') {
        state.supportReads.push({ at, kind: 'runtime_flags', url: url.href });
        const key = String(url.searchParams.get('key') || '').replace(/^eq\./, '');
        if (key === 'write_ui_reroute_clients') {
          const index = state.writeUiRerouteReads.length;
          const read = { index, at, key, released: false };
          state.writeUiRerouteReads.push(read);
          const hold = Array.isArray(config.holdWriteUiReroutePlan)
            && config.holdWriteUiReroutePlan[index] === true;
          if (hold) {
            state.heldWriteUiRerouteRequests += 1;
            await new Promise(resolve => { heldWriteUiRerouteResolvers[index] = resolve; });
          }
          read.released = true;
        }
        return jsonResponse([]);
      }
      if (url.pathname === '/rest/v1/team_members') {
        state.supportReads.push({ at, kind: 'team_members', url: url.href });
        return jsonResponse([{
          id: 'synthetic-staff-1',
          name: 'Synthetic Test Operator',
          role: 'smm',
          team: 'test',
          active: true,
        }]);
      }
      if (url.pathname === '/rest/v1/clients') {
        state.supportReads.push({ at, kind: 'clients', url: url.href });
        return jsonResponse([
          { slug: config.slug, display_name: config.client, kind: 'client', active: true },
          { slug: 'residualfixtureclient', display_name: config.residualClient, kind: 'client', active: true },
        ]);
      }
      if (url.pathname === '/rest/v1/templates') {
        state.supportReads.push({ at, kind: 'templates', url: url.href });
        return jsonResponse([]);
      }
      if (url.pathname === '/rest/v1/calendar_posts') {
        const read = {
          index: state.sensitiveClientReads.filter(item => item.kind === 'calendar_posts').length,
          at,
          kind: 'calendar_posts',
          url: url.href,
          signalAbortedBeforeRelease: false,
        };
        state.sensitiveClientReads.push(read);
        const holdCalendar = Array.isArray(config.holdCalendarPlan)
          ? config.holdCalendarPlan[read.index] === true
          : config.holdCalendar;
        if (holdCalendar) {
          state.heldCalendarRequests += 1;
          let released = false;
          const markAborted = () => {
            if (released || read.signalAbortedBeforeRelease) return;
            read.signalAbortedBeforeRelease = true;
            state.calendarAbortEvents += 1;
          };
          const signal = init && init.signal;
          if (signal) {
            if (signal.aborted) markAborted();
            else signal.addEventListener('abort', markAborted, { once: true });
          }
          await new Promise(resolve => { heldCalendarResolvers[read.index] = resolve; });
          released = true;
          if (signal) signal.removeEventListener('abort', markAborted);
          read.signalAbortedAfterHold = Boolean(signal && signal.aborted);
        } else {
          await sleepBrowser(80);
        }
        state.calendarResponsesCompleted += 1;
        const rows = Array.isArray(config.calendarRowsPlan)
          ? (config.calendarRowsPlan[read.index] || [])
          : config.calendarRows;
        return jsonResponse(rows);
      }
      if (url.pathname === '/rest/v1/sample_reviews') {
        const read = { at, kind: 'sample_reviews', url: url.href };
        state.sensitiveClientReads.push(read);
        if (config.holdSamples) {
          state.heldSampleRequests += 1;
          await new Promise(resolve => heldSampleResolvers.push(resolve));
        }
        read.signalAbortedAfterHold = Boolean(init && init.signal && init.signal.aborted);
        state.sampleResponsesCompleted += 1;
        return jsonResponse(config.sampleRows);
      }
    }

    if (url.hostname === 'synchrosocial.app.n8n.cloud') {
      if (method === 'POST' && [
        '/webhook/linear-set-status',
        '/webhook/linear-add-comment',
      ].includes(url.pathname)) {
        let body = {};
        try { body = JSON.parse(String(init && init.body || '{}')); } catch {}
        const index = state.legacyQueueWrites.length;
        const status = Number(Array.isArray(config.legacyQueueStatusPlan)
          ? config.legacyQueueStatusPlan[index]
          : 200) || 200;
        state.legacyQueueWrites.push({ at, method, path: url.pathname, body, status });
        return jsonResponse({ ok: status >= 200 && status < 300 }, status);
      }
      if ([
        '/webhook/caption-prompts-get',
        '/webhook/generate-caption',
        '/webhook/caption-job-status',
        '/webhook/caption-job-update',
      ].includes(url.pathname)) {
        state.captionBoundaryRequests.push({ at, method, path: url.pathname, url: url.href });
        if (url.pathname === '/webhook/caption-prompts-get') return jsonResponse({ ok: true, prompts: {} });
        return jsonResponse({ ok: true, status: 'running' });
      }
      if (url.pathname === '/webhook/templates-get') return jsonResponse({ ok: true, templates: {} });
      if (url.pathname === '/webhook/generate-general-brief') {
        state.sensitiveClientReads.push({ at, kind: 'generate-general-brief', url: url.href });
        return jsonResponse({
          overviewSynthesis: 'Synthetic overview for the browser-only fixture.',
          hookSynthesis: 'Synthetic hook notes for the browser-only fixture.',
          landscapeSynthesis: 'Synthetic landscape notes for the browser-only fixture.',
        });
      }
      if (url.pathname === '/webhook/calendar-get') {
        state.sensitiveClientReads.push({ at, kind: 'calendar-get', url: url.href });
        return jsonResponse({ ok: true, posts: [] });
      }
      if (url.pathname === '/webhook/linear-issue-statuses') {
        let body = {};
        try { body = JSON.parse(String(init && init.body || '{}')); } catch {}
        let client = '';
        try { client = typeof calState !== 'undefined' && calState ? String(calState.client || '') : ''; } catch {}
        const read = {
          index: state.linearMetaReads.length,
          at,
          client,
          issues: Array.isArray(body.issues) ? body.issues.slice() : [],
          released: false,
          completed: false,
          signalAbortedBeforeRelease: false,
        };
        state.linearMetaReads.push(read);
        const holdLinearMeta = Array.isArray(config.holdLinearMetaPlan)
          ? config.holdLinearMetaPlan[read.index] === true
          : false;
        const signal = init && init.signal;
        const markAborted = () => {
          if (!read.released) read.signalAbortedBeforeRelease = true;
        };
        if (signal) {
          if (signal.aborted) markAborted();
          else signal.addEventListener('abort', markAborted, { once: true });
        }
        if (holdLinearMeta) {
          await new Promise(resolve => { heldLinearMetaResolvers[read.index] = resolve; });
        }
        read.released = true;
        if (signal) signal.removeEventListener('abort', markAborted);
        read.completed = true;
        state.linearMetaCompleted += 1;
        const plan = Array.isArray(config.linearMetaPlan) ? config.linearMetaPlan[read.index] : null;
        const hasAll = !plan || plan.hasAll !== false;
        return jsonResponse({
          ok: true,
          statuses: { [config.linearIdent]: hasAll ? 'In Progress' : 'Client Approval' },
          meta: {
            [config.linearIdent]: {
              isSubIssue: true,
              hasProject: hasAll,
              hasDue: hasAll,
              hasEditor: hasAll,
            },
          },
        });
      }
      if (method !== 'GET' && (
        url.pathname === '/webhook/calendar-upsert-post'
        || url.pathname === '/functions/v1/calendar-upsert'
      )) {
        state.writeRequests.push({ at, method, url: url.href, body: String(init && init.body || '') });
        return jsonResponse({ ok: true });
      }
    }

    state.unmocked.push({ at, method, url: url.href });
    return jsonResponse({ ok: false, error: 'synthetic_unmocked_request' }, 599);
  };
}

function installHeldCalendarTransport(config) {
  const nativeFetch = window.fetch.bind(window);
  const pending = [];
  window.__syncviewHeldCalendarTransport = {
    reads: [],
    completed: 0,
  };
  const state = window.__syncviewHeldCalendarTransport;
  window.__syncviewReleaseHeldCalendar = index => {
    const release = pending[index];
    if (!release) throw new Error(`held Calendar request ${index} is not pending`);
    pending[index] = null;
    release();
  };

  window.fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : String(input && input.url || input);
    const url = new URL(rawUrl, location.href);
    const method = String(init && init.method || 'GET').toUpperCase();
    if (method !== 'GET'
      || url.hostname !== 'uzltbbrjidmjwwfakwve.supabase.co'
      || url.pathname !== '/rest/v1/calendar_posts') {
      return nativeFetch(input, init);
    }

    const clientFilter = String(url.searchParams.get('client') || '');
    const slug = clientFilter.replace(/^eq\./, '');
    const read = {
      index: state.reads.length,
      at: Date.now(),
      slug,
      url: url.href,
      signalAbortedBeforeRelease: false,
      released: false,
      completed: false,
    };
    state.reads.push(read);
    const signal = init && init.signal;
    const markAborted = () => {
      if (!read.released) read.signalAbortedBeforeRelease = true;
    };
    if (signal) {
      if (signal.aborted) markAborted();
      else signal.addEventListener('abort', markAborted, { once: true });
    }
    await new Promise(resolve => { pending[read.index] = resolve; });
    read.released = true;
    if (signal) signal.removeEventListener('abort', markAborted);
    read.signalAbortedAfterHold = Boolean(signal && signal.aborted);
    read.completed = true;
    state.completed += 1;
    const rows = config.rowsBySlug[slug] || [];
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  };
}

function installHeldLinearPostLoad(config) {
  const nativeFetch = window.fetch.bind(window);
  const pending = [];
  const jsonResponse = value => new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
  window.__syncviewHeldLinearPostLoad = {
    calendarReads: [],
    linearReads: [],
    linearCompleted: 0,
    writeRequests: [],
  };
  const state = window.__syncviewHeldLinearPostLoad;
  window.__syncviewReleaseHeldLinear = index => {
    const release = pending[index];
    if (!release) throw new Error(`held Linear request ${index} is not pending`);
    pending[index] = null;
    release();
  };

  window.fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : String(input && input.url || input);
    const url = new URL(rawUrl, location.href);
    const method = String(init && init.method || 'GET').toUpperCase();
    if (url.hostname !== 'synchrosocial.app.n8n.cloud'
      && url.hostname !== 'uzltbbrjidmjwwfakwve.supabase.co') {
      return nativeFetch(input, init);
    }

    if (method === 'GET'
      && url.hostname === 'synchrosocial.app.n8n.cloud'
      && url.pathname === '/webhook/calendar-get') {
      const slug = String(url.searchParams.get('client') || '');
      state.calendarReads.push({ at: Date.now(), slug, url: url.href });
      return jsonResponse({ ok: true, posts: config.rowsBySlug[slug] || [] });
    }

    if (method === 'POST'
      && url.hostname === 'synchrosocial.app.n8n.cloud'
      && url.pathname === '/webhook/linear-issue-statuses') {
      let body = {};
      try { body = JSON.parse(String(init && init.body || '{}')); } catch {}
      let client = '';
      try { client = typeof calState !== 'undefined' && calState ? String(calState.client || '') : ''; } catch {}
      const issues = Array.isArray(body.issues) ? body.issues.slice() : [];
      const read = {
        index: state.linearReads.length,
        at: Date.now(),
        client,
        kind: issues.some(issue => /^https?:/i.test(String(issue))) ? 'reconcile' : 'meta',
        issues,
        released: false,
        completed: false,
        signalAbortedBeforeRelease: false,
      };
      state.linearReads.push(read);
      const signal = init && init.signal;
      const markAborted = () => {
        if (!read.released) read.signalAbortedBeforeRelease = true;
      };
      if (signal) {
        if (signal.aborted) markAborted();
        else signal.addEventListener('abort', markAborted, { once: true });
      }
      await new Promise(resolve => { pending[read.index] = resolve; });
      read.released = true;
      if (signal) signal.removeEventListener('abort', markAborted);
      read.completed = true;
      state.linearCompleted += 1;
      const isA = client === config.clientA;
      return jsonResponse({
        ok: true,
        statuses: {
          [config.ident]: isA && read.kind === 'reconcile' ? 'Client Approval' : 'In Progress',
        },
        meta: {
          [config.ident]: {
            isSubIssue: true,
            hasProject: true,
            hasDue: true,
            hasEditor: true,
          },
        },
      });
    }

    if (method !== 'GET' && (
      url.pathname === '/webhook/calendar-upsert-post'
      || url.pathname === '/functions/v1/calendar-upsert'
      || url.pathname === '/rest/v1/calendar_posts'
    )) {
      state.writeRequests.push({ at: Date.now(), method, url: url.href, body: String(init && init.body || '') });
      return jsonResponse({ ok: true });
    }

    return nativeFetch(input, init);
  };
}

async function installSyntheticNetwork(context, origin, config = {}) {
  const state = {
    requests: [],
    verifierCalls: [],
    verifierResponses: [],
    sensitiveClientReads: [],
    extraRequests: [],
    extraResponses: [],
    extraHolds: [],
    sampleReads: [],
    calendarReads: [],
    unmocked: [],
  };
  const extraSheets = ['TopVideos', 'Competitor Briefs', 'Market Research Briefs', 'ContentSummaries'];
  state.waitForHeldExtras = async (attempt, count = extraSheets.length, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (state.extraHolds.filter(hold => hold.attempt === attempt).length === count) return;
      await sleep(20);
    }
    throw new Error(`timed out waiting for ${count} held extras on attempt ${attempt}`);
  };
  state.waitForExtraResponses = async (attempt, count = extraSheets.length, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (state.extraResponses.filter(response => response.attempt === attempt).length === count) return;
      await sleep(20);
    }
    throw new Error(`timed out waiting for ${count} extras responses on attempt ${attempt}`);
  };
  state.releaseExtras = attempt => {
    const held = state.extraHolds.filter(hold => hold.attempt === attempt);
    state.extraHolds = state.extraHolds.filter(hold => hold.attempt !== attempt);
    held.forEach(hold => hold.release());
    return held.length;
  };

  const fulfillJson = (route, value, status = 200) => route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'access-control-allow-origin': '*' },
    body: jsonBody(value),
  });
  const fulfillText = (route, value, contentType = 'text/plain; charset=utf-8') => route.fulfill({
    status: 200,
    contentType,
    headers: { 'access-control-allow-origin': '*' },
    body: value,
  });

  await context.route('**/*', async route => {
    const request = route.request();
    const rawUrl = request.url();
    const at = Date.now();
    state.requests.push({ at, method: request.method(), url: rawUrl });

    if (rawUrl.startsWith(origin)) {
      await route.continue();
      return;
    }

    const url = new URL(rawUrl);
    if (url.hostname === 'fonts.googleapis.com') {
      await fulfillText(route, '/* synthetic empty font sheet */', 'text/css; charset=utf-8');
      return;
    }
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/chart.js')) {
      await fulfillText(route, '/* Chart is installed by the browser boot fixture. */', 'application/javascript; charset=utf-8');
      return;
    }
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js')) {
      await fulfillText(route, '/* Supabase is installed by the browser boot fixture. */', 'application/javascript; charset=utf-8');
      return;
    }

    if (url.hostname === 'docs.google.com' && url.pathname.includes('/spreadsheets/')) {
      const sheet = url.searchParams.get('sheet') || '';
      state.sensitiveClientReads.push({ at, kind: `sheet:${sheet}`, url: rawUrl });
      // Calendar intentionally awaits essentials but streams extras in the
      // background. Keep essentials faster so this lane guards the real race:
      // Brief must become available after extras without requiring a reload.
      const isExtra = extraSheets.includes(sheet);
      let extraRequest = null;
      let extraPlan = null;
      if (isExtra) {
        const attempt = Math.floor(state.extraRequests.length / extraSheets.length);
        extraPlan = Array.isArray(config.extrasPlan) ? (config.extrasPlan[attempt] || null) : null;
        extraRequest = { at, sheet, attempt, held: Boolean(extraPlan && extraPlan.hold) };
        state.extraRequests.push(extraRequest);
        if (extraRequest.held) {
          await new Promise(release => state.extraHolds.push({ attempt, sheet, release }));
        } else {
          await sleep(140);
        }
        if (extraPlan && extraPlan.rejectSheet === sheet) {
          extraRequest.outcome = 'rejected';
          state.extraResponses.push({ at: Date.now(), sheet, attempt, outcome: 'rejected' });
          await route.abort('failed');
          return;
        }
      } else {
        await sleep(40);
      }
      const body = sheet === 'Metrics' ? (config.zeroAnalytics ? METRICS_CSV.split('\n')[0] + '\n' : METRICS_CSV)
        : sheet === 'Clients Info' ? CLIENTS_CSV
          : sheet === 'TopVideos' ? TOP_VIDEOS_CSV
            : sheet === 'Competitor Briefs' ? BRIEFS_CSV
              : sheet === 'Market Research Briefs' ? MR_BRIEFS_CSV
                : sheet === 'ContentSummaries' ? SUMMARIES_CSV
                  : null;
      if (body !== null) {
        await fulfillText(route, body, 'text/csv; charset=utf-8');
        if (extraRequest) {
          extraRequest.outcome = 'fulfilled';
          state.extraResponses.push({ at: Date.now(), sheet, attempt: extraRequest.attempt, outcome: 'fulfilled' });
        }
        return;
      }
    }

    if (url.hostname === 'uzltbbrjidmjwwfakwve.supabase.co') {
      if (url.pathname === '/functions/v1/client-token-verify') {
        let body = {};
        try { body = JSON.parse(request.postData() || '{}'); } catch {}
        state.verifierCalls.push({ at, body, url: rawUrl });
        await sleep(100);
        const callNumber = state.verifierCalls.length;
        const plannedVerifierResponse = Array.isArray(config.verifierPlan)
          ? config.verifierPlan[callNumber - 1]
          : null;
        if (plannedVerifierResponse && Number(plannedVerifierResponse.status) >= 400) {
          const status = Number(plannedVerifierResponse.status);
          state.verifierResponses.push({
            at: Date.now(),
            valid: false,
            view: body.view,
            status,
          });
          await fulfillJson(route, {
            ok: false,
            error: `synthetic_verifier_${status}`,
          }, status);
          return;
        }
        const valid = body.client === CLIENT_A
          && body.slug === CLIENT_A_SLUG
          && body.token === CURRENT_TOKEN
          && body.strict === true
          && ['analytics', 'calendar', 'brief', 'samples', 'sample-reviews'].includes(body.view)
          && !(config.rotateAfterFirst && callNumber > 1);
        state.verifierResponses.push({ at: Date.now(), valid, view: body.view, status: 200 });
        if (!valid) {
          await fulfillJson(route, {
            ok: true,
            valid: false,
            allowed: false,
            error: 'invalid_client_link',
            view: body.view,
          });
          return;
        }
        if (config.verifierShape === 'legacy-missing-contract') {
          await fulfillJson(route, {
            ok: true,
            valid: true,
            slug: CLIENT_A_SLUG,
          });
          return;
        }
        await fulfillJson(route, {
          ok: true,
          valid: true,
          allowed: true,
          slug: CLIENT_A_SLUG,
          display_name: config.displayNameOverride || CLIENT_A,
          view: body.view,
          strict: true,
          active: true,
          protocol: 'syncview-client-entry-v1',
        });
        return;
      }

      if (url.pathname === '/rest/v1/syncview_runtime_flags') {
        await fulfillJson(route, []);
        return;
      }
      if (url.pathname === '/rest/v1/team_members') {
        await fulfillJson(route, [{
          id: 'synthetic-staff-1',
          name: 'Synthetic Test Operator',
          role: 'smm',
          team: 'test',
          active: true,
        }]);
        return;
      }
      if (url.pathname === '/rest/v1/clients') {
        await fulfillJson(route, [
          { slug: CLIENT_A_SLUG, display_name: CLIENT_A, kind: 'client', active: true },
          { slug: 'residualfixtureclient', display_name: CLIENT_B, kind: 'client', active: true },
        ]);
        return;
      }
      if (url.pathname === '/rest/v1/templates') {
        await fulfillJson(route, []);
        return;
      }
      if (url.pathname === '/rest/v1/calendar_posts') {
        const read = { at, url: rawUrl };
        state.calendarReads.push(read);
        state.sensitiveClientReads.push(Object.assign({ kind: 'calendar_posts' }, read));
        await sleep(80);
        await fulfillJson(route, []);
        return;
      }
      if (url.pathname === '/rest/v1/sample_reviews') {
        const read = { at, url: rawUrl };
        state.sampleReads.push(read);
        state.sensitiveClientReads.push(Object.assign({ kind: 'sample_reviews' }, read));
        await sleep(80);
        await fulfillJson(route, SAMPLE_ROWS);
        return;
      }
    }

    if (url.hostname === 'synchrosocial.app.n8n.cloud') {
      if (url.pathname === '/webhook/templates-get') {
        await fulfillJson(route, { ok: true, templates: {} });
        return;
      }
      if (url.pathname === '/webhook/caption-prompts-get') {
        await fulfillJson(route, { ok: true, prompts: {} });
        return;
      }
      if (url.pathname === '/webhook/generate-general-brief') {
        state.sensitiveClientReads.push({ at, kind: 'generate-general-brief', url: rawUrl });
        await fulfillJson(route, {
          overviewSynthesis: 'Synthetic overview for the browser-only fixture.',
          hookSynthesis: 'Synthetic hook notes for the browser-only fixture.',
          landscapeSynthesis: 'Synthetic landscape notes for the browser-only fixture.',
        });
        return;
      }
      if (url.pathname === '/webhook/calendar-get') {
        const read = { at, url: rawUrl };
        state.calendarReads.push(read);
        state.sensitiveClientReads.push(Object.assign({ kind: 'calendar-get' }, read));
        await fulfillJson(route, { ok: true, posts: [] });
        return;
      }
      if (url.pathname === '/webhook/sample-review-get') {
        const read = { at, url: rawUrl };
        state.sampleReads.push(read);
        state.sensitiveClientReads.push(Object.assign({ kind: 'sample-review-get' }, read));
        await fulfillJson(route, { ok: true, posts: SAMPLE_ROWS });
        return;
      }
    }

    state.unmocked.push({ method: request.method(), url: rawUrl, resourceType: request.resourceType() });
    await route.abort('blockedbyclient');
  });

  return state;
}

async function openCase(browser, server, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
  });
  await context.addInitScript(installBootObserver, {
    storage: options.storage || {},
    historyState: options.historyState || null,
    forbiddenClients: options.forbiddenClients || [CLIENT_B],
  });
  if (options.heldCalendarTransport) {
    await context.addInitScript(installHeldCalendarTransport, options.heldCalendarTransport);
  }
  if (options.heldLinearPostLoad) {
    await context.addInitScript(installHeldLinearPostLoad, options.heldLinearPostLoad);
  }
  const network = await installSyntheticNetwork(context, server.origin, options.network || {});
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(String(error && error.stack || error)));
  return { context, page, network, consoleErrors, pageErrors };
}

async function openBfcacheCase(browser, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
  });
  await context.addInitScript(installBootObserver, {
    storage: options.storage || {},
    historyState: null,
    forbiddenClients: options.forbiddenClients || [CLIENT_B],
    observeStorageKeys: options.observeStorageKeys || [],
    captureLegacyResumeInterval: options.captureLegacyResumeInterval === true,
  });
  await context.addInitScript(installBfcacheSyntheticNetwork, {
    verifierUrl: 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/client-token-verify',
    client: CLIENT_A,
    residualClient: CLIENT_B,
    slug: CLIENT_A_SLUG,
    token: CURRENT_TOKEN,
    view: options.view || 'calendar',
    validVerifierCalls: options.validVerifierCalls || 1,
    verifierPlan: options.verifierPlan || null,
    holdAnalytics: options.holdAnalytics === true,
    holdSamples: options.holdSamples === true,
    holdCalendar: options.holdCalendar === true,
    holdCalendarPlan: options.holdCalendarPlan || null,
    calendarRows: CALENDAR_ROWS,
    calendarRowsPlan: options.calendarRowsPlan || null,
    holdLinearMetaPlan: options.holdLinearMetaPlan || null,
    linearMetaPlan: options.linearMetaPlan || null,
    holdWriteUiReroutePlan: options.holdWriteUiReroutePlan || null,
    legacyQueueStatusPlan: options.legacyQueueStatusPlan || null,
    linearIdent: LINEAR_LEASE_IDENT,
    sampleRows: SAMPLE_ROWS,
    sheets: {
      Metrics: METRICS_CSV,
      'Clients Info': CLIENTS_CSV,
      TopVideos: TOP_VIDEOS_CSV,
      'Competitor Briefs': BRIEFS_CSV,
      'Market Research Briefs': MR_BRIEFS_CSV,
      ContentSummaries: SUMMARIES_CSV,
    },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(String(error && error.stack || error)));
  return { context, page, consoleErrors, pageErrors };
}

async function streamedNavigation(page, server, action, expectedStaticSurface) {
  const navigation = action();
  const chunk = await server.nextChunk();
  try {
    await page.waitForFunction(expected => {
      const snapshot = window.__syncviewBootSnapshot && window.__syncviewBootSnapshot();
      return snapshot && snapshot.surface === expected;
    }, expectedStaticSurface, { timeout: 10_000 });
  } finally {
    chunk.release();
  }
  await navigation;
}

async function restoreFromBfcache(page, server, pathname) {
  const possibleDocumentRequest = server.nextChunk(1_500).then(chunk => {
    chunk.release();
    return true;
  }, () => false);
  // A BFCache restore intentionally does not emit a new load event, so drive
  // the browser's real History traversal and wait on live location instead of
  // Playwright's load-oriented Back/URL navigation helpers.
  await page.evaluate(() => history.back());
  await page.waitForFunction(expected => location.pathname === expected, pathname, { timeout: 15_000 });
  return possibleDocumentRequest;
}

async function traceOf(page) {
  await page.waitForTimeout(120);
  return page.evaluate(() => Array.isArray(window.__syncviewBootTrace)
    ? window.__syncviewBootTrace.slice()
    : []);
}

async function armTrustedClickTraceBoundary(page, selector, expectedText) {
  await page.evaluate(({ selector: targetSelector, expectedText: targetText }) => {
    window.__syncviewBootClickBoundary = {
      count: 0,
      target: '',
      isTrusted: false,
    };
    document.addEventListener('click', event => {
      const target = event.target && typeof event.target.closest === 'function'
        ? event.target.closest(targetSelector)
        : null;
      if (!target || String(target.textContent || '').trim() !== targetText) return;
      window.__syncviewResetBootTrace();
      window.__syncviewBootClickBoundary = {
        count: 1,
        target: targetText,
        isTrusted: event.isTrusted === true,
      };
    }, { capture: true, once: true });
  }, { selector, expectedText });
}

function traceExcerpt(frames) {
  return frames.slice(0, 20).map(frame => ({
    at: frame.at,
    surface: frame.surface,
    extrasState: frame.extrasState,
    activeClientTab: frame.activeClientTab,
    activeSurfaceTab: frame.activeSurfaceTab,
    calendarLoadingVisible: frame.calendarLoadingVisible,
    calendarActiveClient: frame.calendarActiveClient,
    calendarFieldValues: frame.calendarFieldValues,
    analyticsFlash: frame.analyticsFlash,
    headerVisible: frame.headerVisible,
    pageTopVisible: frame.pageTopVisible,
    sxrEmbeddedClient: frame.sxrEmbeddedClient,
    sxrGenericVisible: frame.sxrGenericVisible,
    sxrAddClientVisible: frame.sxrAddClientVisible,
    forbiddenClientVisible: frame.forbiddenClientVisible,
    search: frame.search,
    hash: frame.hash,
  }));
}

function calendarRealtime(trace) {
  return Object.fromEntries(Object.entries(trace || {}).map(([key, names]) => [
    key,
    (Array.isArray(names) ? names : []).filter(name => String(name).startsWith('cal-')),
  ]));
}

function assertHealthyHarness(run, label) {
  assert.deepEqual(run.network.unmocked, [], `${label}: every external request must be explicitly mocked`);
  assert.deepEqual(run.consoleErrors, [], `${label}: browser console errors are not allowed`);
  assert.deepEqual(run.pageErrors, [], `${label}: uncaught page errors are not allowed`);
}

function assertTruthfulTrace(frames, label, options = {}) {
  assert.ok(frames.length > 0, `${label}: browser must record at least one rendered frame`);
  const forbidden = frames.filter(frame => (
    frame.analyticsFlash
    || frame.productionVisible
    || frame.oldSamplesVisible
    || frame.activeClientTab === 'Analytics'
    || (options.clientOwned && (frame.headerVisible || frame.pageTopVisible || frame.passwordVisible))
    || (options.samplesOwned && (
      frame.sxrGenericVisible
      || frame.sxrAddClientVisible
      || frame.forbiddenClientVisible
      || (frame.sxrEmbeddedClient && frame.sxrEmbeddedClient !== options.expectedClient)
    ))
  ));
  assert.deepEqual(
    forbidden,
    [],
    `${label}: forbidden Analytics/staff/Production/legacy/generic/wrong-client frame observed\n${JSON.stringify(traceExcerpt(forbidden), null, 2)}`,
  );
}

async function waitForClientTab(page, tab) {
  await page.waitForFunction(expected => {
    const active = Array.from(document.querySelectorAll('.view-tab-btn.active'))
      .find(element => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
    return active && active.textContent.replace(/\s+/g, ' ').trim() === expected;
  }, tab, { timeout: 10_000 });
}

async function waitForClientTabButton(page, tab) {
  await page.waitForFunction(expected => Array.from(document.querySelectorAll('.view-tab-btn'))
    .some(element => {
      const style = getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && element.textContent.replace(/\s+/g, ' ').trim() === expected;
    }), tab, { timeout: 10_000 });
}

async function waitForCalendarSettled(page) {
  await waitForClientTab(page, 'Content Calendar');
  await page.waitForFunction(() => {
    const body = document.getElementById('calBody');
    return body
      && !body.querySelector('.cal-skeleton-loader')
      && !/Loading your calendar/i.test(body.innerText || '');
  }, null, { timeout: 10_000 });
}

async function waitForReviewSettled(page) {
  await page.waitForFunction(expectedName => {
    const view = document.getElementById('sxrView');
    const active = view && view.querySelector('.cal-view-btn.active');
    return view
      && active
      && /Review/i.test(active.textContent || '')
      && (view.innerText || '').includes(expectedName);
  }, 'Synthetic review card A', { timeout: 10_000 });
}

function assertVerifiedBeforeClientReads(network, label) {
  assert.ok(network.verifierResponses.length > 0, `${label}: at least one strict verifier response expected`);
  for (let index = 0; index < network.verifierCalls.length; index += 1) {
    const call = network.verifierCalls[index];
    const response = network.verifierResponses[index];
    const nextCallAt = network.verifierCalls[index + 1]?.at ?? Number.POSITIVE_INFINITY;
    const readsForBoot = network.sensitiveClientReads.filter(read => read.at >= call.at && read.at < nextCallAt);
    const earlyReads = readsForBoot.filter(read => !response || read.at < response.at);
    assert.deepEqual(earlyReads, [], `${label}: client data must not start before strict verification succeeds on boot ${index + 1}`);
  }
}

async function runStaffHistoryScenario(browser, server, view) {
  const tabLabel = view === 'calendar' ? 'Content Calendar' : 'Brief';
  const staticSurface = view === 'calendar' ? 'static:calendar' : 'static:client-brief';
  const run = await openCase(browser, server, {
    storage: {
      local: { syncview_auth_v1: 'ok' },
      session: { syncview_staff_identity_prompted_v1: '1' },
    },
    historyState: { nav: 'home', client: CLIENT_A, clientTab: view },
  });
  const label = `staff history ${view}`;
  try {
    await streamedNavigation(
      run.page,
      server,
      () => run.page.goto(`${server.origin}/index.html`, { waitUntil: 'load', timeout: 15_000 }),
      staticSurface,
    );
    if (view === 'calendar') await waitForCalendarSettled(run.page);
    else await waitForClientTab(run.page, tabLabel);
    const frames = await traceOf(run.page);
    assert.ok(frames.some(frame => frame.surface === staticSurface), `${label}: route-owned static skeleton must paint`);
    assertTruthfulTrace(frames, label);
    assert.equal(run.network.verifierCalls.length, 0, `${label}: staff history restore must not call client verifier`);
    assertHealthyHarness(run, label);
    passGroup(label);
  } finally {
    await run.context.close();
  }
}

async function runClientTabScenario(browser, server, view) {
  const tabLabel = view === 'calendar' ? 'Content Calendar' : 'Brief';
  const label = `zero-analytics client ${view} boot/reload`;
  const run = await openCase(browser, server, {
    network: {
      zeroAnalytics: true,
      extrasPlan: view === 'calendar'
        ? [{}, { hold: true, rejectSheet: 'Competitor Briefs' }, { hold: true }]
        : null,
    },
    storage: {
      local: {
        syncview_calendar_prefs: JSON.stringify({ client: CLIENT_B, view: 'organizer', zoom: 'l' }),
        syncview_calendar_pins: JSON.stringify([CLIENT_B]),
      },
    },
  });
  try {
    const query = new URLSearchParams({ c: CLIENT_A, v: view, t: CURRENT_TOKEN });
    await streamedNavigation(
      run.page,
      server,
      () => run.page.goto(`${server.origin}/index.html?${query}`, { waitUntil: 'load', timeout: 15_000 }),
      'static:client-verify',
    );
    if (view === 'calendar') {
      await waitForCalendarSettled(run.page);
      await run.network.waitForExtraResponses(0);
    }
    else await waitForClientTab(run.page, tabLabel);
    const firstFrames = await traceOf(run.page);
    assert.ok(firstFrames.some(frame => frame.surface === 'static:client-verify'), `${label}: neutral verifier must paint first`);
    assert.ok(firstFrames.some(frame => frame.surface === `loading:${view}`), `${label}: route-owned loader must visibly paint`);
    assertTruthfulTrace(firstFrames, `${label} first navigation`, { clientOwned: true });

    await streamedNavigation(
      run.page,
      server,
      () => run.page.reload({ waitUntil: 'load', timeout: 15_000 }),
      'static:client-verify',
    );
    if (view === 'calendar') {
      await waitForCalendarSettled(run.page);
      await run.network.waitForHeldExtras(1);
    }
    else await waitForClientTab(run.page, tabLabel);
    const reloadFrames = await traceOf(run.page);
    assert.ok(reloadFrames.some(frame => frame.surface === 'static:client-verify'), `${label}: reload must repaint neutral verifier`);
    assert.ok(reloadFrames.some(frame => frame.surface === `loading:${view}`), `${label}: reload must repaint route-owned loader`);
    assertTruthfulTrace(reloadFrames, `${label} reload`, { clientOwned: true });

    assert.equal(run.network.verifierCalls.length, 2, `${label}: exactly one strict verifier call per document boot`);
    for (const call of run.network.verifierCalls) {
      const verifyBody = call.body;
      assert.deepEqual(
        {
          client: verifyBody.client,
          slug: verifyBody.slug,
          token: verifyBody.token,
          view: verifyBody.view,
          strict: verifyBody.strict,
        },
        { client: CLIENT_A, slug: CLIENT_A_SLUG, token: CURRENT_TOKEN, view, strict: true },
        `${label}: verifier request must bind the exact client, token, view, and strict mode`,
      );
    }
    assertVerifiedBeforeClientReads(run.network, label);
    const routeFinal = await run.page.evaluate(() => ({
      active: document.querySelector('.view-tab-btn.active')?.textContent.replace(/\s+/g, ' ').trim() || '',
      embeddedClient: document.querySelector('.cal-embed-title strong')?.textContent.trim() || '',
      body: document.body.innerText,
    }));
    assert.equal(routeFinal.active, tabLabel, `${label}: requested tab must settle after reload`);
    if (view === 'calendar') {
      assert.equal(routeFinal.embeddedClient, CLIENT_A, `${label}: residual calendar prefs cannot rebind the client`);
    }
    assert.equal(routeFinal.body.includes(CLIENT_B), false, `${label}: residual client must never become visible`);

    if (view === 'calendar') {
      await waitForClientTabButton(run.page, 'Brief');
      await run.page.evaluate(() => { window.__syncviewBootTrace = []; });
      await armTrustedClickTraceBoundary(run.page, '.view-tab-btn', 'Brief');
      await run.page.getByRole('button', { name: 'Brief', exact: true }).click({ timeout: 10_000 });
      await run.page.waitForSelector('[data-client-extras-state="loading"][data-client-entry-loading="brief"]', {
        state: 'visible',
        timeout: 10_000,
      });
      const pending = await run.page.evaluate(() => ({
        v: new URLSearchParams(location.search).get('v'),
        clientTab: history.state && history.state.clientTab,
        extrasStatus: _fetchExtrasState.status,
        fakeEmpty: /No Keywords Brief yet|No competitors brief yet/i.test(document.getElementById('content')?.innerText || ''),
        click: window.__syncviewBootClickBoundary,
      }));
      assert.deepEqual(
        { v: pending.v, clientTab: pending.clientTab, extrasStatus: pending.extrasStatus, fakeEmpty: pending.fakeEmpty },
        { v: 'brief', clientTab: 'brief', extrasStatus: 'loading', fakeEmpty: false },
        `${label}: held extras must move URL/history to Brief while the visible route stays on its loader`,
      );
      assert.deepEqual(
        pending.click,
        { count: 1, target: 'Brief', isTrusted: true },
        `${label}: the extras race must be driven by one real trusted Brief click`,
      );
      assert.equal(run.network.verifierCalls.length, 2, `${label}: tab click must reuse the verified capability`);
      const firstLoadingFrames = await traceOf(run.page);
      assert.ok(firstLoadingFrames.some(frame => frame.surface === 'loading:brief'),
        `${label}: Brief loader must visibly paint while extras are held`);
      assertTruthfulTrace(firstLoadingFrames, `${label} Calendar -> held Brief`, { clientOwned: true });

      assert.equal(run.network.releaseExtras(1), 4, `${label}: failure releases the exact four held extras`);
      await run.page.waitForSelector('[data-client-extras-state="error"]', { state: 'visible', timeout: 10_000 });
      await run.network.waitForExtraResponses(1);
      const retry = run.page.getByRole('button', { name: 'Try again', exact: true });
      await retry.focus();
      const failed = await run.page.evaluate(() => ({
        activeText: document.activeElement?.textContent.replace(/\s+/g, ' ').trim() || '',
        extrasStatus: _fetchExtrasState.status,
        fakeEmpty: /No Keywords Brief yet|No competitors brief yet/i.test(document.getElementById('content')?.innerText || ''),
        body: document.getElementById('content')?.innerText || '',
      }));
      assert.equal(failed.extrasStatus, 'error', `${label}: rejected extras must become an explicit error state`);
      assert.equal(failed.fakeEmpty, false, `${label}: rejected extras must never masquerade as an empty Brief`);
      assert.match(failed.body, /not replaced with an empty result/i, `${label}: failure copy must explain that empty data was not faked`);
      assert.equal(failed.activeText, 'Try again', `${label}: extras retry must be keyboard focusable`);
      await traceOf(run.page);

      await run.page.keyboard.press('Enter');
      await run.page.waitForSelector('[data-client-extras-state="loading"][data-client-entry-loading="brief"]', {
        state: 'visible',
        timeout: 10_000,
      });
      await run.network.waitForHeldExtras(2);
      const retryPending = await run.page.evaluate(() => ({
        extrasStatus: _fetchExtrasState.status,
        v: new URLSearchParams(location.search).get('v'),
        clientTab: history.state && history.state.clientTab,
        navigations: performance.getEntriesByType('navigation').length,
      }));
      assert.deepEqual(
        { extrasStatus: retryPending.extrasStatus, v: retryPending.v, clientTab: retryPending.clientTab },
        { extrasStatus: 'loading', v: 'brief', clientTab: 'brief' },
        `${label}: explicit retry must repaint the same Brief loader without changing route ownership`,
      );
      assert.equal(retryPending.navigations, 1, `${label}: extras retry must not reload the document`);
      assert.equal(run.network.verifierCalls.length, 2, `${label}: extras retry must not repeat strict verification`);
      assert.equal(run.network.extraRequests.filter(request => request.attempt === 2).length, 4,
        `${label}: retry must start one fresh four-sheet extras attempt`);
      const essentialReads = run.network.sensitiveClientReads.filter(read => (
        read.kind === 'sheet:Metrics' || read.kind === 'sheet:Clients Info'
      ));
      assert.equal(essentialReads.length, 4, `${label}: extras retry must preserve essentials instead of refetching them`);
      await traceOf(run.page);

      assert.equal(run.network.releaseExtras(2), 4, `${label}: success releases the exact four retry requests`);
      await run.network.waitForExtraResponses(2);
      await waitForClientTab(run.page, 'Brief');
      const recovered = await run.page.evaluate(() => ({
        extrasStatus: _fetchExtrasState.status,
        briefCount: briefs.length,
        loading: Boolean(document.querySelector('[data-client-extras-state="loading"]')),
        error: Boolean(document.querySelector('[data-client-extras-state="error"]')),
        active: document.querySelector('.view-tab-btn.active')?.textContent.replace(/\s+/g, ' ').trim() || '',
      }));
      assert.deepEqual(
        recovered,
        { extrasStatus: 'ready', briefCount: 1, loading: false, error: false, active: 'Brief' },
        `${label}: successful retry must rerender the active Brief with its loaded data`,
      );
      const recoveredFrames = await traceOf(run.page);
      const firstLoaderAt = recoveredFrames.findIndex(frame => frame.surface === 'loading:brief');
      const errorAt = recoveredFrames.findIndex(frame => frame.surface === 'extras:error');
      const secondLoaderAt = recoveredFrames.findIndex((frame, index) => index > errorAt && frame.surface === 'loading:brief');
      const mountedAt = recoveredFrames.findIndex((frame, index) => index > secondLoaderAt && frame.surface === 'mounted:client-brief');
      assert.ok(firstLoaderAt >= 0 && errorAt > firstLoaderAt && secondLoaderAt > errorAt && mountedAt > secondLoaderAt,
        `${label}: visible sequence must be Brief loader -> retry -> Brief loader -> mounted Brief\n${JSON.stringify(traceExcerpt(recoveredFrames), null, 2)}`);

      await run.page.goBack();
      await waitForCalendarSettled(run.page);
      await run.page.goForward();
      await waitForClientTab(run.page, 'Brief');
      const historyFrames = await traceOf(run.page);
      assertTruthfulTrace(historyFrames, `${label} Calendar -> Brief -> Back -> Forward`, { clientOwned: true });
      assert.equal(run.network.verifierCalls.length, 2, `${label}: same-document Back/Forward must not bypass or repeat verification`);
    }

    await run.page.getByRole('button', { name: 'Analytics', exact: true }).click();
    await waitForClientTab(run.page, 'Analytics');
    await run.page.waitForFunction(() => {
      const query = new URLSearchParams(location.search);
      return !query.has('v') && !document.getElementById('calView') && !document.getElementById('briefViewContainer');
    }, null, { timeout: 10_000 });
    await run.page.waitForTimeout(120);

    const final = await run.page.evaluate(() => ({
      active: document.querySelector('.view-tab-btn.active')?.textContent.replace(/\s+/g, ' ').trim() || '',
      embeddedClient: document.querySelector('.cal-embed-title strong')?.textContent.trim() || '',
      body: document.body.innerText,
      v: new URLSearchParams(location.search).get('v'),
      clientTab: history.state && history.state.clientTab,
      hasCalendar: Boolean(document.getElementById('calView')),
      hasBrief: Boolean(document.getElementById('briefViewContainer')),
    }));
    assert.equal(final.active, 'Analytics', `${label}: zero-data Analytics click must settle on Analytics`);
    assert.equal(final.v, null, `${label}: Analytics URL must remove the route view`);
    assert.equal(final.clientTab, 'analytics', `${label}: history state must agree with visible Analytics`);
    assert.equal(final.hasCalendar, false, `${label}: Calendar DOM must not remain after Analytics click`);
    assert.equal(final.hasBrief, false, `${label}: Brief DOM must not remain after Analytics click`);
    assert.match(final.body, /No analytics yet/i, `${label}: zero-data Analytics must render a visible honest empty state`);
    assert.equal(final.body.includes(CLIENT_B), false, `${label}: residual client must never become visible`);
    if (view === 'calendar') {
      const expectedExtrasErrors = run.consoleErrors.filter(message => /Failed to load resource: net::ERR_FAILED/i.test(message));
      assert.equal(expectedExtrasErrors.length, 1, `${label}: Chromium should report exactly the injected extras rejection`);
      assert.deepEqual(run.consoleErrors.filter(message => !expectedExtrasErrors.includes(message)), [],
        `${label}: no unexpected browser console errors`);
      assert.deepEqual(run.network.unmocked, [], `${label}: every external request must be explicitly mocked`);
      assert.deepEqual(run.pageErrors, [], `${label}: uncaught page errors are not allowed`);
    } else {
      assertHealthyHarness(run, label);
    }
    passGroup(label);
  } finally {
    await run.context.close();
  }
}

async function runBriefWorkTeardownScenario(browser, server) {
  const label = 'client Brief BFCache retires polling and tab-summary work';
  const run = await openBfcacheCase(browser, { view: 'brief', validVerifierCalls: 2 });
  try {
    const query = new URLSearchParams({ c: CLIENT_A, v: 'brief', t: CURRENT_TOKEN });
    await streamedNavigation(
      run.page,
      server,
      () => run.page.goto(`${server.origin}/bfcache.html?${query}`, { waitUntil: 'load', timeout: 15_000 }),
      'static:client-verify',
    );
    await waitForClientTab(run.page, 'Brief');
    await run.page.waitForFunction(() => (
      window.__syncviewBfcacheNetwork
      && window.__syncviewBfcacheNetwork.verifierResponses.length === 1
      && window.__syncviewBfcacheNetwork.verifierResponses[0].valid === true
      && window.__syncviewBfcacheNetwork.analyticsResponsesCompleted === 6
    ), null, { timeout: 10_000 });

    await run.page.evaluate(clientName => {
      window.__syncviewResetBootTrace();
      window.__syncviewPageShows = [];
      const state = {
        requests: [],
        pollCallback: null,
        pollIntervalId: null,
        pollCleared: false,
        pollPromise: null,
        tabPromise: null,
        pagehide: null,
        oldGeneration: _syncviewClientEntryDataRun && _syncviewClientEntryDataRun.generation,
        originalFetch: window.fetch,
        originalSetInterval: window.setInterval,
        originalClearInterval: window.clearInterval,
      };
      window.__syncviewBriefLifetime = state;

      window.fetch = (input, init = {}) => {
        const rawUrl = String(input && input.url || input || '');
        const body = String(init && init.body || '');
        let kind = '';
        if (rawUrl === TAB_SUMMARY_WEBHOOK && body.includes('synthetic-held-tab')) kind = 'tab-summary';
        else if (rawUrl.startsWith(MR_BRIEFS_URL)) kind = 'mr-briefs';
        else if (rawUrl.startsWith(BRIEFS_URL)) kind = 'briefs';
        if (!kind) return state.originalFetch.call(window, input, init);
        return new Promise(resolve => {
          state.requests.push({ kind, signal: init && init.signal || null, resolve });
        });
      };

      window.setInterval = (callback, delay, ...args) => {
        const id = state.originalSetInterval.call(window, () => {}, Math.max(Number(delay) || 0, 60_000));
        state.pollCallback = () => callback(...args);
        state.pollIntervalId = id;
        return id;
      };
      window.clearInterval = id => {
        if (id === state.pollIntervalId) state.pollCleared = true;
        return state.originalClearInterval.call(window, id);
      };

      startBriefPolling(clientName, new Date(), 'comp');
      window.setInterval = state.originalSetInterval;
      state.pollPromise = Promise.resolve().then(() => state.pollCallback());
      state.tabPromise = fetchTabSummary(
        clientName,
        'comp',
        'synthetic-held-tab',
        { synthetic: true },
      );

      window.addEventListener('pagehide', () => {
        state.pagehide = {
          pollCleared: state.pollCleared,
          signalsAborted: state.requests.map(request => Boolean(request.signal && request.signal.aborted)),
          capability: Boolean(_syncviewClientEntryCapability),
          dataRun: Boolean(_syncviewClientEntryDataRun),
          controllers: tabSummaryControllers.size,
          startTimers: tabSummaryStartTimers.size,
          pollingKeys: Object.keys(briefPollingState),
          surface: window.__syncviewBootSnapshot().surface,
        };
        window.__syncviewResetBootTrace();
      }, { once: true });
    }, CLIENT_A);

    await run.page.waitForFunction(() => (
      window.__syncviewBriefLifetime
      && window.__syncviewBriefLifetime.requests.length === 3
    ), null, { timeout: 10_000 });
    await run.page.waitForTimeout(60);
    const beforeHide = await traceOf(run.page);
    assert.ok(
      beforeHide.some(frame => frame.surface === 'mounted:client-brief'),
      `${label}: the real Brief surface must be visible while owned work is pending`,
    );

    // Keep the deliberately uncooperative promises alive, but restore the
    // normal synthetic transport before leaving so the fresh BFCache return
    // has to complete through the production verifier/data path.
    await run.page.evaluate(() => {
      const state = window.__syncviewBriefLifetime;
      window.fetch = state.originalFetch;
      window.setInterval = state.originalSetInterval;
    });
    const awayOrigin = server.origin.replace('127.0.0.1', 'localhost');
    await run.page.goto(`${awayOrigin}/boot-away`, { waitUntil: 'load', timeout: 15_000 });
    await run.page.waitForSelector('[data-boot-away]', { state: 'visible', timeout: 10_000 });

    const requestedDocument = await restoreFromBfcache(run.page, server, '/bfcache.html');
    await run.page.waitForFunction(() => (
      window.__syncviewBfcacheNetwork
      && window.__syncviewBfcacheNetwork.verifierResponses.length === 2
      && window.__syncviewBfcacheNetwork.verifierResponses[1].valid === true
      && window.__syncviewBfcacheNetwork.analyticsResponsesCompleted === 12
    ), null, { timeout: 10_000 });
    await waitForClientTab(run.page, 'Brief');
    await run.page.waitForTimeout(180);

    const beforeLateRelease = await run.page.evaluate(clientName => {
      const state = window.__syncviewBriefLifetime;
      window.clearInterval = state.originalClearInterval;
      const tabKey = getTabSummaryKey(clientName, 'comp', 'synthetic-held-tab');
      return {
        pagehide: state.pagehide,
        oldGeneration: state.oldGeneration,
        freshGeneration: _syncviewClientEntryDataRun && _syncviewClientEntryDataRun.generation,
        freshRunCurrent: _syncviewClientEntryRunCurrent(_syncviewClientEntryDataRun),
        pageShows: window.__syncviewPageShows.slice(),
        trace: window.__syncviewBootTrace.slice(),
        network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
        briefs: JSON.stringify(briefs),
        mrBriefs: JSON.stringify(mrBriefs),
        tabState: tabSummaryCache[tabKey] || null,
        tabCache: localStorage.getItem('syncview_tabSummaryCache_v2') || '',
        body: document.body.innerText || '',
        surface: window.__syncviewBootSnapshot().surface,
      };
    }, CLIENT_A);
    assert.equal(requestedDocument, false, `${label}: return must restore the document from BFCache`);
    assert.ok(
      beforeLateRelease.pageShows.some(event => event.persisted === true),
      `${label}: pageshow.persisted must prove actual BFCache restoration`,
    );
    assert.equal(beforeLateRelease.pagehide.pollCleared, true, `${label}: purge must clear the retained polling interval handle`);
    assert.deepEqual(beforeLateRelease.pagehide.signalsAborted, [true, true, true], `${label}: every held Brief transport must observe revocation`);
    assert.equal(beforeLateRelease.pagehide.capability, false, `${label}: pagehide must revoke client capability`);
    assert.equal(beforeLateRelease.pagehide.dataRun, false, `${label}: pagehide must retire the old client data generation`);
    assert.equal(beforeLateRelease.pagehide.controllers, 0, `${label}: purge must drop every tab-summary controller`);
    assert.equal(beforeLateRelease.pagehide.startTimers, 0, `${label}: purge must drop every delayed tab-summary launch`);
    assert.deepEqual(beforeLateRelease.pagehide.pollingKeys, [], `${label}: purge must clear visible polling state only after cancellation`);
    assert.equal(beforeLateRelease.pagehide.surface, 'loading:verify', `${label}: pagehide must synchronously install the neutral verifier`);
    assert.ok(
      beforeLateRelease.freshGeneration > beforeLateRelease.oldGeneration,
      `${label}: persisted return must create one newer client-entry data generation`,
    );
    assert.equal(beforeLateRelease.freshRunCurrent, true, `${label}: the replacement Brief generation must own the restored route`);
    assert.equal(beforeLateRelease.network.verifierCalls.length, 2, `${label}: BFCache return must verify exactly once`);
    assert.deepEqual(beforeLateRelease.network.verifierResponses.map(item => item.valid), [true, true], `${label}: both strict verifier calls must succeed`);
    assert.deepEqual(beforeLateRelease.network.unmocked, [], `${label}: every BFCache request must remain synthetic`);
    assert.ok(beforeLateRelease.trace.some(frame => frame.surface === 'loading:verify'), `${label}: restored document must visibly re-enter verification`);
    assert.ok(beforeLateRelease.trace.some(frame => frame.surface === 'mounted:client-brief'), `${label}: one healthy fresh Brief generation must visibly settle`);
    assertTruthfulTrace(beforeLateRelease.trace, label, { clientOwned: true });

    const lateMarker = 'SYNTHETIC_LATE_BRIEF_RESULT';
    const afterLateRelease = await run.page.evaluate(async ({ clientName, marker }) => {
      const state = window.__syncviewBriefLifetime;
      for (const request of state.requests) {
        let text = '';
        if (request.kind === 'tab-summary') text = JSON.stringify({ summary: marker });
        else if (request.kind === 'briefs') {
          text = `client_name,raw_json,id\n${clientName},"{}",2099-01-01T00:00:00.000Z\n`;
        } else {
          text = `client_name,brief_name,brief_date,brief_content\n${clientName},${marker},2099-01-01,${marker}\n`;
        }
        request.resolve({ ok: true, status: 200, text: async () => text });
      }
      await Promise.allSettled([state.pollPromise, state.tabPromise]);
      await new Promise(resolve => setTimeout(resolve, 0));
      const tabKey = getTabSummaryKey(clientName, 'comp', 'synthetic-held-tab');
      return {
        briefs: JSON.stringify(briefs),
        mrBriefs: JSON.stringify(mrBriefs),
        tabState: tabSummaryCache[tabKey] || null,
        tabCache: localStorage.getItem('syncview_tabSummaryCache_v2') || '',
        body: document.body.innerText || '',
        surface: window.__syncviewBootSnapshot().surface,
        generation: _syncviewClientEntryDataRun && _syncviewClientEntryDataRun.generation,
        runCurrent: _syncviewClientEntryRunCurrent(_syncviewClientEntryDataRun),
        verifierCalls: window.__syncviewBfcacheNetwork.verifierCalls.length,
      };
    }, { clientName: CLIENT_A, marker: lateMarker });
    assert.deepEqual(
      { briefs: afterLateRelease.briefs, mrBriefs: afterLateRelease.mrBriefs, tabState: afterLateRelease.tabState },
      { briefs: beforeLateRelease.briefs, mrBriefs: beforeLateRelease.mrBriefs, tabState: beforeLateRelease.tabState },
      `${label}: late responses cannot replace the fresh Brief globals`,
    );
    assert.equal(afterLateRelease.tabCache, beforeLateRelease.tabCache, `${label}: late tab summary cannot change localStorage`);
    assert.equal(afterLateRelease.tabCache.includes(lateMarker), false, `${label}: late tab summary marker cannot enter localStorage`);
    assert.equal(afterLateRelease.body.includes(lateMarker), false, `${label}: late Brief work cannot repaint the fresh document`);
    assert.equal(afterLateRelease.surface, beforeLateRelease.surface, `${label}: late work cannot replace the fresh Brief surface`);
    assert.equal(afterLateRelease.generation, beforeLateRelease.freshGeneration, `${label}: late work cannot replace the fresh generation`);
    assert.equal(afterLateRelease.runCurrent, true, `${label}: the one fresh generation remains healthy after late release`);
    assert.equal(afterLateRelease.verifierCalls, 2, `${label}: late work must not trigger another verification`);
    assert.deepEqual(run.consoleErrors, [], `${label}: browser console errors are not allowed`);
    assert.deepEqual(run.pageErrors, [], `${label}: uncaught page errors are not allowed`);
    passGroup(label);
  } finally {
    await run.context.close();
  }
}

async function runInvalidEntryMatrix(browser, server) {
  const encodedA = encodeURIComponent(CLIENT_A);
  const encodedB = encodeURIComponent(CLIENT_B);
  const cases = [
    {
      name: 'missing token',
      suffix: `?c=${encodedA}`,
      verifierCalls: 0,
    },
    {
      name: 'unknown client',
      suffix: `?c=${encodeURIComponent('Unknown Fixture Client')}&t=${CURRENT_TOKEN}`,
      verifierCalls: 1,
    },
    {
      name: 'invalid token',
      suffix: `?c=${encodedA}&t=synthetic-rotated-token`,
      verifierCalls: 1,
    },
    {
      name: 'duplicate client',
      suffix: `?c=${encodedA}&c=${encodedB}&t=${CURRENT_TOKEN}`,
      verifierCalls: 0,
    },
    {
      name: 'mixed production query',
      suffix: `?c=${encodedA}&t=${CURRENT_TOKEN}&prod=1`,
      verifierCalls: 0,
    },
    {
      name: 'mixed staff hash',
      suffix: `?c=${encodedA}&t=${CURRENT_TOKEN}#calendar`,
      verifierCalls: 0,
    },
  ];

  for (const testCase of cases) {
    const label = `F102 ${testCase.name}`;
    const run = await openCase(browser, server);
    try {
      await streamedNavigation(
        run.page,
        server,
        () => run.page.goto(`${server.origin}/index.html${testCase.suffix}`, { waitUntil: 'load', timeout: 15_000 }),
        'static:client-verify',
      );
      await run.page.waitForSelector('[data-client-entry-state="invalid"]', { state: 'visible', timeout: 10_000 });
      const frames = await traceOf(run.page);
      assert.ok(frames.some(frame => frame.surface === 'static:client-verify'), `${label}: neutral verifier must paint first`);
      assert.ok(frames.some(frame => frame.surface === 'entry:invalid'), `${label}: terminal invalid surface must paint`);
      assertTruthfulTrace(frames, label, { clientOwned: true });
      assert.equal(run.network.verifierCalls.length, testCase.verifierCalls, `${label}: verifier call count`);
      assert.deepEqual(
        run.network.sensitiveClientReads,
        [],
        `${label}: no analytics, roster, Calendar, or Samples client data may load`,
      );
      const final = await run.page.evaluate(() => ({
        state: document.querySelector('[data-client-entry-state]')?.getAttribute('data-client-entry-state') || '',
        text: document.getElementById('content')?.innerText || '',
      }));
      assert.equal(final.state, 'invalid', `${label}: terminal state`);
      assert.match(final.text, /link isn't valid/i, `${label}: visible invalid-link copy`);
      assertHealthyHarness(run, label);
      passGroup(label);
    } finally {
      await run.context.close();
    }
  }
}

async function runVerifierBoundaryScenario(browser, server, options) {
  const label = options.label;
  const run = await openCase(browser, server, { network: options.network });
  try {
    const query = new URLSearchParams({ c: CLIENT_A, v: 'calendar', t: CURRENT_TOKEN });
    await streamedNavigation(
      run.page,
      server,
      () => run.page.goto(`${server.origin}/index.html?${query}`, { waitUntil: 'load', timeout: 15_000 }),
      'static:client-verify',
    );
    await run.page.waitForSelector('[data-client-entry-state="invalid"]', { state: 'visible', timeout: 10_000 });
    const frames = await traceOf(run.page);
    assert.ok(frames.some(frame => frame.surface === 'static:client-verify'), `${label}: neutral verifier must paint first`);
    assert.ok(frames.some(frame => frame.surface === 'entry:invalid'), `${label}: invalid surface must paint`);
    assertTruthfulTrace(frames, label, { clientOwned: true });
    assert.equal(run.network.verifierCalls.length, 1, `${label}: exactly one verifier call`);
    assert.deepEqual(
      run.network.sensitiveClientReads,
      [],
      `${label}: an incomplete or mismatched verifier response must be rejected before client data starts`,
    );
    assertHealthyHarness(run, label);
    passGroup(label);
  } finally {
    await run.context.close();
  }
}

async function runVerifierRetryScenario(browser, server, status) {
  const label = `F102 verifier ${status} visible retry recovery`;
  const run = await openCase(browser, server, {
    network: { verifierPlan: [{ status }] },
  });
  try {
    const query = new URLSearchParams({ c: CLIENT_A, v: 'calendar', t: CURRENT_TOKEN });
    await streamedNavigation(
      run.page,
      server,
      () => run.page.goto(`${server.origin}/index.html?${query}`, { waitUntil: 'load', timeout: 15_000 }),
      'static:client-verify',
    );
    await run.page.waitForSelector('[data-client-entry-state="retry"]', { state: 'visible', timeout: 10_000 });
    await run.page.waitForTimeout(150);

    const failedFrames = await traceOf(run.page);
    assert.ok(failedFrames.some(frame => frame.surface === 'static:client-verify'), `${label}: neutral verifier must paint first`);
    assert.ok(failedFrames.some(frame => frame.surface === 'entry:retry'), `${label}: a visible retry surface must replace the verifier`);
    assert.equal(failedFrames.some(frame => frame.surface === 'entry:invalid'), false, `${label}: a retryable outage must not masquerade as a terminal invalid link`);
    assertTruthfulTrace(failedFrames, `${label} failed attempt`, { clientOwned: true });
    assert.equal(run.network.verifierCalls.length, 1, `${label}: no automatic verifier retry`);
    assert.equal(run.network.verifierResponses[0]?.status, status, `${label}: first verifier response is the injected outage`);
    assert.deepEqual(run.network.sensitiveClientReads, [], `${label}: no client data may load before an explicit retry succeeds`);

    const retryButton = run.page.getByRole('button', { name: 'Try again', exact: true });
    await retryButton.waitFor({ state: 'visible', timeout: 10_000 });
    await retryButton.focus();
    assert.equal(
      await run.page.evaluate(() => document.activeElement?.textContent.replace(/\s+/g, ' ').trim()),
      'Try again',
      `${label}: retry affordance must be keyboard focusable`,
    );

    await run.page.evaluate(() => { window.__syncviewBootTrace = []; });
    await run.page.keyboard.press('Enter');
    await waitForCalendarSettled(run.page);
    const recoveredFrames = await traceOf(run.page);
    const verifyIndex = recoveredFrames.findIndex(frame => frame.surface === 'loading:verify');
    const loaderIndex = recoveredFrames.findIndex(frame => frame.surface === 'loading:calendar');
    const mountedIndex = recoveredFrames.findIndex(frame => frame.surface === 'mounted:calendar');
    assert.ok(
      verifyIndex >= 0,
      `${label}: explicit retry must repaint the neutral verifier\n${JSON.stringify(traceExcerpt(recoveredFrames), null, 2)}`,
    );
    assert.ok(loaderIndex > verifyIndex, `${label}: Calendar loader must follow the successful strict verdict`);
    assert.ok(mountedIndex > loaderIndex, `${label}: settled Calendar must follow its route-owned loader`);
    assertTruthfulTrace(recoveredFrames, `${label} recovered attempt`, { clientOwned: true });

    assert.equal(run.network.verifierCalls.length, 2, `${label}: one explicit retry makes exactly one new verifier call`);
    assert.equal(run.network.verifierResponses[1]?.valid, true, `${label}: retry receives a valid strict verdict`);
    assertVerifiedBeforeClientReads(run.network, label);
    const final = await run.page.evaluate(() => ({
      active: document.querySelector('.view-tab-btn.active')?.textContent.replace(/\s+/g, ' ').trim() || '',
      embeddedClient: document.querySelector('.cal-embed-title strong')?.textContent.trim() || '',
      navigations: performance.getEntriesByType('navigation').length,
    }));
    assert.equal(final.active, 'Content Calendar', `${label}: retry settles on the requested route`);
    assert.equal(final.embeddedClient, CLIENT_A, `${label}: retry remains bound to the exact verified client`);
    assert.equal(final.navigations, 1, `${label}: retry must not reload the document`);

    const expectedStatusErrors = run.consoleErrors.filter(message => (
      /Failed to load resource/i.test(message) && new RegExp(`\\b${status}\\b`).test(message)
    ));
    assert.equal(expectedStatusErrors.length, 1, `${label}: Chromium should report exactly the injected verifier ${status}`);
    assert.deepEqual(
      run.consoleErrors.filter(message => !expectedStatusErrors.includes(message)),
      [],
      `${label}: no unexpected browser console errors`,
    );
    assert.deepEqual(run.network.unmocked, [], `${label}: every external request must be explicitly mocked`);
    assert.deepEqual(run.pageErrors, [], `${label}: uncaught page errors are not allowed`);
    passGroup(label);
  } finally {
    await run.context.close();
  }
}

async function runRotatedTokenReloadScenario(browser, server) {
  const label = 'F102 valid-first rotated-token reload denial';
  const run = await openCase(browser, server, { network: { rotateAfterFirst: true } });
  try {
    const query = new URLSearchParams({ c: CLIENT_A, v: 'calendar', t: CURRENT_TOKEN });
    await streamedNavigation(
      run.page,
      server,
      () => run.page.goto(`${server.origin}/index.html?${query}`, { waitUntil: 'load', timeout: 15_000 }),
      'static:client-verify',
    );
    await waitForCalendarSettled(run.page);
    await traceOf(run.page);
    assert.equal(run.network.verifierCalls.length, 1, `${label}: first boot verifies once`);
    assert.equal(run.network.verifierResponses[0].valid, true, `${label}: first boot receives current-token verdict`);
    const readsBeforeReload = run.network.sensitiveClientReads.length;
    assert.ok(readsBeforeReload > 0, `${label}: first valid boot must populate real in-memory/cache paths`);

    await streamedNavigation(
      run.page,
      server,
      () => run.page.reload({ waitUntil: 'load', timeout: 15_000 }),
      'static:client-verify',
    );
    await run.page.waitForSelector('[data-client-entry-state="invalid"]', { state: 'visible', timeout: 10_000 });
    const reloadFrames = await traceOf(run.page);
    assertTruthfulTrace(reloadFrames, `${label} reload`, { clientOwned: true });
    assert.equal(run.network.verifierCalls.length, 2, `${label}: reload verifies again`);
    assert.equal(run.network.verifierResponses[1].valid, false, `${label}: reload receives rotated-token denial`);
    assert.equal(
      run.network.sensitiveClientReads.length,
      readsBeforeReload,
      `${label}: denied reload must not read or repaint cached/client data`,
    );
    const final = await run.page.evaluate(() => ({
      invalid: Boolean(document.querySelector('[data-client-entry-state="invalid"]')),
      calendar: Boolean(document.getElementById('calView')),
      analytics: Boolean(document.querySelector('.analytics-detail-skeleton, .analytics-overview-skeleton')),
      text: document.getElementById('content')?.innerText || '',
    }));
    assert.deepEqual(
      { invalid: final.invalid, calendar: final.calendar, analytics: final.analytics },
      { invalid: true, calendar: false, analytics: false },
      `${label}: denial must replace every stale client surface`,
    );
    assert.match(final.text, /link isn't valid/i, `${label}: denial must remain visible`);
    assertHealthyHarness(run, label);
    passGroup(label);
  } finally {
    await run.context.close();
  }
}

async function runRotatedTokenBfcacheScenario(browser, server) {
  const label = 'F102 valid-first rotated-token BFCache Back denial';
  const run = await openBfcacheCase(browser);
  try {
    const query = new URLSearchParams({ c: CLIENT_A, v: 'calendar', t: CURRENT_TOKEN });
    await streamedNavigation(
      run.page,
      server,
      () => run.page.goto(`${server.origin}/bfcache.html?${query}`, { waitUntil: 'load', timeout: 15_000 }),
      'static:client-verify',
    );
    await waitForCalendarSettled(run.page);
    await run.page.waitForTimeout(180);
    const initialNetwork = await run.page.evaluate(() => JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)));
    assert.equal(initialNetwork.verifierCalls.length, 1, `${label}: first boot verifies once`);
    assert.equal(initialNetwork.verifierResponses[0].valid, true, `${label}: first boot receives current-token verdict`);
    const readsBeforeAway = initialNetwork.sensitiveClientReads.length;
    assert.ok(readsBeforeAway > 0, `${label}: first valid boot must populate real in-memory/cache paths`);

    // Retain only frames and lifecycle events produced by the cross-document
    // return. A secure pageshow guard must synchronously replace the restored
    // client DOM before the next paint, then obtain a fresh strict verdict.
    await run.page.evaluate(() => {
      window.__syncviewPageShows = [];
      window.addEventListener('pagehide', () => {
        window.__syncviewResetBootTrace();
      }, { capture: true, once: true });
    });
    const awayOrigin = server.origin.replace('127.0.0.1', 'localhost');
    await run.page.goto(`${awayOrigin}/boot-away`, { waitUntil: 'load', timeout: 15_000 });
    await run.page.waitForSelector('[data-boot-away]', { state: 'visible', timeout: 10_000 });

    const requestedDocument = await restoreFromBfcache(run.page, server, '/bfcache.html');
    await run.page.waitForFunction(() => Array.isArray(window.__syncviewPageShows)
      && window.__syncviewPageShows.length > 0, null, { timeout: 10_000 });
    await run.page.waitForTimeout(250);

    const restored = await run.page.evaluate(() => ({
      pageShows: window.__syncviewPageShows.slice(),
      trace: window.__syncviewBootTrace.slice(),
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
      state: document.querySelector('[data-client-entry-state]')?.getAttribute('data-client-entry-state') || '',
      calendar: Boolean(document.getElementById('calView')),
      capability: typeof _syncviewClientEntryCapability !== 'undefined'
        && Boolean(_syncviewClientEntryCapability && _syncviewClientEntryCapability.verified),
      body: document.getElementById('content')?.innerText || '',
    }));
    const evidence = {
      requestedDocument,
      pageShows: restored.pageShows,
      verifierCalls: restored.network.verifierCalls,
      verifierResponses: restored.network.verifierResponses,
      readsBeforeAway,
      readsAfterBack: restored.network.sensitiveClientReads.length,
      supportReadsAfterBack: restored.network.supportReads.length,
      unmocked: restored.network.unmocked,
      finalState: restored.state,
      calendar: restored.calendar,
      capability: restored.capability,
      trace: traceExcerpt(restored.trace),
    };

    assert.equal(requestedDocument, false, `${label}: must exercise a cached restore, not a network document reload\n${JSON.stringify(evidence, null, 2)}`);
    assert.ok(
      restored.pageShows.some(event => event.persisted === true),
      `${label}: pageshow.persisted must prove BFCache restoration\n${JSON.stringify(evidence, null, 2)}`,
    );
    assert.equal(restored.network.verifierCalls.length, 2, `${label}: persisted return must obtain exactly one fresh strict verdict\n${JSON.stringify(evidence, null, 2)}`);
    assert.equal(restored.network.verifierCalls[1].body.strict, true, `${label}: persisted verdict must remain strict`);
    assert.equal(restored.network.verifierResponses[1]?.valid, false, `${label}: rotated token must be denied on persisted return`);
    assert.equal(
      restored.network.sensitiveClientReads.length,
      readsBeforeAway,
      `${label}: no Calendar, analytics, Brief, or Samples read may start before/after denied revalidation\n${JSON.stringify(evidence, null, 2)}`,
    );
    assert.deepEqual(restored.network.unmocked, [], `${label}: every external request must be synthetic`);
    assert.equal(restored.state, 'invalid', `${label}: denial must visibly replace the restored client surface`);
    assert.equal(restored.calendar, false, `${label}: stale Calendar DOM must be purged`);
    assert.equal(restored.capability, false, `${label}: stale client capability must be revoked`);
    assert.match(restored.body, /link isn't valid/i, `${label}: denial must remain visible`);
    assert.ok(restored.trace.some(frame => frame.surface === 'loading:verify'), `${label}: neutral verifier must visibly paint on cached return`);
    assert.deepEqual(
      restored.trace.filter(frame => frame.calendarVisible || frame.surface === 'mounted:calendar'),
      [],
      `${label}: restored Calendar must never reach a painted frame before denial\n${JSON.stringify(evidence, null, 2)}`,
    );
    assertTruthfulTrace(restored.trace, label, { clientOwned: true });
    assert.deepEqual(run.consoleErrors, [], `${label}: browser console errors are not allowed`);
    assert.deepEqual(run.pageErrors, [], `${label}: uncaught page errors are not allowed`);
    passGroup(label);
  } finally {
    await run.context.close();
  }
}

async function runPendingAnalyticsBfcacheScenario(browser, server) {
  const label = 'F102 pending analytics reads BFCache Back denial';
  const staleCache = JSON.stringify({
    v: 1,
    at: 1784520000000,
    metrics: `client_name,date,ig_followers\n${CLIENT_B},2026-07-19,9999\n`,
    clients: `client_name,content_description\n${CLIENT_B},Residual cache fixture\n`,
  });
  const residualCaptionJobs = JSON.stringify([{
    jobId: 'synthetic-client-boundary-job',
    pid: 'synthetic-client-boundary-card',
    client: 'residualfixtureclient',
    clientName: CLIENT_B,
    assetUrl: 'https://f.io/synthetic-client-boundary-asset',
    captionPrompt: 'Synthetic browser-only caption prompt',
    status: 'queued',
    stage: 'queued',
    startedAt: Date.now(),
    confirmed: false,
    posted: false,
    cancelRequested: false,
  }]);
  const run = await openBfcacheCase(browser, {
    view: 'analytics',
    holdAnalytics: true,
    storage: {
      local: {
        syncview_analyticsCache_v1: staleCache,
        syncview_captionJobs_v1: residualCaptionJobs,
      },
    },
  });
  try {
    const query = new URLSearchParams({ c: CLIENT_A, t: CURRENT_TOKEN });
    await streamedNavigation(
      run.page,
      server,
      () => run.page.goto(`${server.origin}/bfcache.html?${query}`, { waitUntil: 'load', timeout: 15_000 }),
      'static:client-verify',
    );
    await run.page.waitForSelector('[data-client-entry-loading="analytics"]', { state: 'visible', timeout: 10_000 });
    await run.page.waitForFunction(() => {
      const network = window.__syncviewBfcacheNetwork;
      return network
        && network.verifierResponses.length === 1
        && network.verifierResponses[0].valid === true
        && network.heldAnalyticsRequests === 6;
    }, null, { timeout: 10_000 });
    const initial = await run.page.evaluate(() => JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)));
    assert.equal(initial.verifierCalls.length, 1, `${label}: first document verifies once`);
    assert.equal(initial.sensitiveClientReads.length, 6, `${label}: both essentials and all extras must be pending`);
    assert.equal(initial.analyticsResponsesCompleted, 0, `${label}: no held analytics response may settle before pagehide`);

    await run.page.evaluate(() => {
      window.__syncviewPageShows = [];
      window.addEventListener('pagehide', () => {
        window.__syncviewResetBootTrace();
      }, { capture: true, once: true });
    });
    const awayOrigin = server.origin.replace('127.0.0.1', 'localhost');
    await run.page.goto(`${awayOrigin}/boot-away`, { waitUntil: 'load', timeout: 15_000 });
    await run.page.waitForSelector('[data-boot-away]', { state: 'visible', timeout: 10_000 });

    const requestedDocument = await restoreFromBfcache(run.page, server, '/bfcache.html');
    await run.page.waitForFunction(() => Array.isArray(window.__syncviewPageShows)
      && window.__syncviewPageShows.length > 0, null, { timeout: 10_000 });
    await run.page.waitForSelector('[data-client-entry-state="invalid"]', { state: 'visible', timeout: 10_000 });

    const beforeRelease = await run.page.evaluate(() => ({
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
      cache: localStorage.getItem('syncview_analyticsCache_v1'),
      captionJobs: localStorage.getItem('syncview_captionJobs_v1'),
      state: document.querySelector('[data-client-entry-state]')?.getAttribute('data-client-entry-state') || '',
      capability: typeof _syncviewClientEntryCapability !== 'undefined'
        && Boolean(_syncviewClientEntryCapability && _syncviewClientEntryCapability.verified),
      dataRun: typeof _syncviewClientEntryDataRun !== 'undefined' && Boolean(_syncviewClientEntryDataRun),
    }));
    assert.equal(requestedDocument, false, `${label}: must restore from BFCache, not load a document`);
    assert.ok(
      beforeRelease.network.verifierCalls.length === 2
        && beforeRelease.network.verifierResponses[1]?.valid === false,
      `${label}: persisted return must obtain one rotated-token denial`,
    );
    assert.equal(beforeRelease.state, 'invalid', `${label}: denial must be visible before old responses settle`);
    assert.equal(beforeRelease.capability, false, `${label}: restored capability must be revoked`);
    assert.equal(beforeRelease.dataRun, false, `${label}: prior analytics run must be detached`);
    assert.equal(beforeRelease.cache, null, `${label}: denial must clear the prior analytics cache`);
    assert.equal(beforeRelease.captionJobs, residualCaptionJobs, `${label}: client entry must not mutate a staff caption-job queue`);

    // Resolve the deliberately uncooperative old requests only after denial.
    // They ignore AbortSignal at the transport boundary, so the generation /
    // href / slug lease must independently prevent apply, cache, or repaint.
    await run.page.evaluate(() => window.__syncviewReleaseBfcacheAnalytics());
    await run.page.waitForFunction(() => window.__syncviewBfcacheNetwork.analyticsResponsesCompleted === 6, null, { timeout: 10_000 });
    await run.page.waitForTimeout(250);

    const restored = await run.page.evaluate(() => ({
      pageShows: window.__syncviewPageShows.slice(),
      trace: window.__syncviewBootTrace.slice(),
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
      cache: localStorage.getItem('syncview_analyticsCache_v1'),
      captionJobs: localStorage.getItem('syncview_captionJobs_v1'),
      state: document.querySelector('[data-client-entry-state]')?.getAttribute('data-client-entry-state') || '',
      calendar: Boolean(document.getElementById('calView')),
      analyticsClientSurface: Boolean(
        document.querySelector('.view-tabs, .analytics-detail-skeleton, .analytics-overview-skeleton')
      ),
      capability: typeof _syncviewClientEntryCapability !== 'undefined'
        && Boolean(_syncviewClientEntryCapability && _syncviewClientEntryCapability.verified),
      globals: {
        allData: Array.isArray(allData) ? allData.length : -1,
        clientMap: clientMap && typeof clientMap === 'object' ? Object.keys(clientMap).length : -1,
        topVideos: Array.isArray(topVideos) ? topVideos.length : -1,
        briefs: Array.isArray(briefs) ? briefs.length : -1,
        mrBriefs: Array.isArray(mrBriefs) ? mrBriefs.length : -1,
      },
      body: document.getElementById('content')?.innerText || '',
    }));
    const evidence = {
      requestedDocument,
      pageShows: restored.pageShows,
      verifierCalls: restored.network.verifierCalls,
      verifierResponses: restored.network.verifierResponses,
      heldAnalyticsRequests: restored.network.heldAnalyticsRequests,
      analyticsResponsesCompleted: restored.network.analyticsResponsesCompleted,
      sensitiveClientReads: restored.network.sensitiveClientReads,
      unmocked: restored.network.unmocked,
      captionBoundaryRequests: restored.network.captionBoundaryRequests,
      cache: restored.cache,
      captionJobs: restored.captionJobs,
      state: restored.state,
      capability: restored.capability,
      globals: restored.globals,
      trace: traceExcerpt(restored.trace),
    };

    assert.ok(
      restored.pageShows.some(event => event.persisted === true),
      `${label}: pageshow.persisted must prove actual BFCache restoration\n${JSON.stringify(evidence, null, 2)}`,
    );
    assert.equal(restored.network.verifierCalls.length, 2, `${label}: no retry or duplicate verifier call`);
    assert.equal(restored.network.verifierCalls[1].body.strict, true, `${label}: return verifier remains strict`);
    assert.equal(restored.network.sensitiveClientReads.length, 6, `${label}: return/denial must start no new client read`);
    assert.ok(
      restored.network.sensitiveClientReads.every(read => read.signalAbortedAfterHold === true),
      `${label}: pagehide must abort every old analytics request before its late response\n${JSON.stringify(evidence, null, 2)}`,
    );
    assert.deepEqual(restored.network.unmocked, [], `${label}: every external request must be synthetic`);
    assert.deepEqual(
      restored.network.captionBoundaryRequests,
      [],
      `${label}: client entry must never restore, POST, poll, or support a staff caption job`,
    );
    assert.equal(restored.cache, null, `${label}: late responses must not recreate the analytics cache`);
    assert.equal(restored.captionJobs, residualCaptionJobs, `${label}: staff caption-job storage must remain untouched`);
    assert.deepEqual(
      restored.globals,
      { allData: 0, clientMap: 0, topVideos: 0, briefs: 0, mrBriefs: 0 },
      `${label}: late responses must not apply into analytics globals`,
    );
    assert.equal(restored.state, 'invalid', `${label}: denial must survive every late response`);
    assert.equal(restored.calendar, false, `${label}: no Calendar surface may return`);
    assert.equal(restored.analyticsClientSurface, false, `${label}: no stale Analytics client surface may return`);
    assert.equal(restored.capability, false, `${label}: stale capability must remain revoked`);
    assert.match(restored.body, /link isn't valid/i, `${label}: terminal denial copy remains visible`);
    assertTruthfulTrace(restored.trace, label, { clientOwned: true });
    assert.deepEqual(run.consoleErrors, [], `${label}: browser console errors are not allowed`);
    assert.deepEqual(run.pageErrors, [], `${label}: uncaught page errors are not allowed`);
    passGroup(label);
  } finally {
    await run.context.close();
  }
}

async function runPendingCalendarOwnershipScenario(browser, server) {
  const label = 'F102 pending Calendar transport ownership retirement';
  const residualCaptionJobs = JSON.stringify([{
    jobId: 'synthetic-calendar-boundary-job',
    pid: 'synthetic-calendar-boundary-card',
    client: 'residualfixtureclient',
    clientName: CLIENT_B,
    assetUrl: 'https://f.io/synthetic-calendar-boundary-asset',
    captionPrompt: 'Synthetic staff-only Calendar boundary prompt',
    status: 'queued',
    stage: 'queued',
    startedAt: Date.now(),
    confirmed: false,
    posted: false,
    cancelRequested: false,
  }]);
  const clientRun = await openBfcacheCase(browser, {
    view: 'calendar',
    holdCalendar: true,
    storage: {
      local: {
        syncview_captionJobs_v1: residualCaptionJobs,
      },
    },
  });
  try {
    const query = new URLSearchParams({
      c: CLIENT_A,
      v: 'calendar',
      t: CURRENT_TOKEN,
    });
    await streamedNavigation(
      clientRun.page,
      server,
      () => clientRun.page.goto(`${server.origin}/bfcache.html?${query}`, { waitUntil: 'load', timeout: 15_000 }),
      'static:client-verify',
    );
    await clientRun.page.waitForFunction(expectedClient => {
      const network = window.__syncviewBfcacheNetwork;
      return network
        && network.verifierResponses.length === 1
        && network.verifierResponses[0].valid === true
        && network.heldCalendarRequests === 1
        && document.querySelector('#calView .cal-embed-title strong')?.textContent.trim() === expectedClient;
    }, CLIENT_A, { timeout: 10_000 });
    assertTruthfulTrace(
      await traceOf(clientRun.page),
      `${label} initial held Calendar`,
      { clientOwned: true },
    );

    // Calendar → Brief is a same-document profile transition and never enters
    // navTo(). It must retire the Calendar transport before replacing the DOM.
    await clientRun.page.evaluate(() => { window.__syncviewBootTrace = []; });
    await clientRun.page.locator('.view-tab-btn', { hasText: 'Brief' }).click();
    await waitForClientTab(clientRun.page, 'Brief');
    await clientRun.page.waitForFunction(() => (
      window.__syncviewBfcacheNetwork.calendarAbortEvents === 1
    ), null, { timeout: 10_000 });
    const briefBeforeRelease = await clientRun.page.evaluate(() => ({
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
      activeTab: Array.from(document.querySelectorAll('.view-tab-btn.active'))
        .find(element => getComputedStyle(element).display !== 'none')?.textContent.trim() || '',
      calendarVisible: Boolean(document.getElementById('calView')),
      posts: Array.isArray(calState.posts) ? calState.posts.length : -1,
      cache: localStorage.getItem('syncview_calCache_v2:bootfixtureclient'),
      realtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
      captionJobs: localStorage.getItem('syncview_captionJobs_v1'),
    }));
    const briefCalendarReads = briefBeforeRelease.network.sensitiveClientReads
      .filter(read => read.kind === 'calendar_posts');
    assert.equal(briefCalendarReads.length, 1, `${label}: one exact-client Calendar read is held`);
    assert.equal(briefCalendarReads[0].signalAbortedBeforeRelease, true,
      `${label}: Calendar → Brief must abort the transport before the late response`);
    assert.equal(briefBeforeRelease.activeTab, 'Brief', `${label}: Brief must own the visible route before release`);
    assert.equal(briefBeforeRelease.calendarVisible, false, `${label}: Calendar DOM must be retired on Brief`);
    assert.equal(briefBeforeRelease.posts, 0, `${label}: held Calendar rows must not apply before release`);
    assert.equal(briefBeforeRelease.cache, null, `${label}: held Calendar rows must not cache before release`);
    assert.deepEqual(calendarRealtime(briefBeforeRelease.realtime).created, [],
      `${label}: a held read must not subscribe Calendar realtime`);
    assert.equal(briefBeforeRelease.captionJobs, residualCaptionJobs, `${label}: staff caption jobs remain untouched`);

    await clientRun.page.evaluate(() => window.__syncviewReleaseBfcacheCalendar());
    await clientRun.page.waitForFunction(() => (
      window.__syncviewBfcacheNetwork.calendarResponsesCompleted === 1
    ), null, { timeout: 10_000 });
    await clientRun.page.waitForTimeout(200);
    const briefAfterRelease = await clientRun.page.evaluate(expectedRow => ({
      activeTab: Array.from(document.querySelectorAll('.view-tab-btn.active'))
        .find(element => getComputedStyle(element).display !== 'none')?.textContent.trim() || '',
      calendarVisible: Boolean(document.getElementById('calView')),
      posts: Array.isArray(calState.posts) ? calState.posts.length : -1,
      cache: localStorage.getItem('syncview_calCache_v2:bootfixtureclient'),
      realtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
      leakedRow: document.getElementById('content')?.innerText.includes(expectedRow) || false,
      captionJobs: localStorage.getItem('syncview_captionJobs_v1'),
      transitionTrace: window.__syncviewBootTrace.slice(),
    }), CALENDAR_ROWS[0].name);
    const { transitionTrace: briefTransitionTrace, ...briefAfterReleaseState } = briefAfterRelease;
    assert.deepEqual(
      { ...briefAfterReleaseState, realtime: calendarRealtime(briefAfterRelease.realtime) },
      {
        activeTab: 'Brief',
        calendarVisible: false,
        posts: 0,
        cache: null,
        realtime: { created: [], subscribed: [], removed: [], unsubscribed: [] },
        leakedRow: false,
        captionJobs: residualCaptionJobs,
      },
      `${label}: late Calendar completion must not revive data/cache/DOM/realtime on Brief`,
    );
    const briefFrame = briefTransitionTrace.findIndex(frame => frame.surface === 'mounted:client-brief');
    assert.ok(briefFrame >= 0, `${label}: the animation-frame trace must observe Brief ownership`);
    assert.ok(
      briefTransitionTrace.slice(briefFrame).every(frame => (
        frame.surface === 'mounted:client-brief'
        && frame.activeClientTab === 'Brief'
        && frame.calendarVisible === false
        && frame.analyticsFlash === false
      )),
      `${label}: every frame after Brief ownership must stay Brief-owned\n${JSON.stringify(traceExcerpt(briefTransitionTrace), null, 2)}`,
    );
    assertTruthfulTrace(briefTransitionTrace, `${label} Calendar → Brief`, { clientOwned: true });

    // Settle one current Calendar read but pause the lazy realtime client while
    // _calV2EnsureSubscribed awaits it. Calendar → Analytics must invalidate
    // that epoch/surface lease so releasing the factory cannot reopen a channel.
    await clientRun.page.locator('.view-tab-btn', { hasText: 'Content Calendar' }).click();
    await clientRun.page.waitForFunction(() => (
      window.__syncviewBfcacheNetwork.heldCalendarRequests === 2
      && Boolean(document.getElementById('calView'))
    ), null, { timeout: 10_000 });
    await clientRun.page.evaluate(() => {
      const originalClientFactory = _calV2Client;
      let releaseClient;
      const heldClient = new Promise(resolve => { releaseClient = resolve; });
      window.__syncviewCalendarRtAwaiting = false;
      window.__syncviewReleaseCalendarRtClient = async () => {
        releaseClient(await originalClientFactory());
      };
      _calV2Client = () => {
        window.__syncviewCalendarRtAwaiting = true;
        return heldClient;
      };
    });
    await clientRun.page.evaluate(() => window.__syncviewReleaseBfcacheCalendar());
    await clientRun.page.waitForFunction(expectedRow => (
      window.__syncviewBfcacheNetwork.calendarResponsesCompleted === 2
      && window.__syncviewCalendarRtAwaiting === true
      && calState.posts.some(post => post.name === expectedRow)
    ), CALENDAR_ROWS[0].name, { timeout: 10_000 });
    await clientRun.page.evaluate(() => { window.__syncviewBootTrace = []; });
    await clientRun.page.locator('.view-tab-btn', { hasText: 'Analytics' }).click();
    await waitForClientTab(clientRun.page, 'Analytics');
    await clientRun.page.evaluate(() => window.__syncviewReleaseCalendarRtClient());
    await clientRun.page.waitForTimeout(200);
    const analyticsAfterFactoryRelease = await clientRun.page.evaluate(expectedRow => ({
      activeTab: Array.from(document.querySelectorAll('.view-tab-btn.active'))
        .find(element => getComputedStyle(element).display !== 'none')?.textContent.trim() || '',
      calendarVisible: Boolean(document.getElementById('calView')),
      calendarLease: _calV2Lease,
      calendarRealtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
      capability: Boolean(_syncviewClientEntryCapability && _syncviewClientEntryCapability.verified),
      leakedRow: document.getElementById('content')?.innerText.includes(expectedRow) || false,
      transitionTrace: window.__syncviewBootTrace.slice(),
    }), CALENDAR_ROWS[0].name);
    assert.equal(analyticsAfterFactoryRelease.activeTab, 'Analytics',
      `${label}: Analytics must own the no-new-load profile exit`);
    assert.equal(analyticsAfterFactoryRelease.calendarVisible, false,
      `${label}: Analytics must retire the Calendar DOM`);
    assert.equal(analyticsAfterFactoryRelease.calendarLease, null,
      `${label}: Analytics teardown must clear the realtime lease`);
    assert.deepEqual(calendarRealtime(analyticsAfterFactoryRelease.calendarRealtime).created, [],
      `${label}: releasing a stale realtime factory cannot create a Calendar channel`);
    assert.equal(analyticsAfterFactoryRelease.capability, true,
      `${label}: same-client Analytics retains the verified document capability`);
    assert.equal(analyticsAfterFactoryRelease.leakedRow, false,
      `${label}: Calendar rows cannot paint over Analytics`);
    const analyticsFrame = analyticsAfterFactoryRelease.transitionTrace
      .findIndex(frame => frame.surface === 'mounted:client-analytics');
    assert.ok(analyticsFrame >= 0, `${label}: the animation-frame trace must observe Analytics ownership`);
    assert.ok(
      analyticsAfterFactoryRelease.transitionTrace.slice(analyticsFrame).every(frame => (
        frame.surface === 'mounted:client-analytics'
        && frame.activeClientTab === 'Analytics'
        && frame.calendarVisible === false
        && frame.headerVisible === false
        && frame.pageTopVisible === false
      )),
      `${label}: every frame after Analytics ownership must stay Analytics-owned\n${JSON.stringify(traceExcerpt(analyticsAfterFactoryRelease.transitionTrace), null, 2)}`,
    );

    // Re-enter Calendar and hold its third read for the actual persisted
    // BFCache revocation and rotated-token denial.
    await clientRun.page.locator('.view-tab-btn', { hasText: 'Content Calendar' }).click();
    await clientRun.page.waitForFunction(() => (
      window.__syncviewBfcacheNetwork.heldCalendarRequests === 3
      && Boolean(document.getElementById('calView'))
    ), null, { timeout: 10_000 });
    await clientRun.page.evaluate(() => {
      window.__syncviewPageShows = [];
      window.addEventListener('pagehide', () => {
        window.__syncviewBootTrace = [];
      }, { capture: true, once: true });
    });
    const awayOrigin = server.origin.replace('127.0.0.1', 'localhost');
    await clientRun.page.goto(`${awayOrigin}/boot-away`, { waitUntil: 'load', timeout: 15_000 });
    await clientRun.page.waitForSelector('[data-boot-away]', { state: 'visible', timeout: 10_000 });
    const requestedDocument = await restoreFromBfcache(clientRun.page, server, '/bfcache.html');
    await clientRun.page.waitForSelector('[data-client-entry-state="invalid"]', { state: 'visible', timeout: 10_000 });
    await clientRun.page.waitForFunction(() => (
      window.__syncviewBfcacheNetwork.calendarAbortEvents === 2
    ), null, { timeout: 10_000 });
    const deniedBeforeRelease = await clientRun.page.evaluate(() => ({
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
      cache: localStorage.getItem('syncview_calCache_v2:bootfixtureclient'),
      captionJobs: localStorage.getItem('syncview_captionJobs_v1'),
      state: document.querySelector('[data-client-entry-state]')?.getAttribute('data-client-entry-state') || '',
      capability: Boolean(_syncviewClientEntryCapability && _syncviewClientEntryCapability.verified),
      calendarVisible: Boolean(document.getElementById('calView')),
      calendarClient: calState.client,
      posts: Array.isArray(calState.posts) ? calState.posts.length : -1,
      realtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
    }));
    assert.equal(requestedDocument, false, `${label}: denial must restore the cached document, not reload`);
    assert.ok(deniedBeforeRelease.network.verifierResponses[1]?.valid === false,
      `${label}: persisted return must receive the rotated-token denial`);
    const deniedCalendarReads = deniedBeforeRelease.network.sensitiveClientReads
      .filter(read => read.kind === 'calendar_posts');
    assert.equal(deniedCalendarReads.length, 3, `${label}: exactly three Calendar reads precede denial`);
    assert.equal(deniedCalendarReads[2].signalAbortedBeforeRelease, true,
      `${label}: pagehide must abort the third held Calendar read before release`);
    assert.equal(deniedBeforeRelease.state, 'invalid', `${label}: terminal denial must be visible before release`);
    assert.equal(deniedBeforeRelease.capability, false, `${label}: client capability must be revoked`);
    assert.equal(deniedBeforeRelease.calendarVisible, false, `${label}: Calendar DOM must be purged`);
    assert.equal(deniedBeforeRelease.calendarClient, null, `${label}: Calendar identity must be cleared`);
    assert.equal(deniedBeforeRelease.posts, 0, `${label}: Calendar rows must be cleared`);
    assert.equal(deniedBeforeRelease.cache, null, `${label}: exact-client Calendar cache must be absent`);
    assert.deepEqual(calendarRealtime(deniedBeforeRelease.realtime).created, [],
      `${label}: no stale Calendar realtime channel may open`);
    assert.equal(deniedBeforeRelease.captionJobs, residualCaptionJobs, `${label}: staff caption jobs remain untouched`);

    await clientRun.page.evaluate(() => window.__syncviewReleaseBfcacheCalendar());
    await clientRun.page.waitForFunction(() => (
      window.__syncviewBfcacheNetwork.calendarResponsesCompleted === 3
    ), null, { timeout: 10_000 });
    await clientRun.page.waitForTimeout(250);
    const deniedAfterRelease = await clientRun.page.evaluate(expectedRow => ({
      pageShows: window.__syncviewPageShows.slice(),
      trace: window.__syncviewBootTrace.slice(),
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
      cache: localStorage.getItem('syncview_calCache_v2:bootfixtureclient'),
      captionJobs: localStorage.getItem('syncview_captionJobs_v1'),
      state: document.querySelector('[data-client-entry-state]')?.getAttribute('data-client-entry-state') || '',
      capability: Boolean(_syncviewClientEntryCapability && _syncviewClientEntryCapability.verified),
      calendarVisible: Boolean(document.getElementById('calView')),
      calendarClient: calState.client,
      posts: Array.isArray(calState.posts) ? calState.posts.length : -1,
      realtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
      leakedRow: document.getElementById('content')?.innerText.includes(expectedRow) || false,
      body: document.getElementById('content')?.innerText || '',
    }), CALENDAR_ROWS[0].name);
    const clientEvidence = {
      requestedDocument,
      pageShows: deniedAfterRelease.pageShows,
      network: deniedAfterRelease.network,
      cache: deniedAfterRelease.cache,
      state: deniedAfterRelease.state,
      capability: deniedAfterRelease.capability,
      calendarClient: deniedAfterRelease.calendarClient,
      posts: deniedAfterRelease.posts,
      realtime: deniedAfterRelease.realtime,
      trace: traceExcerpt(deniedAfterRelease.trace),
    };
    assert.ok(
      deniedAfterRelease.pageShows.some(event => event.persisted === true),
      `${label}: pageshow.persisted must prove actual BFCache restoration\n${JSON.stringify(clientEvidence, null, 2)}`,
    );
    assert.equal(deniedAfterRelease.network.verifierCalls.length, 2, `${label}: exactly one return revalidation`);
    const finalCalendarReads = deniedAfterRelease.network.sensitiveClientReads
      .filter(read => read.kind === 'calendar_posts');
    assert.equal(finalCalendarReads.length, 3, `${label}: denial starts no new Calendar read`);
    assert.ok(
      [finalCalendarReads[0], finalCalendarReads[2]]
        .every(read => read.signalAbortedBeforeRelease === true),
      `${label}: non-nav and pagehide retirements abort their exact held transports`,
    );
    assert.equal(deniedAfterRelease.cache, null, `${label}: late response must not recreate Calendar cache`);
    assert.equal(deniedAfterRelease.captionJobs, residualCaptionJobs, `${label}: late response must not revive staff caption work`);
    assert.equal(deniedAfterRelease.state, 'invalid', `${label}: denial survives the late response`);
    assert.equal(deniedAfterRelease.capability, false, `${label}: capability remains revoked`);
    assert.equal(deniedAfterRelease.calendarVisible, false, `${label}: Calendar DOM remains purged`);
    assert.equal(deniedAfterRelease.calendarClient, null, `${label}: Calendar identity remains cleared`);
    assert.equal(deniedAfterRelease.posts, 0, `${label}: late Calendar rows never apply`);
    assert.deepEqual(calendarRealtime(deniedAfterRelease.realtime).created, [],
      `${label}: late tail cannot revive Calendar realtime`);
    assert.equal(deniedAfterRelease.leakedRow, false, `${label}: revoked row must never paint`);
    assert.match(deniedAfterRelease.body, /link isn't valid/i, `${label}: terminal denial copy remains visible`);
    assert.deepEqual(
      deniedAfterRelease.trace.filter(frame => frame.calendarVisible || frame.surface === 'mounted:calendar'),
      [],
      `${label}: Calendar must never repaint after persisted revocation\n${JSON.stringify(clientEvidence, null, 2)}`,
    );
    assertTruthfulTrace(deniedAfterRelease.trace, label, { clientOwned: true });
    assert.deepEqual(deniedAfterRelease.network.captionBoundaryRequests, [],
      `${label}: client Calendar must not start staff caption work`);
    assert.deepEqual(deniedAfterRelease.network.unmocked, [], `${label}: every external request is synthetic`);
    assert.deepEqual(clientRun.consoleErrors, [], `${label}: client browser console errors are not allowed`);
    assert.deepEqual(clientRun.pageErrors, [], `${label}: client uncaught page errors are not allowed`);
  } finally {
    await clientRun.context.close();
  }

  const staffRows = {
    [CLIENT_A_SLUG]: [{
      ...CALENDAR_ROWS[0],
      id: 'synthetic-calendar-owner-a',
      name: 'Synthetic superseded Calendar A row',
    }],
    residualfixtureclient: [{
      ...CALENDAR_ROWS[0],
      id: 'synthetic-calendar-owner-b',
      client: 'residualfixtureclient',
      name: 'Synthetic current Calendar B row',
    }],
  };
  const staffRun = await openCase(browser, server, {
    storage: {
      local: {
        syncview_auth_v1: 'ok',
        syncview_nav: 'calendar',
        syncview_calendar_pins: JSON.stringify([CLIENT_A, CLIENT_B]),
        syncview_calendar_prefs: JSON.stringify({ client: CLIENT_A, view: 'organizer', zoom: 'default' }),
      },
    },
    heldCalendarTransport: { rowsBySlug: staffRows },
  });
  try {
    await streamedNavigation(
      staffRun.page,
      server,
      () => staffRun.page.goto(`${server.origin}/index.html#calendar`, { waitUntil: 'load', timeout: 15_000 }),
      'static:calendar',
    );
    await staffRun.page.waitForFunction(() => (
      window.__syncviewHeldCalendarTransport?.reads.length === 1
      && Boolean(document.getElementById('calView'))
    ), null, { timeout: 10_000 });
    await staffRun.page.evaluate(() => { window.__syncviewBootTrace = []; });
    await staffRun.page.locator('#calTabs .cal-tab', { hasText: CLIENT_B }).click();
    await staffRun.page.waitForFunction(() => (
      window.__syncviewHeldCalendarTransport?.reads.length === 2
      && calState.client === 'Residual Fixture Client'
    ), null, { timeout: 10_000 });
    const superseded = await staffRun.page.evaluate(() => ({
      transport: JSON.parse(JSON.stringify(window.__syncviewHeldCalendarTransport)),
      client: calState.client,
      loading: calState.loading,
      owner: _calActiveLoad ? {
        slug: _calActiveLoad.slug,
        seq: _calActiveLoad.seq,
        aborted: Boolean(_calActiveLoad.controller && _calActiveLoad.controller.signal.aborted),
      } : null,
      loaderVisible: Boolean(document.querySelector('#calBody .cal-loader')),
    }));
    assert.equal(superseded.transport.reads[0].slug, CLIENT_A_SLUG, `${label}: first staff load owns client A`);
    assert.equal(superseded.transport.reads[0].signalAbortedBeforeRelease, true, `${label}: A transport is aborted on A → B`);
    assert.equal(superseded.transport.reads[1].slug, 'residualfixtureclient', `${label}: replacement load owns client B`);
    assert.equal(superseded.transport.reads[1].signalAbortedBeforeRelease, false, `${label}: B transport remains live`);
    assert.equal(superseded.client, CLIENT_B, `${label}: B owns Calendar state`);
    assert.equal(superseded.loading, true, `${label}: B loader remains active`);
    assert.equal(superseded.loaderVisible, true, `${label}: B loader must be visibly painted`);
    assert.equal(superseded.owner?.slug, 'residualfixtureclient', `${label}: active owner record belongs to B`);
    assert.equal(superseded.owner?.aborted, false, `${label}: B controller must not be aborted`);

    await staffRun.page.evaluate(() => window.__syncviewReleaseHeldCalendar(0));
    await staffRun.page.waitForFunction(() => (
      window.__syncviewHeldCalendarTransport.completed === 1
    ), null, { timeout: 10_000 });
    await staffRun.page.waitForTimeout(200);
    const afterOldFinally = await staffRun.page.evaluate(() => ({
      transport: JSON.parse(JSON.stringify(window.__syncviewHeldCalendarTransport)),
      client: calState.client,
      loading: calState.loading,
      posts: calState.posts.map(post => post.name),
      owner: _calActiveLoad ? {
        slug: _calActiveLoad.slug,
        aborted: Boolean(_calActiveLoad.controller && _calActiveLoad.controller.signal.aborted),
      } : null,
      cacheA: localStorage.getItem('syncview_calCache_v2:bootfixtureclient'),
      cacheB: localStorage.getItem('syncview_calCache_v2:residualfixtureclient'),
      realtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
      loaderVisible: Boolean(document.querySelector('#calBody .cal-loader')),
      trace: window.__syncviewBootTrace.slice(),
    }));
    assert.equal(afterOldFinally.client, CLIENT_B, `${label}: old A completion cannot rebind the client`);
    assert.equal(afterOldFinally.loading, true, `${label}: old A finally cannot clear B's loader`);
    assert.equal(afterOldFinally.loaderVisible, true, `${label}: old A finally cannot clear the visible B loader`);
    assert.deepEqual(afterOldFinally.posts, [], `${label}: old A rows cannot apply into B`);
    assert.equal(afterOldFinally.owner?.slug, 'residualfixtureclient', `${label}: old A finally cannot clear B's controller`);
    assert.equal(afterOldFinally.owner?.aborted, false, `${label}: B controller remains live after A finally`);
    assert.equal(afterOldFinally.transport.reads[1].signalAbortedBeforeRelease, false, `${label}: B transport remains pending`);
    assert.equal(afterOldFinally.cacheA, null, `${label}: A late response cannot write cache`);
    assert.equal(afterOldFinally.cacheB, null, `${label}: B cache waits for B response`);
    assert.deepEqual(calendarRealtime(afterOldFinally.realtime).created, [],
      `${label}: A late tail cannot open Calendar realtime`);
    const bLoaderFrame = afterOldFinally.trace.findIndex(frame => (
      frame.calendarActiveClient === CLIENT_B && frame.calendarLoadingVisible === true
    ));
    assert.ok(bLoaderFrame >= 0, `${label}: rAF trace must observe B owning the visible loader`);
    assert.ok(
      afterOldFinally.trace.slice(bLoaderFrame).every(frame => (
        frame.calendarActiveClient === CLIENT_B
        && frame.calendarVisible === true
        && frame.calendarLoadingVisible === true
      )),
      `${label}: A late completion must leave every subsequent frame on B's loader\n${JSON.stringify(traceExcerpt(afterOldFinally.trace), null, 2)}`,
    );

    await staffRun.page.evaluate(() => window.__syncviewReleaseHeldCalendar(1));
    await staffRun.page.waitForFunction(expectedRow => (
      window.__syncviewHeldCalendarTransport.completed === 2
      && calState.loading === false
      && calState.posts.some(post => post.name === expectedRow)
      && window.calV2Status().subscribed === true
    ), staffRows.residualfixtureclient[0].name, { timeout: 10_000 });
    const settledB = await staffRun.page.evaluate(() => ({
      transport: JSON.parse(JSON.stringify(window.__syncviewHeldCalendarTransport)),
      client: calState.client,
      loading: calState.loading,
      posts: calState.posts.map(post => ({ client: post.client, name: post.name })),
      owner: _calActiveLoad,
      cacheA: localStorage.getItem('syncview_calCache_v2:bootfixtureclient'),
      cacheB: localStorage.getItem('syncview_calCache_v2:residualfixtureclient'),
      realtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
      body: document.getElementById('calBody')?.innerText || '',
      fieldValues: Array.from(document.querySelectorAll('#calBody input, #calBody textarea'))
        .map(element => element.value),
      trace: window.__syncviewBootTrace.slice(),
    }));
    assert.equal(settledB.client, CLIENT_B, `${label}: B remains the settled identity`);
    assert.equal(settledB.loading, false, `${label}: B settles normally`);
    assert.deepEqual(settledB.posts, [{
      client: 'residualfixtureclient',
      name: staffRows.residualfixtureclient[0].name,
    }], `${label}: only B rows apply`);
    assert.equal(settledB.owner, null, `${label}: settled B transport clears its exact owner record`);
    assert.equal(settledB.cacheA, null, `${label}: superseded A never caches`);
    assert.match(settledB.cacheB || '', /Synthetic current Calendar B row/, `${label}: current B writes its own cache`);
    assert.deepEqual(calendarRealtime(settledB.realtime).created, ['cal-residualfixtureclient'],
      `${label}: only the current B lease may create realtime`);
    assert.equal(
      settledB.body.includes('Synthetic superseded Calendar A row')
        || settledB.fieldValues.includes('Synthetic superseded Calendar A row'),
      false,
      `${label}: superseded A row never paints`);
    assert.equal(
      settledB.body.includes('Synthetic current Calendar B row')
        || settledB.fieldValues.includes('Synthetic current Calendar B row'),
      true,
      `${label}: current B row paints after its own response`);
    assertTruthfulTrace(settledB.trace, `${label} staff A → B`, {});
    assertHealthyHarness(staffRun, label);
  } finally {
    await staffRun.context.close();
  }
  passGroup(label);
}

async function runPendingSamplesBfcacheScenario(browser, server) {
  const label = 'F117 pending Samples read BFCache Back denial';
  const traceOptions = { clientOwned: true, samplesOwned: true, expectedClient: CLIENT_A };
  const run = await openBfcacheCase(browser, {
    view: 'sample-reviews',
    holdSamples: true,
  });
  try {
    const query = new URLSearchParams({
      c: CLIENT_A,
      v: 'sample-reviews',
      sxr: '1',
      t: CURRENT_TOKEN,
    });
    await streamedNavigation(
      run.page,
      server,
      () => run.page.goto(`${server.origin}/bfcache.html?${query}`, { waitUntil: 'load', timeout: 15_000 }),
      'static:client-verify',
    );
    await run.page.waitForFunction(expectedClient => {
      const network = window.__syncviewBfcacheNetwork;
      const embedded = document.querySelector('#sxrView .cal-embed-title strong');
      return network
        && network.verifierResponses.length === 1
        && network.verifierResponses[0].valid === true
        && network.heldSampleRequests === 1
        && embedded
        && embedded.textContent.trim() === expectedClient;
    }, CLIENT_A, { timeout: 10_000 });
    const initialTrace = await traceOf(run.page);
    assertTruthfulTrace(initialTrace, `${label} first pending mount`, traceOptions);
    const initial = await run.page.evaluate(expectedClient => ({
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
      embeddedClient: document.querySelector('#sxrView .cal-embed-title strong')?.textContent.trim() || '',
      generic: Boolean(document.getElementById('sxrTabs')),
      addClientVisible: Array.from(document.querySelectorAll('#sxrView .cal-tab-add')).some(element => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }),
      residualVisible: document.getElementById('content')?.innerText.includes(expectedClient) || false,
    }), CLIENT_B);
    assert.equal(initial.network.verifierCalls.length, 1, `${label}: first document verifies once`);
    assert.equal(initial.network.sensitiveClientReads.length, 1, `${label}: exactly one exact-client Samples read is pending`);
    assert.equal(initial.network.sampleResponsesCompleted, 0, `${label}: held Samples response must not settle before pagehide`);
    assert.equal(
      new URL(initial.network.sensitiveClientReads[0].url).searchParams.get('client'),
      `eq.${CLIENT_A_SLUG}`,
      `${label}: pending read must bind the verified slug`,
    );
    assert.deepEqual(
      {
        embeddedClient: initial.embeddedClient,
        generic: initial.generic,
        addClientVisible: initial.addClientVisible,
        residualVisible: initial.residualVisible,
      },
      { embeddedClient: CLIENT_A, generic: false, addClientVisible: false, residualVisible: false },
      `${label}: pending mount must already be embedded and exact-client`,
    );

    await run.page.evaluate(() => {
      window.__syncviewPageShows = [];
      window.addEventListener('pagehide', () => {
        window.__syncviewBootTrace = [];
      }, { capture: true, once: true });
    });
    const awayOrigin = server.origin.replace('127.0.0.1', 'localhost');
    await run.page.goto(`${awayOrigin}/boot-away`, { waitUntil: 'load', timeout: 15_000 });
    await run.page.waitForSelector('[data-boot-away]', { state: 'visible', timeout: 10_000 });

    const requestedDocument = await restoreFromBfcache(run.page, server, '/bfcache.html');
    await run.page.waitForFunction(() => Array.isArray(window.__syncviewPageShows)
      && window.__syncviewPageShows.length > 0, null, { timeout: 10_000 });
    await run.page.waitForSelector('[data-client-entry-state="invalid"]', { state: 'visible', timeout: 10_000 });
    const beforeRelease = await run.page.evaluate(() => ({
      cache: localStorage.getItem('syncview_sxr_cache_v2_bootfixtureclient'),
      state: document.querySelector('[data-client-entry-state]')?.getAttribute('data-client-entry-state') || '',
      capability: typeof _syncviewClientEntryCapability !== 'undefined'
        && Boolean(_syncviewClientEntryCapability && _syncviewClientEntryCapability.verified),
      sxrClient: typeof sxrState === 'object' ? sxrState.client : 'missing',
      sxrPosts: typeof sxrState === 'object' && Array.isArray(sxrState.posts) ? sxrState.posts.length : -1,
    }));
    assert.equal(requestedDocument, false, `${label}: must restore from BFCache, not load a document`);
    assert.equal(beforeRelease.state, 'invalid', `${label}: denial must be visible before old Samples response settles`);
    assert.equal(beforeRelease.capability, false, `${label}: restored capability must be revoked`);
    assert.equal(beforeRelease.cache, null, `${label}: denial must clear exact-client Samples cache`);
    assert.equal(beforeRelease.sxrClient, null, `${label}: denied return must clear Samples client state`);
    assert.equal(beforeRelease.sxrPosts, 0, `${label}: denied return must clear Samples rows`);

    await run.page.evaluate(() => window.__syncviewReleaseBfcacheSamples());
    await run.page.waitForFunction(() => window.__syncviewBfcacheNetwork.sampleResponsesCompleted === 1, null, { timeout: 10_000 });
    await run.page.waitForTimeout(250);

    const restored = await run.page.evaluate(expectedClient => ({
      pageShows: window.__syncviewPageShows.slice(),
      trace: window.__syncviewBootTrace.slice(),
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
      cache: localStorage.getItem('syncview_sxr_cache_v2_bootfixtureclient'),
      state: document.querySelector('[data-client-entry-state]')?.getAttribute('data-client-entry-state') || '',
      review: Boolean(document.getElementById('sxrView')),
      generic: Boolean(document.getElementById('sxrTabs')),
      addClientVisible: Array.from(document.querySelectorAll('#sxrView .cal-tab-add')).some(element => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }),
      embeddedClient: document.querySelector('#sxrView .cal-embed-title strong')?.textContent.trim() || '',
      residualVisible: document.getElementById('content')?.innerText.includes(expectedClient) || false,
      capability: typeof _syncviewClientEntryCapability !== 'undefined'
        && Boolean(_syncviewClientEntryCapability && _syncviewClientEntryCapability.verified),
      sxrClient: typeof sxrState === 'object' ? sxrState.client : 'missing',
      sxrPosts: typeof sxrState === 'object' && Array.isArray(sxrState.posts) ? sxrState.posts.length : -1,
      body: document.getElementById('content')?.innerText || '',
    }), CLIENT_B);
    const evidence = {
      requestedDocument,
      pageShows: restored.pageShows,
      verifierCalls: restored.network.verifierCalls,
      verifierResponses: restored.network.verifierResponses,
      sensitiveClientReads: restored.network.sensitiveClientReads,
      heldSampleRequests: restored.network.heldSampleRequests,
      sampleResponsesCompleted: restored.network.sampleResponsesCompleted,
      cache: restored.cache,
      state: restored.state,
      review: restored.review,
      generic: restored.generic,
      addClientVisible: restored.addClientVisible,
      embeddedClient: restored.embeddedClient,
      residualVisible: restored.residualVisible,
      capability: restored.capability,
      sxrClient: restored.sxrClient,
      sxrPosts: restored.sxrPosts,
      trace: traceExcerpt(restored.trace),
    };
    assert.ok(
      restored.pageShows.some(event => event.persisted === true),
      `${label}: pageshow.persisted must prove actual BFCache restoration\n${JSON.stringify(evidence, null, 2)}`,
    );
    assert.equal(restored.network.verifierCalls.length, 2, `${label}: one initial and one return verifier, with no retry`);
    assert.equal(restored.network.verifierCalls[1].body.strict, true, `${label}: return verifier remains strict`);
    assert.equal(restored.network.verifierResponses[1]?.valid, false, `${label}: rotated token must be denied`);
    assert.equal(restored.network.sensitiveClientReads.length, 1, `${label}: denied return must start no new Samples read`);
    assert.equal(
      restored.network.sensitiveClientReads[0].signalAbortedAfterHold,
      true,
      `${label}: pagehide must abort the tracked old Samples request\n${JSON.stringify(evidence, null, 2)}`,
    );
    assert.deepEqual(restored.network.unmocked, [], `${label}: every external request must be synthetic`);
    assert.equal(restored.cache, null, `${label}: late Samples response must not recreate cache`);
    assert.equal(restored.sxrClient, null, `${label}: late Samples response must not restore client state`);
    assert.equal(restored.sxrPosts, 0, `${label}: late Samples response must not apply rows`);
    assert.equal(restored.state, 'invalid', `${label}: denial must survive the late Samples response`);
    assert.equal(restored.review, false, `${label}: Samples surface must remain purged`);
    assert.equal(restored.generic, false, `${label}: generic SXR must never mount`);
    assert.equal(restored.addClientVisible, false, `${label}: Add-client switcher must never appear`);
    assert.equal(restored.embeddedClient, '', `${label}: no stale embedded client may remain`);
    assert.equal(restored.residualVisible, false, `${label}: residual client must never become visible`);
    assert.equal(restored.capability, false, `${label}: stale capability must remain revoked`);
    assert.match(restored.body, /link isn't valid/i, `${label}: terminal denial copy remains visible`);
    assertTruthfulTrace(restored.trace, label, traceOptions);
    assert.deepEqual(run.consoleErrors, [], `${label}: browser console errors are not allowed`);
    assert.deepEqual(run.pageErrors, [], `${label}: uncaught page errors are not allowed`);
    passGroup(label);
  } finally {
    await run.context.close();
  }
}

async function runLegacySamplesScenario(browser, server) {
  const label = 'F117 legacy Samples exact-client boot/reload/Back-Forward';
  const traceOptions = { clientOwned: true, samplesOwned: true, expectedClient: CLIENT_A };
  const run = await openCase(browser, server, {
    storage: {
      local: {
        syncview_sxr_prefs_v1: JSON.stringify({ client: CLIENT_B, view: 'organizer', zoom: 'l' }),
        syncview_calendar_pins: JSON.stringify([CLIENT_B]),
        syncview_sxr_off: '1',
      },
    },
  });
  try {
    // Give the client entry a real prior history entry so Back can leave it and
    // Forward must execute the complete verified Samples boot again.
    await run.page.goto(`${server.origin}/boot-away`, { waitUntil: 'load', timeout: 15_000 });
    await run.page.waitForSelector('[data-boot-away]', { state: 'visible', timeout: 10_000 });

    const legacy = new URLSearchParams({ c: CLIENT_A, v: 'samples', t: CURRENT_TOKEN });
    await streamedNavigation(
      run.page,
      server,
      () => run.page.goto(`${server.origin}/index.html?${legacy}`, { waitUntil: 'load', timeout: 15_000 }),
      'static:client-verify',
    );
    await waitForReviewSettled(run.page);
    const firstTrace = await traceOf(run.page);
    assert.ok(firstTrace.some(frame => frame.surface === 'static:client-verify'), `${label}: first boot must paint neutral verifier`);
    assertTruthfulTrace(firstTrace, `${label} first boot`, traceOptions);

    const first = await run.page.evaluate(expectedClient => {
      const query = new URLSearchParams(location.search);
      return {
        c: query.get('c'),
        t: query.get('t'),
        v: query.get('v'),
        sxr: query.get('sxr'),
        hash: location.hash,
        embeddedClient: document.querySelector('.cal-embed-title strong')?.textContent.trim() || '',
        addClientVisible: Array.from(document.querySelectorAll('.cal-tab-add')).some(element => {
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }),
        oldSamples: Boolean(document.getElementById('smView')),
        residualVisible: document.body.innerText.includes(expectedClient),
        bootNav: document.documentElement.getAttribute('data-boot-nav'),
        bootSubtab: document.documentElement.getAttribute('data-boot-subtab'),
        sxrOff: localStorage.getItem('syncview_sxr_off'),
        sxrOn: localStorage.getItem('syncview_sxr_on'),
      };
    }, CLIENT_B);
    assert.deepEqual(
      { c: first.c, t: first.t, v: first.v, sxr: first.sxr, hash: first.hash },
      { c: CLIENT_A, t: CURRENT_TOKEN, v: 'sample-reviews', sxr: '1', hash: '' },
      `${label}: legacy URL must canonicalize in place without losing credentials`,
    );
    assert.equal(first.embeddedClient, CLIENT_A, `${label}: exact verified client owns the embedded review`);
    assert.equal(first.addClientVisible, false, `${label}: generic SXR client switcher must not mount`);
    assert.equal(first.oldSamples, false, `${label}: retired Samples surface must not mount`);
    assert.equal(first.residualVisible, false, `${label}: residual client preference must never become visible`);
    assert.equal(first.bootNav, null, `${label}: settled page must lift data-boot-nav`);
    assert.equal(first.bootSubtab, null, `${label}: settled page must lift data-boot-subtab`);
    assert.equal(first.sxrOff, '1', `${label}: client entry must not clear the staff Samples opt-out`);
    assert.equal(first.sxrOn, null, `${label}: client entry must not set the sticky Samples opt-in`);

    await streamedNavigation(
      run.page,
      server,
      () => run.page.reload({ waitUntil: 'load', timeout: 15_000 }),
      'static:client-verify',
    );
    await waitForReviewSettled(run.page);
    const reloadTrace = await traceOf(run.page);
    assert.ok(reloadTrace.some(frame => frame.surface === 'static:client-verify'), `${label}: reload must paint neutral verifier`);
    assertTruthfulTrace(reloadTrace, `${label} reload`, traceOptions);

    const reload = await run.page.evaluate(expectedClient => ({
      embeddedClient: document.querySelector('.cal-embed-title strong')?.textContent.trim() || '',
      residualVisible: document.body.innerText.includes(expectedClient),
      oldSamples: Boolean(document.getElementById('smView')),
      addClient: Boolean(document.querySelector('.cal-tab-add')),
      v: new URLSearchParams(location.search).get('v'),
      sxr: new URLSearchParams(location.search).get('sxr'),
      hash: location.hash,
      bootNav: document.documentElement.getAttribute('data-boot-nav'),
      bootSubtab: document.documentElement.getAttribute('data-boot-subtab'),
      sxrOff: localStorage.getItem('syncview_sxr_off'),
      sxrOn: localStorage.getItem('syncview_sxr_on'),
    }), CLIENT_B);
    assert.deepEqual(
      reload,
      {
        embeddedClient: CLIENT_A,
        residualVisible: false,
        oldSamples: false,
        addClient: false,
        v: 'sample-reviews',
        sxr: '1',
        hash: '',
        bootNav: null,
        bootSubtab: null,
        sxrOff: '1',
        sxrOn: null,
      },
      `${label}: canonical reload must remain exact-client and settled`,
    );

    await run.page.evaluate(() => {
      window.__syncviewPageShows = [];
      window.addEventListener('pagehide', () => {
        window.__syncviewBootTrace = [];
      }, { capture: true, once: true });
      history.back();
    });
    await run.page.waitForFunction(() => location.pathname === '/boot-away', null, { timeout: 15_000 });
    const possibleForwardRequest = server.nextChunk(1_500).then(chunk => {
      chunk.release();
      return true;
    }, () => false);
    await run.page.evaluate(() => history.forward());
    await run.page.waitForFunction(() => location.pathname === '/index.html', null, { timeout: 15_000 });
    const forwardRequestedDocument = await possibleForwardRequest;
    await waitForReviewSettled(run.page);
    const forwardTrace = await traceOf(run.page);
    assert.ok(
      forwardTrace.some(frame => frame.surface === 'static:client-verify' || frame.surface === 'loading:verify'),
      `${label}: Forward must paint neutral verifier`,
    );
    assertTruthfulTrace(forwardTrace, `${label} Forward`, traceOptions);
    const forward = await run.page.evaluate(expectedClient => ({
      embeddedClient: document.querySelector('#sxrView .cal-embed-title strong')?.textContent.trim() || '',
      generic: Boolean(document.getElementById('sxrTabs')),
      addClientVisible: Array.from(document.querySelectorAll('#sxrView .cal-tab-add')).some(element => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }),
      residualVisible: document.getElementById('content')?.innerText.includes(expectedClient) || false,
      v: new URLSearchParams(location.search).get('v'),
      sxr: new URLSearchParams(location.search).get('sxr'),
      hash: location.hash,
      persisted: window.__syncviewPageShows.some(event => event.persisted === true),
    }), CLIENT_B);
    assert.deepEqual(
      forward,
      {
        embeddedClient: CLIENT_A,
        generic: false,
        addClientVisible: false,
        residualVisible: false,
        v: 'sample-reviews',
        sxr: '1',
        hash: '',
        persisted: !forwardRequestedDocument,
      },
      `${label}: Forward must remain canonical, embedded, and exact-client`,
    );

    assert.equal(run.network.verifierCalls.length, 3, `${label}: one verifier call per actual document boot`);
    assert.equal(run.network.verifierCalls[0].body.view, 'samples', `${label}: first verifier sees legacy view`);
    assert.equal(run.network.verifierCalls[1].body.view, 'sample-reviews', `${label}: reload verifier sees canonical view`);
    assert.equal(run.network.verifierCalls[2].body.view, 'sample-reviews', `${label}: Forward verifier sees canonical view`);
    for (const call of run.network.verifierCalls) {
      assert.equal(call.body.client, CLIENT_A, `${label}: verifier client binding`);
      assert.equal(call.body.slug, CLIENT_A_SLUG, `${label}: verifier slug binding`);
      assert.equal(call.body.strict, true, `${label}: strict verifier mode`);
    }
    assert.ok(run.network.sampleReads.length >= 3, `${label}: each boot must read the review route`);
    for (let index = 0; index < run.network.sampleReads.length; index += 1) {
      const read = run.network.sampleReads[index];
      const url = new URL(read.url);
      const verifier = run.network.verifierResponses[Math.min(index, run.network.verifierResponses.length - 1)];
      assert.ok(verifier && verifier.valid && read.at >= verifier.at, `${label}: each review read starts after its strict verdict`);
      assert.equal(
        url.searchParams.get('client'),
        `eq.${CLIENT_A_SLUG}`,
        `${label}: every Samples read must be scoped to the verified client`,
      );
      assert.equal(read.url.includes('residualfixtureclient'), false, `${label}: residual client must not reach the transport`);
    }
    assertHealthyHarness(run, label);
    passGroup(label);
  } finally {
    await run.context.close();
  }
}

async function runStaffCalendarOwnedTailAndBfcacheScenario(browser, server) {
  const label = 'staff Calendar owned Linear tail and BFCache recovery';
  const staffStorage = {
    local: {
      syncview_auth_v1: 'ok',
      syncview_nav: 'calendar',
      syncview_calendar_pins: JSON.stringify([CLIENT_A, CLIENT_B]),
      syncview_calendar_prefs: JSON.stringify({ client: CLIENT_A, view: 'organizer', zoom: 'default' }),
    },
    session: {
      syncview_staff_identity_prompted_v1: '1',
    },
  };

  // v1 Linear reconcile is an ancillary transport, but it can enqueue a real
  // Calendar write. Hold A's reconcile, let A's independent metadata request
  // settle, switch with the real B tab, then release A into B.
  const v1Run = await openCase(browser, server, {
    storage: {
      local: {
        ...staffStorage.local,
        syncview_calendar_v2_off: '1',
      },
      session: staffStorage.session,
    },
    heldLinearPostLoad: {
      rowsBySlug: V1_CALENDAR_ROWS,
      clientA: CLIENT_A,
      ident: LINEAR_LEASE_IDENT,
    },
  });
  try {
    await streamedNavigation(
      v1Run.page,
      server,
      () => v1Run.page.goto(`${server.origin}/index.html#calendar`, { waitUntil: 'load', timeout: 15_000 }),
      'static:calendar',
    );
    await v1Run.page.waitForFunction(expectedClient => {
      const held = window.__syncviewHeldLinearPostLoad;
      return held?.calendarReads.length === 1
        && held.linearReads.length === 2
        && held.linearReads.every(read => read.client === expectedClient)
        && calState.client === expectedClient;
    }, CLIENT_A, { timeout: 10_000 });
    const initialLinear = await v1Run.page.evaluate(() => (
      JSON.parse(JSON.stringify(window.__syncviewHeldLinearPostLoad.linearReads))
    ));
    assert.deepEqual(initialLinear.map(read => read.kind), ['reconcile', 'meta'],
      `${label}: A must start separate v1 reconcile and metadata transports`);

    // Settle normal A metadata before the switch; only reconcile remains late.
    await v1Run.page.evaluate(() => window.__syncviewReleaseHeldLinear(1));
    await v1Run.page.waitForFunction(() => (
      window.__syncviewHeldLinearPostLoad.linearCompleted === 1
      && window.__syncviewHeldLinearPostLoad.linearReads[1].completed === true
    ), null, { timeout: 10_000 });
    await armTrustedClickTraceBoundary(v1Run.page, '#calTabs .cal-tab', CLIENT_B);
    await v1Run.page.locator('#calTabs .cal-tab', { hasText: CLIENT_B }).click();
    await v1Run.page.waitForFunction(expectedClient => {
      const held = window.__syncviewHeldLinearPostLoad;
      return calState.client === expectedClient
        && held?.calendarReads.length === 2
        && held.linearReads.length === 3
        && held.linearReads[2].client === expectedClient
        && held.linearReads[2].kind === 'reconcile';
    }, CLIENT_B, { timeout: 10_000 });

    await v1Run.page.evaluate(() => {
      window.__syncviewLateLinearRenders = [];
      const originalRender = _calRenderBody;
      _calRenderBody = function guardedLinearRender() {
        window.__syncviewLateLinearRenders.push({
          client: calState.client,
          at: Math.round(performance.now()),
        });
        return originalRender.apply(this, arguments);
      };
    });
    const v1BeforeLateA = await v1Run.page.evaluate(() => ({
      transport: JSON.parse(JSON.stringify(window.__syncviewHeldLinearPostLoad)),
      client: calState.client,
      posts: calState.posts.map(post => ({
        id: post.id,
        name: post.name,
        video_status: post.video_status,
        status: post.status,
      })),
      pending: Object.keys(_calPendingEdits),
      noLinearPush: Array.from(_calNoLinearPush),
      cacheA: localStorage.getItem('syncview_calCache_v2:bootfixtureclient'),
      cacheB: localStorage.getItem('syncview_calCache_v2:residualfixtureclient'),
      body: document.getElementById('calBody')?.innerText || '',
      owner: _calActiveLoad ? {
        slug: _calActiveLoad.slug,
        aborted: Boolean(_calActiveLoad.controller && _calActiveLoad.controller.signal.aborted),
      } : null,
    }));
    assert.equal(v1BeforeLateA.transport.linearReads[0].signalAbortedBeforeRelease, true,
      `${label}: real A → B click must abort held A reconcile before release`);
    assert.equal(v1BeforeLateA.client, CLIENT_B, `${label}: B owns state before stale A release`);
    assert.equal(v1BeforeLateA.owner?.slug, 'residualfixtureclient',
      `${label}: B retains the exact post-load owner while its reconcile is held`);
    assert.equal(v1BeforeLateA.owner?.aborted, false, `${label}: B controller remains live`);

    await v1Run.page.evaluate(() => window.__syncviewReleaseHeldLinear(0));
    await v1Run.page.waitForFunction(() => (
      window.__syncviewHeldLinearPostLoad.linearCompleted === 2
      && window.__syncviewHeldLinearPostLoad.linearReads[0].completed === true
    ), null, { timeout: 10_000 });
    await v1Run.page.waitForTimeout(200);
    const v1AfterLateA = await v1Run.page.evaluate(() => ({
      transport: JSON.parse(JSON.stringify(window.__syncviewHeldLinearPostLoad)),
      client: calState.client,
      posts: calState.posts.map(post => ({
        id: post.id,
        name: post.name,
        video_status: post.video_status,
        status: post.status,
      })),
      pending: Object.keys(_calPendingEdits),
      noLinearPush: Array.from(_calNoLinearPush),
      cacheA: localStorage.getItem('syncview_calCache_v2:bootfixtureclient'),
      cacheB: localStorage.getItem('syncview_calCache_v2:residualfixtureclient'),
      body: document.getElementById('calBody')?.innerText || '',
      owner: _calActiveLoad ? {
        slug: _calActiveLoad.slug,
        aborted: Boolean(_calActiveLoad.controller && _calActiveLoad.controller.signal.aborted),
      } : null,
      renders: window.__syncviewLateLinearRenders.slice(),
      clickBoundary: Object.assign({}, window.__syncviewBootClickBoundary),
      trace: window.__syncviewBootTrace.slice(),
    }));
    assert.equal(v1AfterLateA.client, CLIENT_B, `${label}: late A reconcile cannot rebind B`);
    assert.deepEqual(v1AfterLateA.posts, v1BeforeLateA.posts,
      `${label}: late A reconcile cannot create or mutate a B row`);
    assert.deepEqual(v1AfterLateA.pending, v1BeforeLateA.pending,
      `${label}: late A reconcile cannot enqueue A edits under B`);
    assert.deepEqual(v1AfterLateA.noLinearPush, v1BeforeLateA.noLinearPush,
      `${label}: late A reconcile cannot seed B suppression tokens`);
    assert.equal(v1AfterLateA.transport.writeRequests.length, 0,
      `${label}: late A reconcile must produce zero Calendar writes`);
    assert.equal(v1AfterLateA.cacheA, v1BeforeLateA.cacheA,
      `${label}: late reconcile cannot rewrite A cache`);
    assert.equal(v1AfterLateA.cacheB, v1BeforeLateA.cacheB,
      `${label}: late reconcile cannot rewrite B cache`);
    assert.equal(v1AfterLateA.body, v1BeforeLateA.body,
      `${label}: B visible Calendar must remain byte-stable across late A release`);
    assert.deepEqual(v1AfterLateA.renders, [], `${label}: late A reconcile cannot render B`);
    assert.equal(v1AfterLateA.owner?.slug, 'residualfixtureclient',
      `${label}: old A tail cannot clear B's owner`);
    assert.equal(v1AfterLateA.owner?.aborted, false, `${label}: B transport remains live after A tail`);
    assert.deepEqual(v1AfterLateA.clickBoundary, {
      count: 1,
      target: CLIENT_B,
      isTrusted: true,
    }, `${label}: trace boundary must fire once on the real B-tab click`);
    assert.ok(v1AfterLateA.trace.length > 0, `${label}: B-tab click must produce observed frames`);
    assert.ok(
      v1AfterLateA.trace.every(frame => (
        frame.calendarVisible === true
        && frame.calendarActiveClient === CLIENT_B
      )),
      `${label}: every observed frame after the switch stays on B\n${JSON.stringify(traceExcerpt(v1AfterLateA.trace), null, 2)}`,
    );

    await v1Run.page.evaluate(() => window.__syncviewReleaseHeldLinear(2));
    await v1Run.page.waitForFunction(() => (
      window.__syncviewHeldLinearPostLoad.linearCompleted === 3
      && _calActiveLoad === null
    ), null, { timeout: 10_000 });
    assertHealthyHarness(v1Run, `${label} v1 reconcile`);
  } finally {
    await v1Run.context.close();
  }

  // Pending staff primary read: pagehide must flush first, abort the exact
  // controller, clear visual/pending ownership, and persisted pageshow must
  // install exactly one fresh owner before the old response is released.
  const pendingRun = await openBfcacheCase(browser, {
    storage: staffStorage,
    holdCalendar: true,
    calendarRowsPlan: STAFF_BFCACHE_ROWS,
    forbiddenClients: [],
  });
  try {
    await streamedNavigation(
      pendingRun.page,
      server,
      () => pendingRun.page.goto(`${server.origin}/bfcache.html#calendar`, { waitUntil: 'load', timeout: 15_000 }),
      'static:calendar',
    );
    await pendingRun.page.waitForFunction(() => (
      window.__syncviewBfcacheNetwork?.heldCalendarRequests === 1
      && window.__syncviewBfcacheNetwork.sensitiveClientReads
        .filter(read => read.kind === 'calendar_posts').length === 1
      && Boolean(document.querySelector('#calBody .cal-loader'))
      && Boolean(_calActiveLoad)
    ), null, { timeout: 10_000 });
    await pendingRun.page.evaluate(() => {
      window.__syncviewStaffLifecycle = [];
      _calPendingEdits['synthetic-pagehide-flush'] = { name: 'Synthetic flush boundary' };
      _calFlushCardSave = function syntheticPagehideFlush(pid) {
        window.__syncviewStaffLifecycle.push({ kind: 'flush', pid });
        delete _calPendingEdits[pid];
        return Promise.resolve();
      };
      if (_calActiveLoad?.controller) {
        _calActiveLoad.controller.signal.addEventListener('abort', () => {
          window.__syncviewStaffLifecycle.push({ kind: 'abort', slug: _calActiveLoad?.slug || '' });
        }, { once: true });
      }
      window.addEventListener('pagehide', () => {
        window.__syncviewStaffPagehideSnapshot = {
          lifecycle: window.__syncviewStaffLifecycle.slice(),
          activeLoad: _calActiveLoad,
          bg: _calBgLoadInFlight,
          loading: calState.loading,
          refreshingHidden: document.getElementById('calRefreshing')?.hidden !== false,
          pendingRender: _calPendingBackgroundRender,
          pendingInterval: _calPendingRenderInterval,
          lastReturn: _calLastReturnLoad,
          lastNetwork: _calLastNetworkLoadAt,
          suspended: _calStaffPagehideSuspended,
          realtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
        };
        window.__syncviewResetBootTrace();
      }, { once: true });
    });
    const awayOrigin = server.origin.replace('127.0.0.1', 'localhost');
    await pendingRun.page.goto(`${awayOrigin}/boot-away`, { waitUntil: 'load', timeout: 15_000 });
    await pendingRun.page.waitForSelector('[data-boot-away]', { state: 'visible', timeout: 10_000 });
    const pendingRequestedDocument = await restoreFromBfcache(pendingRun.page, server, '/bfcache.html');
    await pendingRun.page.waitForFunction(() => {
      const reads = window.__syncviewBfcacheNetwork?.sensitiveClientReads
        .filter(read => read.kind === 'calendar_posts') || [];
      return window.__syncviewPageShows.some(event => event.persisted === true)
        && reads.length === 2
        && window.__syncviewBfcacheNetwork.heldCalendarRequests === 2
        && Boolean(_calActiveLoad)
        && Boolean(document.querySelector('#calBody .cal-loader'));
    }, null, { timeout: 10_000 });
    await pendingRun.page.waitForTimeout(250);
    const pendingRestored = await pendingRun.page.evaluate(() => {
      const reads = window.__syncviewBfcacheNetwork.sensitiveClientReads
        .filter(read => read.kind === 'calendar_posts');
      return {
        pagehide: window.__syncviewStaffPagehideSnapshot,
        pageShows: window.__syncviewPageShows.slice(),
        reads: JSON.parse(JSON.stringify(reads)),
        owner: _calActiveLoad ? {
          slug: _calActiveLoad.slug,
          aborted: Boolean(_calActiveLoad.controller && _calActiveLoad.controller.signal.aborted),
        } : null,
        loading: calState.loading,
        loaderVisible: Boolean(document.querySelector('#calBody .cal-loader')),
        posts: calState.posts.map(post => post.name),
        cache: localStorage.getItem('syncview_calCache_v2:bootfixtureclient'),
        realtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
      };
    });
    assert.equal(pendingRequestedDocument, false, `${label}: pending staff return must be a real BFCache restore`);
    assert.deepEqual(
      pendingRestored.pagehide.lifecycle.map(event => event.kind),
      ['flush', 'abort'],
      `${label}: staff pagehide must flush writers before aborting read ownership`,
    );
    assert.equal(pendingRestored.pagehide.activeLoad, null, `${label}: pagehide retires active read owner`);
    assert.equal(pendingRestored.pagehide.bg, false, `${label}: pagehide clears background ownership`);
    assert.equal(pendingRestored.pagehide.loading, false, `${label}: pagehide clears loading ownership`);
    assert.equal(pendingRestored.pagehide.refreshingHidden, true, `${label}: pagehide hides refreshing UI`);
    assert.equal(pendingRestored.pagehide.pendingRender, false, `${label}: pagehide clears deferred render ownership`);
    assert.equal(pendingRestored.pagehide.pendingInterval, null, `${label}: pagehide clears deferred render timer`);
    assert.equal(pendingRestored.pagehide.lastReturn, 0, `${label}: pagehide resets return throttle`);
    assert.equal(pendingRestored.pagehide.lastNetwork, 0, `${label}: pagehide resets network throttle`);
    assert.equal(pendingRestored.pagehide.suspended, true, `${label}: visible staff Calendar is marked suspended`);
    assert.equal(pendingRestored.reads.length, 2, `${label}: persisted pageshow starts exactly one fresh read`);
    assert.equal(pendingRestored.reads[0].signalAbortedBeforeRelease, true,
      `${label}: old staff read is signal-aborted before release`);
    assert.equal(pendingRestored.reads[1].signalAbortedBeforeRelease, false,
      `${label}: restored read owns a live controller`);
    assert.equal(pendingRestored.owner?.slug, CLIENT_A_SLUG, `${label}: restored owner is exact-client`);
    assert.equal(pendingRestored.owner?.aborted, false, `${label}: restored controller remains live`);
    assert.equal(pendingRestored.loading, true, `${label}: restored fresh load owns state`);
    assert.equal(pendingRestored.loaderVisible, true, `${label}: restored fresh loader is visibly painted`);
    assert.deepEqual(pendingRestored.posts, [], `${label}: no pre-hide rows apply before release`);
    assert.equal(pendingRestored.cache, null, `${label}: no pre-hide cache applies before release`);
    assert.deepEqual(calendarRealtime(pendingRestored.realtime).created, [],
      `${label}: no pre-hide realtime channel survives`);

    await pendingRun.page.evaluate(() => window.__syncviewReleaseBfcacheCalendar(0));
    await pendingRun.page.waitForFunction(() => (
      window.__syncviewBfcacheNetwork.calendarResponsesCompleted === 1
    ), null, { timeout: 10_000 });
    await pendingRun.page.waitForTimeout(200);
    const afterSuspendedRelease = await pendingRun.page.evaluate(() => ({
      posts: calState.posts.map(post => post.name),
      cache: localStorage.getItem('syncview_calCache_v2:bootfixtureclient'),
      owner: _calActiveLoad ? {
        slug: _calActiveLoad.slug,
        aborted: Boolean(_calActiveLoad.controller && _calActiveLoad.controller.signal.aborted),
      } : null,
      loading: calState.loading,
      loaderVisible: Boolean(document.querySelector('#calBody .cal-loader')),
      realtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
      body: document.getElementById('calBody')?.innerText || '',
      trace: window.__syncviewBootTrace.slice(),
    }));
    assert.deepEqual(afterSuspendedRelease.posts, [], `${label}: late suspended rows cannot apply`);
    assert.equal(afterSuspendedRelease.cache, null, `${label}: late suspended rows cannot cache`);
    assert.equal(afterSuspendedRelease.owner?.slug, CLIENT_A_SLUG,
      `${label}: old completion cannot clear restored owner`);
    assert.equal(afterSuspendedRelease.owner?.aborted, false,
      `${label}: old completion cannot abort restored controller`);
    assert.equal(afterSuspendedRelease.loading, true, `${label}: old finally cannot clear restored loader`);
    assert.equal(afterSuspendedRelease.loaderVisible, true, `${label}: restored loader remains visible`);
    assert.equal(afterSuspendedRelease.body.includes(STAFF_BFCACHE_ROWS[0][0].name), false,
      `${label}: suspended row never paints`);
    assert.deepEqual(calendarRealtime(afterSuspendedRelease.realtime).created, [],
      `${label}: old tail cannot reopen realtime`);

    await pendingRun.page.evaluate(() => window.__syncviewReleaseBfcacheCalendar(1));
    await pendingRun.page.waitForFunction(expectedRow => (
      window.__syncviewBfcacheNetwork.calendarResponsesCompleted === 2
      && calState.posts.some(post => post.name === expectedRow)
      && calState.loading === false
      && window.calV2Status().subscribed === true
      && _calActiveLoad === null
    ), STAFF_BFCACHE_ROWS[1][0].name, { timeout: 10_000 });
    const pendingSettled = await pendingRun.page.evaluate(() => ({
      reads: window.__syncviewBfcacheNetwork.sensitiveClientReads
        .filter(read => read.kind === 'calendar_posts'),
      posts: calState.posts.map(post => post.name),
      cache: localStorage.getItem('syncview_calCache_v2:bootfixtureclient'),
      realtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
      body: document.getElementById('calBody')?.innerText || '',
      trace: window.__syncviewBootTrace.slice(),
      unmocked: window.__syncviewBfcacheNetwork.unmocked.slice(),
    }));
    assert.equal(pendingSettled.reads.length, 2, `${label}: focus/visibility add no duplicate resumed read`);
    assert.deepEqual(pendingSettled.posts, [STAFF_BFCACHE_ROWS[1][0].name],
      `${label}: only fresh resumed rows settle`);
    assert.match(pendingSettled.cache || '', /Synthetic resumed staff row/,
      `${label}: only fresh resumed rows cache`);
    assert.equal(pendingSettled.cache.includes('Synthetic suspended staff row'), false,
      `${label}: suspended row stays out of cache`);
    assert.equal(pendingSettled.body.includes(STAFF_BFCACHE_ROWS[0][0].name), false,
      `${label}: suspended row stays out of visible body`);
    assert.deepEqual(calendarRealtime(pendingSettled.realtime).created, [`cal-${CLIENT_A_SLUG}`],
      `${label}: only the restored lease opens realtime`);
    assert.deepEqual(pendingSettled.unmocked, [], `${label}: pending BFCache traffic remains synthetic`);
    assert.ok(
      pendingSettled.trace.some(frame => frame.calendarLoadingVisible === true)
        && pendingSettled.trace.some(frame => frame.calendarFieldValues.includes('Synthetic resumed staff row')),
      `${label}: rAF trace must observe restored loader then fresh row\n${JSON.stringify(traceExcerpt(pendingSettled.trace), null, 2)}`,
    );
    assert.deepEqual(pendingRun.consoleErrors, [], `${label}: pending BFCache browser console errors`);
    assert.deepEqual(pendingRun.pageErrors, [], `${label}: pending BFCache uncaught errors`);
  } finally {
    await pendingRun.context.close();
  }

  // Settled staff BFCache: remove the pre-hide channel, bypass the normal
  // four-second return throttle, visibly refresh once, and hold the forced
  // metadata continuation while a real A → B click takes ownership.
  const settledRows = [
    [{
      ...V1_CALENDAR_ROWS[CLIENT_A_SLUG][0],
      id: 'synthetic-settled-a-before',
      name: 'Synthetic settled A before BFCache',
    }],
    [{
      ...V1_CALENDAR_ROWS[CLIENT_A_SLUG][0],
      id: 'synthetic-settled-a-after',
      name: 'Synthetic settled A after BFCache',
    }],
    [V1_CALENDAR_ROWS.residualfixtureclient[0]],
  ];
  const settledRun = await openBfcacheCase(browser, {
    storage: staffStorage,
    holdCalendarPlan: [false, true, false],
    calendarRowsPlan: settledRows,
    holdLinearMetaPlan: [false, true],
    linearMetaPlan: [{ hasAll: true }, { hasAll: false }],
    forbiddenClients: [],
  });
  try {
    await streamedNavigation(
      settledRun.page,
      server,
      () => settledRun.page.goto(`${server.origin}/bfcache.html#calendar`, { waitUntil: 'load', timeout: 15_000 }),
      'static:calendar',
    );
    await settledRun.page.waitForFunction(expectedRow => (
      calState.posts.some(post => post.name === expectedRow)
      && window.calV2Status().subscribed === true
      && window.__syncviewBfcacheNetwork.linearMetaCompleted === 1
      && _calActiveLoad === null
    ), settledRows[0][0].name, { timeout: 10_000 });
    await settledRun.page.evaluate(() => {
      window.__syncviewSettledPagehide = null;
      window.addEventListener('pagehide', () => {
        window.__syncviewSettledPagehide = {
          activeLoad: _calActiveLoad,
          bg: _calBgLoadInFlight,
          loading: calState.loading,
          refreshingHidden: document.getElementById('calRefreshing')?.hidden !== false,
          pendingRender: _calPendingBackgroundRender,
          pendingInterval: _calPendingRenderInterval,
          lastReturn: _calLastReturnLoad,
          lastNetwork: _calLastNetworkLoadAt,
          realtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
        };
        window.__syncviewResetBootTrace();
      }, { once: true });
    });
    const awayOrigin = server.origin.replace('127.0.0.1', 'localhost');
    await settledRun.page.goto(`${awayOrigin}/boot-away`, { waitUntil: 'load', timeout: 15_000 });
    await settledRun.page.waitForSelector('[data-boot-away]', { state: 'visible', timeout: 10_000 });
    const settledRequestedDocument = await restoreFromBfcache(settledRun.page, server, '/bfcache.html');
    await settledRun.page.waitForFunction(() => {
      const reads = window.__syncviewBfcacheNetwork?.sensitiveClientReads
        .filter(read => read.kind === 'calendar_posts') || [];
      return window.__syncviewPageShows.some(event => event.persisted === true)
        && reads.length === 2
        && window.__syncviewBfcacheNetwork.heldCalendarRequests === 1
        && Boolean(_calActiveLoad)
        && document.getElementById('calRefreshing')?.hidden === false;
    }, null, { timeout: 10_000 });
    await settledRun.page.waitForTimeout(250);
    const settledRestored = await settledRun.page.evaluate(() => ({
      pagehide: window.__syncviewSettledPagehide,
      reads: window.__syncviewBfcacheNetwork.sensitiveClientReads
        .filter(read => read.kind === 'calendar_posts'),
      owner: _calActiveLoad ? {
        slug: _calActiveLoad.slug,
        aborted: Boolean(_calActiveLoad.controller && _calActiveLoad.controller.signal.aborted),
      } : null,
      refreshingVisible: document.getElementById('calRefreshing')?.hidden === false,
      realtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
      trace: window.__syncviewBootTrace.slice(),
    }));
    assert.equal(settledRequestedDocument, false, `${label}: settled staff return must use BFCache`);
    assert.equal(settledRestored.reads.length, 2,
      `${label}: settled persisted pageshow bypasses throttle for exactly one new read`);
    assert.equal(settledRestored.owner?.slug, CLIENT_A_SLUG, `${label}: settled restore owns A`);
    assert.equal(settledRestored.owner?.aborted, false, `${label}: settled restore controller is live`);
    assert.equal(settledRestored.refreshingVisible, true, `${label}: settled restore visibly refreshes`);
    assert.equal(settledRestored.pagehide.activeLoad, null, `${label}: settled pagehide has no owner`);
    assert.equal(settledRestored.pagehide.bg, false, `${label}: settled pagehide clears bg flag`);
    assert.equal(settledRestored.pagehide.loading, false, `${label}: settled pagehide clears loading flag`);
    assert.equal(settledRestored.pagehide.refreshingHidden, true, `${label}: settled pagehide hides refresh chip`);
    assert.equal(settledRestored.pagehide.pendingRender, false, `${label}: settled pagehide clears deferred render`);
    assert.equal(settledRestored.pagehide.pendingInterval, null, `${label}: settled pagehide clears render timer`);
    assert.equal(settledRestored.pagehide.lastReturn, 0, `${label}: settled pagehide resets return clock`);
    assert.equal(settledRestored.pagehide.lastNetwork, 0, `${label}: settled pagehide resets network clock`);
    assert.deepEqual(calendarRealtime(settledRestored.pagehide.realtime).removed, [`cal-${CLIENT_A_SLUG}`],
      `${label}: settled pagehide removes the pre-hide realtime channel`);

    await settledRun.page.evaluate(() => window.__syncviewReleaseBfcacheCalendar(1));
    await settledRun.page.waitForFunction(expectedRow => (
      calState.posts.some(post => post.name === expectedRow)
      && window.__syncviewBfcacheNetwork.linearMetaReads.length === 2
      && window.__syncviewBfcacheNetwork.linearMetaReads[1].completed === false
      && window.__syncviewRealtimeTrace.created.filter(name => name === `cal-${calClientSlug(calState.client)}`).length === 2
      && _calActiveLoad !== null
    ), settledRows[1][0].name, { timeout: 10_000 });
    await settledRun.page.waitForTimeout(120);
    const forcedMetaHeld = await settledRun.page.evaluate(() => ({
      reads: window.__syncviewBfcacheNetwork.sensitiveClientReads
        .filter(read => read.kind === 'calendar_posts'),
      linear: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork.linearMetaReads)),
      posts: calState.posts.map(post => post.name),
      realtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
      refreshingVisible: document.getElementById('calRefreshing')?.hidden === false,
      trace: window.__syncviewBootTrace.slice(),
    }));
    assert.equal(forcedMetaHeld.reads.length, 2, `${label}: resumed Calendar still owns exactly one new read`);
    assert.equal(forcedMetaHeld.linear[1].client, CLIENT_A, `${label}: forced return meta is leased to A`);
    assert.equal(forcedMetaHeld.refreshingVisible, false, `${label}: primary data settles while meta remains held`);
    assert.deepEqual(calendarRealtime(forcedMetaHeld.realtime).created,
      [`cal-${CLIENT_A_SLUG}`, `cal-${CLIENT_A_SLUG}`],
      `${label}: slow forced meta does not block resumed realtime`);
    assert.ok(
      forcedMetaHeld.trace.some(frame => frame.calendarLoadingVisible === true)
        && forcedMetaHeld.trace.some(frame => frame.calendarFieldValues.includes(settledRows[1][0].name)),
      `${label}: settled restore paints refresh then fresh A row\n${JSON.stringify(traceExcerpt(forcedMetaHeld.trace), null, 2)}`,
    );

    await armTrustedClickTraceBoundary(settledRun.page, '#calTabs .cal-tab', CLIENT_B);
    await settledRun.page.locator('#calTabs .cal-tab', { hasText: CLIENT_B }).click();
    await settledRun.page.waitForFunction(expectedRow => (
      calState.client === 'Residual Fixture Client'
      && calState.posts.some(post => post.name === expectedRow)
      && _calActiveLoad === null
      && window.calV2Status().slug === 'residualfixtureclient'
    ), settledRows[2][0].name, { timeout: 10_000 });
    await settledRun.page.evaluate(() => {
      window.__syncviewForcedMetaRenders = [];
      const originalRender = _calRenderBody;
      _calRenderBody = function guardedForcedMetaRender() {
        window.__syncviewForcedMetaRenders.push({
          client: calState.client,
          at: Math.round(performance.now()),
        });
        return originalRender.apply(this, arguments);
      };
    });
    const beforeForcedMetaRelease = await settledRun.page.evaluate(() => ({
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
      client: calState.client,
      posts: calState.posts.map(post => ({
        id: post.id,
        name: post.name,
        status: post.status,
      })),
      meta: Array.from(_calLinearMetaByIdent.entries()),
      parents: Array.from(_calParentLinks),
      metaSig: _calLinearStatusMetaSig,
      metaAt: _calLinearStatusMetaAt,
      persistedMeta: localStorage.getItem(CAL_LINEAR_META_LS_KEY),
      cacheA: localStorage.getItem('syncview_calCache_v2:bootfixtureclient'),
      cacheB: localStorage.getItem('syncview_calCache_v2:residualfixtureclient'),
      body: document.getElementById('calBody')?.innerText || '',
      realtime: JSON.parse(JSON.stringify(window.__syncviewRealtimeTrace)),
    }));
    assert.equal(beforeForcedMetaRelease.network.linearMetaReads[1].signalAbortedBeforeRelease, true,
      `${label}: A → B aborts held forced-meta transport`);
    assert.equal(beforeForcedMetaRelease.client, CLIENT_B, `${label}: B owns state before forced-meta release`);
    assert.equal(beforeForcedMetaRelease.network.writeRequests.length, 0,
      `${label}: setup makes no Calendar writes`);

    await settledRun.page.evaluate(() => window.__syncviewReleaseBfcacheLinearMeta(1));
    await settledRun.page.waitForFunction(() => (
      window.__syncviewBfcacheNetwork.linearMetaCompleted === 2
    ), null, { timeout: 10_000 });
    await settledRun.page.waitForTimeout(200);
    const afterForcedMetaRelease = await settledRun.page.evaluate(() => ({
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
      client: calState.client,
      posts: calState.posts.map(post => ({
        id: post.id,
        name: post.name,
        status: post.status,
      })),
      meta: Array.from(_calLinearMetaByIdent.entries()),
      parents: Array.from(_calParentLinks),
      metaSig: _calLinearStatusMetaSig,
      metaAt: _calLinearStatusMetaAt,
      persistedMeta: localStorage.getItem(CAL_LINEAR_META_LS_KEY),
      cacheA: localStorage.getItem('syncview_calCache_v2:bootfixtureclient'),
      cacheB: localStorage.getItem('syncview_calCache_v2:residualfixtureclient'),
      body: document.getElementById('calBody')?.innerText || '',
      renders: window.__syncviewForcedMetaRenders.slice(),
      clickBoundary: Object.assign({}, window.__syncviewBootClickBoundary),
      trace: window.__syncviewBootTrace.slice(),
    }));
    assert.equal(afterForcedMetaRelease.client, CLIENT_B, `${label}: late forced meta cannot rebind B`);
    assert.deepEqual(afterForcedMetaRelease.posts, beforeForcedMetaRelease.posts,
      `${label}: late forced meta cannot mutate B rows`);
    assert.deepEqual(afterForcedMetaRelease.meta, beforeForcedMetaRelease.meta,
      `${label}: late A meta cannot mutate shared B banner metadata`);
    assert.deepEqual(afterForcedMetaRelease.parents, beforeForcedMetaRelease.parents,
      `${label}: late A meta cannot mutate parent-link state`);
    assert.equal(afterForcedMetaRelease.metaSig, beforeForcedMetaRelease.metaSig,
      `${label}: late A meta cannot mutate global signature`);
    assert.equal(afterForcedMetaRelease.metaAt, beforeForcedMetaRelease.metaAt,
      `${label}: late A meta cannot mutate global throttle`);
    assert.equal(afterForcedMetaRelease.persistedMeta, beforeForcedMetaRelease.persistedMeta,
      `${label}: late A meta cannot persist localStorage`);
    assert.equal(afterForcedMetaRelease.cacheA, beforeForcedMetaRelease.cacheA,
      `${label}: late A meta cannot rewrite A cache`);
    assert.equal(afterForcedMetaRelease.cacheB, beforeForcedMetaRelease.cacheB,
      `${label}: late A meta cannot rewrite B cache`);
    assert.equal(afterForcedMetaRelease.body, beforeForcedMetaRelease.body,
      `${label}: late A meta cannot repaint B`);
    assert.deepEqual(afterForcedMetaRelease.renders, [], `${label}: late A meta cannot invoke B render`);
    assert.equal(afterForcedMetaRelease.network.writeRequests.length, 0,
      `${label}: forced-meta tail produces no writes`);
    assert.deepEqual(afterForcedMetaRelease.clickBoundary, {
      count: 1,
      target: CLIENT_B,
      isTrusted: true,
    }, `${label}: settled trace boundary must fire once on the real B-tab click`);
    assert.ok(afterForcedMetaRelease.trace.length > 0,
      `${label}: settled B-tab click must produce observed frames`);
    assert.ok(
      afterForcedMetaRelease.trace.every(frame => (
        frame.calendarVisible === true
        && frame.calendarActiveClient === CLIENT_B
      )),
      `${label}: every frame after B ownership stays on B\n${JSON.stringify(traceExcerpt(afterForcedMetaRelease.trace), null, 2)}`,
    );
    assert.deepEqual(afterForcedMetaRelease.network.unmocked, [],
      `${label}: settled BFCache/forced-meta traffic remains synthetic`);
    assert.deepEqual(settledRun.consoleErrors, [], `${label}: settled BFCache browser console errors`);
    assert.deepEqual(settledRun.pageErrors, [], `${label}: settled BFCache uncaught errors`);
  } finally {
    await settledRun.context.close();
  }

  passGroup(label);
}

async function runClientLegacyResumeLeaseScenario(browser, server) {
  const label = 'F184 verified client queue resume lease and BFCache stale release';
  const queueA = {
    id: 'synthetic-f184-client-a',
    kind: 'status',
    payload: {
      issue: 'https://linear.app/synthetic/issue/VID-1841/client-a',
      status: 'Tweaks Needed',
    },
    attempts: 0,
    lastError: '',
    lastAttempt: 0,
    queuedAt: 1784520000000,
    transport: 'legacy_n8n',
    client_slug: CLIENT_A_SLUG,
  };
  const queueB = {
    id: 'synthetic-f184-client-b',
    kind: 'status',
    payload: {
      issue: 'https://linear.app/synthetic/issue/VID-1842/client-b',
      status: 'Approved',
    },
    attempts: 0,
    lastError: 'foreign-byte-sentinel',
    lastAttempt: 17,
    queuedAt: 1784520000001,
    transport: 'legacy_n8n',
    client_slug: 'residualfixtureclient',
  };
  const unknownQueue = {
    id: 'synthetic-f184-unknown',
    kind: 'status',
    payload: {
      issue: 'https://linear.app/synthetic/issue/VID-1843/unknown',
      status: 'In Progress',
    },
    attempts: 4,
    lastError: 'unknown-byte-sentinel',
    lastAttempt: 23,
    queuedAt: 1784520000002,
    transport: 'legacy_n8n',
    client_slug: '',
  };
  const foreignGateQueue = {
    id: 'synthetic-f184-foreign-source-gate',
    kind: 'status',
    payload: {
      issue: 'https://linear.app/synthetic/issue/VID-1844/foreign-source-gate',
      status: 'Tweaks Needed',
    },
    attempts: 2,
    lastError: 'foreign-gate-byte-sentinel',
    lastAttempt: 29,
    queuedAt: 1784520000003,
    transport: 'legacy_n8n',
    client_slug: CLIENT_A_SLUG,
    source_gate: {
      surface: 'calendar',
      client_slug: CLIENT_A_SLUG,
      principal: 'client:residualfixtureclient',
      post_id: 'synthetic-f184-foreign-gate-post',
      component: 'video',
      linear_issue: 'https://linear.app/synthetic/issue/VID-1844/foreign-source-gate',
    },
  };
  const originalQueue = [queueA, queueB, unknownQueue, foreignGateQueue];
  const originalQueueBytes = JSON.stringify(originalQueue);
  const foreignBytes = JSON.stringify(queueB);
  const unknownBytes = JSON.stringify(unknownQueue);
  const foreignGateBytes = JSON.stringify(foreignGateQueue);
  const staffOnlyJobs = [{
    id: 'synthetic-f184-staff-card-job',
    clientName: CLIENT_B,
    formTitle: 'Synthetic staff-only Calendar recovery job',
    mode: 'video',
    videos: [{ number: 1 }],
    done: [],
    runs: 0,
    createdAt: 1784520000004,
    heartbeatAt: 0,
  }];
  const staffOnlyBytes = JSON.stringify(staffOnlyJobs);
  const run = await openBfcacheCase(browser, {
    view: 'calendar',
    verifierPlan: [
      { hold: true, status: 500 },
      { status: 200, valid: true },
      { status: 500 },
      { status: 200, valid: true },
      { status: 200, valid: true },
    ],
    holdWriteUiReroutePlan: [false, true],
    legacyQueueStatusPlan: [500, 500, 200],
    observeStorageKeys: [CALENDAR_LEGACY_OUTBOX_KEY, CALENDAR_CARD_JOBS_KEY],
    captureLegacyResumeInterval: true,
    storage: {
      local: {
        [CALENDAR_LEGACY_OUTBOX_KEY]: originalQueueBytes,
        [CALENDAR_CARD_JOBS_KEY]: staffOnlyBytes,
      },
    },
  });
  try {
    const query = new URLSearchParams({
      c: CLIENT_A,
      v: 'calendar',
      t: CURRENT_TOKEN,
    });
    await streamedNavigation(
      run.page,
      server,
      () => run.page.goto(`${server.origin}/bfcache.html?${query}`, { waitUntil: 'load', timeout: 15_000 }),
      'static:client-verify',
    );
    await run.page.waitForFunction(() => {
      const network = window.__syncviewBfcacheNetwork;
      return network
        && network.verifierCalls.length === 1
        && network.verifierResponses.length === 0
        && network.heldVerifierRequests === 1
        && network.writeUiRerouteReads.length === 1
        && network.writeUiRerouteReads[0].released === true;
    }, null, { timeout: 10_000 });

    await run.page.evaluate(async () => {
      window.__syncviewF184StaffRunnerCalls = 0;
      const originalStaffRunner = _resumePendingCalCardJobs;
      _resumePendingCalCardJobs = function syncviewObservedStaffRunner(...args) {
        window.__syncviewF184StaffRunnerCalls += 1;
        return originalStaffRunner.apply(this, args);
      };
      window.__syncviewF184TriggerMatrix = ['startup'];
      window.dispatchEvent(new Event('focus'));
      window.__syncviewF184TriggerMatrix.push('focus');
      window.dispatchEvent(new Event('online'));
      window.__syncviewF184TriggerMatrix.push('online');
      if (document.visibilityState !== 'visible') throw new Error('F184 visibility trigger requires a visible document');
      document.dispatchEvent(new Event('visibilitychange'));
      window.__syncviewF184TriggerMatrix.push('visibilitychange:visible');
      await Promise.resolve(window.__syncviewInvokeLegacyResumeInterval());
      window.__syncviewF184TriggerMatrix.push('timer:60000');
    });
    await run.page.waitForTimeout(100);
    const pending = await run.page.evaluate(key => ({
      snapshot: window.__syncviewBootSnapshot(),
      trace: window.__syncviewBootTrace.slice(),
      queue: window.__syncviewReadStorageWithoutTrace(key),
      staffOnly: window.__syncviewReadStorageWithoutTrace('syncview_calCardJobs_v1'),
      queueReads: window.__syncviewObservedStorageReads.slice(),
      staffRunnerCalls: window.__syncviewF184StaffRunnerCalls,
      triggerMatrix: window.__syncviewF184TriggerMatrix.slice(),
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
    }), CALENDAR_LEGACY_OUTBOX_KEY);
    assert.ok(['static:client-verify', 'loading:verify'].includes(pending.snapshot.surface),
      `${label}: pending strict verifier remains visibly neutral`);
    assert.equal(pending.snapshot.analyticsFlash, false, `${label}: pending verifier never flashes Analytics`);
    assert.ok(pending.trace.some(frame => frame.surface === 'static:client-verify'),
      `${label}: streamed first paint must be the neutral verifier`);
    assert.equal(pending.queue, originalQueueBytes, `${label}: pending verifier preserves A+B+unknown debt bytes`);
    assert.deepEqual(pending.queueReads, [], `${label}: pending verifier and lifecycle events inspect no queue storage`);
    assert.equal(pending.staffOnly, staffOnlyBytes, `${label}: pending triggers preserve staff-only debt bytes`);
    assert.equal(pending.staffRunnerCalls, 0, `${label}: pending triggers never invoke the staff-only runner`);
    assert.deepEqual(pending.triggerMatrix, [
      'startup',
      'focus',
      'online',
      'visibilitychange:visible',
      'timer:60000',
    ], `${label}: startup plus exact focus/online/visible/timer callbacks execute before verdict`);
    assert.deepEqual(pending.network.legacyQueueWrites, [], `${label}: pending verifier starts no queue POST`);

    await run.page.evaluate(() => window.__syncviewReleaseBfcacheVerifier(0));
    await run.page.waitForSelector('[data-client-entry-state="retry"]', { state: 'visible', timeout: 10_000 });
    await run.page.waitForFunction(() => (
      window.__syncviewBootTrace.some(frame => frame.surface === 'entry:retry')
    ), null, { timeout: 10_000 });
    const failed = await run.page.evaluate(key => ({
      snapshot: window.__syncviewBootSnapshot(),
      trace: window.__syncviewBootTrace.slice(),
      queue: window.__syncviewReadStorageWithoutTrace(key),
      staffOnly: window.__syncviewReadStorageWithoutTrace('syncview_calCardJobs_v1'),
      queueReads: window.__syncviewObservedStorageReads.slice(),
      staffRunnerCalls: window.__syncviewF184StaffRunnerCalls,
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
    }), CALENDAR_LEGACY_OUTBOX_KEY);
    assert.equal(failed.snapshot.surface, 'entry:retry', `${label}: verifier 500 becomes a visible retry`);
    assert.ok(failed.trace.some(frame => frame.surface === 'entry:retry'), `${label}: rAF trace observes the retry surface`);
    assert.equal(failed.network.verifierResponses[0]?.status, 500, `${label}: first verifier response is the injected 500`);
    assert.equal(failed.queue, originalQueueBytes, `${label}: verifier 500 preserves all debt bytes`);
    assert.deepEqual(failed.queueReads, [], `${label}: verifier 500 path still inspects no queue storage`);
    assert.equal(failed.staffOnly, staffOnlyBytes, `${label}: verifier 500 preserves staff-only debt bytes`);
    assert.equal(failed.staffRunnerCalls, 0, `${label}: verifier 500 never invokes staff-only recovery`);
    assert.deepEqual(failed.network.legacyQueueWrites, [], `${label}: verifier 500 path starts no queue POST`);

    await run.page.evaluate(() => {
      _writeUiRerouteFlagPromise = null;
      window.__syncviewResetBootTrace();
    });
    await run.page.locator('[data-client-entry-state="retry"] button', { hasText: 'Try again' }).click();
    await run.page.waitForFunction(expectedClient => {
      const network = window.__syncviewBfcacheNetwork;
      return network
        && network.verifierResponses.length === 2
        && network.verifierResponses[1].valid === true
        && network.heldWriteUiRerouteRequests === 1
        && network.writeUiRerouteReads.length === 2
        && document.querySelector('#calView .cal-embed-title strong')?.textContent.trim() === expectedClient;
    }, CLIENT_A, { timeout: 10_000 });
    const heldVerified = await run.page.evaluate(key => ({
      snapshot: window.__syncviewBootSnapshot(),
      trace: window.__syncviewBootTrace.slice(),
      queue: window.__syncviewReadStorageWithoutTrace(key),
      staffOnly: window.__syncviewReadStorageWithoutTrace('syncview_calCardJobs_v1'),
      queueReads: window.__syncviewObservedStorageReads.slice(),
      staffRunnerCalls: window.__syncviewF184StaffRunnerCalls,
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
    }), CALENDAR_LEGACY_OUTBOX_KEY);
    assert.equal(heldVerified.snapshot.calendarVisible, true, `${label}: strict retry mounts the real Calendar route`);
    assert.equal(heldVerified.snapshot.analyticsFlash, false, `${label}: strict retry never flashes Analytics`);
    assert.equal(heldVerified.queue, originalQueueBytes, `${label}: held routing read leaves all queue bytes untouched`);
    assert.deepEqual(heldVerified.queueReads, [], `${label}: queue inspection waits behind the held routing read`);
    assert.equal(heldVerified.staffOnly, staffOnlyBytes, `${label}: verified client mount preserves staff-only debt bytes`);
    assert.equal(heldVerified.staffRunnerCalls, 0, `${label}: verified client mount excludes the staff-only runner`);
    assert.deepEqual(heldVerified.network.legacyQueueWrites, [], `${label}: held routing read starts no POST`);

    await run.page.evaluate(() => {
      window.__syncviewPageShows = [];
      window.addEventListener('pagehide', () => window.__syncviewResetBootTrace(), {
        capture: true,
        once: true,
      });
    });
    const awayOrigin = server.origin.replace('127.0.0.1', 'localhost');
    await run.page.goto(`${awayOrigin}/boot-away`, { waitUntil: 'load', timeout: 15_000 });
    await run.page.waitForSelector('[data-boot-away]', { state: 'visible', timeout: 10_000 });
    const requestedDocument = await restoreFromBfcache(run.page, server, '/bfcache.html');
    await run.page.waitForSelector('[data-client-entry-state="retry"]', { state: 'visible', timeout: 10_000 });
    await run.page.waitForFunction(() => (
      window.__syncviewBootTrace.some(frame => frame.surface === 'entry:retry')
    ), null, { timeout: 10_000 });
    await run.page.evaluate(() => {
      if (!window.__syncviewPageShows.some(event => event.persisted === true)) {
        throw new Error('F184 expected a real persisted pageshow');
      }
      window.__syncviewF184TriggerMatrix.push('pageshow:persisted');
    });
    const beforeStaleRelease = await run.page.evaluate(key => ({
      pageShows: window.__syncviewPageShows.slice(),
      trace: window.__syncviewBootTrace.slice(),
      queue: window.__syncviewReadStorageWithoutTrace(key),
      staffOnly: window.__syncviewReadStorageWithoutTrace('syncview_calCardJobs_v1'),
      queueReads: window.__syncviewObservedStorageReads.slice(),
      staffRunnerCalls: window.__syncviewF184StaffRunnerCalls,
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
    }), CALENDAR_LEGACY_OUTBOX_KEY);
    assert.equal(requestedDocument, false, `${label}: Back restores the real cached document`);
    assert.ok(beforeStaleRelease.pageShows.some(event => event.persisted === true),
      `${label}: pageshow.persisted proves actual BFCache restoration`);
    assert.equal(beforeStaleRelease.network.verifierResponses[2]?.status, 500,
      `${label}: BFCache return fails visibly before stale work is released`);
    assert.ok(beforeStaleRelease.trace.some(frame => frame.surface === 'loading:verify'
      || frame.surface === 'static:client-verify'), `${label}: BFCache return repaints neutral verification`);
    assert.ok(beforeStaleRelease.trace.some(frame => frame.surface === 'entry:retry'),
      `${label}: BFCache verifier 500 paints retry`);
    assert.equal(beforeStaleRelease.queue, originalQueueBytes, `${label}: BFCache denial preserves all debt bytes`);
    assert.deepEqual(beforeStaleRelease.queueReads, [], `${label}: BFCache denial still performs zero queue inspection`);
    assert.equal(beforeStaleRelease.staffOnly, staffOnlyBytes, `${label}: BFCache denial preserves staff-only debt bytes`);
    assert.equal(beforeStaleRelease.staffRunnerCalls, 0, `${label}: real persisted pageshow never invokes staff-only recovery`);
    assert.deepEqual(beforeStaleRelease.network.legacyQueueWrites, [], `${label}: BFCache denial starts no POST`);

    await run.page.evaluate(() => window.__syncviewReleaseBfcacheWriteUiReroute(1));
    await run.page.waitForFunction(() => (
      window.__syncviewBfcacheNetwork.writeUiRerouteReads[1]?.released === true
    ), null, { timeout: 10_000 });
    await run.page.waitForTimeout(150);
    const afterStaleRelease = await run.page.evaluate(key => ({
      state: document.querySelector('[data-client-entry-state]')?.getAttribute('data-client-entry-state') || '',
      queue: window.__syncviewReadStorageWithoutTrace(key),
      staffOnly: window.__syncviewReadStorageWithoutTrace('syncview_calCardJobs_v1'),
      queueReads: window.__syncviewObservedStorageReads.slice(),
      staffRunnerCalls: window.__syncviewF184StaffRunnerCalls,
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
    }), CALENDAR_LEGACY_OUTBOX_KEY);
    assert.equal(afterStaleRelease.state, 'retry', `${label}: stale routing completion cannot replace retry UI`);
    assert.equal(afterStaleRelease.queue, originalQueueBytes, `${label}: stale routing completion preserves exact queue bytes`);
    assert.deepEqual(afterStaleRelease.queueReads, [], `${label}: stale generation rechecks before queue inspection`);
    assert.equal(afterStaleRelease.staffOnly, staffOnlyBytes, `${label}: stale release preserves staff-only debt bytes`);
    assert.equal(afterStaleRelease.staffRunnerCalls, 0, `${label}: stale release cannot invoke staff-only recovery`);
    assert.deepEqual(afterStaleRelease.network.legacyQueueWrites, [], `${label}: stale generation rechecks before POST`);

    await run.page.evaluate(() => window.__syncviewResetBootTrace());
    await run.page.locator('[data-client-entry-state="retry"] button', { hasText: 'Try again' }).click();
    await run.page.waitForFunction(key => {
      const network = window.__syncviewBfcacheNetwork;
      let rows = [];
      try { rows = JSON.parse(window.__syncviewReadStorageWithoutTrace(key) || '[]'); } catch {}
      const rowA = rows.find(row => row && row.id === 'synthetic-f184-client-a');
      return network
        && network.verifierResponses.length === 4
        && network.verifierResponses[3].valid === true
        && network.legacyQueueWrites.length === 1
        && rowA
        && rowA.attempts === 1
        && _writeUiLegacyResumePromise === null;
    }, CALENDAR_LEGACY_OUTBOX_KEY, { timeout: 10_000 });
    await run.page.waitForFunction(expectedClient => (
      document.querySelector('#calView .cal-embed-title strong')?.textContent.trim() === expectedClient
    ), CLIENT_A, { timeout: 10_000 });
    await run.page.waitForFunction(() => (
      window.__syncviewBootTrace.some(frame => frame.surface === 'mounted:calendar')
    ), null, { timeout: 10_000 });
    const afterQueue500 = await run.page.evaluate(key => {
      const rows = JSON.parse(window.__syncviewReadStorageWithoutTrace(key) || '[]');
      return {
        snapshot: window.__syncviewBootSnapshot(),
        trace: window.__syncviewBootTrace.slice(),
        rows,
        staffOnly: window.__syncviewReadStorageWithoutTrace('syncview_calCardJobs_v1'),
        queueReads: window.__syncviewObservedStorageReads.slice(),
        staffRunnerCalls: window.__syncviewF184StaffRunnerCalls,
        network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
      };
    }, CALENDAR_LEGACY_OUTBOX_KEY);
    assert.equal(afterQueue500.snapshot.calendarVisible, true, `${label}: final strict retry mounts Calendar`);
    assert.equal(afterQueue500.snapshot.analyticsFlash, false, `${label}: final strict retry never flashes Analytics`);
    assert.ok(afterQueue500.trace.some(frame => frame.surface === 'static:client-verify'
      || frame.surface === 'loading:verify'), `${label}: final retry visibly returns through verification`);
    assert.ok(afterQueue500.trace.some(frame => frame.surface === 'mounted:calendar'),
      `${label}: final retry visibly settles on Calendar`);
    assert.equal(afterQueue500.network.legacyQueueWrites[0].status, 500,
      `${label}: matching A debt receives the injected retryable 500`);
    assert.equal(afterQueue500.network.legacyQueueWrites[0].body.issue, queueA.payload.issue,
      `${label}: only matching client A debt is posted`);
    assert.equal(afterQueue500.rows.find(row => row.id === queueA.id)?.attempts, 1,
      `${label}: A debt records its one failed attempt`);
    assert.equal(JSON.stringify(afterQueue500.rows.find(row => row.id === queueB.id)), foreignBytes,
      `${label}: foreign B debt remains byte-for-byte unchanged after A's 500`);
    assert.equal(JSON.stringify(afterQueue500.rows.find(row => row.id === unknownQueue.id)), unknownBytes,
      `${label}: unknown debt remains byte-for-byte unchanged after A's 500`);
    assert.equal(JSON.stringify(afterQueue500.rows.find(row => row.id === foreignGateQueue.id)), foreignGateBytes,
      `${label}: an A row with matching gate slug but foreign principal remains byte-for-byte unchanged after A's 500`);
    assert.equal(afterQueue500.staffOnly, staffOnlyBytes, `${label}: A's 500 preserves staff-only debt bytes`);
    assert.equal(afterQueue500.staffRunnerCalls, 0, `${label}: A's 500 never invokes staff-only recovery`);
    const finalVerifierAt = afterQueue500.network.verifierResponses[3].at;
    assert.ok(afterQueue500.queueReads.length > 0
      && afterQueue500.queueReads.every(read => read.at >= finalVerifierAt),
    `${label}: every observed queue read occurs after the exact final strict verdict`);
    assert.deepEqual(afterQueue500.queueReads.filter(read => read.key === CALENDAR_CARD_JOBS_KEY), [],
      `${label}: verified client recovery never reads staff-only Calendar job storage`);
    assert.deepEqual(await run.page.evaluate(() => window.__syncviewLegacyRetryTimeoutState()), [{
      delay: 60 * 1000,
      cleared: false,
      invoked: false,
    }], `${label}: retryable 500 arms the exact Calendar queue timeout`);

    const invokedScheduledRetry = await run.page.evaluate(() => (
      window.__syncviewInvokeLegacyRetryTimeout(0)
    ));
    assert.equal(invokedScheduledRetry, true, `${label}: the actual installed queue timeout is invoked`);
    await run.page.waitForFunction(key => {
      const network = window.__syncviewBfcacheNetwork;
      let rows = [];
      try { rows = JSON.parse(window.__syncviewReadStorageWithoutTrace(key) || '[]'); } catch {}
      return network.legacyQueueWrites.length === 2
        && rows.find(row => row && row.id === 'synthetic-f184-client-a')?.attempts === 2
        && window.__syncviewCapturedLegacyRetryTimeouts.length === 2
        && _writeUiLegacyResumePromise === null;
    }, CALENDAR_LEGACY_OUTBOX_KEY, { timeout: 10_000 });
    const afterScheduledRetry = await run.page.evaluate(key => ({
      rows: JSON.parse(window.__syncviewReadStorageWithoutTrace(key) || '[]'),
      staffOnly: window.__syncviewReadStorageWithoutTrace('syncview_calCardJobs_v1'),
      retryTimeouts: window.__syncviewLegacyRetryTimeoutState(),
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
    }), CALENDAR_LEGACY_OUTBOX_KEY);
    assert.equal(afterScheduledRetry.network.legacyQueueWrites[1].status, 500,
      `${label}: actual timeout callback drives the injected second retryable POST`);
    assert.equal(afterScheduledRetry.rows.find(row => row.id === queueA.id)?.attempts, 2,
      `${label}: scheduled callback records A's second failed attempt`);
    assert.equal(JSON.stringify(afterScheduledRetry.rows.find(row => row.id === queueB.id)), foreignBytes,
      `${label}: actual callback preserves B byte-for-byte`);
    assert.equal(JSON.stringify(afterScheduledRetry.rows.find(row => row.id === unknownQueue.id)), unknownBytes,
      `${label}: actual callback preserves unknown debt byte-for-byte`);
    assert.equal(JSON.stringify(afterScheduledRetry.rows.find(row => row.id === foreignGateQueue.id)), foreignGateBytes,
      `${label}: actual callback never posts or mutates foreign-principal source-gate debt`);
    assert.equal(afterScheduledRetry.staffOnly, staffOnlyBytes,
      `${label}: actual callback preserves staff-only debt bytes`);
    assert.deepEqual(afterScheduledRetry.retryTimeouts, [
      { delay: 60 * 1000, cleared: false, invoked: true },
      { delay: 60 * 1000, cleared: false, invoked: false },
    ], `${label}: failed scheduled retry arms one replacement timeout`);

    await run.page.evaluate(() => window.__syncviewResetBootTrace());
    await run.page.goto(`${awayOrigin}/boot-away`, { waitUntil: 'load', timeout: 15_000 });
    await run.page.waitForSelector('[data-boot-away]', { state: 'visible', timeout: 10_000 });
    const retryReturnRequestedDocument = await restoreFromBfcache(run.page, server, '/bfcache.html');
    await run.page.waitForFunction(key => {
      const network = window.__syncviewBfcacheNetwork;
      let rows = [];
      try { rows = JSON.parse(window.__syncviewReadStorageWithoutTrace(key) || '[]'); } catch {}
      return network.verifierResponses.length === 5
        && network.verifierResponses[4].valid === true
        && network.legacyQueueWrites.length === 3
        && !rows.some(row => row && row.id === 'synthetic-f184-client-a')
        && _writeUiLegacyResumePromise === null;
    }, CALENDAR_LEGACY_OUTBOX_KEY, { timeout: 10_000 });
    await run.page.waitForFunction(expectedClient => (
      document.querySelector('#calView .cal-embed-title strong')?.textContent.trim() === expectedClient
    ), CLIENT_A, { timeout: 10_000 });
    const cancelledRetryInvocation = await run.page.evaluate(() => ({
      invoked: window.__syncviewInvokeLegacyRetryTimeout(1),
      writes: window.__syncviewBfcacheNetwork.legacyQueueWrites.length,
    }));
    assert.equal(cancelledRetryInvocation.invoked, false,
      `${label}: pagehide purge makes the armed retry callback non-invocable`);
    assert.equal(cancelledRetryInvocation.writes, 3,
      `${label}: attempting the cancelled callback starts no fourth POST`);
    await run.page.waitForTimeout(100);
    const settled = await run.page.evaluate(key => ({
      snapshot: window.__syncviewBootSnapshot(),
      trace: window.__syncviewBootTrace.slice(),
      rows: JSON.parse(window.__syncviewReadStorageWithoutTrace(key) || '[]'),
      staffOnly: window.__syncviewReadStorageWithoutTrace('syncview_calCardJobs_v1'),
      staffRunnerCalls: window.__syncviewF184StaffRunnerCalls,
      storageReads: window.__syncviewObservedStorageReads.slice(),
      triggerMatrix: window.__syncviewF184TriggerMatrix.slice(),
      retryTimeouts: window.__syncviewLegacyRetryTimeoutState(),
      network: JSON.parse(JSON.stringify(window.__syncviewBfcacheNetwork)),
    }), CALENDAR_LEGACY_OUTBOX_KEY);
    assert.equal(retryReturnRequestedDocument, false,
      `${label}: retry cancellation is exercised by a real pagehide and BFCache return`);
    assert.equal(settled.network.legacyQueueWrites.length, 3,
      `${label}: pagehide cancellation prevents an extra POST before strict restore resumes once`);
    assert.equal(settled.network.legacyQueueWrites[2].status, 200,
      `${label}: the new strict restore owner receives success`);
    assert.deepEqual(settled.retryTimeouts, [
      { delay: 60 * 1000, cleared: false, invoked: true },
      { delay: 60 * 1000, cleared: true, invoked: false },
    ], `${label}: pagehide purge cancels the armed client retry timeout itself`);
    assert.deepEqual(settled.rows.map(row => row.id), [queueB.id, unknownQueue.id, foreignGateQueue.id],
      `${label}: success removes only A debt`);
    assert.equal(JSON.stringify(settled.rows[0]), foreignBytes, `${label}: B remains byte-for-byte unchanged after success`);
    assert.equal(JSON.stringify(settled.rows[1]), unknownBytes, `${label}: unknown remains byte-for-byte unchanged after success`);
    assert.equal(JSON.stringify(settled.rows[2]), foreignGateBytes,
      `${label}: foreign-principal source-gate debt remains byte-for-byte unchanged after success`);
    assert.equal(settled.staffOnly, staffOnlyBytes, `${label}: successful client retry preserves staff-only debt bytes`);
    assert.equal(settled.staffRunnerCalls, 0, `${label}: successful client retry never invokes staff-only recovery`);
    assert.deepEqual(settled.storageReads.filter(read => read.key === CALENDAR_CARD_JOBS_KEY), [],
      `${label}: all verified/retry/BFCache client phases leave staff-only storage unread`);
    assert.deepEqual(settled.triggerMatrix, [
      'startup',
      'focus',
      'online',
      'visibilitychange:visible',
      'timer:60000',
      'pageshow:persisted',
    ], `${label}: visible lane covers every installed automatic resume trigger`);
    assert.equal(settled.snapshot.calendarVisible, true, `${label}: queue retry does not disturb visible Calendar ownership`);
    assert.equal(settled.snapshot.analyticsFlash, false, `${label}: queue retry never introduces an Analytics flash`);
    assert.deepEqual(settled.network.unmocked, [], `${label}: all verifier, read, and retry traffic remains synthetic`);
    assertTruthfulTrace(settled.trace, label, { clientOwned: true });
    assert.deepEqual(run.consoleErrors, [], `${label}: browser console errors are not allowed`);
    assert.deepEqual(run.pageErrors, [], `${label}: uncaught page errors are not allowed`);
    passGroup(`${label} [startup/focus/online/visible/timer/pageshow.persisted]`);
  } finally {
    await run.context.close();
  }
}

async function main() {
  const server = await startStreamServer();
  let browser = null;
  const startedAt = Date.now();
  try {
    browser = await chromium.launch({
      headless: true,
      // Use the full Chromium build's modern headless mode. The separate
      // headless-shell embedder reports BackForwardCacheDisabledForDelegate.
      channel: 'chromium',
      // Playwright disables BFCache by default because a restored document can
      // bypass request interception. This lane explicitly guards that lifecycle,
      // so run with the browser's real Back/Forward Cache behavior enabled.
      ignoreDefaultArgs: ['--disable-back-forward-cache'],
      args: [
        '--no-sandbox',
        '--disable-gpu',
        // Defense in depth for the BFCache case after interception is removed:
        // no hostname except the two synthetic loopback hosts can resolve.
        '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1, EXCLUDE localhost',
      ],
    });
    await runStaffHistoryScenario(browser, server, 'calendar');
    await runStaffHistoryScenario(browser, server, 'brief');
    await runClientTabScenario(browser, server, 'calendar');
    await runClientTabScenario(browser, server, 'brief');
    await runBriefWorkTeardownScenario(browser, server);
    await runInvalidEntryMatrix(browser, server);
    await runVerifierBoundaryScenario(browser, server, {
      label: 'F102 legacy verifier contract rejection',
      network: { verifierShape: 'legacy-missing-contract' },
    });
    await runVerifierBoundaryScenario(browser, server, {
      label: 'F102 canonical display-name slug mismatch',
      network: { displayNameOverride: 'Mismatched Fixture Client' },
    });
    await runVerifierRetryScenario(browser, server, 408);
    await runVerifierRetryScenario(browser, server, 500);
    await runRotatedTokenReloadScenario(browser, server);
    await runRotatedTokenBfcacheScenario(browser, server);
    await runPendingAnalyticsBfcacheScenario(browser, server);
    await runPendingCalendarOwnershipScenario(browser, server);
    await runPendingSamplesBfcacheScenario(browser, server);
    await runLegacySamplesScenario(browser, server);
    await runStaffCalendarOwnedTailAndBfcacheScenario(browser, server);
    await runClientLegacyResumeLeaseScenario(browser, server);
    console.log(`SUMMARY ${passedGroups} scenario groups passed (${Date.now() - startedAt} ms, one attempt per navigation)`);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

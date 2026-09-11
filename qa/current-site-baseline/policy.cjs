'use strict';
// This is an endpoint/operation policy, never a generic GET exemption.
// No live write adapter, webhook, mutation RPC, or authentication bypass.
const fs = require('node:fs');
const path = require('node:path');
const READ_TABLES = new Set(['clients', 'team_members', 'syncview_runtime_flags',
  'calendar_posts', 'sample_reviews', 'templates', 'caption_prompts', 'deliverables',
  'batches', 'production_deliverables_browser_v1', 'production_deliverables_live_v2',
  'workload_issues']);
const SURFACES = ['client-calendar', 'client-samples', 'smm-calendar', 'kasper-review',
  'production', 'workload'];
const CDN = new Set([
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
]);
function outsideRepo(file, repo) {
  const actual = fs.realpathSync(file), root = fs.realpathSync(repo);
  const relative = path.relative(root, actual);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw Error('private_path_inside_repository');
  }
  return actual;
}
function validateConfig(c) {
  if (!c || c.version !== 1 || !Array.isArray(c.surfaces) || c.surfaces.length !== 6 ||
      new Set(c.surfaces.map(x => x.surface)).size !== 6 || !c.test ||
      typeof c.test.slug !== 'string' || !c.test.slug || typeof c.test.token !== 'string' || !c.test.token ||
      Object.keys(c).some(k => !['version', 'test', 'surfaces'].includes(k)) ||
      Object.keys(c.test).some(k => !['slug', 'token'].includes(k))) throw Error('invalid_config');
  for (const item of c.surfaces) {
    if (!SURFACES.includes(item.surface) || typeof item.url !== 'string') throw Error('invalid_surface');
    const u = new URL(item.url);
    if (u.protocol !== 'https:' || u.username || u.password) throw Error('invalid_entry');
    if (Object.keys(item).some(k => !['surface', 'url', 'storageState', 'authorizedPersona'].includes(k))) throw Error('invalid_surface');
    if (item.surface.startsWith('client-') && item.storageState) throw Error('client_must_be_anonymous');
    if (item.storageState && item.authorizedPersona !== true) throw Error('persona_not_attested');
  }
  return c;
}
function classify(request, policy) {
  let u;
  try { u = new URL(request.url); } catch { return 'blocked_invalid_url'; }
  const method = request.method;
  if (u.protocol !== 'https:' || u.username || u.password) return 'blocked_transport';
  if (/\/webhook(?:-test)?\//i.test(u.pathname)) return 'blocked_webhook';
  if (u.origin === policy.backend && u.pathname === '/functions/v1/client-token-verify') {
    // Explicitly authorized ordinary access-audit event. Exact current TEST
    // selector/token only, strict normal UI verification; never mint/rotate.
    if (method === 'OPTIONS') return 'read_verifier_preflight';
    let b;
    try { b = JSON.parse(request.body); } catch { return 'blocked_verifier_payload'; }
    const keys = Object.keys(b);
    const allowedKeys = ['slug', 'client_slug', 'client', 'token', 'view', 'strict'];
    const client = b.slug || b.client_slug || b.client;
    if (method === 'POST' && policy.test && client === policy.test.slug &&
        b.token === policy.test.token && b.strict === true &&
        ['calendar', 'sample-reviews', 'samples'].includes(b.view) &&
        keys.every(k => allowedKeys.includes(k))) return 'read_verifier_with_access_audit';
    return 'blocked_verifier_payload';
  }
  if (!['GET', 'HEAD'].includes(method)) return 'blocked_method';
  if (u.origin === policy.site && policy.staticPaths.has(u.pathname)) return 'read_pages_asset';
  if (u.origin === policy.backend) {
    const match = /^\/rest\/v1\/([a-z0-9_]+)$/.exec(u.pathname);
    if (match && READ_TABLES.has(match[1])) return 'read_relation_' + match[1];
    return 'blocked_backend_endpoint';
  }
  if (CDN.has(u.href)) return 'read_cdn_asset';
  if (u.origin === 'https://fonts.googleapis.com' && u.pathname === '/css2') return 'read_font_css';
  if (u.origin === 'https://fonts.gstatic.com' && /^\/s\/[a-z0-9/._-]+\.woff2?$/i.test(u.pathname)) return 'read_font_asset';
  if (u.origin === 'https://lh3.googleusercontent.com' && /^\/d\/[a-zA-Z0-9_-]+(?:=.*)?$/.test(u.pathname)) return 'read_media';
  if (u.origin === 'https://docs.google.com' && u.pathname === '/spreadsheets/d/' + policy.sheet + '/gviz/tq' &&
      [...u.searchParams.keys()].every(k => ['tqx', 'sheet', 'gid', 'headers', 'tq', '_', '_t', 't'].includes(k)) &&
      (!u.searchParams.has('tq') || /^select\b/i.test(u.searchParams.get('tq')))) return 'read_sheet_csv';
  return 'blocked_unreviewed_endpoint';
}
function browserEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) =>
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|HOME|DISPLAY|LANG)$/i.test(k)));
}
// Chromium keepalive/beacon requests can escape Playwright routing. Intercept
// these transport APIs before product scripts, in every frame. Returning false
// intentionally exposes failure; the product's keepalive fallback is denied too.
function installTransportGuards() {
  const blocked = kind => console.debug('__baseline_blocked_' + kind + '__');
  Object.defineProperty(Navigator.prototype, 'sendBeacon', { configurable: false, writable: false,
    value: function () { blocked('beacon'); return false; } });
  const nativeFetch = window.fetch.bind(window);
  Object.defineProperty(window, 'fetch', { configurable: false, writable: false, value: function (input, init) {
    if ((init && init.keepalive) || (input instanceof Request && input.keepalive)) {
      blocked('keepalive'); return Promise.reject(new TypeError('baseline_transport_blocked'));
    }
    return nativeFetch(input, init);
  } });
  for (const name of ['WebTransport', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'Worker', 'SharedWorker']) {
    if (name in window) Object.defineProperty(window, name, { configurable: false, writable: false,
      value: function () { blocked('unsupported_transport'); throw new TypeError('baseline_transport_blocked'); } });
  }
}
async function forwardRead(route, outcome) {
  // Playwright continue() does not re-route redirect hops. Fetch only the
  // reviewed URL, with TLS verification intact, and refuse every redirect.
  try {
    const response = await route.fetch({ maxRedirects: 0, timeout: 20000 });
    if (response.status() >= 300 && response.status() < 400) {
      outcome('blocked_redirect');
      return await route.abort('blockedbyclient');
    }
    await route.fulfill({ response });
  } catch {
    outcome('read_transport_failed');
    await route.abort('failed').catch(() => {});
  }
}
function assessReport(report) {
  const failures = [];
  const rows = Array.isArray(report.rows) ? report.rows : [];
  for (const row of rows) {
    for (const [view, display] of [['landing', row.display], ['sheet', row.sheetDisplay]]) {
      if (display?.horizontalOverflow) failures.push({ surface: row.surface, width: row.viewport.width, view, code: 'horizontal_overflow' });
    }
    if (row.outcomes?.javascript_error) failures.push({ surface: row.surface, width: row.viewport.width, code: 'javascript_error' });
  }
  // Completion and health are separate. A finished finite pass can be red and
  // auth-blocked; zero failures without all six surfaces is not a health pass.
  const complete = rows.length === 12 && SURFACES.every(surface =>
    [1440, 390].every(width => rows.some(r => r.surface === surface && r.viewport?.width === width)));
  return { evidence: 'LIVE_READ', complete, failures,
    authenticatedGaps: rows.filter(r => r.coverage === 'BLOCKED_AUTH').length,
    verdict: failures.length ? 'FAIL' : 'UNPROVEN', wholeSiteHealthy: false };
}
module.exports = { classify, validateConfig, outsideRepo, browserEnv, installTransportGuards, forwardRead, assessReport, SURFACES };

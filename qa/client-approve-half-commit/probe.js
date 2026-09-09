'use strict';
/* REPLICATION HARNESS for the half-committed client approve.
 * Fingerprint measured live on card p_mrb65aeu_cjq0m 2026-09-09:
 *   (1) the deliverable moved to approved on the server
 *   (2) the calendar row's <comp>_status stayed at "Client Approval"
 *   (3) client_<comp>_approved_at stayed null
 * A candidate cause only counts if it reproduces ALL THREE. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
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

const SLUG = 'sidneylaruel';
const CARD = 'p_probe_card_1';
const VID = 'del_probe_video_1';

async function run(faultName, fault) {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const gatewayCommits = [];      // leg 1: what the server accepted
  const upserts = [];             // leg 2: what reached calendar_posts
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));

  await page.addInitScript(() => localStorage.setItem('syncview_auth_v1', 'ok'));
  if (fault.initScript) await page.addInitScript(fault.initScript);

  await page.route('**/functions/v1/key-verify', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, role: 'admin', member: { id: 'admin', name: 'Probe Admin', role: 'admin', team: 'graphics' } }) }));
  await page.route('**/functions/v1/filming-plans**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, plans: [] }) }));
  await page.route('**/webhook/linear-projects', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [] }) }));
  await page.route('**/functions/v1/production-comments', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ comments: [], next_cursor: null, has_more: false, canonical_thread: true }) }));

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop();
    let rows = [];
    if (table === 'clients') rows = [{ slug: SLUG, display_name: 'Probe Client', kind: 'person', active: true }];
    else if (table === 'syncview_runtime_flags') {
      const rawKey = String(url.searchParams.get('key') || '');
      const keys = /^in\.\(/.test(rawKey) ? rawKey.replace(/^in\.\(/, '').replace(/\)$/, '').split(',').map(s => s.trim())
        : [rawKey.replace(/^eq\./, '')];
      rows = keys.map(key => ({ key, value: key === 'write_ui_reroute_clients' ? { clients: [SLUG] }
        : key === 'linear_authority' ? { video: 'syncview', graphics: 'syncview' } : { video: 'syncview', graphics: 'syncview' } }));
    }
    else if (table === 'calendar_posts') rows = [];
    else if (table === 'deliverables') rows = [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });

  await page.route('**/functions/v1/production-write', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    // The server COMMITS first, exactly as it did live at 19:18:09.
    gatewayCommits.push({ operation: body.operation, status: body.status, entity_id: body.entity_id });
    if (fault.gateway === 'drop-response') return route.abort('connectionfailed');
    if (fault.gateway === 'drop-first' && gatewayCommits.length === 1) return route.abort('connectionfailed');
    if (fault.gateway === 'error-after-commit') {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'entity_lookup_unavailable' }) });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, native_committed: true, authority: 'syncview', complete: true,
      row: { id: VID, status: body.status, updated_at: new Date().toISOString(), client_slug: SLUG, team: 'video' },
    }) });
  });

  await page.route(/calendar-upsert/, async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    upserts.push(body.post || {});
    if (fault.upsert === 'fail') return route.fulfill({ status: 500, contentType: 'text/html', body: 'boom' });
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, post: Object.assign({ updated_at: new Date().toISOString() }, body.post) }) });
  });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window._calReviewApplyApprove === 'function'
    && typeof calState !== 'undefined', null, { timeout: 25000 });

  if (fault.resume) await page.evaluate(() => { window.__probeResume = true; });
  await page.evaluate(() => {
    _syncviewStaffIdentitySave({ key: 'probe-role-key', role: 'admin', member: { id: 'admin', name: 'Probe Admin', role: 'admin', team: 'graphics' } });
    _syncviewAcceptStaffVerification();
    _syncviewStaffRefreshChrome();
  });

  const result = await page.evaluate(async ({ slug, card, vid }) => {
    calState.client = slug;
    calState.view = 'sheet';
    calState.posts = [{
      id: card, name: 'Probe 1', client: slug,
      status: 'Client Approval', video_status: 'Client Approval',
      graphic_status: 'Approved', caption_status: 'Approved', title_status: '',
      video_deliverable_id: vid,
      linear_issue_id: 'https://linear.app/x/issue/VID-1/probe',
      asset_url: 'https://drive.google.com/file/d/probe/view',
      caption: 'probe caption', updated_at: new Date().toISOString(),
      client_video_approved_at: '', client_graphic_approved_at: '', client_caption_approved_at: '',
    }];
    window._calPendingEdits = window._calPendingEdits || {};
    try { window._calReviewApplyApprove(card, 'video'); } catch (e) { return { threw: String(e && e.message) }; }
    await new Promise(r => setTimeout(r, 2500));
    if (window.__probeResume) {
      // Does the durable repair journal finish the abandoned second leg?
      try { await window._writeUiResumeSourceRepairs(); } catch (e) {}
      await new Promise(r => setTimeout(r, 2500));
    }
    const post = calState.posts.find(p => p.id === card) || {};
    return {
      video_status: post.video_status,
      client_video_approved_at: post.client_video_approved_at || null,
      saveError: post._saveError || null,
      retrySourceAt: post._writeUiRetrySourceAt || null,
    };
  }, { slug: SLUG, card: CARD, vid: VID });

  await browser.close(); server.close();
  return { faultName, gatewayCommits, upserts, result, errors };
}

/* The live fingerprint this harness exists to reproduce, measured on card
   p_mrb65aeu_cjq0m 2026-09-09. A candidate cause counts only if all three hold:
     committed  - the gateway accepted the status (leg 1)
     stale      - no calendar_posts write carried it (leg 2 never happened)
     unstamped  - client_<comp>_approved_at never reached the source row
   Plus the behaviour the client reported: the card falls back to
   "Awaiting your approval" with a live Approve button, which is what produced
   the repeat clicks and (before the 2026-09-09 gateway fix) the
   operation_forbidden accusation. */
function fingerprint(out) {
  const committed = out.gatewayCommits.length > 0;
  const stale = out.upserts.length === 0;
  const unstamped = !out.upserts.some(u => u && u.client_video_approved_at);
  const looksUnapprovedToClient = out.result.video_status === 'Client Approval';
  return { committed, stale, unstamped, looksUnapprovedToClient,
    matchesLive: committed && stale && unstamped && looksUnapprovedToClient };
}

(async () => {
  const cases = [
    ['baseline (no fault)', {}],
    ['A: gateway response lost', { gateway: 'drop-response' }],
    ['B: browser storage refuses the checkpoint', { initScript: () => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).indexOf('cal') !== -1) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
        return real.call(this, k, v);
      };
    } }],
    ['C: calendar upsert rejects', { upsert: 'fail' }],
    ['A2: first response lost, network back, journal resumes', { gateway: 'drop-first', resume: true }],
    ['B2: storage refused, then the repair journal resumes', { resume: true, initScript: () => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).indexOf('cal') !== -1) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
        return real.call(this, k, v);
      };
    } }],
  ];
  const verdicts = [];
  for (const [name, fault] of cases) {
    try {
      const out = await run(name, fault);
      verdicts.push([name, fingerprint(out)]);
      console.log('\n=== ' + name);
      console.log('  leg 1 gateway commits :', JSON.stringify(out.gatewayCommits));
      console.log('  leg 2 calendar upserts:', out.upserts.length,
        out.upserts.map(u => JSON.stringify({ video_status: u.video_status, stamp: u.client_video_approved_at })).join(' '));
      console.log('  card after            :', JSON.stringify(out.result));
      if (out.errors.length) console.log('  page errors           :', out.errors.slice(0, 2));
    } catch (e) {
      console.log('\n=== ' + name + '\n  HARNESS ERROR: ' + e.message.slice(0, 300));
      process.exitCode = 1;
    }
  }
  console.log('\n--- which faults reproduce the live fingerprint');
  verdicts.forEach(([name, f]) => console.log('  ' + (f.matchesLive ? 'REPRODUCES' : 'no        ') + '  ' + name));
  const reproducing = verdicts.filter(([, f]) => f.matchesLive).map(([name]) => name);
  console.log('\nreproducing faults: ' + (reproducing.length ? reproducing.join('; ') : 'none'));
  /* GUARD. Once the ambiguous-transport fix is in place no fault may reproduce
     the live fingerprint: a lost response must leave the card showing the
     approval, keep the sign-off stamp, and arm the repair that finishes leg 2.
     A fault reappearing here is that regression, not a flake. */
  if (reproducing.length) {
    console.error('\nFAIL: the half-commit fingerprint is reachable again via: ' + reproducing.join('; '));
    process.exitCode = 1;
  } else {
    console.log('PASS: no injected fault leaves a committed approve invisible to the client');
  }
})();

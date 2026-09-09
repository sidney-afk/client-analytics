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
  const reconcileReads = [];      // the authenticated "did it commit?" reads
  let nativeStatus = 'client_approval';   // what the canonical row currently holds
  /* Nobody has touched this row since long before the attempt, which is the
     honest shape of a pre-server failure: an hour-old clock cannot 'prove
     current' against a write issued seconds ago, so the reconcile must not
     mistake an untouched row for one somebody else moved. */
  let nativeStatusAt = new Date(Date.now() - 3600 * 1000).toISOString();
  let preServerHealed = false;    // flipped when the pre-server outage ends
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
    else if (table === 'deliverables' || table === 'production_deliverables_browser_v1') {
      // The canonical row the replay reads to decide whether anything moved.
      // On the pre-server path nothing did, so it still reads client_approval.
      rows = [{ id: VID, card_id: CARD, client_slug: SLUG, team: 'video', origin: 'calendar',
        status: nativeStatus, status_at: nativeStatusAt, updated_at: nativeStatusAt }];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });

  await page.route('**/functions/v1/production-write', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    /* PRE-SERVER failures record nothing: the request never reached the
       server, so treating it as a commit is exactly the masking Codex named on
       #1373. Only a request the server actually processes is pushed here. */
    if (fault.gateway === 'pre-server' && !preServerHealed) return route.abort('connectionfailed');
    // A reconcile-only read is the authenticated proof of what committed. On
    // the pre-server path nothing did, so it answers `absent`, which is what
    // the replay needs in order to reissue rather than give up.
    if (body.reconcile_only === true) {
      reconcileReads.push(String(body.operation || ''));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true, outcome: 'absent',
        row: { id: VID, card_id: CARD, client_slug: SLUG, team: 'video', status: 'client_approval', updated_at: new Date().toISOString() },
      }) });
    }
    // The server COMMITS first, exactly as it did live at 19:18:09.
    gatewayCommits.push({ operation: body.operation, status: body.status, entity_id: body.entity_id });
    if (body.operation === 'status' && body.status) { nativeStatus = String(body.status); nativeStatusAt = new Date().toISOString(); }
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
  if (fault.healBeforeResume) await page.evaluate(() => { window.__probeHealBeforeResume = true; });
  await page.exposeFunction('__probeHealNow', () => { preServerHealed = true; });
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
    if (window.__probeHealBeforeResume) { window.__probeHealNow && window.__probeHealNow(); await new Promise(r => setTimeout(r, 200)); }
    if (window.__probeResume) {
      // Does the durable repair journal finish the abandoned second leg?
      try { await window._writeUiResumeSourceRepairs(); } catch (e) { window.__probeResumeError = String(e && (e.code || e.message)); }
      await new Promise(r => setTimeout(r, 2500));
    }
    const post = calState.posts.find(p => p.id === card) || {};
    return {
      video_status: post.video_status,
      client_video_approved_at: post.client_video_approved_at || null,
      saveError: post._saveError || null,
      retrySourceAt: post._writeUiRetrySourceAt || null,
      resumeError: window.__probeResumeError || null,
    };
  }, { slug: SLUG, card: CARD, vid: VID });

  await browser.close(); server.close();
  return { faultName, gatewayCommits, upserts, reconcileReads, result, errors };
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
    ['D: gateway answers 5xx after committing', { gateway: 'error-after-commit' }],
    ['A2: first response lost, network back, journal resumes', { gateway: 'drop-first', resume: true }],
    ['A3: request never reached the server, network back, journal resumes', { gateway: 'pre-server', resume: true, healBeforeResume: true }],
    ['B2: storage refused, then the repair journal resumes', { resume: true, initScript: () => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).indexOf('cal') !== -1) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
        return real.call(this, k, v);
      };
    } }],
  ];
  const verdicts = [];
  const results = [];
  for (const [name, fault] of cases) {
    try {
      const out = await run(name, fault);
      verdicts.push([name, fingerprint(out)]);
      results.push(out);
      console.log('\n=== ' + name);
      console.log('  leg 1 gateway commits :', JSON.stringify(out.gatewayCommits));
      console.log('  reconcile receipt reads:', out.reconcileReads.length);
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
  console.log('reproducing faults: ' + (reproducing.length ? reproducing.join('; ') : 'none'));

  /* PER-CASE CONTRACTS, not just the fingerprint.
     `matchesLive` alone is too weak to protect anything: a case whose recovery
     is broken can leave leg 1 empty and score `no` for the wrong reason, so the
     summary would print PASS with the behaviour gone. Codex made exactly that
     point on PR 1373 and it was right. Each case now states what must be true. */
  const failures = [];
  const expect = (name, cond, why) => { if (!cond) failures.push(name + ': ' + why); };
  const by = name => (results.find(r => r.faultName.startsWith(name)) || null);

  const base = by('baseline');
  expect('baseline', base && base.gatewayCommits.length === 1 && base.upserts.length === 1
    && base.upserts[0].client_video_approved_at && base.result.video_status === 'Approved' && !base.result.saveError,
    'a clean approve must commit both legs, stamp the sign-off and show no error');

  const a = by('A: gateway response lost');
  expect('A', a && a.gatewayCommits.length > 0 && a.upserts.length === 0
    && a.result.video_status === 'Approved' && a.result.client_video_approved_at && a.result.retrySourceAt,
    'a committed-but-lost response must KEEP the approval and arm the repair, never roll the card back to Client Approval');

  const a2 = by('A2');
  expect('A2', a2 && a2.upserts.length === 1 && a2.upserts[0].video_status === 'Approved'
    && a2.upserts[0].client_video_approved_at && !a2.result.saveError && !a2.result.retrySourceAt,
    'once connectivity returns the repair must finish leg 2 with the right status and stamp, and clear the debt');

  /* A3 IS THE KNOWN GAP, ASSERTED SO IT CANNOT DRIFT SILENTLY.
     A request that died before reaching the server is resolvable only with a
     CAS the Calendar/SXR status lane does not carry (the gateway requires
     expected_status / expected_updated_at on the `production` surface only), so
     replaying it here could overwrite a status somebody else set in between.
     Until the server-side reconciler exists this case must resolve to: nothing
     reached the server, leg 2 correctly did not happen, the debt is retained by
     name, and the client is told it is NOT confirmed rather than being handed a
     control that would refuse them. If any of that changes, this fails. */
  /* A 5xx cannot prove the transaction did not commit, so it must take the
     ambiguous path too. This fault was DEFINED in the harness and never run,
     which is how it went unnoticed; running it is the point. */
  const d = by('D');
  expect('D', d && d.gatewayCommits.length > 0 && d.result.video_status === 'Approved'
    && d.result.retrySourceAt && /Not confirmed/.test(String(d.result.saveError || '')),
    'a 5xx after a commit must keep the approval and arm the repair, never roll back and re-arm Approve');

  const a3 = by('A3');
  expect('A3', a3 && a3.gatewayCommits.length === 0 && a3.upserts.length === 0
    && a3.reconcileReads.length === 1
    && String(a3.result.resumeError || '') === 'status_reapply_required'
    && a3.result.video_status === 'Approved'
    && /Not confirmed/.test(String(a3.result.saveError || '')),
    'a never-sent write must check its receipt, retain the debt by name, and say NOT confirmed (the open gap, held explicit)');

  if (reproducing.length) failures.push('the half-commit fingerprint is reachable again via: ' + reproducing.join('; '));
  if (failures.length) {
    console.error('\nFAIL');
    failures.forEach(f => console.error('  ' + f));
    process.exitCode = 1;
  } else {
    console.log('PASS: every recovery contract holds, and no fault leaves a committed approve invisible to the client');
  }
})();

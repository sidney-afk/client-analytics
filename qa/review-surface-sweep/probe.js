'use strict';
/* REVIEW-SURFACE FAULT SWEEP
 *
 * OPEN_REPAIRS 186/189 established one shape: a review action writes TWO legs
 * (the gateway's deliverable row, then the calendar_posts row the humans read),
 * and when the second leg is abandoned the screen and the server disagree with
 * nobody able to tell. That was found on ONE action (a client approve) by one
 * client noticing. This asks the same question of every review action on every
 * surface, so the next one is found by us and not by a client.
 *
 * Every combination is scored on two questions:
 *   AGREE    -- do the server and the source row end up saying the same thing?
 *   TRUTHFUL -- is what the person is left looking at true?
 * A run can agree and still lie (an optimistic card the server never received),
 * and can disagree honestly (a visible failure with the debt retained).
 */
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
const CARD = 'p_sweep_card_1';
const VID = 'del_sweep_video_1';

/* WHO is acting. `_calReviewMode()` returns 'client' for any view that is not
   'smmreview', so both real surfaces are reachable from one boot. A real
   tokened client link additionally hits `_isClientLink` gates that this cannot
   set from a staff boot -- recorded as a known limit in the README, not
   papered over. */
const ACTORS = [
  { key: 'client', view: 'sheet', start: 'Client Approval' },
  { key: 'smm', view: 'smmreview', start: 'For SMM Approval' },
];

/* WHAT they do. Each drives the real handler the button calls. */
const ACTIONS = [
  { key: 'approve', run: (pid, comp, actor) => actor === 'smm'
      ? window._calReviewApplyApprove(pid, comp, 'kasper')
      : window._calReviewApplyApprove(pid, comp) },
  { key: 'approve-to-client', smmOnly: true, run: (pid, comp) => window._calReviewApplyApprove(pid, comp, 'client') },
  { key: 'request-change', run: (pid, comp) => {
      window._calReviewState.drafts[pid + '|' + comp] = 'Please tighten the opening.';
      return window._calReviewRequestTweak(pid, comp);
    } },
  { key: 'comment', run: (pid, comp) => {
      window._calReviewState.drafts[pid + '|' + comp] = 'One question about the hook.';
      return window._calReviewComment(pid, comp);
    } },
];

/* WHAT GOES WRONG. The same four the approve replication used, because those
   are the ones a real network and a real browser actually produce. */
const FAULTS = [
  { key: 'none' },
  { key: 'response-lost', gateway: 'drop' },
  { key: '5xx-after-commit', gateway: '5xx' },
  { key: 'never-sent', gateway: 'pre-server' },
  { key: 'source-write-rejected', upsert: 'fail' },
];

async function run(actor, action, fault) {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const gatewayCommits = [];
  const upserts = [];
  const errors = [];
  let nativeStatus = actor.key === 'smm' ? 'smm_approval' : 'client_approval';
  let nativeStatusAt = new Date(Date.now() - 3600 * 1000).toISOString();
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));

  await page.addInitScript(() => localStorage.setItem('syncview_auth_v1', 'ok'));
  await page.route('**/functions/v1/key-verify', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, role: 'admin', member: { id: 'admin', name: 'Sweep Admin', role: 'admin', team: 'graphics' } }) }));
  await page.route('**/functions/v1/filming-plans**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, plans: [] }) }));
  await page.route('**/webhook/linear-projects', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [] }) }));
  await page.route('**/functions/v1/production-comments', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ comments: [], next_cursor: null, has_more: false, canonical_thread: true }) }));

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop();
    let rows = [];
    if (table === 'clients') rows = [{ slug: SLUG, display_name: 'Sweep Client', kind: 'person', active: true }];
    else if (table === 'syncview_runtime_flags') {
      const raw = String(url.searchParams.get('key') || '');
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',').map(s => s.trim())
        : [raw.replace(/^eq\./, '')];
      rows = keys.map(key => ({ key, value: key === 'write_ui_reroute_clients' ? { clients: [SLUG] } : { video: 'syncview', graphics: 'syncview' } }));
    }
    else if (table === 'deliverables' || table === 'production_deliverables_browser_v1') {
      rows = [{ id: VID, card_id: CARD, client_slug: SLUG, team: 'video', origin: 'calendar',
        status: nativeStatus, status_at: nativeStatusAt, updated_at: nativeStatusAt }];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });

  await page.route('**/functions/v1/production-write', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (fault.gateway === 'pre-server') return route.abort('connectionfailed');
    if (body.reconcile_only === true) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true, outcome: 'absent',
        row: { id: VID, card_id: CARD, client_slug: SLUG, team: 'video', status: nativeStatus, updated_at: new Date().toISOString() } }) });
    }
    // The server COMMITS here. Anything after this point is the answer failing
    // to arrive, never the write failing to happen.
    gatewayCommits.push({ operation: body.operation, status: body.status || null });
    if (body.operation === 'status' && body.status) { nativeStatus = String(body.status); nativeStatusAt = new Date().toISOString(); }
    if (fault.gateway === 'drop') return route.abort('connectionfailed');
    if (fault.gateway === '5xx') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'entity_lookup_unavailable' }) });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, native_committed: true, authority: 'syncview', complete: true,
      row: { id: VID, status: nativeStatus, updated_at: new Date().toISOString(), client_slug: SLUG, team: 'video' } }) });
  });

  await page.route(/calendar-upsert/, async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    upserts.push(body.post || {});
    if (fault.upsert === 'fail') return route.fulfill({ status: 500, contentType: 'text/html', body: 'boom' });
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, post: Object.assign({ updated_at: new Date().toISOString() }, body.post) }) });
  });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window._calReviewApplyApprove === 'function' && typeof calState !== 'undefined', null, { timeout: 25000 });
  await page.evaluate(() => {
    _syncviewStaffIdentitySave({ key: 'sweep-role-key', role: 'admin', member: { id: 'admin', name: 'Sweep Admin', role: 'admin', team: 'graphics' } });
    _syncviewAcceptStaffVerification();
    _syncviewStaffRefreshChrome();
  });

  const result = await page.evaluate(async ({ slug, card, vid, view, start, actionKey, actorKey }) => {
    calState.client = slug;
    calState.view = view;
    calState.posts = [{
      id: card, name: 'Sweep 1', client: slug,
      status: start, video_status: start, graphic_status: 'Approved', caption_status: 'Approved', title_status: '',
      video_deliverable_id: vid,
      linear_issue_id: 'https://linear.app/x/issue/VID-1/sweep',
      asset_url: 'https://drive.google.com/file/d/sweep/view',
      thumbnail_url: 'https://drive.google.com/file/d/sweepthumb/view',
      caption: 'sweep caption', updated_at: new Date().toISOString(),
      video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]',
      client_video_approved_at: '', client_graphic_approved_at: '', client_caption_approved_at: '',
    }];
    /* `_calReviewState` and `_calPendingEdits` are script-scope bindings, NOT
       window properties: assigning `window._calReviewState` creates a second
       object the app never reads, and the first run of this sweep did exactly
       that, so every comment and change-request row reported a clean result for
       an action that never ran. Bare identifiers reach the real ones. */
    const draftKey = card + '|video';
    const ACTIONS = {
      'approve': () => actorKey === 'smm' ? _calReviewApplyApprove(card, 'video', 'kasper') : _calReviewApplyApprove(card, 'video'),
      'approve-to-client': () => _calReviewApplyApprove(card, 'video', 'client'),
      'request-change': () => { _calReviewState.drafts[draftKey] = 'Please tighten the opening.'; return _calReviewRequestTweak(card, 'video'); },
      'comment': () => { _calReviewState.drafts[draftKey] = 'One question about the hook.'; return _calReviewComment(card, 'video'); },
    };
    let threw = null;
    try { await ACTIONS[actionKey](); } catch (e) { threw = String(e && (e.code || e.message)).slice(0, 80); }
    await new Promise(r => setTimeout(r, 2600));
    const post = calState.posts.find(p => p.id === card) || {};
    return {
      threw,
      /* A run that wrote NOTHING anywhere is a harness failure, not a passing
         case. Recorded so the summary can refuse to score it. */
      touchedAnything: !!(post._saveError || post._writeUiRetrySourceAt
        || String(post.video_tweaks || '[]') !== '[]' || post.video_status !== start),
      uiStatus: post.video_status,
      uiTweaks: String(post.video_tweaks || '').length > 2,
      saveError: post._saveError || null,
      retryArmed: !!post._writeUiRetrySourceAt,
    };
  }, { slug: SLUG, card: CARD, vid: VID, view: actor.view, start: actor.start, actionKey: action.key, actorKey: actor.key });

  await browser.close(); server.close();
  return { actor: actor.key, action: action.key, fault: fault.key, gatewayCommits, upserts, nativeStatus, result, errors };
}

/* The two questions, answered mechanically.
   The status vocabularies differ by design: the gateway speaks
   `kasper_approval`, the card speaks `Kasper Approval`. The first version of
   this scorer compared them with a naive underscore swap and flagged
   `tweak` vs `Tweaks Needed` as a disagreement, which is a bug in the scorer,
   not in the app. Use the app's own mapping. */
const NATIVE_TO_CARD = {
  smm_approval: 'For SMM Approval', kasper_approval: 'Kasper Approval',
  client_approval: 'Client Approval', tweak: 'Tweaks Needed', approved: 'Approved',
  scheduled: 'Scheduled', posted: 'Posted', in_progress: 'In Progress', todo: 'In Progress', backlog: 'In Progress',
};
function score(out) {
  const lastUpsert = out.upserts.length ? out.upserts[out.upserts.length - 1] : null;
  const sheetStatus = lastUpsert && lastUpsert.video_status ? String(lastUpsert.video_status) : null;
  const serverMoved = out.gatewayCommits.some(c => c.operation === 'status');
  const expectedCard = NATIVE_TO_CARD[String(out.nativeStatus)] || String(out.nativeStatus);

  // A plain comment never reaches the gateway on this path: it writes the
  // card's tweaks column only. Gateway faults are inapplicable, so the
  // status question does not apply either.
  const gatewayInvolved = out.action !== 'comment';

  // AGREE: what the server ended up holding is what the source row carries.
  // A status the server never took is agreement only if the sheet did not take
  // it either.
  const agree = !gatewayInvolved ? true
    : serverMoved ? (sheetStatus !== null && sheetStatus === expectedCard)
    : (sheetStatus === null || sheetStatus === expectedCard);

  // TRUTHFUL: the reader is not left looking at work that did not happen. An
  // optimistic card is truthful when the work committed, or when it is visibly
  // owed (an error shown, or a repair armed to finish it).
  const ui = String(out.result.uiStatus || '');
  const startStatus = out.actor === 'smm' ? 'For SMM Approval' : 'Client Approval';
  const moved = ui !== startStatus;
  const backed = serverMoved || out.result.retryArmed || !!out.result.saveError || !gatewayInvolved;
  const truthful = !moved || backed;

  return { agree, truthful, sheetStatus, serverStatus: out.nativeStatus, ui, gatewayInvolved };
}

(async () => {
  const rows = [];
  for (const actor of ACTORS) {
    for (const action of ACTIONS) {
      if (action.smmOnly && actor.key !== 'smm') continue;
      for (const fault of FAULTS) {
        let out;
        try { out = await run(actor, action, fault); }
        catch (e) { rows.push({ actor: actor.key, action: action.key, fault: fault.key, harnessError: e.message.slice(0, 120) }); continue; }
        const inert = fault.key === 'none' && !out.gatewayCommits.length && !out.upserts.length && !out.result.touchedAnything;
        if (inert) { rows.push({ actor: actor.key, action: action.key, fault: fault.key, harnessError: 'control run wrote nothing: the action did not execute' }); continue; }
        out.action = action.key; out.actor = actor.key;
        rows.push(Object.assign({ actor: actor.key, action: action.key, fault: fault.key }, score(out), {
          commits: out.gatewayCommits.length, upserts: out.upserts.length,
          saveError: out.result.saveError ? 'yes' : 'no', retryArmed: out.result.retryArmed ? 'yes' : 'no',
          threw: out.result.threw, pageErrors: out.errors.length,
        }));
      }
    }
  }
  console.log('\nactor    action             fault                  agree truthful  server->sheet');
  rows.forEach(r => {
    if (r.harnessError) { console.log(`${r.actor.padEnd(8)} ${r.action.padEnd(18)} ${r.fault.padEnd(22)} HARNESS ERROR: ${r.harnessError}`); return; }
    console.log(`${r.actor.padEnd(8)} ${r.action.padEnd(18)} ${r.fault.padEnd(22)} ${(r.agree ? 'yes' : 'NO ').padEnd(5)} ${(r.truthful ? 'yes' : 'NO ').padEnd(8)}  ${String(r.serverStatus).padEnd(16)} -> ${String(r.sheetStatus)}   ui=${r.ui} err=${r.saveError} repair=${r.retryArmed}`);
  });
  const bad = rows.filter(r => !r.harnessError && (!r.agree || !r.truthful));
  console.log('\ncombinations run: ' + rows.length + ', flagged: ' + bad.length);
  bad.forEach(r => console.log('  FLAG  ' + [r.actor, r.action, r.fault].join(' / ') + (r.agree ? '' : '  [server and sheet disagree]') + (r.truthful ? '' : '  [screen shows something unbacked]')));
  fs.writeFileSync(path.join(__dirname, 'last-run.json'), JSON.stringify(rows, null, 1));
})();

// p36 — CAPSTONE: a video component (with a Linear sub-issue) driven through the full review
// lifecycle by all three actors, asserting at EVERY step that the status is consistent across:
//   (a) the database (Supabase row), (b) the Kasper queue, (c) the client surface,
//   (d) the Linear push (intercepted, no real Linear mutation).
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_fs_' + TS;
const VURL = 'https://linear.app/sidtest/issue/FS-' + TS;

function intercept(ctx, setCalls, addCalls) {
  return Promise.all([
    ctx.route('**/webhook/linear-set-status', async (r) => { try { setCalls.push(JSON.parse(r.request().postData() || '{}')); } catch (e) {} await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }),
    ctx.route('**/webhook/linear-add-comment', async (r) => { try { addCalls.push(JSON.parse(r.request().postData() || '{}')); } catch (e) {} await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }),
  ]);
}
async function mkPage(browser, setCalls, addCalls) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, ignoreHTTPSErrors: true });
  await Q.stubRerouteFlagDark(ctx);  // keep the TEST client on the legacy lane real clients run (see lib.js)
  await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  await intercept(ctx, setCalls, addCalls);
  const p = await ctx.newPage(); p._errs = [];
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) p._errs.push(m.text()); });
  p.on('pageerror', e => p._errs.push(String(e && e.message)));
  return p;
}
const waitFor = async (arr, pred, ms = 18000) => { const t = Date.now(); while (Date.now() - t < ms) { if (arr.some(pred)) return true; await new Promise(x => setTimeout(x, 400)); } return false; };
const hasStatus = (st) => (c) => String(c.issue || '').includes('FS-' + TS) && c.status === st;

(async () => {
  const S = Q.makeOk('P36 full-sync');
  const browser = await Q.launch();
  const setCalls = [], addCalls = [];
  const smm = await mkPage(browser, setCalls, addCalls);
  const kas = await mkPage(browser, setCalls, addCalls);
  const cli = await mkPage(browser, setCalls, addCalls);
  try {
    await Q.up({ id: PID, name: 'FS ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Approved', status: 'Kasper Approval',
      linear_issue_id: VURL, thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => String(r.linear_issue_id || '').includes('FS-' + TS) && r.video_status === 'Kasper Approval', 'linear_issue_id,video_status', 14000);

    await smm.goto('http://localhost:8000/index.html?v2debug=1#calendar/sidneylaruel', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await smm.waitForFunction(() => window.calV2Status && window.calV2Status().subscribed, { timeout: 20000 }).catch(() => {});
    await smm.waitForTimeout(2500);
    await kas.goto('http://localhost:8000/index.html?Kasper=1&v2debug=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await kas.waitForTimeout(8000);
    const clientToken = await Q.currentTestClientToken();
    await Q.gotoTestClientEntry(cli, {
      origin: Q.ORIGIN,
      view: 'calendar',
      name: Q.TEST_CLIENT.name,
      token: clientToken,
      gotoOptions: { waitUntil: 'domcontentloaded', timeout: 45000 },
    });
    await cli.waitForTimeout(5000);

    // STEP 1 — initial: in Kasper queue, client does NOT see video (internal KA)
    S.ok(await Q.kasperLoadHas(kas, PID), 'step1 DB=KA: card in Kasper queue');
    await Q.clientHasCaption(cli, PID, null);
    S.ok((await Q.clientCompActive(cli, PID, 'video')) === false, 'step1: client does NOT see video (internal Kasper Approval)');

    // STEP 2 — Kasper approve → Client Approval. DB + Linear + queue + client.
    await Q.kasperApprove(kas, PID, 'video');
    let r = await Q.pollRaw(PID, x => x.video_status === 'Client Approval', 'video_status', 16000);
    S.ok(r.video_status === 'Client Approval', 'step2 DB: video → Client Approval (Kasper approve)');
    S.ok(await waitFor(setCalls, hasStatus('Client Approval')), 'step2 LINEAR: pushed status=Client Approval to the video issue');
    S.ok(await Q.kasperGoneFromQueue(kas, PID), 'step2 QUEUE: card leaves Kasper queue');
    await cli.evaluate(async () => { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 1200)); });
    S.ok((await Q.clientCompActive(cli, PID, 'video')) === true, 'step2 CLIENT: client now sees video awaiting approval');

    // STEP 3 — Client request change → Tweaks Needed. DB + Linear (status + comment).
    await cli.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return; _calReviewState.drafts[a.pid + '|video'] = a.body; try { _calReviewRequestTweak(a.pid, 'video'); } catch (e) {} }, { pid: PID, body: 'Client: re-cut the intro' });
    r = await Q.pollRaw(PID, x => x.video_status === 'Tweaks Needed', 'video_status', 16000);
    S.ok(r.video_status === 'Tweaks Needed', 'step3 DB: video → Tweaks Needed (client request)');
    S.ok(await waitFor(setCalls, hasStatus('Tweaks Needed')), 'step3 LINEAR: pushed status=Tweaks Needed');
    S.ok(await waitFor(addCalls, c => String(c.issue || '').includes('FS-' + TS) && /re-cut the intro/i.test(String(c.body || ''))), 'step3 LINEAR: posted the client tweak comment to the video issue');

    // STEP 4 — SMM moves video back to Client Approval. DB + Linear.
    // Refresh the SMM page so it has seen the client's step-3 write FIRST — otherwise the SMM's
    // save base is stale and the upsert's conflict guard correctly rejects it ("someone else
    // updated this card"). A human would see the Tweaks-Needed flip before acting; mirror that.
    await Q.waitForPost(smm, PID, "p=>p.video_status==='Tweaks Needed'");
    await smm.evaluate((pid) => { try { delete _calPendingEdits[pid]; _calStatusPick(pid, 'Client Approval', 'video'); } catch (e) {} }, PID);
    r = await Q.pollRaw(PID, x => x.video_status === 'Client Approval', 'video_status', 16000);
    S.ok(r.video_status === 'Client Approval', 'step4 DB: SMM moves video → Client Approval');
    S.ok(await waitFor(setCalls, c => String(c.issue || '').includes('FS-' + TS) && c.status === 'Client Approval'), 'step4 LINEAR: re-pushed status=Client Approval');

    // STEP 5 — Client approve → Approved. DB + Linear.
    await cli.evaluate(async () => { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 1200)); });
    await cli.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); if (!p) return; try { _calReviewApprove(pid, 'video'); } catch (e) {} }, PID);
    r = await Q.pollRaw(PID, x => x.video_status === 'Approved', 'video_status', 16000);
    S.ok(r.video_status === 'Approved', 'step5 DB: video → Approved (client approve)');
    S.ok(await waitFor(setCalls, hasStatus('Approved')), 'step5 LINEAR: pushed status=Approved');

    // every Linear call targeted this card's own issue
    S.ok([...setCalls, ...addCalls].every(c => String(c.issue || '').includes('FS-' + TS)), 'all Linear calls targeted this card\'s own issue (no cross-leak)');
    S.ok(smm._errs.length === 0 && kas._errs.length === 0 && cli._errs.length === 0, 'no JS errors on any surface (' + JSON.stringify([...smm._errs, ...kas._errs, ...cli._errs].slice(0, 3)) + ')');
    console.log('LINEAR status pushes:', JSON.stringify(setCalls.map(c => c.status)));
  } finally {
    try { await Q.up({ id: PID, status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();

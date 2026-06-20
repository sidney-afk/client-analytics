// p47 — Title (YouTube) review lifecycle across surfaces + the title-specific invariants:
//   • title is a 4th review component on a YouTube card (when engaged), routed Kasper→SMM→client
//     exactly like the others, on its own title_tweaks thread.
//   • title is NEVER folded into the overall card status (computeOverallStatus = video/graphic/
//     caption only) — with those three all Approved, overall stays Approved no matter where title is.
//   • title has no Linear sub-issue, so a title status change/ tweak NEVER pushes to Linear
//     (we route every Linear webhook and assert ZERO title-driven calls).
const Q = require('./lib.js');
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();
const PID = 'p_ttl_' + Math.floor(Date.now() / 1000);

const overall = (page, pid) => page.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); return p ? computeOverallStatus(p) : 'NO_POST'; }, pid);

(async () => {
  const S = Q.makeOk('P47 title review lifecycle + invariants');
  const browser = await Q.launch();
  // Kasper context with Linear interception so we can prove title never pushes.
  const kctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
  await kctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  const linearCalls = [];
  for (const wh of ['linear-set-status', 'linear-add-comment']) {
    await kctx.route('**/webhook/' + wh, async (r) => {
      let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
      linearCalls.push({ wh, body });
      await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
  }
  const kas = await kctx.newPage(); kas._errs = [];
  kas.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) kas._errs.push(m.text()); });
  kas.on('pageerror', e => kas._errs.push(String(e && e.message)));
  await kas.goto('http://localhost:8000/index.html?Kasper=1&v2debug=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await kas.waitForTimeout(8000);

  const cli = await Q.clientPage(browser);
  try {
    // YouTube card: video/graphic/caption all Approved; TITLE engaged at Kasper Approval.
    await Q.up({ id: PID, name: 'TTL ' + PID.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved',
      title: 'My Draft YouTube Title', title_status: 'Kasper Approval', status: 'Approved',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', title_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.title_status === 'Kasper Approval', 'title_status');

    // 1) card surfaces to Kasper for TITLE review
    S.ok(await Q.kasperLoadHas(kas, PID), 'card in Kasper queue for title review (title at KA)');
    // overall is Approved despite title at Kasper Approval (title excluded from overall)
    const ov0 = await Q.overallOn(kas, PID, 'kasper');
    S.ok(ov0 === 'Approved', 'overall=Approved with title at Kasper Approval (title NOT folded in; got ' + ov0 + ')');

    // 2) Kasper requests a title change
    const reqRes = await kas.evaluate(async (a) => { const it = (_kasperState.items || []).find(x => x.post.id === a.pid); if (!it) return 'NO_ITEM'; it._drafts = it._drafts || {}; it._drafts.title = a.body; try { await _kasperRequestTweakComp(a.pid, 'title', false); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }, { pid: PID, body: 'Kasper: punch up the title hook' });
    S.ok(reqRes === 'ok', 'Kasper request-change on title ok (' + reqRes + ')');
    let r = await Q.pollRaw(PID, x => x.title_status === 'Tweaks Needed', 'title_status,title_tweaks,status', 15000);
    S.ok(r.title_status === 'Tweaks Needed', 'title → Tweaks Needed');
    let tw = []; try { tw = JSON.parse(r.title_tweaks || '[]'); } catch (e) {}
    S.ok(tw.some(c => c.is_tweak && c.role === 'kasper' && (c.body || '').includes('title hook')), 'title tweak landed on title_tweaks thread (role kasper)');
    S.ok(r.status === 'Approved', 'overall STILL Approved with title at Tweaks Needed (title excluded)');

    // 3) SMM resolves the title tweak → Client Approval
    await Q.smmResolveTweak(PID, 'title', 'Client Approval');
    r = await Q.pollRaw(PID, x => x.title_status === 'Client Approval', 'title_status,status', 15000);
    S.ok(r.title_status === 'Client Approval', 'SMM resolve → title Client Approval');
    S.ok(r.status === 'Approved', 'overall still Approved (title at Client Approval)');

    // 4) client approves the title
    await Q.waitForPost(cli, PID, "p=>p.title_status==='Client Approval'");
    await cli.evaluate(async (pid) => { const k = pid + '|title'; for (let i = 0; i < 20; i++) { if (!_calReviewState.saving[k]) break; await new Promise(x => setTimeout(x, 200)); } }, PID);
    const apRes = await Q.clientApprove(cli, PID, 'title');
    S.ok(apRes === 'ok', 'client approve title ok (' + apRes + ')');
    r = await Q.pollRaw(PID, x => x.title_status === 'Approved', 'title_status,status', 15000);
    S.ok(r.title_status === 'Approved', 'client approval → title Approved');
    S.ok(r.status === 'Approved', 'overall Approved (all four components now Approved)');

    // 5) title NEVER pushed to Linear across the whole flow
    await kas.waitForTimeout(1500);
    S.ok(linearCalls.length === 0, 'ZERO Linear pushes from title (title has no Linear sub-issue); got ' + JSON.stringify(linearCalls.map(c => c.wh)));

    S.ok(kas._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...kas._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();

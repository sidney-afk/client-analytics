// p29 — Kasper review actions → Linear sync (intercepted, no real Linear mutation).
//   - Kasper "request change" on video → posts the tweak to the video issue (linear-add-comment)
//   - Kasper "approve" on video → pushes video_status='Client Approval' to the video issue
// Both must target the card's OWN video issue.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const REQ = 'p_lk_req_' + TS, APP = 'p_lk_app_' + TS;
const vurl = (id) => 'https://linear.app/sidtest/issue/' + id;

(async () => {
  const S = Q.makeOk('P29 linear-kasper');
  const browser = await Q.launch();
  const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, ignoreHTTPSErrors: true });
  await Q.stubRerouteFlagDark(ctx);  // keep the TEST client on the legacy lane real clients run (see lib.js)
  await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  const setCalls = [], addCalls = [];
  await ctx.route('**/webhook/linear-set-status', async (r) => { try { setCalls.push(JSON.parse(r.request().postData() || '{}')); } catch (e) {} await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await ctx.route('**/webhook/linear-add-comment', async (r) => { try { addCalls.push(JSON.parse(r.request().postData() || '{}')); } catch (e) {} await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  const kas = await ctx.newPage(); kas._errs = [];
  kas.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) kas._errs.push(m.text()); });
  kas.on('pageerror', e => kas._errs.push(String(e && e.message)));
  const waitFor = async (arr, pred, ms = 16000) => { const t = Date.now(); while (Date.now() - t < ms) { if (arr.some(pred)) return true; await new Promise(x => setTimeout(x, 400)); } return false; };

  try {
    const VREQ = vurl('LKREQ-' + TS), VAPP = vurl('LKAPP-' + TS);
    // two cards with a video Linear issue, video at Kasper Approval (in queue)
    for (const [id, vu] of [[REQ, VREQ], [APP, VAPP]]) {
      await Q.up({ id, name: 'LK ' + id.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
        video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Approved', status: 'Kasper Approval',
        linear_issue_id: vu, thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    }
    await Q.pollRaw(REQ, r => String(r.linear_issue_id || '').includes('LKREQ-' + TS), 'linear_issue_id', 14000);
    await Q.pollRaw(APP, r => String(r.linear_issue_id || '').includes('LKAPP-' + TS), 'linear_issue_id', 14000);

    await kas.goto('http://localhost:8000/index.html?Kasper=1&v2debug=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await kas.waitForTimeout(8000);

    // Kasper request change on video → tweak posted to the video issue
    await Q.kasperLoadHas(kas, REQ);
    await Q.kasperRequest(kas, REQ, 'video', 'Kasper: tighten the cut at 0:12');
    const gotReqComment = await waitFor(addCalls, c => String(c.issue || '').includes('LKREQ-' + TS) && /tighten the cut/i.test(String(c.body || '')));
    S.ok(gotReqComment, 'Kasper request-change posts the tweak to the VIDEO Linear issue');
    await Q.pollRow(REQ, x => x.caption_status !== undefined); // settle

    // Kasper approve on video → pushes status to the video issue
    await Q.kasperLoadHas(kas, APP);
    await Q.kasperApprove(kas, APP, 'video');
    const gotApproveStatus = await waitFor(setCalls, c => String(c.issue || '').includes('LKAPP-' + TS) && c.status === 'Client Approval');
    S.ok(gotApproveStatus, 'Kasper approve pushes video_status=Client Approval to the VIDEO Linear issue');

    // cross-client safety: all captured issues are these two Sidney cards' issues
    const allIssues = [...setCalls, ...addCalls].map(c => String(c.issue || ''));
    S.ok(allIssues.length > 0 && allIssues.every(u => u.includes('LKREQ-' + TS) || u.includes('LKAPP-' + TS)), 'all Kasper→Linear calls targeted Sidney\'s own issues');
    S.ok(kas._errs.length === 0, 'Kasper: 0 JS errors (' + JSON.stringify(kas._errs.slice(0, 3)) + ')');
    console.log('set:', JSON.stringify(setCalls), '| add:', JSON.stringify(addCalls.map(c => ({ issue: c.issue, body: (c.body || '').slice(0, 30) }))));
  } finally {
    await Q.up({ id: REQ, status: 'Archived' }); await Q.up({ id: APP, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();

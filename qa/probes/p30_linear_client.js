// p30 — Client review actions → Linear sync (intercepted, no real Linear mutation).
//   - Client "request change" on video → posts the tweak to the video issue + pushes status
//   - Client "approve" on video → pushes video_status='Approved' to the video issue
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const REQ = 'p_lc_req_' + TS, APP = 'p_lc_app_' + TS;
const vurl = (id) => 'https://linear.app/sidtest/issue/' + id;

(async () => {
  const S = Q.makeOk('P30 linear-client');
  const browser = await Q.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, ignoreHTTPSErrors: true });
  await Q.stubRerouteFlagDark(ctx);  // keep the TEST client on the legacy lane real clients run (see lib.js)
  await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  const setCalls = [], addCalls = [];
  await ctx.route('**/webhook/linear-set-status', async (r) => { try { setCalls.push(JSON.parse(r.request().postData() || '{}')); } catch (e) {} await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await ctx.route('**/webhook/linear-add-comment', async (r) => { try { addCalls.push(JSON.parse(r.request().postData() || '{}')); } catch (e) {} await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  const cli = await ctx.newPage(); cli._errs = [];
  cli.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) cli._errs.push(m.text()); });
  cli.on('pageerror', e => cli._errs.push(String(e && e.message)));
  const waitFor = async (arr, pred, ms = 16000) => { const t = Date.now(); while (Date.now() - t < ms) { if (arr.some(pred)) return true; await new Promise(x => setTimeout(x, 400)); } return false; };

  try {
    const VREQ = vurl('LCREQ-' + TS), VAPP = vurl('LCAPP-' + TS);
    for (const [id, vu] of [[REQ, VREQ], [APP, VAPP]]) {
      await Q.up({ id, name: 'LC ' + id.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
        video_status: 'Client Approval', graphic_status: 'Approved', caption_status: 'Approved', status: 'Client Approval',
        linear_issue_id: vu, thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    }
    await Q.pollRaw(REQ, r => String(r.linear_issue_id || '').includes('LCREQ-' + TS), 'linear_issue_id', 14000);
    await Q.pollRaw(APP, r => String(r.linear_issue_id || '').includes('LCAPP-' + TS), 'linear_issue_id', 14000);

    const clientToken = await Q.currentTestClientToken();
    await Q.gotoTestClientEntry(cli, {
      origin: Q.ORIGIN,
      view: 'calendar',
      name: Q.TEST_CLIENT.name,
      token: clientToken,
      gotoOptions: { waitUntil: 'domcontentloaded', timeout: 45000 },
    });
    await cli.waitForTimeout(5000);

    // fire both client actions, then wait generously and assert on the final captured arrays
    // (n8n latency can delay the comment push past a per-step window — not a routing error).
    await Q.clientHasCaption(cli, REQ, null);
    await cli.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return; _calReviewState.drafts[a.pid + '|video'] = a.body; try { _calReviewRequestTweak(a.pid, 'video'); } catch (e) {} }, { pid: REQ, body: 'Client: please brighten the thumbnail frame' });
    await Q.clientHasCaption(cli, APP, null);
    await cli.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); if (!p) return; try { _calReviewApprove(pid, 'video'); } catch (e) {} }, APP);

    await waitFor(addCalls, c => String(c.issue || '').includes('LCREQ-' + TS), 25000);
    await waitFor(setCalls, c => String(c.issue || '').includes('LCAPP-' + TS) && c.status === 'Approved', 25000);
    await cli.waitForTimeout(2000);

    S.ok(addCalls.some(c => String(c.issue || '').includes('LCREQ-' + TS) && /brighten/i.test(String(c.body || ''))), 'client request-change posts the tweak to the VIDEO Linear issue');
    S.ok(setCalls.some(c => String(c.issue || '').includes('LCREQ-' + TS) && c.status === 'Tweaks Needed'), 'client request-change pushes video_status=Tweaks Needed to the VIDEO Linear issue');
    S.ok(setCalls.some(c => String(c.issue || '').includes('LCAPP-' + TS) && c.status === 'Approved'), 'client approve pushes video_status=Approved to the VIDEO Linear issue');

    const allIssues = [...setCalls, ...addCalls].map(c => String(c.issue || ''));
    S.ok(allIssues.length > 0 && allIssues.every(u => u.includes('LCREQ-' + TS) || u.includes('LCAPP-' + TS)), 'all client→Linear calls targeted Sidney\'s own issues');
    S.ok(cli._errs.length === 0, 'client: 0 JS errors (' + JSON.stringify(cli._errs.slice(0, 3)) + ')');
    console.log('set:', JSON.stringify(setCalls), '| add:', JSON.stringify(addCalls.map(c => ({ issue: c.issue, body: (c.body || '').slice(0, 30) }))));
  } finally {
    try { await Q.up({ id: REQ, status: 'Archived' }); } catch (e) {}
    try { await Q.up({ id: APP, status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();

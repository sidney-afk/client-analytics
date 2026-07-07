// Smoke: prove the courier tunnels the real backend in this sandbox — open the
// SMM calendar for the test client, confirm it loaded real rows, and that the
// TEST 2 card in the page matches the backend row. No writes.
'use strict';
const L = require('./lib.js');
const TEST2 = 'p_mqjznt6m_h4k9o';

(async () => {
  const { server } = await L.startServer();
  const browser = await L.launch();
  const s = L.makeOk('smoke');
  try {
    const t0 = Date.now();
    const { page, ctx, rec } = await L.smmCal(browser);
    console.log('  smmCal.loaded =', page && page._forceLoadLast !== undefined ? JSON.stringify(page._forceLoadLast) : '(loaded ok)');
    const st = await page.evaluate(() => (window.calV2Status ? window.calV2Status() : null));
    console.log('  calV2Status:', JSON.stringify(st));
    const info = await page.evaluate((pid) => {
      const posts = (typeof calState === 'object' && calState.posts) || [];
      const p = posts.find(x => x.id === pid);
      return {
        client: typeof calState === 'object' && calState.client,
        count: posts.length,
        test2: p ? { video_status: p.video_status, graphic_status: p.graphic_status, caption_status: p.caption_status, title_status: p.title_status, name: p.name, linear: p.linear_issue_id, glinear: p.graphic_linear_issue_id } : null,
      };
    }, TEST2);
    console.log('  page client =', info.client, '| posts =', info.count);
    console.log('  page TEST2  =', JSON.stringify(info.test2));
    s.ok(String(info.client || '').toLowerCase().includes('sidney'), 'page resolved the test client', info.client);
    s.ok(info.count >= 3, 'page loaded the live (non-archived) rows via courier', 'count=' + info.count);
    s.ok(!!info.test2, 'TEST 2 card present in calState');

    const back = L.calRow(TEST2, 'video_status,graphic_status,caption_status,title_status,updated_at');
    console.log('  backend TEST2 =', JSON.stringify(back));
    if (info.test2) {
      s.ok(info.test2.video_status === back.video_status, 'page video_status matches backend', info.test2.video_status + ' vs ' + back.video_status);
      s.ok(info.test2.graphic_status === back.graphic_status, 'page graphic_status matches backend', info.test2.graphic_status + ' vs ' + back.graphic_status);
    }

    const kinds = rec.writesSince(t0).map(r => r.kind);
    const reads = rec.since(t0).filter(r => r.kind === 'supabase-rest').length;
    console.log('  captured supabase-rest reads =', reads, '| write kinds =', JSON.stringify(kinds));
    s.ok(reads > 0, 'courier captured supabase REST reads');

    console.log('\n  --- all captured requests ---');
    for (const r of rec.requests) console.log('   ', r.status, r.method, r.kind, r.url.replace(L.SUPA, 'SUPA').replace('https://synchrosocial.app.n8n.cloud', 'N8N').slice(0, 140));
    console.log('\n  --- page console (last 30) ---');
    for (const l of (page._logs || []).slice(-30)) console.log('   ', l.slice(0, 200));

    const errs = L.appErrs(page);
    console.log('  appErrs =', errs.length, errs.slice(0, 5).join(' | '));
    s.ok(errs.length === 0, 'zero app JS errors on load');
    await ctx.close();
  } catch (e) {
    console.error('SMOKE EXCEPTION:', e && e.stack || e);
    s.fail++;
  } finally {
    await browser.close();
    server.close();
    console.log(`\nSMOKE: ${s.pass} pass / ${s.fail} fail`);
    process.exit(s.fail ? 1 : 0);
  }
})();

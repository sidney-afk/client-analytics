// p38 — §4.4 bulk "Generate all" (_calBulkGenerateCaptions): concurrency cap + partial failure.
//   - 3 eligible cards selected → all generate, but at most CAL_CAPJOB_CONCURRENCY in flight at once
//   - one card's backend returns an error → the others still succeed (batch isn't all-or-nothing)
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const A = 'p_bg_a_' + TS, B = 'p_bg_b_' + TS, C = 'p_bg_c_' + TS;
const FRAME = 'https://frame.io/test/' + TS;
const seed = (id) => Q.up({ id, name: 'BG ' + id.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29', caption: '', status: 'In Progress', asset_url: FRAME + '/' + id, thumbnail_url: 'https://via.placeholder.com/320x180.png' });

(async () => {
  const S = Q.makeOk('P38 bulk-caption');
  const browser = await Q.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  let inFlight = 0, maxConcurrent = 0;
  const respFor = {};
  await ctx.route('**/webhook/generate-caption', async (r) => {
    let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    inFlight++; maxConcurrent = Math.max(maxConcurrent, inFlight);
    await new Promise(x => setTimeout(x, 2500));   // hold the slot so concurrency is observable
    inFlight--;
    const resp = respFor[body.postId] || { ok: true, caption: 'BULK-' + String(body.postId).slice(-6) };
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) });
  });
  await ctx.route('**/webhook/caption-prompts-get', async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route('**/webhook/caption-job-status', async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"status":"running"}' }));
  const smm = await ctx.newPage(); smm._errs = [];
  smm.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) smm._errs.push(m.text()); });
  smm.on('pageerror', e => smm._errs.push(String(e && e.message)));
  const localCap = (pid) => smm.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); return p ? p.caption : null; }, pid);

  try {
    await seed(A); await seed(B); await seed(C);
    for (const id of [A, B, C]) await Q.pollRaw(id, r => r.id === id, 'id');
    respFor[B] = { ok: false, error: 'simulated failure' };   // B fails

    await smm.goto('http://localhost:8000/index.html?v2debug=1#calendar/sidneylaruel', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await smm.waitForFunction(() => window.calV2Status && window.calV2Status().subscribed, { timeout: 20000 }).catch(() => {});
    await smm.waitForTimeout(2500);
    await smm.evaluate(async () => { try { await _calLoadCaptionPrompts(); } catch (e) {} });
    for (const id of [A, B, C]) await Q.waitForPost(smm, id);

    // select all 3 + bulk generate
    const cap = await smm.evaluate(() => CAL_CAPJOB_CONCURRENCY);
    await smm.evaluate((a) => { calState.selected = new Set([a.A, a.B, a.C]); _calBulkGenerateCaptions(); }, { A, B, C });
    // wait for all jobs to settle (3 jobs * ~2.5s with cap → ~5-8s)
    await smm.waitForTimeout(12000);

    const aCap = await localCap(A), bCap = await localCap(B), cCap = await localCap(C);
    console.log('caps:', JSON.stringify({ aCap, bCap, cCap, maxConcurrent, cap }));
    S.ok(maxConcurrent <= cap, 'concurrency capped at CAL_CAPJOB_CONCURRENCY=' + cap + ' (max in flight=' + maxConcurrent + ')');
    S.ok(maxConcurrent >= 2, 'at least 2 ran concurrently (cap exercised, max=' + maxConcurrent + ')');
    S.ok(String(aCap || '').includes('BULK-') && String(cCap || '').includes('BULK-'), 'A and C succeeded (got captions)');
    S.ok(!String(bCap || '').trim(), 'B failed cleanly — no caption (partial failure did not break the batch)');
    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally {
    for (const id of [A, B, C]) { try { await Q.up({ id, status: 'Archived' }); } catch (e) {} }
    await browser.close();
  }
  process.exit(S.done());
})();

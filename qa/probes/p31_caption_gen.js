// p31 — caption-generation entry guards + settle (intercepted; no real AI / Frame.io).
// generate-caption's synchronous fast-path settles from the response, so we drive the whole
// thing by controlling that response per-card.
//   A. double-submit (prompts loaded) → ONE generate POST, one caption
//   B. settle 'done' → caption lands on the card + backend
//   C. empty/whitespace caption → settles as ERROR, no caption written
//   D. card already has a caption → generation skipped (no POST)
//   E. client surface → generation blocked (no POST)
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const DBL = 'p_cg_dbl_' + TS, OK = 'p_cg_ok_' + TS, EMP = 'p_cg_emp_' + TS, HAS = 'p_cg_has_' + TS, CLI = 'p_cg_cli_' + TS;
const FRAME = 'https://frame.io/test/' + TS;
const seed = (id, caption) => Q.up({ id, name: 'CG ' + id.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
  caption: caption || '', status: 'In Progress', asset_url: FRAME, thumbnail_url: 'https://via.placeholder.com/320x180.png' });

(async () => {
  const S = Q.makeOk('P31 caption-gen');
  const browser = await Q.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
  await Q.stubRerouteFlagDark(ctx);  // keep the TEST client on the legacy lane real clients run (see lib.js)
  await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  // per-pid generate response control
  let genPosts = [];
  const respFor = {};   // pid → {ok, caption} | {error}
  await ctx.route('**/webhook/generate-caption', async (r) => {
    let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    genPosts.push(body.postId);
    const resp = respFor[body.postId] || { ok: true, caption: 'GEN-' + String(body.postId).slice(-6) };
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) });
  });
  await ctx.route('**/webhook/caption-prompts-get', async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route('**/webhook/caption-job-status', async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"status":"running"}' }));
  const smm = await ctx.newPage(); smm._errs = [];
  smm.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) smm._errs.push(m.text()); });
  smm.on('pageerror', e => smm._errs.push(String(e && e.message)));

  try {
    await seed(DBL); await seed(OK); await seed(EMP); await seed(HAS, 'EXISTING CAPTION'); await seed(CLI);
    for (const id of [DBL, OK, EMP, HAS, CLI]) await Q.pollRaw(id, r => r.id === id, 'id');
    respFor[OK] = { ok: true, caption: 'GENERATED-OK-' + TS };
    respFor[EMP] = { ok: true, caption: '   ' };   // whitespace-only

    await smm.goto('http://localhost:8000/index.html?v2debug=1#calendar/sidneylaruel', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await smm.waitForFunction(() => window.calV2Status && window.calV2Status().subscribed, { timeout: 20000 }).catch(() => {});
    await smm.waitForTimeout(2500);
    // ensure caption prompts are loaded so the entry check→register is synchronous
    await smm.evaluate(async () => { try { await _calLoadCaptionPrompts(); } catch (e) {} });
    await Q.waitForPost(smm, DBL);

    // A. double-submit
    genPosts = [];
    await smm.evaluate((pid) => { _calGenerateCaption(pid); _calGenerateCaption(pid); }, DBL);
    await smm.waitForTimeout(2500);
    const dblCount = genPosts.filter(p => p === DBL).length;
    S.ok(dblCount === 1, 'A: double-submit fires exactly ONE generate POST (got ' + dblCount + ')');

    // B. settle done → caption lands LOCALLY (on 'done' the n8n workflow writes the sheet; the
    // frontend only updates the local card — so we assert on calState, not the backend).
    await smm.evaluate((pid) => _calGenerateCaption(pid), OK);
    const okLocal = await smm.evaluate(async (a) => {
      for (let i = 0; i < 20; i++) { const p = (calState.posts || []).find(x => x.id === a.pid); if (p && String(p.caption || '').includes('GENERATED-OK-' + a.ts)) return p.caption; await new Promise(x => setTimeout(x, 500)); }
      const p = (calState.posts || []).find(x => x.id === a.pid); return p ? p.caption : null;
    }, { pid: OK, ts: TS });
    S.ok(String(okLocal || '').includes('GENERATED-OK-' + TS), 'B: generated caption applied to the local card (got ' + JSON.stringify(okLocal) + ')');

    // C. empty caption → error, no caption written
    await smm.evaluate((pid) => _calGenerateCaption(pid), EMP);
    await smm.waitForTimeout(6000);
    const empRow = await Q.rawRow(EMP, 'caption');
    S.ok(!String(empRow.caption || '').trim(), 'C: whitespace caption settles as error — no caption written (caption=' + JSON.stringify(empRow.caption) + ')');

    // D. already has caption → skipped, no POST
    genPosts = [];
    const dRes = await smm.evaluate((pid) => _calGenerateCaption(pid), HAS);
    await smm.waitForTimeout(1500);
    S.ok(genPosts.filter(p => p === HAS).length === 0, 'D: generate on a card with a caption is skipped (no POST)');

    // E. client guard
    const cli = await ctx.newPage();
    await cli.goto('http://localhost:8000/index.html?c=Sidney%20Laruel&v=calendar&v2debug=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await cli.waitForTimeout(5000);
    await Q.waitForPost(cli, CLI);
    genPosts = [];
    await cli.evaluate((pid) => { try { _calGenerateCaption(pid); } catch (e) {} }, CLI);
    await cli.waitForTimeout(1500);
    S.ok(genPosts.filter(p => p === CLI).length === 0, 'E: client cannot generate a caption (no POST)');

    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally {
    for (const id of [DBL, OK, EMP, HAS, CLI]) { try { await Q.up({ id, status: 'Archived' }); } catch (e) {} }
    await browser.close();
  }
  process.exit(S.done());
})();

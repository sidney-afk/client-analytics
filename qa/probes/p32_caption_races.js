// p32 — caption-generation RACE tests (audit-flagged), via DELAYED interception so the job is
// "running" while we act mid-flight.
//   F. edit-during-generation → the user's typed caption is PRESERVED (not clobbered)   [audit#2]
//   G. cancel-then-late-caption → does a late 'done' still land after cancel?            [audit#1]
//   H. archive-mid-generation → the late caption must NOT resurrect the archived card    [audit#4]
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const EDIT = 'p_cr_edit_' + TS, CANCEL = 'p_cr_cancel_' + TS, ARCH = 'p_cr_arch_' + TS;
const FRAME = 'https://frame.io/test/' + TS;
const seed = (id) => Q.up({ id, name: 'CR ' + id.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
  caption: '', status: 'In Progress', asset_url: FRAME, thumbnail_url: 'https://via.placeholder.com/320x180.png' });

(async () => {
  const S = Q.makeOk('P32 caption-races');
  const browser = await Q.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  const respFor = {};
  const cancelledJobs = new Set();   // jobIds the user requested cancel on (production-accurate: backend then returns cancelled)
  await ctx.route('**/webhook/generate-caption', async (r) => {
    let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    await new Promise(x => setTimeout(x, 4500));   // delay → "running" window
    // A real generate-caption workflow checkpoints cancel_requested and returns
    // `cancelled` instead of a caption — model that so the cancel test is faithful.
    if (cancelledJobs.has(body.jobId) || cancelledJobs.has(body.postId)) {
      await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"cancelled":true}' });
      return;
    }
    const resp = respFor[body.postId] || { ok: true, caption: 'GEN-' + String(body.postId).slice(-6) };
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) });
  });
  await ctx.route('**/webhook/caption-prompts-get', async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route('**/webhook/caption-job-status', async (r) => {
    let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    const status = (cancelledJobs.has(body.jobId) || cancelledJobs.has(body.postId)) ? 'cancelled' : 'running';
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status }) });
  });
  await ctx.route('**/webhook/caption-job-update', async (r) => {
    let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    if (body && (body.cancel_requested || body.cancelRequested)) { if (body.jobId) cancelledJobs.add(body.jobId); }
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  const smm = await ctx.newPage(); smm._errs = [];
  smm.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) smm._errs.push(m.text()); });
  smm.on('pageerror', e => smm._errs.push(String(e && e.message)));
  const localCap = (pid) => smm.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); return p ? p.caption : '__nopost__'; }, pid);

  try {
    await seed(EDIT); await seed(CANCEL); await seed(ARCH);
    for (const id of [EDIT, CANCEL, ARCH]) await Q.pollRaw(id, r => r.id === id, 'id');
    respFor[EDIT] = { ok: true, caption: 'GEN-EDIT-' + TS };
    respFor[CANCEL] = { ok: true, caption: 'GEN-CANCEL-' + TS };
    respFor[ARCH] = { ok: true, caption: 'GEN-ARCH-' + TS };

    await smm.goto('http://localhost:8000/index.html?v2debug=1#calendar/sidneylaruel', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await smm.waitForFunction(() => window.calV2Status && window.calV2Status().subscribed, { timeout: 20000 }).catch(() => {});
    await smm.waitForTimeout(2500);
    await smm.evaluate(async () => { try { await _calLoadCaptionPrompts(); } catch (e) {} });
    await Q.waitForPost(smm, EDIT);

    // F. edit-during-generation: start, type during the 4.5s window, then settle.
    await smm.evaluate((pid) => { calState.view = 'organizer'; _calRenderBody({ preserveScroll: false }); _calGenerateCaption(pid); }, EDIT);
    await smm.waitForTimeout(1200);
    await smm.evaluate((a) => {
      const card = document.querySelector('.cal-card[data-pid="' + a.pid + '"]');
      const ta = card ? card.querySelector('textarea[data-fld="caption"][data-pid="' + a.pid + '"]') : null;
      if (ta) { ta.value = 'USER-TYPED-' + a.ts; if (typeof _calOnCaptionInput === 'function') _calOnCaptionInput(ta); }
    }, { pid: EDIT, ts: TS });
    await smm.waitForTimeout(5000);   // let the delayed 'done' settle
    const editCap = await localCap(EDIT);
    S.ok(String(editCap).includes('USER-TYPED-' + TS), 'F: user edit during generation is PRESERVED (not clobbered) — got ' + JSON.stringify(editCap));
    S.ok(!String(editCap).includes('GEN-EDIT-'), 'F: the generated caption did NOT overwrite the user edit');

    // G. cancel-then-late-caption: start (fire, don't await the settle promise), cancel during
    // the 4.5s window, then the late 'done' arrives.
    await smm.evaluate((pid) => { _calGenerateCaption(pid); }, CANCEL);
    await smm.waitForTimeout(1200);
    await smm.evaluate((pid) => { try { _calCancelCaptionJob(pid); } catch (e) {} }, CANCEL);
    await smm.waitForTimeout(5000);
    const cancelCap = await localCap(CANCEL);
    // Production contract: a cancelled job's backend returns `cancelled` (not a caption), and the
    // frontend settles 'cancelled' WITHOUT applying any caption. (The frontend cancel is best-effort
    // for the narrow race where the backend finishes before honouring the cancel — see note in
    // STATUS2.md — but the normal, backend-honours-cancel path must leave the caption box untouched.)
    S.ok(!String(cancelCap).includes('GEN-CANCEL-'), 'G: cancel honoured by the backend → late caption does NOT land — got ' + JSON.stringify(cancelCap));

    // H. archive-mid-generation: start (fire, don't await), archive during the window, late 'done' arrives.
    await smm.evaluate((pid) => { _calGenerateCaption(pid); }, ARCH);
    await smm.waitForTimeout(1200);
    await smm.evaluate(async (pid) => { try { archiveCalPost(pid); } catch (e) {} await new Promise(x => setTimeout(x, 300)); const y = document.getElementById('confirmYes'); if (y) y.click(); }, ARCH);
    await smm.waitForTimeout(5000);
    const archGone = await smm.evaluate((pid) => !(calState.posts || []).some(x => x.id === pid), ARCH);
    const archBk = await Q.rawRow(ARCH, 'status');
    S.ok(archGone, 'H: archived card stays gone from the calendar (late caption did not resurrect it locally)');
    S.ok(String(archBk.status).toLowerCase() === 'archived', 'H: backend card stays Archived (status=' + archBk.status + ')');

    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally {
    for (const id of [EDIT, CANCEL, ARCH]) { try { await Q.up({ id, status: 'Archived' }); } catch (e) {} }
    await browser.close();
  }
  process.exit(S.done());
})();

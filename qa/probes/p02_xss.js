// p02 — §3 TEXT battery / XSS: inject active-HTML payloads into name, caption, and a
// comment body; render on SMM + client + Kasper; assert NO payload executes (no onerror/
// onload fires, no <img>/<svg> injected element created) and 0 JS errors.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_xss_' + TS;

const X_NAME = '<img src=x onerror="window.__XN=1">name';
const X_NAME_ATTR = '"><img src=x onerror="window.__XNA=1">';     // attribute breakout attempt
const X_CAP  = '<img src=x onerror="window.__XC=1"><svg onload="window.__XC2=1">cap';
const X_BODY = '<img src=x onerror="window.__XB=1">body"><script>window.__XBS=1</script>';

const COMMENT = [{ id: 'c_xss_' + TS, parent_id: null, author: 'Client', role: 'client',
  is_tweak: false, audience: 'client', body: X_BODY,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  done: false, done_at: '', done_by: '' }];

const flags = ['__XN','__XNA','__XC','__XC2','__XB','__XBS'];
const checkFlags = (page) => page.evaluate((fl) => fl.map(f => [f, !!window[f]]), flags);

(async () => {
  const S = Q.makeOk('P02 xss');
  const browser = await Q.launch();
  try {
    await Q.up({ id: PID, name: X_NAME + X_NAME_ATTR, platforms: 'youtube', scheduled_date: '2026-06-29',
      caption: X_CAP, caption_status: 'Kasper Approval', video_status: 'Approved', graphic_status: 'Approved',
      status: 'In Progress', thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/x.mp4',
      caption_tweaks: JSON.stringify(COMMENT) });
    await Q.pollRaw(PID, r => r.id === PID, 'id');

    // ---- SMM ----
    const smm = await Q.smmPage(browser);
    const smmLoaded = await Q.waitForPost(smm, PID);
    S.ok(smmLoaded.found, 'SMM: card loaded');
    const smmDom = await smm.evaluate(async (pid) => {
      if (calState.view !== 'organizer') { calState.view = 'organizer'; }
      try { _calRenderBody({ preserveScroll: false }); } catch (e) {}
      await new Promise(x => setTimeout(x, 400));
      try { openCalComments(pid); } catch (e) {}
      await new Promise(x => setTimeout(x, 600));
      const nameInput = document.querySelector('.cal-card[data-pid="' + pid + '"] .cal-fld-name');
      const feed = document.getElementById('calCommentsFeed');
      const out = {
        nameVal: nameInput ? nameInput.value : null,
        // count any injected live elements that should NOT exist anywhere
        injectedImgs: document.querySelectorAll('img[src="x"]').length,
        feedHtmlHasEscaped: feed ? /&lt;(img|script)/i.test(feed.innerHTML) : null,
        feedHasLiveScript: feed ? feed.querySelectorAll('script').length : null,
      };
      try { closeCalComments(); } catch (e) {}
      return out;
    }, PID);
    await smm.waitForTimeout(500);
    console.log('SMM dom:', JSON.stringify(smmDom));
    const smmFlags = await checkFlags(smm);
    S.ok(smmFlags.every(([f,v]) => !v), 'SMM: no XSS flag fired (' + JSON.stringify(smmFlags.filter(([f,v])=>v)) + ')');
    S.ok(smmDom.injectedImgs === 0, 'SMM: no live <img src=x> injected (' + smmDom.injectedImgs + ')');
    S.ok(smmDom.feedHasLiveScript === 0, 'SMM: no live <script> in comment feed');
    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0,4)) + ')');

    // ---- Client ----
    const cli = await Q.clientPage(browser);
    const cliLoaded = await Q.waitForPost(cli, PID);
    S.ok(cliLoaded.found, 'CLIENT: card loaded');
    await cli.evaluate(async () => { try { _calRenderBody({ preserveScroll: false }); } catch(e){} await new Promise(x=>setTimeout(x,500)); });
    await cli.waitForTimeout(500);
    const cliFlags = await checkFlags(cli);
    const cliImgs = await cli.evaluate(() => document.querySelectorAll('img[src="x"]').length);
    S.ok(cliFlags.every(([f,v]) => !v), 'CLIENT: no XSS flag fired (' + JSON.stringify(cliFlags.filter(([f,v])=>v)) + ')');
    S.ok(cliImgs === 0, 'CLIENT: no live <img src=x> injected (' + cliImgs + ')');
    S.ok(cli._errs.length === 0, 'CLIENT: 0 JS errors (' + JSON.stringify(cli._errs.slice(0,4)) + ')');

    // ---- Kasper ----
    const kas = await Q.kasperPage(browser);
    const inQueue = await Q.kasperLoadHas(kas, PID);
    S.ok(inQueue, 'KASPER: card in queue');
    await kas.evaluate(async (pid) => {
      // expand the card to render comments
      const it = (_kasperState.items||[]).find(x => x.post.id === pid);
      if (it) { it._expanded = true; try { _kasperRepaintCard(pid); } catch(e){} try { _kasperRenderTab(); } catch(e){} }
      await new Promise(x => setTimeout(x, 600));
    }, PID);
    await kas.waitForTimeout(500);
    const kasFlags = await checkFlags(kas);
    const kasImgs = await kas.evaluate(() => document.querySelectorAll('img[src="x"]').length);
    S.ok(kasFlags.every(([f,v]) => !v), 'KASPER: no XSS flag fired (' + JSON.stringify(kasFlags.filter(([f,v])=>v)) + ')');
    S.ok(kasImgs === 0, 'KASPER: no live <img src=x> injected (' + kasImgs + ')');
    S.ok(kas._errs.length === 0, 'KASPER: 0 JS errors (' + JSON.stringify(kas._errs.slice(0,4)) + ')');
  } finally {
    await Q.up({ id: PID, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();

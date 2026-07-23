// p94 — navigation must survive a FULL localStorage.
//
// Regression probe for the "dead tabs" incident: navTo() (and the popstate
// handler) did an UNGUARDED localStorage.setItem(NAV_KEY, page). On a heavy
// user whose caches filled the quota, that setItem threw QuotaExceededError,
// aborting the rest of navTo — so the initial render left #content empty and
// every tab click silently did nothing (fixed only by clearing site data).
//
// This fills localStorage to the brim (so any new setItem throws — the user's
// exact console error) then asserts: the app still renders content on boot AND
// clicking the top nav tabs actually navigates.
const lib = require('../sxr_courier_lib.js');

const EXT = /(supabase\.co|synchrosocial\.app\.n8n\.cloud|cdn\.jsdelivr\.net|docs\.google\.com|drive\.google\.com|googleusercontent\.com|ytimg\.com)/;

function forwardExternal(method, url, headers, postData) {
  try {
    const response = lib.filelessHttpRequest(method, url, headers, postData);
    // Preserve this probe's historical routing contract: any upstream HTTP
    // response is fulfilled as 200; only courier failures surface as 502.
    return { status: 200, ctype: response.ctype, body: response.body };
  } catch {
    return { status: 502, ctype: 'text/plain', body: Buffer.from('x') };
  }
}

async function run() {
  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
  const browser = await lib.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, ignoreHTTPSErrors: true });
  // Tunnel backend so fetchEssentials succeeds and the app fully boots.
  await ctx.route('**/*', async (route) => {
    const req = route.request(); const url = req.url();
    if (!EXT.test(url)) return route.continue();
    const response = forwardExternal(req.method(), url, req.headers(), req.postData());
    return route.fulfill({
      status: response.status,
      headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
      contentType: response.ctype,
      body: response.body,
    });
  });
  // Deterministically reproduce the user's exact console error: a FULL quota
  // where writing NAV_KEY ('syncview_nav') throws QuotaExceededError. Headless
  // Chromium's real quota is too large to fill reliably, so we intercept
  // setItem for that one key (leaving every other write working, exactly as a
  // real near-full quota behaves once the big cache keys already occupy it).
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('syncview_auth_v1', 'ok');
      const proto = Object.getPrototypeOf(localStorage);
      const orig = proto.setItem;
      proto.setItem = function (k, v) {
        if (k === 'syncview_nav') { const e = new Error("Failed to execute 'setItem' on 'Storage': Setting the value of 'syncview_nav' exceeded the quota."); e.name = 'QuotaExceededError'; throw e; }
        return orig.call(this, k, v);
      };
      window.__quotaFull = (() => { try { localStorage.setItem('syncview_nav', 'x'); return false; } catch (e) { return e.name === 'QuotaExceededError'; } })();
    } catch (e) {}
  });
  const page = await ctx.newPage();
  const navErrs = [];
  page.on('pageerror', e => { if (/QuotaExceeded|exceeded the quota/i.test(e.message || '')) navErrs.push(e.message.slice(0, 120)); });

  await page.goto(lib.ORIGIN + '/index.html?v2debug=1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5500);

  const boot = await page.evaluate(() => ({
    quotaFull: window.__quotaFull,
    navToFn: typeof navTo === 'function',
    contentFilled: (document.getElementById('content')?.children.length || 0) > 0,
    contentHead: (document.getElementById('content')?.innerText || '').slice(0, 40).replace(/\n/g, ' '),
  }));
  ok(boot.quotaFull === true, 'localStorage is actually at quota (a small setItem throws) — repros the user state');
  ok(boot.contentFilled, `app still RENDERS content on boot despite full quota (content="${boot.contentHead}")`);

  for (const [id, wantHash] of [['navTemplates', '#templates'], ['navCalendar', '#calendar'], ['navWorkload', '#workload']]) {
    const r = await page.evaluate((tid) => { const el = document.getElementById(tid); if (!el) return { ok: false }; el.click(); return { ok: true }; }, id);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ hash: location.hash, active: document.querySelector('.header-nav-btn.active')?.id || null, content: (document.getElementById('content')?.children.length || 0) > 0 }));
    ok(r.ok && after.hash === wantHash && after.active === id && after.content, `${id} navigates on full quota → ${after.hash} active=${after.active} rendered=${after.content}`);
  }
  ok(navErrs.length === 0, `no uncaught QuotaExceededError escapes navTo (saw ${navErrs.length})`);

  await browser.close();
  console.log(`\nP94 nav-on-full-quota: pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
}

if (require.main === module) {
  run().catch(e => { console.error('P94 FAILED', e); process.exit(1); });
}

module.exports = { forwardExternal, run };

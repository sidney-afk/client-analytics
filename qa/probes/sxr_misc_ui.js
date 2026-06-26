// sxr_misc_ui.js — Tier 5 misc affordances: copy-card-link (deep link), deep-link
// jump-to-card (focus/highlight), up-next highlight (first not-Approved card), and
// the thumbnail lightbox. Scoped to sidneylaruel; archives what it creates.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + ((!c && x) ? '  -> ' + x : '')); };

const TS = Date.now();
const X = 'sr_mu_x_' + TS, Y = 'sr_mu_y_' + TS;   // X = In Progress (up-next), Y = Approved

(async () => {
  // X at order_index 0 so it sorts FIRST even when another probe's just-archived
  // residue (order_index 1) hasn't finished propagating in a back-to-back run —
  // otherwise the "first not-yet-Approved" assertion is flaky on the shared client.
  Q.up({ id: X, name: 'MU X ' + TS, asset_url: 'https://example.com/x.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png?mu=' + TS, video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress', order_index: '0', created_at: new Date().toISOString() });
  Q.up({ id: Y, name: 'MU Y ' + TS, asset_url: 'https://example.com/y.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', video_status: 'Approved', graphic_status: 'Approved', status: 'Approved', order_index: '1', created_at: new Date().toISOString() });

  const browser = await Q.launch();
  let page;
  try {
    // Open via the DEEP LINK so the focus/jump behavior runs.
    page = await Q.open(browser, `/index.html?sxr=1&v2debug=1#sample-reviews/sidneylaruel/${X}`);
    await page.waitForFunction(() => window.sxrV2Status && window.sxrV2Status().ready, { timeout: 15000 }).catch(() => {});
    await page.waitForFunction((id) => !!document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"]`), X, { timeout: 20000 }).catch(() => {});

    // ── 1) Deep-link jump-to-card: the named card gets the focus highlight. ──
    const focused = await page.evaluate(async (id) => {
      for (let i = 0; i < 20; i++) { const c = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"]`); if (c && c.classList.contains('sxr-card-focus')) return true; await new Promise(r => setTimeout(r, 150)); }
      return false;
    }, X);
    ok(focused, 'a #sample-reviews/<slug>/<id> deep link focuses + highlights that card');

    // ── 2) Up-next: the first not-Approved card (X) is marked current; Approved (Y) isn't. ──
    const upNext = await page.evaluate((ids) => ({ x: !!document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${ids.x}"]`)?.classList.contains('sxr-card-current'), y: !!document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${ids.y}"]`)?.classList.contains('sxr-card-current') }), { x: X, y: Y });
    ok(upNext.x && !upNext.y, 'the first not-yet-Approved card is marked "up next" (Approved card is not)', JSON.stringify(upNext));

    // ── 3) Copy-card-link copies a ?sxr=1#sample-reviews/sidneylaruel/<id> deep link. ──
    const copied = await page.evaluate(async (id) => {
      let captured = null;
      try { navigator.clipboard.writeText = (t) => { captured = t; return Promise.resolve(); }; } catch (e) {}
      const btn = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .sxr-card-link`);
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 200));
      return captured;
    }, X);
    ok(copied && copied.indexOf('#sample-reviews/sidneylaruel/' + X) >= 0 && /[?&]sxr=1/.test(copied), 'copy-card-link copies the per-card deep link', String(copied));

    // ── 4) Thumbnail lightbox: clicking the image opens #sxrLightbox. ──
    const lb = await page.evaluate(async (id) => {
      const img = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .sxr-card-thumb img`);
      if (!img) return { noImg: true };
      img.click();
      await new Promise(r => setTimeout(r, 200));
      const box = document.getElementById('sxrLightbox');
      return { open: !!(box && box.classList.contains('open')), src: box && box.querySelector('img') && box.querySelector('img').src };
    }, X);
    ok(lb && lb.open && lb.src, 'clicking a thumbnail opens the lightbox with the image', JSON.stringify(lb));

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 5)));
  } catch (e) {
    ok(false, 'probe ran without crashing', String(e && e.message));
  } finally {
    if (browser) await browser.close();
    Q.archiveSafe(X); Q.archiveSafe(Y);
  }
  console.log(`PROBE sxr_misc_ui: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });

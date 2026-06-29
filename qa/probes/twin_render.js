// twin_render.js — the MASTER tester (render layer). For each shared SURFACE it
// renders the REAL component for BOTH the original calendar (_cal*/_kasper*) and
// the samples rebuild (_sxr*) with equivalent data, mounts both, and diffs a
// NORMALIZED OBSERVABLE SNAPSHOT:
//   · actions      — every visible button/affordance LABEL (catches a dropped
//                    "Finish reviewing"/"URGENT"/"Close" that function-parity is blind to)
//   · disabled     — which actions are disabled
//   · statusLabels — status / component-state text ("Changes requested" …)
//   · imgFit       — object-fit of any preview image (folds in render-parity)
//
// A label present on the calendar but missing on the samples = a dropped
// affordance = a bug. This is the test type that would have caught the Kasper
// "Request change / Finish reviewing" gap and the cropped thumbnail in one pass.
//
// Run: node qa/probes/twin_render.js   (prints a per-surface divergence report)
const http = require('http'), fs = require('fs'), path = require('path');
let PW; try { PW = require('playwright'); } catch { PW = require('/opt/node22/lib/node_modules/playwright'); }
const ROOT = '/home/user/client-analytics';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

(async () => {
  const server = http.createServer((req, res) => {
    let f = decodeURIComponent(req.url.split('?')[0]); if (f === '/') f = '/index.html';
    const fp = path.join(ROOT, f);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
  await new Promise(r => server.listen(8015, r));
  const browser = await PW.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.route('**/*', r => (r.request().url().includes('localhost:8015') ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8015/index.html?sxr=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof _calRenderInlineCard === 'function' && typeof _sxrRenderInlineCard === 'function', { timeout: 15000 }).catch(() => {});

  const out = await page.evaluate(() => {
    // ---- normalized observable snapshot of a rendered fragment ----
    function snap(html) {
      const host = document.createElement('div'); host.style.width = '440px'; host.innerHTML = String(html || ''); document.body.appendChild(host);
      const labelOf = (el) => {
        let t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t) t = (el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
        return t;
      };
      const actionEls = [...host.querySelectorAll('button, a[class*="btn"], a[class*="tile"], [role="button"]')];
      const actions = [...new Set(actionEls.map(labelOf).filter(t => t && t.length <= 44))];
      const disabled = [...new Set([...host.querySelectorAll('button[disabled]')].map(labelOf).filter(Boolean))];
      const statusLabels = [...new Set([...host.querySelectorAll('.cal-fld-substatus-label, .cal-review-mini-label, .kcard-pending, .cal-review-panel-title, .cal-ap-route')].map(el => (el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
      const img = host.querySelector('img'); const imgFit = img ? getComputedStyle(img).objectFit : null;
      host.remove();
      return { actions, disabled, statusLabels, imgFit };
    }
    const mkPost = (id, o) => Object.assign({
      id, name: 'Twin ' + id, client: 'acme', order_index: 1, scheduled_date: '',
      asset_url: 'https://example.com/v.jpg', thumbnail_url: 'https://example.com/t.jpg',
      video_status: 'Kasper Approval', graphic_status: 'In Progress', status: 'Kasper Approval',
      linear_issue_id: 'https://linear.app/x/VID-1', graphic_linear_issue_id: 'https://linear.app/x/GRA-1',
      kasper_seen: '', kasper_approved_after_tweaks: '', video_comments: [], graphic_comments: []
    }, o || {});

    const R = {};
    // SURFACE 1 — SMM Sheet card
    try {
      const cp = mkPost('smm_c'), sp = mkPost('smm_s');
      calState.posts = [cp]; sxrState.posts = [sp]; calState.view = 'organizer'; sxrState.view = 'organizer';
      R.smmCard = { cal: snap(_calRenderInlineCard(cp, false, false)), sxr: snap(_sxrRenderInlineCard(sp, false, false)) };
    } catch (e) { R.smmCardErr = e.message; }

    // SURFACE 2 — SMM Review panel (graphic at For SMM Approval)
    try {
      calState.view = 'smmreview'; sxrState.view = 'smmreview';
      const cp = mkPost('rv_c', { graphic_status: 'For SMM Approval' }), sp = mkPost('rv_s', { graphic_status: 'For SMM Approval' });
      calState.posts = [cp]; sxrState.posts = [sp];
      R.reviewPanel = { cal: snap(_calReviewPanelHtml(cp, 'graphic')), sxr: snap(_sxrReviewPanelHtml(sp, 'graphic')) };
    } catch (e) { R.reviewPanelErr = e.message; }

    // SURFACE 3 — Kasper review card (video at Kasper Approval, expanded)
    try {
      const cp = mkPost('k_c'), sp = mkPost('k_s');
      const itemC = { post: cp, client: 'Acme', slug: 'acme' }, itemS = { post: sp, client: 'Acme', slug: 'acme' };
      if (typeof _kasperState === 'object') { _kasperState.items = [itemC]; }
      if (typeof _sxrKasperState === 'object') { _sxrKasperState.items = [itemS]; _sxrKasperState.expanded[sp.id] = true; }
      R.kasperCard = { cal: snap(_kasperRenderCard(itemC)), sxr: snap(_sxrKasperRenderCard(itemS)) };
    } catch (e) { R.kasperCardErr = e.message; }

    return R;
  });

  // ---- Client portal surface (needs _isClientLink=true → a real ?c= page) ----
  const cpage = await ctx.newPage();
  cpage.on('pageerror', e => errs.push(e.message));
  await cpage.goto('http://localhost:8015/index.html?sxr=1&c=acme', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await cpage.waitForFunction(() => typeof _calReviewPanelHtml === 'function' && typeof _sxrReviewPanelHtml === 'function', { timeout: 15000 }).catch(() => {});
  try {
    out.clientPanel = await cpage.evaluate(() => {
      function snap(html) {
        const host = document.createElement('div'); host.style.width = '440px'; host.innerHTML = String(html || ''); document.body.appendChild(host);
        const labelOf = (el) => { let t = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (!t) t = (el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim(); return t; };
        const actions = [...new Set([...host.querySelectorAll('button, a[class*="btn"], a[class*="tile"], [role="button"]')].map(labelOf).filter(t => t && t.length <= 44))];
        const disabled = [...new Set([...host.querySelectorAll('button[disabled]')].map(labelOf).filter(Boolean))];
        const statusLabels = [...new Set([...host.querySelectorAll('.cal-fld-substatus-label, .cal-review-mini-label, .kcard-pending, .cal-review-panel-title, .cal-ap-route')].map(el => (el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
        const img = host.querySelector('img'); const imgFit = img ? getComputedStyle(img).objectFit : null;
        host.remove(); return { actions, disabled, statusLabels, imgFit };
      }
      const mk = (id) => ({ id, name: 'CL ' + id, client: 'acme', order_index: 1, asset_url: 'https://example.com/v.jpg', thumbnail_url: 'https://example.com/t.jpg', video_status: 'Client Approval', graphic_status: 'Client Approval', status: 'Client Approval', linear_issue_id: '', graphic_linear_issue_id: '', video_comments: [], graphic_comments: [] });
      const cp = mk('cl_c'), sp = mk('cl_s');
      calState.posts = [cp]; sxrState.posts = [sp]; calState.view = 'review'; sxrState.view = 'review';
      return { cal: snap(_calReviewPanelHtml(cp, 'graphic')), sxr: snap(_sxrReviewPanelHtml(sp, 'graphic')) };
    });
  } catch (e) { out.clientPanelErr = e.message; }
  await cpage.close();

  // ---- intentional-divergence registry (samples is a structural subset) ----
  // Standard is exact-clone, so this list is deliberately TINY: only structural
  // givens agreed with the user. Anything NOT here is a real divergence (a bug).
  const INTENTIONAL = [
    'Alt caption', 'Generate', 'Show more', 'Caption In Progress', 'Caption',   // samples has no caption component
    'Toggle client visibility',                                                  // samples-only creative-direction eye
    'Tag this card with a color',                                                // colour tag — EXCLUDED per SAMPLES_REBUILD_SPEC.md:98
    'Instagram', 'YouTube', 'TikTok', 'Facebook', 'LinkedIn',                    // platforms strip — EXCLUDED per spec:98
  ];
  const isIntentional = (label) => INTENTIONAL.some(i => label === i || label.includes(i));

  // ---- report ----
  const divergences = [];
  function report(surface, pair, errKey) {
    if (out[errKey]) { console.log('  ⚠ ' + surface + ' — could not render: ' + out[errKey]); divergences.push({ surface, type: 'render-error', detail: out[errKey], real: true }); return; }
    const { cal, sxr } = pair;
    const missing = cal.actions.filter(a => !sxr.actions.includes(a));     // calendar has it, samples doesn't → dropped affordance
    const extra = sxr.actions.filter(a => !cal.actions.includes(a));
    const stMissing = cal.statusLabels.filter(s => !sxr.statusLabels.includes(s));
    const imgDiff = (cal.imgFit && sxr.imgFit && cal.imgFit !== sxr.imgFit) ? (cal.imgFit + ' vs ' + sxr.imgFit) : null;
    const missingReal = missing.filter(a => !isIntentional(a));
    const missingByDesign = missing.filter(isIntentional);
    const ok = !missingReal.length && !stMissing.length && !imgDiff;
    console.log('\n' + (ok ? '  ✓ ' : '✗ ') + surface);
    console.log('     calendar actions: ' + JSON.stringify(cal.actions));
    console.log('     samples  actions: ' + JSON.stringify(sxr.actions));
    if (missingReal.length) { console.log('     ✗ MISSING on samples (BUG): ' + JSON.stringify(missingReal)); divergences.push({ surface, type: 'missing-action', detail: missingReal, real: true }); }
    if (missingByDesign.length) console.log('     ◌ missing but by-design: ' + JSON.stringify(missingByDesign));
    if (stMissing.length) { console.log('     ✗ MISSING state labels (BUG): ' + JSON.stringify(stMissing)); divergences.push({ surface, type: 'missing-state', detail: stMissing, real: true }); }
    if (imgDiff) { console.log('     ✗ image object-fit differs (BUG): ' + imgDiff); divergences.push({ surface, type: 'visual', detail: imgDiff, real: true }); }
    const extraReal = extra.filter(a => !isIntentional(a));
    if (extraReal.length) console.log('     · extra on samples (review): ' + JSON.stringify(extraReal));
  }

  console.log('═══ TWIN render-diff: calendar vs samples (observable snapshot) ═══');
  report('SMM Sheet card', out.smmCard, 'smmCardErr');
  report('SMM Review panel', out.reviewPanel, 'reviewPanelErr');
  report('Kasper review card', out.kasperCard, 'kasperCardErr');
  report('Client review panel', out.clientPanel, 'clientPanelErr');

  console.log('\n  page errors:', errs.length, errs.slice(0, 3));
  console.log('\n' + '─'.repeat(64));
  console.log('RESULT: ' + (divergences.length ? divergences.length + ' DIVERGENCE(S) found' : 'no divergences'));
  // emit machine-readable for the sweep catalog
  fs.writeFileSync('/tmp/twin_render_result.json', JSON.stringify(divergences, null, 2));
  await browser.close(); server.close();
  process.exit(divergences.length ? 1 : 0);
})().catch(e => { console.error('TWIN-RENDER ERROR', e && e.stack || e); process.exit(2); });

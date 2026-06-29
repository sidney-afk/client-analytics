// render_parity.js — RENDER parity: the missing test type. Earlier probes diffed
// function LOGIC; this renders the actual markup each side produces, injects it
// into the DOM, and diffs the COMPUTED visual CSS (object-fit, max dimensions,
// container structure). It catches "looks different" bugs that logic checks miss
// — e.g. a review thumbnail shown whole on the calendar but cropped on samples.
//
// Run: node qa/probes/render_parity.js
const http = require('http'), fs = require('fs'), path = require('path');
let PW; try { PW = require('playwright'); } catch { PW = require('/opt/node22/lib/node_modules/playwright'); }
const ROOT = '/home/user/client-analytics';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const fails = [];
function diff(name, cal, sxr, keys) {
  const bad = keys.filter(k => String(cal[k]) !== String(sxr[k]));
  const ok = bad.length === 0;
  console.log((ok ? '  PARITY  ' : '✗ DIVERGE ') + name);
  for (const k of keys) {
    const m = String(cal[k]) !== String(sxr[k]);
    console.log('       ' + (m ? '✗' : ' ') + ' ' + k.padEnd(12) + ' calendar=' + JSON.stringify(cal[k]) + '  samples=' + JSON.stringify(sxr[k]));
  }
  if (!ok) fails.push({ name, bad });
}

(async () => {
  const server = http.createServer((req, res) => {
    let f = decodeURIComponent(req.url.split('?')[0]); if (f === '/') f = '/index.html';
    const fp = path.join(ROOT, f);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
  await new Promise(r => server.listen(8014, r));
  const browser = await PW.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.route('**/*', r => (r.request().url().includes('localhost:8014') ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8014/index.html?sxr=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof _calReviewComponentPreview === 'function' && typeof _sxrReviewComponentPreview === 'function', { timeout: 15000 }).catch(() => {});

  const out = await page.evaluate(() => {
    const mkPost = (id) => ({
      id, name: 'Render ' + id, client: 'acme',
      asset_url: 'https://example.com/video-thumb.jpg',
      thumbnail_url: 'https://example.com/thumb.jpg',
      linear_issue_id: '', graphic_linear_issue_id: '',
      video_status: 'Client Approval', graphic_status: 'Client Approval', status: 'Client Approval',
      video_comments: [], graphic_comments: []
    });
    // Render the markup, mount it, read the computed CSS of the preview image.
    const dig = (html) => {
      const host = document.createElement('div'); host.style.width = '360px'; host.innerHTML = html; document.body.appendChild(host);
      const img = host.querySelector('img');
      const info = { hasImg: !!img, rootClass: host.firstElementChild ? host.firstElementChild.className : '' };
      if (img) { const cs = getComputedStyle(img); info.objectFit = cs.objectFit; info.maxWidth = cs.maxWidth; info.maxHeight = cs.maxHeight; }
      host.remove();
      return info;
    };
    const p = mkPost('g1');
    const R = {
      graphic: { cal: dig(_calReviewComponentPreview(p, 'graphic')), sxr: dig(_sxrReviewComponentPreview(p, 'graphic')) },
      video: { cal: dig(_calReviewComponentPreview(p, 'video')), sxr: dig(_sxrReviewComponentPreview(p, 'video')) },
    };

    // ── Sheet-card thumbnail (full inline card render) ──
    try {
      const cp = mkPost('card_c'), sp = mkPost('card_s');
      calState.posts = [cp]; sxrState.posts = [sp];
      const digThumb = (html) => {
        const host = document.createElement('div'); host.style.width = '320px'; host.innerHTML = html; document.body.appendChild(host);
        const img = host.querySelector('.cal-card-thumb img');
        const info = { hasThumbImg: !!img };
        if (img) { const cs = getComputedStyle(img); info.objectFit = cs.objectFit; info.maxHeight = cs.maxHeight; info.maxWidth = cs.maxWidth; }
        host.remove(); return info;
      };
      R.card = { cal: digThumb(_calRenderInlineCard(cp, false, false)), sxr: digThumb(_sxrRenderInlineCard(sp, false, false)) };
    } catch (e) { R.cardErr = e.message; }

    // ── Notes button: unread dot + AAT badge + count (computed styling) ──
    try {
      const now = new Date().toISOString();
      const np = mkPost('nb');
      np.kasper_approved_after_tweaks = 'video'; np.video_status = 'For SMM Approval';
      np.video_comments = [{ id: 'c1', parent_id: null, role: 'client', audience: 'client', is_tweak: false, body: 'hi', created_at: now, updated_at: now }];
      np.comments = np.video_comments;
      const digBtn = (html) => {
        const host = document.createElement('div'); host.innerHTML = html; document.body.appendChild(host);
        const dot = host.querySelector('.cal-comments-dot'), badge = host.querySelector('.cal-aat-badge'), cnt = host.querySelector('.cal-comments-count');
        const info = { hasDot: !!dot, hasBadge: !!badge };
        if (badge) { const cs = getComputedStyle(badge); info.badgeBg = cs.backgroundColor; info.badgeColor = cs.color; }
        if (dot) { const cs = getComputedStyle(dot); info.dotBg = cs.backgroundColor; }
        host.remove(); return info;
      };
      R.notesBtn = { cal: digBtn(_calCommentsBtnHtml(np, np.id)), sxr: digBtn(_sxrCommentsBtnHtml(np, np.id)) };
    } catch (e) { R.notesErr = e.message; }

    // ── Status substatus pills: per-status color (video=Kasper, graphic=Tweaks) ──
    try {
      const cp = mkPost('pill_c'), sp = mkPost('pill_s');
      cp.video_status = sp.video_status = 'Kasper Approval';
      cp.graphic_status = sp.graphic_status = 'Tweaks Needed';
      cp.linear_issue_id = sp.linear_issue_id = 'https://linear.app/x/VID-1';
      cp.graphic_linear_issue_id = sp.graphic_linear_issue_id = 'https://linear.app/x/GRA-1';
      calState.posts = [cp]; sxrState.posts = [sp];
      const digPills = (html) => {
        const host = document.createElement('div'); host.style.width = '320px'; host.innerHTML = html; document.body.appendChild(host);
        const t = [...host.querySelectorAll('.cal-fld-substatus-trigger')];
        // index 0 = video, 1 = graphic (calendar also has a caption pill at 2 — ignored)
        const info = {};
        if (t[0]) { const cs = getComputedStyle(t[0]); info.videoBg = cs.backgroundColor; info.videoFg = cs.color; }
        if (t[1]) { const cs = getComputedStyle(t[1]); info.graphicBg = cs.backgroundColor; info.graphicFg = cs.color; }
        host.remove(); return info;
      };
      R.pills = { cal: digPills(_calRenderInlineCard(cp, false, false)), sxr: digPills(_sxrRenderInlineCard(sp, false, false)) };
    } catch (e) { R.pillsErr = e.message; }

    // ── Review-tab approve button (SMM mode) ──
    try {
      calState.view = 'smmreview'; sxrState.view = 'smmreview';
      const cp = mkPost('rp_c'), sp = mkPost('rp_s');
      cp.graphic_status = sp.graphic_status = 'For SMM Approval';
      cp.graphic_linear_issue_id = sp.graphic_linear_issue_id = 'https://linear.app/x/GRA-1';
      calState.posts = [cp]; sxrState.posts = [sp];
      const digApprove = (html) => {
        const host = document.createElement('div'); host.style.width = '360px'; host.innerHTML = html; document.body.appendChild(host);
        const btn = host.querySelector('.cal-review-approve-btn');
        const info = { hasApprove: !!btn };
        if (btn) { const cs = getComputedStyle(btn); info.bg = cs.backgroundColor; info.color = cs.color; }
        host.remove(); return info;
      };
      R.reviewPanel = { cal: digApprove(_calReviewPanelHtml(cp, 'graphic')), sxr: digApprove(_sxrReviewPanelHtml(sp, 'graphic')) };
    } catch (e) { R.reviewPanelErr = e.message; }

    return R;
  });

  console.log('═══ RENDER parity: calendar vs samples (computed visual CSS) ═══\n');
  diff('Review: thumbnail (graphic) preview', out.graphic.cal, out.graphic.sxr, ['hasImg', 'objectFit', 'maxWidth', 'maxHeight']);
  diff('Review: video preview', out.video.cal, out.video.sxr, ['hasImg', 'objectFit', 'maxHeight']);
  if (out.cardErr) console.log('  ERR Sheet-card thumb:', out.cardErr);
  else diff('Sheet card: thumbnail image', out.card.cal, out.card.sxr, ['hasThumbImg', 'objectFit', 'maxHeight', 'maxWidth']);
  if (out.notesErr) console.log('  ERR Notes button:', out.notesErr);
  else diff('Notes button: dot + AAT badge', out.notesBtn.cal, out.notesBtn.sxr, ['hasDot', 'hasBadge', 'badgeBg', 'badgeColor', 'dotBg']);
  if (out.pillsErr) console.log('  ERR status pills:', out.pillsErr);
  else diff('Status pills: video=Kasper, graphic=Tweaks', out.pills.cal, out.pills.sxr, ['videoBg', 'videoFg', 'graphicBg', 'graphicFg']);
  if (out.reviewPanelErr) console.log('  ERR review panel:', out.reviewPanelErr);
  else diff('Review panel: approve button', out.reviewPanel.cal, out.reviewPanel.sxr, ['hasApprove', 'bg', 'color']);

  console.log('\n  page errors:', errs.length, errs.slice(0, 3));
  console.log('\n' + (fails.length
    ? 'RESULT: ' + fails.length + ' RENDER DIVERGENCE(S) — the preview looks different from the calendar:\n  - ' + fails.map(f => f.name + ' (' + f.bad.join(', ') + ')').join('\n  - ')
    : 'RESULT: RENDER PARITY HELD'));
  await browser.close(); server.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('RENDER-PARITY ERROR', e && e.stack || e); process.exit(2); });

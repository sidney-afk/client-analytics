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
    return {
      graphic: { cal: dig(_calReviewComponentPreview(p, 'graphic')), sxr: dig(_sxrReviewComponentPreview(p, 'graphic')) },
      video: { cal: dig(_calReviewComponentPreview(p, 'video')), sxr: dig(_sxrReviewComponentPreview(p, 'video')) },
    };
  });

  console.log('═══ RENDER parity: review preview (calendar vs samples) ═══\n');
  diff('Thumbnail (graphic) preview', out.graphic.cal, out.graphic.sxr, ['hasImg', 'objectFit', 'maxWidth', 'maxHeight']);
  diff('Video preview', out.video.cal, out.video.sxr, ['hasImg', 'objectFit', 'maxHeight']);

  console.log('\n  page errors:', errs.length, errs.slice(0, 3));
  console.log('\n' + (fails.length
    ? 'RESULT: ' + fails.length + ' RENDER DIVERGENCE(S) — the preview looks different from the calendar:\n  - ' + fails.map(f => f.name + ' (' + f.bad.join(', ') + ')').join('\n  - ')
    : 'RESULT: RENDER PARITY HELD'));
  await browser.close(); server.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('RENDER-PARITY ERROR', e && e.stack || e); process.exit(2); });

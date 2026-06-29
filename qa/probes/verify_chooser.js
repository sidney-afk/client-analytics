// verify_chooser.js — functional check that the ported _sxr resolve chooser not
// only OPENS but ROUTES correctly: each button flips the sub-status the right way.
const http = require('http'), fs = require('fs'), path = require('path');
let PW; try { PW = require('playwright'); } catch { PW = require('/opt/node22/lib/node_modules/playwright'); }
const ROOT = '/home/user/client-analytics';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const results = [];
function check(name, got, want) { const ok = got === want; console.log((ok ? '  OK   ' : '✗ FAIL ') + name.padEnd(46) + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); if (!ok) results.push(name); }
(async () => {
  const server = http.createServer((req, res) => {
    let f = decodeURIComponent(req.url.split('?')[0]); if (f === '/') f = '/index.html';
    const fp = path.join(ROOT, f);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
  await new Promise(r => server.listen(8011, r));
  const browser = await PW.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.route('**/*', r => (r.request().url().includes('localhost:8011') ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8011/index.html?sxr=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof _sxrToggleCommentDone === 'function', { timeout: 15000 }).catch(() => {});

  const out = await page.evaluate(() => {
    const R = {};
    const now = () => new Date().toISOString();
    function mkC(role, body) { return { id: 'c_' + Math.random().toString(36).slice(2, 9), parent_id: null, author: role === 'client' ? 'Client' : 'SMM', role, is_tweak: true, audience: role === 'client' ? 'client' : 'internal', round: 1, body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' }; }
    function mkPost(id) {
      const vc = [mkC('client', 'please change X')];
      return { id, name: 'Verify ' + id, order_index: 1, client: 'acme', video_status: 'For SMM Approval', graphic_status: 'In Progress', status: 'For SMM Approval', asset_url: 'https://frame.io/x', thumbnail_url: '', linear_issue_id: '', graphic_linear_issue_id: '', kasper_seen: '', kasper_approved_after_tweaks: '', comments: vc, video_comments: vc, graphic_comments: [], video_tweaks: JSON.stringify(vc), graphic_tweaks: '[]' };
    }
    // Drive Notes mark-done → chooser → click a button → read resulting state.
    function runMarkDone(destBtnId) {
      const p = mkPost('md_' + destBtnId);
      sxrState.posts = [p]; sxrState.view = 'smmreview'; _sxrOpenCommentsPid = p.id;
      const cId = p.video_comments[0].id;
      _sxrToggleCommentDone(cId);
      const overlay = document.getElementById('resolveDestOverlay');
      const opened = !!(overlay && overlay.classList.contains('active'));
      const btn = document.getElementById(destBtnId);
      if (btn) btn.click();
      const root = (sxrState.posts[0].video_comments || []).find(c => c.id === cId);
      return { opened, done: !!(root && root.done), video_status: sxrState.posts[0].video_status, overlayClosed: !(overlay && overlay.classList.contains('active')) };
    }
    R.kasper = runMarkDone('resolveDestKasper');
    R.client = runMarkDone('resolveDestClient');
    R.approve = runMarkDone('resolveDestApprove');
    R.stay = runMarkDone('resolveDestStay');

    // Review-tab approve with an open change-request → chooser → pick client.
    (function () {
      const p = mkPost('ra1'); sxrState.posts = [p]; sxrState.view = 'smmreview';
      _sxrReviewApprove(p.id, 'video', 'kasper');
      const overlay = document.getElementById('resolveDestOverlay');
      const opened = !!(overlay && overlay.classList.contains('active'));
      const c = document.getElementById('resolveDestClient'); if (c) c.click();
      const root = (sxrState.posts[0].video_comments || [])[0];
      R.review = { opened, done: !!(root && root.done), video_status: sxrState.posts[0].video_status };
    })();

    // Mid-list mark-done (NOT the last) must NOT open the chooser — resolves in place.
    (function () {
      const p = mkPost('multi');
      const c2 = { id: 'c_second', parent_id: null, author: 'Client', role: 'client', is_tweak: true, audience: 'client', round: 2, body: 'and Y', created_at: now(), updated_at: now(), done: false };
      p.video_comments.push(c2); p.comments = p.video_comments;
      sxrState.posts = [p]; sxrState.view = 'smmreview'; _sxrOpenCommentsPid = p.id;
      const overlay = document.getElementById('resolveDestOverlay'); if (overlay) overlay.classList.remove('active');
      _sxrToggleCommentDone(p.video_comments[0].id);
      R.midList = { chooserOpened: !!(overlay && overlay.classList.contains('active')), firstDone: !!p.video_comments[0].done, status: p.video_status };
    })();
    return R;
  });

  console.log('=== resolve-chooser routing verification ===');
  check('mark-done → Kasper: chooser opened', out.kasper.opened, true);
  check('mark-done → Kasper: comment resolved', out.kasper.done, true);
  check('mark-done → Kasper: status → Kasper Approval', out.kasper.video_status, 'Kasper Approval');
  check('mark-done → Client: status → Client Approval', out.client.video_status, 'Client Approval');
  check('mark-done → Approve: status → Approved', out.approve.video_status, 'Approved');
  check('mark-done → Stay: comment resolved', out.stay.done, true);
  check('mark-done → Stay: status UNCHANGED (For SMM Approval)', out.stay.video_status, 'For SMM Approval');
  check('mark-done: overlay closes after pick', out.kasper.overlayClosed, true);
  check('review-approve: chooser opened', out.review.opened, true);
  check('review-approve → Client: status → Client Approval', out.review.video_status, 'Client Approval');
  check('mid-list mark-done: chooser NOT opened', out.midList.chooserOpened, false);
  check('mid-list mark-done: that one resolved in place', out.midList.firstDone, true);
  check('mid-list mark-done: status unchanged', out.midList.status, 'For SMM Approval');
  console.log('\npage errors:', errs.length, errs.slice(0, 3));
  console.log('\nRESULT: ' + (results.length ? results.length + ' FAILED:\n  - ' + results.join('\n  - ') : 'ALL ROUTING CHECKS PASSED'));
  await browser.close(); server.close();
  process.exit(results.length ? 1 : 0);
})().catch(e => { console.error('VERIFY ERROR', e && e.stack || e); process.exit(2); });

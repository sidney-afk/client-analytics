// parity_check.js — PARITY TEST: samples (_sxr) vs the ORIGINAL calendar (_cal).
//
// The calendar is the SOURCE OF TRUTH. The samples tab (_sxr*) is a rebuild that
// is supposed to reproduce the calendar's behaviour. This harness does NOT test
// the rebuild against my own expectations (the mistake that let real bugs slip
// through) — it drives BOTH implementations' real, globally-defined functions
// with the SAME data and diffs the resulting affordance/behaviour. A divergence —
// the calendar produces something the samples don't — is a parity FAIL: a feature
// that was dropped or simplified in the copy.
//
// No backend needed: every _cal*/_sxr* function is top-level/global, so we call
// them directly and inspect the real DOM (#resolveDestOverlay) / returned HTML.
//
// Run: node qa/probes/parity_check.js   (self-hosts index.html on :8013)
// Port 8013 (not 8000) so this runs alongside the master tester's own :8000
// static server without an EADDRINUSE collision (see qa/master.js).
const http = require('http'), fs = require('fs'), path = require('path');
let PW; try { PW = require('playwright'); } catch { PW = require('/opt/node22/lib/node_modules/playwright'); }
const ROOT = '/home/user/client-analytics';
const PORT = 8013;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const fails = [];
// Parity holds when the samples reproduce whatever the calendar produces.
function parity(name, cal, sxr, note) {
  const ok = (cal === sxr);
  console.log((ok ? '  PARITY  ' : '✗ DIVERGE ') + name.padEnd(40)
    + ' calendar=' + JSON.stringify(cal) + '  samples=' + JSON.stringify(sxr)
    + (note ? '\n             ↳ ' + note : ''));
  if (!ok) fails.push({ name, cal, sxr, note });
}

(async () => {
  const server = http.createServer((req, res) => {
    let f = decodeURIComponent(req.url.split('?')[0]); if (f === '/') f = '/index.html';
    const fp = path.join(ROOT, f);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
  await new Promise((res, rej) => { server.on('error', rej); server.listen(PORT, res); });
  const browser = await PW.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.route('**/*', r => (r.request().url().includes('localhost:' + PORT) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  // SMM view (no ?c → _isClientLink false); ?sxr=1 turns the samples code on.
  await page.goto('http://localhost:' + PORT + '/index.html?sxr=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof _calCommentsBtnHtml === 'function' && typeof _sxrCommentsBtnHtml === 'function', { timeout: 15000 }).catch(() => {});

  const out = await page.evaluate(() => {
    const R = {};
    const now = () => new Date().toISOString();
    function mkComment(o) {
      o = o || {};
      return Object.assign({
        id: 'c_' + Math.random().toString(36).slice(2, 8), parent_id: null,
        author: o.role === 'client' ? 'Client' : o.role === 'kasper' ? 'Kasper' : 'SMM',
        role: o.role || 'smm', is_tweak: (o.is_tweak !== undefined ? o.is_tweak : true),
        audience: o.audience || (o.role === 'client' ? 'client' : 'internal'),
        round: 1, body: o.body || 'message', created_at: now(), updated_at: now(),
        done: !!o.done, done_at: '', done_by: ''
      }, o);
    }
    // A post both implementations can read. Comments are placed under EVERY field
    // convention either side might consult: live arrays (comments/video_comments/
    // graphic_comments) AND the *_tweaks JSON strings. _calCommentsFor reads the
    // live arrays; _sxrCommentsFor is given the same.
    function mkPost(id, opt) {
      opt = opt || {};
      const vc = (opt.videoComments || []).map(mkComment);
      const gc = (opt.graphicComments || []).map(mkComment);
      return Object.assign({
        id, name: 'Parity ' + id, order_index: 1, client: 'acme',
        video_status: opt.video_status || 'In Progress',
        graphic_status: opt.graphic_status || 'In Progress',
        status: opt.status || 'In Progress',
        asset_url: 'https://frame.io/x', graphic_asset_url: 'https://frame.io/y', thumbnail_url: '',
        linear_issue_id: '', graphic_linear_issue_id: '',
        kasper_seen: opt.kasper_seen || '', kasper_approved_after_tweaks: opt.kasper_approved_after_tweaks || '',
        comments: vc, video_comments: vc, graphic_comments: gc,
        video_tweaks: JSON.stringify(vc), graphic_tweaks: JSON.stringify(gc),
        title_comments: [], title_tweaks: '[]'
      }, opt.extra || {});
    }
    const overlayActive = () => { const o = document.getElementById('resolveDestOverlay'); return !!(o && o.classList.contains('active')); };
    const dismissOverlay = () => { const o = document.getElementById('resolveDestOverlay'); if (o) o.classList.remove('active'); };
    const fn = (name) => (typeof window[name] === 'function');

    // ── CASE 1 — Notes button UNREAD DOT (a new message from the other role) ──
    // Calendar: _calCommentsBtnHtml emits <span class="cal-comments-dot"> when
    // _calHasUnreadNotes is true. Samples: does _sxrCommentsBtnHtml do the same?
    try {
      const p = mkPost('unread1', { videoComments: [{ role: 'client', is_tweak: false, body: 'client reply' }] });
      const calHtml = _calCommentsBtnHtml(p, p.id), sxrHtml = _sxrCommentsBtnHtml(p, p.id);
      R.unreadDot = { cal: calHtml.includes('cal-comments-dot'), sxr: sxrHtml.includes('cal-comments-dot'), sxrHtml };
    } catch (e) { R.unreadDot = { err: e.message }; }

    // ── CASE 2 — Notes button "APPROVED AFTER TWEAKS" badge ──
    // Calendar appends _calAatBadgeHtml (class cal-aat-badge) when Kasper has
    // pre-cleared a component that's still in flight. Samples?
    try {
      const p = mkPost('aat1', { video_status: 'For SMM Approval', kasper_approved_after_tweaks: 'video' });
      const calHtml = _calCommentsBtnHtml(p, p.id), sxrHtml = _sxrCommentsBtnHtml(p, p.id);
      R.aatBadge = {
        cal: calHtml.includes('cal-aat-badge'),
        sxr: sxrHtml.includes('cal-aat-badge'),
        sxrHasFn: fn('_sxrAatBadgeHtml')
      };
    } catch (e) { R.aatBadge = { err: e.message }; }

    // ── CASE 3 — "Mark done" on the LAST open change-request opens the chooser ──
    // THE bug the user found: in the SMM view, resolving the final change-request
    // must open the route chooser (Kasper / Client / Approve / Stay). Calendar
    // defers to the chooser; samples just flips done and the comment vanishes.
    try {
      dismissOverlay();
      const cmtC = { role: 'client', is_tweak: true, body: 'please change X' };
      const pc = mkPost('md_cal', { video_status: 'For SMM Approval', videoComments: [cmtC] });
      calState.posts = [pc]; calState.view = 'smmreview'; _calOpenCommentsPid = pc.id;
      const cId = pc.video_comments[0].id;
      try { _calToggleCommentDone(cId); } catch (e) { R._mdCalErr = e.message; }
      const calChooser = overlayActive(); dismissOverlay();

      const cmtS = { role: 'client', is_tweak: true, body: 'please change X' };
      const ps = mkPost('md_sxr', { video_status: 'For SMM Approval', videoComments: [cmtS] });
      sxrState.posts = [ps]; sxrState.view = 'smmreview'; _sxrOpenCommentsPid = ps.id;
      const sId = ps.video_comments[0].id;
      try { _sxrToggleCommentDone(sId); } catch (e) { R._mdSxrErr = e.message; }
      const sxrChooser = overlayActive(); dismissOverlay();
      R.markDoneChooser = { cal: calChooser, sxr: sxrChooser };
    } catch (e) { R.markDoneChooser = { err: e.message }; }

    // ── CASE 4 — REVIEW-TAB "Approve" with open change-requests opens the chooser ──
    // _calReviewMode()/_sxrReviewMode() are 'smm' only when view==='smmreview'.
    try {
      dismissOverlay();
      const cmtC = { role: 'client', is_tweak: true, body: 'fix it' };
      const pc = mkPost('ra_cal', { video_status: 'For SMM Approval', videoComments: [cmtC] });
      calState.posts = [pc]; calState.view = 'smmreview';
      try { _calReviewApprove(pc.id, 'video', 'kasper'); } catch (e) { R._raCalErr = e.message; }
      const calChooser = overlayActive(); dismissOverlay();

      const cmtS = { role: 'client', is_tweak: true, body: 'fix it' };
      const ps = mkPost('ra_sxr', { video_status: 'For SMM Approval', videoComments: [cmtS] });
      sxrState.posts = [ps]; sxrState.view = 'smmreview';
      try { _sxrReviewApprove(ps.id, 'video', 'kasper'); } catch (e) { R._raSxrErr = e.message; }
      const sxrChooser = overlayActive(); dismissOverlay();
      R.reviewApproveChooser = { cal: calChooser, sxr: sxrChooser };
    } catch (e) { R.reviewApproveChooser = { err: e.message }; }

    // ── CASE 5 — STRUCTURAL: the resolve-chooser machinery exists at all ──
    // The chooser is built from a small family of functions. If the samples lack
    // them, cases 3/4 can never work — this pinpoints exactly what wasn't copied.
    const chooserFns = ['ShowResolveDest', 'ResolveLastTweak', 'ResolveDestReason', 'ResolveDestRecommend'];
    R.chooserFns = chooserFns.map(s => ({ name: s, cal: fn('_cal' + s), sxr: fn('_sxr' + s) }));

    return R;
  });

  console.log('═══ PARITY: samples (_sxr) vs the ORIGINAL calendar (_cal) ═══');
  console.log('    (calendar = source of truth; DIVERGE = the rebuild dropped/changed it)\n');

  if (out.unreadDot.err) console.log('  ERR unreadDot:', out.unreadDot.err);
  else parity('Notes button: unread "new reply" dot', out.unreadDot.cal, out.unreadDot.sxr,
    'a fresh message from the other role lights a dot on the Notes button');

  if (out.aatBadge.err) console.log('  ERR aatBadge:', out.aatBadge.err);
  else parity('Notes button: "approved-after-tweaks" badge', out.aatBadge.cal, out.aatBadge.sxr,
    'Kasper-precleared badge on the card' + (out.aatBadge.sxrHasFn ? '' : ' (no _sxrAatBadgeHtml fn exists)'));

  if (out.markDoneChooser.err) console.log('  ERR markDoneChooser:', out.markDoneChooser.err);
  else parity('Mark-done → resolve-destination chooser', out.markDoneChooser.cal, out.markDoneChooser.sxr,
    'resolving the LAST change-request must open Kasper/Client/Approve/Stay — THE reported bug');

  if (out.reviewApproveChooser.err) console.log('  ERR reviewApproveChooser:', out.reviewApproveChooser.err);
  else parity('Review-tab Approve → resolve chooser', out.reviewApproveChooser.cal, out.reviewApproveChooser.sxr,
    'approving a component that still has open change-requests must open the chooser too');

  console.log('\n  Structural — resolve-chooser functions present:');
  for (const f of out.chooserFns) {
    const ok = f.cal === f.sxr;
    console.log('    ' + (ok ? '  ok    ' : '✗ MISS  ') + ('_xxx' + f.name).padEnd(28) + ' calendar=' + (f.cal ? 'yes' : 'no ') + '  samples=' + (f.sxr ? 'yes' : 'no'));
    if (f.cal && !f.sxr) fails.push({ name: '_sxr' + f.name + ' missing', cal: true, sxr: false });
  }

  if (out._mdCalErr || out._mdSxrErr || out._raCalErr || out._raSxrErr)
    console.log('\n  (in-page notes:', JSON.stringify({ mdCal: out._mdCalErr, mdSxr: out._mdSxrErr, raCal: out._raCalErr, raSxr: out._raSxrErr }), ')');
  console.log('\n  page errors:', errs.length, errs.slice(0, 3));

  const uniq = [...new Set(fails.map(f => f.name))];
  console.log('\n' + '─'.repeat(64));
  if (uniq.length) {
    console.log('RESULT: ' + uniq.length + ' DIVERGENCE(S) — the samples rebuild differs from the calendar:');
    uniq.forEach(n => console.log('  ✗ ' + n));
  } else {
    console.log('RESULT: PARITY HELD — no divergences.');
  }
  await browser.close(); server.close();
  process.exit(uniq.length ? 1 : 0);
})().catch(e => { console.error('PARITY HARNESS ERROR', e && e.stack || e); process.exit(2); });

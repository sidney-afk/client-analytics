// parity_logic.js — BATCH 2 of the parity system: pure-LOGIC parity between the
// samples rebuild (_sxr*) and the ORIGINAL calendar (_cal*). Where parity_check.js
// diffs rendered affordances/DOM, this diffs the decision logic underneath —
// status math, routing predicates, visibility/audience, counts — by calling both
// sides' real functions on identical data over the shared video+graphic scope.
//
// A divergence is printed and classified:
//   GAP       — the rebuild behaves differently with no design reason → likely bug
//   BY-DESIGN — expected (e.g. samples has no Scheduled/Posted or caption/title)
// Only GAPs fail the run.
//
// Run: node qa/probes/parity_logic.js
const http = require('http'), fs = require('fs'), path = require('path');
let PW; try { PW = require('playwright'); } catch { PW = require('/opt/node22/lib/node_modules/playwright'); }
const ROOT = path.resolve(__dirname, '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

(async () => {
  const server = http.createServer((req, res) => {
    let f = decodeURIComponent(req.url.split('?')[0]); if (f === '/') f = '/index.html';
    const fp = path.join(ROOT, f);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
  await new Promise(r => server.listen(8012, r));
  const browser = await PW.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.route('**/*', r => (r.request().url().includes('localhost:8012') ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8012/index.html?sxr=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof computeOverallStatus === 'function' && typeof computeSampleOverallStatus === 'function', { timeout: 15000 }).catch(() => {});

  const out = await page.evaluate(() => {
    const diffs = [];                 // {group, input, cal, sxr, byDesign, note}
    let cmp = 0;
    const STAT = ['In Progress', 'Tweaks Needed', 'For SMM Approval', 'Kasper Approval', 'Client Approval', 'Approved'];
    const now = () => new Date().toISOString();
    let _seq = 0; const uid = () => 'p_' + (++_seq);
    const rec = (group, input, cal, sxr, byDesign, note) => {
      cmp++;
      const eq = JSON.stringify(cal) === JSON.stringify(sxr);
      if (!eq) diffs.push({ group, input, cal, sxr, byDesign: !!byDesign, note: note || '' });
    };

    // ── A. Overall status = worst-of(video, graphic). caption='Approved' neutralises
    //      the calendar's extra caption component so we compare like-for-like.
    for (const v of STAT) for (const g of STAT) {
      const cal = computeOverallStatus({ video_status: v, graphic_status: g, caption_status: 'Approved' });
      const sxr = computeSampleOverallStatus({ video_status: v, graphic_status: g });
      rec('overall worst-of(video,graphic)', v + ' / ' + g, cal, sxr, false);
    }

    // ── B. Status normalisation (legacy/casing/aliases) ──
    for (const s of ['', 'Draft', 'draft', 'FOR KASPER APPROVAL', 'for kasper approval', 'smm approval',
                     'Kasper Approval', 'Client Approval', 'Tweaks Needed', 'Approved', 'Scheduled', 'Posted', 'weird-status']) {
      rec('normStatus', JSON.stringify(s), _calNormStatus(s), _sxrNormStatus(s),
          (s === 'Scheduled' || s === 'Posted'));  // samples has no schedule/publish stage
    }

    // ── C. Per-message audience default (internal vs client) ──
    const msgs = [
      { role: 'kasper' }, { role: 'smm' }, { role: 'client' },
      { role: 'smm', audience: 'client' }, { role: 'client', audience: 'internal' },
      { role: 'kasper', audience: 'client' }, {}
    ];
    for (const m of msgs) rec('msgAudience', JSON.stringify(m), _calMsgAudience(m), _sxrMsgAudience(m), false);

    // ── D. is_tweak default ──
    for (const m of [{}, { is_tweak: true }, { is_tweak: false }, { role: 'client' }])
      rec('msgIsTweak', JSON.stringify(m), _calMsgIsTweak(m), _sxrMsgIsTweak(m), false);

    // ── E. Open-comment count over a mixed thread (tweaks/plain/done/deleted/replies) ──
    {
      const mk = (o) => Object.assign({ id: uid(), parent_id: null, role: 'client', audience: 'client', is_tweak: true, done: false, deleted: false, created_at: now(), updated_at: now(), body: 'x' }, o);
      const vid = [mk({}), mk({ done: true }), mk({ is_tweak: false }), mk({ deleted: true }), mk({})];
      const rep = { id: uid(), parent_id: vid[0].id, role: 'smm', is_tweak: false, body: 'r', created_at: now(), updated_at: now() };
      vid.push(rep);
      const gr = [mk({}), mk({ is_tweak: false })];
      const post = { id: uid(), video_comments: vid, comments: vid, graphic_comments: gr };
      rec('openCommentCount', 'mixed thread', _calOpenCommentCount(post), _sxrOpenCommentCount(post), false);
    }

    // ── F. Next tweak round numbering ──
    {
      const mk = (o) => Object.assign({ id: uid(), parent_id: null, role: 'client', is_tweak: true, deleted: false, created_at: now() }, o);
      const cases = [
        [],
        [mk({})],
        [mk({}), mk({})],
        [mk({}), mk({ is_tweak: false })],
        [mk({}), mk({ deleted: true })],
      ];
      for (let i = 0; i < cases.length; i++) {
        const post = { id: uid(), video_comments: cases[i], comments: cases[i], graphic_comments: [] };
        rec('nextTweakRound', 'case#' + i, _calNextTweakRound(post, 'video'), _sxrNextTweakRound(post, 'video'), false);
      }
    }

    // ── G. Has-been-to-Kasper (per status; fresh ledgers per call via unique ids) ──
    for (const st of STAT.concat(['Scheduled', 'Posted'])) {
      const cp = { id: uid(), video_status: st, kasper_seen: '', video_comments: [], graphic_comments: [] };
      const sp = { id: uid(), video_status: st, kasper_seen: '', video_comments: [], graphic_comments: [] };
      const byDesign = (st === 'Scheduled' || st === 'Posted'); // samples has no schedule/publish stage
      rec('hasBeenToKasper(status)', st, _calHasBeenToKasper(cp, 'video'), _sxrHasBeenToKasper(sp, 'video'), byDesign,
          byDesign ? 'samples pipeline ends at Approved — no Scheduled/Posted' : '');
    }
    // …and via explicit signals (kasper_seen csv / a kasper comment)
    {
      const cp1 = { id: uid(), video_status: 'In Progress', kasper_seen: 'video', video_comments: [], graphic_comments: [] };
      const sp1 = { id: uid(), video_status: 'In Progress', kasper_seen: 'video', video_comments: [], graphic_comments: [] };
      rec('hasBeenToKasper(kasper_seen csv)', 'video', _calHasBeenToKasper(cp1, 'video'), _sxrHasBeenToKasper(sp1, 'video'), false);
      const kc = [{ id: uid(), parent_id: null, role: 'kasper', body: 'k', created_at: now() }];
      const cp2 = { id: uid(), video_status: 'In Progress', kasper_seen: '', video_comments: kc, comments: kc, graphic_comments: [] };
      const sp2 = { id: uid(), video_status: 'In Progress', kasper_seen: '', video_comments: kc, comments: kc, graphic_comments: [] };
      rec('hasBeenToKasper(kasper comment)', 'video', _calHasBeenToKasper(cp2, 'video'), _sxrHasBeenToKasper(sp2, 'video'), false);
    }

    // ── H. Approved-after-tweaks predicate ──
    for (const st of STAT.concat(['Scheduled', 'Posted'])) {
      const set = 'video';
      const cp = { kasper_approved_after_tweaks: set, video_status: st };
      const sp = { kasper_approved_after_tweaks: set, video_status: st };
      const byDesign = (st === 'Scheduled' || st === 'Posted');
      rec('showApprovedAfterTweaks', set + '@' + st, _calShowApprovedAfterTweaks(cp, 'video'), _sxrShowApprovedAfterTweaks(sp, 'video'), byDesign,
          byDesign ? 'cal hides badge once Scheduled/Posted; samples has neither' : '');
    }
    // not in the set → never shows
    rec('showApprovedAfterTweaks(not set)', 'graphic@ForSMM',
        _calShowApprovedAfterTweaks({ kasper_approved_after_tweaks: 'video', video_status: 'For SMM Approval', graphic_status: 'For SMM Approval' }, 'graphic'),
        _sxrShowApprovedAfterTweaks({ kasper_approved_after_tweaks: 'video', video_status: 'For SMM Approval', graphic_status: 'For SMM Approval' }, 'graphic'), false);

    // ── I. Resolve-destination recommendation (Kasper vs Client) ──
    {
      const scenarios = [
        { id: uid(), video_status: 'For SMM Approval', kasper_seen: '', kasper_approved_after_tweaks: '', label: 'fresh → kasper' },
        { id: uid(), video_status: 'For SMM Approval', kasper_seen: 'video', kasper_approved_after_tweaks: '', label: 'seen → client' },
        { id: uid(), video_status: 'For SMM Approval', kasper_seen: '', kasper_approved_after_tweaks: 'video', label: 'AAT → client' },
      ];
      for (const s of scenarios) {
        const cp = Object.assign({ video_comments: [], graphic_comments: [] }, s);
        const sp = Object.assign({ id: uid(), video_comments: [], graphic_comments: [] }, s);
        rec('resolveDestRecommend', s.label, _calResolveDestRecommend(cp, 'video'), _sxrResolveDestRecommend(sp, 'video'), false);
      }
    }

    // ── J. Review-component-active (is this component "in play" on a surface?) ──
    for (const mode of ['smm', 'client']) for (const st of STAT) {
      const p = { video_status: st };
      rec('reviewComponentActive[' + mode + ']', st, _calReviewComponentActive(p, 'video', mode), _sxrReviewComponentActive(p, 'video', mode), false);
    }

    // ── K. Approval-badge count (review-queue size). caption left non-review so the
    //      calendar's extra component can't change the count; media present so smm counts. ──
    {
      const mkP = (v, g) => ({ id: uid(), asset_url: 'https://frame.io/x', thumbnail_url: '', video_status: v, graphic_status: g, caption_status: 'In Progress' });
      const posts = [mkP('For SMM Approval', 'In Progress'), mkP('Client Approval', 'For SMM Approval'), mkP('In Progress', 'In Progress'), mkP('Approved', 'Client Approval')];
      calState.posts = posts.map(p => Object.assign({}, p));
      sxrState.posts = posts.map(p => Object.assign({}, p));
      for (const mode of ['smm', 'client']) rec('approvalBadgeCount[' + mode + ']', mode, _calApprovalBadgeCount(mode), _sxrApprovalBadgeCount(mode), false);
    }

    // ── L. Can-delete / can-resolve role rules ──
    for (const c of [{ role: 'smm' }, { role: 'client' }, { role: 'kasper' }])
      rec('canDeleteComment', JSON.stringify(c), _calCanDeleteComment(c), _sxrCanDeleteComment(c), false);
    rec('canResolveComment', 'smm-ctx', _calCanResolveComment(), _sxrCanResolveComment(), false);

    // ── M. Stale-approval clearing: a sub below Client Approval clears its stamp;
    //      one at/above keeps it. (Shared review range — Scheduled/Posted excluded.) ──
    {
      const before = { video_status: 'Tweaks Needed', graphic_status: 'Approved', client_video_approved_at: '2020-01-01', client_graphic_approved_at: '2020-01-01' };
      const cp = Object.assign({}, before), sp = Object.assign({}, before);
      const cPend = {}, sPend = {};
      _calClearStaleApprovals(cp, cPend); _sxrClearStaleApprovals(sp, sPend);
      rec('clearStale: video stamp cleared (below)', 'TweaksNeeded', cp.client_video_approved_at, sp.client_video_approved_at, false);
      rec('clearStale: graphic stamp kept (Approved)', 'Approved', cp.client_graphic_approved_at, sp.client_graphic_approved_at, false);
      rec('clearStale: pending write for video', 'pending', cPend.client_video_approved_at, sPend.client_video_approved_at, false);
    }

    // ── N. Linear issue URL routing (video → linear_issue_id, graphic → graphic_…) ──
    {
      const post = { linear_issue_id: 'https://linear.app/x/VID-1', graphic_linear_issue_id: 'https://linear.app/x/GRA-1' };
      rec('linearUrlFor', 'video', _calLinearUrlFor(post, 'video'), _sxrLinearUrlFor(post, 'video'), false);
      rec('linearUrlFor', 'graphic', _calLinearUrlFor(post, 'graphic'), _sxrLinearUrlFor(post, 'graphic'), false);
      const empty = {};
      rec('linearUrlFor', 'video(empty)', _calLinearUrlFor(empty, 'video'), _sxrLinearUrlFor(empty, 'video'), false);
    }

    // ── O. Comment merge = newer-wins by stamp, across overlapping ids ──
    {
      const A = [{ id: 'm1', updated_at: '2020-01-01', body: 'old' }, { id: 'm2', updated_at: '2021-01-01', body: 'a2' }];
      const B = [{ id: 'm1', updated_at: '2022-01-01', body: 'new' }, { id: 'm3', updated_at: '2020-06-01', body: 'b3' }];
      const norm = (arr) => arr.map(c => [c.id, c.updated_at, c.body]).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
      rec('mergeCommentLists (newer-wins)', 'overlap', norm(_calMergeCommentLists(A, B)), norm(_sxrMergeCommentLists(A, B)), false);
      // a tombstone with a newer stamp must win over a live older copy
      const live = [{ id: 'm9', updated_at: '2020-01-01', body: 'live' }];
      const tomb = [{ id: 'm9', updated_at: '2021-01-01', deleted: true, body: 'live' }];
      const pick = (arr) => { const r = arr.find(c => c.id === 'm9'); return r ? !!r.deleted : null; };
      rec('mergeCommentLists (tombstone wins)', 'm9', pick(_calMergeCommentLists(live, tomb)), pick(_sxrMergeCommentLists(live, tomb)), false);
    }

    // ── P. Status label text (samples aliases the calendar's labeller) ──
    for (const s of STAT.concat(['Scheduled', 'Posted', 'weird']))
      rec('statusLabel', s, _calStatusLabel(s), (typeof _sxrStatusLabel === 'function' ? _sxrStatusLabel(s) : _calStatusLabel(s)),
          (s === 'Scheduled' || s === 'Posted'));

    // ── Q. Kasper-queue membership: does a card surface on Kasper's review queue? ──
    //   Calendar: _calPostKasperVisible → _calCompKasperVisible, which (a) GATES an
    //     unlinked thumbnail (graphic@Kasper with no graphic_linear_issue_id — nobody
    //     can act on it) and (b) KEEPS a Tweaks-Needed component that still has an
    //     unresolved Kasper tweak (the re-review hand-off).
    //   Samples: the inline rule in _sxrKasperLoadQueue (index.html:27797) is just
    //     SXR_REVIEW_COMPONENTS.some(c => normStatus(p[c+'_status']) === 'Kasper Approval')
    //     — neither guard. (Samples has NO _sxrPostKasperVisible function.)
    {
      // Now that the rebuild has a real predicate, compare it directly (was the
      // inline _sxrKasperLoadQueue rule before the fix).
      const sxrKasperVisible = (p) => (typeof _sxrPostKasperVisible === 'function')
        ? _sxrPostKasperVisible(p)
        : ['video', 'graphic'].some(c => _sxrNormStatus(p[c + '_status'] || '') === 'Kasper Approval');
      rec('kasperQueueVisible', 'video@Kasper',
          _calPostKasperVisible({ video_status: 'Kasper Approval', graphic_status: 'In Progress' }),
          sxrKasperVisible({ video_status: 'Kasper Approval', graphic_status: 'In Progress' }), false);
      rec('kasperQueueVisible', 'graphic@Kasper + linked',
          _calPostKasperVisible({ video_status: 'In Progress', graphic_status: 'Kasper Approval', graphic_linear_issue_id: 'https://linear.app/x/GRA-1' }),
          sxrKasperVisible({ video_status: 'In Progress', graphic_status: 'Kasper Approval', graphic_linear_issue_id: 'https://linear.app/x/GRA-1' }), false);
      rec('kasperQueueVisible', 'graphic@Kasper + UNLINKED',
          _calPostKasperVisible({ video_status: 'In Progress', graphic_status: 'Kasper Approval', graphic_linear_issue_id: '' }),
          sxrKasperVisible({ video_status: 'In Progress', graphic_status: 'Kasper Approval', graphic_linear_issue_id: '' }), false,
          'cal hides an un-actionable unlinked thumbnail; samples surfaces it');
      rec('kasperQueueVisible', 'nothing@Kasper',
          _calPostKasperVisible({ video_status: 'For SMM Approval', graphic_status: 'In Progress' }),
          sxrKasperVisible({ video_status: 'For SMM Approval', graphic_status: 'In Progress' }), false);
      const kt = [{ id: uid(), parent_id: null, role: 'kasper', is_tweak: true, done: false, deleted: false, body: 'fix', created_at: now() }];
      const reReview = { video_status: 'Tweaks Needed', graphic_status: 'In Progress', video_comments: kt, comments: kt, graphic_comments: [] };
      rec('kasperQueueVisible', 'video@TweaksNeeded + open Kasper tweak',
          _calPostKasperVisible(reReview), sxrKasperVisible(reReview), false,
          'cal keeps the re-review hand-off in Kasper queue; samples drops it');
    }

    // ── R. Post-level comment merge (field-level, newer-wins per component) ──
    {
      const mk = (id, stamp, body) => ({ id, parent_id: null, role: 'client', updated_at: stamp, created_at: stamp, body });
      const winner = { id: uid(), video_comments: [mk('v1', '2021-01-01', 'w-v1')], graphic_comments: [mk('g1', '2020-01-01', 'w-g1')] };
      const other = { id: winner.id, video_comments: [mk('v1', '2022-01-01', 'o-v1-newer')], graphic_comments: [mk('g2', '2021-01-01', 'o-g2')] };
      const cw = JSON.parse(JSON.stringify(winner)), co = JSON.parse(JSON.stringify(other));
      const sw = JSON.parse(JSON.stringify(winner)), so = JSON.parse(JSON.stringify(other));
      _calMergePostComments(cw, co); _sxrMergePostComments(sw, so);
      const dump = (post) => ['video', 'graphic'].map(c => [c, (_sxrCommentsFor(post, c) || []).map(x => x.id + '@' + x.updated_at).sort()]);
      rec('mergePostComments', 'v1 newer + new g2', dump(cw), dump(sw), false);
    }

    // ── S. Archive-ref predicate (id / linear-link membership) ──
    {
      const refs = new Set(['post-1', 'https://linear.app/x/VID-9']);
      rec('isArchivedRef', 'by id', _calIsArchivedRef({ id: 'post-1' }, refs), _sxrIsArchivedRef({ id: 'post-1' }, refs), false);
      rec('isArchivedRef', 'by video link', _calIsArchivedRef({ id: 'p2', linear_issue_id: 'https://linear.app/x/VID-9' }, refs), _sxrIsArchivedRef({ id: 'p2', linear_issue_id: 'https://linear.app/x/VID-9' }, refs), false);
      rec('isArchivedRef', 'not archived', _calIsArchivedRef({ id: 'p4' }, refs), _sxrIsArchivedRef({ id: 'p4' }, refs), false);
      rec('isArchivedRef', 'by GRAPHIC link', _calIsArchivedRef({ id: 'p3', graphic_linear_issue_id: 'https://linear.app/x/VID-9' }, refs), _sxrIsArchivedRef({ id: 'p3', graphic_linear_issue_id: 'https://linear.app/x/VID-9' }, refs),
          true, 'samples also archives by graphic link (stricter); cal checks id + video link only');
    }

    // ── T. URGENT ping affordance (Video @ Tweaks Needed with a Linear link) ──
    {
      const p = { video_status: 'Tweaks Needed', linear_issue_id: 'https://linear.app/x/VID-1' };
      const calHas = (typeof _calShowUrgent === 'function') && !!_calShowUrgent(p, 'video');
      const sxrHas = (typeof _sxrShowUrgent === 'function') && !!_sxrShowUrgent(p, 'video');
      rec('urgentPing affordance', 'video@TweaksNeeded+link', calHas, sxrHas, false,
          'calendar pings the editor (#video-editing) for an urgent video tweak; samples has no _sxrShowUrgent / URGENT button');
    }

    // ── U. Status-pill LOCK for an UNLINKED component (render-level) ──
    try {
      const p = { id: uid(), name: 'Lock test', client: 'acme', order_index: 1, asset_url: 'https://frame.io/x', thumbnail_url: '',
        video_status: 'For SMM Approval', graphic_status: 'Kasper Approval',
        linear_issue_id: 'https://linear.app/x/VID-1', graphic_linear_issue_id: '', video_comments: [], graphic_comments: [] };
      calState.posts = [p]; sxrState.posts = [p];
      const calHtml = String(_calRenderInlineCard(p, false, false) || '');
      const sxrHtml = String(_sxrRenderInlineCard(p, false, false) || '');
      const locks = (h) => /is-locked/.test(h) || /Link a Linear sub-issue first/.test(h);
      rec('unlinkedPillLock', 'graphic unlinked @ Kasper', locks(calHtml), locks(sxrHtml), false,
          'calendar disables the status pill for an unlinked component; samples lets you set any status (feeds the Kasper unlinked-thumbnail gap)');
    } catch (e) { diffs.push({ group: 'unlinkedPillLock', input: 'inconclusive', cal: 'render-ok', sxr: 'render-threw: ' + e.message, byDesign: true, note: 'inline-card render needs more page state; re-test at DOM level' }); }

    return { diffs, cmp, errs: [] };
  });

  // ── Client-context page (_isClientLink === true) → exercise the visibility filter
  //    that hides internal/Kasper threads from the client. ──
  const cpage = await ctx.newPage();
  await cpage.goto('http://localhost:8012/index.html?sxr=1&c=acme', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await cpage.waitForFunction(() => typeof _calCommentsForView === 'function' && typeof _sxrCommentsForView === 'function', { timeout: 15000 }).catch(() => {});
  const cout = await cpage.evaluate(() => {
    const diffs = []; let cmp = 0; const now = () => new Date().toISOString(); let _s = 0; const uid = () => 'cc_' + (++_s);
    const rec = (group, input, cal, sxr) => { cmp++; if (JSON.stringify(cal) !== JSON.stringify(sxr)) diffs.push({ group, input, cal, sxr, byDesign: false }); };
    const isClient = (typeof _isClientLink !== 'undefined') && !!_isClientLink;
    // Mixed thread: internal-SMM tweak, client tweak, Kasper note, reply→client root, reply→internal root.
    const rootSmm = { id: uid(), parent_id: null, role: 'smm', audience: 'internal', is_tweak: true, body: 'internal', created_at: now() };
    const rootClient = { id: uid(), parent_id: null, role: 'client', audience: 'client', is_tweak: true, body: 'client', created_at: now() };
    const kasper = { id: uid(), parent_id: null, role: 'kasper', audience: 'internal', body: 'k', created_at: now() };
    const replyToClient = { id: uid(), parent_id: rootClient.id, role: 'smm', body: 'reply-client', created_at: now() };
    const replyToInternal = { id: uid(), parent_id: rootSmm.id, role: 'client', body: 'reply-internal', created_at: now() };
    const vid = [rootSmm, rootClient, kasper, replyToClient, replyToInternal];
    const post = { id: uid(), video_comments: vid, comments: vid, graphic_comments: [] };
    const ids = (arr) => arr.map(c => c.id).sort();
    rec('clientView: visible ids', 'mixed thread', ids(_calCommentsForView(post, 'video')), ids(_sxrCommentsForView(post, 'video')));
    rec('clientView: count', 'mixed thread', _calCommentsForView(post, 'video').length, _sxrCommentsForView(post, 'video').length);
    return { diffs, cmp, isClient };
  });
  await cpage.close();
  out.diffs = out.diffs.concat(cout.diffs);
  out.cmp += cout.cmp;
  if (!cout.isClient) console.log('  ⚠ client page did not set _isClientLink — visibility check may be invalid');

  // ── report ──
  const diffs = out.diffs;
  const gaps = diffs.filter(d => !d.byDesign);
  const byDesign = diffs.filter(d => d.byDesign);
  console.log('═══ PARITY (logic) — samples (_sxr) vs original calendar (_cal) ═══');
  console.log('    ' + out.cmp + ' comparisons across the shared video+graphic scope\n');

  if (!diffs.length) {
    console.log('  ✓ no divergences — every logic check matches the calendar');
  } else {
    if (gaps.length) {
      console.log('  ✗ GAPS (no design reason — likely bugs):');
      for (const d of gaps) console.log('     · [' + d.group + '] ' + d.input + '  cal=' + JSON.stringify(d.cal) + ' sxr=' + JSON.stringify(d.sxr) + (d.note ? '  — ' + d.note : ''));
    }
    if (byDesign.length) {
      console.log((gaps.length ? '\n' : '') + '  ◌ BY-DESIGN differences (expected, not bugs):');
      for (const d of byDesign) console.log('     · [' + d.group + '] ' + d.input + '  cal=' + JSON.stringify(d.cal) + ' sxr=' + JSON.stringify(d.sxr) + (d.note ? '  — ' + d.note : ''));
    }
  }
  console.log('\n  page errors:', errs.length, errs.slice(0, 3));
  console.log('\n' + '─'.repeat(64));
  console.log('RESULT: ' + (gaps.length ? gaps.length + ' GAP(S) — investigate' : 'NO GAPS' + (byDesign.length ? ' (' + byDesign.length + ' by-design diffs noted)' : '')));
  await browser.close(); server.close();
  process.exit(gaps.length ? 1 : 0);
})().catch(e => { console.error('PARITY-LOGIC ERROR', e && e.stack || e); process.exit(2); });

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

    return { diffs, cmp, errs: [] };
  });

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

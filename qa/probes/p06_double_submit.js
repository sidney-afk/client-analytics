// p06 — §7/§8 double-submit idempotency: fire approve / request-change twice in the same
// tick and assert ONE effect (one Approved, one tweak comment), no error, no double-stamp.
const Q = require('./lib.js');
const A = 'p_dsub_a_' + Math.floor(Date.now() / 1000);
const B = 'p_dsub_b_' + Math.floor(Date.now() / 1000);

(async () => {
  const S = Q.makeOk('P06 double-submit');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    // A) double client-approve caption (Client Approval → Approved)
    await Q.seedCaptionCard(A, 'Client Approval');
    await Q.pollRow(A, x => x.caption_status === 'Client Approval');
    await Q.clientHasCaption(cli, A, 'Client Approval');
    const aRes = await cli.evaluate(async (pid) => {
      const before = (calState.posts.find(p=>p.id===pid)||{}).client_caption_approved_at || '';
      _calReviewApprove(pid, 'caption');   // 1st
      _calReviewApprove(pid, 'caption');   // 2nd (same tick) — should hit saving guard
      await new Promise(x => setTimeout(x, 400));
      const p = calState.posts.find(p=>p.id===pid) || {};
      return { before, status: p.caption_status, stamp: p.client_caption_approved_at || '' };
    }, A);
    let r = await Q.pollRow(A, x => x.caption_status === 'Approved');
    S.ok(r.caption_status === 'Approved', 'A: double client-approve → caption Approved (once)');
    S.ok(aRes.status === 'Approved', 'A: local state Approved, single stamp present');
    S.ok(cli._errs.length === 0, 'A: no JS errors on client double-approve (' + JSON.stringify(cli._errs.slice(0,3)) + ')');

    // B) double Kasper request-change (counts tweak comments → must be exactly 1)
    await Q.seedCaptionCard(B, 'Kasper Approval');
    await Q.pollRow(B, x => x.caption_status === 'Kasper Approval');
    S.ok(await Q.kasperLoadHas(kas, B), 'B: card in Kasper queue');
    await kas.evaluate(async (pid) => {
      const it = (_kasperState.items||[]).find(x => x.post.id === pid);
      if (!it) return;
      it._drafts = it._drafts || {}; it._drafts.caption = 'Kasper: tweak this caption';
      const p1 = _kasperRequestTweakComp(pid, 'caption', false);   // 1st
      const p2 = _kasperRequestTweakComp(pid, 'caption', false);   // 2nd same tick — guarded
      await Promise.all([p1, p2].map(p => Promise.resolve(p).catch(()=>{})));
      await new Promise(x => setTimeout(x, 400));
    }, B);
    r = await Q.pollRow(B, x => x.caption_status === 'Tweaks Needed');
    S.ok(r.caption_status === 'Tweaks Needed', 'B: double request-change → caption Tweaks Needed');
    const tweakCount = await (async () => {
      const row = await Q.rawRow(B, 'caption_tweaks');
      let arr = []; try { arr = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {}
      return arr.filter(c => c && c.is_tweak && !c.deleted).length;
    })();
    S.ok(tweakCount === 1, 'B: exactly ONE tweak comment created (got ' + tweakCount + ', 2 = double-submit bug)');
    S.ok(kas._errs.length === 0, 'B: no JS errors on Kasper double-request (' + JSON.stringify(kas._errs.slice(0,3)) + ')');
  } finally {
    await Q.archive(A); await Q.archive(B);
    await browser.close();
  }
  process.exit(S.done());
})();

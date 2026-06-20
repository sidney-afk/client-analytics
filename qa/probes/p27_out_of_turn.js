// p27 — §7/§10 review surface guard: a client can act (approve / request-change) only on a
// component on THEIR surface (Client Approval / Tweaks Needed), never one in internal review
// (Kasper / For SMM Approval). Negatives must be blocked; positives must still work.
const Q = require('./lib.js');
const TS = Math.floor(Date.now()/1000);
const KA = 'p_oot_ka_'+TS;   // caption at Kasper Approval (off client surface)
const CA = 'p_oot_ca_'+TS;   // caption at Client Approval (on client surface)
const CA2= 'p_oot_c2_'+TS;   // for request-change positive
const seed = (id, capStatus) => Q.up({ id, name:'OOT '+id.slice(-5), platforms:'youtube', scheduled_date:'2026-06-29',
  video_status:'Approved', graphic_status:'Approved', caption_status:capStatus, status:capStatus,
  thumbnail_url:'https://via.placeholder.com/320x180.png', asset_url:'https://example.com/g.mp4' });
(async()=>{
  const S=Q.makeOk('P27 review-surface-guard');
  const browser=await Q.launch();
  const cli=await Q.clientPage(browser);
  try {
    await seed(KA,'Kasper Approval'); await seed(CA,'Client Approval'); await seed(CA2,'Client Approval');
    await Q.pollRaw(KA,r=>r.caption_status==='Kasper Approval','caption_status');
    await Q.pollRaw(CA,r=>r.caption_status==='Client Approval','caption_status');
    await Q.pollRaw(CA2,r=>r.caption_status==='Client Approval','caption_status');
    await Q.waitForPost(cli, KA); await Q.clientHasCaption(cli, CA, 'Client Approval'); await Q.clientHasCaption(cli, CA2, 'Client Approval');

    // NEGATIVE: approve a Kasper-Approval caption
    await cli.evaluate((pid)=>{ try{ _calReviewApprove(pid,'caption'); }catch(e){} }, KA);
    await cli.waitForTimeout(2500);
    let bk = await Q.rawRow(KA,'caption_status');
    S.ok(bk.caption_status==='Kasper Approval', 'client approve of a Kasper-Approval caption BLOCKED (status='+bk.caption_status+')');

    // NEGATIVE: request-change a Kasper-Approval caption
    await cli.evaluate((pid)=>{ _calReviewState.drafts[pid+'|caption']='OOT-REQ'; try{ _calReviewRequestTweak(pid,'caption'); }catch(e){} }, KA);
    await cli.waitForTimeout(2500);
    bk = await Q.rawRow(KA,'caption_status');
    S.ok(bk.caption_status==='Kasper Approval', 'client request-change of a Kasper-Approval caption BLOCKED (status='+bk.caption_status+')');

    // POSITIVE: approve a Client-Approval caption
    S.ok((await Q.clientApprove(cli, CA, 'caption'))==='ok', 'client approve call ok (CA)');
    let r = await Q.pollRow(CA, x=>x.caption_status==='Approved');
    S.ok(r.caption_status==='Approved', 'POSITIVE: client approve at Client Approval still works → Approved');

    // POSITIVE: request-change a Client-Approval caption
    S.ok((await Q.clientRequest(cli, CA2, 'caption', 'real-req'))==='ok', 'client request call ok (CA2)');
    r = await Q.pollRow(CA2, x=>x.caption_status==='Tweaks Needed');
    S.ok(r.caption_status==='Tweaks Needed', 'POSITIVE: client request at Client Approval still works → Tweaks Needed');

    S.ok(cli._errs.length===0, 'client: 0 JS errors ('+JSON.stringify(cli._errs.slice(0,3))+')');
  } finally {
    for (const id of [KA,CA,CA2]) await Q.up({id,status:'Archived'});
    await browser.close();
  }
  process.exit(S.done());
})();

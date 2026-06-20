// p22 — §4.3/§6 SMM Review-tab approve routing. The real _calReviewApprove in 'smm' mode
// routes a component from 'For SMM Approval' to Kasper Approval (default/first time) or
// Client Approval (SMM chooses to skip Kasper). Drives the real handler on an SMM page and
// asserts backend + Kasper-queue / client-review membership.
const Q = require('./lib.js');
const TS = Math.floor(Date.now()/1000);
const A = 'p_smr_k_'+TS;  // route to Kasper
const B = 'p_smr_c_'+TS;  // route to Client

const smmReviewApprove = (smm, pid, dest) => smm.evaluate((a)=>{
  // SMM review approve only routes correctly from the SMM Review tab (view 'smmreview',
  // where _calReviewMode() === 'smm'); the organizer uses the status dropdown instead.
  try { calState.view = 'smmreview'; _calRenderBody({ preserveScroll: false }); } catch(e){}
  const p=(calState.posts||[]).find(x=>x.id===a.pid); if(!p) return 'NO_POST';
  try { _calReviewApprove(a.pid,'caption',a.dest); return 'ok'; } catch(e){ return 'ERR '+e.message; }
}, {pid, dest});

(async()=>{
  const S=Q.makeOk('P22 smm-review');
  const browser=await Q.launch();
  const smm=await Q.smmPage(browser);
  const kas=await Q.kasperPage(browser);
  const cli=await Q.clientPage(browser);
  try {
    for (const id of [A,B]) {
      await Q.up({ id, name:'SMR '+id.slice(-6), platforms:'youtube', scheduled_date:'2026-06-29',
        video_status:'Approved', graphic_status:'Approved', caption_status:'For SMM Approval', status:'For SMM Approval',
        thumbnail_url:'https://via.placeholder.com/320x180.png', asset_url:'https://example.com/g.mp4' });
    }
    await Q.pollRaw(A, r=>r.caption_status==='For SMM Approval','caption_status');
    await Q.pollRaw(B, r=>r.caption_status==='For SMM Approval','caption_status');
    await Q.waitForPost(smm, A); await Q.waitForPost(smm, B);

    // confirm SMM review mode becomes 'smm' once on the Review tab
    const mode = await smm.evaluate(()=>{ try{ calState.view='smmreview'; }catch(e){} return _calReviewMode(); });
    S.ok(mode==='smm', "SMM review mode is 'smm' on the Review tab (got "+mode+")");

    // A: route to Kasper
    console.log('  approve(A,kasper):', await smmReviewApprove(smm, A, 'kasper'));
    let r = await Q.pollRow(A, x=>x.caption_status==='Kasper Approval');
    S.ok(r.caption_status==='Kasper Approval', 'A: SMM approve→kasper routes caption → Kasper Approval');
    S.ok(await Q.kasperLoadHas(kas, A), 'A: card enters Kasper queue');
    // kasper_seen should record caption
    const seenA = await Q.rawRow(A, 'kasper_seen');
    S.ok(/caption/.test(String(seenA.kasper_seen||'')), 'A: kasper_seen records caption ('+seenA.kasper_seen+')');

    // B: route to Client (skip Kasper)
    console.log('  approve(B,client):', await smmReviewApprove(smm, B, 'client'));
    r = await Q.pollRow(B, x=>x.caption_status==='Client Approval');
    S.ok(r.caption_status==='Client Approval', 'B: SMM approve→client routes caption → Client Approval');
    S.ok(await Q.clientHasCaption(cli, B, 'Client Approval'), 'B: card on client review at Client Approval');
    S.ok(await Q.kasperGoneFromQueue(kas, B), 'B: card NOT in Kasper queue (skipped Kasper)');

    S.ok(smm._errs.length===0, 'SMM: 0 JS errors ('+JSON.stringify(smm._errs.slice(0,3))+')');
    S.ok(kas._errs.length===0, 'Kasper: 0 JS errors');
    S.ok(cli._errs.length===0, 'client: 0 JS errors');
  } finally {
    await Q.up({id:A,status:'Archived'}); await Q.up({id:B,status:'Archived'});
    await browser.close();
  }
  process.exit(S.done());
})();

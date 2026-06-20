// p26 — §9 concurrency: two CLIENT tabs approve the SAME component at the same time.
// Must converge to Approved once, no JS errors, valid single sign-off timestamp.
const Q = require('./lib.js');
const PID = 'p_capp_' + Math.floor(Date.now()/1000);
(async()=>{
  const S=Q.makeOk('P26 concurrent-approve');
  const browser=await Q.launch();
  const cli1=await Q.clientPage(browser);
  const cli2=await Q.clientPage(browser);
  try {
    await Q.up({ id:PID, name:'CAPP '+PID.slice(-6), platforms:'youtube', scheduled_date:'2026-06-29',
      video_status:'Approved', graphic_status:'Approved', caption_status:'Client Approval', status:'Client Approval',
      thumbnail_url:'https://via.placeholder.com/320x180.png', asset_url:'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r=>r.caption_status==='Client Approval','caption_status');
    await Q.clientHasCaption(cli1, PID, 'Client Approval');
    await Q.clientHasCaption(cli2, PID, 'Client Approval');
    // both approve at once
    const [r1,r2] = await Promise.all([ Q.clientApprove(cli1, PID, 'caption'), Q.clientApprove(cli2, PID, 'caption') ]);
    console.log('  approve calls:', r1, r2);
    const row = await Q.pollRow(PID, x=>x.caption_status==='Approved', 18000);
    S.ok(row.caption_status==='Approved', 'converges to Approved (got '+row.caption_status+')');
    // overall should be Approved (all comps Approved)
    const full = await Q.rawRow(PID, 'video_status,graphic_status,caption_status,status,client_caption_approved_at');
    S.ok(full.video_status==='Approved'&&full.graphic_status==='Approved'&&full.caption_status==='Approved', 'all components Approved (no corruption)');
    S.ok(String(full.client_caption_approved_at||'').trim()!=='', 'client sign-off timestamp present ('+full.client_caption_approved_at+')');
    S.ok(cli1._errs.length===0 && cli2._errs.length===0, 'no JS errors on either tab ('+JSON.stringify([...cli1._errs,...cli2._errs].slice(0,3))+')');
  } finally { await Q.up({id:PID,status:'Archived'}); await browser.close(); }
  process.exit(S.done());
})();

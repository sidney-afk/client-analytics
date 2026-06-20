const Q = require('./lib.js');
const TS = Math.floor(Date.now()/1000);
const A='p_g2sa_'+TS, B='p_g2sb_'+TS, C='p_g2sc_'+TS;
(async()=>{
  const S=Q.makeOk('P_G2b SMM-positive'); const browser=await Q.launch(); const smm=await Q.smmPage(browser);
  try {
    await Q.up({id:A,name:'G2SA '+TS,platforms:'instagram',scheduled_date:'2026-06-29',status:'In Progress'});
    await Q.up({id:B,name:'G2SB '+TS,platforms:'instagram',scheduled_date:'2026-06-29',status:'In Progress'});
    await Q.up({id:C,name:'G2SC '+TS,platforms:'instagram',scheduled_date:'2026-06-29',status:'In Progress',color:''});
    for (const id of [A,B,C]) await Q.pollRaw(id,r=>r.id===id,'id');
    await Q.waitForPost(smm,C);
    // SMM color
    await smm.evaluate((pid)=>{ try{ _calSetCardColor(null,pid,'emerald'); }catch(e){} }, C);
    let c = await Q.pollRaw(C, r=>String(r.color||'').toLowerCase()==='emerald','color',10000);
    S.ok(String(c.color||'').toLowerCase()==='emerald','SMM _calSetCardColor works (color='+c.color+')');
    // SMM bulk archive
    await smm.evaluate(async (a)=>{ try{ _calToggleSelectMode('archive'); calState.selected=new Set([a.A,a.B]); _calArchiveSelected(); }catch(e){} await new Promise(x=>setTimeout(x,300)); const y=document.getElementById('confirmYes'); if(y) y.click(); },{A,B});
    const a1=await Q.pollRaw(A,r=>r.status==='Archived','status',12000); const b1=await Q.pollRaw(B,r=>r.status==='Archived','status',12000);
    S.ok(a1.status==='Archived'&&b1.status==='Archived','SMM bulk-archive works (A='+a1.status+' B='+b1.status+')');
    S.ok(smm._errs.length===0,'SMM 0 JS errors ('+JSON.stringify(smm._errs.slice(0,3))+')');
  } finally { for (const id of [A,B,C]) await Q.up({id,status:'Archived'}); await browser.close(); }
  process.exit(S.done());
})();

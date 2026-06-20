const Q = require('./lib.js');
const P='p_fed_'+Math.floor(Date.now()/1000);
(async()=>{
  const S=Q.makeOk('P18c SMM-date'); const browser=await Q.launch(); const smm=await Q.smmPage(browser);
  try {
    await Q.up({id:P,name:'DATEONLY',platforms:'instagram',scheduled_date:'2026-06-10',status:'In Progress'});
    await Q.pollRaw(P,r=>r.scheduled_date==='2026-06-10','scheduled_date'); await Q.waitForPost(smm,P);
    await smm.evaluate(async (pid)=>{ try{calState.view='organizer';_calRenderBody({preserveScroll:false});}catch(e){} await new Promise(x=>setTimeout(x,400));
      const di=document.querySelector('.cal-card[data-pid="'+pid+'"] .cal-fld-date-input'); if(di){di.value='2026-08-08'; try{_calOnDateChange(di);}catch(e){}}
    },P);
    const n=await Q.pollRaw(P,r=>r.scheduled_date==='2026-08-08','scheduled_date',14000);
    S.ok(n.scheduled_date==='2026-08-08','SMM date edit works in isolation (date='+n.scheduled_date+')');
    S.ok(smm._errs.length===0,'SMM 0 JS errors');
  } finally { await Q.up({id:P,status:'Archived'}); await browser.close(); }
  process.exit(S.done());
})();

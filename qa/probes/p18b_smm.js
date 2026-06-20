const Q = require('./lib.js');
const P='p_fesm_'+Math.floor(Date.now()/1000);
(async()=>{
  const S=Q.makeOk('P18b SMM-field-positive'); const browser=await Q.launch(); const smm=await Q.smmPage(browser);
  try {
    await Q.up({id:P,name:'ORIG',platforms:'instagram',scheduled_date:'2026-06-10',status:'In Progress'});
    await Q.pollRaw(P,r=>r.name==='ORIG','name'); await Q.waitForPost(smm,P);
    await smm.evaluate(async (pid)=>{ try{calState.view='organizer';_calRenderBody({preserveScroll:false});}catch(e){} await new Promise(x=>setTimeout(x,400));
      const i=document.querySelector('.cal-card[data-pid="'+pid+'"] .cal-fld-name'); if(i){i.value='SMM-EDITED'; try{_calOnFieldBlur(i);}catch(e){}}
      const di=document.querySelector('.cal-card[data-pid="'+pid+'"] .cal-fld-date-input'); if(di){di.value='2026-08-08'; try{_calOnDateChange(di);}catch(e){}}
    },P);
    const n=await Q.pollRaw(P,r=>r.name==='SMM-EDITED','name,scheduled_date',10000);
    S.ok(n.name==='SMM-EDITED','SMM name edit works');
    S.ok(n.scheduled_date==='2026-08-08','SMM date edit works (date='+n.scheduled_date+')');
    S.ok(smm._errs.length===0,'SMM 0 JS errors');
  } finally { await Q.up({id:P,status:'Archived'}); await browser.close(); }
  process.exit(S.done());
})();

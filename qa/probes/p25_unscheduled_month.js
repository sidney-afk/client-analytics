// p25 — interaction of statusFilter=unscheduled with a concrete month filter.
// The reserve-pile (unscheduled) filter is month-agnostic; an undated card should show under
// 'unscheduled' regardless of the month filter. On the #538 branch as-is it is hidden (gap).
const Q = require('./lib.js');
const TS = Math.floor(Date.now()/1000);
const UND='p_us_'+TS, JUN='p_js_'+TS;
const inDom=(page,pid)=>page.evaluate(p=>!!document.querySelector('.cal-card[data-pid="'+p+'"]'),pid);
(async()=>{
  const S=Q.makeOk('P25 unscheduled+month'); const browser=await Q.launch(); const smm=await Q.smmPage(browser);
  try {
    await Q.up({id:UND,name:'US-UND '+TS,platforms:'instagram',scheduled_date:'',status:'In Progress'});
    await Q.up({id:JUN,name:'US-JUN '+TS,platforms:'instagram',scheduled_date:'2026-06-15',status:'In Progress'});
    await Q.pollRaw(UND,r=>r.id===UND,'id'); await Q.pollRaw(JUN,r=>r.id===JUN,'id');
    await smm.evaluate(async(a)=>{ for(let i=0;i<25;i++){ try{await loadCalendarPosts();}catch(e){} await new Promise(x=>setTimeout(x,800)); const ids=(calState.posts||[]).map(p=>p.id); if(ids.includes(a.UND)&&ids.includes(a.JUN))return; } },{UND,JUN});
    const res=await smm.evaluate(async(a)=>{
      if(calState.view!=='organizer'){calState.view='organizer';}
      // month=all + unscheduled → undated shows
      onCalMonthFilterChange('all'); onCalStatusFilterChange('unscheduled'); await new Promise(x=>setTimeout(x,400));
      const allUns={und:!!document.querySelector('.cal-card[data-pid="'+a.UND+'"]'), jun:!!document.querySelector('.cal-card[data-pid="'+a.JUN+'"]')};
      // month=June + unscheduled → undated SHOULD still show (month-agnostic reserve pile)
      onCalMonthFilterChange('2026-06'); await new Promise(x=>setTimeout(x,400));
      const junUns={und:!!document.querySelector('.cal-card[data-pid="'+a.UND+'"]'), jun:!!document.querySelector('.cal-card[data-pid="'+a.JUN+'"]')};
      onCalMonthFilterChange('all'); onCalStatusFilterChange('all');
      return {allUns, junUns};
    },{UND,JUN});
    console.log('RESULT:',JSON.stringify(res));
    S.ok(res.allUns.und && !res.allUns.jun, 'month=all + unscheduled: undated shown, June(dated) hidden');
    S.ok(res.junUns.und, 'month=June + unscheduled: undated STILL shown (reserve pile is month-agnostic)');
    S.ok(smm._errs.length===0,'SMM 0 JS errors');
  } finally { await Q.up({id:UND,status:'Archived'}); await Q.up({id:JUN,status:'Archived'}); await browser.close(); }
  process.exit(S.done());
})();

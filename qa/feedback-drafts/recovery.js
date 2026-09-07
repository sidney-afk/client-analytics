'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store,open,panel,snap,SOURCE,OUT,body,newer,Harness,ui}=require('./run');
const {build,sha256}=require('../../scripts/samples-recovery-build');
const forward=fs.readFileSync(path.join(SOURCE,'index.html'),'utf8'),inverse=build(forward);
const report={status:'INCOMPLETE',...inverse.manifest,groups:[]};
async function main(){
  const h=await new Harness(SOURCE,OUT).start();report.browser=h.browser.version();
  let document=forward;h.documentOverride=()=>document;
  try{
    for(const surface of ['calendar','samples','kasper']) for(const fault of ['reject','accepted-timeout','held-reject']){
      document=forward;const b=new Store(surface,'note',fault),s=await open(h,b,surface);
      await (await panel(s,surface)).locator('.cal-review-textarea').fill(body);
      await (await panel(s,surface)).locator('.cal-review-comment-btn').click();
      await ui.until(()=>b.feedbackWrites.length>0,'captured comment reaches intercepted source');
      if(fault!=='held-reject')await ui.until(async()=>!(await snap(s,surface)).saving,'captured attempt settles');
      await (await panel(s,surface)).locator('.cal-review-textarea').fill(newer);
      const owned=await s.page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('syncview_review_draft_v1:')).map(k=>[k,JSON.parse(localStorage.getItem(k))])));
      const stableIds=Object.values(owned).flatMap(v=>v.attempt?[v.attempt.id]:v.delegated?[v.delegated.id]:[]);
      assert.equal(stableIds.length,1);
      const navigate=async(target,step)=>{
        document=target;
        const url=surface==='kasper'?h.url('admin'):surface==='samples'?h.url('client').replace('v=calendar','v=sample-reviews&sxr=1'):h.url('client');
        // Preserve the verified link exactly. Client-entry correctly refuses
        // arbitrary parameters; a same-origin fixture page forces a new document.
        await s.page.goto(h.origin+'/__feedback-away');
        const response=await s.page.goto(url,{waitUntil:'domcontentloaded'});
        assert.equal(sha256(await response.body()),sha256(target),'exact recovery document served');
        if(surface==='kasper'){await ui.card(s.page).waitFor();await s.page.locator('#navKasper').click();}
        await panel(s,surface).catch(async error=>{
          report.diagnostic={surface,fault,step,blocked:b.blocked,errors:s.errors,records:b.records,
            page:await s.page.evaluate(()=>({text:document.body.innerText.slice(-2500),cal:{client:calState.client,posts:calState.posts},sxr:{client:sxrState.client,posts:sxrState.posts,error:sxrState.error}}))};throw error;
        });
      };
      await navigate(inverse.recovery,'inverse');b.release();b.feedbackFault='reject';
      for(const target of ['recovery','forward']){
        if(target==='forward')await navigate(forward,'forward');
        const state=await snap(s,surface);
        assert.equal(state.originalVisible,true,target+' keeps earlier captured feedback visible');
        assert.equal(state.newerVisible,true,target+' keeps newer unsent typing visible');
        const records=await s.page.evaluate(()=>Object.values(localStorage).filter(v=>v.startsWith('{')).map(v=>{try{return JSON.parse(v);}catch{return null;}}).filter(v=>v?.schema===1&&v.surface));
        assert.ok(records.some(v=>v.text===newer),'newer revision remains durably owned');
        assert.ok(records.some(v=>v.attempt?.id===stableIds[0]||v.delegated?.id===stableIds[0]),'original action identity remains owned');
      }
      assert.equal(b.feedbackWrites.some(w=>JSON.stringify(w.body).includes(newer)),false,'navigation never submits unsent newer text');
      assert.equal(b.blocked.length,0);assert.deepEqual(h.sessions.flatMap(s=>s.errors),[]);
      report.groups.push({surface,fault,forwardRecoveryForward:true,earlierAndNewerVisible:true});console.log('PASS '+surface+' '+fault+': forward/recovery/forward conserves captured and newer drafts');
      b.release();await h.closeSessions();
    }
    report.status='PASS';
  }finally{await h.close();fs.writeFileSync(path.join(OUT,'recovery-private.json'),JSON.stringify(report,null,2)+'\n');}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});

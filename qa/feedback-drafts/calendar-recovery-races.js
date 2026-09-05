'use strict';
// Acceptance controls, not expected-failure tests: native lifecycle races must
// not insert stale or resurrected source content. Every receiver is fictional.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {SplitStore,pending,fresh,retry,guards}=require('./calendar-recovery-access');
const {SOURCE,OUT,Harness,ui,body,ID}=require('./run');
const {clone}=require('./mock-backend');
async function main(){
 const h=await new Harness(SOURCE,OUT).start(),report={status:'INCOMPLETE',groups:[],safetyHolds:[],indexSha256:require('node:crypto').createHash('sha256').update(h.index).digest('hex')};
 const run=async(name,fn)=>{try{await fn();report.groups.push({name,status:'PASS'});console.log('PASS '+name);}catch(e){report.groups.push({name,status:'FAIL',error:e.message});console.log('FAIL '+name+': '+e.message);}finally{await h.closeSessions();}};
 try{
  for(const comp of ['video','graphic'])for(const cell of [null,''])await run(comp+' verified '+(cell===null?'null':'empty-string')+' source cell',async()=>{
   const b=new SplitStore('partial');b.rows[0][comp+'_tweaks']=cell;b.rows[0].tweaks=cell;
   if(comp==='graphic'){
    b.comp='graphic';const row=b.rows[0];row.graphic_status='Client Approval';row.video_status='N/A';row.graphic_deliverable_id=row.video_deliverable_id;row.video_deliverable_id='';b.native[0].team='graphics';b.native[0].kind='graphic';
   }
   let s=await h.session(b,'client');await h.open(s);const p=await ui.review(s.page,comp);await p.locator('.cal-review-textarea').fill(body);await p.locator('.cal-review-tweak-btn').click();
   await ui.until(async()=>b.feedbackWrites.length>0&&await s.page.evaluate(({ID,comp})=>!_calReviewState.saving[ID+'|'+comp],{ID,comp}),'original action settles');
   const storage=await s.context.storageState();await s.context.close();s=await h.session(b,'client',{storageState:storage});await h.open(s);await s.page.waitForLoadState('networkidle');
   const panel=s.page.locator(`[data-cal-review-recovery="${comp}"]`);if(!await panel.isVisible())await s.page.locator(`[data-cal-review-pid="${ID}"] .kcard-expand-btn`).click();
   b.outcome='healthy';await panel.getByRole('button',{name:'Retry card sync',exact:true}).click();await ui.until(()=>s.page.evaluate(()=>[..._reviewDraftRecords.values()].every(c=>!c.recovering)),'recovery completes');
   const held=await s.page.evaluate(comp=>[..._reviewDraftRecords.values()].find(c=>c.comp===comp)?.recoveryFailure,comp);
   if(held==='review_atomic_source_repair_unavailable'){
    assert.ok(b.records.some(r=>r.action==='reconcile_only'),'valid nullable cell reaches exact native proof');
    assert.equal(b.feedbackWrites.filter(w=>w.transport==='source'&&w.outcome==='accepted').length,0,'capability hold sends no source write');
    assert.ok((await panel.innerText()).includes(body));report.safetyHolds.push({comp,cell,passed:true});
   }
   await guards(h,b);
   assert.ok(JSON.parse(b.rows[0][comp+'_tweaks']||'[]').some(c=>c.body===body),'complete repair acceptance still requires restoring original into valid empty source');
  });
  for(const alias of ['legacy-only','malformed','nonarray'])await run('video alias '+alias+' is preserved/refused',async()=>{
   const b=new SplitStore('partial');let s=await pending(h,b);s=await fresh(h,b,s);
   b.rows[0].tweaks=alias==='legacy-only'?JSON.stringify([{id:'fictional-alias-only',body:'Fictional legacy note'}]):alias==='malformed'?'not JSON':'{}';const old=b.rows[0].tweaks,before=b.feedbackWrites.length;b.outcome='healthy';await retry(s);
   assert.equal(b.feedbackWrites.length,before);assert.equal(b.rows[0].tweaks,old);assert.equal(await s.page.locator('[data-cal-review-recovery="video"]').isVisible(),true);await guards(h,b);
  });
  for(const action of ['edit','delete','resolve'])await run('native '+action+' after read before source commit',async()=>{
   const b=new SplitStore('partial');let s=await pending(h,b);s=await fresh(h,b,s);b.outcome='healthy';
   let raced=false;
   b.onSourceCommit=()=>{raced=true;const c=b.comments.find(c=>c.body===body);c.version++;c.updated_at=b.stamp();if(action==='edit'){c.body='Fictional newer native revision';c.edited_at=c.updated_at;}else c[action==='delete'?'deleted_at':'resolved_at']=c.updated_at;};
   await retry(s);
   const rows=JSON.parse(b.rows[0].video_tweaks||'[]');const stale=rows.find(c=>c.body===body&&!c.deleted&&!c.done);
   fs.writeFileSync(path.join(OUT,'native-'+action+'-race-private.json'),JSON.stringify({source:rows,native:b.comments,writes:b.feedbackWrites,contexts:await s.page.evaluate(()=>[..._reviewDraftRecords.values()])},null,2));
   assert.equal(b.comments.length,1,'no duplicate native submission');assert.equal(b.blocked.length,0);assert.deepEqual(h.sessions.flatMap(s=>s.errors),[]);
   if(!raced){
    assert.equal(await s.page.evaluate(()=>[..._reviewDraftRecords.values()].find(c=>c.value.attempt)?.recoveryFailure),'review_atomic_source_repair_unavailable');
    assert.equal(b.feedbackWrites.filter(w=>w.transport==='source'&&w.outcome==='accepted').length,0);
    assert.equal(!!stale,false);report.safetyHolds.push({action,passed:true});
   }
   assert.equal(raced,true,'complete repair acceptance must actually reach the raced source commit');
   assert.equal(!!stale,false,'native lifecycle race must not insert stale/unresolved source feedback');
  });
  report.status=report.groups.every(g=>g.status==='PASS')?'PASS':'FAIL';
 }finally{await h.close();fs.writeFileSync(path.join(OUT,'calendar-recovery-races-private.json'),JSON.stringify(report,null,2));console.log('Evidence '+OUT);}
 process.exitCode=report.status==='PASS'?0:1;
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});

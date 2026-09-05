'use strict';
// Real document and offered client controls; every receiver is intercepted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store,open,panel,snap,SOURCE,OUT,body,newer,Harness,ui,ID}=require('./run');
class SplitStore extends Store {
 constructor(outcome){super('calendar','tweak',null);this.outcome=outcome;}
 async handle(route,role,origin){
  const q=route.request(),url=new URL(q.url());let payload;try{payload=q.postDataJSON();}catch{}
  if(payload?.reconcile_only===true&&url.pathname==='/functions/v1/production-write'){
   const r=this.receipts.get(payload.request_id);this.records.push({action:'reconcile_only',outcome:r?'committed_exact':'absent'});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(r?{...r,outcome:'committed_exact'}:{ok:true,outcome:'absent',row:this.native.find(n=>n.id===payload.id)})});
  }
  const source=q.method()==='POST'&&url.pathname.endsWith('/calendar-upsert'),prior=this.feedbackFault;
  this.feedbackFault=this.outcome==='refused'?'reject':source?({partial:'reject',lost:'accepted-timeout',held:'held-success'}[this.outcome]||null):null;
  const result=super.handle(route,role,origin);this.feedbackFault=prior;return result;
 }
}
const recovery=s=>s.page.locator('[data-cal-review-recovery="video"]');
async function fresh(h,b,s){const storage=await s.context.storageState();await s.context.close();const next=await h.session(b,'client',{storageState:storage});await h.open(next);await next.page.waitForLoadState('networkidle');const card=next.page.locator(`[data-cal-review-pid="${ID}"]`);if(await card.isVisible()&&!await recovery(next).isVisible())await card.locator('.kcard-expand-btn').click();return next;}
async function main(){
 const h=await new Harness(SOURCE,OUT).start(),report={status:'INCOMPLETE',groups:[]};
 try{for(const outcome of (process.env.CAL_RECOVERY_OUTCOMES||'partial,lost,refused').split(',')){
  assert.ok(['partial','lost','refused'].includes(outcome));
  const b=new SplitStore(outcome);let s=await open(h,b,'calendar');
  await (await panel(s,'calendar')).locator('.cal-review-textarea').fill(body);
  await (await panel(s,'calendar')).locator('.cal-review-tweak-btn').click();
  await ui.until(async()=>b.feedbackWrites.length>0&&!(await snap(s,'calendar')).saving,'original action settles');
  if(outcome==='refused'){
   assert.equal((await snap(s,'calendar')).originalVisible,true);s=await fresh(h,b,s);
   assert.equal((await snap(s,'calendar')).originalVisible,true);assert.equal(b.comments.length,0);
  }else{
   if(!await recovery(s).isVisible())fs.writeFileSync(path.join(OUT,'pending-diagnostic-private.json'),JSON.stringify(await s.page.evaluate(ID=>({post:calState.posts.find(p=>p.id===ID),journal:_writeUiRepairJournalRead(),contexts:[..._reviewDraftRecords.values()],text:document.body.innerText.slice(-1600)}),ID),null,2));
   assert.equal(await recovery(s).isVisible(),true,'accepted feedback must remain reachable in Review');
   assert.ok((await recovery(s).innerText()).includes(body));
   assert.equal(await recovery(s).locator('.cal-review-approve-btn,.cal-review-tweak-btn').count(),0);
   const original=await s.page.evaluate(()=>[..._reviewDraftRecords.values()].find(c=>c.value.attempt)?.value.attempt.id);
   s=await fresh(h,b,s);if(!await recovery(s).isVisible())fs.writeFileSync(path.join(OUT,'fresh-diagnostic-private.json'),JSON.stringify(await s.page.evaluate(ID=>({post:calState.posts.find(p=>p.id===ID),journal:_writeUiRepairJournalRead(),contexts:[..._reviewDraftRecords.values()],text:document.body.innerText.slice(-1600)}),ID),null,2));assert.equal(await recovery(s).isVisible(),true,'same-link fresh page retains exact pending access');
   assert.ok((await recovery(s).innerText()).includes(body));
   b.outcome='held';await recovery(s).getByRole('button',{name:'Retry card sync',exact:true}).click();
   await ui.until(()=>b.pending.length>0,'existing source-only retry held');
   assert.equal(await recovery(s).getByRole('button',{name:'Retry card sync',exact:true}).isDisabled(),true);
   assert.equal(b.comments.filter(c=>c.body===body).length,1,'pending repeated action cannot send another native comment');
   b.release();await ui.until(()=>s.page.evaluate(ID=>!calState.posts.find(p=>p.id===ID)?._writeUiRetrySourceAt,ID),'source ack retires repair');
   await ui.until(async()=>!await recovery(s).isVisible(),'only resolved pending access disappears');
   assert.equal(b.comments.filter(c=>c.body===body).length,1);
   const sourceIds=b.feedbackWrites.filter(w=>w.transport==='source').flatMap(w=>JSON.parse(w.body.post.video_tweaks||'[]').filter(c=>c.body===body).map(c=>c.id));
   assert.ok(sourceIds.length>0&&sourceIds.every(id=>id===original),'original logical ID throughout recovery');
  }
  assert.equal(b.blocked.length,0);assert.deepEqual(h.sessions.flatMap(s=>s.errors),[]);
  report.groups.push({outcome,passed:true});console.log('PASS Calendar '+outcome+' recovery access');
  b.release();await h.closeSessions();
 }report.status='PASS';}finally{await h.close();fs.writeFileSync(path.join(OUT,'calendar-recovery-access-private.json'),JSON.stringify(report,null,2));console.log('Evidence '+OUT);}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});

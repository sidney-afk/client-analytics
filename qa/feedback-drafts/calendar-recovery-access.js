'use strict';
// Real document and offered client controls; every receiver is intercepted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store,open,panel,snap,SOURCE,OUT,body,newer,Harness,ui,ID}=require('./run');
const {CLIENTS,clone}=require('./mock-backend');
class SplitStore extends Store {
 constructor(outcome){super('calendar','tweak',null);this.outcome=outcome;}
 async handle(route,role,origin){
  const q=route.request(),url=new URL(q.url());let payload;try{payload=q.postDataJSON();}catch{}
  if(q.method()==='GET'&&url.pathname==='/rest/v1/calendar_posts'&&url.searchParams.has('id')){
   this.records.push({action:'exact_source_read'});
   const rows=this.rows.filter(r=>'eq.'+r.id===url.searchParams.get('id')&&'eq.'+r.client===url.searchParams.get('client'));
   const output=clone(rows);
   if(this.readFault==='source-shape'&&output[0])output[0].video_tweaks='not a complete array';
   return route.fulfill({status:this.readFault==='source-failed'?503:200,contentType:'application/json',headers:{'content-range':this.readFault==='source-partial'?'0-0/*':rows.length?'0-'+(rows.length-1)+'/'+rows.length:'*/0','access-control-expose-headers':'content-range'},body:JSON.stringify(output)});
  }
  if(payload?.reconcile_only===true&&url.pathname==='/functions/v1/production-write'){
   const r=this.receipts.get(payload.request_id);this.records.push({action:'reconcile_only',outcome:r?'committed_exact':'absent'});
   if(payload.operation==='comment'&&r){
    const original=this.feedbackWrites.find(w=>w.transport==='native'&&w.body.request_id===payload.request_id)?.body;
    assert.deepEqual(payload,{...original,reconcile_only:true},'readback uses byte-equivalent original fingerprint fields');
    const current=clone(this.comments.find(c=>c.native_comment_id===payload.comment.native_comment_id)),row=clone(this.native.find(n=>n.id===payload.id));
    if(this.readFault==='native-held')await new Promise(resolve=>this.pending.push(resolve));
    if(this.readFault==='native-owner')row.client_slug=CLIENTS[1].slug;
    if(this.readFault==='native-edited'){current.body='Fictional edited native feedback';current.version=2;current.edited_at=this.stamp();}
    return route.fulfill({status:this.readFault==='native-failed'?503:200,contentType:'application/json',body:JSON.stringify({ok:true,reconcile_only:true,outcome:'committed_exact',row,comment:{...current,source_created_at:original.source_edited_at,source_updated_at:original.source_edited_at}})});
   }
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(r?{...r,reconcile_only:true,outcome:'committed_exact'}:{ok:true,reconcile_only:true,outcome:'absent',row:this.native.find(n=>n.id===payload.id)})});
  }
  const source=q.method()==='POST'&&url.pathname.endsWith('/calendar-upsert'),prior=this.feedbackFault;
  if(source){
   const entry={transport:'source',body:clone(payload),outcome:'held'};this.feedbackWrites.push(entry);
   if(this.outcome==='held')await new Promise(resolve=>this.pending.push(resolve));
   if(this.outcome==='partial'){entry.outcome='refused';return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:'synthetic_write_refused'})});}
   if(this.onSourceCommit){const change=this.onSourceCommit;this.onSourceCommit=null;change();}
   const row=this.rows.find(r=>r.id===payload.post.id&&r.client===payload.client);assert.ok(row,'scoped source fixture target');
   // The frozen EF atomically merges comment cells. Model that contract rather
   // than replacing whole arrays and accidentally hiding concurrency failures.
   const patch=clone(payload.post);
   for(const field of ['video_tweaks','graphic_tweaks','caption_tweaks','title_tweaks'])if(field in patch){
    const merged=new Map(JSON.parse(row[field]||'[]').map(c=>[c.id,c]));
    for(const c of JSON.parse(patch[field])){const old=merged.get(c.id);if(!old||Date.parse(c.updated_at||c.created_at)>=Date.parse(old.updated_at||old.created_at))merged.set(c.id,c);}
    patch[field]=JSON.stringify([...merged.values()]);
   }
   if('video_tweaks' in patch)patch.tweaks=patch.video_tweaks;
   Object.assign(row,patch,{updated_at:this.stamp()});entry.outcome='accepted';
   if(this.outcome==='lost')return route.abort('timedout');
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,post:clone(row)})});
  }
  this.feedbackFault=this.outcome==='refused'?'reject':source?({partial:'reject',lost:'accepted-timeout',held:'held-success'}[this.outcome]||null):null;
  const result=super.handle(route,role,origin);this.feedbackFault=prior;return result;
 }
}
const recovery=s=>s.page.locator('[data-cal-review-recovery="video"]');
async function fresh(h,b,s){const storage=await s.context.storageState();await s.context.close();const next=await h.session(b,'client',{storageState:storage});await h.open(next);await next.page.waitForLoadState('networkidle');const card=next.page.locator(`[data-cal-review-pid="${ID}"]`);if(await card.isVisible()&&!await recovery(next).isVisible())await card.locator('.kcard-expand-btn').click();return next;}
async function pending(h,b){const s=await open(h,b,'calendar');await (await panel(s,'calendar')).locator('.cal-review-textarea').fill(body);await (await panel(s,'calendar')).locator('.cal-review-tweak-btn').click();await ui.until(async()=>b.feedbackWrites.length>0&&!(await snap(s,'calendar')).saving,'original action settles');return s;}
async function retry(s){await recovery(s).getByRole('button',{name:'Retry card sync',exact:true}).click();await ui.until(()=>s.page.evaluate(()=>[..._reviewDraftRecords.values()].every(c=>!c.recovering)),'read/recovery settles');}
async function guards(h,b){assert.equal(b.blocked.length,0);assert.deepEqual(h.sessions.flatMap(s=>s.errors),[]);assert.equal(b.comments.filter(c=>c.body===body).length,1,'one original native comment');}
async function main(){
 const h=await new Harness(SOURCE,OUT).start(),report={status:'INCOMPLETE',groups:[],browser:h.browser.version(),indexSha256:require('node:crypto').createHash('sha256').update(h.index).digest('hex')};
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
   const beforeWrites=b.feedbackWrites.length;
   const debtBefore=await s.page.evaluate(()=>localStorage.getItem(WRITE_UI_SOURCE_REPAIR_KEY));
   b.outcome='held';await recovery(s).getByRole('button',{name:'Retry card sync',exact:true}).click();
   if(outcome==='partial'){
    await ui.until(()=>b.pending.length>0,'existing source-only retry held').catch(async e=>{fs.writeFileSync(path.join(OUT,'retry-diagnostic-private.json'),JSON.stringify({contexts:await s.page.evaluate(()=>[..._reviewDraftRecords.values()]),records:b.records},null,2));throw e;});
    assert.equal(await recovery(s).getByRole('button',{name:'Retry card sync',exact:true}).isDisabled(),true);
    assert.equal(b.comments.filter(c=>c.body===body).length,1,'pending repeated action cannot send another native comment');
    b.release();
   }
   await ui.until(()=>s.page.evaluate(ID=>[..._reviewDraftRecords.values()].filter(c=>c.pid===ID).every(c=>!c.value.attempt),ID),'exact source readback retires only original feedback debt');
   if(outcome==='lost')assert.equal(b.feedbackWrites.length,beforeWrites,'already committed source is confirmed without another write');
   assert.equal(await s.page.evaluate(()=>localStorage.getItem(WRITE_UI_SOURCE_REPAIR_KEY)),debtBefore,'confirmation never clears unrelated source/status repair records');
   await ui.until(async()=>!await recovery(s).isVisible(),'only resolved pending access disappears');
   assert.equal(b.comments.filter(c=>c.body===body).length,1);
   const sourceIds=b.feedbackWrites.filter(w=>w.transport==='source').flatMap(w=>JSON.parse(w.body.post.video_tweaks||'[]').filter(c=>c.body===body).map(c=>c.id));
   assert.ok(sourceIds.length>0&&sourceIds.every(id=>id===original),'original logical ID throughout recovery');
  }
  assert.equal(b.blocked.length,0);assert.deepEqual(h.sessions.flatMap(s=>s.errors),[]);
  report.groups.push({outcome,passed:true});console.log('PASS Calendar '+outcome+' recovery access');
  b.release();await h.closeSessions();
 }
 if(!process.env.CAL_RECOVERY_OUTCOMES){
  for(const fault of ['source-failed','source-shape','source-partial','native-failed','native-owner','native-edited','source-edited']){
   const b=new SplitStore('partial');let s=await pending(h,b);s=await fresh(h,b,s);b.readFault=fault;b.outcome='healthy';
   if(fault==='source-edited'){const c=clone(JSON.parse(b.feedbackWrites.find(w=>w.transport==='source').body.post.video_tweaks)[0]);c.body='Fictional other saved revision';c.updated_at=b.stamp();b.rows[0].video_tweaks=JSON.stringify([c]);}
   const before=b.feedbackWrites.length;await retry(s);
   assert.equal(b.feedbackWrites.length,before,'unknown/conflicting read cannot write');assert.equal((await snap(s,'calendar')).originalVisible,true);
   assert.match(await recovery(s).innerText(),/could not be confirmed/);
   if(fault==='native-failed'){b.readFault=null;await retry(s);assert.equal(await recovery(s).isVisible(),false,'verified recovery clears its warning');assert.ok(JSON.parse(b.rows[0].video_tweaks).some(c=>c.body===body));}
   await guards(h,b);report.groups.push({fault,passed:true});console.log('PASS Calendar '+fault+' retains pending text without write');await h.closeSessions();
  }
  {
   const b=new SplitStore('partial');let s=await pending(h,b);s=await fresh(h,b,s);b.outcome='lost';const before=b.feedbackWrites.length;
   await retry(s);assert.equal((await snap(s,'calendar')).originalVisible,true);assert.equal(b.feedbackWrites.length,before+1);assert.ok(JSON.parse(b.rows[0].video_tweaks).some(c=>c.body===body));
   b.outcome='healthy';await retry(s);assert.equal(await recovery(s).isVisible(),false);assert.equal(b.feedbackWrites.length,before+1,'lost recovery response readback never rewrites an already saved copy');
   await guards(h,b);report.groups.push({name:'recovery response loss then exact readback',passed:true});console.log('PASS recovery response loss remains pending then confirms without repeat write');await h.closeSessions();
  }
  {
   const b=new SplitStore('partial');let s=await pending(h,b);s=await fresh(h,b,s);
   await s.page.evaluate(()=>{for(const c of _reviewDraftRecords.values())if(c.value.attempt){const value=JSON.parse(c.value.attempt.recoveryPayload);value.action='unexpected_action';c.value.attempt.recoveryPayload=JSON.stringify(value);}});
   const before=b.records.length,writes=b.feedbackWrites.length;await retry(s);assert.equal(b.feedbackWrites.length,writes);assert.equal(b.records.length,before,'unrecognized stored action is rejected before network');assert.equal((await snap(s,'calendar')).originalVisible,true);
   await guards(h,b);report.groups.push({name:'tampered receipt metadata',passed:true});console.log('PASS malformed receipt metadata never changes read into another operation');await h.closeSessions();
  }
  {
   const b=new SplitStore('partial');let s=await pending(h,b);
   await s.page.evaluate(()=>{for(const c of _reviewDraftRecords.values())if(c.value.attempt){delete c.value.attempt.recoveryPayload;localStorage.setItem(c.key,JSON.stringify(c.value));}});
   s=await fresh(h,b,s);const before=b.feedbackWrites.length;b.outcome='healthy';await retry(s);
   assert.match(await recovery(s).innerText(),/no complete receipt metadata/);assert.equal((await snap(s,'calendar')).originalVisible,true);assert.equal(b.feedbackWrites.length,before);
   await guards(h,b);report.groups.push({name:'old78 metadata absent',passed:true});console.log('PASS old78 attempt stays visible without guessed receipt or write');await h.closeSessions();
  }
  {
   const b=new SplitStore('partial');let s=await pending(h,b);s=await fresh(h,b,s);const before=b.feedbackWrites.length;
   const other={id:'fictional-concurrent-note',body:'Fictional concurrent note',role:'client',audience:'client',is_tweak:false,created_at:b.stamp(),updated_at:b.stamp()};
   b.onSourceCommit=()=>{b.rows[0].video_tweaks=JSON.stringify([other]);b.rows[0].video_status='Approved';b.rows[0].status='Approved';};
   b.outcome='held';await recovery(s).getByRole('button',{name:'Retry card sync',exact:true}).click();await ui.until(()=>b.pending.length>0,'source recovery held');
   await recovery(s).getByRole('textbox',{name:'Newer unsent note'}).fill(newer);b.release();await ui.until(()=>s.page.evaluate(()=>[..._reviewDraftRecords.values()].every(c=>!c.recovering)),'late exact ack settles');
   assert.equal((await snap(s,'calendar')).newerVisible,true);assert.equal(await s.page.locator(`[data-cal-review-pid="${ID}"]`).isVisible(),true,'newer unfinished work keeps its own card access');
   const comments=JSON.parse(b.rows[0].video_tweaks);assert.ok(comments.some(c=>c.id===other.id));assert.ok(comments.some(c=>c.body===body));
   assert.equal(b.rows[0].status,'Approved');assert.equal(b.rows[0].video_status,'Approved');
   const writes=b.feedbackWrites.slice(before);assert.equal(writes.length,1);assert.equal(writes[0].transport,'source');assert.deepEqual(Object.keys(writes[0].body.post).sort(),['id','tweaks','video_tweaks']);
   const approve=s.page.locator(`[data-cal-review-pid="${ID}"] .cal-review-panel[data-comp="video"] .cal-review-approve-btn`);
   if(await approve.isVisible())assert.equal(await approve.isDisabled(),true,'newer unsent work still prevents approval');
   await guards(h,b);report.groups.push({name:'concurrent source/newer local note and current status',passed:true});console.log('PASS concurrent source note/status and newer typing survive exact source-only repair');await h.closeSessions();
  }
  {
   const b=new SplitStore('partial');
   for(const [suffix,status] of [['202','Tweaks Needed'],['203','Client Approval']]){
    const row=clone(b.rows[0]),native=clone(b.native[0]);row.id='fixture-unrelated-'+suffix;row.name='Fictional unrelated '+suffix;row.status=status;row.video_status=status;row.video_deliverable_id='00000000-0000-4000-8000-000000000'+suffix;
    native.id=row.video_deliverable_id;native.card_id=row.id;native.status=status==='Tweaks Needed'?'tweak':'client_approval';b.rows.push(row);b.native.push(native);
   }
   const s=await pending(h,b);assert.equal(await s.page.locator('[data-cal-review-pid="fixture-unrelated-202"]').count(),0,'unrelated Tweaks Needed stays outside client review');
   const ordinary=s.page.locator('[data-cal-review-pid="fixture-unrelated-203"]');await ordinary.locator('.kcard-expand-btn').click();assert.equal(await ordinary.locator('.cal-review-approve-btn').isEnabled(),true,'ordinary approval eligibility unchanged');
   for(const width of [360,768,1440])for(const dark of [false,true]){
    await s.page.setViewportSize({width,height:1000});await s.page.evaluate(dark=>document.documentElement.setAttribute('data-theme',dark?'dark':'light'),dark);
    await recovery(s).scrollIntoViewIfNeeded();const box=await recovery(s).boundingBox();assert.ok(box.width>0&&box.x>=-1&&box.x+box.width<=width+1,'pending text and controls fit viewport');
    assert.equal(await recovery(s).getByRole('button',{name:'Retry card sync',exact:true}).isVisible(),true);
    await h.shot(s.page,'calendar-recovery-'+width+'-'+(dark?'dark':'light'));
   }
   b.readFault='native-failed';const button=recovery(s).getByRole('button',{name:'Retry card sync',exact:true});await button.focus();await s.page.keyboard.press('Enter');await ui.until(()=>s.page.evaluate(()=>[..._reviewDraftRecords.values()].every(c=>!c.recovering)),'keyboard retry settles');assert.match(await recovery(s).innerText(),/could not be confirmed/);
   await guards(h,b);report.groups.push({name:'unrelated eligibility and responsive keyboard controls',passed:true});console.log('PASS unrelated review eligibility and 6 viewport/theme recovery states');await h.closeSessions();
  }
  {
   const b=new SplitStore('partial');const beta=clone(b.rows[0]);beta.client=CLIENTS[1].slug;b.rows.push(beta);let s=await pending(h,b);s=await fresh(h,b,s);
   b.readFault='native-held';b.outcome='healthy';const before=b.feedbackWrites.length;await recovery(s).getByRole('button',{name:'Retry card sync',exact:true}).click();await ui.until(()=>b.pending.length>0,'native receipt read held');
   await s.page.goto(h.url('client','calendar',CLIENTS[1]),{waitUntil:'domcontentloaded'});await panel(s,'calendar');b.release();
   assert.equal((await snap(s,'calendar')).originalVisible,false);assert.equal(await recovery(s).isVisible(),false);assert.equal(b.feedbackWrites.length,before,'late A receipt cannot write in B document');
   await s.page.goto(h.url('client'),{waitUntil:'domcontentloaded'});await s.page.waitForLoadState('networkidle');const c=s.page.locator(`[data-cal-review-pid="${ID}"]`);if(!await recovery(s).isVisible())await c.locator('.kcard-expand-btn').click();assert.equal((await snap(s,'calendar')).originalVisible,true);
   await guards(h,b);report.groups.push({name:'same-ID client switch and late read',passed:true});console.log('PASS client switch never exposes or writes another owned attempt');await h.closeSessions();
  }
 }
 report.status='PASS';}finally{await h.close();fs.writeFileSync(path.join(OUT,'calendar-recovery-access-private.json'),JSON.stringify(report,null,2));console.log('Evidence '+OUT);}
}
module.exports={SplitStore,recovery,pending,fresh,retry,guards};
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});

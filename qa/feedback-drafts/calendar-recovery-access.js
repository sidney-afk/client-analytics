'use strict';
// Real document and offered client controls; every receiver is intercepted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store,open,panel,snap,SOURCE,OUT,body,newer,Harness,ui,ID}=require('./run');
const {CLIENTS,clone}=require('./mock-backend');
class SplitStore extends Store {
 constructor(outcome){super('calendar','tweak',null);this.outcome=outcome;this.materialized=new Set();}
 async handle(route,role,origin){
  const q=route.request(),url=new URL(q.url());let payload;try{payload=q.postDataJSON();}catch{}
  if(q.method()==='GET'&&url.pathname==='/rest/v1/calendar_posts'&&url.searchParams.has('id')){
   this.records.push({action:'exact_source_read'});
   const rows=this.rows.filter(r=>'eq.'+r.id===url.searchParams.get('id')&&'eq.'+r.client===url.searchParams.get('client'));
   const output=clone(rows);
   if(this.readFault==='source-shape'&&output[0])output[0].video_tweaks='not a complete array';
   return route.fulfill({status:this.readFault==='source-failed'?503:200,contentType:'application/json',headers:{'content-range':this.readFault==='source-partial'?'0-0/*':rows.length?'0-'+(rows.length-1)+'/'+rows.length:'*/0','access-control-expose-headers':'content-range'},body:JSON.stringify(output)});
  }
  if(payload?.recover_source&&url.pathname==='/functions/v1/production-write'){
   // Declared fixture contract for the additive recover_source lane: the same
   // decisions calendar_feedback_recovery_apply_v1 makes, modelled over the
   // in-memory native/source stores. Real PostgreSQL proof lives in
   // qa/calendar-feedback-recovery/; this keeps the browser-only lane honest.
   const rs=payload.recover_source,comp=rs.component,field=comp+'_tweaks';
   const record=this.records[this.records.push({action:'recover_source',outcome:'pending'})-1];
   if(this.holdRecovery){this.holdRecovery=false;await new Promise(resolve=>this.pending.push(resolve));}
   const held=reason=>{record.outcome='held:'+reason;return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,recover_source:true,outcome:'held',reason,error:'recovery_held',row:null,comment:null})});};
   const original=this.feedbackWrites.find(w=>w.transport==='native'&&w.body.request_id===payload.request_id)?.body;
   const r=this.receipts.get(payload.request_id);
   const current=this.comments.find(c=>c.native_comment_id===payload.comment.native_comment_id);
   if(this.readFault==='native-held')await new Promise(resolve=>this.pending.push(resolve));
   if(this.readFault==='native-failed'){record.outcome='unavailable';return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'reconcile_receipt_unavailable'})});}
   if(this.readFault==='native-owner'){record.outcome='forbidden';return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:'client_scope_mismatch'})});}
   const {recover_source:_omit,...bare}=payload;
   assert.deepEqual(bare,original,'recovery re-sends the byte-equivalent original comment request');
   if(!original||!r||!current)return held('native_comment_missing');
   if(this.onSourceCommit){const change=this.onSourceCommit;this.onSourceCommit=null;change();}
   const canonical=this.readFault==='native-edited'?{...current,body:'Fictional edited native feedback',version:2,edited_at:this.stamp()}:current;
   if(canonical.edited_at||canonical.deleted_at||canonical.resolved_at||canonical.version!==1)return held('native_lifecycle_changed');
   if(rs.kind==='tweak'){let sp=null;try{sp=JSON.parse(rs.status?.payload||'null');}catch{}if(!sp||sp.id!==payload.id||!this.receipts.get(sp.request_id))return held('companion_status_unproven');}
   const row=this.rows.find(x=>x.id===rs.card_id&&x[comp+'_deliverable_id']===payload.id);
   if(!row){record.outcome='forbidden';return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:'calendar_feedback_recovery_forbidden'})});}
   let cell;try{cell=row[field]?JSON.parse(row[field]):[];}catch{return held('source_cell_malformed');}
   if(!Array.isArray(cell)||cell.some(c=>!c||typeof c.id!=='string'||!c.id||typeof c.body!=='string')||new Set(cell.map(c=>c.id)).size!==cell.length)return held('source_cell_malformed');
   if(comp==='video'&&row.tweaks){let alias;try{alias=JSON.parse(row.tweaks);}catch{return held('source_alias_divergent');}
    if(!Array.isArray(alias)||alias.some(a=>!cell.some(c=>JSON.stringify(c)===JSON.stringify(a))))return held('source_alias_divergent');}
   const found=cell.find(c=>c.id===payload.comment.native_comment_id);
   const entry={id:current.native_comment_id,parent_id:null,author:current.author_name,role:'client',is_tweak:!!current.is_tweak,audience:'client',...(current.is_tweak?{round:current.round}:{}),body:current.body,created_at:original.source_edited_at,updated_at:original.source_edited_at,done:false,done_at:'',done_by:''};
   let outcome;
   if(found){
    if(found.deleted)return held('source_entry_tombstoned');
    if(found.body.trim()!==current.body||found.role!=='client'||found.audience!=='client'||!!found.is_tweak!==!!current.is_tweak||found.done||found.edited)return held('source_entry_conflict');
    if(Object.keys(rs.fields).some(k=>String(row[k]==null?'':row[k])!==rs.fields[k]))return held('source_fields_diverged');
    outcome=this.materialized.has(rs.card_id+'|'+comp+'|'+entry.id)?'already_materialized':'already_present';
   }else{
    if(this.materialized.has(rs.card_id+'|'+comp+'|'+entry.id))return held('materialization_conflict');
    if(String(row.updated_at)!==rs.expected_updated_at)return held('source_row_changed');
    cell.push(entry);row[field]=JSON.stringify(cell);if(comp==='video')row.tweaks=row[field];
    Object.assign(row,rs.fields,{updated_at:this.stamp()});outcome='materialized';
   }
   this.materialized.add(rs.card_id+'|'+comp+'|'+entry.id);record.outcome=outcome;
   if(this.loseRecoveryResponse){this.loseRecoveryResponse=false;return route.abort('failed');}
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,recover_source:true,outcome,row:clone(row),comment:{...clone(current),source_created_at:original.source_edited_at,source_updated_at:original.source_edited_at}})});
  }
  if(payload?.reconcile_only===true&&url.pathname==='/functions/v1/production-write'){
   const r=this.receipts.get(payload.request_id);this.records.push({action:'reconcile_only',outcome:r?'committed_exact':'absent'});
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
 const h=await new Harness(SOURCE,OUT).start(),report={status:'INCOMPLETE',groups:[],receiptModel:'declared recover_source fixture contract; PostgreSQL proof in qa/calendar-feedback-recovery',browser:h.browser.version(),indexSha256:require('node:crypto').createHash('sha256').update(h.index).digest('hex')};
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
   b.holdRecovery=true;await recovery(s).getByRole('button',{name:'Retry card sync',exact:true}).click();
   await ui.until(()=>b.pending.length>0,'recovery request held').catch(async e=>{fs.writeFileSync(path.join(OUT,'retry-diagnostic-private.json'),JSON.stringify({contexts:await s.page.evaluate(()=>[..._reviewDraftRecords.values()]),records:b.records},null,2));throw e;});
   assert.equal(await recovery(s).getByRole('button',{name:'Retry card sync',exact:true}).isDisabled(),true);
   assert.equal(b.comments.filter(c=>c.body===body).length,1,'pending repeated action cannot send another native comment');
   b.release();
   await ui.until(()=>s.page.evaluate(ID=>[..._reviewDraftRecords.values()].filter(c=>c.pid===ID).every(c=>!c.value.attempt),ID),'exact recovery retires only original feedback debt');
   const recovered=b.records.filter(r=>r.action==='recover_source');
   assert.equal(recovered.length,1,'exactly one recovery request');assert.equal(recovered[0].outcome,outcome==='lost'?'already_present':'materialized');
   assert.equal(b.feedbackWrites.length,beforeWrites,'recovery never issues a browser-side source write');
   assert.equal(await s.page.evaluate(()=>localStorage.getItem(WRITE_UI_SOURCE_REPAIR_KEY)),debtBefore,'confirmation never clears unrelated source/status repair records');
   await ui.until(async()=>!await recovery(s).isVisible(),'only resolved pending access disappears');
   assert.equal(b.comments.filter(c=>c.body===body).length,1);
   const sourceIds=JSON.parse(b.rows[0].video_tweaks||'[]').filter(c=>c.body===body).map(c=>c.id);
   assert.equal(sourceIds.length,1,'one source copy');assert.equal(sourceIds[0],original,'original logical ID throughout recovery');
   assert.equal(b.rows[0].video_status,'Tweaks Needed');assert.equal(b.rows[0].status,'Tweaks Needed');
  }
  assert.equal(b.blocked.length,0);assert.deepEqual(h.sessions.flatMap(s=>s.errors),[]);
  report.groups.push({outcome,passed:true});console.log('PASS Calendar '+outcome+' recovery access');
  b.release();await h.closeSessions();
 }
 if(!process.env.CAL_RECOVERY_OUTCOMES){
  for(const fault of ['source-shape','native-failed','native-owner','native-edited','source-edited','source-moved']){
   const b=new SplitStore('partial');let s=await pending(h,b);s=await fresh(h,b,s);b.readFault=fault;b.outcome='healthy';
   if(fault==='source-shape')b.rows[0].video_tweaks='not a complete array';
   if(fault==='source-edited'){const c=clone(JSON.parse(b.feedbackWrites.find(w=>w.transport==='source').body.post.video_tweaks)[0]);c.body='Fictional other saved revision';c.updated_at=b.stamp();b.rows[0].video_tweaks=JSON.stringify([c]);}
   if(fault==='source-moved'){b.rows[0].caption='Fictional unrelated caption edit';b.rows[0].updated_at=b.stamp();}
   const before=b.feedbackWrites.length,rowBefore=JSON.stringify(b.rows[0]);await retry(s);
   assert.equal(b.feedbackWrites.length,before,'unknown/conflicting read cannot write');assert.equal(JSON.stringify(b.rows[0]),rowBefore,'held recovery changes no source byte');assert.equal((await snap(s,'calendar')).originalVisible,true);
   assert.match(await recovery(s).innerText(),fault==='source-moved'?/card changed after your feedback/:fault==='native-edited'?/edited, deleted or resolved/:/could not be confirmed|could not be completed/);
   if(fault==='native-failed'){b.readFault=null;await retry(s);assert.equal(await recovery(s).isVisible(),false,'verified recovery clears its warning');assert.ok(JSON.parse(b.rows[0].video_tweaks).some(c=>c.body===body));}
   await guards(h,b);report.groups.push({fault,passed:true});console.log('PASS Calendar '+fault+' retains pending text without write');await h.closeSessions();
  }
  {
   const b=new SplitStore('partial');let s=await pending(h,b);s=await fresh(h,b,s);b.outcome='healthy';const before=b.feedbackWrites.length;
   b.loseRecoveryResponse=true;await retry(s);assert.equal((await snap(s,'calendar')).originalVisible,true);assert.equal(await recovery(s).isVisible(),true,'lost recovery response keeps the attempt pending');
   assert.ok(JSON.parse(b.rows[0].video_tweaks).some(c=>c.body===body),'the materialization itself committed');
   await retry(s);assert.equal(await recovery(s).isVisible(),false);const recovered=b.records.filter(r=>r.action==='recover_source').map(r=>r.outcome);
   assert.deepEqual(recovered,['materialized','already_materialized'],'lost recovery response then idempotent confirmation');assert.equal(b.feedbackWrites.length,before);
   await guards(h,b);report.groups.push({name:'recovery response loss then idempotent confirmation',passed:true});console.log('PASS recovery response loss remains pending then confirms idempotently');await h.closeSessions();
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
   b.rows[0].video_tweaks=JSON.stringify([other]);const moved=b.rows[0].updated_at=b.stamp();
   await s.page.evaluate(moved=>{for(const c of _reviewDraftRecords.values())if(c.value.attempt){c.value.attempt.recoverySource.expected_updated_at=moved;localStorage.setItem(c.key,JSON.stringify(c.value));}},moved);
   b.holdRecovery=true;await recovery(s).getByRole('button',{name:'Retry card sync',exact:true}).click();await ui.until(()=>b.pending.length>0,'recovery held');
   await recovery(s).getByRole('textbox',{name:'Newer unsent note'}).fill(newer);b.release();await ui.until(()=>s.page.evaluate(()=>[..._reviewDraftRecords.values()].every(c=>!c.recovering)),'late exact ack settles');
   assert.equal((await snap(s,'calendar')).newerVisible,true);assert.equal(await s.page.locator(`[data-cal-review-pid="${ID}"]`).isVisible(),true,'newer unfinished work keeps its own card access');
   const comments=JSON.parse(b.rows[0].video_tweaks);assert.deepEqual(comments[0],other,'concurrent note preserved byte-for-byte');assert.ok(comments.some(c=>c.body===body));
   assert.equal(b.rows[0].status,'Tweaks Needed');assert.equal(b.rows[0].video_status,'Tweaks Needed');
   assert.equal(b.feedbackWrites.length,before,'no browser-side source write');assert.equal(b.records.filter(r=>r.action==='recover_source').length,1);
   const approve=s.page.locator(`[data-cal-review-pid="${ID}"] .cal-review-panel[data-comp="video"] .cal-review-approve-btn`);
   if(await approve.isVisible())assert.equal(await approve.isDisabled(),true,'newer unsent work still prevents approval');
   await guards(h,b);report.groups.push({name:'concurrent source note and newer local note beside exact materialization',passed:true});console.log('PASS concurrent source note and newer typing survive exact materialization');await h.closeSessions();
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

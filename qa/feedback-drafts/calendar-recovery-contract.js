'use strict';
// Current gateway contract holds: attempts that cannot be finished safely stay
// visible with their exact text and never trigger a repair write or a request
// the server could misread. Distinct from the PostgreSQL proof lane.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {SplitStore,pending,fresh,retry,guards,recovery}=require('./calendar-recovery-access');
const {SOURCE,OUT,Harness,snap}=require('./run');
async function main(){
 const h=await new Harness(SOURCE,OUT).start(),report={status:'INCOMPLETE',groups:[],indexSha256:require('node:crypto').createHash('sha256').update(h.index).digest('hex')};
 try{for(const hold of ['old78','no-context','status-unreserved','status-unproven','row-changed']){
  const b=new SplitStore('partial');let s=await pending(h,b);
  await s.page.evaluate(hold=>{for(const c of _reviewDraftRecords.values())if(c.value.attempt){
   if(hold==='old78')delete c.value.attempt.recoveryPayload;
   if(hold==='no-context')delete c.value.attempt.recoverySource;
   if(hold==='status-unreserved')delete c.value.attempt.statusReservation;
   localStorage.setItem(c.key,JSON.stringify(c.value));}},hold);
  if(hold==='status-unproven'){for(const [key,value] of b.receipts)if(key.startsWith('calendar:status:')||key.startsWith('calendar:feedback-status:'))b.receipts.delete(key);}
  if(hold==='row-changed'){b.rows[0].caption='Fictional unrelated caption edit';b.rows[0].updated_at=b.stamp();}
  s=await fresh(h,b,s);const before=b.feedbackWrites.length,rowBefore=JSON.stringify(b.rows[0]),requests=b.records.filter(r=>r.action==='recover_source').length;b.outcome='healthy';await retry(s);
  assert.equal(b.feedbackWrites.length,before,'no native replay or source write on an unsupported proof');assert.equal(JSON.stringify(b.rows[0]),rowBefore,'held recovery changes no source byte');
  assert.equal((await snap(s,'calendar')).originalVisible,true);assert.equal(await recovery(s).isVisible(),true,'attempt stays visible and unresolved');
  const sent=b.records.filter(r=>r.action==='recover_source').length-requests;
  if(hold==='old78'){assert.equal(sent,0);assert.match(await recovery(s).innerText(),/no complete receipt metadata/);}
  else if(hold==='no-context'){assert.equal(sent,0);assert.match(await recovery(s).innerText(),/no complete original context/);}
  else if(hold==='status-unreserved'){assert.equal(sent,0);assert.match(await recovery(s).innerText(),/status change was never reserved/);}
  else if(hold==='status-unproven'){assert.equal(sent,1);assert.equal(b.records.filter(r=>r.action==='recover_source').at(-1).outcome,'held:companion_status_unproven');assert.match(await recovery(s).innerText(),/status change was not confirmed/);}
  else{assert.equal(sent,1);assert.equal(b.records.filter(r=>r.action==='recover_source').at(-1).outcome,'held:source_row_changed');assert.match(await recovery(s).innerText(),/card changed after your feedback/);}
  await guards(h,b);report.groups.push({hold,held:true});console.log('PASS current-contract '+hold+' keeps owned text and sends no repair write');await h.closeSessions();
 }report.status='PASS';}finally{await h.close();fs.writeFileSync(path.join(OUT,'calendar-recovery-contract-private.json'),JSON.stringify(report,null,2));console.log('Evidence '+OUT);}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});

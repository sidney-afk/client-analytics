'use strict';
// Current server compatibility hold, distinct from hypothetical compatible
// receipt controls used to isolate the independent source-atomicity blocker.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {SplitStore,pending,fresh,retry,guards,recovery}=require('./calendar-recovery-access');
const {SOURCE,OUT,Harness,snap}=require('./run');
async function main(){
 const h=await new Harness(SOURCE,OUT).start(),report={status:'INCOMPLETE',groups:[],indexSha256:require('node:crypto').createHash('sha256').update(h.index).digest('hex')};
 try{for(const outcome of ['partial','lost','old78']){
  const b=new SplitStore(outcome==='old78'?'partial':outcome);b.compatibleReceipts=false;let s=await pending(h,b);
  if(outcome==='old78')await s.page.evaluate(()=>{for(const c of _reviewDraftRecords.values())if(c.value.attempt){delete c.value.attempt.recoveryPayload;localStorage.setItem(c.key,JSON.stringify(c.value));}});
  s=await fresh(h,b,s);const before=b.feedbackWrites.length;b.outcome='healthy';await retry(s);
  assert.equal(b.feedbackWrites.length,before,'no native replay or source reconstruction on unsupported proof');assert.equal((await snap(s,'calendar')).originalVisible,true);
  if(outcome==='old78')assert.match(await recovery(s).innerText(),/no complete receipt metadata/);
  else {assert.ok(b.records.some(r=>r.action==='current_receipt_fingerprint_conflict'));assert.match(await recovery(s).innerText(),/receipt or card binding differs/);}
  await guards(h,b);report.groups.push({outcome,held:true});console.log('PASS current-contract '+outcome+' keeps owned text and sends no repair write');await h.closeSessions();
 }report.status='PASS';}finally{await h.close();fs.writeFileSync(path.join(OUT,'calendar-recovery-contract-private.json'),JSON.stringify(report,null,2));console.log('Evidence '+OUT);}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});

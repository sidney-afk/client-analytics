'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const toolsRoot=__dirname;
const {Harness,hash}=require(path.join(toolsRoot,'harness'));
const {Backend,CLIENTS,clone}=require(path.join(toolsRoot,'mock-backend'));
const ui=require(path.join(toolsRoot,'ui'));
const SOURCE=path.resolve(process.env.FEEDBACK_SOURCE||path.join(__dirname,'../..'));
const OUT=path.join(SOURCE,'.codex-tmp','feedback-drafts-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(OUT,{recursive:true});
const ID=ui.ID,body='Fictional feedback original',newer='Fictional feedback newer';
class Store extends Backend {
 constructor(surface,kind,fault){super('video',surface==='kasper'?'Kasper Approval':'Client Approval',false);this.surface=surface;this.kind=kind;this.feedbackFault=fault;this.feedbackWrites=[];this.pending=[];if(surface==='samples'){this.native[0].origin='samples';}}
 async handle(route,session,origin){
  const q=route.request(),url=new URL(q.url()),p=url.pathname,method=q.method();let data;try{data=q.postDataJSON();}catch{}
  if(method==='GET'&&p==='/rest/v1/sample_reviews'){
   const rows=this.surface==='samples'?this.rows.filter(r=>url.searchParams.get('client')==='eq.'+r.client||!url.searchParams.has('client')):[];
   return route.fulfill({status:200,contentType:'application/json',headers:{'content-range':rows.length?'0-'+(rows.length-1)+'/'+rows.length:'*/0','access-control-expose-headers':'content-range'},body:JSON.stringify(rows)});
  }
  const sourceWrite=method==='POST'&&(/\/(?:calendar-upsert|sample-review-upsert)$/.test(p));
  const nativeWrite=method==='POST'&&p==='/functions/v1/production-write'&&data?.operation;
  if(sourceWrite||nativeWrite){
   const entry={transport:sourceWrite?'source':'native',body:clone(data),outcome:'held'};this.feedbackWrites.push(entry);
   const fault=this.feedbackFault;
   if(fault?.startsWith('held'))await new Promise(resolve=>this.pending.push(resolve));
   if(fault==='reject'||fault==='held-reject'){entry.outcome='refused';return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,error:'synthetic_write_refused'})});}
   if(fault==='timeout'||fault==='held-timeout'){entry.outcome='timeout_unaccepted';return route.abort('timedout');}
   if(sourceWrite){
    const wire=data.post||data.sample,row=this.rows.find(r=>r.id===wire?.id&&r.client===data.client);
    assert.ok(row,'fixture refuses wrong-owner source writes');Object.assign(row,clone(wire),{updated_at:this.stamp()});entry.outcome='accepted';
    if(fault==='accepted-timeout')return route.abort('timedout');
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,[data.sample?'sample':'post']:clone(row)})});
   }
   const wrapped={request:()=>q,abort:(...a)=>route.abort(...a),continue:(...a)=>route.continue(...a),fulfill:async args=>{entry.outcome=args.status>=400?'refused':'accepted';if(fault==='accepted-timeout'&&entry.outcome==='accepted')return route.abort('timedout');return route.fulfill(args);}};
   return super.handle(wrapped,session,origin);
  }
  return super.handle(route,session,origin);
 }
 release(){this.pending.splice(0).forEach(r=>r());super.release();}
}
async function panel(s,surface){return ui.review(s.page,'video',surface==='kasper');}
async function open(h,b,surface,storageState){
 const s=await h.session(b,surface==='kasper'?'admin':'client',{storageState});
 if(surface==='kasper'){await h.open(s);await ui.card(s.page).waitFor();await s.page.locator('#navKasper').click();await s.page.locator('#kasperReviewBody').waitFor();}
 else if(surface==='samples')await s.page.goto(h.url('client').replace('v=calendar','v=sample-reviews&sxr=1'),{waitUntil:'domcontentloaded'});
 else await h.open(s);
 const p=await panel(s,surface);await p.waitFor();return s;
}
async function snap(s,surface){return s.page.evaluate(({surface,ID,body,newer})=>{
 const item=surface==='kasper'?_kasperState.items.find(i=>i.post.id===ID):null;
 const state=surface==='calendar'?_calReviewState:surface==='samples'?_sxrReviewState:null;
 const post=item?.post||(surface==='calendar'?calState.posts:sxrState.posts).find(p=>p.id===ID);
 const local=Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]));
 const session=Object.fromEntries(Object.keys(sessionStorage).map(k=>[k,sessionStorage.getItem(k)]));
 const text=JSON.stringify(post||{}),draft=item?item._drafts?.video:state?.drafts[ID+'|video'];
 const visible=document.body.innerText+'\n'+Array.from(document.querySelectorAll('textarea')).filter(el=>el.getClientRects().length).map(el=>el.value).join('\n');
 return {draft:draft||'',originalVisible:visible.includes(body),newerVisible:visible.includes(newer),originalInPost:text.includes(body),newerInPost:text.includes(newer),originalStorageKeys:Object.keys(local).filter(k=>local[k].includes(body)),newerStorageKeys:Object.keys(local).filter(k=>local[k].includes(newer)),originalSessionKeys:Object.keys(session).filter(k=>session[k].includes(body)),error:item?item._errors?.video:post?._saveError||state?.errors[ID+'|video']||null,saving:item?item._saving?.video:!!state?.saving[ID+'|video'],sourceRepairCount:typeof _writeUiStoredSourceRepairCount==='function'?_writeUiStoredSourceRepairCount():null,local,session};
 },{surface,ID,body,newer});}
async function main(){
 const h=await new Harness(SOURCE,OUT).start();const report={source:SOURCE,indexSha256:hash(fs.readFileSync(path.join(SOURCE,'index.html'))),browser:h.browser.version(),evidence:'ISOLATED_BROWSER_ONLY',cells:[],startedAt:new Date().toISOString()};
 const surfaces=(process.env.FEEDBACK_SURFACES||'calendar,samples,kasper').split(','),kinds=(process.env.FEEDBACK_KINDS||'note,tweak').split(','),faults=(process.env.FEEDBACK_FAULTS||'reject,accepted-timeout,held-reject').split(',');
 try{for(const surface of surfaces)for(const kind of kinds)for(const fault of faults){
  const b=new Store(surface,kind,fault),cell={surface,kind,fault,verdict:'INCOMPLETE'};report.cells.push(cell);
  try{
   const s=await open(h,b,surface);let p=await panel(s,surface);await p.locator('.cal-review-textarea').fill(body);
   cell.before=await snap(s,surface);await p.locator(kind==='note'?'.cal-review-comment-btn':'.cal-review-tweak-btn').click();
   await ui.until(()=>b.feedbackWrites.length>0,'feedback reaches real transport');
   if(fault.startsWith('held')){const input=s.page.locator('.cal-review-panel[data-comp="video"] .cal-review-textarea').filter({visible:true}).first();cell.newerTyped=await input.isVisible();if(cell.newerTyped)await input.fill(newer);cell.whileHeld=await snap(s,surface);b.release();}
   await ui.until(async()=>!(await snap(s,surface)).saving,'feedback settles',12000);
   cell.after=await snap(s,surface);cell.writes=b.feedbackWrites;
   cell.backendOriginal=JSON.stringify(b.rows).includes(body)||JSON.stringify(b.comments).includes(body);
   const storage=await s.context.storageState();await s.context.close();b.feedbackFault='reject';
   const reopened=await open(h,b,surface,storage);cell.reopened=await snap(reopened,surface);
   const recoverable=cell.reopened.originalInPost||cell.reopened.draft.includes(body)||cell.reopened.originalStorageKeys.length>0||cell.reopened.originalSessionKeys.length>0||cell.backendOriginal;
   const newerRecoverable=!cell.newerTyped||cell.reopened.draft.includes(newer)||cell.reopened.newerInPost||cell.reopened.newerStorageKeys.length>0;
   cell.originalRecoverable=recoverable;cell.newerRecoverable=newerRecoverable;
   cell.visibleRecovery=cell.reopened.originalVisible&&(!cell.newerTyped||cell.reopened.newerVisible);
   cell.verdict=recoverable&&newerRecoverable&&cell.visibleRecovery?'PASS':'FAIL';
   assert.equal(b.blocked.length,0,'all external requests are mocked');assert.equal(h.sessions.flatMap(s=>s.errors).length,0,'no unexpected browser error');
  }catch(e){cell.error=e.stack;cell.verdict='HARNESS_OR_CONTRACT_ERROR';const page=h.sessions.filter(s=>!s.page.isClosed()).at(-1)?.page;if(page)cell.diagnostic=await page.evaluate(()=>({text:document.body.innerText.slice(-3500),sxr:typeof sxrState==='undefined'?null:{client:sxrState.client,view:sxrState.view,posts:sxrState.posts,error:sxrState.error,loading:sxrState.loading},cap:typeof _syncviewClientEntryCapability==='undefined'?null:_syncviewClientEntryCapability})).catch(()=>null);cell.records=b.records;cell.blocked=b.blocked;}
  finally{b.release();await h.closeSessions();fs.writeFileSync(path.join(OUT,'report-private.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({surface,kind,fault,verdict:cell.verdict,originalRecoverable:cell.originalRecoverable,newerRecoverable:cell.newerRecoverable,error:cell.error?.split('\n')[0]}));}
 }}finally{await h.close();report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,'report-private.json'),JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({output:OUT,counts:report.cells.reduce((a,c)=>(a[c.verdict]=(a[c.verdict]||0)+1,a),{})}));process.exitCode=report.cells.every(c=>c.verdict==='PASS')?0:1;
}
module.exports={Store,open,snap,panel,SOURCE,OUT,ID,body,newer,Harness,ui};
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});

'use strict';
// The background snapshot warm-up (070, migrations/2026-09-23-workload-native-snapshot-warm.sql),
// executed from the built page in an isolated realm with controllable timers.
// Proves: a save's own response is returned untouched and never waits on the
// warm-up; only successful writes to snapshot sources trigger one; a burst costs
// one; the timer is shared across tabs; refusals switch it off. Not SQL/serving proof.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractFunction}=require('./helpers/extract-function');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const extract=name=>(html.includes('async function '+name+'(')?'async ':'')+extractFunction(html,name);
function constSrc(name){const at=html.indexOf('const '+name+' ');if(at<0)throw Error('const seam drift: '+name);
 let depth=0;for(let i=at;i<html.length;i++){const c=html[i];if('([{'.includes(c))depth++;else if(')]}'.includes(c))depth--;else if(c===';'&&depth===0)return html.slice(at,i+1);}
 throw Error('unterminated const: '+name);}
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;console.log('  ok  '+m);};
ok(/\n\s*wlInstallSnapshotWarmer\(\);\n/.test(html),'the warmer is installed at boot, on every page');

function realm({staff=true,warmStatus=200,warmBody={ok:true,rebuilt:true,reason:''}}={}){
 let now=1e6;const timers=[];const store=new Map();const calls=[];const warms=[];
 const setTimeout=(fn,ms)=>{const t={fn,at:now+(ms||0),live:true};timers.push(t);return t;};
 const clearTimeout=t=>{if(t)t.live=false;};
 const intervals=[];const setInterval=(fn,ms)=>{intervals.push({fn,ms});return intervals.length;};
 const saveFetch=(url,init)=>{const p=(async()=>{
  if(String(url).includes('workload-plan')&&init&&/warm_snapshot/.test(init.body||'')){warms.push(now);
   return {ok:warmStatus===200,status:warmStatus,json:async()=>warmBody};}
  return {ok:!/fail/.test(String(url)),status:/fail/.test(String(url))?500:200,json:async()=>({ok:true})};})();
  calls.push({url,init,p});return p;};
 const window={fetch:saveFetch};
 const context={window,console,JSON,Date:{now:()=>now},Number,String,Promise,setTimeout,clearTimeout,setInterval,
  document:{visibilityState:'visible'},
  localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))},
  WORKLOAD_PLAN_URL:'https://x.invalid/functions/v1/workload-plan',
  _syncviewStaffIdentityForHeaders:()=>staff?'staff':null,_syncviewEfHeaders:h=>h};
 vm.createContext(context);
 for(const c of ['WL_WARM_DEBOUNCE_MS','WL_WARM_INTERVAL_MS','WL_WARM_SHARED_KEY','WL_WARM_WRITE_FUNCTIONS','_wlWarm'])vm.runInContext(constSrc(c),context);
 for(const f of ['wlIsSnapshotSourceWrite','wlScheduleSnapshotWarm','wlWarmSnapshotNow','wlInstallSnapshotWarmer'])vm.runInContext(extract(f),context);
 vm.runInContext('wlInstallSnapshotWarmer();',context);
 const flush=()=>new Promise(r=>setImmediate(r));
 async function advance(ms){const end=now+ms;for(;;){await flush();const due=timers.filter(t=>t.live&&t.at<=end).sort((a,b)=>a.at-b.at)[0];
  if(!due)break;now=due.at;due.live=false;await due.fn();await flush();}now=end;await flush();}
 return {context,window,calls,warms,store,intervals,advance,flush,setNow:v=>{now=v;},get now(){return now;}};
}
const W='https://x.invalid/functions/v1/';
(async()=>{
 {const r=realm();
  const saved=r.window.fetch(W+'production-write',{method:'POST',body:'{}'});
  ok(saved===r.calls[0].p,'a save gets back the very promise the network returned: nothing is chained in front of it');
  const response=await saved;ok(response.ok===true&&response.status===200,'and resolves to the save\'s own response, unchanged');
  ok(r.warms.length===0,'no warm-up is sent while the save is in flight or immediately after it');
  await r.advance(1499);ok(r.warms.length===0,'nothing before the debounce');
  await r.advance(1);ok(r.warms.length===1,'one warm-up ~1.5 s after a successful save');}
 {const r=realm();
  for(let i=0;i<3;i++){await r.window.fetch(W+'production-write',{method:'POST',body:'{}'});await r.advance(500);}
  await r.advance(5000);ok(r.warms.length===1,'a burst of saves costs one warm-up');}
 {const r=realm();
  await r.window.fetch(W+'production-write-fail',{method:'POST'});
  await r.window.fetch(W+'production-write',{method:'GET'});
  await r.window.fetch(W+'workload-plan',{method:'POST',body:JSON.stringify({action:'list'})});
  await r.window.fetch(W+'production-comments',{method:'POST',body:'{}'});
  await r.window.fetch('https://x.invalid/rest/v1/deliverables',{method:'GET'});
  await r.advance(5000);ok(r.warms.length===0,'reads, failed saves and non-source writes send nothing');
  await r.window.fetch(W+'workload-plan',{method:'POST',body:JSON.stringify({action:'set',issue_id:'x'})});
  for(const fn of ['production-archive','calendar-upsert','calendar-reorder'])await r.window.fetch(W+fn,{method:'POST',body:'{}'});
  await r.advance(5000);ok(r.warms.length===1,'a saved work day and every other source-writing endpoint warm (coalesced)');}
 {const r=realm({staff:false});await r.window.fetch(W+'production-write',{method:'POST'});await r.advance(5000);
  ok(r.warms.length===0,'a page without staff sign-in never calls the staff-only warm-up');}
 for(const status of [400,401,403,501]){const r=realm({warmStatus:status});
  await r.window.fetch(W+'production-write',{method:'POST'});await r.advance(5000);
  await r.window.fetch(W+'production-write',{method:'POST'});await r.advance(5000);
  ok(r.warms.length===1,`a ${status} switches the warm-up off for the page`);}
 {const r=realm({warmBody:{ok:true,rebuilt:false,reason:'busy'}});
  await r.window.fetch(W+'production-write',{method:'POST'});await r.advance(1500);
  ok(r.warms.length===1,'first warm-up sent');await r.advance(4000);
  ok(r.warms.length>=2,'"busy" (a rebuild already running, possibly older than this save) is retried');}
 {const r=realm();ok(r.intervals.length===1&&r.intervals[0].ms===120000,'one 2-minute timer per page');
  r.store.set('syncview_wlSnapshotWarmAt_v1',String(r.now-30000));await r.intervals[0].fn();await r.advance(10);
  ok(r.warms.length===0,'the timer skips when another tab warmed in the last two minutes');
  r.store.set('syncview_wlSnapshotWarmAt_v1',String(r.now-200000));await r.intervals[0].fn();await r.advance(10);
  ok(r.warms.length===1,'and warms when nobody has');
  r.context.document.visibilityState='hidden';r.store.set('syncview_wlSnapshotWarmAt_v1','0');await r.intervals[0].fn();await r.advance(10);
  ok(r.warms.length===1,'a hidden tab never warms on the timer');}
 console.log(`PASS workload snapshot warm-up: ${checks} checks; transports intercepted, no SQL or serving proof.`);
})().catch(e=>{console.error(e);process.exitCode=1;});

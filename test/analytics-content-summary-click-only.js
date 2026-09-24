'use strict';
// The Analytics "What's Working This Month" content summary is a paid model
// call. It must start ONLY from a click, never because a profile was rendered
// (owner, 2026-09-23). Executes the built page's own buildContentSummarySection
// and generateContentSummary in an isolated realm; the webhook is intercepted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractFunction}=require('./helpers/extract-function');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const extract=name=>(html.includes('async function '+name+'(')?'async ':'')+extractFunction(html,name);
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;console.log('  ok  '+m);};
function realm(state){
 const calls=[],timers=[];
 const context={console,JSON,Date,Promise,Error,AbortController,encodeURIComponent,decodeURIComponent,
  setTimeout:(fn,ms)=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},alert:()=>{},
  localStorage:{setItem(){},getItem(){return null;}},document:{getElementById:()=>null},
  _isClientLink:false,_syncviewClientEntryDataRun:null,_syncviewClientEntryRunCurrent:()=>true,
  CONTENT_SUMMARY_WEBHOOK:'https://x.invalid/webhook/generate-content-summary',
  contentSummaryState:state,clientMap:{},topVideos:[{client_name:'Fixture',scraped_date:'2026-09-20'}],
  getTopMonthlyVideos:()=>[{platform:'instagram',video_url:'u',caption:'c',views:1,likes:1,comments:1}],n:Number,
  _svSkel:()=>'<i class="sk"></i>',
  fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return {text:async()=>JSON.stringify({bullets:'- one'})};}};
 vm.createContext(context);
 const guard=html.indexOf('const _contentSummaryStartedHere=');ok(guard>0,'the in-page start guard exists');
 vm.runInContext(html.slice(guard,html.indexOf(';',guard)+1),context);
 for(const f of ['buildContentSummarySection','generateContentSummary','refreshContentSummary'])vm.runInContext(extract(f),context);
 return {context,calls,timers};
}
(async()=>{
 const src=extract('buildContentSummarySection');
 ok(!/generateContentSummary\(clientName\)/.test(src)&&!/setTimeout\(/.test(src),'rendering a profile has no path that starts a generation');
 for(const [label,state] of [['no summary yet',{}],['a stale summary',{Fixture:{data:{bullets:'- old',date:'2026-09-01'}}}],
   ['a loading state restored from storage',{Fixture:{loading:true,data:null,error:null}}]]){
  const r=realm(state);const out=r.context.buildContentSummarySection('Fixture');
  for(const t of r.timers)await t();
  ok(r.calls.length===0,`profile render with ${label} makes no generation request`);
  ok(/onclick="generateContentSummary/.test(out),`and offers a click to generate (${label})`);}
 {const r=realm({});ok(/Generate summary/.test(r.context.buildContentSummarySection('Fixture')),'the empty state is a "Generate summary" button');
  await r.context.generateContentSummary('Fixture');
  ok(r.calls.length===1&&r.calls[0].url.endsWith('/generate-content-summary'),'a click sends exactly one generation request');
  ok(/one/.test(r.context.buildContentSummarySection('Fixture')),'and the result renders');}
 {const r=realm({});r.context.contentSummaryState.Fixture={loading:true,data:null,error:null};
  vm.runInContext("_contentSummaryStartedHere.add('Fixture')",r.context);
  ok(/sk/.test(r.context.buildContentSummarySection('Fixture'))&&r.calls.length===0,'a generation started on this page shows the loading skeleton');}
 console.log(`PASS analytics content summary click-only: ${checks} checks; webhook intercepted.`);
})().catch(e=>{console.error(e);process.exitCode=1;});

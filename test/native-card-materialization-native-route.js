"use strict";
// Extracted browser-native transport controls. No network, n8n, auth, or runtime flag read.
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const {extractFunction}=require('./helpers/extract-function');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const names=['_linearIntakeRead','_linearIntakeJobId','_linearIntakeValidateResult','_nativeAcceptedCardTransport',
  '_linearIntakeRequireActor','_writeNativeSubmissionCardsToCalendar','_syncviewEfHeaders','_calUpsertHeaders',
  '_sxrWriteHeaders','_calUpsertFetchPinned','_sxrUpsertFetchPinned','_calUpsertFetch'];
const source=names.map(name=>(name==='_writeNativeSubmissionCardsToCalendar'?'async ':'')+extractFunction(html,name)).join('\n');
const storage=new Map(),requests=[];
const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
const context={console,Map,Set,JSON,Math,Date,String,Number,Array,Object,Promise,Response,localStorage,
  NATIVE_INTAKE_PENDING_KEY:'native-job',CAL_SUPABASE_URL:'https://ef.fixture',_isIntake:true,_isClientLink:false,
  location:{hash:'',search:''},URLSearchParams,_syncviewStaffIdentityForHeaders:()=>({key:'fixture-key',member:{name:'Fixture Staff'},role:'smm'}),
  CALENDAR_UPSERT_EF_URL:'https://ef.fixture/functions/v1/calendar-upsert',CALENDAR_UPSERT_N8N_URL:'https://n8n.fixture/calendar',
  SXR_UPSERT_EF_URL:'https://ef.fixture/functions/v1/sample-review-upsert',SXR_UPSERT_N8N_URL:'https://n8n.fixture/samples',
  _calCacheRead:()=>null,_sxrCacheRead:()=>null,_calCacheWrite:()=>{},_sxrCacheWrite:()=>{},_calRenderBody:()=>{},_sxrRenderBody:()=>{},
  _linearIntakeCheckpointOrSuspend:()=>{},calState:null,sxrState:null,
  _calPrimeUpsertRoutingFlag:()=>Promise.resolve(),_calUpsertUrlForClient:()=>context.CALENDAR_UPSERT_N8N_URL,
  fetch:async(url,options)=>{requests.push({url,headers:options.headers,body:options.body});return new Response('{"ok":true}',{status:200});}
};
vm.createContext(context);vm.runInContext(source,context);
function job(surface='submission'){
  const isSamples=surface==='sxr',source=isSamples?'samples-native':surface==='calendar'?'calendar-native':'submission-native';
  const payload={surface,client_slug:'fixtureclient',request_id:'request:'+surface,items:[
    {team:'video',card_id:'card:'+surface,videoNumber:1},{team:'graphics',card_id:'card:'+surface,videoNumber:1}
  ]};
  const result={ok:true,native_committed:true,items:[
    {item_index:0,id:'video:'+surface,team:'video',card_id:'card:'+surface,video_number:1,title:'Native video'},
    {item_index:1,id:'graphic:'+surface,team:'graphics',card_id:'card:'+surface,video_number:1,title:'Native graphic'}
  ]};
  return {version:3,payload,context:{surface,materialization_source:source},result,completed_card_ids:[]};
}
async function expectNative(surface){
  requests.length=0;const current=job(surface);storage.set('native-job',JSON.stringify(current));
  await context._writeNativeSubmissionCardsToCalendar(current);
  assert.equal(requests.length,1);const request=requests[0],isSamples=surface==='sxr';
  assert.equal(request.url,isSamples?context.SXR_UPSERT_EF_URL:context.CALENDAR_UPSERT_EF_URL);
  assert.equal(request.headers['X-Syncview-Source'],isSamples?'samples-native':surface==='calendar'?'calendar-native':'submission-native');
  assert.equal(request.headers['Content-Type'],'application/json');assert.equal(request.headers['X-Syncview-Key'],'fixture-key');
  assert.equal(request.headers['X-Syncview-Actor'],'Fixture Staff');assert.equal(request.headers['X-Syncview-Role'],'smm');
  const body=JSON.parse(request.body),row=body[isSamples?'sample':'post'];
  assert.equal(body.client,'fixtureclient');assert.equal(row.id,'card:'+surface);
  assert.equal(row.video_deliverable_id,'video:'+surface);assert.equal(row.graphic_deliverable_id,'graphic:'+surface);
}
(async()=>{
  await expectNative('submission');await expectNative('calendar');await expectNative('sxr');
  requests.length=0;const incompatible=job('submission');incompatible.context.materialization_source='ui';
  storage.set('native-job',JSON.stringify(incompatible));const before=storage.get('native-job');
  await assert.rejects(context._writeNativeSubmissionCardsToCalendar(incompatible),error=>error&&error.code==='native_card_materialization_incompatible_job');
  assert.equal(requests.length,0);assert.equal(storage.get('native-job'),before);
  requests.length=0;const stale=job('calendar');storage.set('native-job',JSON.stringify({...stale,version:2}));const staleBefore=storage.get('native-job');
  await assert.rejects(context._writeNativeSubmissionCardsToCalendar(stale),error=>error&&error.code==='native_card_materialization_incompatible_job');
  assert.equal(requests.length,0);assert.equal(storage.get('native-job'),staleBefore);
  requests.length=0;context.fetch=async(url,options)=>{requests.push({url,headers:options.headers,body:options.body});return new Response('{"ok":false}',{status:409});};
  const held=job('submission');storage.set('native-job',JSON.stringify(held));
  await assert.rejects(context._writeNativeSubmissionCardsToCalendar(held),/calendar_card_write_failed/);
  assert.deepEqual(requests.map(x=>x.url),[context.CALENDAR_UPSERT_EF_URL]);
  requests.length=0;context.fetch=async(url,options)=>{requests.push({url,headers:options.headers,body:options.body});return new Response('{"ok":true}',{status:200});};
  await context._calUpsertFetch('fixtureclient',{client:'fixtureclient',post:{id:'ordinary'}},'ui');
  assert.equal(requests[0].url,context.CALENDAR_UPSERT_N8N_URL);assert.equal(requests[0].headers['X-Syncview-Source'],'ui');
  console.log('PASS native-card-materialization-native-route 6');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});

// Actual production-write HTTP handler; persistence here is an in-process model. All provider requests are
// synthetic or refused. The small named RPC model is not PostgreSQL proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const BASE='8514a83ed1a65145a3a51ffe52e5fcbb2976be31';
const EDGE='supabase/functions/production-write/index.ts';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const label=(n,extra={})=>({id:uuid(n),name:'Synthetic '+n,color:'#123456',description:null,archivedAt:null,isGroup:false,team:null,...extra});
const publicLabel=({id,name,color,description})=>({id,name,color,description});
const secrets={SUPABASE_URL:'https://supabase.synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',ROLE_KEY_ADMIN:'synthetic-admin',LINEAR_MIRROR_API_KEY:'synthetic-provider'};
let handler,store,provider='denied',providerCalls=0,unexpectedDestinations=0,background=0;
globalThis.Deno={env:{get:name=>secrets[name]},serve:fn=>{handler=fn;}};
globalThis.__labelClient=()=>store;
globalThis.EdgeRuntime={waitUntil:()=>{background++;throw Error('unexpected background work');}};
globalThis.fetch=async(url,options)=>{
  // This global seam never invokes the real network for ANY destination.
  if(url!=='https://api.linear.app/graphql'){unexpectedDestinations++;throw Error('unexpected synthetic destination');}providerCalls++;
  if(provider==='denied')throw Error('synthetic provider denied');
  const {query,variables}=JSON.parse(options.body);let data;
  if(query.includes('SyncViewProductionLabelIssue'))data={issue:{id:uuid(500),team:{id:uuid(900)}}};
  else if(query.includes('SyncViewProductionLabelCatalog')){
    data={team:{id:uuid(900),key:'VIDEO'},issueLabels:{nodes:provider==='empty'?[]:[label(1),label(2,{team:{id:uuid(900)}}),label(3,{team:{id:uuid(901)}}),label(4,{isGroup:true}),label(5,{archivedAt:'2026-09-01T12:00:00Z'})],pageInfo:{hasNextPage:false,endCursor:null}}};
    if(provider==='incomplete')delete data.issueLabels.pageInfo.hasNextPage;
    if(provider==='wrong-team')data.team.id=uuid(901);
  }else if(query.includes('SyncViewProductionSelectedLabels'))data={issue:{id:variables.id,team:{id:uuid(900)},labels:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}};
  else throw Error('unexpected provider operation');
  return new Response(JSON.stringify({data}),{status:200,headers:{'content-type':'application/json'}});
};
class Query{
  constructor(table){assert.ok(table in store.tables,'unexpected table');this.table=table;this.filters=[];}
  select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}
  result(){return clone(store.tables[this.table].filter(r=>this.filters.every(f=>f(r))));}
  async maybeSingle(){if(this.table==='syncview_runtime_flags'&&store.flagError)return{data:null,error:{message:'synthetic unavailable'}};if(this.table==='syncview_runtime_flags'&&'preinstallReply' in store&&this.filters.every(f=>f({key:'production_native_label_catalog'})))return store.preinstallReply;const rows=this.result();assert.ok(rows.length<2);return{data:rows[0]||null,error:null};}
  then(a,b){return Promise.resolve({data:this.result(),error:null}).then(a,b);}
}
class Store{
  constructor(){this.calls=[];this.flagError=false;this.catalogMode='complete';this.tables={deliverables:[{id:'synthetic-target',client_slug:'synthetic-client',team:'video',status:'todo',updated_at:'2026-09-05T10:00:00Z',linear_issue_uuid:uuid(500),linear_raw:{issue:{id:uuid(500),labelIds:[],labels:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}}}],
    team_members:[{id:'synthetic-member',name:'Synthetic admin',role:'admin',active:true}],clients:[{slug:'synthetic-client',display_name:'Synthetic client',kind:'client',active:true}],client_access:[{slug:'synthetic-client',review_token:'synthetic-token'}],mirror_outbox:[],deliverable_events:[],syncview_runtime_flags:[{key:'prod_authority',value:{video:'syncview',graphics:'syncview'}},{key:'linear_outbound_enabled',value:{mode:'off'}}]};}
  from(table){return new Query(table);}
  async rpc(name,args){
    this.calls.push({name,args:clone(args)});
    if(name==='track_b_f27_write_authorization')return{data:{ok:true,type:'f27_write_authorization',team:args.p_team,authority:'syncview',generation:7},error:null};
    if(name==='production_label_catalog_capability'){
      if('capabilityReply' in this)return this.capabilityReply;
      const row=this.tables.syncview_runtime_flags.find(r=>r.key==='production_native_label_catalog');
      return row?{data:row.value,error:null}:{data:null,error:{code:'PGRST202',message:'production_label_catalog_capability is absent'}};
    }
    if(name==='production_label_catalog_read_attested'){
      if(this.catalogMode==='failed')return{data:null,error:{message:'synthetic catalog read failed'}};
      const catalog=this.catalogMode==='empty'?[]:[publicLabel(label(1)),publicLabel(label(2))];
      const data={ok:true,schema_version:1,version_id:uuid(700),manifest_sha256:'a'.repeat(64),team:args.p_team,structure_complete:true,operator_attested:true,verification_state:'operator_attested',attestation_sha256:'b'.repeat(64),catalog};
      if(this.catalogMode==='unverified')data.operator_attested=false;
      if(this.catalogMode==='changed')data.version_id=uuid(701);
      if(this.catalogMode==='malformed')data.catalog=[{id:uuid(1),name:'Synthetic 1',color:'bad',description:null}];
      return{data,error:null};
    }
    if(name==='production_label_catalog_validate_selection'){
      if(this.catalogMode==='validation-failed')return{data:null,error:{message:'synthetic failure'}};
      if(args.p_requested_ids.includes(uuid(999)))return{data:null,error:{message:'label_not_applicable'}};
      return{data:{validation_only:true,version_id:uuid(700),manifest_sha256:'a'.repeat(64),selected_label_ids:args.p_requested_ids},error:null};
    }
    assert.ok(['production_deliverable_write','production_labels_write'].includes(name),'unexpected RPC');
    if(name==='production_labels_write'&&args.p_event.outbound.payload.label_ids.includes(uuid(999)))return{data:null,error:{message:'label_not_applicable'}};
    const r=clone(args.p_row),e=clone(args.p_event),out=e.outbound;
    assert.equal(out.operation,'labels');assert.equal(e.action,'labels_change');assert.ok(out.payload._intent_fingerprint);assert.equal(e.expected_updated_at,this.tables.deliverables[0].updated_at);
    if(name==='production_labels_write'){
      const ids=out.payload.label_ids;r.linear_raw.issue={...r.linear_raw.issue,labelIds:ids,labels:{nodes:ids.map(id=>publicLabel(label(Number(id.slice(-12))))),pageInfo:{hasNextPage:false,endCursor:null}}};
    }
    r.updated_at='2026-09-05T12:00:01Z';
    this.tables.deliverables[0]=r;this.tables.deliverable_events.push(e);
    this.tables.mirror_outbox.push({...out,id:1,client_slug:r.client_slug,team:r.team,actor:e.actor,role:e.role,status:name==='production_labels_write'?'skipped':'pending',linear_result:name==='production_labels_write'?{native_labels:true,catalog_version:out.payload._native_label_catalog_version}:null});
    return{data:clone(r),error:null};
  }
}
function payload(action='read'){return action==='read'?{action:'labels_read',surface:'production',id:'synthetic-target'}:{operation:'labels',entity:'deliverable',surface:'production',id:'synthetic-target',request_id:'synthetic-label-request',source_edited_at:'2026-09-05T12:00:00Z',expected_updated_at:'2026-09-05T10:00:00Z',label_ids:[uuid(2),uuid(1)]};}
async function call(fn,body,client=false){const headers={'content-type':'application/json',...(client?{'x-syncview-client-token':'synthetic-token'}:{'x-syncview-key':'synthetic-admin','x-syncview-actor':'Synthetic admin'})};const r=await fn(new Request('https://gateway.synthetic.invalid',{method:'POST',headers,body:JSON.stringify(body)}));return{status:r.status,body:await r.json()};}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'native-label-handler-'));
const cases=[];let checks=0;
function pass(name){checks++;cases.push(name);}
try{
  const baseline=execFileSync('git',['show',BASE+':'+EDGE],{cwd:ROOT,encoding:'utf8',maxBuffer:4*1024*1024});
  let source=fs.readFileSync(path.join(ROOT,EDGE),'utf8');assert.notEqual(source,baseline,'G2 must integrate the dormant owner into the actual handler');pass('candidate gateway deliberately differs from pinned provider-only baseline');
  const sourceHash=sha(source);
  function once(a,b){assert.equal(source.split(a).length,2);source=source.replace(a,b);}
  const shim='data:text/javascript,'+encodeURIComponent('export class SupabaseClient {} export function createClient(){return globalThis.__labelClient();}');
  once('import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";',`import { createClient, SupabaseClient } from "${shim}";`);
  for(const relative of ['../_shared/staff-role-auth.ts','./selected-label-pages.mjs','../_shared/linear-create-id.mjs','./policy.mjs'])once(`from "${relative}";`,`from "${pathToFileURL(path.resolve(ROOT,'supabase/functions/production-write',relative)).href}";`);
  fs.writeFileSync(path.join(tmp,'handler.ts'),source);await import(pathToFileURL(path.join(tmp,'handler.ts')).href);assert.equal(typeof handler,'function');
  for(const action of ['read','write']){
    store=new Store();provider='denied';let start=providerCalls;let before=JSON.stringify(store.tables);
    const refused=await call(handler,payload(action));assert.equal(refused.status,503);assert.equal(refused.body.error,'label_catalog_unavailable');assert.ok(providerCalls>start);assert.equal(JSON.stringify(store.tables),before);pass('provider-denied '+action+' remains a real native-authority blocker, with no mutation');
    for(const client of [true]){start=providerCalls;const r=await call(handler,payload(action),client);assert.equal(r.status,403);assert.equal(providerCalls,start);pass('client '+action+' denied before provider or catalog exposure');}
    store=new Store();store.flagError=true;start=providerCalls;const authority=await call(handler,payload(action));assert.equal(authority.status,503);assert.equal(authority.body.error,'authority_unavailable');assert.equal(providerCalls,start);pass('failed authority '+action+' has no guessed provider fallback');
  }
  for(const mode of ['healthy','empty','incomplete','wrong-team']){
    store=new Store();provider=mode;const r=await call(handler,payload());
    if(mode==='healthy'){assert.equal(r.status,200);assert.deepEqual(r.body.catalog.map(x=>x.id),[uuid(1),uuid(2)]);}
    if(mode==='empty'){assert.equal(r.status,200);assert.deepEqual(r.body.catalog,[]);assert.deepEqual(r.body.selected_label_ids,[]);}
    if(mode==='incomplete'){assert.equal(r.status,502);assert.equal(r.body.error,'label_catalog_incomplete');assert.notEqual(r.body.complete,true);assert.ok(!r.body.catalog);}
    if(mode==='wrong-team'){assert.equal(r.status,409);assert.equal(r.body.error,'linear_team_mapping_unavailable');}
    pass('actual provider '+mode+' read keeps its existing outcome');
  }
  for(const mode of ['complete','empty']){
    store=new Store();store.tables.syncview_runtime_flags.push({key:'production_native_label_catalog',value:{mode:'native',schema_version:1,version_id:uuid(700)}});store.catalogMode=mode;provider='denied';const start=providerCalls;
    const r=await call(handler,payload());assert.equal(r.status,200);assert.equal(providerCalls,start);assert.equal(r.body.catalog_version,uuid(700));assert.equal(r.body.catalog.length,mode==='empty'?0:2);pass('native '+mode+' catalog read succeeds with zero attempted provider egress');
  }
  for(const value of [false,0,'',undefined,[],{}]){
    store=new Store();store.preinstallReply={data:value,error:null};provider='healthy';const start=providerCalls,r=await call(handler,payload());assert.equal(r.status,503);assert.equal(providerCalls,start);pass('actual missing-RPC preinstall check refuses malformed flag data '+String(value));
  }
  for(const reply of [null,[],{data:null},{data:{schema_version:1,mode:'native',version_id:uuid(700)}},{data:{schema_version:1,mode:['provider'],version_id:null},error:null},{data:{schema_version:1,mode:['hold'],version_id:null},error:null}]){
    store=new Store();store.capabilityReply=reply;provider='healthy';const start=providerCalls,r=await call(handler,payload());assert.equal(r.status,503);assert.equal(providerCalls,start);pass('malformed capability envelope never becomes provider fallback '+JSON.stringify(reply));
  }
  for(const mode of ['failed','unverified','changed','malformed']){
    store=new Store();store.tables.syncview_runtime_flags.push({key:'production_native_label_catalog',value:{mode:'native',schema_version:1,version_id:uuid(700)}});store.catalogMode=mode;provider='denied';const start=providerCalls;const r=await call(handler,payload());assert.ok(r.status>=500);assert.equal(providerCalls,start);assert.notEqual(r.body.complete,true);pass('native '+mode+' catalog refuses truthfully with zero attempted provider egress');
  }
  store=new Store();store.tables.syncview_runtime_flags.push({key:'production_native_label_catalog',value:{mode:'native',schema_version:1,version_id:uuid(700)}});provider='denied';const nativeStart=providerCalls;
  for(const [caseIndex,ids] of [[],[uuid(1)],[uuid(999)]].entries()){const before=JSON.stringify(store.tables);const r=await call(handler,{...payload('write'),request_id:uuid(800+caseIndex),expected_updated_at:store.tables.deliverables[0].updated_at,catalog_version:uuid(700),label_ids:ids});assert.equal(r.status,ids.includes(uuid(999))?400:200,JSON.stringify(r.body));if(ids.includes(uuid(999))){assert.equal(r.body.error,'label_not_applicable');assert.equal(JSON.stringify(store.tables),before);}else{assert.equal(r.body.mirror.not_applicable,true);assert.deepEqual(r.body.selected_label_ids,ids);}assert.equal(providerCalls,nativeStart);pass('native modeled commit covers '+(ids.length?ids[0]:'clear')+' without provider');}
  store=new Store();provider='healthy';delete store.tables.deliverables[0].linear_raw.issue.labels.pageInfo.hasNextPage;
  const partial=await call(handler,payload());assert.equal(partial.status,409);assert.equal(partial.body.error,'native_label_state_incomplete');pass('complete provider catalog never blesses incomplete native selection');
  store=new Store();provider='healthy';const write=payload('write');const accepted=await call(handler,write);assert.equal(accepted.status,200);assert.deepEqual(accepted.body.selected_label_ids,[uuid(1),uuid(2)]);assert.equal(store.tables.mirror_outbox.length,1);assert.equal(store.tables.deliverable_events.length,1);pass('unchanged full-selected-set writer preserves event and applicable provider outbox');
  const fingerprint=store.tables.mirror_outbox[0].payload._intent_fingerprint,before=JSON.stringify(store.tables);provider='denied';let start=providerCalls;
  const replay=await call(handler,write);assert.equal(replay.status,200);assert.equal(providerCalls,start);assert.equal(JSON.stringify(store.tables),before);assert.equal(store.tables.mirror_outbox[0].payload._intent_fingerprint,fingerprint);pass('accepted request replay before provider/CAS preserves exact original fingerprint and outbox');
  const conflict=await call(handler,{...write,label_ids:[uuid(1)]});assert.equal(conflict.status,409);assert.equal(conflict.body.error,'idempotency_conflict');assert.equal(providerCalls,start);assert.equal(JSON.stringify(store.tables),before);pass('same request changed full selection still conflicts without provider');
  for(const id of [3,4,5,999]){store=new Store();provider='healthy';const r=await call(handler,{...write,label_ids:[uuid(id)]});assert.equal(r.status,400);assert.equal(r.body.error,'label_not_applicable');assert.equal(store.tables.mirror_outbox.length,0);pass('new inapplicable provider label '+id+' remains refused');}
  store=new Store();provider='healthy';store.tables.deliverables[0].linear_raw.issue={id:uuid(500),labelIds:[uuid(5)],labels:{nodes:[publicLabel(label(5))],pageInfo:{hasNextPage:false,endCursor:null}}};
  const historical=await call(handler,{...write,label_ids:[uuid(5)]});assert.equal(historical.status,200);assert.deepEqual(historical.body.selected_label_ids,[uuid(5)]);pass('selected archived historical identity remains retainable');
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const extract=(name,next)=>{const at=html.indexOf('function '+name+'('),end=html.indexOf('function '+next+'(',at);assert(at>0&&end>at);let text=html.slice(at,end);if(name==='_prodRunLabelsWrite')text='async '+text;return text.trim();};
  const browser=vm.createContext({Map,Set,console});
  vm.runInContext(`var _prodState={labels:new Map(),writes:new Map(),labelRequestTokens:new Map()};var _syncviewStaffVerificationEpoch=1;var bodySeen;var replaceActor=false;
    function _prodIssue(id){return{id};}function _prodLabelState(id){return _prodState.labels.get(id);}function _prodCanWrite(){return true;}
    function _syncviewStaffIdentityForHeaders(){return{name:'Synthetic admin'};}function _syncviewStaffIdentitySignature(){return String(_syncviewStaffVerificationEpoch);}
    function _prodRefreshLabelSurfaces(){}function _prodToast(){}function _prodEnsureLabels(){}
    async function _prodGatewayWrite(issue,operation,body){bodySeen=body;if(replaceActor)_syncviewStaffVerificationEpoch++;return{catalog:[],selected_labels:[],selected_label_ids:[],catalog_version:body.catalog_version};}
    ${extract('_prodNormalizeLabel','_prodNormalizeLabelList')}
    ${extract('_prodNormalizeLabelList','_prodLabelState')}
    ${extract('_prodNextLabelRequestToken','_prodAdoptLabelPayload')}
    ${extract('_prodAdoptLabelPayload','_prodLabelErrorText')}
    ${extract('_prodRunLabelsWrite','_prodOpenLabels')}`,browser);
  for(const version of [uuid(700),'']){
    browser.fixtureVersion=version;vm.runInContext("_prodAdoptLabelPayload('fixture',{catalog:[],selected_labels:[],selected_label_ids:[],catalog_version:fixtureVersion});",browser);
    await vm.runInContext("_prodRunLabelsWrite('fixture',[])",browser);assert.equal(browser.bodySeen.catalog_version,version||undefined);assert.equal(Object.hasOwn(browser.bodySeen,'catalog_version'),!!version);pass('actual browser picker forwards exact native version / omits provider field '+String(!!version));
  }
  browser.replaceActor=true;vm.runInContext("_prodAdoptLabelPayload('fixture',{catalog:[],selected_labels:[],selected_label_ids:[],catalog_version:'original'});",browser);await vm.runInContext("_prodRunLabelsWrite('fixture',[])",browser);assert.equal(vm.runInContext("_prodLabelState('fixture').saving",browser),true);pass('unchanged actual browser identity guard refuses late label response adoption');
  assert.equal(background,0);assert.equal(unexpectedDestinations,0);
  const report={status:'PASS',checks,cases,baseline_commit:BASE,source_sha256:sourceHash,provider_requests_synthetic_or_refused:providerCalls,unexpected_fetch_destinations:unexpectedDestinations,background_tasks:background,network_seam:'global fetch is entirely replaced, never delegates to real transport; this is not a browser/socket receiver test',proof:'actual HTTP handler with strict in-process RPC model; direct provider transport denied or synthetic; blocked baseline native readiness deliberately remains blocked; no SQL writer atomicity, deployment, native activation or zero-egress cutover proof'};
  if(process.env.NATIVE_LABEL_HANDLER_REPORT)fs.writeFileSync(process.env.NATIVE_LABEL_HANDLER_REPORT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{
  assert.equal(path.dirname(path.resolve(tmp)),path.resolve(os.tmpdir()));const file=path.join(tmp,'handler.ts');if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(tmp);
}

// Actual accepted gateway + extracted browser creation payload + candidate SQL.
// SQL transport only, fictional records, no live/provider request can leave.
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
import {createRequire} from 'node:module';
import {loadGateway,ROOT} from '../native-intake-reconcile/load-gateway.mjs';
import {runSql,hooks,resetHooks} from '../native-intake-manifest/supabase-shim.mjs';
const require=createRequire(import.meta.url),{extractFunction}=require('../../test/helpers/extract-function');
const gw=await loadGateway();const q=v=>"'"+String(v).replace(/'/g,"''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
async function sql(s){const r=await runSql(s);if(r.status!==0)throw new Error('fixture_sql_failed:'+r.stderr);return r.stdout.trim();}
async function rows(s){return JSON.parse(await sql('select coalesce(json_agg(t),\'[]\'::json) from ('+s+') t;'));}
async function call(body,surface='calendar',source='submission-native',raw){
  return JSON.parse(await sql(`set role service_role;select public.production_card_materialize(${q(surface)},${q(source)},${q(raw??JSON.stringify(body))})::text;`));
}
const capture={console,_isIntake:true,__sent:[],_linearIntakeCheckpointOrSuspend:()=>{},_calCacheRead:()=>null,_sxrCacheRead:()=>null,
  _calCacheWrite:()=>{},_sxrCacheWrite:()=>{},
  _linearIntakeRead:()=>capture.__job||null,
  _calUpsertFetchPinned:async(_c,p,s,transport)=>{capture.__sent.push({body:p,surface:'calendar',source:s,transport});return new Response(JSON.stringify({ok:false}),{status:409});},
  _sxrUpsertFetchPinned:async(_c,p,s,transport)=>{capture.__sent.push({body:p,surface:'samples',source:s,transport});return new Response(JSON.stringify({ok:false}),{status:409});}};
vm.createContext(capture);const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
vm.runInContext(['async '+extractFunction(html,'_writeNativeSubmissionCardsToCalendar'),extractFunction(html,'_nativeAcceptedCardTransport'),extractFunction(html,'_linearIntakeValidateResult'),extractFunction(html,'_linearIntakeRequireActor'),extractFunction(html,'_linearIntakeJobId')].join('\n'),capture);
async function accepted(mode='both',surface='calendar',failAt=0,overrides={}){
  const body=gw.rootBody(mode,gw.requestId(surface==='samples'?'sxr':'submission'),{surface:surface==='samples'?'sxr':'submission',...overrides});
  let n=0;hooks.beforeRpc=name=>{if(name==='production_deliverable_write'&&++n===failAt)throw new Error('synthetic_child_interruption');};
  const response=await gw.post(body);resetHooks();
  if(failAt)return {body,response};
  if(response.status!==201)throw new Error('gateway_acceptance_failed:'+JSON.stringify(response));
  return emitted(body,response);
}
async function emitted(body,response){
  capture.__sent=[];const job={version:3,payload:body,result:response.json,context:{surface:body.surface,materialization_source:source},completed_card_ids:[]};capture.__job=job;try{await capture._writeNativeSubmissionCardsToCalendar(job);}catch{}
  if(capture.__sent.length!==1)throw new Error('actual_browser_payload_missing');
  return {intake_body:body,response,...capture.__sent[0]};
}

export {gw,accepted,emitted,call,sql,rows};

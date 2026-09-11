'use strict';
const assert=require('node:assert/strict');
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-offline-only';
const helper=require('../scripts/client-signoff-native-verification');
const reconcile=require('../scripts/client-signoff-reconcile');
let checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
const row=()=>({id_text:'9007199254740993',entity:'deliverable',entity_id:'del-1',operation:'status',status:'skipped',role:'client',client_slug:'testclient',test_only:false,legacy_parity:false,payload:{status:'approved'},source_edited_at:'2026-09-05T10:00:00.123456Z',created_at:'2026-09-05T10:00:00.123456Z'});
const attest=r=>({receipt_id:r.id_text,verified:true,entity_id:r.entity_id,client_slug:r.client_slug,source_edited_at:r.source_edited_at});
const card=()=>({id:'card-1',client:'testclient',status:'Client Approval',video_status:'Approved',graphic_status:'Approved',caption_status:'Approved',video_tweaks:'',graphic_tweaks:'',caption_tweaks:'',video_deliverable_id:'del-1',graphic_deliverable_id:null,client_caption_approved_at:'2026-09-01T00:00:00Z',client_video_approved_at:null,updated_at:'2026-09-01T00:00:00Z'});
const del=()=>({id:'del-1',card_id:'card-1',kind:'video',team:'video',origin:'calendar',client_slug:'testclient',status:'approved'});
const world=r=>({outbox:[r],comments:[],cards:[card()],deliverables:[del()]});
(async()=>{
 let r=row();await helper.verifyRows([r],async ids=>{check(ids,['9007199254740993']);return [attest(r)];});check(helper.evidence(r).receipt_id,r.id_text);check(helper.evidence(r).source_edited_at,r.source_edited_at);
 check(helper.evidence({...r}),null);r.actor='changed';check(helper.evidence(r),null);
 for(const fault of [async()=>{throw Error('missing RPC')},async()=>[],async()=>[{...attest(row()),receipt_id:'1'}],async()=>[{...attest(row()),client_slug:'other'}],async()=>[{...attest(row()),source_edited_at:'2026-09-05T10:00:00.123457Z'}],async()=>[{...attest(row()),verified:'true'}],async()=>[{...attest(row()),verified:false}],async()=>[{...attest(row()),extra:true}]]){r=row();await helper.verifyRows([r],fault);check(helper.evidence(r),null);}
 r=row();r.id_text=9007199254740993;let invoked=false;await helper.verifyRows([r],async()=>{invoked=true;return[];});check(invoked,false);check(helper.evidence(r),null);
 r=row();await helper.verifyRows([r],async()=>[attest(r)]);await helper.verifyRows([r],async()=>[]);check(helper.evidence(r),null);
 const many=Array.from({length:201},(_,i)=>({...row(),id_text:String(i+1)}));let pages=0;await helper.verifyRows(many,async ids=>{pages++;return pages===1?many.slice(0,200).map(attest):[];});check(pages,2);check(many.every(x=>!helper.evidence(x)),true);
 const raced=Array.from({length:201},(_,i)=>({...row(),id_text:String(i+1)}));let batchNumber=0;await helper.verifyRows(raced,async ids=>{batchNumber++;if(batchNumber===2)raced[0].payload={status:'changed'};return ids.map(v=>attest(raced.find(x=>x.id_text===v)));});check(raced.every(x=>!helper.evidence(x)),true);
 r=row();r.payload._native_ordinary_receipt={schema:1};const refused=reconcile.classify(reconcile.detect(world(r)));check(refused.nativeVerificationNeeded.length,1);check(refused.leftAlone.length,0);
 r=row();r.native_verified=true;check(reconcile.detect(world(r)).findings.filter(x=>x.kind==='stamp').length,0);
 r=row();await helper.verifyRows([r],async()=>[attest(r)]);const w=world(r);const finding=reconcile.detect(w).findings.find(x=>x.kind==='stamp');assert.ok(finding);checks++;
 check(reconcile.detect({...w,outbox:[r,{...row(),id_text:'2',status:'pending',role:'admin',payload:{status:'in_progress'},source_edited_at:'2026-09-05T11:00:00Z'}]}).findings.filter(x=>x.kind==='stamp').length,0);
 check(reconcile.detect({...w,outbox:[r,{...row(),id_text:'3',status:'pending',role:'admin',payload:{status:'in_progress'},source_edited_at:'2026-09-05T10:00:00.123457Z'}]}).findings.filter(x=>x.kind==='stamp').length,0);
 check(reconcile.detect({...w,cards:[{...card(),video_status:'Tweaks Needed'}]}).findings.filter(x=>x.kind==='stamp').length,0);
 check(reconcile.detect({...w,outbox:[r,{...row(),id_text:'2',source_edited_at:'2026-09-05T11:00:00Z'}]}).findings.filter(x=>x.kind==='stamp').length,0);
 const oldFetch=global.fetch;let replacement=false,unavailable=false,posts=0;global.fetch=async(url,options={})=>{
 const u=new URL(url);if(u.pathname.includes('/functions/')){posts++;throw Error('CALENDAR_WRITE_FORBIDDEN_IN_TEST');}
 if(u.pathname.endsWith('/rpc/production_native_signoff_verify')){check(JSON.parse(options.body).p_receipt_ids,[replacement?'9007199254740994':'9007199254740993']);if(unavailable)return {ok:false,status:404};const fresh={...row(),id_text:replacement?'9007199254740994':row().id_text};return {ok:true,json:async()=>[attest(fresh)]};}
 let data=[];if(u.pathname.endsWith('/deliverables'))data=[del()];if(u.pathname.endsWith('/calendar_posts'))data=[card()];if(u.pathname.endsWith('/mirror_outbox'))data=[{...row(),id_text:replacement?'9007199254740994':row().id_text}];return {ok:true,json:async()=>data};};
 try{const loaded=await reconcile.loadWorld();check(reconcile.detect(loaded).findings.filter(x=>x.kind==='stamp').length,1);assert.ok(await reconcile.revalidate(w,finding));checks++;replacement=true;check(await reconcile.revalidate(w,finding),null);replacement=false;unavailable=true;check(await reconcile.revalidate(w,finding),null);check(posts,0);}finally{global.fetch=oldFetch;}
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-signoff-offline-'));const file=path.join(dir,'fixture.json');
 try{const marked=row();marked.payload._native_ordinary_receipt={schema:1};fs.writeFileSync(file,JSON.stringify(world(marked)));const run=cp.spawnSync(process.execPath,[path.join(__dirname,'../scripts/client-signoff-reconcile.js'),'--fixtures='+file],{encoding:'utf8',windowsHide:true,env:{...process.env,APPLY:'false',SUPABASE_SERVICE_ROLE_KEY:'',SYNCVIEW_STAFF_KEY:'',ONLY_CLIENT:''}});check(run.status,0);assert.match(run.stdout,/native approval verification unavailable 1/);checks++;assert.match(run.stdout,/left alone: 0/);checks++;}finally{fs.unlinkSync(file);fs.rmdirSync(dir);}
 console.log(JSON.stringify({marker:'CLIENT_SIGNOFF_NATIVE_OFFLINE_OK',checks,scope:'OFFLINE_TEST',transport:'synthetic',hosted_proof:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});

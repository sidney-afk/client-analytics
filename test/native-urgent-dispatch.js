'use strict';
// Actual production-write handler with a synthetic database only. The native
// urgent path now commits a durable notification intent and must never call n8n.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {pathToFileURL}=require('url'),{spawnSync}=require('child_process');
if(!process.execArgv.includes('--experimental-strip-types')){const r=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',__filename],{stdio:'inherit',windowsHide:true});process.exit(r.status??1);}
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'native-urgent-'));
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',ROLE_KEY_SMM:'staff',ROLE_KEY_CREATIVE:'creative'};
let handler,tables,epoch,enqueueError,enqueueArgs,fetchCalls=0,lookupError;
globalThis.Deno={env:{get:k=>env[k]},serve:fn=>handler=fn};
class Query{constructor(table){this.table=table;this.filters=[];}select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}maybeSingle(){this.single=true;return this;}then(resolve){const rows=(tables[this.table]||[]).filter(r=>this.filters.every(f=>f(r)));return Promise.resolve({data:structuredClone(this.single?rows[0]||null:rows),error:lookupError?{}:null}).then(resolve);}}
globalThis.__urgentSDK={from:t=>new Query(t),rpc:async(name,args)=>{
 if(name==='production_assignment_context')return{data:{contract:'existing-assignment-v1',epoch,replay:false},error:null};
 if(name==='production_notification_enqueue_urgent'){enqueueArgs=args;return enqueueError?{data:null,error:{message:enqueueError}}:{data:{status:'pending'},error:null};}
 throw Error('unexpected rpc '+name);
}};
globalThis.fetch=async()=>{fetchCalls++;throw Error('n8n/slack transport must not be reached');};
const stamp='2026-09-01T00:00:00.000Z';
function reset(){fetchCalls=0;epoch='native-v1';lookupError=false;enqueueError='';enqueueArgs=null;
 tables={team_members:[{id:'actor',name:'Fixture Staff',role:'smm',active:true},{id:'editor',name:'Fixture Editor',role:'editor',team:'video',slack_user_id:'U1234567890',active:true}],clients:[{slug:'fixture',display_name:'Fixture',active:true}],syncview_runtime_flags:[{key:'prod_authority',value:{video:'syncview'}}],deliverables:[{id:'native-id',client_slug:'fixture',team:'video',kind:'video',origin:'calendar',card_id:'card',batch_id:'batch',status:'tweak',assignee_id:'editor',title:'Post 1'}],batches:[{id:'batch',client_slug:'fixture',status:'active'}],calendar_posts:[{id:'card',client:'fixture',video_deliverable_id:'native-id',video_status:'Tweaks Needed',video_status_at:stamp}]};}
async function call(extra={},headers={'x-syncview-key':'staff','x-syncview-actor':'Fixture Staff'}){const r=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({action:'native_urgent_dispatch',client_slug:'fixture',deliverable_id:'native-id',card_id:'card',surface:'calendar',video_status_at:stamp,...extra})}));return{status:r.status,body:await r.json()};}
async function check(name,fn){reset();await fn();console.log('PASS '+name);}
(async()=>{try{
 const entry=path.join(root,'supabase/functions/production-write/index.ts');const source=fs.readFileSync(entry,'utf8').replace(/import \{ createClient, SupabaseClient \} from "npm:[^"]+";/,'const createClient=()=>globalThis.__urgentSDK; type SupabaseClient=any;').replace(/from "(\.\.?\/[^\"]+)"/g,(_,p)=>'from '+JSON.stringify(pathToFileURL(path.resolve(path.dirname(entry),p)).href));
 fs.writeFileSync(path.join(tmp,'handler.mts'),source);await import(pathToFileURL(path.join(tmp,'handler.mts')));
 await check('commits a pending exact-editor notification intent without transport',async()=>{const r=await call();assert.equal(r.status,202);assert.equal(r.body.delivery,'pending');assert.equal(r.body.retry_safe,false);assert.equal(fetchCalls,0);assert.equal(enqueueArgs.p_intended_member_id,'editor');assert.equal(enqueueArgs.p_actor_member_id,'actor');assert.equal(enqueueArgs.p_video_status_at,stamp);});
 for(const[name,change]of[['inactive client',()=>tables.clients[0].active=false],['wrong client',()=>tables.deliverables[0].client_slug='other'],['wrong team',()=>tables.deliverables[0].team='graphics'],['provider authority',()=>tables.syncview_runtime_flags[0].value.video='linear'],['provider assignment epoch',()=>epoch=''],['unresolved old assignee',()=>tables.deliverables[0].assignee_id='provider-id'],['inactive editor',()=>tables.team_members[1].active=false],['missing Slack identity',()=>delete tables.team_members[1].slack_user_id],['closed batch',()=>tables.batches[0].status='archived'],['changed round',()=>tables.calendar_posts[0].video_status_at='2026-09-02T00:00:00Z'],['changed status',()=>tables.deliverables[0].status='approved'],['lookup unavailable',()=>lookupError=true]])await check(name+' refuses before notification enqueue',async()=>{change();const r=await call();assert(r.status>=400);assert.equal(r.body.delivery,'not_sent');assert.equal(fetchCalls,0);assert.equal(enqueueArgs,null);});
 for(const extra of [{recipient:'U123'},{test_override:true},{video_status_at:''},{video_status_at:'not-a-date'}])await check('malformed or caller-authority fields refuse',async()=>{assert((await call(extra)).status>=400);assert.equal(enqueueArgs,null);});
 for(const headers of [{},{'x-syncview-key':'creative','x-syncview-actor':'Fixture Staff'},{'x-syncview-key':'staff','x-syncview-actor':'Unknown'}])await check('unsigned/wrong role/forged actor refuse',async()=>{assert((await call({},headers)).status>=400);assert.equal(enqueueArgs,null);});
 await check('database recheck refusal remains known-not-sent',async()=>{enqueueError='notification_urgent_target_changed';const r=await call();assert.equal(r.status,409);assert.equal(r.body.delivery,'not_sent');assert.equal(fetchCalls,0);});
 await check('urgent destination configuration absence is an actionable refusal',async()=>{enqueueError='notification_urgent_destination_unconfigured';const r=await call();assert.equal(r.status,409);assert.equal(r.body.error,'notification_urgent_destination_unconfigured');});
 await check('samples keeps its exact current card scope',async()=>{tables.deliverables[0].origin='samples';tables.batches[0].purpose='samples';tables.sample_reviews=tables.calendar_posts;delete tables.calendar_posts;assert.equal((await call({surface:'samples'})).body.delivery,'pending');assert.equal(enqueueArgs.p_surface,'samples');});
 console.log('PASS native urgent committed-intent groups; no real network or writes');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});

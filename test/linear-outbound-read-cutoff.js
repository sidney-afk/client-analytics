'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {extractFunction}=require('./helpers/extract-function');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'supabase/functions/linear-outbound/index.ts'),'utf8');
let passed=0;const check=(condition,name)=>{assert.ok(condition,name);passed++;};
const transport=extractFunction(source,'linearGraphql');
check(transport.indexOf('await authorizeProviderDispatch(dispatch.supabase, dispatch.row);')<transport.indexOf('await fetch(LINEAR_URL'),'every provider transport requires authorization first');
check((source.match(/\bfetch\(/g)||[]).length===2&&(source.match(/fetch\(LINEAR_URL/g)||[]).length===1,'sole provider fetch plus unchanged service credential probe');
check(source.indexOf('mirrorActor = await readViewer(dispatch)')>source.indexOf('const row = await claimRow(supabase, candidate)'),'viewer runs only after row claim');
check(source.indexOf('mirrorActor = await readViewer(dispatch)')>source.indexOf('f27DrillReceipt = await executeF27DrillReplay'),'SQL-only F27 drill exits before viewer');
check(source.includes('await authorizeProviderDispatch(supabase, row);')&&source.includes('const data = await linearGraphql(mutation.query, mutation.variables as JsonMap, dispatch);'),'pre-mutation authorization/checkpoint and transport authorization both retained');
const header='function authorizeProviderDispatch(supabase: SupabaseClient, row: OutboxRow): Promise<void> {';
let fn=extractFunction(source,'authorizeProviderDispatch');assert.ok(fn.startsWith(header));
fn='async '+fn.replace(header,'function authorizeProviderDispatch(supabase, row) {');
const scope={parseJson:v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{},clean:v=>String(v??'').trim()};vm.createContext(scope);vm.runInContext(fn,scope);
(async()=>{
 const row={id:17,lock_token:'00000000-0000-0000-0000-000000000001',outbound_generation:0};
 const valid={authorized:true,authorization:'00000000-0000-0000-0000-000000000002',outbox_id:17,generation:0};
 const call=async(data,error=null,target=row)=>scope.authorizeProviderDispatch({rpc:async(name,args)=>{assert.equal(name,'linear_outbound_authorize_dispatch_v1');assert.equal(args.p_id,target.id);assert.equal(args.p_generation,target.outbound_generation);assert.equal(args.p_lock_token,target.lock_token);return{data,error};}},target);
 await call(valid);passed++;
 await call({...valid,generation:9},null,{...row,outbound_generation:9});passed++;
 for(const generation of [null,'',false,'0',undefined,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){await assert.rejects(call({...valid,generation}));passed++;}
 for(const outbox_id of [null,'',false,'17',undefined,18,17.5,Number.MAX_SAFE_INTEGER+1]){await assert.rejects(call({...valid,outbox_id}));passed++;}
 for(const data of [null,[],{},false,{...valid,authorized:'true'},{...valid,authorization:null},{...valid,authorization:'malformed'}]){await assert.rejects(call(data));passed++;}
 await assert.rejects(call(valid,{message:'read unavailable'}));passed++;
 console.log('linear outbound read cutoff: '+passed+' offline checks passed');
 if(process.env.CI||process.env.F63_REQUIRE_POSTGRES==='1'){
  assert.equal(process.env.F63_REQUIRE_POSTGRES,'1','explicit_disposable_binding_required');assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.PGHOST),'disposable_loopback_required');
  const psql=process.env.G8_TEST_PSQL||(fs.existsSync('/usr/bin/psql')?'/usr/bin/psql':'');assert.ok(psql&&path.isAbsolute(psql),'explicit_psql_required');
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'g8-read-disposable-'));
  const r=cp.spawnSync(process.execPath,[path.join(root,'scripts/linear-outbound-cutoff-rehearsal.js'),'--read-fence'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:8e6,
   env:{...process.env,G8_TEST_CONFIRM:'LOCAL_DISPOSABLE_ONLY',G8_TEST_REQUIRE:'1',G8_TEST_PSQL:psql,G8_TEST_PORT:process.env.PGPORT,G8_TEST_PASSWORD:process.env.PGPASSWORD||'',G8_TEST_OUTPUT:output}});
  fs.writeFileSync(path.join(output,'wrapper.private.log'),(r.stdout||'')+(r.stderr||''));assert.equal(r.status,0,'actual_read_fence_lane_failed_private_evidence_retained');
  const report=JSON.parse(fs.readFileSync(path.join(output,'REPORT.private.json')));assert.equal(report.failed,0);assert.equal(report.passed,34);assert.equal(report.external_requests,0);
  console.log('linear outbound read cutoff: '+report.passed+' actual handler/SQL groups passed');
 }
})().catch(error=>{console.error(error);process.exitCode=1;});

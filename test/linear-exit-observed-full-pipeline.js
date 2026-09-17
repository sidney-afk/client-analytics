'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),cp=require('child_process');
const ROOT=path.resolve(__dirname,'..'),E=process.env.OBSERVED_INPUT_DIRECTORY;
assert(E&&path.isAbsolute(E),'explicit private observed input directory required');
const mode=process.argv[2];assert(['--calibrate','--verify'].includes(mode),'explicit calibration or verification mode required');
if(mode==='--verify'){assert(process.argv[3]&&path.isAbsolute(process.argv[3]),'explicit private target path required');assert(/^[a-f0-9]{64}$/.test(process.argv[4]),'explicit target SHA required');}

const {Cluster}=require(ROOT+'/scripts/f42-apply-rehearsal'),journal=require(ROOT+'/scripts/linear-exit-install-journal'),catalog=require(ROOT+'/scripts/linear-exit-source-baseline-catalog');
const out=process.env.PROOF_OUTPUT_ROOT;
assert(out&&path.isAbsolute(out),'explicit absolute private output directory required');
assert(fs.statSync(out).isDirectory(),'private output directory must exist');
assert.equal(process.env.F63_REQUIRE_POSTGRES,'1','isolated PostgreSQL opt-in required');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert(!process.env[key],'routing override refused');
assert(!Object.keys(process.env).some(key=>/^SUPABASE/i.test(key)),'inherited hosted routing refused');
const c=new Cluster();assert.equal(c.host,'127.0.0.1','loopback only');let stage='reconstruct';
function fullCatalog(sql){const r=cp.spawnSync(c.psql,['-X','-q','-A','-t','-h',c.host,'-p',String(c.port),'-U',c.user,'-d',c.db,'-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});assert.equal(r.status,0,'catalog read failed');assert.equal(r.stderr,'');return JSON.parse(r.stdout);}

try{c.start();require(ROOT+'/scripts/linear-exit-observed-schema').applyObservedSchema(c,{inputDirectory:E,outputDirectory:out});
c.exec('alter table storage.buckets alter column name set not null; alter table storage.buckets add column public boolean, add column file_size_limit bigint, add column allowed_mime_types text[];');
// D19: this lane proves the SETTLED world, not the 2026-09-12 capture. The reconstruction above
// rebuilds observed67; the owner's hiring migration, as merged on main at 1abdd1fa, is what makes
// it settled68. Applied here the same way scripts/linear-exit-b9-catalog-derive.js applies it --
// read the file from main and execute it -- so there is one way this world is built, not two.
// observed67 and observed67_optout cannot install at all after B10 (journal D18), so proving this
// lane against them is proving a world that will never be installed.
c.exec(fs.readFileSync(path.join(ROOT,require(ROOT+'/scripts/linear-exit-b9-catalog-derive').HIRING_MIGRATION),'utf8'));
const initial=c.scalarJson(catalog.query());const built=require(ROOT+'/scripts/linear-exit-install-profiles').build(initial,'settled68'),plan=JSON.parse(built.planBytes);
assert.equal(plan.sources.length,35+require(ROOT+'/scripts/linear-exit-observed-full-install-plan').OWNERS.length);stage='journal-search-path';const queried=c.scalarJson('set search_path=pg_catalog,public;'+plan.catalog_sql);assert.equal(journal.sha(journal.canonical(queried)),plan.initial_catalog_sha256);
const file=path.join(out,'transition-plan.private.json');fs.writeFileSync(file,built.planBytes,{flag:'wx'});fs.writeFileSync(path.join(out,'transition-before.private.json'),JSON.stringify(initial));
const identity=c.scalarJson(journal.IDENTITY_SQL),env={...process.env,JOURNAL_DATABASE:c.db,JOURNAL_PLAN:file,JOURNAL_PLAN_SHA:built.planSha256,JOURNAL_STAGE:plan.stage_id,JOURNAL_IDENTITY:JSON.stringify(identity),JOURNAL_FAULT:'',FULL_EXPECTED_TARGET:mode==='--verify'?process.argv[3]:'',FULL_EXPECTED_TARGET_SHA:mode==='--verify'?process.argv[4]:''};
if(mode==='--verify'){
 stage='interrupt-final-owner';const fault=cp.spawnSync('deno',['run','--unstable-detect-cjs','--no-config','--lock=qa/linear-exit-rehearsal/followup-deno.lock','--frozen','--cached-only','--allow-read','--allow-write='+out,'--allow-env','--allow-net=127.0.0.1',ROOT+'/test/helpers/observed-full-pipeline-worker.mjs'],{cwd:ROOT,env:{...env,FULL_INTERRUPT_FINAL:'1'},encoding:'utf8',windowsHide:true,timeout:300000});fs.writeFileSync(path.join(out,'interrupted-worker.private.json'),JSON.stringify({status:fault.status,stdout:fault.stdout,stderr:fault.stderr}));assert.equal(fault.status,86);assert.match(fault.stderr,/EXPECTED_FINAL_OWNER_INTERRUPTION/);
 const compiled=journal.compile(built.planBytes,built.planSha256),state=c.scalarJson('select to_jsonb(j) from linear_exit_install.journal_v1 j'),prefix=compiled.steps.slice(0,-1).map(s=>({source_id:s.source_id,source_sha256:s.source_sha256,chunk_index:s.index,chunk_sha256:s.sha256}));assert.deepEqual(state.completed,prefix);assert.equal(compiled.steps.at(-1).source_id,'supabase/migrations/20260913062149_retirement_switch_preparation.sql');assert.equal(state.after_catalog_sha256,journal.sha(journal.canonical(fullCatalog('set search_path=pg_catalog,public;'+plan.catalog_sql))));
 assert.equal(c.scalarJson("select to_jsonb(to_regprocedure('public.production_syncview_retirement_activate_v2(uuid,jsonb,text,text)') is null and to_regprocedure('linear_exit_provider.retirement_send_fence_v1()') is null)"),true);
 let blocked=false;try{c.exec('update public.calendar_posts set id=id where false');}catch(e){blocked=/maintenance/i.test(e.message);}assert(blocked);assert.equal(c.scalarJson("select count(*)::int from pg_trigger where tgname='linear_exit_maintenance_dml_v1' and tgenabled='A'"),90);
 fs.writeFileSync(path.join(out,'interruption-boundary.private.json'),JSON.stringify({exact_prefix:true,completed_chunks:prefix.length,final_owner_effects_absent:true,maintenance_refused:true,current_catalog_matches_prefix:true,same_database_identity:true}));
}
stage='bootstrap-worker';const r=cp.spawnSync('deno',['run','--unstable-detect-cjs','--no-config','--lock=qa/linear-exit-rehearsal/followup-deno.lock','--frozen','--cached-only','--allow-read','--allow-write='+out,'--allow-env','--allow-net=127.0.0.1',ROOT+'/test/helpers/observed-full-pipeline-worker.mjs'],{cwd:ROOT,env,encoding:'utf8',windowsHide:true,timeout:300000});fs.writeFileSync(path.join(out,'transition-worker.private.json'),JSON.stringify({status:r.status,error:r.error?.message,stdout:r.stdout,stderr:r.stderr}));
assert.equal(r.status,0,'pipeline failed');const after=JSON.parse(fs.readFileSync(path.join(out,'transition-after.private.json')));
assert.equal(r.status,0,'worker failed; retained private diagnostic');assert.equal(after.tables.length,require(ROOT+'/scripts/linear-exit-observed-public-catalog').postInstallPublicTables(plan.initial_catalog_sha256).expected);
console.log(JSON.stringify({marker:mode==='--calibrate'?'LINEAR_EXIT_OBSERVED_FULL_CALIBRATION_OK':'LINEAR_EXIT_OBSERVED_FULL_PIPELINE_OK',classification:mode==='--calibrate'?'TARGET_CALIBRATION_ONLY':'FRESH_TARGET_REPLAY',transition:true,sources:plan.sources.length,tables:after.tables.length,plan_sha256:built.planSha256,installation_authorized:false}));
}catch(e){fs.writeFileSync(path.join(out,'transition-error.private.log'),String(e.stack||e));console.error(JSON.stringify({marker:'TRANSITION_FAILED',stage}));process.exitCode=1;}finally{c.stop();}
